// ============================================================================
//  بوابة Socket.io للتحكم عن بُعد.
//  كل حدث حسّاس يعيد التحقق من الصفر: الجلسة ACTIVE، صاحبها، لم ينتهِ وقتها، والمرحلة 3 مفتوحة.
//  الأحداث (عميل → خادم): session:join, device:command, device:record, session:end, queue:watch
//  الأحداث (خادم → عميل): telemetry, command:log, session:ended, session:started, notification, queue:changed
// ============================================================================
import type { Server as HttpServer } from "http";
import { Server, type Socket } from "socket.io";
import type { User } from "../generated/prisma/client";
import { prisma } from "../db";
import { config } from "../config";
import { audit } from "../lib/audit";
import { verifyToken } from "../lib/jwt";
import { setIO } from "../lib/realtime";
import { assertStage3Open, getOrCreateProgress } from "../labs/stages";
import { getDef } from "../routes/labs";
import { deviceBus, getDriver, limitsOf } from "./deviceManager";
import { rateLimited, validateCommand } from "./safety";
import { activeByDevice, endSession } from "./sessions";
import type { Telemetry } from "./types";

const MAX_SAMPLES_PER_SESSION = 60;

type Ack = (r: unknown) => void;
const fail = (ack: Ack | undefined, code: string, extra: object = {}) => ack?.({ ok: false, error: code, ...extra });

export function attachGateway(http: HttpServer) {
  const io = new Server(http, { cors: { origin: config.corsOrigin, credentials: true } });
  setIO(io);

  // المصادقة عند الاتصال (JWT)
  io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth?.token as string) ?? "";
      const p = verifyToken(token);
      const user = await prisma.user.findUnique({ where: { id: p.sub } });
      if (!user || !user.active) return next(new Error("UNAUTHENTICATED"));
      socket.data.user = user;
      next();
    } catch {
      next(new Error("UNAUTHENTICATED"));
    }
  });

  /** يتحقق من أن الحجز نشط ويخص المستخدم ولم ينتهِ، وأن المرحلة 3 مفتوحة (⭐ قفل الخادم) */
  async function activeBooking(user: User, bookingId: unknown) {
    if (typeof bookingId !== "string") throw new Error("INVALID_BOOKING");
    const b = await prisma.booking.findUnique({ where: { id: bookingId }, include: { lab: true, device: true } });
    if (!b || b.userId !== user.id) throw new Error("BOOKING_NOT_FOUND");
    if (b.status !== "ACTIVE" || b.endsAt.getTime() <= Date.now()) throw new Error("SESSION_NOT_ACTIVE");
    assertStage3Open(await getOrCreateProgress(user.id, b.labId));
    return b;
  }

  io.on("connection", (socket: Socket) => {
    const user = socket.data.user as User;
    socket.join(`user:${user.id}`);

    socket.on("queue:watch", (deviceId: string) => typeof deviceId === "string" && socket.join(`device:${deviceId}`));

    socket.on("session:join", async (msg: { bookingId?: string }, ack?: Ack) => {
      try {
        const b = await activeBooking(user, msg?.bookingId);
        const remote = getDef(b.lab).remote;
        if (!remote) return fail(ack, "NO_REMOTE_CONFIG");
        socket.join(`session:${b.id}`);
        if (!b.joinedAt) await prisma.booking.update({ where: { id: b.id }, data: { joinedAt: new Date() } });
        const lim = limitsOf(b.device);
        const samples = await prisma.remoteSample.findMany({ where: { bookingId: b.id }, orderBy: { createdAt: "asc" } });
        const commands = await prisma.commandLog.findMany({ where: { bookingId: b.id }, orderBy: { createdAt: "desc" }, take: 20 });
        ack?.({
          ok: true,
          booking: { id: b.id, startsAt: b.startsAt, endsAt: b.endsAt, labId: b.labId },
          serverTime: Date.now(),
          remote,
          limits: { voltage: { min: lim.voltage.min, max: Math.min(lim.voltage.max, remote.voltageMax ?? Infinity) }, maxCurrentMa: lim.maxCurrentMa },
          hasVideo: !!b.device.videoUrl,
          online: getDriver(b.deviceId)?.isOnline() ?? false,
          telemetry: getDriver(b.deviceId)?.latest() ?? null,
          samples: samples.map((s) => ({ id: s.id, at: s.createdAt, values: s.values })),
          commands: commands.reverse(),
        });
      } catch (e) {
        fail(ack, (e as { code?: string; message: string }).code ?? (e as Error).message);
      }
    });

    /** أمر تحكم: تحقق → حدود أمان → سجل تدقيق → إرسال إلى الجهاز */
    socket.on("device:command", async (msg: { bookingId?: string; name?: string; params?: object }, ack?: Ack) => {
      let deviceId = "";
      let bookingId: string | null = null;
      const log = async (name: string, params: object, accepted: boolean, reason?: string) => {
        const row = await prisma.commandLog.create({ data: { bookingId, userId: user.id, deviceId, name, params, accepted, reason } });
        if (bookingId) io.to(`session:${bookingId}`).emit("command:log", row);
      };
      try {
        const b = await activeBooking(user, msg?.bookingId);
        deviceId = b.deviceId;
        bookingId = b.id;
        const driver = getDriver(b.deviceId);
        if (!driver || !driver.isOnline()) {
          await log(String(msg?.name), msg?.params ?? {}, false, "DEVICE_OFFLINE");
          return fail(ack, "DEVICE_OFFLINE");
        }
        const lim = limitsOf(b.device);
        const remote = getDef(b.lab).remote!;
        // الإيقاف الطارئ لا يخضع لتحديد المعدل
        if (msg?.name !== "emergency_stop" && rateLimited(b.id, lim.maxCommandsPerSec)) {
          await log(String(msg?.name), msg?.params ?? {}, false, "RATE_LIMITED");
          return fail(ack, "RATE_LIMITED");
        }
        const v = validateCommand(lim, { load: remote.load, voltageMax: remote.voltageMax }, { name: msg?.name, params: msg?.params }, driver.latest());
        if (!v.ok || !v.cmd) {
          await log(String(msg?.name), msg?.params ?? {}, false, v.reason);
          return fail(ack, v.reason ?? "REJECTED");
        }
        await driver.send(v.cmd);
        await log(v.cmd.name, v.cmd.params, true);
        ack?.({ ok: true, cmd: v.cmd });
      } catch (e) {
        fail(ack, (e as { code?: string; message: string }).code ?? (e as Error).message);
      }
    });

    /** تسجيل نقطة: القيم تؤخذ من آخر قياس حقيقي في الخادم (لا يمكن تزويرها من العميل) */
    socket.on("device:record", async (msg: { bookingId?: string }, ack?: Ack) => {
      try {
        const b = await activeBooking(user, msg?.bookingId);
        const driver = getDriver(b.deviceId);
        const t = driver?.latest();
        if (!driver || !driver.isOnline() || !t || Date.now() - t.ts > 2000) return fail(ack, "DEVICE_OFFLINE");
        if (t.estop || t.tripped) return fail(ack, "DEVICE_NOT_READY");
        if (!t.switchOn && t.load !== "RC") return fail(ack, "OUTPUT_OFF");
        const count = await prisma.remoteSample.count({ where: { bookingId: b.id } });
        if (count >= MAX_SAMPLES_PER_SESSION) return fail(ack, "TOO_MANY_SAMPLES");
        const values = { voltage: t.voltage, vLoad: t.vLoad, current: t.current, power: t.power, temp: t.temp, tSwitch: t.tSwitch, switchOn: t.switchOn ? 1 : 0 };
        const row = await prisma.remoteSample.create({ data: { bookingId: b.id, userId: user.id, labId: b.labId, values } });
        const total = await prisma.remoteSample.count({ where: { userId: user.id, labId: b.labId } });
        ack?.({ ok: true, sample: { id: row.id, at: row.createdAt, values }, total });
      } catch (e) {
        fail(ack, (e as { code?: string; message: string }).code ?? (e as Error).message);
      }
    });

    socket.on("session:end", async (msg: { bookingId?: string }, ack?: Ack) => {
      try {
        const b = await activeBooking(user, msg?.bookingId);
        await endSession(b.id, "student_ended");
        ack?.({ ok: true });
      } catch (e) {
        fail(ack, (e as Error).message);
      }
    });

    // انقطاع اتصال الطالب لا يُنهي الجلسة (يمكنه العودة) — يُنهيها المؤقّت تلقائياً
  });

  // بث القياسات إلى غرفة الجلسة النشطة على ذلك الجهاز
  deviceBus.on("telemetry", (deviceId: string, t: Telemetry) => {
    const bid = activeByDevice.get(deviceId);
    if (bid) io.to(`session:${bid}`).volatile.emit("telemetry", t);
  });

  // فصل تلقائي من الجهاز → سجل تدقيق + تنبيه للجلسة
  deviceBus.on("trip", async (deviceId: string, reason: string) => {
    const bid = activeByDevice.get(deviceId) ?? null;
    await prisma.commandLog.create({ data: { bookingId: bid, deviceId, name: "auto_trip", params: {}, accepted: true, reason } }).catch(() => undefined);
    await audit(null, "device_trip", "device", deviceId, { reason });
    if (bid) io.to(`session:${bid}`).emit("device:trip", { reason });
  });

  // تحديث lastSeenAt كل 10 ثوانٍ
  setInterval(async () => {
    const devices = await prisma.device.findMany({ select: { id: true } }).catch(() => []);
    for (const d of devices) if (getDriver(d.id)?.isOnline()) await prisma.device.update({ where: { id: d.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }, 10_000).unref();

  return io;
}
