"use client";
// "كاميرا" افتراضية للجهاز الوهمي: مشهد SVG يتغير مع القياسات الحقيقية (شاشة رقمية، LEDs، مكوّن الحمل).
// مع الجهاز الحقيقي يُستبدل هذا بتيار MJPEG قادم من Raspberry Pi.
import { useI18n } from "@/i18n";
import type { Telemetry } from "@/lib/types";

const seg = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "--");

export function MockCamera({ t }: { t: Telemetry | null }) {
  const { t: tr } = useI18n();
  const on = !!t?.switchOn && !t?.estop && !t?.tripped;
  const I = t?.current ?? 0;
  const glow = Math.min(1, Math.abs(I) / 40);
  const heat = Math.min(1, ((t?.temp ?? 25) - 25) / 30);
  const load = t?.load ?? "NONE";
  return (
    <svg viewBox="0 0 480 300" className="w-full rounded-xl bg-slate-900" style={{ direction: "ltr" }} role="img" aria-label="Simulated camera">
      <defs>
        <linearGradient id="panel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1e293b" />
          <stop offset="1" stopColor="#0f172a" />
        </linearGradient>
        <radialGradient id="led" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#fde68a" />
          <stop offset="1" stopColor="#f59e0b" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="480" height="300" fill="url(#panel)" />
      {/* لوحة الأجهزة */}
      <rect x="18" y="16" width="200" height="118" rx="10" fill="#0b1220" stroke="#334155" />
      <text x="30" y="36" fontSize="10" fill="#94a3b8">
        SOURCE
      </text>
      <text x="30" y="70" fontSize="30" fill="#4ade80" fontFamily="ui-monospace, Menlo, monospace" className="num">
        {seg(t?.voltage ?? 0)} V
      </text>
      <text x="30" y="98" fontSize="10" fill="#94a3b8">
        CURRENT
      </text>
      <text x="30" y="124" fontSize="24" fill="#fbbf24" fontFamily="ui-monospace, Menlo, monospace" className="num">
        {seg(I, 2)} mA
      </text>

      <rect x="232" y="16" width="230" height="118" rx="10" fill="#0b1220" stroke="#334155" />
      <text x="244" y="36" fontSize="10" fill="#94a3b8">
        LOAD: {load}
      </text>
      <text x="244" y="70" fontSize="24" fill="#67e8f9" fontFamily="ui-monospace, Menlo, monospace" className="num">
        {seg(t?.vLoad ?? 0, 3)} V
      </text>
      <text x="244" y="98" fontSize="10" fill="#94a3b8">
        TEMP
      </text>
      <text x="244" y="122" fontSize="18" fill={heat > 0.6 ? "#f87171" : "#cbd5e1"} fontFamily="ui-monospace, Menlo, monospace" className="num">
        {seg(t?.temp ?? 25, 1)} °C
      </text>
      {/* LEDs */}
      {[
        ["PWR", on ? "#22c55e" : "#334155"],
        ["OUT", t?.switchOn ? "#3b82f6" : "#334155"],
        ["STOP", t?.estop ? "#ef4444" : "#334155"],
        ["TRIP", t?.tripped ? "#f97316" : "#334155"],
      ].map(([l, c], i) => (
        <g key={l}>
          <circle cx={392 + (i % 2) * 34} cy={44 + Math.floor(i / 2) * 32} r="6" fill={c} />
          {c !== "#334155" && <circle cx={392 + (i % 2) * 34} cy={44 + Math.floor(i / 2) * 32} r="12" fill={c} opacity="0.25" />}
        </g>
      ))}

      {/* منصة التركيب */}
      <rect x="18" y="150" width="444" height="134" rx="10" fill="#111c2f" stroke="#334155" />
      <g stroke="#64748b" strokeWidth="3" fill="none" strokeLinecap="round">
        <path d="M50,215 H150 M330,215 H430" />
      </g>
      {on && <path d="M50,215 H150 M330,215 H430" stroke="#f59e0b" strokeWidth="3" strokeDasharray="3 9" className="flow-line" style={{ ["--flow-dur" as string]: `${Math.max(0.3, 3 - glow * 2.5)}s` }} fill="none" />}

      {(load === "R100" || load === "R220" || load === "R470") && (
        <g>
          {heat > 0.05 && <ellipse cx="240" cy="215" rx="70" ry="32" fill="#ef4444" opacity={heat * 0.35} />}
          <rect x="160" y="197" width="160" height="36" rx="16" fill="#d6b98c" stroke="#a8874f" strokeWidth="2" />
          {(load === "R100" ? ["#78350f", "#000", "#78350f"] : load === "R220" ? ["#dc2626", "#dc2626", "#78350f"] : ["#eab308", "#7c3aed", "#78350f"]).map((c, i) => (
            <rect key={i} x={188 + i * 28} y="197" width="10" height="36" fill={c} />
          ))}
          <rect x="278" y="197" width="8" height="36" fill="#d4af37" />
        </g>
      )}
      {load === "RC" && (
        <g>
          <rect x="160" y="203" width="60" height="24" rx="10" fill="#d6b98c" stroke="#a8874f" strokeWidth="2" />
          <rect x="236" y="180" width="50" height="70" rx="8" fill="#1e3a8a" stroke="#60a5fa" strokeWidth="2" />
          <rect x="236" y={180 + 70 * (1 - Math.min(1, (t?.vLoad ?? 0) / 12))} width="50" height={70 * Math.min(1, (t?.vLoad ?? 0) / 12)} rx="6" fill="#3b82f6" opacity="0.7" />
          <text x="261" y="270" textAnchor="middle" fontSize="10" fill="#93c5fd">
            470 µF
          </text>
        </g>
      )}
      {load === "DIODE" && (
        <g>
          <rect x="160" y="203" width="60" height="24" rx="10" fill="#d6b98c" stroke="#a8874f" strokeWidth="2" />
          <circle cx="262" cy="215" r="40" fill="url(#led)" opacity={glow} />
          <rect x="240" y="203" width="44" height="24" rx="6" fill="#111827" stroke="#94a3b8" strokeWidth="2" />
          <path d="M252,208 L270,215 L252,222 Z" fill="#fde68a" />
          <line x1="272" y1="207" x2="272" y2="223" stroke="#fde68a" strokeWidth="2.5" />
        </g>
      )}
      {load === "NONE" && (
        <text x="240" y="220" textAnchor="middle" fontSize="12" fill="#64748b">
          — {tr("remote.no_load")} —
        </text>
      )}

      <text x="24" y="296" fontSize="9" fill="#475569">
        ● {tr("remote.sim_camera")}
      </text>
      <text x="456" y="296" textAnchor="end" fontSize="9" fill="#475569" className="num">
        {t ? new Date(t.ts).toLocaleTimeString() : ""}
      </text>
    </svg>
  );
}
