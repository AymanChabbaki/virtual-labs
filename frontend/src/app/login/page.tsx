"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n";
import { useAuth } from "@/lib/auth";
import { Button, Field, useUx } from "@/components/ui";
import { LangSwitch } from "@/components/LangSwitch";
import { ApiError } from "@/lib/api";

const DEMO = [
  { key: "student1", email: "student1@labs.test", pw: "Student123!" },
  { key: "student2", email: "student2@labs.test", pw: "Student123!" },
  { key: "teacher", email: "prof@labs.test", pw: "Prof123!" },
  { key: "admin", email: "admin@labs.test", pw: "Admin123!" },
];

export default function LoginPage() {
  const { t } = useI18n();
  const { user, login, loading } = useAuth();
  const { error } = useUx();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
  }, [user, loading, router]);

  async function submit(e?: React.FormEvent, creds?: { email: string; pw: string }) {
    e?.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      await login(creds?.email ?? email, creds?.pw ?? pw);
      router.replace("/dashboard");
    } catch (err) {
      if (err instanceof ApiError && err.code === "BAD_CREDENTIALS") setMsg(t("err.BAD_CREDENTIALS"));
      else error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      {/* لوحة العلامة */}
      <section className="relative hidden overflow-hidden bg-brand-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -end-24 -top-24 h-96 w-96 rounded-full bg-brand-600/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -start-16 h-96 w-96 rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="relative">
          <div className="inline-flex items-center rounded-xl bg-white/95 px-3 py-2 shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-fsbm.png" alt="FSBM — Université Hassan II de Casablanca" className="h-14 w-auto" />
          </div>
        </div>
        <div className="relative max-w-md space-y-8">
          <h1 className="text-3xl font-semibold leading-tight">{t("login.hero")}</h1>
          <ol className="space-y-4">
            {[1, 2, 3].map((n) => (
              <li key={n} className="flex gap-4">
                <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${n === 1 ? "bg-s1" : n === 2 ? "bg-s2" : "bg-s3"}`}>{n}</span>
                <div>
                  <div className="font-medium">{t(`stage.${n}.name`)}</div>
                  <div className="text-sm text-white/70">{t(`stage.${n}.desc`)}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="relative text-sm text-white/50">{t("app.tagline")}</div>
      </section>

      {/* النموذج */}
      <section className="flex flex-col px-6 py-8 sm:px-12">
        <div className="flex justify-end">
          <LangSwitch />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">
          <div className="mb-8 flex items-center lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-fsbm.png" alt="FSBM — Université Hassan II de Casablanca" className="h-12 w-auto" />
          </div>
          <h2 className="mb-1 text-2xl font-semibold">{t("login.title")}</h2>
          <p className="mb-6 text-ink-3">{t("login.subtitle")}</p>
          <form onSubmit={submit} className="space-y-4">
            <Field label={t("common.email")}>
              <input className="input num" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required dir="ltr" />
            </Field>
            <Field label={t("common.password")}>
              <input className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required dir="ltr" />
            </Field>
            {msg && <p className="text-sm text-danger">{msg}</p>}
            <Button type="submit" loading={busy} className="w-full" size="lg">
              {t("login.submit")}
            </Button>
          </form>

          <div className="mt-8 overflow-hidden rounded-xl border border-line bg-white/70">
            <div className="h-1 w-full bg-gradient-to-r from-s1 via-s2 to-s3" />
            <div className="p-4">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">{t("login.demo")}</div>
              <div className="grid grid-cols-2 gap-2">
                {DEMO.map((d) => (
                  <button key={d.key} type="button" disabled={busy} onClick={() => submit(undefined, d)} className="rounded-lg border border-line bg-white px-3 py-2 text-start text-sm transition hover:border-brand-300 hover:bg-brand-50">
                    <div className="font-medium">{t(`login.demo.${d.key}`)}</div>
                    <div className="num truncate text-xs text-ink-3">{d.email}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
