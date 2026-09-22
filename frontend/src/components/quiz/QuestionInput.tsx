"use client";
// عرض سؤال الكويز وإدخال الإجابة (4 أنواع): اختيار متعدد، صح/خطأ، رقمي، ملء فراغ
import { useI18n } from "@/i18n";
import { cx } from "@/components/ui";

export interface QChoice {
  id: string;
  fr: string;
  ar: string;
}
export interface QuizQuestion {
  id: string;
  type: "MCQ" | "TRUE_FALSE" | "NUMERIC" | "FILL_BLANK";
  textAr: string;
  textFr: string;
  points: number;
  multi?: boolean;
  choices?: QChoice[];
  unit?: string;
  blanks?: number;
}

export function QuestionInput({ q, value, onChange, disabled }: { q: QuizQuestion; value: any; onChange: (v: any) => void; disabled?: boolean }) {
  const { lang, t } = useI18n();
  const text = lang === "ar" ? q.textAr : q.textFr;

  if (q.type === "MCQ") {
    const sel: string[] = Array.isArray(value) ? value : [];
    return (
      <div>
        <p className="mb-1 text-lg font-medium leading-snug">{text}</p>
        {q.multi && <p className="mb-3 text-sm text-ink-3">{t("quiz.multi_hint")}</p>}
        <div className="mt-3 space-y-2.5">
          {q.choices!.map((c) => {
            const on = sel.includes(c.id);
            return (
              <button
                key={c.id}
                disabled={disabled}
                onClick={() => onChange(q.multi ? (on ? sel.filter((x) => x !== c.id) : [...sel, c.id]) : [c.id])}
                className={cx("flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3 text-start transition", on ? "border-s2 bg-amber-50" : "border-line bg-white hover:border-amber-300")}
                aria-pressed={on}
              >
                <span className={cx("flex h-5 w-5 shrink-0 items-center justify-center border-2 text-[11px] text-white", q.multi ? "rounded" : "rounded-full", on ? "border-s2 bg-s2" : "border-slate-300")}>{on ? "✓" : ""}</span>
                <span>{lang === "ar" ? c.ar : c.fr}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (q.type === "TRUE_FALSE") {
    return (
      <div>
        <p className="mb-4 text-lg font-medium leading-snug">{text}</p>
        <div className="grid max-w-md grid-cols-2 gap-3">
          {[true, false].map((b) => (
            <button key={String(b)} disabled={disabled} onClick={() => onChange(b)} className={cx("rounded-xl border-2 px-4 py-4 text-lg font-semibold transition", value === b ? "border-s2 bg-amber-50 text-amber-900" : "border-line bg-white hover:border-amber-300")} aria-pressed={value === b}>
              {b ? t("quiz.true") : t("quiz.false")}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (q.type === "NUMERIC") {
    return (
      <div>
        <p className="mb-4 text-lg font-medium leading-snug">{text}</p>
        <div className="flex max-w-sm items-center gap-2">
          <input className="input num text-lg" inputMode="decimal" disabled={disabled} value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder="0.00" dir="ltr" />
          {q.unit && <span className="text-ink-2">{q.unit}</span>}
        </div>
        <p className="mt-2 text-xs text-ink-3">{t("quiz.numeric_hint")}</p>
      </div>
    );
  }

  // FILL_BLANK: الفراغات (___) تُستبدل بحقول إدخال داخل السطر
  const parts = text.split("___");
  const vals: string[] = Array.isArray(value) ? value : [];
  return (
    <div>
      <p className="mb-1 text-sm text-ink-3">{t("quiz.fill_hint")}</p>
      <p className="text-lg font-medium leading-[2.6]">
        {parts.map((p, i) => (
          <span key={i}>
            {p}
            {i < parts.length - 1 && (
              <input
                className="input mx-1.5 inline-block w-40 border-b-2 px-2 py-1 text-center"
                disabled={disabled}
                value={vals[i] ?? ""}
                onChange={(e) => {
                  const n = [...vals];
                  n[i] = e.target.value;
                  for (let k = 0; k < (q.blanks ?? 1); k++) n[k] ??= "";
                  onChange(n);
                }}
                aria-label={`${i + 1}`}
              />
            )}
          </span>
        ))}
      </p>
    </div>
  );
}

export const isAnswered = (q: QuizQuestion, v: any) => {
  if (q.type === "MCQ") return Array.isArray(v) && v.length > 0;
  if (q.type === "TRUE_FALSE") return typeof v === "boolean";
  if (q.type === "NUMERIC") return v !== undefined && String(v).trim() !== "";
  return Array.isArray(v) && v.some((x) => String(x).trim() !== "");
};
