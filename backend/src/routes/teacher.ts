// لوحة الأستاذ: جدول الطلبة، المراحل، تصدير CSV/Excel، منح محاولات إضافية
import { Router } from "express";
import ExcelJS from "exceljs";
import { z } from "zod";
import { prisma } from "../db";
import { ah, HttpError, parse } from "../lib/http";
import { audit } from "../lib/audit";
import { authenticate, requireRole } from "../middleware/auth";
import { loadLabOr404, stageStatus } from "../labs/stages";
import { assertCanManage } from "./labs";
import type { Lab } from "../generated/prisma/client";

export const teacherRouter = Router();
teacherRouter.use(authenticate, requireRole("TEACHER"));

type Stage = "stage1" | "stage2" | "stage3" | "done";

async function labResults(lab: Lab) {
  const links = await prisma.labClassroom.findMany({ where: { labId: lab.id } });
  const students = await prisma.user.findMany({
    where: { role: "STUDENT", active: true, ...(links.length ? { classroomId: { in: links.map((l) => l.classroomId) } } : {}) },
    include: { classroom: true },
    orderBy: { name: "asc" },
  });
  const progress = await prisma.progress.findMany({ where: { labId: lab.id } });
  const pm = new Map(progress.map((p) => [p.userId, p]));
  const samples = await prisma.remoteSample.groupBy({ by: ["userId"], where: { labId: lab.id }, _count: { _all: true } });
  const sm = new Map(samples.map((s) => [s.userId, s._count._all]));
  return students.map((s) => {
    const p = pm.get(s.id);
    const st = p ? stageStatus(lab, p) : null;
    const stage: Stage = !p || !p.stage1CompletedAt ? "stage1" : !p.quizPassedAt ? "stage2" : !p.remoteCompletedAt ? "stage3" : "done";
    return {
      studentId: s.id,
      name: s.name,
      email: s.email,
      classroom: s.classroom?.name ?? "",
      stage,
      stage1Percent: p?.stage1Percent ?? 0,
      quizAttemptsUsed: p?.quizAttemptsUsed ?? 0,
      attemptsAllowed: p ? st!.stage2.attemptsAllowed : lab.maxAttempts,
      quizBestPercent: p?.quizBestPercent ?? null,
      quizPassed: !!p?.quizPassedAt,
      remoteUnlocked: !!p?.remoteUnlockedAt,
      remoteCompleted: !!p?.remoteCompletedAt,
      remotePoints: sm.get(s.id) ?? 0,
      lastActivity: p?.updatedAt ?? null,
    };
  });
}

async function myLab(req: any) {
  const lab = await loadLabOr404(req.params.id);
  assertCanManage(req.user, lab);
  return lab;
}

teacherRouter.get(
  "/overview",
  ah(async (req, res) => {
    const u = req.user!;
    const labs = await prisma.lab.findMany({ where: u.role === "ADMIN" ? {} : { ownerId: u.id }, orderBy: { createdAt: "asc" } });
    const out = [];
    for (const l of labs) {
      const rows = await labResults(l);
      out.push({
        id: l.id,
        slug: l.slug,
        titleAr: l.titleAr,
        titleFr: l.titleFr,
        published: l.published,
        total: rows.length,
        funnel: { stage1: rows.filter((r) => r.stage === "stage1").length, stage2: rows.filter((r) => r.stage === "stage2").length, stage3: rows.filter((r) => r.stage === "stage3").length, done: rows.filter((r) => r.stage === "done").length },
        avgQuiz: rows.filter((r) => r.quizBestPercent !== null).reduce((a, r, _, arr) => a + (r.quizBestPercent as number) / arr.length, 0),
      });
    }
    res.json({ labs: out });
  }),
);

teacherRouter.get("/labs/:id/results", ah(async (req, res) => res.json({ rows: await labResults(await myLab(req)) })));

/** تفاصيل طالب: محاولات الكويز والتقارير والحجوزات */
teacherRouter.get(
  "/labs/:id/students/:userId",
  ah(async (req, res) => {
    const lab = await myLab(req);
    const [attempts, reports, bookings, progress] = await Promise.all([
      prisma.quizAttempt.findMany({ where: { labId: lab.id, userId: req.params.userId }, orderBy: { number: "asc" }, select: { id: true, number: true, status: true, percent: true, passed: true, startedAt: true, submittedAt: true } }),
      prisma.report.findMany({ where: { labId: lab.id, userId: req.params.userId }, orderBy: { createdAt: "desc" }, select: { id: true, kind: true, createdAt: true } }),
      prisma.booking.findMany({ where: { labId: lab.id, userId: req.params.userId }, orderBy: { startsAt: "desc" } }),
      prisma.progress.findUnique({ where: { userId_labId: { userId: req.params.userId, labId: lab.id } } }),
    ]);
    res.json({ attempts, reports, bookings, progress: progress ? stageStatus(lab, progress) : null });
  }),
);

/** منح محاولات إضافية لطالب استنفد محاولاته */
teacherRouter.post(
  "/labs/:id/students/:userId/extra-attempts",
  ah(async (req, res) => {
    const lab = await myLab(req);
    const { count } = parse(z.object({ count: z.number().int().min(1).max(10) }), req.body);
    const p = await prisma.progress.findUnique({ where: { userId_labId: { userId: req.params.userId, labId: lab.id } } });
    if (!p) throw new HttpError(404, "PROGRESS_NOT_FOUND");
    const upd = await prisma.progress.update({ where: { id: p.id }, data: { extraAttempts: { increment: count } } });
    await audit(req.user!.id, "extra_attempts_granted", "progress", p.id, { count, userId: req.params.userId });
    res.json({ stage2: stageStatus(lab, upd).stage2 });
  }),
);

// ---------------------------------------------------------------------------
//  التصدير
// ---------------------------------------------------------------------------
const STAGE_LABEL = {
  fr: { stage1: "TP virtuel", stage2: "Quiz", stage3: "TP à distance", done: "Terminé" },
  ar: { stage1: "TP افتراضي", stage2: "الكويز", stage3: "التحكم عن بُعد", done: "مكتمل" },
};
const HEAD = {
  fr: ["Nom", "Email", "Classe", "Étape actuelle", "TP virtuel (%)", "Tentatives quiz", "Meilleur score quiz (%)", "Quiz réussi", "TP distance débloqué", "TP distance terminé", "Points mesurés à distance"],
  ar: ["الاسم", "البريد", "الفصل", "المرحلة الحالية", "المرحلة 1 (%)", "محاولات الكويز", "أفضل نتيجة (%)", "نجاح الكويز", "فتح المرحلة 3", "إتمام المرحلة 3", "نقاط القياس عن بُعد"],
};
const yn = (b: boolean, l: "fr" | "ar") => (b ? (l === "fr" ? "Oui" : "نعم") : l === "fr" ? "Non" : "لا");

async function tableFor(req: any) {
  const lab = await myLab(req);
  const l = req.user.locale as "fr" | "ar";
  const rows = await labResults(lab);
  const table = rows.map((r) => [r.name, r.email, r.classroom, STAGE_LABEL[l][r.stage], r.stage1Percent, `${r.quizAttemptsUsed}/${r.attemptsAllowed}`, r.quizBestPercent ?? "", yn(r.quizPassed, l), yn(r.remoteUnlocked, l), yn(r.remoteCompleted, l), r.remotePoints]);
  return { lab, head: HEAD[l], table };
}

teacherRouter.get(
  "/labs/:id/export.csv",
  ah(async (req, res) => {
    const { lab, head, table } = await tableFor(req);
    const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = "﻿" + [head, ...table].map((r) => r.map(esc).join(",")).join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${lab.slug}-results.csv"`);
    res.send(csv);
  }),
);

teacherRouter.get(
  "/labs/:id/export.xlsx",
  ah(async (req, res) => {
    const { lab, head, table } = await tableFor(req);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Results", { views: [{ rightToLeft: req.user!.locale === "ar" }] });
    ws.addRow(head).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F4C81" } };
    table.forEach((r) => ws.addRow(r));
    ws.columns.forEach((c) => (c.width = 22));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${lab.slug}-results.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  }),
);
