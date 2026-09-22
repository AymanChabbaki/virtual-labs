// ============================================================================
//  الحجز + الطابور + دورة حياة الجلسة (تفعيل/إنهاء) — الجهاز واحد وطالب واحد في كل لحظة.
//  • كل حجز = فترة واحدة (slot) بطول device.slotMinutes، والفترات لا تتداخل أبداً (قفل + فحص تداخل).
//  • "الطابور" = ترتيب الحجوزات القادمة على الجهاز؛ join queue يحجز أول فترة حرة تلقائياً.
//  • المجدوِل (scheduler) يفعّل الحجز عند بدايته إن كان الجهاز حراً، وينهيه تلقائياً عند نهايته.
// ============================================================================
import type { Booking, Device, Lab, User } from "../generated/prisma/client";
import { prisma } from "../db";
import { config } from "../config";
import { HttpError } from "../lib/http";
import { withLock } from "../lib/lock";
import { notify } from "../lib/notify";
import { audit } from "../lib/audit";
import { getIO } from "../lib/realtime";
import { assertStage3Open, getOrCreateProgress } from "../labs/stages";
import { getDriver, limitsOf } from "./deviceManager";
import { clearRate } from "./safety";

export const MIN_REMAINING_MS = 5 * 60_000; // لا نقبل فترة يتبقى منها أقل من 5 دقائق
export const MAX_DAYS_AHEAD = 14;
export const MAX_OPEN_BOOKINGS = 2;

/** deviceId → bookingId للجلسة النشطة (لتوجيه القياسات إلى غرفة الجلسة) */
export const activeByDevice = new Map<string, string>();

const slotMs = (d: Device) => d.slotMinutes * 60_000;
const OPEN = ["BOOKED", "ACTIVE"] as const;

export function fmtWhen(d: Date, locale: "fr" | "ar") {
  return d.toLocaleString(locale === "fr" ? "fr-FR" : "ar-MA", { timeZone: config.timezone, dateStyle: "short", timeStyle: "short" });
}

/** ساعات فتح الجهاز (اختياري) بالتوقيت المحلي: limits.openHour / limits.closeHour */
function isOpenAt(d: Device, start: Date): boolean {
  const l = d.limits as { openHour?: number; closeHour?: number };
  if (l.openHour == null || l.closeHour == null) return true;
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: config.timezone }).format(start)) % 24;
  return h >= l.openHour && h < l.closeHour;
}

const changed = (deviceId: string) => getIO()?.to(`device:${deviceId}`).emit("queue:changed", { deviceId });

async function assertBookable(user: User, lab: Lab) {
  const progress = await getOrCreateProgress(user.id, lab.id);
  assertStage3Open(progress); // ⭐ القفل: لا حجز بدون نجاح في الكويز
  if (progress.remoteCompletedAt) throw new HttpError(409, "ALREADY_COMPLETED");
  if (!lab.deviceId) throw new HttpError(409, "NO_DEVICE");
  const device = await prisma.device.findUniqueOrThrow({ where: { id: lab.deviceId } });
  if (device.maintenance) throw new HttpError(409, "DEVICE_MAINTENANCE");
  return device;
}

// ---------------------------------------------------------------------------
export async function listSlots(device: Device, user: User, from: Date, days: number) {
  const sm = slotMs(device);
  const first = Math.floor(from.getTime() / sm) * sm;
  const last = first + Math.min(days, 7) * 86_400_000;
  const bookings = await prisma.booking.findMany({ where: { deviceId: device.id, status: { in: [...OPEN] }, endsAt: { gt: new Date(first) }, startsAt: { lt: new Date(last) } } });
  const now = Date.now();
  const slots = [];
  for (let s = first; s < last; s += sm) {
    const start = new Date(s);
    if (!isOpenAt(device, start)) continue;
    const b = bookings.find((x) => x.startsAt.getTime() < s + sm && x.endsAt.getTime() > s);
    slots.push({ startsAt: start.toISOString(), endsAt: new Date(s + sm).toISOString(), state: s + sm - now < MIN_REMAINING_MS ? "past" : b ? (b.userId === user.id ? "mine" : "taken") : "free" });
  }
  return slots;
}

export async function createBooking(user: User, lab: Lab, startsAtIso: string) {
  const device = await assertBookable(user, lab);
  const sm = slotMs(device);
  const start = new Date(startsAtIso).getTime();
  if (!Number.isFinite(start) || start % sm !== 0) throw new HttpError(400, "SLOT_ALIGNMENT");
  const end = start + sm;
  if (end - Date.now() < MIN_REMAINING_MS) throw new HttpError(422, "SLOT_IN_PAST");
  if (start > Date.now() + MAX_DAYS_AHEAD * 86_400_000) throw new HttpError(422, "TOO_FAR");
  if (!isOpenAt(device, new Date(start))) throw new HttpError(422, "DEVICE_CLOSED");

  const booking = await withLock(`device:${device.id}`, async (tx) => {
    const open = await tx.booking.count({ where: { userId: user.id, status: { in: [...OPEN] }, endsAt: { gt: new Date() } } });
    if (open >= MAX_OPEN_BOOKINGS) throw new HttpError(409, "BOOKING_LIMIT");
    const clash = await tx.booking.findFirst({ where: { deviceId: device.id, status: { in: [...OPEN] }, startsAt: { lt: new Date(end) }, endsAt: { gt: new Date(start) } } });
    if (clash) throw new HttpError(409, "SLOT_TAKEN");
    return tx.booking.create({ data: { userId: user.id, labId: lab.id, deviceId: device.id, startsAt: new Date(start), endsAt: new Date(end) } });
  });
  await afterCreate(user, lab, booking);
  return booking;
}

/** الانضمام إلى الطابور: يحجز أول فترة حرة متاحة */
export async function joinQueue(user: User, lab: Lab) {
  const device = await assertBookable(user, lab);
  const sm = slotMs(device);
  const now = Date.now();
  const booking = await withLock(`device:${device.id}`, async (tx) => {
    const open = await tx.booking.count({ where: { userId: user.id, status: { in: [...OPEN] }, endsAt: { gt: new Date() } } });
    if (open >= MAX_OPEN_BOOKINGS) throw new HttpError(409, "BOOKING_LIMIT");
    const horizon = now + MAX_DAYS_AHEAD * 86_400_000;
    const taken = await tx.booking.findMany({ where: { deviceId: device.id, status: { in: [...OPEN] }, endsAt: { gt: new Date(now) } } });
    for (let s = Math.floor(now / sm) * sm; s < horizon; s += sm) {
      if (s + sm - now < MIN_REMAINING_MS || !isOpenAt(device, new Date(s))) continue;
      if (taken.some((b) => b.startsAt.getTime() < s + sm && b.endsAt.getTime() > s)) continue;
      return tx.booking.create({ data: { userId: user.id, labId: lab.id, deviceId: device.id, startsAt: new Date(s), endsAt: new Date(s + sm) } });
    }
    throw new HttpError(409, "NO_SLOT_AVAILABLE");
  });
  await afterCreate(user, lab, booking);
  const position = await prisma.booking.count({ where: { deviceId: device.id, status: { in: [...OPEN] }, endsAt: { gt: new Date() }, startsAt: { lt: booking.startsAt } } });
  return { booking, position: position + 1 };
}

async function afterCreate(user: User, lab: Lab, b: Booking) {
  await audit(user.id, "booking_created", "booking", b.id, { start: b.startsAt });
  await notify(user.id, "booking_created", { lab: lab.titleFr, labAr: lab.titleAr, labId: lab.id, when: fmtWhen(b.startsAt, user.locale), whenIso: b.startsAt.toISOString() });
  changed(b.deviceId);
}

/** الطابور القادم على جهاز (أسماء الآخرين مخفية عن الطلبة) */
export async function getQueue(device: Device, viewer: User) {
  const list = await prisma.booking.findMany({
    where: { deviceId: device.id, status: { in: [...OPEN] }, endsAt: { gt: new Date() } },
    orderBy: { startsAt: "asc" },
    take: 60,
    include: { user: { select: { name: true } }, lab: { select: { titleAr: true, titleFr: true } } },
  });
  return list.map((b, i) => ({
    id: b.id,
    position: i + 1,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    status: b.status,
    mine: b.userId === viewer.id,
    student: viewer.role === "STUDENT" && b.userId !== viewer.id ? null : b.user.name,
    lab: b.lab,
  }));
}

export async function cancelBooking(user: User, id: string) {
  const b = await prisma.booking.findUnique({ where: { id } });
  if (!b || (b.userId !== user.id && user.role !== "ADMIN")) throw new HttpError(404, "BOOKING_NOT_FOUND");
  if (b.status !== "BOOKED") throw new HttpError(409, "NOT_CANCELLABLE");
  await prisma.booking.update({ where: { id }, data: { status: "CANCELLED", endedAt: new Date(), endReason: "cancelled" } });
  await audit(user.id, "booking_cancelled", "booking", id);
  changed(b.deviceId);
}

// ---------------------------------------------------------------------------
//  دورة حياة الجلسة
// ---------------------------------------------------------------------------
export async function endSession(bookingId: string, reason: string, status: "COMPLETED" | "NO_SHOW" = "COMPLETED") {
  const b = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!b) return false;
  const r = await prisma.booking.updateMany({ where: { id: bookingId, status: "ACTIVE" }, data: { status, endedAt: new Date(), endReason: reason } });
  if (!r.count) return false;
  if (activeByDevice.get(b.deviceId) === bookingId) activeByDevice.delete(b.deviceId);
  // تحرير الجهاز: وضع آمن (0V، الخرج مفصول) قبل تسليمه للطالب الموالي
  await getDriver(b.deviceId)?.safeState().catch((e) => console.warn("[session] safeState failed:", e.message));
  clearRate(bookingId);
  const io = getIO();
  io?.to(`session:${bookingId}`).emit("session:ended", { bookingId, reason });
  io?.in(`session:${bookingId}`).socketsLeave(`session:${bookingId}`);
  await audit(b.userId, "session_ended", "booking", bookingId, { reason });
  changed(b.deviceId);
  return true;
}

/** يُنفَّذ كل ثانية من المجدوِل */
export async function schedulerTick() {
  const now = new Date();

  // 1) إنهاء الجلسات المنتهية زمنياً + التي لم يحضر لها الطالب
  const active = await prisma.booking.findMany({ where: { status: "ACTIVE" } });
  for (const b of active) {
    activeByDevice.set(b.deviceId, b.id);
    if (b.endsAt <= now) await endSession(b.id, "timeout");
    else if (!b.joinedAt && b.activatedAt && b.activatedAt.getTime() + config.noShowGraceSec * 1000 <= now.getTime()) await endSession(b.id, "no_show", "NO_SHOW");
  }

  // 2) حجوزات فاتت فترتها دون أن تُفعَّل
  await prisma.booking.updateMany({ where: { status: "BOOKED", endsAt: { lte: now } }, data: { status: "NO_SHOW", endedAt: now, endReason: "missed" } });

  // 3) تفعيل الحجز التالي على كل جهاز حرّ
  const devices = await prisma.device.findMany({ where: { maintenance: false } });
  for (const d of devices) {
    const busy = await prisma.booking.count({ where: { deviceId: d.id, status: "ACTIVE" } });
    if (busy) continue;
    const next = await prisma.booking.findFirst({ where: { deviceId: d.id, status: "BOOKED", startsAt: { lte: now }, endsAt: { gt: now } }, orderBy: { startsAt: "asc" }, include: { lab: true } });
    if (!next) continue;
    await getDriver(d.id)?.safeState().catch(() => undefined);
    const r = await prisma.booking.updateMany({ where: { id: next.id, status: "BOOKED" }, data: { status: "ACTIVE", activatedAt: now } });
    if (!r.count) continue;
    activeByDevice.set(d.id, next.id);
    await notify(next.userId, "session_started", { lab: next.lab.titleFr, labAr: next.lab.titleAr, labId: next.labId, bookingId: next.id });
    getIO()?.to(`user:${next.userId}`).emit("session:started", { bookingId: next.id, labId: next.labId });
    changed(d.id);
  }

  // 4) تذكيرات قبل الموعد
  const soon = await prisma.booking.findMany({ where: { status: "BOOKED", reminderSent: false, startsAt: { gt: now, lte: new Date(now.getTime() + config.reminderMinutes * 60_000) } }, include: { lab: true, user: true } });
  for (const b of soon) {
    await prisma.booking.update({ where: { id: b.id }, data: { reminderSent: true } });
    await notify(b.userId, "booking_reminder", { lab: b.lab.titleFr, labAr: b.lab.titleAr, labId: b.labId, minutes: Math.max(1, Math.round((b.startsAt.getTime() - now.getTime()) / 60_000)), when: fmtWhen(b.startsAt, b.user.locale) });
  }
}
