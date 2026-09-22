// ============================================================================
//  مخطط وثيقة تعريف الـ TP (LabDefinition) — هذا هو "المحرّك القابل للتوسع":
//  لإضافة تجربة جديدة يكفي إنشاء JSON بهذا الشكل (من واجهة الأستاذ) بدون أي كود جديد،
//  أما الرسم المتحرك فيختاره الحقل `simulator` من مكتبة مكوّنات الواجهة.
//  ملاحظة: نستعمل مصفوفات (وليس كائنات) لأن JSONB في PostgreSQL لا يحفظ ترتيب المفاتيح.
// ============================================================================
import { z } from "zod";
import { compile } from "./expr";

const L = z.object({ ar: z.string(), fr: z.string() }); // نص ثنائي اللغة
const key = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const stepId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);

export const ParameterSchema = z.object({
  key,
  label: L,
  unit: z.string().default(""),
  min: z.number(),
  max: z.number(),
  step: z.number().positive(),
  default: z.number(),
  /** إن وُجدت: القيم المسموحة فقط (مقاومات معيارية مثلاً) */
  options: z.array(z.number()).optional(),
});

const StepBase = { id: stepId, title: L, body: L };

export const StepSchema = z.discriminatedUnion("type", [
  /** خطوة قراءة/تعليمات: يكفي تأكيد الطالب */
  z.object({ ...StepBase, type: z.literal("read") }),
  /** ضبط التركيب: على الطالب اختيار قيم معينة للمعاملات */
  z.object({ ...StepBase, type: z.literal("setup"), require: z.record(z.number()) }),
  /** جمع قياسات: عدد أدنى من النقاط المختلفة (يُتحقق منها في الخادم) */
  z.object({
    ...StepBase,
    type: z.literal("measure"),
    minPoints: z.number().int().min(2).max(50),
    /** معاملات يجب أن تبقى ثابتة بين النقاط (مثل R و C في RC) */
    lock: z.array(key).default([]),
    /** المعامل الذي يجب أن تختلف قيمه بين النقاط */
    xParam: key,
  }),
  /** خطوة حساب: يقدّم الطالب قيمة تُقارن بالقيمة المحسوبة من قياساته */
  z.object({
    ...StepBase,
    type: z.literal("compute"),
    quantity: L,
    unit: z.string().default(""),
    tolerancePct: z.number().positive().max(100).default(10),
    estimator: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("slope"), x: key, y: key, invert: z.boolean().default(false), factor: z.number().default(1) }),
      z.object({ kind: z.literal("rc_tau"), x: key, y: key, e: key }),
      z.object({ kind: z.literal("threshold"), x: key, y: key, level: z.number() }),
    ]),
  }),
  /** الخطوة الأخيرة: توليد تقرير PDF (تُكمل المرحلة 1) */
  z.object({ ...StepBase, type: z.literal("report") }),
]);

export const RemoteConfigSchema = z.object({
  /** الحمل المسموح به على الجهاز في هذا الـ TP */
  load: z.enum(["R100", "R220", "R470", "RC", "DIODE"]),
  /** أدنى عدد من النقاط المسجَّلة لإكمال المرحلة 3 */
  minPoints: z.number().int().min(2).max(50),
  /** مفاتيح القياس الحية المرسومة: x و y (من telemetry) */
  plot: z.object({ x: z.string(), y: z.string(), xLabel: L, yLabel: L }),
  /** حد أقصى للجهد لهذا الـ TP (يضيّق حدود الجهاز ولا يوسّعها) */
  voltageMax: z.number().optional(),
  instructions: L,
});

export const LabDefinitionSchema = z
  .object({
    version: z.literal(1).default(1),
    /** اسم مكوّن الرسم المتحرك في الواجهة */
    simulator: z.enum(["ohm", "rc", "diode", "generic"]),
    parameters: z.array(ParameterSchema).min(1),
    constants: z.record(z.number()).default({}),
    equations: z.array(z.object({ name: key, expr: z.string() })).min(1),
    outputs: z.array(z.object({ key, label: L, unit: z.string().default(""), decimals: z.number().int().min(0).max(6).default(3) })).min(1),
    /** ضجيج نسبي في القراءات الافتراضية (انحراف معياري) */
    noise: z.number().min(0).max(0.05).default(0.01),
    plot: z.object({ x: key, y: key, xLabel: L, yLabel: L }),
    steps: z.array(StepSchema).min(1),
    remote: RemoteConfigSchema.optional(),
  })
  .superRefine((d, ctx) => {
    const err = (m: string) => ctx.addIssue({ code: "custom", message: m });
    const pKeys = new Set(d.parameters.map((p) => p.key));
    const eqNames = new Set(d.equations.map((e) => e.name));
    const known = new Set([...pKeys, ...eqNames]);
    // 1) المعادلات تُترجم وتُقيَّم تجريبياً على القيم الافتراضية
    const scope: Record<string, number> = { ...d.constants };
    for (const p of d.parameters) scope[p.key] = p.default;
    for (const eq of d.equations) {
      try {
        const v = compile(eq.expr)(scope);
        if (!Number.isFinite(v)) err(`equation ${eq.name} is not finite at default values`);
        scope[eq.name] = v;
      } catch (e) {
        err(`equation ${eq.name}: ${(e as Error).message}`);
      }
    }
    // 2) المراجع
    for (const o of d.outputs) if (!eqNames.has(o.key)) err(`output ${o.key} has no equation`);
    if (!known.has(d.plot.x) || !known.has(d.plot.y)) err("plot keys unknown");
    const ids = new Set<string>();
    for (const s of d.steps) {
      if (ids.has(s.id)) err(`duplicate step id ${s.id}`);
      ids.add(s.id);
      if (s.type === "measure") {
        if (!pKeys.has(s.xParam)) err(`step ${s.id}: unknown xParam`);
        s.lock.forEach((k) => !pKeys.has(k) && err(`step ${s.id}: unknown lock ${k}`));
      }
      if (s.type === "setup") Object.keys(s.require).forEach((k) => !pKeys.has(k) && err(`step ${s.id}: unknown param ${k}`));
      if (s.type === "compute") {
        const e = s.estimator;
        if (!known.has(e.x) || !known.has(e.y)) err(`step ${s.id}: estimator keys unknown`);
        if (e.kind === "rc_tau" && !known.has(e.e)) err(`step ${s.id}: estimator e unknown`);
      }
    }
    if (d.steps[d.steps.length - 1].type !== "report") err("last step must be of type 'report'");
    if (d.steps.filter((s) => s.type === "report").length !== 1) err("exactly one 'report' step is required");
  });

export type LabDefinition = z.infer<typeof LabDefinitionSchema>;
export type Step = LabDefinition["steps"][number];
export type Parameter = z.infer<typeof ParameterSchema>;
