"use client";
// قائمة تجارب الأستاذ (أو كل التجارب للمدير)
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import useSWR from "swr";
import { Badge, Button, Card, Empty, PageLoader, useUx } from "@/components/ui";
import { SimIcon } from "@/components/sim/SimIcon";
import { api, fetcher } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/i18n";
import type { LabSummary } from "@/lib/types";

export default function TeacherLabsPage() {
  const { t, pick } = useI18n();
  const { user } = useAuth();
  const router = useRouter();
  const ux = useUx();
  const { data, mutate } = useSWR<{ labs: LabSummary[] }>("/labs", fetcher);

  useEffect(() => {
    if (user?.role === "STUDENT") router.replace("/labs");
  }, [user, router]);

  if (!data) return <PageLoader />;

  const toggle = async (l: LabSummary) => {
    try {
      await api(`/labs/${l.id}`, { method: "PATCH", body: { published: !l.published } });
      await mutate();
    } catch (e) {
      ux.error(e);
    }
  };
  const remove = async (l: LabSummary) => {
    if (!(await ux.confirm(t("teacher.delete_confirm", { name: pick(l, "title") }), { danger: true }))) return;
    try {
      await api(`/labs/${l.id}`, { method: "DELETE" });
      await mutate();
    } catch (e) {
      ux.error(e);
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("teacher.labs_title")}</h1>
          <p className="mt-1 text-ink-3">{t("teacher.labs_sub")}</p>
        </div>
        <Link href="/teacher/labs/new">
          <Button>+ {t("teacher.new_lab")}</Button>
        </Link>
      </div>

      {!data.labs.length ? (
        <Empty>{t("teacher.no_labs")}</Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.labs.map((l) => (
            <Card key={l.id} className="flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                  <SimIcon kind={l.simulator} />
                </span>
                <div className="min-w-0 flex-1">
                  <Link href={`/teacher/labs/${l.id}`} className="text-lg font-semibold hover:text-brand-700">
                    {pick(l, "title")}
                  </Link>
                  <p className="line-clamp-2 text-sm text-ink-3">{pick(l, "description")}</p>
                </div>
                <Badge tone={l.published ? "green" : "slate"}>{l.published ? t("teacher.published") : t("teacher.draft")}</Badge>
              </div>
              <div className="flex flex-wrap gap-1.5 text-xs">
                <Badge>{t("labs.questions", { n: l.questionCount })}</Badge>
                <Badge>{t("labs.threshold", { n: l.passThreshold })}</Badge>
                <Badge>{t("teacher.attempts_n", { n: l.maxAttempts })}</Badge>
              </div>
              <div className="mt-auto flex flex-wrap gap-2 pt-1">
                <Link href={`/teacher/labs/${l.id}`}>
                  <Button size="sm">{t("common.edit")}</Button>
                </Link>
                <Button size="sm" variant="secondary" onClick={() => toggle(l)}>
                  {l.published ? t("teacher.unpublish") : t("teacher.publish")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(l)} className="ms-auto text-danger">
                  {t("common.delete")}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
