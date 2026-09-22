// أيقونات صغيرة لأنواع المحاكاة
export function SimIcon({ kind }: { kind?: string }) {
  const p = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  if (kind === "rc")
    return (
      <svg {...p} aria-hidden>
        <path d="M2 12h5M17 12h5M7 6v12M11 6v12" />
        <path d="M11 12h2l1-3 2 6 1-3" />
      </svg>
    );
  if (kind === "diode")
    return (
      <svg {...p} aria-hidden>
        <path d="M2 12h6M16 12h6M8 6l8 6-8 6V6zM16 6v12" />
      </svg>
    );
  return (
    <svg {...p} aria-hidden>
      <path d="M2 12h4l1.5-4 3 8 3-8 1.5 4h7" />
    </svg>
  );
}
