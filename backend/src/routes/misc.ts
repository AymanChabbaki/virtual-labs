// تقارير + إشعارات + لوحة الطالب
import { Router } from "express";
import fs from "fs";
import path from "path";
import { z } from "zod";
import { prisma } from "../db";
import { config } from "../config";
import { ah, HttpError, parse } from "../lib/http";
import { authenticate } from "../middleware/auth";
import { stageStatus } from "../labs/stages";

export const reportsRouter = Router();
reportsRouter.use(authenticate);

reportsRouter.get(
  "/",
  ah(async (req, res) => {
    const u = req.user!;
    const labId = typeof req.query.labId === "string" ? req.query.labId : undefined;
    const where = u.role === "STUDENT" ? { userId: u.id, ...(labId ? { labId } : {}) } : { lab: u.role === "ADMIN" ? {} : { ownerId: u.id }, ...(labId ? { labId } : {}) };
    const reports = await prisma.report.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { lab: { select: { id: true, slug: true, titleAr: true, titleFr: true } }, user: { select: { id: true, name: true } } },
    });
    res.json({ reports: reports.map(({ filePath: _f, ...r }) => r) });
  }),
);

reportsRouter.get(
  "/:id/download",
  ah(async (req, res) => {
    const u = req.user!;
    const r = await prisma.report.findUnique({ where: { id: req.params.id }, include: { lab: true } });
    if (!r) throw new HttpError(404, "REPORT_NOT_FOUND");
    const allowed = r.userId === u.id || u.role === "ADMIN" || (u.role === "TEACHER" && r.lab.ownerId === u.id);
    if (!allowed) throw new HttpError(403, "FORBIDDEN");
    const abs = path.resolve(config.storageDir, r.filePath);
    if (!abs.startsWith(config.storageDir) || !fs.existsSync(abs)) throw new HttpError(404, "FILE_MISSING");
    res.download(abs, `${r.lab.slug}-${r.kind.toLowerCase()}-${r.createdAt.toISOString().slice(0, 10)}.pdf`);
  }),
);

// ---------------------------------------------------------------------------
export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

notificationsRouter.get(
  "/",
  ah(async (req, res) => {
    const list = await prisma.notification.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: "desc" }, take: 50 });
    res.json({ notifications: list, unread: list.filter((n) => !n.readAt).length });
  }),
);

notificationsRouter.post(
  "/read",
  ah(async (req, res) => {
    const d = parse(z.object({ ids: z.array(z.string()).optional() }), req.body ?? {});
    await prisma.notification.updateMany({ where: { userId: req.user!.id, readAt: null, ...(d.ids ? { id: { in: d.ids } } : {}) }, data: { readAt: new Date() } });
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
export const studentRouter = Router();
studentRouter.use(authenticate);

/** لوحة الطالب: تقدّم كل TP + نتائج الكويزات + الحصص القادمة */
studentRouter.get(
  "/dashboard",
  ah(async (req, res) => {
    const u = req.user!;
    if (u.role !== "STUDENT") throw new HttpError(403, "FORBIDDEN");
    const labs = await prisma.lab.findMany({
      where: { published: true, OR: [{ classrooms: { none: {} } }, ...(u.classroomId ? [{ classrooms: { some: { classroomId: u.classroomId } } }] : [])] },
      orderBy: { createdAt: "asc" },
    });
    const progress = await prisma.progress.findMany({ where: { userId: u.id } });
    const pm = new Map(progress.map((p) => [p.labId, p]));
    const empty = (labId: string) => ({ id: "", userId: u.id, labId, stage1Percent: 0, stage1Steps: {}, stage1Points: [], stage1Draft: null, stage1CompletedAt: null, quizAttemptsUsed: 0, extraAttempts: 0, quizBestPercent: null, quizLastSubmittedAt: null, quizPassedAt: null, remoteUnlockedAt: null, remoteCompletedAt: null, updatedAt: new Date() });
    const [attempts, bookings, unread] = await Promise.all([
      prisma.quizAttempt.findMany({ where: { userId: u.id, status: { not: "IN_PROGRESS" } }, orderBy: { submittedAt: "desc" }, take: 8, include: { lab: { select: { titleAr: true, titleFr: true, slug: true } } } }),
      prisma.booking.findMany({ where: { userId: u.id, status: { in: ["BOOKED", "ACTIVE"] }, endsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" }, take: 10, include: { lab: { select: { titleAr: true, titleFr: true, slug: true } } } }),
      prisma.notification.count({ where: { userId: u.id, readAt: null } }),
    ]);
    res.json({
      labs: labs.map((l) => ({ id: l.id, slug: l.slug, titleAr: l.titleAr, titleFr: l.titleFr, simulator: (l.definition as any)?.simulator, status: stageStatus(l, (pm.get(l.id) ?? empty(l.id)) as any) })),
      quizResults: attempts.map((a) => ({ id: a.id, lab: a.lab, number: a.number, percent: a.percent, passed: a.passed, submittedAt: a.submittedAt })),
      upcomingBookings: bookings,
      unreadNotifications: unread,
    });
  }),
);
