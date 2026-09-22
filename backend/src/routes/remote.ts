// REST للمرحلة 3: الحجز، الطابور، حالة الجلسة، إكمال التقرير، وبث الفيديو (MJPEG proxy)
import { Router } from "express";
import { Readable } from "stream";
import { z } from "zod";
import { prisma } from "../db";
import { ah, HttpError, parse } from "../lib/http";
import { signStreamToken, verifyStreamToken } from "../lib/jwt";
import { authenticate, requireRole } from "../middleware/auth";
import { loadLabOr404, stageStatus } from "../labs/stages";
import { assertLabAccess, getDef } from "./labs";
import { cancelBooking, createBooking, endSession, getQueue, joinQueue, listSlots, MAX_OPEN_BOOKINGS } from "../remote/sessions";
import { completeRemote, remoteSamples } from "../remote/completion";
import { getDriver } from "../remote/deviceManager";

export const remoteRouter = Router();

// ---- بث الفيديو: يستعمل رمزاً قصيراً في الـ query لأن وسم <img> لا يرسل Authorization ----
remoteRouter.get(
  "/video/:bookingId",
  ah(async (req, res) => {
    let p;
    try {
      p = verifyStreamToken(String(req.query.st ?? ""));
    } catch {
      throw new HttpError(401, "INVALID_TOKEN");
    }
    if (p.b !== req.params.bookingId) throw new HttpError(403, "FORBIDDEN");
    const b = await prisma.booking.findUnique({ where: { id: p.b }, include: { device: true } });
    if (!b || b.userId !== p.u || b.status !== "ACTIVE") throw new HttpError(403, "SESSION_NOT_ACTIVE");
    if (!b.device.videoUrl) throw new HttpError(404, "NO_VIDEO");
    const ctrl = new AbortController();
    req.on("close", () => ctrl.abort());
    const up = await fetch(b.device.videoUrl, { signal: ctrl.signal }).catch(() => null);
    if (!up || !up.ok || !up.body) throw new HttpError(502, "VIDEO_UNAVAILABLE");
    res.setHeader("Content-Type", up.headers.get("content-type") ?? "multipart/x-mixed-replace; boundary=frame");
    res.setHeader("Cache-Control", "no-store");
    Readable.fromWeb(up.body as never).pipe(res);
  }),
);

remoteRouter.use(authenticate);

remoteRouter.get(
  "/devices/:deviceId/slots",
  ah(async (req, res) => {
    const device = await prisma.device.findUnique({ where: { id: req.params.deviceId } });
    if (!device) throw new HttpError(404, "DEVICE_NOT_FOUND");
    const from = req.query.from ? new Date(String(req.query.from)) : new Date();
    const days = Math.min(7, Math.max(1, Number(req.query.days ?? 2)));
    res.json({ slotMinutes: device.slotMinutes, slots: await listSlots(device, req.user!, from, days) });
  }),
);

remoteRouter.get(
  "/devices/:deviceId/queue",
  ah(async (req, res) => {
    const device = await prisma.device.findUnique({ where: { id: req.params.deviceId } });
    if (!device) throw new HttpError(404, "DEVICE_NOT_FOUND");
    res.json({ queue: await getQueue(device, req.user!) });
  }),
);

/** حالة المرحلة 3 لتجربة: مفتوحة؟ الجهاز، حجوزاتي، عدد القياسات، إكمال */
remoteRouter.get(
  "/labs/:labId/status",
  requireRole("STUDENT"),
  ah(async (req, res) => {
    const u = req.user!;
    const lab = await loadLabOr404(req.params.labId);
    await assertLabAccess(u, lab);
    const progress = await prisma.progress.findUnique({ where: { userId_labId: { userId: u.id, labId: lab.id } } });
    const remote = getDef(lab).remote;
    const device = lab.deviceId ? await prisma.device.findUnique({ where: { id: lab.deviceId } }) : null;
    const bookings = await prisma.booking.findMany({ where: { userId: u.id, labId: lab.id, status: { in: ["BOOKED", "ACTIVE"] }, endsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" } });
    const samples = await remoteSamples(u.id, lab.id);
    const distinct = new Set(samples.map((s) => Math.round((s.values[remote?.plot.x ?? "vLoad"] ?? 0) * 1000))).size;
    const unlocked = !!progress?.remoteUnlockedAt;
    const active = bookings.find((b) => b.status === "ACTIVE");
    res.json({
      unlocked,
      completed: !!progress?.remoteCompletedAt,
      stage: progress ? stageStatus(lab, progress).stage3 : { state: "locked" },
      remote,
      device: device && { id: device.id, name: device.name, slotMinutes: device.slotMinutes, maintenance: device.maintenance, online: getDriver(device.id)?.isOnline() ?? false, mock: device.driver === "MOCK" },
      bookings,
      activeBookingId: active?.id ?? null,
      maxOpenBookings: MAX_OPEN_BOOKINGS,
      samples: samples.length,
      distinctPoints: distinct,
      minPoints: remote?.minPoints ?? 0,
    });
  }),
);

remoteRouter.get(
  "/labs/:labId/samples",
  requireRole("STUDENT"),
  ah(async (req, res) => {
    const lab = await loadLabOr404(req.params.labId);
    await assertLabAccess(req.user!, lab);
    res.json({ samples: await remoteSamples(req.user!.id, lab.id) });
  }),
);

remoteRouter.post(
  "/bookings",
  requireRole("STUDENT"),
  ah(async (req, res) => {
    const b = parse(z.object({ labId: z.string(), startsAt: z.string() }), req.body);
    const lab = await loadLabOr404(b.labId);
    await assertLabAccess(req.user!, lab);
    res.status(201).json({ booking: await createBooking(req.user!, lab, b.startsAt) });
  }),
);

remoteRouter.post(
  "/queue",
  requireRole("STUDENT"),
  ah(async (req, res) => {
    const b = parse(z.object({ labId: z.string() }), req.body);
    const lab = await loadLabOr404(b.labId);
    await assertLabAccess(req.user!, lab);
    res.status(201).json(await joinQueue(req.user!, lab));
  }),
);

remoteRouter.get(
  "/bookings/mine",
  ah(async (req, res) => {
    const list = await prisma.booking.findMany({
      where: { userId: req.user!.id },
      orderBy: { startsAt: "desc" },
      take: 50,
      include: { lab: { select: { id: true, slug: true, titleAr: true, titleFr: true } }, device: { select: { id: true, name: true } } },
    });
    res.json({ bookings: list });
  }),
);

remoteRouter.delete("/bookings/:id", ah(async (req, res) => (await cancelBooking(req.user!, req.params.id), res.json({ ok: true }))));

/** تفاصيل جلسة (لصفحة التحكم): تتضمن رمز بث الفيديو */
remoteRouter.get(
  "/bookings/:id",
  ah(async (req, res) => {
    const b = await prisma.booking.findUnique({ where: { id: req.params.id }, include: { lab: true, device: true } });
    if (!b || b.userId !== req.user!.id) throw new HttpError(404, "BOOKING_NOT_FOUND");
    res.json({
      booking: { id: b.id, status: b.status, startsAt: b.startsAt, endsAt: b.endsAt, labId: b.labId, labSlug: b.lab.slug },
      hasVideo: !!b.device.videoUrl,
      videoToken: b.status === "ACTIVE" && b.device.videoUrl ? signStreamToken(b.id, req.user!.id) : null,
      serverTime: Date.now(),
    });
  }),
);

remoteRouter.post("/bookings/:id/end", ah(async (req, res) => {
  const b = await prisma.booking.findUnique({ where: { id: req.params.id } });
  if (!b || b.userId !== req.user!.id) throw new HttpError(404, "BOOKING_NOT_FOUND");
  res.json({ ended: await endSession(b.id, "student_ended") });
}));

/** إتمام المرحلة 3: التحقق من عدد القياسات + توليد التقرير */
remoteRouter.post(
  "/labs/:labId/complete",
  requireRole("STUDENT"),
  ah(async (req, res) => {
    const lab = await loadLabOr404(req.params.labId);
    await assertLabAccess(req.user!, lab);
    res.status(201).json(await completeRemote(req.user!, lab));
  }),
);
