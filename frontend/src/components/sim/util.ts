// أدوات المحاكاة: تقييم معادلات التعريف، ضجيج القياس، انحدار خطي
import { compile } from "@/lib/expr";
import type { LabDefinition, Point } from "@/lib/types";

/** يبني دالة تحسب كل مخرجات المعادلات (بنفس ترتيب التعريف) من المعاملات */
export function makeCalc(def: LabDefinition) {
  const eqs = def.equations.map((e) => ({ name: e.name, fn: compile(e.expr) }));
  return (params: Record<string, number>) => {
    const scope: Record<string, number> = { ...def.constants, ...params };
    const out: Record<string, number> = {};
    for (const e of eqs) {
      try {
        const v = e.fn(scope);
        scope[e.name] = v;
        out[e.name] = Number.isFinite(v) ? v : 0;
      } catch {
        out[e.name] = 0;
      }
    }
    return out;
  };
}

function hash(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** ضجيج غاوسي حتمي (نفس البذرة → نفس القراءة) حتى لا تومض الأرقام عند كل رسم */
export function noisy(value: number, rel: number, seed: number, key: string) {
  const r = mulberry32(hash(`${seed}:${key}`));
  const g = Math.sqrt(-2 * Math.log(Math.max(r(), 1e-9))) * Math.cos(2 * Math.PI * r());
  const clamped = Math.max(-2, Math.min(2, g)); // ±2σ (الخادم يقبل حتى ±5%)
  return value === 0 ? 0 : value * (1 + rel * clamped);
}

export const pv = (p: Point, k: string) => (k in p.values ? p.values[k] : p.params[k]);

export function linreg(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0,
    sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (!sxx) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

export const fmt = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "—");
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
