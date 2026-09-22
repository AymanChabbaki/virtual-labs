"use client";
// رسوم دارات متحركة (SVG): سرعة حركة النقاط تتناسب مع شدة التيار، لون المقاومة يتدرج مع الاستطاعة.
import { clamp, fmt } from "./util";

const WIRE = "#334155";
const FLOW = "#f59e0b";

export interface CircuitProps {
  /** القيم المعروضة على أجهزة القياس (مع الضجيج) */
  reading: Record<string, number>;
  params: Record<string, number>;
  running?: boolean;
  t?: number;
}

/** مدّة دورة الحركة: كلما زاد التيار قلّ الزمن (أسرع) */
const flowDur = (iMa: number) => clamp(40 / (Math.abs(iMa) + 0.001), 0.3, 4);

function Meter({ x, y, label, value, unit, color }: { x: number; y: number; label: string; value: string; unit: string; color: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r={22} fill="#fff" stroke={color} strokeWidth={2.5} />
      <text x={x} y={y + 6} textAnchor="middle" fontSize={20} fontWeight={700} fill={color}>
        {label}
      </text>
      <rect x={x - 38} y={y + 28} width={76} height={22} rx={5} fill="#0f172a" />
      <text x={x} y={y + 43.5} textAnchor="middle" fontSize={12.5} fill="#86efac" fontFamily="ui-monospace, Menlo, monospace" className="num">
        {value} {unit}
      </text>
    </g>
  );
}

function Battery({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <g>
      <line x1={x - 16} x2={x + 16} y1={y} y2={y} stroke={WIRE} strokeWidth={3} />
      <line x1={x - 9} x2={x + 9} y1={y + 12} y2={y + 12} stroke={WIRE} strokeWidth={3} />
      <text x={x + 24} y={y + 2} fontSize={13} fill="#dc2626" fontWeight={700}>
        +
      </text>
      <text x={x + 24} y={y + 16} fontSize={13} fill="#2563eb" fontWeight={700}>
        −
      </text>
      <text x={x - 24} y={y + 8} fontSize={13} textAnchor="end" fill="#0f172a" fontWeight={600} className="num">
        {label}
      </text>
    </g>
  );
}

function Zigzag({ x, y, w, color }: { x: number; y: number; w: number; color: string }) {
  const n = 6;
  const seg = w / n;
  let d = `M${x},${y}`;
  for (let i = 0; i < n; i++) d += ` L${x + seg * (i + 0.5)},${y + (i % 2 ? 9 : -9)}`;
  d += ` L${x + w},${y}`;
  return <path d={d} fill="none" stroke={color} strokeWidth={3} strokeLinejoin="round" />;
}

// ============================================================================ قانون أوم
export function OhmCircuit({ reading, params }: CircuitProps) {
  const I = reading.I ?? 0;
  const P = reading.P ?? 0;
  const U = params.U ?? 0;
  const R = params.R ?? 100;
  const heat = clamp(P / 700, 0, 1);
  const rc = `rgb(${Math.round(51 + heat * 169)},${Math.round(65 - heat * 27)},${Math.round(85 - heat * 47)})`;
  const on = U > 0;
  return (
    <svg viewBox="0 0 420 260" className="w-full" role="img" aria-label="Ohm circuit">
      <g stroke={WIRE} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M50,120 V50 H172 M248,50 H370 V108 M370,152 V210 H50 V132" />
        <path d="M172,50 V125 H188 M248,50 V125 H232" strokeWidth={2} />
      </g>
      {/* حركة التيار */}
      {on && <path d="M50,120 V50 H172 M248,50 H370 V108 M370,152 V210 H50 V132" className="flow-line" style={{ ["--flow-dur" as string]: `${flowDur(I)}s` }} stroke={FLOW} strokeWidth={4.5} fill="none" />}
      <Battery x={50} y={120} label={`${fmt(U, 1)} V`} />
      <Zigzag x={172} y={50} w={76} color={rc} />
      {heat > 0.05 && <ellipse cx={210} cy={50} rx={44} ry={18} fill="#ef4444" opacity={heat * 0.25} />}
      <text x={210} y={30} textAnchor="middle" fontSize={13} fontWeight={600} fill="#0f172a" className="num">
        R = {R} Ω
      </text>
      <Meter x={370} y={130} label="A" value={fmt(I, 2)} unit="mA" color="#7c3aed" />
      <Meter x={210} y={130} label="V" value={fmt(reading.U ?? U, 2)} unit="V" color="#0f4c81" />
    </svg>
  );
}

// ============================================================================ دارة RC
export function RcCircuit({ reading, params, t = 0, running }: CircuitProps) {
  const E = params.E ?? 5;
  const Uc = reading.Uc ?? 0;
  const i = reading.i ?? 0;
  const frac = clamp(Uc / (E || 1), 0, 1);
  const closed = !!running || t > 0;
  return (
    <svg viewBox="0 0 480 270" className="w-full" role="img" aria-label="RC circuit">
      <g stroke={WIRE} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M50,130 V56 H84 M124,56 H160 M240,56 H330 V118 M330,142 V220 H50 V142" />
        <path d="M330,90 H420 V108 M420,152 V190 H330" strokeWidth={2} />
      </g>
      {closed && Math.abs(i) > 0.005 && <path d="M50,130 V56 H84 M124,56 H160 M240,56 H330 V118 M330,142 V220 H50 V142" className="flow-line" style={{ ["--flow-dur" as string]: `${flowDur(i * 6)}s` }} stroke={FLOW} strokeWidth={4.5} fill="none" />}
      <Battery x={50} y={130} label={`E = ${E} V`} />
      {/* المفتاح: يُغلق عند بدء الشحن */}
      <circle cx={84} cy={56} r={3.5} fill={WIRE} />
      <circle cx={124} cy={56} r={3.5} fill={WIRE} />
      <line x1={84} y1={56} x2={closed ? 124 : 118} y2={closed ? 56 : 36} stroke="#0f172a" strokeWidth={3} strokeLinecap="round" style={{ transition: "all .25s" }} />
      <Zigzag x={160} y={56} w={80} color={WIRE} />
      <text x={200} y={34} textAnchor="middle" fontSize={13} fontWeight={600} className="num">
        R = {params.R} kΩ
      </text>
      {/* المكثف: لوحان + عمود شحنة */}
      <line x1={306} x2={354} y1={118} y2={118} stroke={WIRE} strokeWidth={4} />
      <line x1={306} x2={354} y1={142} y2={142} stroke={WIRE} strokeWidth={4} />
      <rect x={312} y={122} width={36} height={16} fill="#2a78d6" opacity={frac * 0.85} />
      <text x={330} y={172} textAnchor="middle" fontSize={13} fontWeight={600} className="num">
        C = {params.C} µF
      </text>
      <rect x={366} y={96} width={10} height={68} rx={3} fill="#e2e8f0" />
      <rect x={366} y={96 + 68 * (1 - frac)} width={10} height={68 * frac} rx={3} fill="#2a78d6" />
      <text x={371} y={90} textAnchor="middle" fontSize={10} fill="#64748b">
        {Math.round(frac * 100)}%
      </text>
      <Meter x={420} y={130} label="V" value={fmt(Uc, 2)} unit="V" color="#0f4c81" />
      <text x={130} y={250} fontSize={14} fontWeight={600} fill="#0f172a" className="num">
        t = {fmt(t, 1)} s
      </text>
      <text x={330} y={250} fontSize={12.5} fill="#64748b" className="num">
        i = {fmt(i, 2)} mA
      </text>
    </svg>
  );
}

// ============================================================================ الثنائي
export function DiodeCircuit({ reading, params }: CircuitProps) {
  const I = reading.I ?? 0;
  const Vd = params.Vd ?? 0;
  const glow = clamp(Math.log10(I + 1) / 1.6, 0, 1);
  const on = I > 0.02;
  return (
    <svg viewBox="0 0 420 260" className="w-full" role="img" aria-label="Diode circuit">
      <g stroke={WIRE} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M50,120 V50 H180 M240,50 H370 V108 M370,152 V210 H50 V132" />
        <path d="M180,50 V125 H188 M240,50 V125 H232" strokeWidth={2} />
      </g>
      {on && <path d="M50,120 V50 H180 M240,50 H370 V108 M370,152 V210 H50 V132" className="flow-line" style={{ ["--flow-dur" as string]: `${flowDur(I)}s` }} stroke={FLOW} strokeWidth={4.5} fill="none" />}
      <Battery x={50} y={120} label={`${fmt(Vd, 2)} V`} />
      {/* رمز الثنائي */}
      {glow > 0.02 && <circle cx={210} cy={50} r={30} fill="#fbbf24" opacity={glow * 0.45} />}
      <path d="M195,34 L225,50 L195,66 Z" fill={on ? "#fde68a" : "#fff"} stroke="#0f172a" strokeWidth={2.5} strokeLinejoin="round" />
      <line x1={226} y1={34} x2={226} y2={66} stroke="#0f172a" strokeWidth={3} />
      <text x={210} y={22} textAnchor="middle" fontSize={12} fontWeight={600} fill="#0f172a">
        Diode
      </text>
      <Meter x={370} y={130} label="A" value={fmt(I, 3)} unit="mA" color="#7c3aed" />
      <Meter x={210} y={130} label="V" value={fmt(reading.Vd ?? Vd, 3)} unit="V" color="#0f4c81" />
    </svg>
  );
}

export function Circuit({ kind, ...p }: CircuitProps & { kind: string }) {
  if (kind === "rc") return <RcCircuit {...p} />;
  if (kind === "diode") return <DiodeCircuit {...p} />;
  return <OhmCircuit {...p} />;
}
