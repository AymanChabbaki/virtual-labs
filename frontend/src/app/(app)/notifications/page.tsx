"use client";
// مركز الإشعارات: آخر 50 إشعاراً مع تعليم كمقروء
import Link from "next/link";
import { useEffect } from "react";
import useSWR from "swr";
import { Button, Card, Empty, PageLoader } from "@/components/ui";
import { notifHref, useNotifText } from "@/components/NotificationBell";
import { api, fetcher } from "@/lib/api";
import { useI18n } from "@/i18n";
import type { Notification } from "@/lib/types";

export default function NotificationsPage() {
  const { t, fmtDateTime } = useI18n();
  const text = useNotifText();
  const { data, mutate } = useSWR<{ notifications: Notification[]; unread: number }>("/notifications", fetcher);
  const { data: labs } = useSWR<{ labs: { id: string; slug: string }[] }>("/labs", fetcher);
  const slugs = Object.fromEntries((labs?.labs ?? []).map((l) => [l.id, l.slug]));

  // نُبقي حالة "غير مقروء" ظاهرة في هذه الزيارة ثم نعلّمها مقروءة عند المغادرة
  useEffect(() => () => void api("/notifications/read", { method: "POST", body: {} }).catch(() => undefined), []);

  if (!data) return <PageLoader />;
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("notif.title")}</h1>
        {data.unread > 0 && (
          <Button variant="secondary" size="sm" onClick={async () => (await api("/notifications/read", { method: "POST", body: {} }), mutate())}>
            {t("notif.mark_all")}
          </Button>
        )}
      </div>
      {!data.notifications.length ? (
        <Empty>{t("notif.empty")}</Empty>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-line">
            {data.notifications.map((n) => (
              <li key={n.id}>
                <Link href={notifHref(n, slugs)} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50">
                  <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-brand-600"}`} />
                  <div className="min-w-0">
                    <div className={n.readAt ? "text-ink-2" : "font-medium"}>{text(n)}</div>
                    <div className="num text-xs text-ink-3">{fmtDateTime(n.createdAt)}</div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
