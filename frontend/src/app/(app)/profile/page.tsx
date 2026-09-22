"use client";
// الملف الشخصي: الاسم، اللغة، تغيير كلمة المرور
import { useState } from "react";
import { Badge, Button, Card, Field, useUx } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/i18n";

export default function ProfilePage() {
  const { t } = useI18n();
  const { user, refresh, updateLocale } = useAuth();
  const ux = useUx();
  const [name, setName] = useState(user?.name ?? "");
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  if (!user) return null;

  const saveName = async () => {
    setBusy(true);
    try {
      await api("/auth/me", { method: "PATCH", body: { name } });
      await refresh();
      ux.toast(t("common.saved"), "success");
    } catch (e) {
      ux.error(e);
    } finally {
      setBusy(false);
    }
  };
  const changePw = async () => {
    setBusy(true);
    try {
      await api("/auth/change-password", { method: "POST", body: { current: cur, next } });
      setCur("");
      setNext("");
      ux.toast(t("profile.pw_changed"), "success");
    } catch (e) {
      ux.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <h1 className="text-2xl font-semibold">{t("profile.title")}</h1>
      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="num text-ink-3" dir="ltr">
            {user.email}
          </div>
          <Badge tone="blue">{t(`role.${user.role}`)}</Badge>
        </div>
        <Field label={t("profile.name")}>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("profile.language")}>
          <div className="flex gap-2">
            {(["fr", "ar"] as const).map((l) => (
              <Button key={l} variant={user.locale === l ? "primary" : "secondary"} onClick={() => updateLocale(l)}>
                {l === "fr" ? "Français" : "العربية"}
              </Button>
            ))}
          </div>
        </Field>
        <Button onClick={saveName} loading={busy} disabled={name.trim().length < 2 || name === user.name}>
          {t("common.save")}
        </Button>
      </Card>

      <Card className="space-y-4">
        <h2 className="font-semibold">{t("profile.change_pw")}</h2>
        <Field label={t("profile.current_pw")}>
          <input className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
        </Field>
        <Field label={t("profile.new_pw")} hint={t("profile.pw_hint")}>
          <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Button onClick={changePw} loading={busy} disabled={!cur || next.length < 8}>
          {t("profile.change_pw")}
        </Button>
      </Card>
    </div>
  );
}
