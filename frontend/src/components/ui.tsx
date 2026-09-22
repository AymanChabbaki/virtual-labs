"use client";
// مكتبة مكوّنات واجهة صغيرة (أزرار، بطاقات، شارات، نوافذ، إشعارات منبثقة، تأكيد)
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useI18n } from "@/i18n";
import { ApiError } from "@/lib/api";

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

// ---------------------------------------------------------------- Button
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" | "success" | "amber"; size?: "sm" | "md" | "lg"; loading?: boolean };
export function Button({ variant = "primary", size = "md", loading, className, children, disabled, ...p }: BtnProps) {
  const v = {
    primary: "bg-brand-700 text-white hover:bg-brand-800 focus-visible:ring-brand-400",
    secondary: "bg-white text-ink border border-line hover:bg-slate-50 focus-visible:ring-brand-300",
    danger: "bg-danger text-white hover:bg-red-700 focus-visible:ring-red-300",
    ghost: "text-ink-2 hover:bg-slate-100 focus-visible:ring-brand-300",
    success: "bg-s3 text-white hover:bg-emerald-700 focus-visible:ring-emerald-300",
    amber: "bg-s2 text-white hover:bg-amber-700 focus-visible:ring-amber-300",
  }[variant];
  const s = { sm: "px-2.5 py-1.5 text-sm", md: "px-4 py-2 text-[0.95rem]", lg: "px-6 py-3 text-base" }[size];
  return (
    <button
      {...p}
      disabled={disabled || loading}
      className={cx("inline-flex items-center justify-center gap-2 rounded-lg font-medium transition focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50 disabled:cursor-not-allowed", v, s, className)}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("animate-spin", className ?? "h-5 w-5")} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function PageLoader() {
  return (
    <div className="flex items-center justify-center py-24 text-brand-600">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

// ---------------------------------------------------------------- Card / Badge
export function Card({ className, children, ...p }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...p} className={cx("rounded-2xl border border-line bg-surface p-5 shadow-card", className)}>
      {children}
    </div>
  );
}

const tones = {
  slate: "bg-slate-100 text-slate-700",
  blue: "bg-brand-50 text-brand-700 ring-1 ring-brand-200",
  amber: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
  green: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200",
  red: "bg-red-50 text-red-700 ring-1 ring-red-200",
};
export function Badge({ tone = "slate", children, className }: { tone?: keyof typeof tones; children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium", tones[tone], className)}>{children}</span>;
}

export function Alert({ tone = "blue", children, className }: { tone?: "blue" | "amber" | "green" | "red"; children: ReactNode; className?: string }) {
  const t = { blue: "border-brand-200 bg-brand-50 text-brand-900", amber: "border-amber-200 bg-amber-50 text-amber-900", green: "border-emerald-200 bg-emerald-50 text-emerald-900", red: "border-red-200 bg-red-50 text-red-900" }[tone];
  return <div className={cx("rounded-xl border px-4 py-3 text-sm", t, className)}>{children}</div>;
}

export function ProgressBar({ value, color = "bg-s1", className }: { value: number; color?: string; className?: string }) {
  return (
    <div className={cx("h-2 w-full overflow-hidden rounded-full bg-slate-200", className)} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx("h-full rounded-full transition-all duration-500", color)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 block text-sm font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-line bg-white/60 px-6 py-12 text-center text-ink-3">{children}</div>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="scroll-x mb-5 flex gap-1 border-b border-line">
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)} className={cx("-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition", value === t.id ? "border-brand-600 text-brand-700" : "border-transparent text-ink-3 hover:text-ink")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Modal
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal className={cx("max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-ink-3 hover:bg-slate-100" aria-label="close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Toasts + confirm
interface Toast {
  id: number;
  msg: string;
  tone: "info" | "success" | "error";
}
interface Ux {
  toast: (msg: string, tone?: Toast["tone"]) => void;
  /** يعرض رسالة خطأ مترجمة من ApiError */
  error: (e: unknown) => void;
  confirm: (msg: string, opts?: { danger?: boolean; okLabel?: string }) => Promise<boolean>;
}
const UxCtx = createContext<Ux | null>(null);

export function UxProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [conf, setConf] = useState<{ msg: string; danger?: boolean; okLabel?: string; resolve: (v: boolean) => void } | null>(null);
  const idRef = useRef(0);

  const toast = useCallback((msg: string, tone: Toast["tone"] = "info") => {
    const id = ++idRef.current;
    setToasts((l) => [...l, { id, msg, tone }]);
    setTimeout(() => setToasts((l) => l.filter((x) => x.id !== id)), 5000);
  }, []);

  const error = useCallback(
    (e: unknown) => {
      const code = e instanceof ApiError ? e.code : "UNKNOWN";
      const key = `err.${code}`;
      const m = t(key);
      toast(m === key ? t("err.UNKNOWN") + (e instanceof ApiError ? ` (${e.code})` : "") : m, "error");
    },
    [t, toast],
  );

  const confirm = useCallback((msg: string, opts?: { danger?: boolean; okLabel?: string }) => new Promise<boolean>((resolve) => setConf({ msg, ...opts, resolve })), []);

  return (
    <UxCtx.Provider value={{ toast, error, confirm }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className={cx("pointer-events-auto max-w-md rounded-xl px-4 py-3 text-sm text-white shadow-lg", x.tone === "error" ? "bg-red-600" : x.tone === "success" ? "bg-emerald-600" : "bg-slate-800")}>
            {x.msg}
          </div>
        ))}
      </div>
      <Modal open={!!conf} onClose={() => (conf?.resolve(false), setConf(null))} title={t("common.confirm")}>
        <p className="mb-5 text-ink-2">{conf?.msg}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => (conf?.resolve(false), setConf(null))}>
            {t("common.cancel")}
          </Button>
          <Button variant={conf?.danger ? "danger" : "primary"} onClick={() => (conf?.resolve(true), setConf(null))}>
            {conf?.okLabel ?? t("common.confirm")}
          </Button>
        </div>
      </Modal>
    </UxCtx.Provider>
  );
}

export const useUx = () => {
  const c = useContext(UxCtx);
  if (!c) throw new Error("useUx outside UxProvider");
  return c;
};

// ---------------------------------------------------------------- عدّاد تنازلي
export function useCountdown(targetMs: number | null, skewMs = 0) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (targetMs === null) return;
    const i = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(i);
  }, [targetMs]);
  return targetMs === null ? null : Math.max(0, Math.ceil((targetMs - (now + skewMs)) / 1000));
}
export const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
