"use client";
import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/api";
import { useI18n } from "@/i18n";
import { useAuth } from "@/lib/auth";
import { Badge, Button, Card, Empty, PageLoader } from "@/components/ui";
import { StageStepper, STAGE_ROUTE, nextStage } from "@/components/Path";
import { SimIcon } from "@/components/sim/SimIcon";
import type { LabSummary } from "@/lib/types";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function LabsPage() {
  const { t, pick } = useI18n();
  const { user } = useAuth();
  const router = useRouter();
  const { data, isLoading } = useSWR<{ labs: LabSummary[] }>("/labs", fetcher);

  useEffect(() => {
    if (user && user.role !== "STUDENT") router.replace("/teacher/labs");
  }, [user, router]);

  if (isLoading || !data) return <PageLoader />;
  return (
    <div>
      <h1 className="text-2xl font-semibold">{t("labs.title")}</h1>
      <p className="mb-6 mt-1 max-w-2xl text-ink-3">{t("labs.subtitle")}</p>
      {!data.labs.length ? (
        <Empty>{t("labs.empty")}</Empty>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {data.labs.map((l) => {
            const ns = l.status ? nextStage(l.status) : 1;
            return (
              <Card key={l.id} className="flex flex-col gap-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                    <SimIcon kind={l.simulator} />
                  </span>
                  <div className="min-w-0">
                    <Link href={`/labs/${l.slug}`} className="text-lg font-semibold leading-snug hover:text-brand-700">
                      {pick(l, "title")}
                    </Link>
                    <p className="mt-1 line-clamp-2 text-sm text-ink-3">{pick(l, "description")}</p>
                  </div>
                </div>
                {l.status && <StageStepper status={l.status} slug={l.slug} />}
                <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    <Badge tone="slate">{t("labs.questions", { n: l.questionCount })}</Badge>
                    <Badge tone="slate">{t("labs.threshold", { n: l.passThreshold })}</Badge>
                  </div>
                  <Link href={ns === 0 ? `/labs/${l.slug}` : `/labs/${l.slug}/${STAGE_ROUTE[ns - 1]}`}>
                    <Button size="sm" variant={ns === 0 ? "secondary" : "primary"}>
                      {ns === 0 ? t("labs.view") : ns === 1 && l.status?.stage1.percent === 0 ? t("labs.start") : t("labs.continue")}
                    </Button>
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
