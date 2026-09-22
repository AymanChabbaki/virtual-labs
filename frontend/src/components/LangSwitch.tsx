"use client";
import { useI18n } from "@/i18n";
import { useAuth } from "@/lib/auth";
import { cx } from "./ui";

/** تبديل اللغة FR ⇄ AR (يحفظ التفضيل في الحساب إن كان المستخدم مسجّلاً) */
export function LangSwitch({ className }: { className?: string }) {
  const { lang } = useI18n();
  const { updateLocale } = useAuth();
  return (
    <div className={cx("inline-flex overflow-hidden rounded-lg border border-line bg-white text-sm", className)} role="group" aria-label="language">
      {(["fr", "ar"] as const).map((l) => (
        <button key={l} onClick={() => updateLocale(l)} className={cx("px-2.5 py-1 font-medium transition", lang === l ? "bg-brand-700 text-white" : "text-ink-2 hover:bg-slate-50")} aria-pressed={lang === l}>
          {l === "fr" ? "FR" : "عربي"}
        </button>
      ))}
    </div>
  );
}
