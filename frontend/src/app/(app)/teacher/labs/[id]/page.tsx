"use client";
// محرّر التجربة (أستاذ/مدير): الإعدادات (عتبة الكويز…)، تعريف الـ TP (JSON)، بنك الأسئلة، النتائج والتصدير.
// المعرّف "new" ينشئ تجربة جديدة انطلاقاً من نسخة تعريف تجربة موجودة.
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Alert, Badge, Button, Card, Empty, Field, Modal, PageLoader, Tabs, useUx } from "@/components/ui";
import { QuestionsTab } from "@/components/teacher/QuestionsTab";
import { api, ApiError, download, fetcher } from "@/lib/api";
import { useI18n } from "@/i18n";
import type { LabDefinition, LabSummary } from "@/lib/types";

type Tab = "settings" | "definition" | "questions" | "results";
interface FullLab extends LabSummary {
  definition: LabDefinition;
  classroomIds: string[];
}

export default function LabEditorPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("settings");
  const { data: lab, mutate } = useSWR<{ lab: FullLab }>(isNew ? null : `/labs/${id}`, fetcher);
  if (!isNew && !lab) return <PageLoader />;
  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold">{isNew ? t("teacher.new_lab") : lab!.lab.titleFr}</h1>
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "settings", label: t("teacher.tab.settings") },
          { id: "definition", label: t("teacher.tab.definition") },
          ...(isNew ? [] : [{ id: "questions" as Tab, label: t("teacher.tab.questions") }, { id: "results" as Tab, label: t("teacher.tab.results") }]),
        ]}
      />
      {(tab === "settings" || tab === "definition") && <Editor key={lab?.lab.id ?? "new"} lab={lab?.lab ?? null} tab={tab} onSaved={() => mutate()} />}
      {tab === "questions" && !isNew && <QuestionsTab labId={id} />}
      {tab === "results" && !isNew && <Results labId={id} />}
    </div>
  );
}

// ===================================================================== الإعدادات + التعريف
function Editor({ lab, tab, onSaved }: { lab: FullLab | null; tab: "settings" | "definition"; onSaved: () => void }) {
  const { t, lang, pick } = useI18n();
  const ux = useUx();
  const router = useRouter();
  const { data: classrooms } = useSWR<{ classrooms: { id: string; name: string }[] }>("/admin/classrooms", fetcher);
  const { data: devices } = useSWR<{ devices: { id: string; name: string }[] }>("/admin/devices", fetcher);
  const { data: labs } = useSWR<{ labs: LabSummary[] }>(lab ? null : "/labs", fetcher);

  const [f, setF] = useState(() => ({
    slug: lab?.slug ?? "",
    titleFr: lab?.titleFr ?? "",
    titleAr: lab?.titleAr ?? "",
    descriptionFr: lab?.descriptionFr ?? "",
    descriptionAr: lab?.descriptionAr ?? "",
    passThreshold: lab?.passThreshold ?? 70,
    maxAttempts: lab?.maxAttempts ?? 3,
    cooldownMinutes: lab?.cooldownMinutes ?? 10,
    quizMinutes: Math.round((lab?.quizTimeLimitSec ?? 600) / 60),
    quizQuestionCount: lab?.quizQuestionCount ?? null,
    published: lab?.published ?? false,
    deviceId: lab?.deviceId ?? "",
    classroomIds: lab?.classroomIds ?? [],
  }));
  const [defText, setDefText] = useState(lab ? JSON.stringify(lab.definition, null, 2) : "");
  const [issues, setIssues] = useState<{ path: string; message: string }[] | "ok" | null>(null);
  const [busy, setBusy] = useState(false);
  const [tplId, setTplId] = useState("");

  // تجربة جديدة: نبدأ من نسخة تعريف أول تجربة موجودة
  useEffect(() => {
    if (lab || defText || !labs?.labs.length) return;
    void loadTemplate(labs.labs[0].id);
  }, [labs]); // eslint-disable-line react-hooks/exhaustive-deps
  async function loadTemplate(id: string) {
    setTplId(id);
    const r = await api<{ lab: FullLab }>(`/labs/${id}`);
    setDefText(JSON.stringify(r.lab.definition, null, 2));
  }

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  const validate = async () => {
    try {
      const definition = JSON.parse(defText);
      const r = await api<{ valid: boolean; issues?: { path: string; message: string }[] }>("/labs/validate-definition", { method: "POST", body: { definition } });
      setIssues(r.valid ? "ok" : r.issues!);
    } catch (e) {
      setIssues(e instanceof SyntaxError ? [{ path: "JSON", message: e.message }] : null);
      if (!(e instanceof SyntaxError)) ux.error(e);
    }
  };

  const save = async () => {
    let definition: unknown;
    try {
      definition = JSON.parse(defText);
    } catch (e) {
      setIssues([{ path: "JSON", message: (e as Error).message }]);
      return ux.toast(t("teacher.json_invalid"), "error");
    }
    setBusy(true);
    try {
      const { quizMinutes, ...rest } = f;
      const body = { ...rest, deviceId: f.deviceId || null, quizTimeLimitSec: quizMinutes * 60, definition };
      if (lab) {
        await api(`/labs/${lab.id}`, { method: "PATCH", body });
        ux.toast(t("common.saved"), "success");
        onSaved();
      } else {
        const r = await api<{ lab: { id: string } }>("/labs", { method: "POST", body });
        router.replace(`/teacher/labs/${r.lab.id}`);
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === "INVALID_DEFINITION" && Array.isArray(e.details)) setIssues(e.details);
      ux.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {tab === "settings" ? (
        <>
          <Card className="grid gap-4 md:grid-cols-2">
            <Field label={t("teacher.f.title_fr")}>
              <input className="input" value={f.titleFr} onChange={(e) => set("titleFr", e.target.value)} dir="ltr" />
            </Field>
            <Field label={t("teacher.f.title_ar")}>
              <input className="input" value={f.titleAr} onChange={(e) => set("titleAr", e.target.value)} dir="rtl" />
            </Field>
            <Field label={t("teacher.f.desc_fr")}>
              <textarea className="input min-h-20" value={f.descriptionFr} onChange={(e) => set("descriptionFr", e.target.value)} dir="ltr" />
            </Field>
            <Field label={t("teacher.f.desc_ar")}>
              <textarea className="input min-h-20" value={f.descriptionAr} onChange={(e) => set("descriptionAr", e.target.value)} dir="rtl" />
            </Field>
            <Field label="Slug" hint={t("teacher.f.slug_hint")}>
              <input className="input num" value={f.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} dir="ltr" />
            </Field>
            <Field label={t("teacher.f.device")}>
              <select className="input" value={f.deviceId} onChange={(e) => set("deviceId", e.target.value)}>
                <option value="">—</option>
                {devices?.devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
          </Card>

          <Card>
            <h2 className="mb-1 font-semibold">{t("teacher.f.quiz_rules")}</h2>
            <p className="mb-4 text-sm text-ink-3">{t("teacher.f.quiz_rules_sub")}</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label={t("teacher.f.threshold")} hint={t("teacher.f.threshold_hint")}>
                <input className="input num" type="number" min={1} max={100} value={f.passThreshold} onChange={(e) => set("passThreshold", Number(e.target.value))} />
              </Field>
              <Field label={t("teacher.f.attempts")}>
                <input className="input num" type="number" min={1} max={20} value={f.maxAttempts} onChange={(e) => set("maxAttempts", Number(e.target.value))} />
              </Field>
              <Field label={t("teacher.f.cooldown")}>
                <input className="input num" type="number" min={0} max={1440} value={f.cooldownMinutes} onChange={(e) => set("cooldownMinutes", Number(e.target.value))} />
              </Field>
              <Field label={t("teacher.f.duration")}>
                <input className="input num" type="number" min={1} max={240} value={f.quizMinutes} onChange={(e) => set("quizMinutes", Number(e.target.value))} />
              </Field>
              <Field label={t("teacher.f.q_count")} hint={t("teacher.f.q_count_hint")}>
                <input className="input num" type="number" min={1} value={f.quizQuestionCount ?? ""} onChange={(e) => set("quizQuestionCount", e.target.value ? Number(e.target.value) : null)} />
              </Field>
            </div>
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">{t("teacher.f.visibility")}</h2>
            <label className="mb-4 flex items-center gap-2">
              <input type="checkbox" checked={f.published} onChange={(e) => set("published", e.target.checked)} />
              {t("teacher.f.published")}
            </label>
            <div className="mb-2 text-sm font-medium text-ink-2">{t("teacher.f.classrooms")}</div>
            <div className="flex flex-wrap gap-2">
              {classrooms?.classrooms.map((c) => {
                const on = f.classroomIds.includes(c.id);
                return (
                  <button key={c.id} onClick={() => set("classroomIds", on ? f.classroomIds.filter((x) => x !== c.id) : [...f.classroomIds, c.id])} className={`rounded-full border px-3 py-1 text-sm ${on ? "border-brand-600 bg-brand-50 text-brand-700" : "border-line bg-white text-ink-2"}`} aria-pressed={on}>
                    {c.name}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-ink-3">{t("teacher.f.classrooms_hint")}</p>
          </Card>
        </>
      ) : (
        <Card className="space-y-3">
          {!lab && labs && (
            <Field label={t("teacher.f.template")}>
              <select className="input max-w-md" value={tplId} onChange={(e) => loadTemplate(e.target.value)}>
                {labs.labs.map((l) => (
                  <option key={l.id} value={l.id}>
                    {pick(l, "title")}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <p className="text-sm text-ink-3">{t("teacher.def_hint")}</p>
          <textarea className="input num h-[28rem] font-mono text-xs leading-relaxed" dir="ltr" spellCheck={false} value={defText} onChange={(e) => (setDefText(e.target.value), setIssues(null))} />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={validate}>
              {t("teacher.validate")}
            </Button>
            {issues === "ok" && <Badge tone="green">✓ {t("teacher.def_valid")}</Badge>}
          </div>
          {Array.isArray(issues) && (
            <ul className="max-h-56 overflow-y-auto rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" dir="ltr">
              {issues.map((i, k) => (
                <li key={k}>
                  <code className="font-semibold">{i.path || "·"}</code>: {i.message}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {lang && (
        <div className="flex justify-end">
          <Button size="lg" onClick={save} loading={busy} disabled={!f.slug || f.titleFr.length < 2 || f.titleAr.length < 2}>
            {lab ? t("common.save") : t("teacher.create")}
          </Button>
        </div>
      )}
    </div>
  );
}

// ===================================================================== النتائج
interface Row {
  studentId: string;
  name: string;
  email: string;
  classroom: string;
  stage: "stage1" | "stage2" | "stage3" | "done";
  stage1Percent: number;
  quizAttemptsUsed: number;
  attemptsAllowed: number;
  quizBestPercent: number | null;
  quizPassed: boolean;
  remoteUnlocked: boolean;
  remoteCompleted: boolean;
  remotePoints: number;
  lastActivity: string | null;
}

function Results({ labId }: { labId: string }) {
  const { t, fmtDateTime } = useI18n();
  const ux = useUx();
  const { data, mutate } = useSWR<{ rows: Row[] }>(`/teacher/labs/${labId}/results`, fetcher, { refreshInterval: 20_000 });
  const [detail, setDetail] = useState<Row | null>(null);
  const [filter, setFilter] = useState<"all" | Row["stage"]>("all");

  const rows = useMemo(() => (data?.rows ?? []).filter((r) => filter === "all" || r.stage === filter), [data, filter]);
  if (!data) return <PageLoader />;

  const grant = async (r: Row) => {
    try {
      await api(`/teacher/labs/${labId}/students/${r.studentId}/extra-attempts`, { method: "POST", body: { count: 1 } });
      ux.toast(t("teacher.extra_granted"), "success");
      await mutate();
    } catch (e) {
      ux.error(e);
    }
  };
  const stageTone = { stage1: "blue", stage2: "amber", stage3: "green", done: "slate" } as const;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {(["all", "stage1", "stage2", "stage3", "done"] as const).map((k) => (
            <button key={k} onClick={() => setFilter(k)} className={`rounded-full border px-3 py-1 text-sm ${filter === k ? "border-brand-600 bg-brand-50 text-brand-700" : "border-line bg-white text-ink-2"}`}>
              {k === "all" ? t("common.all") : k === "done" ? t("stage.done") : t(`stage.${k.slice(-1)}.short`)}
              <span className="num ms-1.5 text-ink-3">{k === "all" ? data.rows.length : data.rows.filter((r) => r.stage === k).length}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => download(`/teacher/labs/${labId}/export.csv`, "results.csv").catch(ux.error)}>
            CSV ↓
          </Button>
          <Button size="sm" variant="secondary" onClick={() => download(`/teacher/labs/${labId}/export.xlsx`, "results.xlsx").catch(ux.error)}>
            Excel ↓
          </Button>
        </div>
      </div>

      {!rows.length ? (
        <Empty>{t("teacher.no_students")}</Empty>
      ) : (
        <Card className="scroll-x p-0">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-slate-50 text-ink-3">
              <tr>
                {["teacher.col.student", "teacher.col.stage", "teacher.col.s1", "teacher.col.attempts", "teacher.col.best", "teacher.col.remote", "teacher.col.last"].map((k) => (
                  <th key={k} className="px-3 py-3 text-start font-medium">
                    {t(k)}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.studentId} className="border-t border-line">
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-ink-3">{r.classroom}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={stageTone[r.stage]}>{r.stage === "done" ? t("stage.done") : t(`stage.${r.stage.slice(-1)}.short`)}</Badge>
                  </td>
                  <td className="num px-3 py-2.5">{r.stage1Percent}%</td>
                  <td className="num px-3 py-2.5">
                    {r.quizAttemptsUsed}/{r.attemptsAllowed}
                  </td>
                  <td className="px-3 py-2.5">{r.quizBestPercent === null ? "—" : <Badge tone={r.quizPassed ? "green" : "red"}>{r.quizBestPercent}%</Badge>}</td>
                  <td className="px-3 py-2.5">{r.remoteCompleted ? <Badge tone="green">✓ {r.remotePoints}</Badge> : r.remoteUnlocked ? <Badge tone="amber">{t("stage.available")}</Badge> : <span className="text-ink-3">🔒</span>}</td>
                  <td className="num px-3 py-2.5 text-ink-3">{r.lastActivity ? fmtDateTime(r.lastActivity) : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-end">
                    <Button size="sm" variant="ghost" onClick={() => setDetail(r)}>
                      {t("common.details")}
                    </Button>
                    {r.quizAttemptsUsed >= r.attemptsAllowed && !r.quizPassed && (
                      <Button size="sm" variant="secondary" onClick={() => grant(r)}>
                        +1 {t("teacher.attempt")}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <StudentDetail labId={labId} row={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

function StudentDetail({ labId, row, onClose }: { labId: string; row: Row | null; onClose: () => void }) {
  const { t, fmtDateTime } = useI18n();
  const ux = useUx();
  const { data } = useSWR<{
    attempts: { id: string; number: number; status: string; percent: number | null; passed: boolean | null; startedAt: string; submittedAt: string | null }[];
    reports: { id: string; kind: string; createdAt: string }[];
    bookings: { id: string; status: string; startsAt: string }[];
  }>(row ? `/teacher/labs/${labId}/students/${row.studentId}` : null, fetcher);
  return (
    <Modal open={!!row} onClose={onClose} title={row?.name ?? ""} wide>
      {!data ? (
        <PageLoader />
      ) : (
        <div className="space-y-5">
          <section>
            <h3 className="mb-2 font-semibold">{t("teacher.quiz_attempts")}</h3>
            {!data.attempts.length ? (
              <p className="text-sm text-ink-3">—</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {data.attempts.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                    <span>
                      #{a.number} · <span className="num text-ink-3">{fmtDateTime(a.startedAt)}</span>
                    </span>
                    {a.percent === null ? <Badge tone="blue">{t("teacher.in_progress")}</Badge> : <Badge tone={a.passed ? "green" : "red"}>{a.percent}%</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3 className="mb-2 font-semibold">{t("nav.reports")}</h3>
            {!data.reports.length ? (
              <p className="text-sm text-ink-3">—</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {data.reports.map((r) => (
                  <li key={r.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                    <span>
                      {t(`report.kind.${r.kind}`)} · <span className="num text-ink-3">{fmtDateTime(r.createdAt)}</span>
                    </span>
                    <Button size="sm" variant="secondary" onClick={() => download(`/reports/${r.id}/download`, "report.pdf").catch(ux.error)}>
                      PDF ↓
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3 className="mb-2 font-semibold">{t("teacher.bookings")}</h3>
            {!data.bookings.length ? (
              <p className="text-sm text-ink-3">—</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {data.bookings.map((b) => (
                  <li key={b.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                    <span className="num">{fmtDateTime(b.startsAt)}</span>
                    <Badge>{t(`booking.${b.status}`)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <Alert tone="blue">{t("teacher.detail_note")}</Alert>
        </div>
      )}
    </Modal>
  );
}
