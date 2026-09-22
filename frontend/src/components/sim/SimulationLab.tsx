"use client";
// المرحلة 1: TP افتراضي تفاعلي — رسم متحرك + أجهزة قياس + تسجيل نقاط + منحنى + حفظ تلقائي + تقرير PDF
// الخادم هو الذي يعتمد كل خطوة (تسلسل إجباري)؛ الواجهة تعرض فقط الحالة وترسل المحاولات.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ApiError, api, download, fetcher } from "@/lib/api";
import { useI18n } from "@/i18n";
import { Alert, Badge, Button, Card, PageLoader, ProgressBar, cx, useUx } from "@/components/ui";
import { Chart, type Series } from "@/components/Chart";
import { Circuit } from "./circuits";
import { clamp, fmt, linreg, makeCalc, noisy, pv } from "./util";
import type { LabDefinition, LabSummary, Point, Status, Step } from "@/lib/types";

interface SimData {
  definition: LabDefinition;
  progress: { percent: number; steps: Record<string, { done: true; answer?: number }>; points: Point[]; draft: any; currentStepIndex: number; completedAt: string | null; status: Status };
}

const T_MAX = 30;

export function SimulationLab({ slug }: { slug: string }) {
  const { t, tr, pick, fmtNum } = useI18n();
  const { toast, error } = useUx();
  const { data, mutate } = useSWR<SimData>(`/labs/${slug}/simulation`, fetcher, { revalidateOnFocus: false });
  const { data: labData } = useSWR<{ lab: LabSummary }>(`/labs/${slug}`, fetcher);

  const [params, setParams] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const [tClock, setTClock] = useState(0);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [answer, setAnswer] = useState("");
  const [stepErr, setStepErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [reportId, setReportId] = useState<string | null>(null);
  const inited = useRef(false);

  const def = data?.definition;
  const prog = data?.progress;
  const isRc = def?.simulator === "rc";

  // ---- تهيئة الحالة من المسودة المحفوظة (استئناف من حيث توقف الطالب) ----
  useEffect(() => {
    if (!def || !prog || inited.current) return;
    inited.current = true;
    const p: Record<string, number> = {};
    def.parameters.forEach((x) => (p[x.key] = x.default));
    Object.assign(p, prog.draft?.params ?? {});
    delete p.t;
    setParams(p);
    setNotes(prog.draft?.notes ?? "");
    if (typeof prog.draft?.t === "number") setTClock(clamp(prog.draft.t, 0, T_MAX));
  }, [def, prog]);

  // ---- ساعة دارة RC ----
  useEffect(() => {
    if (!running) return;
    const i = setInterval(() => {
      setTClock((v) => {
        const nv = Math.min(T_MAX, v + 0.1 * speed);
        if (nv >= T_MAX) setRunning(false);
        return nv;
      });
    }, 100);
    return () => clearInterval(i);
  }, [running, speed]);

  // ---- حفظ تلقائي (debounce) ----
  useEffect(() => {
    if (!inited.current || !def) return;
    setSave("saving");
    const h = setTimeout(async () => {
      try {
        await api(`/labs/${slug}/simulation/draft`, { method: "PUT", body: { draft: { params, notes, t: isRc ? Number(tClock.toFixed(1)) : undefined } } });
        setSave("saved");
      } catch {
        setSave("error");
      }
    }, 1200);
    return () => clearTimeout(h);
  }, [params, notes, running]); // eslint-disable-line react-hooks/exhaustive-deps

  const calc = useMemo(() => (def ? makeCalc(def) : null), [def]);

  const effParams = useMemo(() => (isRc ? { ...params, t: tClock } : params), [params, tClock, isRc]);
  const reading = useMemo(() => {
    if (!def || !calc || !Object.keys(params).length) return {} as Record<string, number>;
    const vals = calc(effParams);
    const seed = isRc ? Math.floor(tClock * 4) : Object.values(params).reduce((a, b) => a * 31 + b * 1000, 7) | 0;
    const out: Record<string, number> = { ...effParams };
    for (const o of def.outputs) out[o.key] = noisy(vals[o.key], def.noise, seed, o.key);
    return out;
  }, [def, calc, effParams, params, isRc, tClock]);

  const setParam = (key: string, v: number) => {
    setParams((p) => ({ ...p, [key]: v }));
    if (isRc && (key === "E" || key === "R" || key === "C")) {
      setRunning(false);
      setTClock(0);
    }
  };

  const idx = prog?.currentStepIndex ?? 0;
  const step: Step | undefined = def?.steps[idx];
  const allDone = !!def && idx >= def.steps.length;
  const done = (id: string) => !!prog?.steps[id]?.done;

  const labelOf = useCallback(
    (k: string) => {
      const p = def?.parameters.find((x) => x.key === k);
      if (p) return { label: tr(p.label), unit: p.unit };
      const o = def?.outputs.find((x) => x.key === k);
      return { label: o ? tr(o.label) : k, unit: o?.unit ?? "" };
    },
    [def, tr],
  );

  // ---- الإجراءات ----
  async function submitStep(body: Record<string, unknown> = {}) {
    if (!step) return;
    setBusy(true);
    setStepErr(null);
    try {
      await api(`/labs/${slug}/simulation/steps/${step.id}`, { method: "POST", body });
      setAnswer("");
      await mutate();
      toast(t("sim.step_done"), "success");
    } catch (e) {
      if (e instanceof ApiError && ["WRONG_ANSWER", "NO_DATA", "NOT_ENOUGH_POINTS", "SETUP_MISMATCH"].includes(e.code)) {
        setStepErr(t(`err.${e.code}`, { tol: e.details?.tolerancePct ?? "", need: e.details?.need ?? "", have: e.details?.have ?? "", key: e.details?.key ?? "" }));
      } else error(e);
    } finally {
      setBusy(false);
    }
  }

  async function record() {
    if (!def || !calc) return;
    setBusy(true);
    try {
      const p = isRc ? { ...params, t: Math.round(tClock * 10) / 10 } : params;
      const vals = calc(p);
      const seed = isRc ? Math.floor(p.t! * 4) : Object.values(params).reduce((a, b) => a * 31 + b * 1000, 7) | 0;
      const values: Record<string, number> = {};
      for (const o of def.outputs) values[o.key] = noisy(vals[o.key], def.noise, seed, o.key);
      await api(`/labs/${slug}/simulation/points`, { method: "POST", body: { params: p, values } });
      await mutate();
    } catch (e) {
      if (e instanceof ApiError && e.code === "DUPLICATE_POINT") toast(t("err.DUPLICATE_POINT"), "error");
      else if (e instanceof ApiError && e.code === "LOCKED_PARAM_CHANGED") toast(t("err.LOCKED_PARAM_CHANGED", { key: e.details?.key ?? "" }), "error");
      else error(e);
    } finally {
      setBusy(false);
    }
  }

  async function clearPoints() {
    try {
      await api(`/labs/${slug}/simulation/points`, { method: "DELETE" });
      await mutate();
    } catch (e) {
      error(e);
    }
  }

  async function makeReport() {
    setBusy(true);
    try {
      const r = await api<{ reportId: string }>(`/labs/${slug}/simulation/report`, { method: "POST" });
      setReportId(r.reportId);
      await mutate();
      toast(t("sim.report_ready"), "success");
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
    }
  }

  // ---- بيانات المخطط ----
  const points = prog?.points ?? [];
  const chart = useMemo(() => {
    if (!def) return null;
    const xs = points.map((p) => pv(p, def.plot.x));
    const ys = points.map((p) => pv(p, def.plot.y));
    const pts = xs.map((x, i) => ({ x, y: ys[i] }));
    const series: Series[] = [{ id: "m", name: t("sim.measures"), kind: def.simulator === "ohm" ? "scatter" : "line", points: pts }];
    if (def.simulator === "ohm" && pts.length >= 2) {
      const r = linreg(xs, ys);
      if (r) {
        const xmax = Math.max(...xs) * 1.05;
        series.push({ id: "fit", name: t("sim.fit"), kind: "fit", points: [{ x: 0, y: r.intercept }, { x: xmax, y: r.intercept + r.slope * xmax }] });
      }
    }
    return series;
  }, [def, points, t]);

  if (!def || !prog || !calc) return <PageLoader />;
  const title = labData ? pick(labData.lab, "title") : "";
  const measureStep = step?.type === "measure" ? step : null;
  const showControls = !allDone;
  const nMeasure = measureStep ? points.length : 0;

  const cols = [...(def.parameters.some((p) => p.key === def.plot.x) ? [def.plot.x] : []), ...def.outputs.map((o) => o.key)];
  const stepTypeIcon = (s: Step) => ({ read: "📖", setup: "🔧", measure: "📏", compute: "🧮", report: "📄" })[s.type];

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-2 text-sm">
        <Link href={`/labs/${slug}`} className="text-brand-700 hover:underline">
          ← {title}
        </Link>
      </div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Badge tone="blue">{t("path.stage", { n: 1 })}</Badge>
          <h1 className="mt-1 text-2xl font-semibold">{t("stage.1.name")}</h1>
        </div>
        <div className="w-full max-w-xs">
          <div className="mb-1 flex items-center justify-between text-xs text-ink-3">
            <span className="num font-medium text-ink-2">{prog.percent}%</span>
            <span aria-live="polite">{save === "saving" ? t("sim.saving") : save === "saved" ? "✓ " + t("sim.saved") : save === "error" ? t("sim.save_error") : ""}</span>
          </div>
          <ProgressBar value={prog.percent} />
        </div>
      </div>

      {/* شريط الخطوات */}
      <ol className="scroll-x mb-5 flex gap-2 pb-1">
        {def.steps.map((s, i) => {
          const d = done(s.id);
          const cur = i === idx;
          return (
            <li key={s.id} className={cx("flex min-w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-sm", d ? "border-emerald-200 bg-emerald-50 text-emerald-800" : cur ? "border-brand-300 bg-brand-50 font-medium text-brand-800" : "border-line bg-white text-ink-3")}>
              <span>{d ? "✓" : stepTypeIcon(s)}</span>
              <span>{tr(s.title)}</span>
            </li>
          );
        })}
      </ol>

      <div className="grid gap-5 lg:grid-cols-12">
        {/* ---------------- الخطوة الحالية ---------------- */}
        <div className="space-y-4 lg:col-span-5">
          {allDone ? (
            <Card className="border-emerald-200 bg-emerald-50">
              <div className="text-3xl">🎉</div>
              <h2 className="mt-2 text-lg font-semibold text-emerald-900">{t("sim.completed_title")}</h2>
              <p className="mt-1 text-sm text-emerald-900/80">{t("sim.completed_body")}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href={`/labs/${slug}/quiz`}>
                  <Button variant="amber">{t("sim.go_quiz")}</Button>
                </Link>
                {reportId && (
                  <Button variant="secondary" onClick={() => download(`/reports/${reportId}/download`, "report.pdf").catch(error)}>
                    PDF ↓
                  </Button>
                )}
              </div>
            </Card>
          ) : (
            step && (
              <Card>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
                  {t("sim.step_n", { n: idx + 1, total: def.steps.length })}
                </div>
                <h2 className="mt-1 text-lg font-semibold">{tr(step.title)}</h2>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">{tr(step.body)}</p>

                {step.type === "read" && (
                  <Button className="mt-4" loading={busy} onClick={() => submitStep()}>
                    {t("sim.understood")}
                  </Button>
                )}

                {step.type === "setup" && (
                  <div className="mt-4 space-y-3">
                    <ul className="space-y-1.5">
                      {Object.entries(step.require).map(([k, v]) => {
                        const ok = Math.abs((params[k] ?? NaN) - v) < 1e-9;
                        const pl = labelOf(k);
                        return (
                          <li key={k} className={cx("flex items-center gap-2 rounded-lg border px-3 py-2 text-sm", ok ? "border-emerald-200 bg-emerald-50" : "border-line bg-slate-50")}>
                            <span>{ok ? "✅" : "⬜"}</span>
                            <span className="flex-1">{pl.label}</span>
                            <span className="num font-semibold">
                              {v} {pl.unit}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    <Button loading={busy} onClick={() => submitStep({ params })}>
                      {t("sim.validate_setup")}
                    </Button>
                  </div>
                )}

                {step.type === "measure" && (
                  <div className="mt-4 space-y-3">
                    <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <span>{t("sim.points_count")}</span>
                      <span className={cx("num font-semibold", nMeasure >= step.minPoints ? "text-emerald-700" : "text-ink")}>
                        {nMeasure} / {step.minPoints}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button loading={busy} variant="secondary" onClick={clearPoints} disabled={!points.length}>
                        {t("sim.clear_points")}
                      </Button>
                      <Button loading={busy} disabled={nMeasure < step.minPoints} onClick={() => submitStep()}>
                        {t("sim.validate_measures")}
                      </Button>
                    </div>
                    {step.lock.length > 0 && <p className="text-xs text-ink-3">{t("sim.lock_hint", { keys: step.lock.map((k) => labelOf(k).label).join(", ") })}</p>}
                  </div>
                )}

                {step.type === "compute" && (
                  <form
                    className="mt-4 space-y-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void submitStep({ answer: answer.replace(",", ".") });
                    }}
                  >
                    <label className="block text-sm font-medium">{tr(step.quantity)}</label>
                    <div className="flex items-center gap-2">
                      <input className="input num max-w-48" inputMode="decimal" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="0.00" required dir="ltr" />
                      <span className="text-ink-2">{step.unit}</span>
                    </div>
                    <p className="text-xs text-ink-3">{t("sim.tolerance", { n: step.tolerancePct })}</p>
                    <Button type="submit" loading={busy}>
                      {t("sim.check")}
                    </Button>
                  </form>
                )}

                {step.type === "report" && (
                  <Button className="mt-4" loading={busy} onClick={makeReport}>
                    📄 {t("sim.generate_report")}
                  </Button>
                )}

                {stepErr && <Alert tone="red" className="mt-3">{stepErr}</Alert>}
              </Card>
            )
          )}

          <Card>
            <label className="mb-1 block text-sm font-medium text-ink-2">{t("sim.notes")}</label>
            <textarea className="input min-h-20 text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("sim.notes_ph")} maxLength={2000} />
          </Card>
        </div>

        {/* ---------------- المحاكي ---------------- */}
        <div className="space-y-4 lg:col-span-7">
          <Card className="overflow-hidden p-0">
            <div className="border-b border-line bg-slate-50 px-4 py-2 text-sm font-medium text-ink-2">{t("sim.bench")}</div>
            <div className="bg-white p-3 sm:p-5">
              <div className="mx-auto max-w-xl">
                <Circuit kind={def.simulator} reading={reading} params={effParams} running={running} t={tClock} />
              </div>
            </div>

            {/* عناصر التحكم */}
            <div className="space-y-4 border-t border-line p-4">
              {def.parameters
                .filter((p) => !(isRc && p.key === "t"))
                .map((p) => (
                  <div key={p.key}>
                    <div className="mb-1.5 flex items-center justify-between text-sm">
                      <span className="font-medium">{tr(p.label)}</span>
                      <span className="num rounded bg-slate-100 px-2 py-0.5 font-semibold">
                        {fmtNum(params[p.key] ?? p.default, 2)} {p.unit}
                      </span>
                    </div>
                    {p.options?.length ? (
                      <div className="flex flex-wrap gap-2">
                        {p.options.map((o) => (
                          <button key={o} disabled={!showControls} onClick={() => setParam(p.key, o)} className={cx("num rounded-lg border px-3 py-1.5 text-sm font-medium transition", params[p.key] === o ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-white hover:border-brand-300")}>
                            {o} {p.unit}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <input type="range" className="w-full accent-brand-600" min={p.min} max={p.max} step={p.step} value={params[p.key] ?? p.default} onChange={(e) => setParam(p.key, Number(e.target.value))} disabled={!showControls} aria-label={tr(p.label)} />
                    )}
                  </div>
                ))}

              {isRc && (
                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-medium">{t("sim.clock")}</span>
                    <span className="num font-semibold">t = {fmt(tClock, 1)} s</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant={running ? "secondary" : "success"} onClick={() => setRunning((r) => !r)} disabled={tClock >= T_MAX}>
                      {running ? "⏸ " + t("sim.pause") : "▶ " + t("sim.charge")}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => (setRunning(false), setTClock(0))}>
                      ↺ {t("sim.reset")}
                    </Button>
                    <div className="ms-auto flex items-center gap-1 text-xs">
                      {[1, 2, 4].map((s) => (
                        <button key={s} onClick={() => setSpeed(s)} className={cx("num rounded px-2 py-1", speed === s ? "bg-brand-600 text-white" : "bg-white text-ink-2 ring-1 ring-line")}>
                          ×{s}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* قراءات رقمية */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {def.outputs.map((o) => (
                  <div key={o.key} className="rounded-lg border border-line bg-white px-3 py-2">
                    <div className="text-xs text-ink-3">{tr(o.label)}</div>
                    <div className="num text-lg font-semibold">
                      {fmt(reading[o.key] ?? 0, o.decimals)} <span className="text-sm font-normal text-ink-3">{o.unit}</span>
                    </div>
                  </div>
                ))}
              </div>

              {measureStep && (
                <Button size="lg" className="w-full" variant="success" loading={busy} onClick={record}>
                  ➕ {t("sim.record")}
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* ---------------- البيانات + المنحنى ---------------- */}
      {(points.length > 0 || measureStep) && chart && (
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <Card>
            <h3 className="mb-3 font-semibold">{t("sim.table")}</h3>
            {points.length === 0 ? (
              <p className="text-sm text-ink-3">{t("sim.no_points")}</p>
            ) : (
              <div className="scroll-x max-h-80 overflow-y-auto rounded-lg border border-line">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-xs text-ink-3">
                    <tr>
                      <th className="px-3 py-2 text-start">#</th>
                      {cols.map((k) => (
                        <th key={k} className="px-3 py-2 text-start">
                          {labelOf(k).label} <span className="font-normal">({labelOf(k).unit})</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {points.map((p, i) => (
                      <tr key={i} className="num border-t border-line">
                        <td className="px-3 py-1.5 text-ink-3">{i + 1}</td>
                        {cols.map((k) => (
                          <td key={k} className="px-3 py-1.5">
                            {fmt(pv(p, k), def.outputs.find((o) => o.key === k)?.decimals ?? 2)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card>
            <h3 className="mb-3 font-semibold">{t("sim.curve")}</h3>
            <Chart series={chart} xLabel={`${tr(def.plot.xLabel)}`} yLabel={`${tr(def.plot.yLabel)}`} xUnit={labelOf(def.plot.x).unit} yUnit={labelOf(def.plot.y).unit} showTable />
          </Card>
        </div>
      )}
    </div>
  );
}
