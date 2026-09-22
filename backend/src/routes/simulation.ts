// ============================================================================
//  المرحلة 1 — TP افتراضي: الخطوات متسلسلة ويعتمدها الخادم فقط بعد التحقق من
//  القيم والقياسات. الإكمال (100%) يتحقق بتوليد التقرير (الخطوة الأخيرة).
// ============================================================================
import { Router } from "express";
import fs from "fs";
import path from "path";
import { z } from "zod";
import type { Lab, Progress, User } from "../generated/prisma/client";
import { prisma } from "../db";
import { ah, HttpError, parse } from "../lib/http";
import { notify } from "../lib/notify";
import { authenticate, requireRole } from "../middleware/auth";
import { computeAll, estimate, pointsForMeasure, validateParams, validatePoint, type Point } from "../labs/engine";
import type { LabDefinition } from "../labs/definition";
import { getOrCreateProgress, loadLabOr404, stageStatus } from "../labs/stages";
import { assertLabAccess, getDef } from "./labs";
import { generateReportPdf, linearFit } from "../reports/pdf";
import { config } from "../config";

export const simulationRouter = Router();
// ⚠️ الحراسة مقيَّدة بالمسار حتى لا تؤثر على بقية مسارات /api/labs
simulationRouter.use("/:id/simulation", authenticate, requireRole("STUDENT"));

type StepsState = Record<string, { done: true; at: string; answer?: number; reference?: number }>;

async function ctx(user: User, idOrSlug: string) {
  const lab = await loadLabOr404(idOrSlug);
  await assertLabAccess(user, lab);
  const def = getDef(lab);
  const progress = await getOrCreateProgress(user.id, lab.id);
  return { lab, def, progress };
}

const stepsOf = (p: Progress) => (p.stage1Steps ?? {}) as StepsState;
const pointsOf = (p: Progress) => (p.stage1Points ?? []) as unknown as Point[];
const currentIndex = (def: LabDefinition, p: Progress) => {
  const s = stepsOf(p);
  const i = def.steps.findIndex((st) => !s[st.id]?.done);
  return i === -1 ? def.steps.length : i;
};
const percentOf = (def: LabDefinition, steps: StepsState) => Math.round((def.steps.filter((s) => steps[s.id]?.done).length / def.steps.length) * 100);

function view(lab: Lab, def: LabDefinition, p: Progress) {
  return {
    percent: p.stage1Percent,
    steps: stepsOf(p),
    points: pointsOf(p),
    draft: p.stage1Draft,
    currentStepIndex: currentIndex(def, p),
    completedAt: p.stage1CompletedAt,
    status: stageStatus(lab, p),
  };
}

// ---------------------------------------------------------------------------
simulationRouter.get(
  "/:id/simulation",
  ah(async (req, res) => {
    const { lab, def, progress } = await ctx(req.user!, req.params.id);
    res.json({ definition: def, progress: view(lab, def, progress) });
  }),
);

/** حفظ تلقائي لحالة الواجهة (المعاملات الحالية، ملاحظات...) — لا يؤثر على القفل */
simulationRouter.put(
  "/:id/simulation/draft",
  ah(async (req, res) => {
    const { progress } = await ctx(req.user!, req.params.id);
    const draft = req.body?.draft ?? null;
    if (JSON.stringify(draft).length > 20_000) throw new HttpError(413, "DRAFT_TOO_LARGE");
    await prisma.progress.update({ where: { id: progress.id }, data: { stage1Draft: draft ?? undefined } });
    res.json({ saved: true, at: new Date().toISOString() });
  }),
);

/** تسجيل نقطة قياس (تُقبل فقط أثناء خطوة قياس، وبعد التحقق من الاتساق مع النموذج) */
simulationRouter.post(
  "/:id/simulation/points",
  ah(async (req, res) => {
    const { def, progress } = await ctx(req.user!, req.params.id);
    const body = parse(z.object({ params: z.record(z.number()), values: z.record(z.number()) }), req.body);
    const step = def.steps[currentIndex(def, progress)];
    if (!step || step.type !== "measure") throw new HttpError(409, "NOT_MEASURE_STEP");
    validatePoint(def, body.params, body.values);

    const points = pointsOf(progress);
    if (points.length >= 200) throw new HttpError(409, "TOO_MANY_POINTS");
    if (points.length) {
      const first = points[0];
      for (const k of step.lock) {
        if (first.params[k] !== body.params[k]) throw new HttpError(409, "LOCKED_PARAM_CHANGED", `Parameter ${k} must stay constant`, { key: k });
      }
    }
    if (points.some((p) => p.params[step.xParam] === body.params[step.xParam] && step.lock.every((k) => p.params[k] === body.params[k])))
      throw new HttpError(409, "DUPLICATE_POINT");
    points.push({ params: body.params, values: body.values, at: new Date().toISOString() });
    await prisma.progress.update({ where: { id: progress.id }, data: { stage1Points: points as object[] } });
    res.status(201).json({ points });
  }),
);

/** مسح النقاط لإعادة القياس (مسموح فقط أثناء خطوة القياس) */
simulationRouter.delete(
  "/:id/simulation/points",
  ah(async (req, res) => {
    const { def, progress } = await ctx(req.user!, req.params.id);
    const step = def.steps[currentIndex(def, progress)];
    if (!step || step.type !== "measure") throw new HttpError(409, "NOT_MEASURE_STEP");
    await prisma.progress.update({ where: { id: progress.id }, data: { stage1Points: [] } });
    res.json({ points: [] });
  }),
);

/** اعتماد خطوة — لا يمكن إلا للخطوة الحالية (لا تخطّي) */
simulationRouter.post(
  "/:id/simulation/steps/:stepId",
  ah(async (req, res) => {
    const { lab, def, progress } = await ctx(req.user!, req.params.id);
    const idx = currentIndex(def, progress);
    const step = def.steps[idx];
    if (!step) throw new HttpError(409, "ALL_STEPS_DONE");
    if (step.id !== req.params.stepId) throw new HttpError(409, "STEP_ORDER", "Steps must be completed in order", { current: step.id });
    if (step.type === "report") throw new HttpError(400, "USE_REPORT_ENDPOINT");

    const body = parse(z.object({ params: z.record(z.number()).optional(), answer: z.union([z.number(), z.string()]).optional() }), req.body ?? {});
    const entry: StepsState[string] = { done: true, at: new Date().toISOString() };
    const points = pointsOf(progress);

    switch (step.type) {
      case "read":
        break;
      case "setup": {
        if (!body.params) throw new HttpError(400, "PARAMS_REQUIRED");
        validateParams(def, body.params);
        for (const [k, v] of Object.entries(step.require)) {
          if (Math.abs(body.params[k] - v) > 1e-9) throw new HttpError(422, "SETUP_MISMATCH", `Parameter ${k} must be ${v}`, { key: k, expected: v });
        }
        break;
      }
      case "measure": {
        const good = pointsForMeasure(step, points);
        if (good.length < step.minPoints) throw new HttpError(422, "NOT_ENOUGH_POINTS", `Need ${step.minPoints} distinct points`, { have: good.length, need: step.minPoints });
        break;
      }
      case "compute": {
        const answer = typeof body.answer === "string" ? Number(body.answer.replace(",", ".")) : body.answer;
        if (answer === undefined || !Number.isFinite(answer)) throw new HttpError(400, "ANSWER_REQUIRED");
        // نقاط أقرب خطوة قياس سابقة
        const prevMeasure = [...def.steps.slice(0, idx)].reverse().find((s) => s.type === "measure");
        const pts = prevMeasure && prevMeasure.type === "measure" ? pointsForMeasure(prevMeasure, points) : points;
        const ref = estimate(step.estimator, pts);
        if (ref === null) throw new HttpError(422, "NO_DATA", "Measurements are not sufficient to compute this quantity");
        const dev = (Math.abs(answer - ref) / Math.abs(ref)) * 100;
        if (dev > step.tolerancePct) throw new HttpError(422, "WRONG_ANSWER", "Value outside tolerance", { tolerancePct: step.tolerancePct });
        entry.answer = answer;
        entry.reference = ref;
        break;
      }
    }

    const steps = { ...stepsOf(progress), [step.id]: entry };
    const upd = await prisma.progress.update({ where: { id: progress.id }, data: { stage1Steps: steps as object, stage1Percent: percentOf(def, steps) } });
    res.json({ progress: view(lab, def, upd) });
  }),
);

// ---------------------------------------------------------------------------
//  الخطوة الأخيرة: توليد تقرير PDF ⇒ المرحلة 1 = 100% ⇒ يُفتح الكويز
// ---------------------------------------------------------------------------
simulationRouter.post(
  "/:id/simulation/report",
  ah(async (req, res) => {
    const user = req.user!;
    const { lab, def, progress } = await ctx(user, req.params.id);
    const steps = stepsOf(progress);
    const reportStep = def.steps.find((s) => s.type === "report")!;
    const others = def.steps.filter((s) => s.id !== reportStep.id);
    if (!others.every((s) => steps[s.id]?.done)) throw new HttpError(409, "STEPS_INCOMPLETE", "Complete all previous steps first");

    const fr = user.locale === "fr";
    const L = (x: { ar: string; fr: string }) => (fr ? x.fr : x.ar);
    const points = pointsOf(progress);
    const measure = [...def.steps].reverse().find((s) => s.type === "measure");
    const pts = measure && measure.type === "measure" ? pointsForMeasure(measure, points) : points;

    // أعمدة الجدول: المتغير على المحور x ثم كل المقادير المقاسة
    const paramX = def.parameters.find((p) => p.key === def.plot.x);
    const columns = [
      ...(paramX ? [{ key: paramX.key, label: L(paramX.label), unit: paramX.unit, decimals: 2 }] : []),
      ...def.outputs.map((o) => ({ key: o.key, label: L(o.label), unit: o.unit, decimals: o.decimals })),
    ];
    const rows = pts.map((p) => ({ ...p.params, ...p.values }));
    const xs = rows.map((r) => r[def.plot.x]);
    const ys = rows.map((r) => r[def.plot.y]);
    const results = def.steps.flatMap((s) =>
      s.type === "compute" && steps[s.id]?.answer !== undefined
        ? [{ label: L(s.quantity), value: `${steps[s.id].answer} ${s.unit}`, note: fr ? `Valeur de référence issue de vos mesures : ${steps[s.id].reference?.toPrecision(4)} ${s.unit}` : undefined }]
        : [],
    );

    const reportId = `${Date.now().toString(36)}-${user.id.slice(-6)}`;
    const file = await generateReportPdf(
      {
        locale: user.locale,
        kind: "VIRTUAL",
        title: fr ? lab.titleFr : lab.titleAr,
        description: fr ? lab.descriptionFr : lab.descriptionAr,
        studentName: user.name,
        studentEmail: user.email,
        date: new Date(),
        columns,
        rows,
        chart: { x: def.plot.x, y: def.plot.y, xLabel: L(def.plot.xLabel), yLabel: L(def.plot.yLabel), mode: def.simulator === "ohm" ? "scatter" : "line", fit: def.simulator === "ohm" ? linearFit(xs, ys) : null },
        results,
      },
      `virtual-${reportId}.pdf`,
    );
    const report = await prisma.report.create({ data: { userId: user.id, labId: lab.id, kind: "VIRTUAL", filePath: path.relative(config.storageDir, file), data: { points: rows.length } } });

    const first = !progress.stage1CompletedAt;
    const newSteps = { ...steps, [reportStep.id]: { done: true as const, at: new Date().toISOString() } };
    const upd = await prisma.progress.update({
      where: { id: progress.id },
      data: { stage1Steps: newSteps as object, stage1Percent: 100, ...(first ? { stage1CompletedAt: new Date() } : {}) },
    });
    if (first) await notify(user.id, "stage2_unlocked", { lab: lab.titleFr, labAr: lab.titleAr, labId: lab.id });
    res.status(201).json({ reportId: report.id, progress: view(lab, def, upd) });
  }),
);

/** حساب مساعد للواجهة: قيمة المعادلات النظرية لمعاملات معينة (الرسم المتحرك يستعمل نسخته المحلية) */
simulationRouter.post(
  "/:id/simulation/compute",
  ah(async (req, res) => {
    const { def } = await ctx(req.user!, req.params.id);
    const { params } = parse(z.object({ params: z.record(z.number()) }), req.body);
    validateParams(def, params);
    res.json({ values: computeAll(def, params) });
  }),
);

// تجنّب حذف مجلد التخزين عند غيابه
fs.mkdirSync(path.join(config.storageDir, "reports"), { recursive: true });
