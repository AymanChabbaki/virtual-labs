// ============================================================================
//  محرّك الـ TP (الخادم): حساب المعادلات، التحقق من القيم المسموحة،
//  التحقق من نقاط القياس، وتقدير الكميات (ميل، ثابت زمن، عتبة) لخطوات الحساب.
//  الواجهة تحسب نفس المعادلات للرسم المتحرك، لكن القرار (اعتماد الخطوة) للخادم فقط.
// ============================================================================
import { compile } from "./expr";
import { HttpError } from "../lib/http";
import type { LabDefinition, Parameter, Step } from "./definition";

export interface Point {
  params: Record<string, number>;
  /** القيم المقاسة (ما قرأه الطالب على أجهزة القياس الافتراضية) */
  values: Record<string, number>;
  at: string;
}

const compiledCache = new WeakMap<LabDefinition, { name: string; fn: ReturnType<typeof compile> }[]>();

/** يحسب كل المعادلات (بالترتيب) انطلاقاً من المعاملات */
export function computeAll(def: LabDefinition, params: Record<string, number>): Record<string, number> {
  let eqs = compiledCache.get(def);
  if (!eqs) {
    eqs = def.equations.map((e) => ({ name: e.name, fn: compile(e.expr) }));
    compiledCache.set(def, eqs);
  }
  const scope: Record<string, number> = { ...def.constants, ...params };
  const out: Record<string, number> = {};
  for (const e of eqs) {
    const v = e.fn(scope);
    scope[e.name] = v;
    out[e.name] = v;
  }
  return out;
}

const EPS = 1e-9;

/** هل القيمة مسموحة لهذا المعامل؟ (ضمن المجال وعلى الشبكة أو ضمن options) */
export function paramAllowed(p: Parameter, v: number): boolean {
  if (!Number.isFinite(v)) return false;
  if (p.options?.length) return p.options.some((o) => Math.abs(o - v) < EPS);
  if (v < p.min - EPS || v > p.max + EPS) return false;
  const k = (v - p.min) / p.step;
  return Math.abs(k - Math.round(k)) < 1e-6 || Math.abs(v - p.max) < EPS;
}

export function validateParams(def: LabDefinition, params: Record<string, number>) {
  for (const p of def.parameters) {
    const v = params[p.key];
    if (v === undefined) throw new HttpError(400, "PARAM_MISSING", `Missing parameter ${p.key}`);
    if (!paramAllowed(p, v)) throw new HttpError(422, "PARAM_OUT_OF_RANGE", `Parameter ${p.key} not allowed`, { key: p.key });
  }
}

/** التحقق من نقطة قياس: المعاملات مسموحة + القراءات قريبة من القيمة النظرية (ضمن الضجيج) */
export function validatePoint(def: LabDefinition, params: Record<string, number>, values: Record<string, number>) {
  validateParams(def, params);
  const expected = computeAll(def, params);
  const rel = Math.max(0.05, def.noise * 4);
  for (const o of def.outputs) {
    const got = values[o.key];
    if (got === undefined || !Number.isFinite(got)) throw new HttpError(400, "VALUE_MISSING", `Missing reading ${o.key}`);
    const exp = expected[o.key];
    if (Math.abs(got - exp) > rel * Math.abs(exp) + 1e-3) {
      throw new HttpError(422, "READING_INCONSISTENT", `Reading ${o.key} inconsistent with the model`, { key: o.key });
    }
  }
}

const val = (pt: Point, k: string): number => (k in pt.values ? pt.values[k] : pt.params[k]);

function linreg(xs: number[], ys: number[]) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0,
    sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

type Compute = Extract<Step, { type: "compute" }>;

/** القيمة المرجعية التي تُحسب من نقاط الطالب المعتمدة (وليس من المعادلات مباشرة) */
export function estimate(est: Compute["estimator"], points: Point[]): number | null {
  if (points.length < 2) return null;
  if (est.kind === "slope") {
    const r = linreg(points.map((p) => val(p, est.x)), points.map((p) => val(p, est.y)));
    if (!r || r.slope === 0) return null;
    return est.factor * (est.invert ? 1 / r.slope : r.slope);
  }
  if (est.kind === "rc_tau") {
    // شحن: Uc = E(1-e^{-t/τ})  →  ln(1-Uc/E) = -t/τ
    // نتجاهل النقاط القريبة من التشبّع (>90% من E) لأن ln(1-Uc/E) شديد الحساسية للضجيج هناك
    const pts = points.filter((p) => val(p, est.y) < 0.9 * val(p, est.e));
    if (pts.length < 2) return null;
    const r = linreg(pts.map((p) => val(p, est.x)), pts.map((p) => Math.log(1 - val(p, est.y) / val(p, est.e))));
    if (!r || r.slope >= 0) return null;
    return -1 / r.slope;
  }
  // threshold: قيمة x التي يعبر عندها y المستوى level (استيفاء خطي بين أقرب نقطتين)
  const sorted = [...points].sort((a, b) => val(a, est.x) - val(b, est.x));
  for (let i = 1; i < sorted.length; i++) {
    const y0 = val(sorted[i - 1], est.y),
      y1 = val(sorted[i], est.y);
    if ((y0 - est.level) * (y1 - est.level) <= 0 && y0 !== y1) {
      const x0 = val(sorted[i - 1], est.x),
        x1 = val(sorted[i], est.x);
      return x0 + ((est.level - y0) * (x1 - x0)) / (y1 - y0);
    }
  }
  return null;
}

/** النقاط المعتمدة لخطوة قياس: نفس قيم lock للنقطة الأولى، وقيم xParam مختلفة */
export function pointsForMeasure(step: Extract<Step, { type: "measure" }>, points: Point[]): Point[] {
  if (!points.length) return [];
  const first = points[0];
  const same = points.filter((p) => step.lock.every((k) => p.params[k] === first.params[k]));
  const seen = new Set<number>();
  return same.filter((p) => {
    const x = p.params[step.xParam];
    if (seen.has(x)) return false;
    seen.add(x);
    return true;
  });
}

export const stepIndex = (def: LabDefinition, id: string) => def.steps.findIndex((s) => s.id === id);
