"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { download, fetcher } from "@/lib/api";
import { useI18n } from "@/i18n";
import { Alert, Badge, Button, Card, PageLoader, ProgressBar, cx, useUx } from "@/components/ui";
import { StageStepper, stageStates } from "@/components/Path";
import type { LabSummary, Status } from "@/lib/types";

interface Report {
  id: string;
  kind: "VIRTUAL" | "REMOTE";
  createdAt: string;
}

export default function LabOverview() {
  const { slug } = useParams<{ slug: string }>();
  const { t, pick, fmtDateTime } = useI18n();
  const { error } = useUx();
  const { data, isLoading } = useSWR<{ lab: LabSummary & { status: Status } }>(`/labs/${slug}`, fetcher);
  const { data: reps } = useSWR<{ reports: Report[] }>(data ? `/reports?labId=${data.lab.id}` : null, fetcher);
  if (isLoading || !data) return <PageLoader />;
  const lab = data.lab;
  const s = lab.status;
  const st = stageStates(s);
  const cd = s.stage2.cooldownUntil ? new Date(s.stage2.cooldownUntil) : null;

  const cards = [
    {
      n: 1,
      color: "border-s1",
      state: st[0],
      title: t("stage.1.name"),
      body: t("stage.1.long"),
      meta: <ProgressBar value={s.stage1.percent} color="bg-s1" />,
      metaText: `${s.stage1.percent}%`,
      href: `/labs/${slug}/simulation`,
      cta: s.stage1.percent === 0 ? t("labs.start") : st[0] === "done" ? t("path.redo") : t("labs.continue"),
      lock: "",
    },
    {
      n: 2,
      color: "border-s2",
      state: st[1],
      title: t("stage.2.name"),
      body: t("stage.2.long", { n: lab.passThreshold, tries: s.stage2.attemptsAllowed, min: Math.round(lab.quizTimeLimitSec / 60) }),
      meta: null,
      metaText: s.stage2.state === "locked" ? "" : t("quiz.attempts_line", { used: s.stage2.attemptsUsed, total: s.stage2.attemptsAllowed }) + (s.stage2.bestPercent !== null ? ` · ${t("quiz.best")} ${s.stage2.bestPercent}%` : ""),
      href: `/labs/${slug}/quiz`,
      cta: s.stage2.state === "passed" ? t("path.view_results") : s.stage2.state === "failed_final" ? t("path.view_results") : t("path.take_quiz"),
      lock: t("path.lock.stage2"),
    },
    {
      n: 3,
      color: "border-s3",
      state: st[2],
      title: t("stage.3.name"),
      body: t("stage.3.long"),
      meta: null,
      metaText: s.stage3.state === "completed" ? t("stage.done") : "",
      href: `/labs/${slug}/remote`,
      cta: s.stage3.state === "completed" ? t("path.view_results") : t("path.book"),
      lock: t("path.lock.stage3", { n: lab.passThreshold }),
    },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/labs" className="text-sm text-brand-700 hover:underline">
        ← {t("nav.labs")}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{pick(lab, "title")}</h1>
      <p className="mt-1 text-ink-3">{pick(lab, "description")}</p>

      <Card className="mt-6">
        <StageStepper status={s} slug={slug} />
      </Card>

      <div className="mt-6 space-y-4">
        {cards.map((c, i) => {
          const locked = c.state === "locked";
          return (
            <Card key={c.n} className={cx("border-s-4", locked ? "border-s-slate-300 bg-slate-50/70" : c.color.replace("border-", "border-s-"))}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">{t("path.stage", { n: c.n })}</span>
                    {locked ? <Badge tone="slate">🔒 {t("stage.locked")}</Badge> : c.state === "done" ? <Badge tone="green">✓ {t("stage.done")}</Badge> : <Badge tone="blue">{t("stage.available")}</Badge>}
                  </div>
                  <h2 className="mt-1 text-lg font-semibold">{c.title}</h2>
                  <p className="mt-1 text-sm text-ink-2">{c.body}</p>
                  {c.meta && <div className="mt-3 max-w-sm">{c.meta}</div>}
                  {c.metaText && <div className="num mt-2 text-sm font-medium text-ink-2">{c.metaText}</div>}
                  {locked && <p className="mt-2 text-sm text-ink-3">{c.lock}</p>}
                  {c.n === 2 && cd && <Alert tone="amber" className="mt-3">{t("quiz.cooldown_until", { time: fmtDateTime(cd) })}</Alert>}
                  {c.n === 2 && s.stage2.state === "failed_final" && <Alert tone="red" className="mt-3">{t("quiz.failed_final")}</Alert>}
                </div>
                {!locked && (
                  <Link href={c.href}>
                    <Button variant={c.state === "done" ? "secondary" : "primary"}>{c.cta}</Button>
                  </Link>
                )}
              </div>
              {i < 2 && <div className="sr-only">→</div>}
            </Card>
          );
        })}
      </div>

      {!!reps?.reports.length && (
        <Card className="mt-6">
          <h3 className="mb-3 font-semibold">{t("nav.reports")}</h3>
          <ul className="divide-y divide-line">
            {reps.reports.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>
                  <Badge tone={r.kind === "VIRTUAL" ? "blue" : "green"}>{t(`report.${r.kind}`)}</Badge> <span className="ms-2 text-ink-3">{fmtDateTime(r.createdAt)}</span>
                </span>
                <Button size="sm" variant="secondary" onClick={() => download(`/reports/${r.id}/download`, "report.pdf").catch(error)}>
                  PDF ↓
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
