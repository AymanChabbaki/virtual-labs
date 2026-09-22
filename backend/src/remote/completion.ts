// ============================================================================
//  المرحلة 3 — الإكمال: التحقق من القياسات المسجَّلة على الجهاز الحقيقي، حساب النتائج
//  (مقاومة / ثابت زمن / عتبة الثنائي) وتوليد تقرير PDF مع المنحنى.
// ============================================================================
import path from "path";
import type { Lab, User } from "../generated/prisma/client";
import { prisma } from "../db";
import { config } from "../config";
import { HttpError } from "../lib/http";
import { audit } from "../lib/audit";
import { estimate, type Point } from "../labs/engine";
import { assertStage3Open, getOrCreateProgress } from "../labs/stages";
import { getDef } from "../routes/labs";
import { generateReportPdf, linearFit } from "../reports/pdf";

const KEYS: Record<string, { fr: string; ar: string; unit: string; decimals: number }> = {
  voltage: { fr: "Tension source", ar: "جهد المنبع", unit: "V", decimals: 2 },
  vLoad: { fr: "Tension charge", ar: "جهد الحمل", unit: "V", decimals: 3 },
  current: { fr: "Courant", ar: "التيار", unit: "mA", decimals: 3 },
  power: { fr: "Puissance", ar: "الاستطاعة", unit: "mW", decimals: 2 },
  tSwitch: { fr: "Temps", ar: "الزمن", unit: "s", decimals: 2 },
  temp: { fr: "Température", ar: "الحرارة", unit: "°C", decimals: 1 },
};

export async function remoteSamples(userId: string, labId: string) {
  const rows = await prisma.remoteSample.findMany({ where: { userId, labId }, orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({ id: r.id, bookingId: r.bookingId, at: r.createdAt, values: r.values as Record<string, number> }));
}

export async function completeRemote(user: User, lab: Lab) {
  const progress = await getOrCreateProgress(user.id, lab.id);
  assertStage3Open(progress);
  const def = getDef(lab);
  const cfg = def.remote;
  if (!cfg) throw new HttpError(409, "NO_REMOTE_CONFIG");

  const samples = await remoteSamples(user.id, lab.id);
  // نقاط متمايزة على محور x (تُقرَّب لثلاث خانات)
  const seen = new Set<string>();
  const rows = samples.map((s) => s.values).filter((v) => {
    const k = String(Math.round(v[cfg.plot.x] * 1000));
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (rows.length < cfg.minPoints) throw new HttpError(422, "NOT_ENOUGH_POINTS", `Need ${cfg.minPoints} distinct recorded points`, { have: rows.length, need: cfg.minPoints });

  const fr = user.locale === "fr";
  const t = (k: string) => (fr ? KEYS[k].fr : KEYS[k].ar);
  const colKeys = Array.from(new Set([cfg.plot.x, cfg.plot.y, "voltage"]));
  const columns = colKeys.map((k) => ({ key: k, label: t(k), unit: KEYS[k].unit, decimals: KEYS[k].decimals }));

  // نتائج مشتقة من القياسات الحقيقية
  const results: { label: string; value: string; note?: string }[] = [];
  const pts: Point[] = rows.map((v) => ({ params: {}, values: v, at: "" }));
  if (cfg.load.startsWith("R")) {
    const r = estimate({ kind: "slope", x: "vLoad", y: "current", invert: true, factor: 1000 }, pts);
    if (r) results.push({ label: fr ? "Résistance estimée R = U/I" : "المقاومة المقدَّرة R = U/I", value: `${r.toFixed(1)} Ω` });
  } else if (cfg.load === "RC") {
    const charging = pts.filter((p) => p.values.switchOn === 1 && p.values.voltage > 0.5);
    const tau = estimate({ kind: "rc_tau", x: "tSwitch", y: "vLoad", e: "voltage" }, charging.length >= 2 ? charging : pts);
    if (tau) results.push({ label: fr ? "Constante de temps τ estimée" : "ثابت الزمن τ المقدَّر", value: `${tau.toFixed(2)} s` });
  } else if (cfg.load === "DIODE") {
    const th = estimate({ kind: "threshold", x: "vLoad", y: "current", level: 1 }, pts);
    if (th) results.push({ label: fr ? "Tension pour I = 1 mA" : "الجهد عند I = 1 mA", value: `${th.toFixed(3)} V` });
  }

  const file = await generateReportPdf(
    {
      locale: user.locale,
      kind: "REMOTE",
      title: fr ? lab.titleFr : lab.titleAr,
      description: fr ? cfg.instructions.fr : cfg.instructions.ar,
      studentName: user.name,
      studentEmail: user.email,
      date: new Date(),
      columns,
      rows,
      chart: {
        x: cfg.plot.x,
        y: cfg.plot.y,
        xLabel: fr ? cfg.plot.xLabel.fr : cfg.plot.xLabel.ar,
        yLabel: fr ? cfg.plot.yLabel.fr : cfg.plot.yLabel.ar,
        mode: cfg.load.startsWith("R") ? "scatter" : "line",
        fit: cfg.load.startsWith("R") ? linearFit(rows.map((r) => r[cfg.plot.x]), rows.map((r) => r[cfg.plot.y])) : null,
      },
      results,
    },
    `remote-${Date.now().toString(36)}-${user.id.slice(-6)}.pdf`,
  );
  const report = await prisma.report.create({ data: { userId: user.id, labId: lab.id, kind: "REMOTE", filePath: path.relative(config.storageDir, file), data: { points: rows.length } } });
  await prisma.progress.update({ where: { id: progress.id }, data: { remoteCompletedAt: progress.remoteCompletedAt ?? new Date() } });
  await audit(user.id, "remote_completed", "lab", lab.id, { points: rows.length });
  return { reportId: report.id, points: rows.length, results };
}
