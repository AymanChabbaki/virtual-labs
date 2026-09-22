"use client";
// بنك أسئلة التجربة: قائمة + نافذة إضافة/تعديل لكل نوع (MCQ, صح/خطأ, رقمي, ملء فراغ)
import { useState } from "react";
import useSWR from "swr";
import { Badge, Button, Card, Empty, Field, Modal, PageLoader, useUx } from "@/components/ui";
import { api, ApiError, fetcher } from "@/lib/api";
import { useI18n } from "@/i18n";

type QType = "MCQ" | "TRUE_FALSE" | "NUMERIC" | "FILL_BLANK";
interface Q {
  id: string;
  type: QType;
  textAr: string;
  textFr: string;
  points: number;
  payload: any;
  explanationAr?: string | null;
  explanationFr?: string | null;
  order: number;
}

const blank = (type: QType): Omit<Q, "id" | "order"> => ({
  type,
  textAr: "",
  textFr: "",
  points: 1,
  explanationAr: "",
  explanationFr: "",
  payload:
    type === "MCQ"
      ? { choices: [{ id: "a", ar: "", fr: "" }, { id: "b", ar: "", fr: "" }], correct: ["a"], multi: false }
      : type === "TRUE_FALSE"
        ? { correct: true }
        : type === "NUMERIC"
          ? { answer: 0, tolerancePct: 2, unit: "" }
          : { accepted: [[""]] },
});

export function QuestionsTab({ labId }: { labId: string }) {
  const { t, lang } = useI18n();
  const ux = useUx();
  const { data, mutate } = useSWR<{ questions: Q[] }>(`/labs/${labId}/questions`, fetcher);
  const [edit, setEdit] = useState<(Omit<Q, "id" | "order"> & { id?: string }) | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  if (!data) return <PageLoader />;

  const save = async () => {
    if (!edit) return;
    setBusy(true);
    setIssues([]);
    try {
      const body = { type: edit.type, textAr: edit.textAr, textFr: edit.textFr, points: edit.points, payload: cleanPayload(edit), explanationAr: edit.explanationAr || null, explanationFr: edit.explanationFr || null, order: (edit as any).order ?? data.questions.length };
      if (edit.id) await api(`/labs/${labId}/questions/${edit.id}`, { method: "PUT", body });
      else await api(`/labs/${labId}/questions`, { method: "POST", body });
      await mutate();
      setEdit(null);
    } catch (e) {
      if (e instanceof ApiError && Array.isArray(e.details)) setIssues(e.details.map((d: any) => `${d.path}: ${d.message}`));
      else ux.error(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (q: Q) => {
    if (!(await ux.confirm(t("questions.delete_confirm"), { danger: true }))) return;
    try {
      await api(`/labs/${labId}/questions/${q.id}`, { method: "DELETE" });
      await mutate();
    } catch (e) {
      ux.error(e);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-3">{t("questions.count", { n: data.questions.length })}</p>
        <div className="flex flex-wrap gap-2">
          {(["MCQ", "TRUE_FALSE", "NUMERIC", "FILL_BLANK"] as QType[]).map((ty) => (
            <Button key={ty} size="sm" variant="secondary" onClick={() => (setIssues([]), setEdit(blank(ty)))}>
              + {t(`quiz.type.${ty}`)}
            </Button>
          ))}
        </div>
      </div>

      {!data.questions.length ? (
        <Empty>{t("questions.empty")}</Empty>
      ) : (
        <div className="space-y-2">
          {data.questions.map((q, i) => (
            <Card key={q.id} className="flex items-start gap-3 py-3">
              <span className="num mt-0.5 w-6 shrink-0 text-ink-3">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 font-medium">{lang === "ar" ? q.textAr : q.textFr}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Badge tone="amber">{t(`quiz.type.${q.type}`)}</Badge>
                  <Badge>{t("questions.pts", { n: q.points })}</Badge>
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => (setIssues([]), setEdit({ ...q, explanationAr: q.explanationAr ?? "", explanationFr: q.explanationFr ?? "" }))}>
                {t("common.edit")}
              </Button>
              <Button size="sm" variant="ghost" className="text-danger" onClick={() => remove(q)}>
                ✕
              </Button>
            </Card>
          ))}
        </div>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit ? t(`quiz.type.${edit.type}`) : ""} wide>
        {edit && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={t("questions.text_fr")}>
                <textarea className="input min-h-20" value={edit.textFr} onChange={(e) => setEdit({ ...edit, textFr: e.target.value })} dir="ltr" />
              </Field>
              <Field label={t("questions.text_ar")}>
                <textarea className="input min-h-20" value={edit.textAr} onChange={(e) => setEdit({ ...edit, textAr: e.target.value })} dir="rtl" />
              </Field>
            </div>
            {edit.type === "FILL_BLANK" && <p className="text-xs text-ink-3">{t("questions.blank_hint")}</p>}

            <TypeEditor q={edit} set={setEdit} />

            <div className="grid gap-3 md:grid-cols-2">
              <Field label={t("questions.expl_fr")}>
                <textarea className="input min-h-16" value={edit.explanationFr ?? ""} onChange={(e) => setEdit({ ...edit, explanationFr: e.target.value })} dir="ltr" />
              </Field>
              <Field label={t("questions.expl_ar")}>
                <textarea className="input min-h-16" value={edit.explanationAr ?? ""} onChange={(e) => setEdit({ ...edit, explanationAr: e.target.value })} dir="rtl" />
              </Field>
            </div>
            <Field label={t("questions.points")} className="max-w-32">
              <input className="input num" type="number" min={1} max={20} value={edit.points} onChange={(e) => setEdit({ ...edit, points: Number(e.target.value) })} />
            </Field>

            {issues.length > 0 && (
              <ul className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" dir="ltr">
                {issues.map((x, i) => (
                  <li key={i}>• {x}</li>
                ))}
              </ul>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEdit(null)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={save} loading={busy}>
                {t("common.save")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/** ينظّف الحمولة قبل الإرسال (أرقام حقيقية، إزالة الفراغات) */
function cleanPayload(q: { type: QType; payload: any }) {
  const p = q.payload;
  if (q.type === "NUMERIC") return { answer: Number(p.answer), tolerancePct: Number(p.tolerancePct), ...(p.unit ? { unit: p.unit } : {}) };
  if (q.type === "FILL_BLANK") return { accepted: p.accepted.map((g: string[]) => g.map((s) => s.trim()).filter(Boolean)) };
  return p;
}

function TypeEditor({ q, set }: { q: any; set: (q: any) => void }) {
  const { t } = useI18n();
  const p = q.payload;
  const setP = (np: any) => set({ ...q, payload: np });

  if (q.type === "TRUE_FALSE")
    return (
      <div className="flex gap-2">
        {[true, false].map((b) => (
          <Button key={String(b)} variant={p.correct === b ? "primary" : "secondary"} onClick={() => setP({ correct: b })}>
            {b ? t("quiz.true") : t("quiz.false")}
          </Button>
        ))}
      </div>
    );

  if (q.type === "NUMERIC")
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("questions.answer")}>
          <input className="input num" type="number" step="any" value={p.answer} onChange={(e) => setP({ ...p, answer: e.target.value })} />
        </Field>
        <Field label={t("questions.tolerance")}>
          <input className="input num" type="number" step="any" min={0} value={p.tolerancePct} onChange={(e) => setP({ ...p, tolerancePct: e.target.value })} />
        </Field>
        <Field label={t("questions.unit")}>
          <input className="input" value={p.unit ?? ""} onChange={(e) => setP({ ...p, unit: e.target.value })} />
        </Field>
      </div>
    );

  if (q.type === "FILL_BLANK")
    return (
      <div className="space-y-2">
        <div className="text-sm font-medium text-ink-2">{t("questions.accepted")}</div>
        {p.accepted.map((group: string[], i: number) => (
          <div key={i} className="flex items-center gap-2">
            <span className="num w-6 text-ink-3">{i + 1}</span>
            <input
              className="input"
              value={group.join(" | ")}
              onChange={(e) => setP({ ...p, accepted: p.accepted.map((g: string[], j: number) => (j === i ? e.target.value.split("|").map((s) => s.trimStart()) : g)) })}
              placeholder="ohm | Ω"
            />
            {p.accepted.length > 1 && (
              <Button size="sm" variant="ghost" onClick={() => setP({ ...p, accepted: p.accepted.filter((_: any, j: number) => j !== i) })}>
                ✕
              </Button>
            )}
          </div>
        ))}
        <Button size="sm" variant="secondary" onClick={() => setP({ ...p, accepted: [...p.accepted, [""]] })}>
          + {t("questions.add_blank")}
        </Button>
        <p className="text-xs text-ink-3">{t("questions.accepted_hint")}</p>
      </div>
    );

  // MCQ
  const toggleCorrect = (id: string) => {
    const has = p.correct.includes(id);
    setP({ ...p, correct: p.multi ? (has ? p.correct.filter((x: string) => x !== id) : [...p.correct, id]) : [id] });
  };
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={p.multi} onChange={(e) => setP({ ...p, multi: e.target.checked, correct: e.target.checked ? p.correct : p.correct.slice(0, 1) })} />
        {t("questions.multi")}
      </label>
      {p.choices.map((c: any, i: number) => (
        <div key={c.id} className="flex items-center gap-2">
          <input type={p.multi ? "checkbox" : "radio"} checked={p.correct.includes(c.id)} onChange={() => toggleCorrect(c.id)} aria-label={t("questions.correct")} />
          <input className="input" placeholder="Français" dir="ltr" value={c.fr} onChange={(e) => setP({ ...p, choices: p.choices.map((x: any, j: number) => (j === i ? { ...x, fr: e.target.value } : x)) })} />
          <input className="input" placeholder="العربية" dir="rtl" value={c.ar} onChange={(e) => setP({ ...p, choices: p.choices.map((x: any, j: number) => (j === i ? { ...x, ar: e.target.value } : x)) })} />
          {p.choices.length > 2 && (
            <Button size="sm" variant="ghost" onClick={() => setP({ ...p, choices: p.choices.filter((_: any, j: number) => j !== i), correct: p.correct.filter((x: string) => x !== c.id) })}>
              ✕
            </Button>
          )}
        </div>
      ))}
      {p.choices.length < 8 && (
        <Button size="sm" variant="secondary" onClick={() => setP({ ...p, choices: [...p.choices, { id: nextId(p.choices), ar: "", fr: "" }] })}>
          + {t("questions.add_choice")}
        </Button>
      )}
      <p className="text-xs text-ink-3">{t("questions.correct_hint")}</p>
    </div>
  );
}

const nextId = (choices: { id: string }[]) => {
  for (const c of "abcdefghijklmnop") if (!choices.some((x) => x.id === c)) return c;
  return String(Date.now());
};
