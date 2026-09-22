"use client";
// الترجمة: الفرنسية (افتراضية، LTR) والعربية (RTL). المحتوى العلمي ثنائي اللغة يأتي من الـ API كـ {ar, fr}.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { fr } from "./fr";
import { ar } from "./ar";
import type { Bi, Lang } from "@/lib/types";

const dicts: Record<Lang, Record<string, string>> = { fr, ar };

interface I18n {
  lang: Lang;
  dir: "ltr" | "rtl";
  setLang: (l: Lang) => void;
  /** ترجمة مفتاح مع متغيرات {name} */
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** اختيار اللغة من نص ثنائي {ar, fr} */
  tr: (b: Bi | undefined | null) => string;
  /** عنوان/وصف من حقول titleAr/titleFr */
  pick: (o: { [k: string]: any } | undefined | null, base: string) => string;
  fmtDate: (d: string | Date | number) => string;
  fmtTime: (d: string | Date | number) => string;
  fmtDateTime: (d: string | Date | number) => string;
  fmtNum: (n: number, digits?: number) => string;
}

const Ctx = createContext<I18n | null>(null);

export function LangProvider({ initial, children }: { initial: Lang; children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    document.cookie = `lang=${l};path=/;max-age=31536000;samesite=lax`;
    document.documentElement.lang = l;
    document.documentElement.dir = l === "ar" ? "rtl" : "ltr";
  }, []);

  const value = useMemo<I18n>(() => {
    const d = dicts[lang];
    const loc = lang === "fr" ? "fr-FR" : "ar-MA-u-nu-latn"; // أرقام لاتينية حتى في العربية
    return {
      lang,
      dir: lang === "ar" ? "rtl" : "ltr",
      setLang,
      t: (key, vars) => {
        let s = d[key] ?? dicts.fr[key] ?? key;
        if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
        return s;
      },
      tr: (b) => (b ? b[lang] || b.fr || b.ar : ""),
      pick: (o, base) => (o ? (o[base + (lang === "fr" ? "Fr" : "Ar")] as string) || (o[base + "Fr"] as string) || "" : ""),
      fmtDate: (x) => new Intl.DateTimeFormat(loc, { dateStyle: "medium" }).format(new Date(x)),
      fmtTime: (x) => new Intl.DateTimeFormat(loc, { hour: "2-digit", minute: "2-digit" }).format(new Date(x)),
      fmtDateTime: (x) => new Intl.DateTimeFormat(loc, { dateStyle: "short", timeStyle: "short" }).format(new Date(x)),
      fmtNum: (n, digits = 2) => new Intl.NumberFormat(loc, { maximumFractionDigits: digits }).format(n),
    };
  }, [lang, setLang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useI18n outside LangProvider");
  return c;
}
