// ============================================================================
//  التجارب (Labs): عرض للطالب + إنشاء/تعديل للأستاذ + بنك أسئلة الكويز
// ============================================================================
import { Router } from "express";
import { z } from "zod";
import type { Lab, User } from "../generated/prisma/client";
import { prisma } from "../db";
import { ah, HttpError, parse } from "../lib/http";
import { audit } from "../lib/audit";
import { authenticate, requireRole } from "../middleware/auth";
import { LabDefinitionSchema, type LabDefinition } from "../labs/definition";
import { getOrCreateProgress, loadLabOr404, stageStatus } from "../labs/stages";
import { QuestionInput } from "../quiz/schemas";

export const labsRouter = Router();
labsRouter.use(authenticate);

/** تعريف مُطبَّع (مع القيم الافتراضية) من JSON المخزَّن */
export const getDef = (lab: Lab): LabDefinition => LabDefinitionSchema.parse(lab.definition);

export const canManage = (u: User, lab: Lab) => u.role === "ADMIN" || lab.ownerId === u.id;
export function assertCanManage(u: User, lab: Lab) {
  if (!canManage(u, lab)) throw new HttpError(403, "FORBIDDEN");
}

/** هل التجربة مرئية للطالب؟ (منشورة + إمّا بلا فصول مرتبطة أو فصله ضمنها) */
async function assertVisibleToStudent(user: User, lab: Lab) {
  if (!lab.published) throw new HttpError(404, "LAB_NOT_FOUND");
  const links = await prisma.labClassroom.findMany({ where: { labId: lab.id } });
  if (links.length && !links.some((l) => l.classroomId === user.classroomId)) throw new HttpError(404, "LAB_NOT_FOUND");
}

export async function assertLabAccess(user: User, lab: Lab) {
  if (user.role === "STUDENT") await assertVisibleToStudent(user, lab);
  else assertCanManage(user, lab);
}

const summary = (lab: Lab, questionCount: number) => ({
  id: lab.id,
  slug: lab.slug,
  titleAr: lab.titleAr,
  titleFr: lab.titleFr,
  descriptionAr: lab.descriptionAr,
  descriptionFr: lab.descriptionFr,
  simulator: (lab.definition as any)?.simulator,
  passThreshold: lab.passThreshold,
  maxAttempts: lab.maxAttempts,
  cooldownMinutes: lab.cooldownMinutes,
  quizTimeLimitSec: lab.quizTimeLimitSec,
  quizQuestionCount: lab.quizQuestionCount,
  questionCount,
  published: lab.published,
  deviceId: lab.deviceId,
});

// ---------------------------------------------------------------------------
labsRouter.get(
  "/",
  ah(async (req, res) => {
    const u = req.user!;
    if (u.role === "STUDENT") {
      const labs = await prisma.lab.findMany({
        where: { published: true, OR: [{ classrooms: { none: {} } }, ...(u.classroomId ? [{ classrooms: { some: { classroomId: u.classroomId } } }] : [])] },
        include: { _count: { select: { questions: true } } },
        orderBy: { createdAt: "asc" },
      });
      const progress = await prisma.progress.findMany({ where: { userId: u.id, labId: { in: labs.map((l) => l.id) } } });
      const byLab = new Map(progress.map((p) => [p.labId, p]));
      return res.json({
        labs: await Promise.all(
          labs.map(async (l) => {
            const p = byLab.get(l.id) ?? (await getOrCreateProgress(u.id, l.id));
            return { ...summary(l, l._count.questions), status: stageStatus(l, p) };
          }),
        ),
      });
    }
    const labs = await prisma.lab.findMany({
      where: u.role === "ADMIN" ? {} : { ownerId: u.id },
      include: { _count: { select: { questions: true, progress: true } } },
      orderBy: { createdAt: "asc" },
    });
    res.json({ labs: labs.map((l) => ({ ...summary(l, l._count.questions), students: l._count.progress })) });
  }),
);

// التحقق من وثيقة تعريف دون حفظ (يستعمله محرّر الأستاذ)
labsRouter.post(
  "/validate-definition",
  requireRole("TEACHER"),
  ah(async (req, res) => {
    const r = LabDefinitionSchema.safeParse(req.body?.definition);
    res.json(r.success ? { valid: true } : { valid: false, issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  }),
);

const LabBody = z.object({
  slug: z.string().regex(/^[a-z0-9-]{3,60}$/),
  titleAr: z.string().min(2),
  titleFr: z.string().min(2),
  descriptionAr: z.string().default(""),
  descriptionFr: z.string().default(""),
  definition: z.unknown(),
  passThreshold: z.number().int().min(1).max(100).default(70),
  maxAttempts: z.number().int().min(1).max(20).default(3),
  cooldownMinutes: z.number().int().min(0).max(1440).default(10),
  quizTimeLimitSec: z.number().int().min(30).max(14400).default(600),
  quizQuestionCount: z.number().int().min(1).nullable().optional(),
  published: z.boolean().default(false),
  deviceId: z.string().nullable().optional(),
  classroomIds: z.array(z.string()).default([]),
});

function parseDefinition(d: unknown): LabDefinition {
  const r = LabDefinitionSchema.safeParse(d);
  if (!r.success) throw new HttpError(400, "INVALID_DEFINITION", "Invalid lab definition", r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  return r.data;
}

labsRouter.post(
  "/",
  requireRole("TEACHER"),
  ah(async (req, res) => {
    const b = parse(LabBody, req.body);
    const definition = parseDefinition(b.definition);
    if (await prisma.lab.findUnique({ where: { slug: b.slug } })) throw new HttpError(409, "SLUG_TAKEN");
    const { classroomIds, definition: _d, ...rest } = b;
    const lab = await prisma.lab.create({
      data: { ...rest, definition: definition as object, ownerId: req.user!.id, classrooms: { create: classroomIds.map((classroomId) => ({ classroomId })) } },
    });
    await audit(req.user!.id, "lab_created", "lab", lab.id, { slug: lab.slug });
    res.status(201).json({ lab: summary(lab, 0) });
  }),
);

labsRouter.get(
  "/:idOrSlug",
  ah(async (req, res) => {
    const u = req.user!;
    const lab = await loadLabOr404(req.params.idOrSlug);
    await assertLabAccess(u, lab);
    const questionCount = await prisma.question.count({ where: { labId: lab.id } });
    const base = { ...summary(lab, questionCount), definition: getDef(lab) };
    if (u.role === "STUDENT") {
      const p = await getOrCreateProgress(u.id, lab.id);
      return res.json({ lab: { ...base, status: stageStatus(lab, p) } });
    }
    const classrooms = (await prisma.labClassroom.findMany({ where: { labId: lab.id } })).map((c) => c.classroomId);
    res.json({ lab: { ...base, classroomIds: classrooms } });
  }),
);

labsRouter.patch(
  "/:id",
  requireRole("TEACHER"),
  ah(async (req, res) => {
    const lab = await loadLabOr404(req.params.id);
    assertCanManage(req.user!, lab);
    const b = parse(LabBody.partial(), req.body);
    const data: Record<string, unknown> = { ...b };
    delete data.classroomIds;
    if (b.definition !== undefined) {
      const def = parseDefinition(b.definition);
      // تعديل الخطوات بعد بدء الطلبة يفسد تقدّمهم → نمنعه إلا بـ ?force=1 (مدير)
      const started = await prisma.progress.count({ where: { labId: lab.id, stage1Percent: { gt: 0 } } });
      if (started && JSON.stringify(def.steps.map((s) => s.id)) !== JSON.stringify(getDef(lab).steps.map((s) => s.id)) && !(req.query.force && req.user!.role === "ADMIN"))
        throw new HttpError(409, "DEFINITION_LOCKED", "Students already started: steps cannot change");
      data.definition = def as object;
    }
    if (b.slug && b.slug !== lab.slug && (await prisma.lab.findUnique({ where: { slug: b.slug } }))) throw new HttpError(409, "SLUG_TAKEN");
    const upd = await prisma.lab.update({ where: { id: lab.id }, data });
    if (b.classroomIds) {
      await prisma.labClassroom.deleteMany({ where: { labId: lab.id } });
      await prisma.labClassroom.createMany({ data: b.classroomIds.map((classroomId) => ({ labId: lab.id, classroomId })) });
    }
    await audit(req.user!.id, "lab_updated", "lab", lab.id, { fields: Object.keys(b) });
    res.json({ lab: summary(upd, await prisma.question.count({ where: { labId: lab.id } })) });
  }),
);

labsRouter.delete(
  "/:id",
  requireRole("TEACHER"),
  ah(async (req, res) => {
    const lab = await loadLabOr404(req.params.id);
    assertCanManage(req.user!, lab);
    await prisma.lab.delete({ where: { id: lab.id } });
    await audit(req.user!.id, "lab_deleted", "lab", lab.id, { slug: lab.slug });
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
//  بنك الأسئلة (الأستاذ فقط — يتضمن الإجابات الصحيحة)
// ---------------------------------------------------------------------------
labsRouter.get(
  "/:id/questions",
  requireRole("TEACHER"),
  ah(async (req, res) => {
    const lab = await loadLabOr404(req.params.id);
    assertCanManage(req.user!, lab);
    res.json({ questions: await prisma.question.findMany({ where: { labId: lab.id }, orderBy: { order: "asc" } }) });
  }),
);

labsRouter.post(
  "/:id/questions",
  requireRole("TEACHER"),
  ah(async (req, res) => {
    const lab = await loadLabOr404(req.params.id);
    assertCanManage(req.user!, lab);
    const q = parse(QuestionInput, req.body);
    const created = await prisma.question.create({ data: { ...q, payload: q.payload as object, labId: lab.id, explanationAr: q.explanationAr ?? null, explanationFr: q.explanationFr ?? null } });
    res.status(201).json({ question: created });
  }),
);

labsRouter.put(
  "/:id/questions/:qid",
  requireRole("TEACHER"),
  ah(async (req, res) => {
    const lab = await loadLabOr404(req.params.id);
    assertCanManage(req.user!, lab);
    const existing = await prisma.question.findFirst({ where: { id: req.params.qid, labId: lab.id } });
    if (!existing) throw new HttpError(404, "QUESTION_NOT_FOUND");
    const q = parse(QuestionInput, req.body);
    const upd = await prisma.question.update({ where: { id: existing.id }, data: { ...q, payload: q.payload as object, explanationAr: q.explanationAr ?? null, explanationFr: q.explanationFr ?? null } });
    res.json({ question: upd });
  }),
);

labsRouter.delete(
  "/:id/questions/:qid",
  requireRole("TEACHER"),
  ah(async (req, res) => {
    const lab = await loadLabOr404(req.params.id);
    assertCanManage(req.user!, lab);
    const r = await prisma.question.deleteMany({ where: { id: req.params.qid, labId: lab.id } });
    if (!r.count) throw new HttpError(404, "QUESTION_NOT_FOUND");
    res.json({ ok: true });
  }),
);
