"use client";
// عرض المسار الإجباري (3 مراحل) وحالة القفل — مشترك بين لوحة الطالب وقائمة التجارب وصفحة التجربة
import Link from "next/link";
import { useI18n } from "@/i18n";
import type { Status } from "@/lib/types";
import { cx } from "./ui";

export type StageState = "locked" | "active" | "done";

export function stageStates(s: Status): [StageState, StageState, StageState] {
  const s1: StageState = s.stage1.state === "completed" ? "done" : "active";
  const s2: StageState = s.stage2.state === "passed" ? "done" : s.stage2.state === "available" ? "active" : s.stage2.state === "failed_final" ? "active" : "locked";
  const s3: StageState = s.stage3.state === "completed" ? "done" : s.stage3.state === "available" ? "active" : "locked";
  return [s1, s2, s3];
}

export const STAGE_ROUTE = ["simulation", "quiz", "remote"] as const;

/** المرحلة التي يجب أن يتابعها الطالب الآن (1..3) أو 0 إن انتهى كل شيء */
export function nextStage(s: Status): 0 | 1 | 2 | 3 {
  const [a, b, c] = stageStates(s);
  if (a !== "done") return 1;
  if (b !== "done") return 2;
  if (c !== "done") return 3;
  return 0;
}

const COLORS = ["bg-s1", "bg-s2", "bg-s3"];
const TEXT = ["text-s1", "text-s2", "text-s3"];

const Lock = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);
const Check = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 12l5 5 9-10" />
  </svg>
);

/** شريط المراحل الأفقي: دوائر مرقّمة تربط بينها خطوط، مع حالة كل مرحلة */
export function StageStepper({ status, slug, compact }: { status: Status; slug?: string; compact?: boolean }) {
  const { t } = useI18n();
  const st = stageStates(status);
  const sub = [
    status.stage1.state === "completed" ? t("stage.done") : `${status.stage1.percent}%`,
    status.stage2.state === "locked" ? t("stage.locked") : status.stage2.state === "passed" ? `${status.stage2.bestPercent}%` : status.stage2.state === "failed_final" ? t("stage.failed_final") : `${status.stage2.attemptsUsed}/${status.stage2.attemptsAllowed}`,
    status.stage3.state === "locked" ? t("stage.locked") : status.stage3.state === "completed" ? t("stage.done") : t("stage.available"),
  ];
  return (
    <ol className="flex items-start">
      {[0, 1, 2].map((i) => {
        const node = (
          <div className="flex min-w-0 flex-col items-center text-center">
            <span className={cx("flex items-center justify-center rounded-full font-bold text-white transition", compact ? "h-7 w-7 text-xs" : "h-9 w-9 text-sm", st[i] === "locked" ? "bg-slate-300" : COLORS[i], st[i] === "active" && "ring-4 ring-offset-1", st[i] === "active" && (i === 0 ? "ring-s1/20" : i === 1 ? "ring-s2/20" : "ring-s3/20"))}>
              {st[i] === "locked" ? <Lock /> : st[i] === "done" ? <Check /> : i + 1}
            </span>
            <span className={cx("mt-1.5 max-w-24 truncate font-medium", compact ? "text-[11px]" : "text-xs", st[i] === "locked" ? "text-ink-3" : "text-ink")}>{t(`stage.${i + 1}.short`)}</span>
            <span className={cx("num text-[11px]", st[i] === "locked" ? "text-ink-3" : TEXT[i])}>{sub[i]}</span>
          </div>
        );
        return (
          <li key={i} className="flex flex-1 items-start last:flex-none">
            {slug && st[i] !== "locked" ? <Link href={`/labs/${slug}/${STAGE_ROUTE[i]}`}>{node}</Link> : node}
            {i < 2 && <div className={cx("mx-1 mt-3.5 h-0.5 flex-1 rounded", compact ? "mt-3" : "mt-4", st[i] === "done" ? COLORS[i] : "bg-slate-200")} />}
          </li>
        );
      })}
    </ol>
  );
}
