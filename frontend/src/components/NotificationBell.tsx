"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { api, fetcher } from "@/lib/api";
import { useI18n } from "@/i18n";
import { useSocket } from "@/lib/socket";
import { useUx } from "./ui";
import type { Notification } from "@/lib/types";

/** نص الإشعار حسب اللغة (المعاملات تأتي من الخادم) */
export function useNotifText() {
  const { t, lang } = useI18n();
  return (n: Notification) => {
    const p = n.params ?? {};
    const lab = lang === "ar" ? p.labAr || p.lab : p.lab;
    return t(`notif.${n.kind}`, { lab: lab ?? "", when: p.when ?? "", minutes: p.minutes ?? "", percent: p.percent ?? "" });
  };
}

export function notifHref(n: Notification, slugs?: Record<string, string>) {
  const id = n.params?.labId as string | undefined;
  const slug = id && slugs?.[id];
  if (!slug) return "/labs";
  if (n.kind === "stage2_unlocked" || n.kind === "quiz_failed") return `/labs/${slug}/quiz`;
  if (n.kind === "session_started" && n.params?.bookingId) return `/labs/${slug}/remote/session/${n.params.bookingId}`;
  if (n.kind.startsWith("booking") || n.kind === "stage3_unlocked") return `/labs/${slug}/remote`;
  return `/labs/${slug}`;
}

export function NotificationBell() {
  const { t, fmtDateTime } = useI18n();
  const { socket } = useSocket();
  const { toast } = useUx();
  const text = useNotifText();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const { data, mutate } = useSWR<{ notifications: Notification[]; unread: number }>("/notifications", fetcher, { refreshInterval: 60_000 });
  const { data: labs } = useSWR<{ labs: { id: string; slug: string }[] }>("/labs", fetcher);
  const slugs = Object.fromEntries((labs?.labs ?? []).map((l) => [l.id, l.slug]));

  useEffect(() => {
    if (!socket) return;
    const onNotif = (n: Notification) => {
      toast(text(n), "info");
      void mutate();
    };
    socket.on("notification", onNotif);
    return () => {
      socket.off("notification", onNotif);
    };
  }, [socket]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const h = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && (data?.unread ?? 0) > 0) {
      await api("/notifications/read", { method: "POST", body: {} });
      setTimeout(() => void mutate(), 1500);
    }
  }

  const unread = data?.unread ?? 0;
  return (
    <div className="relative" ref={box}>
      <button onClick={toggle} className="relative rounded-lg p-2 text-ink-2 hover:bg-slate-100" aria-label={t("nav.notifications")}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && <span className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{unread}</span>}
      </button>
      {open && (
        <div className="absolute end-0 z-40 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-xl border border-line bg-white shadow-xl">
          <div className="border-b border-line px-4 py-2.5 text-sm font-semibold">{t("nav.notifications")}</div>
          <div className="max-h-80 overflow-y-auto">
            {(data?.notifications ?? []).slice(0, 8).map((n) => (
              <Link key={n.id} href={notifHref(n, slugs)} onClick={() => setOpen(false)} className="block border-b border-line px-4 py-3 text-sm last:border-0 hover:bg-slate-50">
                <div className={n.readAt ? "text-ink-2" : "font-medium"}>{text(n)}</div>
                <div className="mt-0.5 text-xs text-ink-3">{fmtDateTime(n.createdAt)}</div>
              </Link>
            ))}
            {!data?.notifications.length && <div className="px-4 py-8 text-center text-sm text-ink-3">{t("notif.empty")}</div>}
          </div>
          <Link href="/notifications" onClick={() => setOpen(false)} className="block bg-slate-50 px-4 py-2 text-center text-sm text-brand-700 hover:bg-slate-100">
            {t("common.see_all")}
          </Link>
        </div>
      )}
    </div>
  );
}
