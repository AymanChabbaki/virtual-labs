// ============================================================================
//  مقيِّم تعابير رياضية آمن (بدون eval) — يُستعمل لمعادلات الـ TP.
//  ⚠️ نسخة مطابقة لـ backend/src/labs/expr.ts — عدّلهما معاً.
//  يدعم: + - * / ^ ( ) ، ثوابت (pi, e)، ودوال (exp, ln, log10, sqrt, abs, sin, cos, tan, min, max, pow, floor, ceil, round)
// ============================================================================

type Tok = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };
export type Compiled = (scope: Record<string, number>) => number;

const FUNCS: Record<string, (...a: number[]) => number> = {
  exp: Math.exp,
  ln: Math.log,
  log10: Math.log10,
  sqrt: Math.sqrt,
  abs: Math.abs,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  const re = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|([-+*/^(),]))/y;
  let i = 0;
  while (i < src.length) {
    if (/^\s*$/.test(src.slice(i))) break;
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw new Error(`Unexpected character at ${i} in "${src}"`);
    if (m[1] !== undefined) out.push({ t: "num", v: parseFloat(m[1]) });
    else if (m[2] !== undefined) out.push({ t: "id", v: m[2] });
    else out.push({ t: "op", v: m[3] });
    i = re.lastIndex;
  }
  return out;
}

/** يحوّل النص إلى دالة قابلة للتقييم عدة مرات بمعاملات مختلفة */
export function compile(src: string): Compiled {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const eat = (v?: string) => {
    const t = toks[p];
    if (!t || (v && !(t.t === "op" && t.v === v))) throw new Error(`Expected "${v}" in "${src}"`);
    p++;
    return t;
  };

  // كل عقدة = دالة (scope) => number
  const expr = (): Compiled => {
    let l = term();
    while (peek()?.t === "op" && (peek().v === "+" || peek().v === "-")) {
      const op = (eat() as { v: string }).v;
      const r = term();
      const a = l;
      l = op === "+" ? (s) => a(s) + r(s) : (s) => a(s) - r(s);
    }
    return l;
  };
  const term = (): Compiled => {
    let l = unary();
    while (peek()?.t === "op" && (peek().v === "*" || peek().v === "/")) {
      const op = (eat() as { v: string }).v;
      const r = unary();
      const a = l;
      l = op === "*" ? (s) => a(s) * r(s) : (s) => a(s) / r(s);
    }
    return l;
  };
  const unary = (): Compiled => {
    if (peek()?.t === "op" && (peek().v === "-" || peek().v === "+")) {
      const op = (eat() as { v: string }).v;
      const x = unary();
      return op === "-" ? (s) => -x(s) : x;
    }
    return power();
  };
  const power = (): Compiled => {
    const base = primary();
    if (peek()?.t === "op" && peek().v === "^") {
      eat();
      const ex = unary(); // يمين-تجميعي
      return (s) => Math.pow(base(s), ex(s));
    }
    return base;
  };
  const primary = (): Compiled => {
    const t = peek();
    if (!t) throw new Error(`Unexpected end in "${src}"`);
    if (t.t === "num") {
      p++;
      const v = t.v;
      return () => v;
    }
    if (t.t === "id") {
      p++;
      const name = t.v;
      if (peek()?.t === "op" && peek().v === "(") {
        eat("(");
        const args: Compiled[] = [];
        if (!(peek()?.t === "op" && peek().v === ")")) {
          args.push(expr());
          while (peek()?.t === "op" && peek().v === ",") {
            eat(",");
            args.push(expr());
          }
        }
        eat(")");
        const fn = FUNCS[name];
        if (!fn) throw new Error(`Unknown function "${name}"`);
        return (s) => fn(...args.map((a) => a(s)));
      }
      return (s) => {
        if (name in s) return s[name];
        if (name in CONSTS) return CONSTS[name];
        throw new Error(`Unknown variable "${name}"`);
      };
    }
    if (t.t === "op" && t.v === "(") {
      eat("(");
      const x = expr();
      eat(")");
      return x;
    }
    throw new Error(`Unexpected token "${(t as { v: string }).v}" in "${src}"`);
  };

  const root = expr();
  if (p !== toks.length) throw new Error(`Unexpected trailing input in "${src}"`);
  return root;
}

export const evaluate = (src: string, scope: Record<string, number> = {}) => compile(src)(scope);
