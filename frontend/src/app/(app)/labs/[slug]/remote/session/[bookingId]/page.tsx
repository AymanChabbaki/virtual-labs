"use client";
// صفحة الجلسة المباشرة (المرحلة 3): فيديو + قياسات لحظية + تحكم + تسجيل نقاط.
// كل شيء يمرّ عبر Socket.io؛ الخادم يعيد التحقق من القفل والملكية والوقت مع كل أمر.
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Alert, Badge, Button, Card, PageLoader, mmss, useCountdown, useUx } from "@/components/ui";
import { Chart } from "@/components/Chart";
import { MockCamera } from "@/components/remote/MockCamera";
import { API_URL, fetcher } from "@/lib/api";
import { emitAck, useSocket } from "@/lib/socket";
import type { Bi, RemoteConfig, Telemetry } from "@/lib/types";
import { useI18n } from "@/i18n";

interface JoinAck {
  ok: boolean;
  error?: string;
  booking: { id: string; startsAt: string; endsAt: string };
  serverTime: number;
  remote: RemoteConfig;
  limits: { voltage: { min: number; max: number }; maxCurrentMa: number };
  hasVideo: boolean;
  online: boolean;
  telemetry: Telemetry | null;
  samples: { id: string; at: string; values: Record<string, number> }[];
  commands: CmdLog[];
}
interface CmdLog {
  id: string;
  name: string;
  params: any;
  accepted: boolean;
  reason?: string | null;
  createdAt: string;
}

const KEEP_SEC = 30;
const SAMPLE_FIELDS: Record<string, { fr: string; ar: string; unit: string; dec: number }> = {
  voltage: { fr: "U source", ar: "جهد المنبع", unit: "V", dec: 2 },
  vLoad: { fr: "U charge", ar: "جهد الحمل", unit: "V", dec: 3 },
  current: { fr: "I", ar: "التيار", unit: "mA", dec: 2 },
  power: { fr: "P", ar: "الاستطاعة", unit: "mW", dec: 1 },
  temp: { fr: "T", ar: "الحرارة", unit: "°C", dec: 1 },
  tSwitch: { fr: "t", ar: "الزمن", unit: "s", dec: 2 },
};

export default function RemoteSessionPage() {
  const { slug, bookingId } = useParams<{ slug: string; bookingId: string }>();
  const router = useRouter();
  const { t, lang } = useI18n();
  const ux = useUx();
  const { socket, connected } = useSocket();
  const pick = (b: Bi) => (lang === "ar" ? b.ar : b.fr);

  const { data: info, error: infoErr } = useSWR<{ booking: { status: string; endsAt: string }; hasVideo: boolean; videoToken: string | null; serverTime: number }>(`/remote/bookings/${bookingId}`, fetcher, { revalidateOnFocus: false });

  const [join, setJoin] = useState<JoinAck | null>(null);
  const [joinErr, setJoinErr] = useState<string | null>(null);
  const [tel, setTel] = useState<Telemetry | null>(null);
  const [hist, setHist] = useState<Telemetry[]>([]);
  const histRef = useRef<Telemetry[]>([]);
  const [samples, setSamples] = useState<JoinAck["samples"]>([]);
  const [cmds, setCmds] = useState<CmdLog[]>([]);
  const [ended, setEnded] = useState<string | null>(null);
  const [trip, setTrip] = useState<string | null>(null);
  const [volt, setVolt] = useState(0);
  const [busy, setBusy] = useState(false);
  const skew = join ? join.serverTime - Date.now() : 0;
  const endMs = join ? new Date(join.booking.endsAt).getTime() : null;
  const left = useCountdown(endMs, skew);
  const autoLoad = useRef(false);

  // ---------------------------------------------------------------- الانضمام + الاستماع
  useEffect(() => {
    if (!socket || !connected) return;
    let alive = true;
    const onTel = (x: Telemetry) => {
      setTel(x);
      const h = histRef.current;
      h.push(x);
      const cut = x.ts - KEEP_SEC * 1000;
      while (h.length && h[0].ts < cut) h.shift();
    };
    const onLog = (row: CmdLog) => setCmds((l) => [...l.filter((x) => x.id !== row.id), row].slice(-20));
    const onEnd = (m: { reason: string }) => setEnded(m.reason);
    const onTrip = (m: { reason: string }) => setTrip(m.reason);
    socket.on("telemetry", onTel);
    socket.on("command:log", onLog);
    socket.on("session:ended", onEnd);
    socket.on("device:trip", onTrip);
    emitAck<JoinAck>(socket, "session:join", { bookingId }).then((r) => {
      if (!alive) return;
      if (!r.ok) return setJoinErr(r.error ?? "ERROR");
      setJoin(r);
      setTel(r.telemetry);
      setSamples(r.samples);
      setCmds(r.commands);
      setVolt(r.telemetry?.setpoint ?? 0);
    });
    return () => {
      alive = false;
      socket.off("telemetry", onTel);
      socket.off("command:log", onLog);
      socket.off("session:ended", onEnd);
      socket.off("device:trip", onTrip);
    };
  }, [socket, connected, bookingId]);

  // نسخة مخفَّفة (4 مرات/ثانية) من التاريخ لرسم المخططات
  useEffect(() => {
    const i = setInterval(() => setHist([...histRef.current]), 250);
    return () => clearInterval(i);
  }, []);

  // ---------------------------------------------------------------- الأوامر
  const send = useCallback(
    async (name: string, params: object = {}, quiet = false) => {
      if (!socket) return false;
      const r = await emitAck<{ ok: boolean; error?: string }>(socket, "device:command", { bookingId, name, params });
      if (!r.ok && !quiet) {
        const code = (r.error ?? "ERROR").split(":")[0];
        const m = t(`remote.rej.${code}`);
        ux.toast(m === `remote.rej.${code}` ? `${t("err.UNKNOWN")} (${r.error})` : m, "error");
      }
      return !!r.ok;
    },
    [socket, bookingId, t, ux],
  );

  // اختيار الحمل المطلوب للتجربة تلقائياً مرة واحدة
  useEffect(() => {
    if (join && tel && !autoLoad.current && !tel.estop && !tel.tripped && tel.load !== join.remote.load) {
      autoLoad.current = true;
      send("select_load", { load: join.remote.load }, true);
    }
  }, [join, tel, send]);

  // مؤقّت لإرسال set_voltage أثناء سحب المنزلق (≤ 5/s) + إرسال القيمة النهائية
  const lastSend = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setVoltage = (v: number, final = false) => {
    setVolt(v);
    const go = () => {
      lastSend.current = Date.now();
      send("set_voltage", { value: v }, true);
    };
    if (pending.current) clearTimeout(pending.current);
    if (final || Date.now() - lastSend.current > 200) go();
    else pending.current = setTimeout(go, 200);
  };

  const record = async () => {
    if (!socket) return;
    setBusy(true);
    const r = await emitAck<any>(socket, "device:record", { bookingId });
    setBusy(false);
    if (!r.ok) {
      const m = t(`remote.rej.${r.error}`);
      return ux.toast(m === `remote.rej.${r.error}` ? t(`err.${r.error}`) : m, "error");
    }
    setSamples((l) => [...l, r.sample]);
    ux.toast(t("remote.recorded", { n: r.total }), "success");
  };

  const endSession = async () => {
    if (!socket || !(await ux.confirm(t("remote.end_confirm")))) return;
    await emitAck(socket, "session:end", { bookingId });
  };

  // ---------------------------------------------------------------- مشتقّات
  const series = useMemo(() => {
    const last = hist.length ? hist[hist.length - 1].ts : Date.now();
    const pts = (f: (x: Telemetry) => number) => hist.map((x) => ({ x: (x.ts - last) / 1000, y: f(x) }));
    return { v: pts((x) => x.voltage), vl: pts((x) => x.vLoad), i: pts((x) => x.current) };
  }, [hist]);

  if (infoErr || joinErr) {
    const code = joinErr ?? "ERROR";
    return (
      <div className="mx-auto max-w-xl py-10">
        <Alert tone="red">{t(`err.${code}`) === `err.${code}` ? t("remote.session_unavailable") : t(`err.${code}`)}</Alert>
        <Button className="mt-4" variant="secondary" onClick={() => router.push(`/labs/${slug}/remote`)}>
          {t("common.back")}
        </Button>
      </div>
    );
  }
  if (!info || !join) return <PageLoader />;

  const remote = join.remote;
  const px = remote.plot.x;
  const py = remote.plot.y;
  const fitPoints = samples.map((s) => ({ x: s.values[px], y: s.values[py] })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const estop = !!tel?.estop;
  const tripped = !!tel?.tripped;
  const locked = estop || tripped || !!ended;
  const videoSrc = info.hasVideo && info.videoToken ? `${API_URL}/api/remote/video/${bookingId}?st=${encodeURIComponent(info.videoToken)}` : null;
  const enough = samples.length >= remote.minPoints;

  return (
    <div className="space-y-5">
      {/* --------------------------------------------------- شريط الحالة */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge tone={connected && join.online ? "green" : "red"}>
            <span className={`inline-block h-2 w-2 rounded-full ${connected && join.online ? "bg-emerald-500" : "bg-red-500"}`} />
            {connected ? (join.online ? t("remote.live") : t("remote.device_offline")) : t("remote.reconnecting")}
          </Badge>
          <Badge tone="blue">{t("remote.load_is", { l: remote.load })}</Badge>
        </div>
        <div className="flex items-center gap-3">
          <div className={`rounded-xl px-4 py-2 num text-xl font-semibold ${(left ?? 0) < 60 ? "bg-red-50 text-red-700" : "bg-slate-100 text-ink"}`} aria-label={t("remote.time_left")}>
            ⏱ {mmss(left ?? 0)}
          </div>
          <Button variant="secondary" onClick={endSession} disabled={!!ended}>
            {t("remote.end")}
          </Button>
        </div>
      </div>

      {(estop || tripped) && !ended && (
        <Alert tone="red" className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">
            {estop ? t("remote.estop_active") : t("remote.tripped")}
            {trip && !estop ? ` (${trip})` : ""}
          </span>
          <Button size="sm" variant="secondary" onClick={() => (setTrip(null), send("reset"))}>
            {t("remote.reset")}
          </Button>
        </Alert>
      )}

      <Alert tone="blue">{pick(remote.instructions)}</Alert>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* --------------------------------------------------- الفيديو + القياسات */}
        <div className="space-y-4 lg:col-span-3">
          <Card className="p-2 sm:p-3">
            {videoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={videoSrc} alt="live" className="aspect-[8/5] w-full rounded-xl bg-black object-contain" />
            ) : (
              <MockCamera t={tel} />
            )}
          </Card>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label={t("remote.tile.voltage")} value={tel?.voltage} unit="V" dec={2} color="text-emerald-700" />
            <Tile label={t("remote.tile.vload")} value={tel?.vLoad} unit="V" dec={3} color="text-cyan-700" />
            <Tile label={t("remote.tile.current")} value={tel?.current} unit="mA" dec={2} color="text-amber-700" warn={!!tel && Math.abs(tel.current) > join.limits.maxCurrentMa * 0.85} />
            <Tile label={t("remote.tile.temp")} value={tel?.temp} unit="°C" dec={1} color="text-slate-700" warn={!!tel && tel.temp > 60} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card className="p-3">
              <Chart title={t("remote.chart.v")} series={[{ id: "v", name: "U (V)", kind: "line", points: series.v, color: "#2a78d6" }]} xLabel={t("remote.chart.t")} yLabel="V" height={190} includeZero={false} xDomain={[-KEEP_SEC, 0]} yDomain={[0, Math.max(2, Math.ceil(join.limits.voltage.max))]} />
            </Card>
            <Card className="p-3">
              <Chart title={t("remote.chart.i")} series={[{ id: "i", name: "I (mA)", kind: "line", points: series.i, color: "#eb6834" }]} xLabel={t("remote.chart.t")} yLabel="mA" height={190} includeZero={false} xDomain={[-KEEP_SEC, 0]} />
            </Card>
          </div>
        </div>

        {/* --------------------------------------------------- لوحة التحكم */}
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <h2 className="mb-4 font-semibold">{t("remote.controls")}</h2>

            <label className="mb-1 flex items-center justify-between text-sm font-medium text-ink-2">
              <span>{t("remote.set_voltage")}</span>
              <span className="num text-lg font-semibold text-ink">{volt.toFixed(2)} V</span>
            </label>
            <input
              type="range"
              className="w-full accent-brand-600"
              min={join.limits.voltage.min}
              max={join.limits.voltage.max}
              step={0.05}
              value={volt}
              disabled={locked}
              onChange={(e) => setVoltage(Number(e.target.value))}
              onPointerUp={(e) => setVoltage(Number((e.target as HTMLInputElement).value), true)}
              onKeyUp={(e) => setVoltage(Number((e.target as HTMLInputElement).value), true)}
              dir="ltr"
              aria-label={t("remote.set_voltage")}
            />
            <div className="num mb-4 flex justify-between text-xs text-ink-3" dir="ltr">
              <span>{join.limits.voltage.min} V</span>
              <span>
                {t("remote.max_allowed")}: {join.limits.voltage.max} V
              </span>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-2">
              <Button variant={tel?.switchOn ? "success" : "secondary"} disabled={locked} onClick={() => send("switch", { state: "on" })}>
                {t("remote.out_on")}
              </Button>
              <Button variant={!tel?.switchOn ? "primary" : "secondary"} disabled={locked} onClick={() => send("switch", { state: "off" })}>
                {t("remote.out_off")}
              </Button>
            </div>
            {remote.load === "RC" && <p className="mb-3 text-xs text-ink-3">{t("remote.rc_hint")}</p>}

            <button
              onClick={() => send("emergency_stop")}
              disabled={!!ended}
              className="flex h-20 w-full items-center justify-center rounded-2xl border-4 border-red-800 bg-red-600 text-xl font-extrabold tracking-wide text-white shadow-[0_6px_0_#7f1d1d] transition active:translate-y-1 active:shadow-[0_2px_0_#7f1d1d] disabled:opacity-50"
            >
              ⛔ {t("remote.estop")}
            </button>
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">{t("remote.measures")}</h2>
              <Badge tone={enough ? "green" : "amber"}>
                {samples.length}/{remote.minPoints}
              </Badge>
            </div>
            <Button className="w-full" variant="success" loading={busy} disabled={locked} onClick={record}>
              ● {t("remote.record")}
            </Button>
            <p className="mt-2 text-xs text-ink-3">{t("remote.record_hint")}</p>

            {samples.length > 0 && (
              <div className="mt-4">
                <Chart series={[{ id: "s", name: t("remote.points"), kind: "scatter", points: fitPoints }]} xLabel={pick(remote.plot.xLabel)} yLabel={pick(remote.plot.yLabel)} height={210} />
                <div className="scroll-x mt-3 max-h-48 overflow-y-auto rounded-lg border border-line">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-slate-50 text-ink-3">
                      <tr>
                        <th className="px-2 py-1 text-start">#</th>
                        {["voltage", "vLoad", "current", "tSwitch"].map((k) => (
                          <th key={k} className="px-2 py-1 text-start">
                            {SAMPLE_FIELDS[k][lang]} ({SAMPLE_FIELDS[k].unit})
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="num">
                      {samples.map((s, i) => (
                        <tr key={s.id} className="border-t border-line">
                          <td className="px-2 py-1">{i + 1}</td>
                          {["voltage", "vLoad", "current", "tSwitch"].map((k) => (
                            <td key={k} className="px-2 py-1">
                              {Number(s.values[k]).toFixed(SAMPLE_FIELDS[k].dec)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>

          <Card>
            <h2 className="mb-2 font-semibold">{t("remote.log")}</h2>
            <ul className="max-h-44 space-y-1 overflow-y-auto text-xs" dir="ltr">
              {cmds.length === 0 && <li className="text-ink-3">—</li>}
              {[...cmds].reverse().map((c) => (
                <li key={c.id} className="flex items-baseline gap-2 num">
                  <span className="text-ink-3">{new Date(c.createdAt).toLocaleTimeString()}</span>
                  <span className={c.accepted ? "text-emerald-700" : "text-red-600"}>{c.accepted ? "✓" : "✗"}</span>
                  <span className="font-medium">{c.name}</span>
                  <span className="truncate text-ink-3">{Object.keys(c.params ?? {}).length ? JSON.stringify(c.params) : ""}</span>
                  {c.reason && <span className="text-red-600">{c.reason}</span>}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      {/* --------------------------------------------------- نهاية الجلسة */}
      {ended && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-2xl">
            <div className="mb-2 text-4xl">{ended === "timeout" ? "⏱" : "✅"}</div>
            <h2 className="mb-1 text-xl font-semibold">{t("remote.ended_title")}</h2>
            <p className="mb-5 text-ink-2">
              {t(`remote.ended.${ended}`) === `remote.ended.${ended}` ? t("remote.ended.default") : t(`remote.ended.${ended}`)} · {t("remote.points_recorded", { n: samples.length, min: remote.minPoints })}
            </p>
            <Button size="lg" onClick={() => router.push(`/labs/${slug}/remote`)}>
              {enough ? t("remote.go_finish") : t("remote.back_hub")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, unit, dec, color, warn }: { label: string; value?: number; unit: string; dec: number; color: string; warn?: boolean }) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${warn ? "border-red-300 bg-red-50" : "border-line bg-white"}`}>
      <div className="text-xs text-ink-3">{label}</div>
      <div className={`num text-2xl font-semibold ${warn ? "text-red-700" : color}`} dir="ltr">
        {value === undefined || !Number.isFinite(value) ? "--" : value.toFixed(dec)}
        <span className="ms-1 text-sm font-normal text-ink-3">{unit}</span>
      </div>
    </div>
  );
}
