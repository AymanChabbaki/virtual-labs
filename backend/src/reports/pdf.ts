// ============================================================================
//  توليد تقارير TP بصيغة PDF (pdfkit) — جداول + منحنى مرسوم متجهياً + نتائج.
//  الخط: DejaVu Sans (يدعم اللاتينية واليونانية Ω τ µ والعربية بتشكيل الحروف).
//  ملاحظة RTL: النص العربي يُرسم بخاصية 'rtla'، والأرقام/الوحدات في خلايا منفصلة
//  حتى لا تختلط اتجاهات النص (bidi) داخل السطر الواحد.
// ============================================================================
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { config } from "../config";

export interface ReportColumn {
  key: string;
  label: string;
  unit: string;
  decimals: number;
}

export interface ReportInput {
  locale: "fr" | "ar";
  kind: "VIRTUAL" | "REMOTE";
  title: string;
  description?: string;
  studentName: string;
  studentEmail: string;
  date: Date;
  columns: ReportColumn[];
  rows: Record<string, number>[];
  chart?: {
    x: string;
    y: string;
    xLabel: string;
    yLabel: string;
    mode: "scatter" | "line";
    fit?: { slope: number; intercept: number } | null;
  };
  results?: { label: string; value: string; note?: string }[];
  extra?: { label: string; value: string }[];
}

const FONT = path.resolve(__dirname, "../../assets/fonts/DejaVuSans.ttf");
const FONT_B = path.resolve(__dirname, "../../assets/fonts/DejaVuSans-Bold.ttf");

const STR = {
  fr: {
    virtual: "Rapport de TP virtuel",
    remote: "Rapport de TP à distance",
    student: "Étudiant",
    date: "Date",
    objective: "Objectif",
    data: "Mesures",
    curve: "Courbe",
    results: "Résultats",
    n: "N°",
    generated: "Document généré automatiquement par la plateforme Virtual & Remote Labs",
  },
  ar: {
    virtual: "تقرير الأعمال التطبيقية الافتراضية",
    remote: "تقرير الأعمال التطبيقية عن بُعد",
    student: "الطالب",
    date: "التاريخ",
    objective: "الهدف",
    data: "القياسات",
    curve: "المنحنى",
    results: "النتائج",
    n: "الرقم",
    generated: "وثيقة مولَّدة آلياً من منصة الأعمال التطبيقية",
  },
};

const hasArabic = (s: string) => /[؀-ۿ]/.test(s);
const fmt = (v: number, d: number) => (Number.isFinite(v) ? v.toFixed(d) : "—");

/** حدود "جميلة" للمحاور */
function niceScale(min: number, max: number, ticks = 5) {
  if (min === max) {
    max = min + 1;
  }
  const span = max - min;
  const raw = span / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const vals: number[] = [];
  for (let v = lo; v <= hi + step * 1e-6; v += step) vals.push(Number(v.toPrecision(12)));
  return { lo, hi, vals, step };
}

export async function generateReportPdf(input: ReportInput, fileName: string): Promise<string> {
  const rtl = input.locale === "ar";
  const S = STR[input.locale];
  const dir = path.join(config.storageDir, "reports");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileName);

  const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: input.title, Author: "Virtual & Remote Labs" } });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);
  doc.registerFont("R", FONT);
  doc.registerFont("B", FONT_B);

  const L = 50,
    W = 495,
    R = L + W;

  // ----- نص ثنائي الاتجاه (bidi مبسّط) -----
  // pdfkit يشكّل الحروف العربية لكنه لا يرتّب الاتجاهات: نقسم السطر إلى مقاطع
  // (عربي / لاتيني-أرقام) ونرسمها من اليمين إلى اليسار بترتيب منطقي صحيح.
  type Run = { text: string; ar: boolean };
  const runsOf = (line: string): Run[] => {
    const out: Run[] = [];
    for (const w of line.split(" ")) {
      if (!w) continue;
      const ar = hasArabic(w);
      const last = out[out.length - 1];
      if (last && last.ar === ar) last.text += " " + w;
      else out.push({ text: w, ar });
    }
    return out;
  };
  const runW = (r: Run) => doc.widthOfString(r.text, { features: r.ar ? ["rtla"] : undefined });
  /** يرسم سطراً عربياً (قد يحوي أرقاماً/لاتينية) ضمن الصندوق [x, x+w] */
  const drawRtlLine = (str: string, x: number, y: number, w: number, align: "left" | "right" | "center") => {
    const runs = runsOf(str);
    const sp = doc.widthOfString(" ");
    const total = runs.reduce((a, r) => a + runW(r), 0) + sp * Math.max(0, runs.length - 1);
    let cursor = align === "right" ? x + w : align === "center" ? x + (w + total) / 2 : x + total; // الحافة اليمنى للسطر
    for (const r of runs) {
      cursor -= runW(r);
      doc.text(r.text, cursor, y, { lineBreak: false, features: r.ar ? ["rtla"] : undefined });
      cursor -= sp;
    }
  };

  /** رسم نص بمحاذاة تتبع الاتجاه */
  const put = (str: string, x: number, y: number, w: number, opts: { bold?: boolean; size?: number; color?: string; align?: "left" | "right" | "center" } = {}) => {
    doc.font(opts.bold ? "B" : "R").fontSize(opts.size ?? 10).fillColor(opts.color ?? "#1f2937");
    const align = opts.align ?? (rtl ? "right" : "left");
    if (hasArabic(str)) return drawRtlLine(str, x, y, w, align);
    doc.text(str, x, y, { width: w, align, lineBreak: false });
  };
  /** فقرة بالتفاف الأسطر (تدعم العربية) وتعيد الإحداثي y بعدها */
  const para = (str: string, y: number, size = 10) => {
    doc.font("R").fontSize(size).fillColor("#374151");
    if (!hasArabic(str)) {
      doc.text(str, L, y, { width: W, align: "left" });
      return doc.y;
    }
    const lines: string[] = [];
    let cur = "";
    for (const word of str.split(" ")) {
      const t = cur ? cur + " " + word : word;
      const w = runsOf(t).reduce((a, r) => a + runW(r), 0) + doc.widthOfString(" ") * Math.max(0, runsOf(t).length - 1);
      if (w > W && cur) {
        lines.push(cur);
        cur = word;
      } else cur = t;
    }
    if (cur) lines.push(cur);
    lines.forEach((ln, i) => drawRtlLine(ln, L, y + i * (size * 1.5), W, "right"));
    return y + lines.length * size * 1.5;
  };

  // ---- ترويسة ----
  doc.rect(0, 0, 595, 88).fill("#0f4c81");
  put(input.kind === "VIRTUAL" ? S.virtual : S.remote, L, 22, W, { bold: true, size: 18, color: "#ffffff" });
  put(input.title, L, 52, W, { size: 13, color: "#dbeafe" });

  let y = 108;
  // بيانات الطالب (كل قيمة في سطر منفصل)
  const meta: [string, string][] = [
    [S.student, `${input.studentName} — ${input.studentEmail}`],
    [S.date, input.date.toISOString().slice(0, 16).replace("T", " ")],
    ...(input.extra ?? []).map((e) => [e.label, e.value] as [string, string]),
  ];
  for (const [k, v] of meta) {
    if (rtl) {
      put(k, R - 110, y, 110, { bold: true });
      put(v, L, y, W - 120, { align: "right" });
    } else {
      put(k, L, y, 110, { bold: true });
      put(v, L + 120, y, W - 120);
    }
    y += 16;
  }
  y += 6;

  const heading = (t: string) => {
    if (y > 740) {
      doc.addPage();
      y = 50;
    }
    doc.rect(L, y, W, 20).fill("#eef2f7");
    put(t, L + 8, y + 5, W - 16, { bold: true, size: 11, color: "#0f4c81" });
    y += 28;
  };

  if (input.description) {
    heading(S.objective);
    y = para(input.description, y) + 12;
  }

  // ---- جدول القياسات ----
  if (input.rows.length) {
    heading(S.data);
    const cols = input.columns;
    const nCols = cols.length + 1;
    const cw = W / nCols;
    const ordered = rtl ? [...cols].reverse() : cols;
    const drawHeader = () => {
      doc.rect(L, y, W, 20).fill("#0f4c81");
      const cells = rtl ? [...ordered.map((c) => `${c.label} (${c.unit})`), S.n] : [S.n, ...ordered.map((c) => `${c.label} (${c.unit})`)];
      cells.forEach((c, i) => put(c, L + i * cw + 4, y + 6, cw - 8, { bold: true, size: 8, color: "#fff", align: "center" }));
      y += 20;
    };
    drawHeader();
    input.rows.forEach((row, idx) => {
      if (y > 780) {
        doc.addPage();
        y = 50;
        drawHeader();
      }
      if (idx % 2) doc.rect(L, y, W, 18).fill("#f8fafc");
      const cells = rtl ? [...ordered.map((c) => fmt(row[c.key], c.decimals)), String(idx + 1)] : [String(idx + 1), ...ordered.map((c) => fmt(row[c.key], c.decimals))];
      cells.forEach((c, i) => put(c, L + i * cw + 4, y + 5, cw - 8, { size: 9, align: "center" }));
      y += 18;
    });
    y += 16;
  }

  // ---- المنحنى ----
  if (input.chart && input.rows.length >= 2) {
    const ch = input.chart;
    if (y > 470) {
      doc.addPage();
      y = 50;
    }
    heading(S.curve);
    const H = 240,
      pl = 52,
      pr = 14,
      pt = 10,
      pb = 34;
    const gx = L + pl,
      gy = y + pt,
      gw = W - pl - pr,
      gh = H - pt - pb;
    const xs = input.rows.map((r) => r[ch.x]);
    const ys = input.rows.map((r) => r[ch.y]);
    const sx = niceScale(Math.min(0, ...xs), Math.max(...xs));
    const sy = niceScale(Math.min(0, ...ys), Math.max(...ys));
    const X = (v: number) => gx + ((v - sx.lo) / (sx.hi - sx.lo)) * gw;
    const Y = (v: number) => gy + gh - ((v - sy.lo) / (sy.hi - sy.lo)) * gh;
    doc.lineWidth(0.5);
    // شبكة + تدريجات
    sx.vals.forEach((v) => {
      doc.strokeColor("#e5e7eb").moveTo(X(v), gy).lineTo(X(v), gy + gh).stroke();
      put(String(v), X(v) - 20, gy + gh + 4, 40, { size: 7, align: "center" });
    });
    sy.vals.forEach((v) => {
      doc.strokeColor("#e5e7eb").moveTo(gx, Y(v)).lineTo(gx + gw, Y(v)).stroke();
      put(String(v), gx - 46, Y(v) - 4, 40, { size: 7, align: "right" });
    });
    doc.strokeColor("#6b7280").lineWidth(1).rect(gx, gy, gw, gh).stroke();
    // منحنى الملاءمة
    if (ch.fit) {
      doc.strokeColor("#f59e0b").lineWidth(1.2).dash(4, { space: 3 });
      doc.moveTo(X(sx.lo), Y(ch.fit.intercept + ch.fit.slope * sx.lo)).lineTo(X(sx.hi), Y(ch.fit.intercept + ch.fit.slope * sx.hi)).stroke().undash();
    }
    // خط يصل النقاط (للمنحنيات) + النقاط
    const pts = input.rows.map((r) => [r[ch.x], r[ch.y]] as const).sort((a, b) => a[0] - b[0]);
    if (ch.mode === "line") {
      doc.strokeColor("#0f4c81").lineWidth(1.4);
      pts.forEach(([a, b], i) => (i ? doc.lineTo(X(a), Y(b)) : doc.moveTo(X(a), Y(b))));
      doc.stroke();
    }
    pts.forEach(([a, b]) => doc.circle(X(a), Y(b), 2.6).fill("#0f4c81"));
    put(ch.xLabel, gx, gy + gh + 18, gw, { size: 8, bold: true, align: "center" });
    put(ch.yLabel, L, y - 2, W, { size: 8, bold: true, align: rtl ? "right" : "left" });
    y += H + 12;
  }

  // ---- النتائج ----
  if (input.results?.length) {
    heading(S.results);
    for (const r of input.results) {
      if (y > 770) {
        doc.addPage();
        y = 50;
      }
      if (rtl) {
        put(r.label, R - 300, y, 300, { bold: true });
        put(r.value, L, y, W - 310, { align: "left" });
      } else {
        put(r.label, L, y, 300, { bold: true });
        put(r.value, L + 310, y, W - 310);
      }
      y += 15;
      if (r.note) {
        put(r.note, L, y, W, { size: 8, color: "#6b7280" });
        y += 13;
      }
    }
  }

  doc.page.margins.bottom = 0; // يمنع pdfkit من إنشاء صفحة فارغة بسبب سطر التذييل
  put(S.generated, L, 805, W, { size: 7, color: "#9ca3af", align: "center" });
  doc.end();
  await new Promise<void>((res, rej) => {
    stream.on("finish", () => res());
    stream.on("error", rej);
  });
  return filePath;
}

/** انحدار خطي بسيط لرسم خط الملاءمة في التقرير */
export function linearFit(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0,
    sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (!sxx) return null;
  return { slope: sxy / sxx, intercept: my - (sxy / sxx) * mx };
}
