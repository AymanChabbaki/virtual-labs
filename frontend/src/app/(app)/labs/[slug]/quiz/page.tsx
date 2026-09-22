"use client";
// المرحلة 2: الكويز — حالة المحاولات، مؤقّت، حفظ تلقائي للإجابات، نتيجة فورية، وتصحيح بعد المحاولة الأخيرة فقط
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { ApiError, api, fetcher } from "@/lib/api";
import { useI18n } from "@/i18n";
import { Alert, Badge, Button, Card, PageLoader, ProgressBar, cx, mmss, useCountdown, useUx } from "@/components/ui";
import { QuestionInput, isAnswered, type QuizQuestion } from "@/components/quiz/QuestionInput";
import type { LabSummary, Stage2, Status } from "@/lib/types";

interface QuizStatus {
  stage1: Status["stage1"];
  stage2: Stage2;
  stage3: Status["stage3"];
  timeLimitSec: number;
  cooldownMinutes: number;
  questionCount: number;
  runningAttemptId: string | null;
  attempts: { id: string; number: number; status: string; percent: number | null; passed: boolean | null; submittedAt: string | null }[];
}
interface AttemptView {
  id: string;
  number: number;
  deadlineAt: string;
  answers: Record<string, any>;
  questions: QuizQuestion[];
  resumed?: boolean;
}
interface ReviewItem {
  question: QuizQuestion;
  given: any;
  correctAnswer: any;
  correct: boolean;
  earned: number;
  max: number;
  explanationAr: string | null;
  explanationFr: string | null;
}
interface Result {
  percent: number;
  score: number;
  maxScore: number;
  passed: boolean;
  threshold: number;
  expired: boolean;
  stage2: Stage2;
  stage3: Status["stage3"];
  review?: ReviewItem[];
}

export default function QuizPage() {
  const { slug } = useParams<{ slug: string }>();
  const { t, pick, fmtDateTime } = useI18n();
  const { error } = useUx();
  const { data: lab } = useSWR<{ lab: LabSummary }>(`/labs/${slug}`, fetcher);
  const { data: st, mutate, isLoading } = useSWR<QuizStatus>(`/labs/${slug}/quiz`, fetcher, { revalidateOnFocus: false });
  const [attempt, setAttempt] = useState<AttemptView | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<ReviewItem[] | null>(null);
  const resumed = useRef(false);

  // استئناف محاولة جارية تلقائياً (بعد تحديث الصفحة)
  useEffect(() => {
    if (!st || resumed.current || !st.runningAttemptId) return;
    resumed.current = true;
    api<AttemptView>(`/quiz/attempts/${st.runningAttemptId}`).then(setAttempt).catch(error);
  }, [st]); // eslint-disable-line react-hooks/exhaustive-deps

  const cooldownMs = st?.stage2.cooldownUntil ? new Date(st.stage2.cooldownUntil).getTime() : null;
  const cd = useCountdown(cooldownMs);
  useEffect(() => {
    if (cd === 0 && cooldownMs) void mutate();
  }, [cd]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    setBusy(true);
    try {
      const a = await api<AttemptView>(`/labs/${slug}/quiz/attempts`, { method: "POST" });
      setResult(null);
      setAttempt(a);
      void mutate();
    } catch (e) {
      if (e instanceof ApiError && e.code === "COOLDOWN") void mutate();
      error(e);
    } finally {
      setBusy(false);
    }
  }

  async function loadReview() {
    try {
      const r = await api<{ review: ReviewItem[] }>(`/labs/${slug}/quiz/review`);
      setReview(r.review);
    } catch (e) {
      error(e);
    }
  }

  if (isLoading || !st || !lab) return <PageLoader />;
  const title = pick(lab.lab, "title");
  const head = (
    <div className="mb-5">
      <Link href={`/labs/${slug}`} className="text-sm text-brand-700 hover:underline">
        ← {title}
      </Link>
      <div className="mt-2">
        <Badge tone="amber">{t("path.stage", { n: 2 })}</Badge>
      </div>
      <h1 className="mt-1 text-2xl font-semibold">{t("stage.2.name")}</h1>
    </div>
  );

  // ------------------------------------------------------------- محاولة جارية
  if (attempt && !result) {
    return (
      <div className="mx-auto max-w-3xl">
        {head}
        <Runner
          key={attempt.id}
          attempt={attempt}
          onDone={(r) => {
            setResult(r);
            setAttempt(null);
            resumed.current = true;
            void mutate();
          }}
        />
      </div>
    );
  }

  // ------------------------------------------------------------- نتيجة
  if (result) {
    const s2 = result.stage2;
    const cdRes = s2.cooldownUntil ? new Date(s2.cooldownUntil) : null;
    return (
      <div className="mx-auto max-w-3xl">
        {head}
        <Card className="text-center">
          <Ring percent={result.percent} pass={result.passed} />
          <h2 className={cx("mt-3 text-xl font-semibold", result.passed ? "text-emerald-700" : "text-red-700")}>{result.passed ? t("quiz.passed") : t("quiz.failed")}</h2>
          <p className="mt-1 text-ink-2">{t("quiz.result_line", { score: Number(result.score.toFixed(2)), max: result.maxScore, threshold: result.threshold })}</p>
          {result.expired && <Alert tone="amber" className="mx-auto mt-3 max-w-md">{t("quiz.expired")}</Alert>}
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {result.passed ? (
              <Link href={`/labs/${slug}/remote`}>
                <Button variant="success" size="lg">
                  {t("quiz.go_remote")} →
                </Button>
              </Link>
            ) : s2.attemptsLeft > 0 ? (
              <>
                <Alert tone="blue" className="w-full max-w-md text-start">
                  {t("quiz.attempts_left", { n: s2.attemptsLeft })} {cdRes && t("quiz.cooldown_until", { time: fmtDateTime(cdRes) })}
                </Alert>
                <Button variant="secondary" onClick={() => (setResult(null), void mutate())}>
                  {t("common.back")}
                </Button>
              </>
            ) : (
              <Alert tone="red" className="w-full max-w-md">
                {t("quiz.failed_final")}
              </Alert>
            )}
          </div>
        </Card>
        {result.review ? <Review items={result.review} /> : !result.passed && s2.attemptsLeft > 0 ? <p className="mt-4 text-center text-sm text-ink-3">{t("quiz.review_locked")}</p> : null}
      </div>
    );
  }

  // ------------------------------------------------------------- صفحة الحالة
  const s2 = st.stage2;
  const locked = s2.state === "locked";
  return (
    <div className="mx-auto max-w-3xl">
      {head}
      {locked ? (
        <Card className="text-center">
          <div className="text-4xl">🔒</div>
          <h2 className="mt-2 text-lg font-semibold">{t("quiz.locked_title")}</h2>
          <p className="mx-auto mt-1 max-w-md text-ink-2">{t("path.lock.stage2")}</p>
          <div className="mx-auto mt-4 max-w-xs">
            <ProgressBar value={st.stage1.percent} color="bg-s1" />
            <div className="num mt-1 text-sm text-ink-3">{st.stage1.percent}%</div>
          </div>
          <Link href={`/labs/${slug}/simulation`} className="mt-4 inline-block">
            <Button>{t("quiz.go_sim")}</Button>
          </Link>
        </Card>
      ) : (
        <>
          <Card>
            <div className="grid gap-4 sm:grid-cols-4">
              {[
                [t("quiz.info.questions"), String(st.questionCount)],
                [t("quiz.info.time"), `${Math.round(st.timeLimitSec / 60)} min`],
                [t("quiz.info.threshold"), `${s2.threshold}%`],
                [t("quiz.info.attempts"), `${s2.attemptsUsed}/${s2.attemptsAllowed}`],
              ].map(([k, v]) => (
                <div key={k}>
                  <div className="text-xs text-ink-3">{k}</div>
                  <div className="num text-xl font-semibold">{v}</div>
                </div>
              ))}
            </div>
            <ul className="mt-4 list-disc space-y-1 ps-5 text-sm text-ink-2">
              <li>{t("quiz.rule.shuffle")}</li>
              <li>{t("quiz.rule.timer")}</li>
              <li>{t("quiz.rule.cooldown", { n: st.cooldownMinutes })}</li>
              <li>{t("quiz.rule.review")}</li>
            </ul>

            <div className="mt-5">
              {s2.state === "passed" && (
                <Alert tone="green">
                  ✅ {t("quiz.passed_state", { n: s2.bestPercent ?? 0 })}{" "}
                  <Link href={`/labs/${slug}/remote`} className="font-semibold underline">
                    {t("quiz.go_remote")} →
                  </Link>
                </Alert>
              )}
              {s2.state === "failed_final" && <Alert tone="red">{t("quiz.failed_final")}</Alert>}
              {s2.state === "available" && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button size="lg" variant="amber" loading={busy} disabled={cd !== null && cd > 0} onClick={start}>
                    {st.runningAttemptId ? t("quiz.resume") : s2.attemptsUsed ? t("quiz.retry") : t("quiz.start")}
                  </Button>
                  {cd !== null && cd > 0 && <span className="num rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">⏳ {t("quiz.cooldown", { time: mmss(cd) })}</span>}
                </div>
              )}
            </div>
          </Card>

          {st.attempts.length > 0 && (
            <Card className="mt-5">
              <h3 className="mb-3 font-semibold">{t("quiz.history")}</h3>
              <table className="w-full text-sm">
                <thead className="text-xs text-ink-3">
                  <tr>
                    <th className="py-1 text-start">#</th>
                    <th className="py-1 text-start">{t("common.date")}</th>
                    <th className="py-1 text-start">{t("quiz.score")}</th>
                    <th className="py-1 text-start">{t("common.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {st.attempts.map((a) => (
                    <tr key={a.id} className="border-t border-line">
                      <td className="num py-2">{a.number}</td>
                      <td className="py-2">{a.submittedAt ? fmtDateTime(a.submittedAt) : "—"}</td>
                      <td className="num py-2">{a.percent !== null ? `${a.percent}%` : "—"}</td>
                      <td className="py-2">{a.status === "IN_PROGRESS" ? <Badge tone="blue">{t("quiz.in_progress")}</Badge> : a.passed ? <Badge tone="green">{t("quiz.passed")}</Badge> : <Badge tone="red">{a.status === "EXPIRED" ? t("quiz.expired_short") : t("quiz.failed")}</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {s2.reviewAvailable && (
            <div className="mt-5">
              {!review ? (
                <Button variant="secondary" onClick={loadReview}>
                  📖 {t("quiz.show_review")}
                </Button>
              ) : (
                <Review items={review} />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// =============================================================================
function Ring({ percent, pass }: { percent: number; pass: boolean }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <svg width="140" height="140" viewBox="0 0 140 140" className="mx-auto" role="img" aria-label={`${percent}%`}>
      <circle cx="70" cy="70" r={r} fill="none" stroke="#e2e8f0" strokeWidth="12" />
      <circle cx="70" cy="70" r={r} fill="none" stroke={pass ? "#059669" : "#dc2626"} strokeWidth="12" strokeLinecap="round" strokeDasharray={`${(c * percent) / 100} ${c}`} transform="rotate(-90 70 70)" style={{ transition: "stroke-dasharray .8s" }} />
      <text x="70" y="78" textAnchor="middle" fontSize="30" fontWeight="700" fill="#0f172a" className="num">
        {percent}%
      </text>
    </svg>
  );
}

function Runner({ attempt, onDone }: { attempt: AttemptView; onDone: (r: Result) => void }) {
  const { t } = useI18n();
  const { error, confirm } = useUx();
  const [answers, setAnswers] = useState<Record<string, any>>(attempt.answers ?? {});
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const submitted = useRef(false);
  const deadline = new Date(attempt.deadlineAt).getTime();
  const left = useCountdown(deadline);
  const qs = attempt.questions;
  const q = qs[i];

  // حفظ تلقائي للإجابات (يُستعمل إن أُغلقت الصفحة أو انتهى الوقت)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const change = (id: string, v: any) => {
    setAnswers((a) => ({ ...a, [id]: v }));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => api(`/quiz/attempts/${attempt.id}/answers`, { method: "PUT", body: { answers: { [id]: v } } }).catch(() => undefined), 500);
  };

  const submit = useCallback(
    async (auto = false) => {
      if (submitted.current) return;
      submitted.current = true;
      setBusy(true);
      try {
        onDone(await api<Result>(`/quiz/attempts/${attempt.id}/submit`, { method: "POST", body: { answers } }));
      } catch (e) {
        submitted.current = false;
        setBusy(false);
        if (!auto) error(e);
        else if (e instanceof ApiError && e.code === "ALREADY_SUBMITTED") window.location.reload();
      }
    },
    [answers, attempt.id, error, onDone],
  );

  useEffect(() => {
    if (left === 0) void submit(true);
  }, [left]); // eslint-disable-line react-hooks/exhaustive-deps

  const answered = qs.filter((x) => isAnswered(x, answers[x.id])).length;
  const low = (left ?? 999) <= 60;

  async function finish() {
    const unanswered = qs.length - answered;
    if (unanswered > 0 && !(await confirm(t("quiz.confirm_unanswered", { n: unanswered })))) return;
    void submit();
  }

  return (
    <div>
      <div className="sticky top-14 z-20 -mx-4 mb-4 flex items-center justify-between gap-4 border-b border-line bg-canvas/95 px-4 py-3 backdrop-blur">
        <div className="min-w-0 flex-1">
          <div className="mb-1 text-xs text-ink-3">
            {t("quiz.question_n", { n: i + 1, total: qs.length })} · <span className="num">{answered}</span> {t("quiz.answered")}
          </div>
          <ProgressBar value={((i + 1) / qs.length) * 100} color="bg-s2" />
        </div>
        <div className={cx("num rounded-xl px-4 py-2 text-xl font-bold tabular-nums", low ? "animate-pulse bg-red-100 text-red-700" : "bg-white text-ink ring-1 ring-line")} aria-live="off">
          ⏱ {left === null ? "--:--" : mmss(left)}
        </div>
      </div>

      <Card className="min-h-64">
        <div className="mb-3 flex items-center justify-between text-xs text-ink-3">
          <Badge tone="slate">{t(`quiz.type.${q.type}`)}</Badge>
          <span className="num">{t("quiz.points", { n: q.points })}</span>
        </div>
        <QuestionInput q={q} value={answers[q.id]} onChange={(v) => change(q.id, v)} disabled={busy} />
      </Card>

      <div className="mt-4 flex items-center justify-between gap-3">
        <Button variant="secondary" onClick={() => setI((x) => Math.max(0, x - 1))} disabled={i === 0}>
          ← {t("common.previous")}
        </Button>
        <div className="hidden flex-wrap justify-center gap-1.5 sm:flex">
          {qs.map((x, k) => (
            <button key={x.id} onClick={() => setI(k)} className={cx("num h-8 w-8 rounded-full text-xs font-semibold transition", k === i ? "bg-s2 text-white" : isAnswered(x, answers[x.id]) ? "bg-amber-100 text-amber-900" : "bg-white text-ink-3 ring-1 ring-line")} aria-label={`${k + 1}`}>
              {k + 1}
            </button>
          ))}
        </div>
        {i < qs.length - 1 ? (
          <Button onClick={() => setI((x) => x + 1)}>{t("common.next")} →</Button>
        ) : (
          <Button variant="amber" loading={busy} onClick={finish}>
            {t("quiz.submit")}
          </Button>
        )}
      </div>
    </div>
  );
}

function Review({ items }: { items: ReviewItem[] }) {
  const { t, lang } = useI18n();
  const show = (r: ReviewItem, v: any): string => {
    const q = r.question;
    if (v === null || v === undefined || v === "") return "—";
    if (q.type === "MCQ") return (Array.isArray(v) ? v : [v]).map((id: string) => q.choices?.find((c) => c.id === id)).filter(Boolean).map((c) => (lang === "ar" ? c!.ar : c!.fr)).join(", ") || "—";
    if (q.type === "TRUE_FALSE") return v ? t("quiz.true") : t("quiz.false");
    if (q.type === "NUMERIC") return `${typeof v === "object" ? v.answer : v} ${q.unit ?? ""}`;
    return Array.isArray(v) ? v.join(" ; ") : String(v);
  };
  return (
    <div className="mt-6">
      <h3 className="mb-3 text-lg font-semibold">📖 {t("quiz.review_title")}</h3>
      <div className="space-y-3">
        {items.map((r, k) => (
          <Card key={r.question.id} className={cx("border-s-4", r.correct ? "border-s-emerald-500" : "border-s-red-500")}>
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium">
                {k + 1}. {lang === "ar" ? r.question.textAr : r.question.textFr}
              </p>
              <Badge tone={r.correct ? "green" : "red"}>{r.correct ? "✓" : "✗"} {Number(r.earned.toFixed(2))}/{r.max}</Badge>
            </div>
            <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
              <dt className="text-ink-3">{t("quiz.your_answer")}</dt>
              <dd className={r.correct ? "text-emerald-700" : "text-red-700"}>{show(r, r.given)}</dd>
              <dt className="text-ink-3">{t("quiz.correct_answer")}</dt>
              <dd className="font-medium">{show(r, r.correctAnswer)}</dd>
            </dl>
            {(lang === "ar" ? r.explanationAr : r.explanationFr) && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-ink-2">💡 {lang === "ar" ? r.explanationAr : r.explanationFr}</p>}
          </Card>
        ))}
      </div>
    </div>
  );
}
