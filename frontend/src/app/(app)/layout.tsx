"use client";
// إطار التطبيق: حراسة الدخول، شريط التنقل حسب الدور، إشعارات، تبديل اللغة
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useI18n } from "@/i18n";
import { useAuth } from "@/lib/auth";
import { useSocket } from "@/lib/socket";
import { PageLoader, cx, useUx } from "@/components/ui";
import { LangSwitch } from "@/components/LangSwitch";
import { NotificationBell } from "@/components/NotificationBell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const { user, loading, logout } = useAuth();
  const { socket } = useSocket();
  const { toast } = useUx();
  const router = useRouter();
  const path = usePathname();
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);
  useEffect(() => setMenu(false), [path]);

  // جلسة تحكم بدأت (المجدوِل فعّل حجزك) → تنبيه مع رابط
  useEffect(() => {
    if (!socket) return;
    const h = () => toast(t("notif.session_started_toast"), "success");
    socket.on("session:started", h);
    return () => {
      socket.off("session:started", h);
    };
  }, [socket, t, toast]);

  if (loading || !user) return <PageLoader />;

  const nav =
    user.role === "STUDENT"
      ? [
          { href: "/dashboard", label: t("nav.dashboard") },
          { href: "/labs", label: t("nav.labs") },
          { href: "/reports", label: t("nav.reports") },
        ]
      : user.role === "TEACHER"
        ? [
            { href: "/dashboard", label: t("nav.dashboard") },
            { href: "/teacher/labs", label: t("nav.my_labs") },
            { href: "/reports", label: t("nav.reports") },
          ]
        : [
            { href: "/dashboard", label: t("nav.dashboard") },
            { href: "/teacher/labs", label: t("nav.labs") },
            { href: "/admin/users", label: t("nav.users") },
            { href: "/admin/classrooms", label: t("nav.classrooms") },
            { href: "/admin/devices", label: t("nav.devices") },
            { href: "/admin/logs", label: t("nav.logs") },
          ];
  const active = (href: string) => (href === "/dashboard" ? path === href : path.startsWith(href));

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
          <button className="rounded-lg p-2 text-ink-2 hover:bg-slate-100 md:hidden" onClick={() => setMenu((m) => !m)} aria-label="menu">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold text-brand-800">
            <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden>
              <rect width="32" height="32" rx="8" fill="#0f4c81" />
              <path d="M11 6h10M13 6v7l-5 9a2 2 0 0 0 1.8 3h12.4a2 2 0 0 0 1.8-3l-5-9V6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="14" cy="21" r="1.4" fill="#34d399" />
            </svg>
            <span className="hidden whitespace-nowrap sm:inline">{t("app.short")}</span>
          </Link>
          <nav className="ms-4 hidden items-center gap-1 md:flex">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className={cx("whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition", active(n.href) ? "bg-brand-50 text-brand-700" : "text-ink-2 hover:bg-slate-100")}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ms-auto flex items-center gap-2">
            <LangSwitch />
            <NotificationBell />
            <div className="hidden items-center gap-2 border-s border-line ps-3 sm:flex">
              <Link href="/profile" className="text-end leading-tight">
                <div className="max-w-40 truncate text-sm font-medium">{user.name}</div>
                <div className="text-xs text-ink-3">{t(`role.${user.role}`)}</div>
              </Link>
            </div>
            <button onClick={logout} className="rounded-lg p-2 text-ink-2 hover:bg-slate-100" aria-label={t("nav.logout")} title={t("nav.logout")}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="rtl:-scale-x-100">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
            </button>
          </div>
        </div>
        {menu && (
          <nav className="border-t border-line bg-white px-4 py-2 md:hidden">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className={cx("block rounded-lg px-3 py-2.5 text-sm font-medium", active(n.href) ? "bg-brand-50 text-brand-700" : "text-ink-2")}>
                {n.label}
              </Link>
            ))}
            <Link href="/profile" className="block rounded-lg px-3 py-2.5 text-sm text-ink-2">
              {user.name} · {t(`role.${user.role}`)}
            </Link>
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:py-8">{children}</main>
    </div>
  );
}
