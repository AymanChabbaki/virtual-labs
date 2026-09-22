"use client";
// مخطط SVG خفيف (نقاط/خطوط/خط ملاءمة) بدون مكتبات: محاور هادئة، تلميح عند التمرير، وسيلة إيضاح، وجدول بديل.
// ألوان السلاسل من لوحة مُتحقَّق منها: 1 = أزرق، 2 = برتقالي (تُستعمل بالترتيب ولا تُدوَّر).
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useI18n } from "@/i18n";

export interface Series {
  id: string;
  name: string;
  color?: string;
  points: { x: number; y: number }[];
  kind?: "scatter" | "line" | "fit";
}
export const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"];

function niceScale(min: number, max: number, target = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { lo: 0, hi: 1, ticks: [0, 1] };
  if (min === max) max = min + 1;
  const raw = (max - min) / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const step = (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  const lo = Math.floor(min / step + 1e-9) * step;
  const hi = Math.ceil(max / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step * 1e-6; v += step) ticks.push(Number(v.toPrecision(12)));
  return { lo, hi, ticks };
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(480);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const fmtTick = (v: number) => (Math.abs(v) >= 1000 ? v.toExponential(0) : String(Number(v.toPrecision(4))));

export function Chart({
  series,
  xLabel,
  yLabel,
  height = 280,
  xDomain,
  yDomain,
  includeZero = true,
  showTable = false,
  xUnit = "",
  yUnit = "",
  title,
}: {
  series: Series[];
  xLabel: string;
  yLabel: string;
  height?: number;
  xDomain?: [number, number];
  yDomain?: [number, number];
  includeZero?: boolean;
  showTable?: boolean;
  xUnit?: string;
  yUnit?: string;
  title?: string;
}) {
  const { t, dir } = useI18n();
  const [ref, width] = useWidth();
  const cid = "clip" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const [hover, setHover] = useState<{ s: string; i: number } | null>(null);
  const [table, setTable] = useState(false);

  const m = { l: 46, r: 12, t: 10, b: 36 };
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;

  const { sx, sy } = useMemo(() => {
    const all = series.flatMap((s) => s.points);
    const xs = all.map((p) => p.x);
    const ys = all.map((p) => p.y);
    const xmin = xDomain?.[0] ?? Math.min(includeZero ? 0 : Infinity, ...(xs.length ? xs : [0]));
    const xmax = xDomain?.[1] ?? Math.max(...(xs.length ? xs : [1]));
    const ymin = yDomain?.[0] ?? Math.min(includeZero ? 0 : Infinity, ...(ys.length ? ys : [0]));
    const ymax = yDomain?.[1] ?? Math.max(...(ys.length ? ys : [1]));
    return { sx: xDomain ? { lo: xDomain[0], hi: xDomain[1], ticks: niceScale(xDomain[0], xDomain[1]).ticks.filter((v) => v >= xDomain[0] && v <= xDomain[1]) } : niceScale(xmin, xmax), sy: yDomain ? { lo: yDomain[0], hi: yDomain[1], ticks: niceScale(yDomain[0], yDomain[1]).ticks.filter((v) => v >= yDomain[0] && v <= yDomain[1]) } : niceScale(ymin, ymax) };
  }, [series, xDomain, yDomain, includeZero]);

  const X = (v: number) => m.l + ((v - sx.lo) / (sx.hi - sx.lo || 1)) * iw;
  const Y = (v: number) => m.t + ih - ((v - sy.lo) / (sy.hi - sy.lo || 1)) * ih;
  const colored = series.map((s, i) => ({ ...s, color: s.color ?? SERIES_COLORS[i % SERIES_COLORS.length] }));

  const hp = hover ? colored.find((s) => s.id === hover.s)?.points[hover.i] : null;
  const hs = hover ? colored.find((s) => s.id === hover.s) : null;

  // أقرب نقطة للمؤشر (عبر كل السلاسل غير خط الملاءمة)
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    let best: { s: string; i: number; d: number } | null = null;
    for (const s of colored) {
      if (s.kind === "fit") continue;
      s.points.forEach((p, i) => {
        const d = Math.hypot(X(p.x) - px, Y(p.y) - py);
        if (d < 24 && (!best || d < best.d)) best = { s: s.id, i, d };
      });
    }
    setHover(best ? { s: (best as any).s, i: (best as any).i } : null);
  };

  return (
    <div ref={ref} className="relative w-full" dir="ltr">
      {title && <div className="mb-1 text-sm font-medium text-ink-2">{title}</div>}
      <svg width={width} height={height} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={title ?? `${yLabel} / ${xLabel}`} className="touch-none select-none">
        {/* شبكة هادئة */}
        {sy.ticks.map((v) => (
          <g key={"y" + v}>
            <line x1={m.l} x2={m.l + iw} y1={Y(v)} y2={Y(v)} stroke="#e2e8f0" strokeWidth={1} />
            <text x={m.l - 6} y={Y(v)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="#64748b" className="num">
              {fmtTick(v)}
            </text>
          </g>
        ))}
        {sx.ticks.map((v) => (
          <g key={"x" + v}>
            <line x1={X(v)} x2={X(v)} y1={m.t} y2={m.t + ih} stroke="#f1f5f9" strokeWidth={1} />
            <text x={X(v)} y={m.t + ih + 15} textAnchor="middle" fontSize={11} fill="#64748b" className="num">
              {fmtTick(v)}
            </text>
          </g>
        ))}
        <line x1={m.l} x2={m.l + iw} y1={m.t + ih} y2={m.t + ih} stroke="#94a3b8" />
        <line x1={m.l} x2={m.l} y1={m.t} y2={m.t + ih} stroke="#94a3b8" />
        <text x={m.l + iw / 2} y={height - 6} textAnchor="middle" fontSize={12} fill="#475569" fontWeight={500}>
          {xLabel}
        </text>
        <text transform={`translate(12 ${m.t + ih / 2}) rotate(-90)`} textAnchor="middle" fontSize={12} fill="#475569" fontWeight={500}>
          {yLabel}
        </text>

        <clipPath id={cid}>
          <rect x={m.l} y={m.t - 4} width={iw + 8} height={ih + 8} />
        </clipPath>
        <g clipPath={`url(#${cid})`}>
          {colored.map((s) => {
            const pts = s.kind === "scatter" ? s.points : [...s.points].sort((a, b) => a.x - b.x);
            const path = pts.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
            return (
              <g key={s.id}>
                {(s.kind === "line" || s.kind === "fit") && pts.length > 1 && <path d={path} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.kind === "fit" ? "6 4" : undefined} strokeLinejoin="round" strokeLinecap="round" />}
                {s.kind !== "fit" &&
                  (s.kind === "line" && s.points.length > 60
                    ? null
                    : s.points.map((p, i) => <circle key={i} cx={X(p.x)} cy={Y(p.y)} r={hover && hover.s === s.id && hover.i === i ? 6 : 4} fill={s.color} stroke="#fff" strokeWidth={2} />))}
              </g>
            );
          })}
        </g>
        {hp && hs && <line x1={X(hp.x)} x2={X(hp.x)} y1={m.t} y2={m.t + ih} stroke="#94a3b8" strokeDasharray="3 3" />}
      </svg>

      {hp && hs && (
        <div className="pointer-events-none absolute z-10 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg" style={{ left: Math.min(width - 130, Math.max(0, X(hp.x) + 10)), top: Math.max(0, Y(hp.y) - 46) }}>
          <div className="font-medium" style={{ color: hs.color }}>
            {hs.name}
          </div>
          <div className="num">
            {fmtTick(hp.x)} {xUnit} · {fmtTick(hp.y)} {yUnit}
          </div>
        </div>
      )}

      {(colored.length >= 2 || showTable) && (
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2" dir={dir}>
          {colored.length >= 2 &&
            colored.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color, height: s.kind === "scatter" ? 8 : 2, width: s.kind === "scatter" ? 8 : 16, borderRadius: 9999 }} />
                {s.name}
              </span>
            ))}
          {showTable && (
            <button className="ms-auto text-brand-700 underline-offset-2 hover:underline" onClick={() => setTable((x) => !x)}>
              {table ? t("chart.hide_table") : t("chart.show_table")}
            </button>
          )}
        </div>
      )}
      {table && (
        <div className="scroll-x mt-2 max-h-56 overflow-y-auto rounded-lg border border-line">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 text-ink-3">
              <tr>
                <th className="px-2 py-1 text-start">{xLabel}</th>
                {colored.filter((s) => s.kind !== "fit").map((s) => (
                  <th key={s.id} className="px-2 py-1 text-start">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {colored[0]?.points.map((p, i) => (
                <tr key={i} className="border-t border-line num">
                  <td className="px-2 py-1">{fmtTick(p.x)}</td>
                  {colored.filter((s) => s.kind !== "fit").map((s) => (
                    <td key={s.id} className="px-2 py-1">
                      {s.points[i] ? fmtTick(s.points[i].y) : ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
