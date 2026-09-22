"use client";
// المرحلة 3 (مدخل): حجز حصص التحكم عن بُعد، الطابور، حجوزاتي، وإتمام التقرير
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { api, download, fetcher } from "@/lib/api";
import { useI18n } from "@/i18n";
import { useSocket } from "@/lib/socket";
import { Alert, Badge, Button, Card, PageLoader, ProgressBar, cx, useUx } from "@/components/ui";
import type { LabSummary, RemoteConfig } from "@/lib/types";

interface RStatus {
  unlocked: boolean;
  completed: boolean;
  remote?: RemoteConfig;
  device: { id: string; name: string; slotMinutes: number; maintenance: boolean; online: boolean; mock: boolean } | null;
  bookings: { id: string; startsAt: string; endsAt: string; status: "BOOKED" | "ACTIVE" }[];
  activeBookingId: string | null;
  maxOpenBookings: number;
  samples: number;
  distinctPoints: number;
  minPoints: number;
}
interface Slot {
  startsAt: string;
  endsAt: string;
  state: "free" | "taken" | "mine" | "past";
}
interface QItem {
  id: string;
  position: number;
  startsAt: string;
  endsAt: string;
  status: string;
  mine: boolean;
  student: string | null;
}

export default function RemoteHub() {
  const { slug } = useParams<{ slug: string }>();
  const { t, pick, fmtDateTime, fmtTime, lang, tr } = useI18n();
  const { toast, error, confirm } = useUx();
  const { socket } = useSocket();
  const { data: lab } = useSWR<{ lab: LabSummary }>(`/labs/${slug}`, fetcher);
  const { data: st, mutate: mutSt, isLoading } = useSWR<RStatus>(`/remote/labs/${slug}/status`, fetcher);
  const dev = st?.device;
  const from = useMemo(() => new Date().toISOString(), []);
  const { data: slots, mutate: mutSlots } = useSWR<{ slots: Slot[]; slotMinutes: number }>(dev && st?.unlocked ? `/remote/devices/${dev.id}/slots?from=${from}&days=4` : null, fetcher);
  const { data: queue, mutate: mutQ } = useSWR<{ queue: QItem[] }>(dev && st?.unlocked ? `/remote/devices/${dev.id}/queue` : null, fetcher, { refreshInterval: 30_000 });
  const [day, setDay] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ reportId: string; results: { label: string; value: string }[] } | null>(null);

  const refresh = () => Promise.all([mutSt(), mutSlots(), mutQ()]);

  // تحديث لحظي: تغيّر الطابور / بدء جلسة
  useEffect(() => {
    if (!socket || !dev) return;
    socket.emit("queue:watch", dev.id);
    const h = () => void refresh();
    socket.on("queue:changed", h);
    socket.on("session:started", h);
    socket.on("session:ended", h);
    return () => {
      socket.off("queue:changed", h);
      socket.off("session:started", h);
      socket.off("session:ended", h);
    };
  }, [socket, dev?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const days = useMemo(() => {
    const m = new Map<string, Slot[]>();
    (slots?.slots ?? []).forEach((s) => {
      const k = new Date(s.startsAt).toLocaleDateString("en-CA"); // YYYY-MM-DD محلياً
      m.set(k, [...(m.get(k) ?? []), s]);
    });
    return [...m.entries()];
  }, [slots]);
  useEffect(() => {
    if (!day && days.length) setDay(days[0][0]);
  }, [days, day]);

  if (isLoading || !st || !lab) return <PageLoader />;
  const title = pick(lab.lab, "title");

  async function book(s: Slot) {
    if (!(await confirm(t("remote.confirm_book", { time: fmtDateTime(s.startsAt) })))) return;
    setBusy(true);
    try {
      await api("/remote/bookings", { method: "POST", body: { labId: lab!.lab.id, startsAt: s.startsAt } });
      toast(t("remote.booked"), "success");
      await refresh();
    } catch (e) {
      error(e);
      void refresh();
    } finally {
      setBusy(false);
    }
  }
  async function joinQueue() {
    setBusy(true);
    try {
      const r = await api<{ booking: { startsAt: string }; position: number }>("/remote/queue", { method: "POST", body: { labId: lab!.lab.id } });
      toast(t("remote.queued", { pos: r.position, time: fmtDateTime(r.booking.startsAt) }), "success");
      await refresh();
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
    }
  }
  async function cancel(id: string) {
    if (!(await confirm(t("remote.confirm_cancel"), { danger: true }))) return;
    try {
      await api(`/remote/bookings/${id}`, { method: "DELETE" });
      await refresh();
    } catch (e) {
      error(e);
    }
  }
  async function complete() {
    setBusy(true);
    try {
      setDone(await api(`/remote/labs/${slug}/complete`, { method: "POST" }));
      await mutSt();
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
    }
  }

  const head = (
    <div className="mb-5">
      <Link href={`/labs/${slug}`} className="text-sm text-brand-700 hover:underline">
        ← {title}
      </Link>
      <div className="mt-2">
        <Badge tone="green">{t("path.stage", { n: 3 })}</Badge>
      </div>
      <h1 className="mt-1 text-2xl font-semibold">{t("stage.3.name")}</h1>
    </div>
  );

  if (!st.unlocked) {
    return (
      <div className="mx-auto max-w-2xl">
        {head}
        <Card className="text-center">
          <div className="text-4xl">🔒</div>
          <h2 className="mt-2 text-lg font-semibold">{t("remote.locked_title")}</h2>
          <p className="mx-auto mt-1 max-w-md text-ink-2">{t("path.lock.stage3", { n: lab.lab.passThreshold })}</p>
          <Link href={`/labs/${slug}/quiz`} className="mt-4 inline-block">
            <Button variant="amber">{t("remote.go_quiz")}</Button>
          </Link>
        </Card>
      </div>
    );
  }

  const myBookings = st.bookings;
  const daySlots = days.find(([k]) => k === day)?.[1] ?? [];
  const pct = Math.min(100, Math.round((st.distinctPoints / Math.max(1, st.minPoints)) * 100));

  return (
    <div>
      {head}

      {st.completed && (
        <Alert tone="green" className="mb-5">
          ✅ {t("remote.completed")}{" "}
          <Link href="/reports" className="font-semibold underline">
            {t("nav.reports")}
          </Link>
        </Alert>
      )}

      {st.activeBookingId && (
        <Card className="mb-5 border-emerald-300 bg-emerald-50">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 font-semibold text-emerald-900">
                <span className="relative flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-600" />
                </span>
                {t("remote.session_active")}
              </div>
              <p className="mt-1 text-sm text-emerald-900/80">{t("remote.session_active_hint")}</p>
            </div>
            <Link href={`/labs/${slug}/remote/session/${st.activeBookingId}`}>
              <Button variant="success" size="lg">
                {t("remote.enter")} →
              </Button>
            </Link>
          </div>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-12">
        {/* ------------ الحجز ------------ */}
        <div className="space-y-5 lg:col-span-8">
          <Card>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">{t("remote.device")}</h2>
                {dev ? (
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{dev.name}</span>
                    <Badge tone={dev.maintenance ? "amber" : dev.online ? "green" : "red"}>{dev.maintenance ? t("device.maintenance") : dev.online ? "● " + t("device.online") : t("device.offline")}</Badge>
                    {dev.mock && <Badge tone="slate">{t("device.mock")}</Badge>}
                    <span className="text-ink-3">{t("remote.slot_len", { n: dev.slotMinutes })}</span>
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-ink-3">{t("remote.no_device")}</p>
                )}
              </div>
              <Button variant="primary" loading={busy} disabled={!dev || dev.maintenance || st.completed} onClick={joinQueue}>
                ⏭ {t("remote.join_queue")}
              </Button>
            </div>
            <p className="mb-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-ink-2">{t("remote.queue_hint")}</p>

            {dev && !dev.maintenance && !st.completed && (
              <>
                <h3 className="mb-2 text-sm font-medium text-ink-2">{t("remote.pick_slot")}</h3>
                <div className="scroll-x mb-3 flex gap-2 pb-1">
                  {days.map(([k, list]) => (
                    <button key={k} onClick={() => setDay(k)} className={cx("min-w-fit rounded-lg border px-3 py-1.5 text-sm transition", day === k ? "border-s3 bg-emerald-50 font-medium text-emerald-800" : "border-line bg-white text-ink-2 hover:border-emerald-300")}>
                      {new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "ar-MA-u-nu-latn", { weekday: "short", day: "numeric", month: "short" }).format(new Date(list[0].startsAt))}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                  {daySlots.map((s) => {
                    const free = s.state === "free";
                    return (
                      <button
                        key={s.startsAt}
                        disabled={!free || busy}
                        onClick={() => book(s)}
                        className={cx(
                          "num rounded-lg border px-2 py-2 text-sm font-medium transition",
                          free && "border-emerald-200 bg-white text-emerald-800 hover:border-emerald-500 hover:bg-emerald-50",
                          s.state === "mine" && "border-brand-300 bg-brand-50 text-brand-700",
                          s.state === "taken" && "border-line bg-slate-100 text-slate-400 line-through",
                          s.state === "past" && "border-transparent bg-transparent text-slate-300",
                        )}
                        title={t(`remote.slot.${s.state}`)}
                      >
                        {fmtTime(s.startsAt)}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 flex flex-wrap gap-4 text-xs text-ink-3">
                  <span>▢ {t("remote.slot.free")}</span>
                  <span className="text-brand-700">■ {t("remote.slot.mine")}</span>
                  <span className="line-through">{t("remote.slot.taken")}</span>
                </div>
              </>
            )}
          </Card>

          {/* ------------ التقدم والإتمام ------------ */}
          {st.remote && (
            <Card>
              <h2 className="font-semibold">{t("remote.task")}</h2>
              <p className="mt-2 text-sm text-ink-2">{tr(st.remote.instructions)}</p>
              <div className="mt-4 flex items-center gap-3">
                <div className="flex-1">
                  <ProgressBar value={pct} color="bg-s3" />
                </div>
                <span className="num text-sm font-semibold">
                  {st.distinctPoints} / {st.minPoints}
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-3">{t("remote.points_hint")}</p>
              {!done && (
                <Button className="mt-4" variant="success" loading={busy} disabled={st.distinctPoints < st.minPoints || st.completed} onClick={complete}>
                  📄 {t("remote.complete")}
                </Button>
              )}
              {done && (
                <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="font-semibold text-emerald-900">🎉 {t("remote.completed")}</div>
                  <ul className="mt-2 text-sm">
                    {done.results.map((r) => (
                      <li key={r.label}>
                        {r.label} : <span className="num font-semibold">{r.value}</span>
                      </li>
                    ))}
                  </ul>
                  <Button className="mt-3" variant="secondary" onClick={() => download(`/reports/${done.reportId}/download`, "remote-report.pdf").catch(error)}>
                    PDF ↓
                  </Button>
                </div>
              )}
            </Card>
          )}
        </div>

        {/* ------------ حجوزاتي + الطابور ------------ */}
        <div className="space-y-5 lg:col-span-4">
          <Card>
            <h2 className="mb-3 font-semibold">{t("remote.my_bookings")}</h2>
            {!myBookings.length ? (
              <p className="text-sm text-ink-3">{t("remote.no_bookings")}</p>
            ) : (
              <ul className="space-y-2">
                {myBookings.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                    <div>
                      <div className="num font-medium">{fmtDateTime(b.startsAt)}</div>
                      <Badge tone={b.status === "ACTIVE" ? "green" : "blue"}>{t(`booking.${b.status}`)}</Badge>
                    </div>
                    {b.status === "ACTIVE" ? (
                      <Link href={`/labs/${slug}/remote/session/${b.id}`}>
                        <Button size="sm" variant="success">
                          {t("remote.enter")}
                        </Button>
                      </Link>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => cancel(b.id)}>
                        ✕
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-ink-3">{t("remote.max_bookings", { n: st.maxOpenBookings })}</p>
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">{t("remote.queue")}</h2>
            {!queue?.queue.length ? (
              <p className="text-sm text-ink-3">{t("remote.queue_empty")}</p>
            ) : (
              <ol className="space-y-1.5">
                {queue.queue.slice(0, 12).map((q) => (
                  <li key={q.id} className={cx("flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm", q.mine ? "bg-brand-50 font-medium text-brand-800" : q.status === "ACTIVE" ? "bg-emerald-50" : "bg-slate-50 text-ink-2")}>
                    <span className="num flex h-5 w-5 items-center justify-center rounded-full bg-white text-[11px] ring-1 ring-line">{q.position}</span>
                    <span className="num flex-1">{fmtDateTime(q.startsAt)}</span>
                    {q.status === "ACTIVE" && <Badge tone="green">{t("booking.ACTIVE")}</Badge>}
                    {q.mine && <Badge tone="blue">{t("remote.you")}</Badge>}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

