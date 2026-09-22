"use client";
// قائمة التقارير (PDF) — الطالب يرى تقاريره، الأستاذ يرى تقارير طلبة تجاربه
import useSWR from "swr";
import { Badge, Button, Card, Empty, PageLoader, useUx } from "@/components/ui";
import { download, fetcher } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/i18n";

interface Rep {
  id: string;
  kind: "VIRTUAL" | "REMOTE" | string;
  createdAt: string;
  lab: { slug: string; titleAr: string; titleFr: string };
  user: { id: string; name: string };
}

export default function ReportsPage() {
  const { t, pick, fmtDateTime } = useI18n();
  const { user } = useAuth();
  const ux = useUx();
  const { data } = useSWR<{ reports: Rep[] }>("/reports", fetcher);
  if (!data) return <PageLoader />;
  const staff = user?.role !== "STUDENT";

  return (
    <div>
      <h1 className="text-2xl font-semibold">{t("reports.title")}</h1>
      <p className="mb-6 mt-1 text-ink-3">{t("reports.subtitle")}</p>
      {!data.reports.length ? (
        <Empty>{t("reports.empty")}</Empty>
      ) : (
        <Card className="scroll-x p-0">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-slate-50 text-ink-3">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{t("reports.lab")}</th>
                {staff && <th className="px-4 py-3 text-start font-medium">{t("reports.student")}</th>}
                <th className="px-4 py-3 text-start font-medium">{t("reports.kind")}</th>
                <th className="px-4 py-3 text-start font-medium">{t("reports.date")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.reports.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-4 py-3 font-medium">{pick(r.lab, "title")}</td>
                  {staff && <td className="px-4 py-3">{r.user.name}</td>}
                  <td className="px-4 py-3">
                    <Badge tone={r.kind === "REMOTE" ? "green" : "blue"}>{t(`report.kind.${r.kind}`)}</Badge>
                  </td>
                  <td className="num px-4 py-3 text-ink-2">{fmtDateTime(r.createdAt)}</td>
                  <td className="px-4 py-3 text-end">
                    <Button size="sm" variant="secondary" onClick={() => download(`/reports/${r.id}/download`, "report.pdf").catch(ux.error)}>
                      PDF ↓
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
