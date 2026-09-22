"use client";
// لوحة القيادة: عرض مختلف لكل دور (طالب: تقدّمه + حصصه؛ أستاذ/مدير: قمع المراحل لكل TP + حالة الأجهزة)
import Link from "next/link";
import useSWR from "swr";
import { Badge, Button, Card, Empty, PageLoader } from "@/components/ui";
import { StageStepper, STAGE_ROUTE, nextStage } from "@/components/Path";
import { fetcher } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/i18n";
import type { Status } from "@/lib/types";

export default function DashboardPage() {
  const { user } = useAuth();
  if (!user) return null;
  return user.role === "STUDENT" ? <StudentDash /> : <StaffDash admin={user.role === "ADMIN"} />;
}

// ------------------------------------------------------------------ الطالب
function StudentDash() {
  const { t, pick, fmtDateTime, fmtNum } = useI18n();
  const { user } = useAuth();
  const { data } = useSWR<{
    labs: { id: string; slug: string; titleAr: string; titleFr: string; status: Status }[];
    quizResults: { id: string; lab: { titleAr: string; titleFr: string; slug: string }; number: number; percent: number; passed: boolean; submittedAt: string }[];
    upcomingBookings: { id: string; status: string; startsAt: string; endsAt: string; lab: { titleAr: string; titleFr: string; slug: string } }[];
  }>("/student/dashboard", fetcher, { refreshInterval: 30_000 });
  if (!data) return <PageLoader />;

  const total = data.labs.length * 3;
  const done = data.labs.reduce((a, l) => a + (l.status.stage1.state === "completed" ? 1 : 0) + (l.status.stage2.state === "passed" ? 1 : 0) + (l.status.stage3.state === "completed" ? 1 : 0), 0);
  const nextLab = data.labs.find((l) => nextStage(l.status) !== 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("dash.hello", { name: user!.name.split(" ")[0] })}</h1>
        <p className="mt-1 text-ink-3">{t("dash.student_sub")}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <div className="text-sm text-ink-3">{t("dash.overall")}</div>
          <div className="num mt-1 text-3xl font-semibold">
            {done}
            <span className="text-lg text-ink-3">/{total}</span>
          </div>
          <div className="mt-1 text-xs text-ink-3">{t("dash.stages_done")}</div>
        </Card>
        <Card>
          <div className="text-sm text-ink-3">{t("dash.best_quiz")}</div>
          <div className="num mt-1 text-3xl font-semibold">{data.quizResults.length ? `${fmtNum(Math.max(...data.quizResults.map((r) => r.percent)), 0)}%` : "—"}</div>
        </Card>
        <Card className="flex flex-col justify-between">
          <div className="text-sm text-ink-3">{t("dash.next")}</div>
          {nextLab ? (
            <Link href={`/labs/${nextLab.slug}/${STAGE_ROUTE[nextStage(nextLab.status) - 1]}`} className="mt-1">
              <div className="font-medium leading-snug">{pick(nextLab, "title")}</div>
              <div className="mt-1 text-sm text-brand-700">{t(`stage.${nextStage(nextLab.status)}.name`)} →</div>
            </Link>
          ) : (
            <div className="mt-1 font-medium text-s3">{t("dash.all_done")}</div>
          )}
        </Card>
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("dash.my_labs")}</h2>
        {!data.labs.length ? (
          <Empty>{t("labs.empty")}</Empty>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {data.labs.map((l) => (
              <Card key={l.id}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <Link href={`/labs/${l.slug}`} className="font-semibold hover:text-brand-700">
                    {pick(l, "title")}
                  </Link>
                </div>
                <StageStepper status={l.status} slug={l.slug} compact />
              </Card>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-lg font-semibold">{t("dash.upcoming")}</h2>
          {!data.upcomingBookings.length ? (
            <Empty>{t("dash.no_bookings")}</Empty>
          ) : (
            <div className="space-y-2">
              {data.upcomingBookings.map((b) => (
                <Card key={b.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <div className="font-medium">{pick(b.lab, "title")}</div>
                    <div className="num text-sm text-ink-3">{fmtDateTime(b.startsAt)}</div>
                  </div>
                  <Link href={b.status === "ACTIVE" ? `/labs/${b.lab.slug}/remote/session/${b.id}` : `/labs/${b.lab.slug}/remote`}>
                    <Button size="sm" variant={b.status === "ACTIVE" ? "success" : "secondary"}>
                      {b.status === "ACTIVE" ? t("dash.join_now") : t(`booking.${b.status}`)}
                    </Button>
                  </Link>
                </Card>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">{t("dash.quiz_results")}</h2>
          {!data.quizResults.length ? (
            <Empty>{t("dash.no_quiz")}</Empty>
          ) : (
            <Card className="p-0">
              <ul className="divide-y divide-line">
                {data.quizResults.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{pick(r.lab, "title")}</div>
                      <div className="num text-xs text-ink-3">
                        {t("dash.attempt", { n: r.number })} · {fmtDateTime(r.submittedAt)}
                      </div>
                    </div>
                    <Badge tone={r.passed ? "green" : "red"}>{fmtNum(r.percent, 0)}%</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ أستاذ / مدير
interface OverviewLab {
  id: string;
  slug: string;
  titleAr: string;
  titleFr: string;
  published: boolean;
  total: number;
  funnel: { stage1: number; stage2: number; stage3: number; done: number };
  avgQuiz: number;
}

function StaffDash({ admin }: { admin: boolean }) {
  const { t, pick, fmtNum } = useI18n();
  const { data } = useSWR<{ labs: OverviewLab[] }>("/teacher/overview", fetcher, { refreshInterval: 30_000 });
  const { data: dev } = useSWR<{ devices: { id: string; name: string; online: boolean; maintenance: boolean; driver: string }[] }>("/admin/devices", fetcher, { refreshInterval: 15_000 });
  if (!data) return <PageLoader />;

  const students = Math.max(0, ...data.labs.map((l) => l.total));
  const completions = data.labs.reduce((a, l) => a + l.funnel.done, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t(admin ? "dash.admin_title" : "dash.teacher_title")}</h1>
          <p className="mt-1 text-ink-3">{t("dash.staff_sub")}</p>
        </div>
        <Link href="/teacher/labs">
          <Button variant="secondary">{t("dash.manage_labs")}</Button>
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label={t("dash.labs_count")} value={data.labs.length} />
        <Stat label={t("dash.students_count")} value={students} />
        <Stat label={t("dash.completions")} value={completions} />
        <Card>
          <div className="text-sm text-ink-3">{t("dash.devices")}</div>
          <div className="mt-2 space-y-1">
            {(dev?.devices ?? []).map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{d.name}</span>
                <Badge tone={d.maintenance ? "amber" : d.online ? "green" : "red"}>{d.maintenance ? t("device.maintenance") : d.online ? t("device.online") : t("device.offline")}</Badge>
              </div>
            ))}
            {!dev?.devices.length && <span className="text-sm text-ink-3">—</span>}
          </div>
        </Card>
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("dash.funnel")}</h2>
        {!data.labs.length ? (
          <Empty>{t("teacher.no_labs")}</Empty>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {data.labs.map((l) => (
              <Card key={l.id}>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <Link href={`/teacher/labs/${l.id}`} className="font-semibold hover:text-brand-700">
                    {pick(l, "title")}
                  </Link>
                  <Badge tone={l.published ? "green" : "slate"}>{l.published ? t("teacher.published") : t("teacher.draft")}</Badge>
                </div>
                <Funnel f={l.funnel} total={l.total} />
                <div className="mt-3 text-sm text-ink-3">
                  {t("dash.avg_quiz")}: <span className="num font-medium text-ink">{l.avgQuiz ? `${fmtNum(l.avgQuiz, 0)}%` : "—"}</span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const Stat = ({ label, value }: { label: string; value: number }) => (
  <Card>
    <div className="text-sm text-ink-3">{label}</div>
    <div className="num mt-1 text-3xl font-semibold">{value}</div>
  </Card>
);

/** قمع المراحل: كم طالباً في كل مرحلة الآن (أشرطة أفقية بلون المرحلة) */
function Funnel({ f, total }: { f: OverviewLab["funnel"]; total: number }) {
  const { t } = useI18n();
  const rows: [string, number, string][] = [
    [t("stage.1.short"), f.stage1, "bg-s1"],
    [t("stage.2.short"), f.stage2, "bg-s2"],
    [t("stage.3.short"), f.stage3, "bg-s3"],
    [t("stage.done"), f.done, "bg-slate-700"],
  ];
  return (
    <div className="space-y-2">
      {rows.map(([label, n, color]) => (
        <div key={label} className="flex items-center gap-3">
          <span className="w-24 shrink-0 truncate text-xs text-ink-2">{label}</span>
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${color}`} style={{ width: `${total ? (n / total) * 100 : 0}%` }} />
          </div>
          <span className="num w-6 text-end text-sm font-medium">{n}</span>
        </div>
      ))}
    </div>
  );
}
