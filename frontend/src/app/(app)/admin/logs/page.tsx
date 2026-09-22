"use client";
// سجلات التدقيق (Audit) وسجل أوامر الأجهزة — للمدير
import { useState } from "react";
import useSWR from "swr";
import { Badge, Card, Empty, PageLoader, Tabs } from "@/components/ui";
import { fetcher } from "@/lib/api";
import { useI18n } from "@/i18n";

export default function LogsPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<"audit" | "commands">("audit");
  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold">{t("nav.logs")}</h1>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "audit", label: t("admin.logs.audit") }, { id: "commands", label: t("admin.logs.commands") }]} />
      {tab === "audit" ? <Audit /> : <Commands />}
    </div>
  );
}

function Audit() {
  const { fmtDateTime, t } = useI18n();
  const { data } = useSWR<{ logs: { id: string; action: string; entity: string | null; entityId: string | null; meta: any; ip: string | null; createdAt: string; user: { name: string; email: string } | null }[] }>("/admin/logs/audit?limit=200", fetcher, { refreshInterval: 10_000 });
  if (!data) return <PageLoader />;
  if (!data.logs.length) return <Empty>{t("common.empty")}</Empty>;
  return (
    <Card className="scroll-x p-0">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-slate-50 text-ink-3">
          <tr>
            {["admin.logs.time", "admin.logs.user", "admin.logs.action", "admin.logs.details"].map((k) => (
              <th key={k} className="px-3 py-3 text-start font-medium">
                {t(k)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.logs.map((l) => (
            <tr key={l.id} className="border-t border-line align-top">
              <td className="num whitespace-nowrap px-3 py-2 text-ink-3">{fmtDateTime(l.createdAt)}</td>
              <td className="px-3 py-2">{l.user?.name ?? "—"}</td>
              <td className="px-3 py-2">
                <Badge tone={l.action.includes("failed") || l.action.includes("estop") || l.action.includes("trip") ? "red" : "slate"}>{l.action}</Badge>
              </td>
              <td className="num max-w-md truncate px-3 py-2 text-xs text-ink-3" dir="ltr" title={JSON.stringify(l.meta)}>
                {l.entity ? `${l.entity} ` : ""}
                {l.meta ? JSON.stringify(l.meta) : ""}
                {l.ip ? ` · ${l.ip}` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Commands() {
  const { fmtDateTime, t } = useI18n();
  const { data } = useSWR<{ logs: { id: string; name: string; params: any; accepted: boolean; reason: string | null; createdAt: string; userName: string | null; device: { name: string } }[] }>("/admin/logs/commands?limit=200", fetcher, { refreshInterval: 5000 });
  if (!data) return <PageLoader />;
  if (!data.logs.length) return <Empty>{t("common.empty")}</Empty>;
  return (
    <Card className="scroll-x p-0">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-slate-50 text-ink-3">
          <tr>
            {["admin.logs.time", "admin.logs.user", "admin.logs.device", "admin.logs.command", "admin.logs.result"].map((k) => (
              <th key={k} className="px-3 py-3 text-start font-medium">
                {t(k)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.logs.map((l) => (
            <tr key={l.id} className="border-t border-line">
              <td className="num whitespace-nowrap px-3 py-2 text-ink-3">{fmtDateTime(l.createdAt)}</td>
              <td className="px-3 py-2">{l.userName ?? "—"}</td>
              <td className="px-3 py-2">{l.device.name}</td>
              <td className="num px-3 py-2 text-xs" dir="ltr">
                <span className="font-medium">{l.name}</span> {Object.keys(l.params ?? {}).length ? JSON.stringify(l.params) : ""}
              </td>
              <td className="px-3 py-2">{l.accepted ? <Badge tone="green">✓ {l.reason ?? "OK"}</Badge> : <Badge tone="red">✗ {l.reason}</Badge>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
