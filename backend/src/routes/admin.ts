// لوحة المدير: المستخدمون، الفصول، الأجهزة، السجلات
import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db";
import { ah, HttpError, parse } from "../lib/http";
import { audit } from "../lib/audit";
import { authenticate, requireRole } from "../middleware/auth";
import { publicUser } from "./auth";
import { DEFAULT_LIMITS } from "../remote/types";
import { getDriver, reloadDevice, removeDevice } from "../remote/deviceManager";
import { endSession } from "../remote/sessions";

export const adminRouter = Router();
adminRouter.use(authenticate);

// الأجهزة مقروءة للأستاذ أيضاً (لربطها بالتجارب)
adminRouter.get(
  "/devices",
  requireRole("TEACHER"),
  ah(async (_req, res) => {
    const devices = await prisma.device.findMany({ orderBy: { name: "asc" } });
    res.json({ devices: devices.map((d) => ({ ...d, online: getDriver(d.id)?.isOnline() ?? false, latest: getDriver(d.id)?.latest() ?? null })) });
  }),
);
adminRouter.get("/classrooms", requireRole("TEACHER"), ah(async (_req, res) => res.json({ classrooms: await prisma.classroom.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { students: true } } } }) })));

adminRouter.use(requireRole("ADMIN"));

// ---------------------------------------------------------------- المستخدمون
adminRouter.get(
  "/users",
  ah(async (req, res) => {
    const role = req.query.role as string | undefined;
    const q = (req.query.q as string | undefined)?.trim();
    const users = await prisma.user.findMany({
      where: { ...(role ? { role: role as never } : {}), ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}) },
      orderBy: [{ role: "asc" }, { name: "asc" }],
      include: { classroom: true },
      take: 500,
    });
    res.json({ users: users.map((u) => ({ ...publicUser(u), active: u.active, classroom: u.classroom?.name ?? null, createdAt: u.createdAt })) });
  }),
);

const UserBody = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(80),
  password: z.string().min(8).max(100),
  role: z.enum(["STUDENT", "TEACHER", "ADMIN"]),
  locale: z.enum(["ar", "fr"]).default("fr"),
  classroomId: z.string().nullable().optional(),
});

adminRouter.post(
  "/users",
  ah(async (req, res) => {
    const b = parse(UserBody, req.body);
    if (await prisma.user.findUnique({ where: { email: b.email.toLowerCase() } })) throw new HttpError(409, "EMAIL_TAKEN");
    const { password, ...rest } = b;
    const u = await prisma.user.create({ data: { ...rest, email: b.email.toLowerCase(), passwordHash: await bcrypt.hash(password, 10) } });
    await audit(req.user!.id, "user_created", "user", u.id, { role: u.role });
    res.status(201).json({ user: publicUser(u) });
  }),
);

adminRouter.patch(
  "/users/:id",
  ah(async (req, res) => {
    const b = parse(UserBody.partial().extend({ active: z.boolean().optional() }), req.body);
    if (req.params.id === req.user!.id && (b.active === false || (b.role && b.role !== "ADMIN"))) throw new HttpError(400, "CANNOT_DEMOTE_SELF");
    const { password, ...rest } = b;
    const u = await prisma.user.update({ where: { id: req.params.id }, data: { ...rest, ...(rest.email ? { email: rest.email.toLowerCase() } : {}), ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}) } });
    await audit(req.user!.id, "user_updated", "user", u.id, { fields: Object.keys(b).filter((k) => k !== "password") });
    res.json({ user: publicUser(u) });
  }),
);

adminRouter.delete(
  "/users/:id",
  ah(async (req, res) => {
    if (req.params.id === req.user!.id) throw new HttpError(400, "CANNOT_DELETE_SELF");
    const owned = await prisma.lab.count({ where: { ownerId: req.params.id } });
    if (owned) throw new HttpError(409, "USER_OWNS_LABS", "Deactivate the user instead (owns labs)");
    await prisma.user.delete({ where: { id: req.params.id } });
    await audit(req.user!.id, "user_deleted", "user", req.params.id);
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------- الفصول
adminRouter.post("/classrooms", ah(async (req, res) => {
  const { name } = parse(z.object({ name: z.string().min(1).max(60) }), req.body);
  if (await prisma.classroom.findUnique({ where: { name } })) throw new HttpError(409, "NAME_TAKEN");
  res.status(201).json({ classroom: await prisma.classroom.create({ data: { name } }) });
}));
adminRouter.patch("/classrooms/:id", ah(async (req, res) => {
  const { name } = parse(z.object({ name: z.string().min(1).max(60) }), req.body);
  res.json({ classroom: await prisma.classroom.update({ where: { id: req.params.id }, data: { name } }) });
}));
adminRouter.delete("/classrooms/:id", ah(async (req, res) => {
  await prisma.classroom.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- الأجهزة
const DeviceBody = z.object({
  name: z.string().min(2),
  driver: z.enum(["MOCK", "MQTT"]),
  topic: z.string().regex(/^[a-z0-9_-]{2,40}$/),
  videoUrl: z.string().url().nullable().optional(),
  slotMinutes: z.number().int().min(5).max(120).default(15),
  maintenance: z.boolean().default(false),
  limits: z
    .object({
      voltage: z.object({ min: z.number(), max: z.number() }),
      maxCurrentMa: z.number().positive(),
      loads: z.array(z.enum(["R100", "R220", "R470", "RC", "DIODE"])).min(1),
      maxCommandsPerSec: z.number().int().min(1).max(50),
      openHour: z.number().int().min(0).max(23).optional(),
      closeHour: z.number().int().min(1).max(24).optional(),
    })
    .default(DEFAULT_LIMITS as never),
});

adminRouter.post("/devices", ah(async (req, res) => {
  const b = parse(DeviceBody, req.body);
  if (await prisma.device.findUnique({ where: { topic: b.topic } })) throw new HttpError(409, "TOPIC_TAKEN");
  const d = await prisma.device.create({ data: { ...b, limits: b.limits as object } });
  await reloadDevice(d.id);
  await audit(req.user!.id, "device_created", "device", d.id);
  res.status(201).json({ device: d });
}));
adminRouter.patch("/devices/:id", ah(async (req, res) => {
  const b = parse(DeviceBody.partial(), req.body);
  const d = await prisma.device.update({ where: { id: req.params.id }, data: { ...b, limits: b.limits as object | undefined } });
  await reloadDevice(d.id);
  await audit(req.user!.id, "device_updated", "device", d.id, { fields: Object.keys(b) });
  res.json({ device: d });
}));
adminRouter.delete("/devices/:id", ah(async (req, res) => {
  await removeDevice(req.params.id);
  await prisma.device.delete({ where: { id: req.params.id } });
  await audit(req.user!.id, "device_deleted", "device", req.params.id);
  res.json({ ok: true });
}));

/** إيقاف طارئ من المدير + إنهاء الجلسة الجارية */
adminRouter.post("/devices/:id/estop", ah(async (req, res) => {
  const drv = getDriver(req.params.id);
  if (!drv) throw new HttpError(404, "DEVICE_NOT_FOUND");
  await drv.send({ name: "emergency_stop", params: {} });
  const active = await prisma.booking.findFirst({ where: { deviceId: req.params.id, status: "ACTIVE" } });
  if (active) await endSession(active.id, "admin_estop");
  await audit(req.user!.id, "admin_estop", "device", req.params.id);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- السجلات
adminRouter.get("/logs/audit", ah(async (req, res) => {
  const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: Math.min(500, Number(req.query.limit ?? 100)), include: { user: { select: { name: true, email: true } } } });
  res.json({ logs });
}));
adminRouter.get("/logs/commands", ah(async (req, res) => {
  const logs = await prisma.commandLog.findMany({
    where: req.query.deviceId ? { deviceId: String(req.query.deviceId) } : {},
    orderBy: { createdAt: "desc" },
    take: Math.min(500, Number(req.query.limit ?? 100)),
    include: { device: { select: { name: true } } },
  });
  const users = await prisma.user.findMany({ where: { id: { in: logs.map((l) => l.userId).filter(Boolean) as string[] } }, select: { id: true, name: true } });
  const um = new Map(users.map((u) => [u.id, u.name]));
  res.json({ logs: logs.map((l) => ({ ...l, userName: l.userId ? um.get(l.userId) ?? null : null })) });
}));
