// ============================================================================
//  ⭐ قلب المسار الإجباري: حالة المراحل والحراسة (guards) — كلها في الخادم.
//  لا يوجد أي مسار API يفتح المرحلة 2 أو 3 دون المرور من هذه الدوال.
// ============================================================================
import type { Lab, Progress } from "../generated/prisma/client";
import { prisma } from "../db";
import { HttpError } from "../lib/http";

export async function getOrCreateProgress(userId: string, labId: string): Promise<Progress> {
  return prisma.progress.upsert({ where: { userId_labId: { userId, labId } }, create: { userId, labId }, update: {} });
}

export const attemptsAllowed = (lab: Lab, p: Progress) => lab.maxAttempts + p.extraAttempts;

export function cooldownUntil(lab: Lab, p: Progress): Date | null {
  if (!p.quizLastSubmittedAt || lab.cooldownMinutes <= 0) return null;
  const until = new Date(p.quizLastSubmittedAt.getTime() + lab.cooldownMinutes * 60_000);
  return until.getTime() > Date.now() ? until : null;
}

export type Stage2State = "locked" | "available" | "passed" | "failed_final";

/** ملخص حالة المسار للواجهة (للعرض فقط؛ القرار الفعلي في الـ guards أدناه) */
export function stageStatus(lab: Lab, p: Progress) {
  const allowed = attemptsAllowed(lab, p);
  const stage1Done = !!p.stage1CompletedAt && p.stage1Percent === 100;
  let s2: Stage2State = "locked";
  if (stage1Done) {
    if (p.quizPassedAt) s2 = "passed";
    else if (p.quizAttemptsUsed >= allowed) s2 = "failed_final";
    else s2 = "available";
  }
  const cd = cooldownUntil(lab, p);
  return {
    stage1: { state: stage1Done ? "completed" : "in_progress", percent: p.stage1Percent },
    stage2: {
      state: s2,
      attemptsUsed: p.quizAttemptsUsed,
      attemptsAllowed: allowed,
      attemptsLeft: Math.max(0, allowed - p.quizAttemptsUsed),
      bestPercent: p.quizBestPercent,
      threshold: lab.passThreshold,
      cooldownUntil: s2 === "available" && cd ? cd.toISOString() : null,
      /** التصحيح يُعرض بعد المحاولة الأخيرة فقط */
      reviewAvailable: p.quizAttemptsUsed >= allowed && p.quizAttemptsUsed > 0,
    },
    stage3: {
      state: p.remoteCompletedAt ? "completed" : p.remoteUnlockedAt ? "available" : "locked",
    },
  };
}

/** حراسة المرحلة 2: تتطلب إتمام المرحلة 1 بنسبة 100% */
export function assertStage2Open(p: Progress) {
  if (!p.stage1CompletedAt || p.stage1Percent < 100) {
    throw new HttpError(403, "STAGE_LOCKED", "Complete the virtual lab (100%) first", { stage: 2, reason: "STAGE1_INCOMPLETE" });
  }
}

/** حراسة المرحلة 3: تتطلب النجاح في الكويز (وفق عتبة الأستاذ عند التصحيح) */
export function assertStage3Open(p: Progress) {
  if (!p.remoteUnlockedAt) {
    throw new HttpError(403, "STAGE_LOCKED", "Pass the quiz first", { stage: 3, reason: "QUIZ_NOT_PASSED" });
  }
}

export async function loadLabOr404(idOrSlug: string): Promise<Lab> {
  const lab = await prisma.lab.findFirst({ where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] } });
  if (!lab) throw new HttpError(404, "LAB_NOT_FOUND");
  return lab;
}
