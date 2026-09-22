// ============================================================================
//  التصحيح الآلي لأنواع الأسئلة الأربعة (الخادم فقط — الإجابات الصحيحة لا تغادر الخادم
//  إلا في "المراجعة" بعد المحاولة الأخيرة).
// ============================================================================
import type { Question } from "../generated/prisma/client";
import type { FillP, McqP, NumP, TfP } from "./schemas";

/** توحيد النص: حروف صغيرة، إزالة التشكيل العربي والحركات اللاتينية، توحيد الألف/الياء/التاء المربوطة */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ًͯ-ٰٟـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase()
    .replace(/,/g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

export interface Graded {
  earned: number;
  max: number;
  correct: boolean;
}

export function parseNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v.trim().replace(",", "."));
    return v.trim() !== "" && Number.isFinite(n) ? n : null;
  }
  return null;
}

export function gradeQuestion(q: Pick<Question, "type" | "payload" | "points">, answer: unknown): Graded {
  const max = q.points;
  const none = { earned: 0, max, correct: false };
  if (answer === undefined || answer === null || answer === "") return none;

  switch (q.type) {
    case "MCQ": {
      const p = q.payload as unknown as McqP;
      const given = Array.isArray(answer) ? (answer as string[]) : [String(answer)];
      const ok = given.length === p.correct.length && p.correct.every((c) => given.includes(c));
      return { earned: ok ? max : 0, max, correct: ok };
    }
    case "TRUE_FALSE": {
      const p = q.payload as unknown as TfP;
      const ok = typeof answer === "boolean" && answer === p.correct;
      return { earned: ok ? max : 0, max, correct: ok };
    }
    case "NUMERIC": {
      const p = q.payload as unknown as NumP;
      const n = parseNumber(answer);
      if (n === null) return none;
      const tol = Math.max((p.tolerancePct ?? 2) / 100 * Math.abs(p.answer), p.toleranceAbs ?? 0);
      const ok = Math.abs(n - p.answer) <= tol + 1e-12;
      return { earned: ok ? max : 0, max, correct: ok };
    }
    case "FILL_BLANK": {
      const p = q.payload as unknown as FillP;
      const given = Array.isArray(answer) ? (answer as unknown[]) : [answer];
      let hits = 0;
      p.accepted.forEach((variants, i) => {
        const g = normalizeText(String(given[i] ?? ""));
        if (g && variants.some((v) => normalizeText(v) === g)) hits++;
      });
      // نقاط جزئية: تُقسَّم بالتساوي على الفراغات
      return { earned: (max * hits) / p.accepted.length, max, correct: hits === p.accepted.length };
    }
  }
}

/** القيمة الصحيحة بصيغة قابلة للعرض في المراجعة */
export function correctAnswerView(q: Pick<Question, "type" | "payload">): unknown {
  const p = q.payload as any;
  switch (q.type) {
    case "MCQ":
      return p.correct;
    case "TRUE_FALSE":
      return p.correct;
    case "NUMERIC":
      return { answer: p.answer, tolerancePct: p.tolerancePct, unit: p.unit };
    case "FILL_BLANK":
      return p.accepted.map((v: string[]) => v[0]);
  }
}

/** نسخة من السؤال بدون الإجابات الصحيحة (للطالب أثناء الاختبار) */
export function sanitizeQuestion(q: Question, choiceOrder?: string[]) {
  const p = q.payload as any;
  const base = { id: q.id, type: q.type, textAr: q.textAr, textFr: q.textFr, points: q.points };
  switch (q.type) {
    case "MCQ": {
      const byId = new Map<string, any>(p.choices.map((c: any) => [c.id, c]));
      const order = choiceOrder ?? p.choices.map((c: any) => c.id);
      return { ...base, multi: !!p.multi, choices: order.map((id: string) => byId.get(id)).filter(Boolean) };
    }
    case "NUMERIC":
      return { ...base, unit: p.unit ?? "" };
    case "FILL_BLANK":
      return { ...base, blanks: p.accepted.length };
    default:
      return base;
  }
}
