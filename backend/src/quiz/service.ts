// ============================================================================
//  محرّك الكويز: بدء المحاولة (خلط، مؤقّت، عدد محاولات، cooldown) + التصحيح + فتح المرحلة 3
// ============================================================================
import type { Lab, Question, QuizAttempt, User } from "../generated/prisma/client";
import { prisma } from "../db";
import { HttpError } from "../lib/http";
import { withLock } from "../lib/lock";
import { notify } from "../lib/notify";
import { assertStage2Open, attemptsAllowed, cooldownUntil, getOrCreateProgress, stageStatus } from "../labs/stages";
import { correctAnswerView, gradeQuestion, sanitizeQuestion } from "./grading";

const GRACE_MS = 10_000; // سماح بسيط لزمن الشبكة عند الإرسال

function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

type Served = { q: string; c?: string[] }[];

/** يجهّز عرض المحاولة للطالب (أسئلة مخلوطة بدون إجابات صحيحة) */
async function attemptView(a: QuizAttempt) {
  const served = a.served as unknown as Served;
  const qs = await prisma.question.findMany({ where: { id: { in: served.map((s) => s.q) } } });
  const byId = new Map(qs.map((q) => [q.id, q]));
  return {
    id: a.id,
    number: a.number,
    startedAt: a.startedAt,
    deadlineAt: a.deadlineAt,
    status: a.status,
    answers: a.answers,
    questions: served.map((s) => sanitizeQuestion(byId.get(s.q)!, s.c)),
  };
}

/** تصحيح محاولة وتحديث التقدّم (ينفَّذ داخل قفل المستخدم/التجربة) */
async function finalize(attempt: QuizAttempt, lab: Lab, answers: Record<string, unknown>, expired: boolean) {
  const served = attempt.served as unknown as Served;
  const qs = await prisma.question.findMany({ where: { id: { in: served.map((s) => s.q) } } });
  const byId = new Map(qs.map((q) => [q.id, q]));
  let score = 0,
    max = 0;
  const per: Record<string, { earned: number; max: number; correct: boolean }> = {};
  for (const s of served) {
    const q = byId.get(s.q);
    if (!q) continue;
    const g = gradeQuestion(q, answers[q.id]);
    score += g.earned;
    max += g.max;
    per[q.id] = g;
  }
  const percent = max ? Math.round((score / max) * 100) : 0;
  const passed = max > 0 && (score / max) * 100 >= lab.passThreshold - 1e-9;

  return withLock(`quiz:${attempt.userId}:${lab.id}`, async (tx) => {
    const fresh = await tx.quizAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    if (fresh.status !== "IN_PROGRESS") throw new HttpError(409, "ALREADY_SUBMITTED");
    const now = new Date();
    const upd = await tx.quizAttempt.update({
      where: { id: attempt.id },
      data: { status: expired ? "EXPIRED" : "SUBMITTED", submittedAt: now, answers: answers as object, score, maxScore: max, percent, passed },
    });
    const p = await tx.progress.findUniqueOrThrow({ where: { userId_labId: { userId: attempt.userId, labId: lab.id } } });
    const unlocking = passed && !p.quizPassedAt;
    const progress = await tx.progress.update({
      where: { id: p.id },
      data: {
        quizLastSubmittedAt: now,
        quizBestPercent: Math.max(p.quizBestPercent ?? 0, percent),
        ...(unlocking ? { quizPassedAt: now, remoteUnlockedAt: now } : {}),
      },
    });
    return { attempt: upd, progress, per, unlocking };
  });
}

/** يغلق كل المحاولات المنتهية مهلتها (يُستدعى من المجدوِل وعند بدء محاولة جديدة) */
export async function finalizeExpiredAttempts(userId?: string) {
  const list = await prisma.quizAttempt.findMany({
    where: { status: "IN_PROGRESS", deadlineAt: { lt: new Date(Date.now() - GRACE_MS) }, ...(userId ? { userId } : {}) },
    include: { lab: true },
  });
  for (const a of list) {
    try {
      const r = await finalize(a, a.lab, (a.answers ?? {}) as Record<string, unknown>, true);
      await afterFinalize(a.userId, a.lab, r);
    } catch (e) {
      if (!(e instanceof HttpError)) console.warn("[quiz] finalize expired failed", (e as Error).message);
    }
  }
}

async function afterFinalize(userId: string, lab: Lab, r: Awaited<ReturnType<typeof finalize>>) {
  if (r.unlocking) await notify(userId, "stage3_unlocked", { lab: lab.titleFr, labAr: lab.titleAr, labId: lab.id });
  else if (!r.attempt.passed) await notify(userId, "quiz_failed", { lab: lab.titleFr, labAr: lab.titleAr, labId: lab.id, percent: r.attempt.percent ?? 0 });
}

export async function startAttempt(user: User, lab: Lab) {
  await finalizeExpiredAttempts(user.id);
  const progress0 = await getOrCreateProgress(user.id, lab.id);
  assertStage2Open(progress0); // ⭐ القفل: يلزم إتمام المرحلة 1 بنسبة 100%

  return withLock(`quiz:${user.id}:${lab.id}`, async (tx) => {
    const p = await tx.progress.findUniqueOrThrow({ where: { id: progress0.id } });
    assertStage2Open(p);
    if (p.quizPassedAt) throw new HttpError(409, "ALREADY_PASSED");

    // محاولة جارية؟ نستأنفها بنفس الأسئلة والمؤقّت (يمنع الاستغلال بتحديث الصفحة)
    const running = await tx.quizAttempt.findFirst({ where: { userId: user.id, labId: lab.id, status: "IN_PROGRESS" } });
    if (running) return { attempt: running, resumed: true };

    if (p.quizAttemptsUsed >= attemptsAllowed(lab, p)) throw new HttpError(403, "NO_ATTEMPTS_LEFT");
    const cd = cooldownUntil(lab, p);
    if (cd) throw new HttpError(429, "COOLDOWN", "Retry later", { until: cd.toISOString() });

    let questions: Question[] = await tx.question.findMany({ where: { labId: lab.id } });
    if (!questions.length) throw new HttpError(409, "NO_QUESTIONS");
    questions = shuffle(questions);
    if (lab.quizQuestionCount && lab.quizQuestionCount < questions.length) questions = questions.slice(0, lab.quizQuestionCount);
    const served: Served = questions.map((q) => {
      const p = q.payload as any;
      return q.type === "MCQ" ? { q: q.id, c: shuffle<string>(p.choices.map((c: any) => c.id)) } : { q: q.id };
    });
    const now = new Date();
    const attempt = await tx.quizAttempt.create({
      data: {
        userId: user.id,
        labId: lab.id,
        number: p.quizAttemptsUsed + 1,
        startedAt: now,
        deadlineAt: new Date(now.getTime() + lab.quizTimeLimitSec * 1000),
        served: served as object[],
      },
    });
    // المحاولة تُحتسب عند البدء (يمنع "الهروب" من محاولة فاشلة بإغلاق الصفحة)
    await tx.progress.update({ where: { id: p.id }, data: { quizAttemptsUsed: { increment: 1 } } });
    return { attempt, resumed: false };
  }).then(async (r) => ({ ...(await attemptView(r.attempt)), resumed: r.resumed }));
}

export async function saveAnswers(user: User, attemptId: string, answers: Record<string, unknown>) {
  const a = await prisma.quizAttempt.findUnique({ where: { id: attemptId } });
  if (!a || a.userId !== user.id) throw new HttpError(404, "ATTEMPT_NOT_FOUND");
  if (a.status !== "IN_PROGRESS") throw new HttpError(409, "ALREADY_SUBMITTED");
  if (Date.now() > a.deadlineAt.getTime() + GRACE_MS) throw new HttpError(409, "ATTEMPT_EXPIRED");
  await prisma.quizAttempt.update({ where: { id: a.id }, data: { answers: { ...(a.answers as object), ...answers } as object } });
  return { saved: true };
}

export async function getAttempt(user: User, attemptId: string) {
  await finalizeExpiredAttempts(user.id);
  const a = await prisma.quizAttempt.findUnique({ where: { id: attemptId } });
  if (!a || a.userId !== user.id) throw new HttpError(404, "ATTEMPT_NOT_FOUND");
  return attemptView(a);
}

export async function submitAttempt(user: User, attemptId: string, answers: Record<string, unknown>) {
  const a = await prisma.quizAttempt.findUnique({ where: { id: attemptId }, include: { lab: true } });
  if (!a || a.userId !== user.id) throw new HttpError(404, "ATTEMPT_NOT_FOUND");
  if (a.status !== "IN_PROGRESS") throw new HttpError(409, "ALREADY_SUBMITTED");
  // بعد انتهاء الوقت (+سماح) نعتمد فقط الإجابات المحفوظة تلقائياً
  const late = Date.now() > a.deadlineAt.getTime() + GRACE_MS;
  const finalAnswers = late ? ((a.answers ?? {}) as Record<string, unknown>) : { ...(a.answers as object), ...answers };
  const r = await finalize(a, a.lab, finalAnswers, late);
  await afterFinalize(user.id, a.lab, r);

  const status = stageStatus(a.lab, r.progress);
  const out: Record<string, unknown> = {
    attemptId: a.id,
    number: a.number,
    expired: late,
    percent: r.attempt.percent,
    score: r.attempt.score,
    maxScore: r.attempt.maxScore,
    passed: r.attempt.passed,
    threshold: a.lab.passThreshold,
    stage2: status.stage2,
    stage3: status.stage3,
  };
  // ⭐ التصحيح يُكشف فقط بعد استنفاد آخر محاولة
  if (status.stage2.reviewAvailable) out.review = await buildReview(a.id);
  return out;
}

/** مراجعة محاولة (تُستدعى فقط عندما تكون المحاولات مستنفدة) */
async function buildReview(attemptId: string) {
  const a = await prisma.quizAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  const served = a.served as unknown as Served;
  const qs = await prisma.question.findMany({ where: { id: { in: served.map((s) => s.q) } } });
  const byId = new Map(qs.map((q) => [q.id, q]));
  const answers = (a.answers ?? {}) as Record<string, unknown>;
  return served.map((s) => {
    const q = byId.get(s.q)!;
    const g = gradeQuestion(q, answers[q.id]);
    return {
      question: sanitizeQuestion(q, s.c),
      given: answers[q.id] ?? null,
      correctAnswer: correctAnswerView(q),
      correct: g.correct,
      earned: g.earned,
      max: g.max,
      explanationAr: q.explanationAr,
      explanationFr: q.explanationFr,
    };
  });
}

/** آخر مراجعة متاحة (بعد المحاولة الأخيرة فقط) */
export async function lastReview(user: User, lab: Lab) {
  const p = await getOrCreateProgress(user.id, lab.id);
  const st = stageStatus(lab, p);
  if (!st.stage2.reviewAvailable) throw new HttpError(403, "REVIEW_LOCKED", "Correction is available after the last attempt only");
  const last = await prisma.quizAttempt.findFirst({ where: { userId: user.id, labId: lab.id, status: { not: "IN_PROGRESS" } }, orderBy: { number: "desc" } });
  if (!last) throw new HttpError(404, "ATTEMPT_NOT_FOUND");
  return { attemptId: last.id, percent: last.percent, review: await buildReview(last.id) };
}

/** حالة الكويز للطالب: المحاولة الجارية + سجل المحاولات */
export async function quizStatus(user: User, lab: Lab) {
  await finalizeExpiredAttempts(user.id);
  const p = await getOrCreateProgress(user.id, lab.id);
  const attempts = await prisma.quizAttempt.findMany({
    where: { userId: user.id, labId: lab.id },
    orderBy: { number: "asc" },
    select: { id: true, number: true, status: true, percent: true, passed: true, submittedAt: true, startedAt: true },
  });
  const running = attempts.find((a) => a.status === "IN_PROGRESS");
  const questionCount = Math.min(await prisma.question.count({ where: { labId: lab.id } }), lab.quizQuestionCount ?? Infinity);
  return { ...stageStatus(lab, p), timeLimitSec: lab.quizTimeLimitSec, cooldownMinutes: lab.cooldownMinutes, questionCount, runningAttemptId: running?.id ?? null, attempts };
}
