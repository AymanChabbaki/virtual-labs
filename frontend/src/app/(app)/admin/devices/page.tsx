"use client";
// إدارة الأجهزة (مدير): الحالة الحية، وضع الصيانة، الإيقاف الطارئ، حدود الأمان، ساعات العمل
import { useState } from "react";
import useSWR from "swr";
import { Badge, Button, Card, Empty, Field, Modal, PageLoader, useUx } from "@/components/ui";
import { api, fetcher } from "@/lib/api";
import { useI18n } from "@/i18n";
import type { Telemetry } from "@/lib/types";

interface Dev {
  id: string;
  name: string;
  driver: "MOCK" | "MQTT";
  topic: string;
  videoUrl: string | null;
  slotMinutes: number;
  maintenance: boolean;
  online: boolean;
  latest: Telemetry | null;
  limits: { voltage: { min: number; max: number }; maxCurrentMa: number; loads: string[]; maxCommandsPerSec: number; openHour?: number; closeHour?: number };
}
const LOADS = ["R100", "R220", "R470", "RC", "DIODE"];
const blank = () => ({ id: "", name: "", driver: "MOCK" as "MOCK" | "MQTT", topic: "", videoUrl: "", slotMinutes: 15, maintenance: false, vmin: 0, vmax: 12, imax: 150, rate: 8, open: 0, close: 24, loads: [...LOADS] });

export default function DevicesPage() {
  const { t } = useI18n();
  const ux = useUx();
  const { data, mutate } = useSWR<{ devices: Dev[] }>("/admin/devices", fetcher, { refreshInterval: 5000 });
  const [edit, setEdit] = useState<ReturnType<typeof blank> | null>(null);
  const [busy, setBusy] = useState(false);
  if (!data) return <PageLoader />;

  const toEdit = (d: Dev) => ({ id: d.id, name: d.name, driver: d.driver, topic: d.topic, videoUrl: d.videoUrl ?? "", slotMinutes: d.slotMinutes, maintenance: d.maintenance, vmin: d.limits.voltage.min, vmax: d.limits.voltage.max, imax: d.limits.maxCurrentMa, rate: d.limits.maxCommandsPerSec, open: d.limits.openHour ?? 0, close: d.limits.closeHour ?? 24, loads: d.limits.loads });

  const save = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      const body = {
        name: edit.name,
        driver: edit.driver,
        topic: edit.topic,
        videoUrl: edit.videoUrl || null,
        slotMinutes: edit.slotMinutes,
        maintenance: edit.maintenance,
        limits: { voltage: { min: edit.vmin, max: edit.vmax }, maxCurrentMa: edit.imax, loads: edit.loads, maxCommandsPerSec: edit.rate, openHour: edit.open, closeHour: edit.close },
      };
      if (edit.id) await api(`/admin/devices/${edit.id}`, { method: "PATCH", body });
      else await api("/admin/devices", { method: "POST", body });
      setEdit(null);
      await mutate();
    } catch (e) {
      ux.error(e);
    } finally {
      setBusy(false);
    }
  };

  const patch = async (d: Dev, body: object) => {
    try {
      await api(`/admin/devices/${d.id}`, { method: "PATCH", body });
      await mutate();
    } catch (e) {
      ux.error(e);
    }
  };
  const estop = async (d: Dev) => {
    if (!(await ux.confirm(t("admin.estop_confirm"), { danger: true }))) return;
    try {
      await api(`/admin/devices/${d.id}/estop`, { method: "POST" });
      ux.toast(t("admin.estop_done"), "success");
      await mutate();
    } catch (e) {
      ux.error(e);
    }
  };
  const remove = async (d: Dev) => {
    if (!(await ux.confirm(t("admin.device_delete_confirm", { name: d.name }), { danger: true }))) return;
    try {
      await api(`/admin/devices/${d.id}`, { method: "DELETE" });
      await mutate();
    } catch (e) {
      ux.error(e);
    }
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("nav.devices")}</h1>
        <Button onClick={() => setEdit(blank())}>+ {t("admin.new_device")}</Button>
      </div>
      {!data.devices.length ? (
        <Empty>{t("admin.no_devices")}</Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.devices.map((d) => (
            <Card key={d.id} className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{d.name}</h2>
                  <div className="num text-xs text-ink-3" dir="ltr">
                    {d.driver} · labs/{d.topic}
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-1.5">
                  <Badge tone={d.online ? "green" : "red"}>{d.online ? t("device.online") : t("device.offline")}</Badge>
                  {d.maintenance && <Badge tone="amber">{t("device.maintenance")}</Badge>}
                  {d.latest?.estop && <Badge tone="red">E-STOP</Badge>}
                  {d.latest?.tripped && <Badge tone="red">TRIP</Badge>}
                </div>
              </div>
              {d.latest && (
                <div className="num grid grid-cols-4 gap-2 rounded-xl bg-slate-50 p-3 text-center text-sm" dir="ltr">
                  <Mini l="V" v={d.latest.voltage.toFixed(2)} />
                  <Mini l="mA" v={d.latest.current.toFixed(1)} />
                  <Mini l="°C" v={d.latest.temp.toFixed(1)} />
                  <Mini l="load" v={d.latest.load} />
                </div>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
                <span>{t("admin.slot_min", { n: d.slotMinutes })}</span>
                <span className="num">
                  {d.limits.voltage.min}–{d.limits.voltage.max} V
                </span>
                <span className="num">≤ {d.limits.maxCurrentMa} mA</span>
                <span className="num">
                  {d.limits.openHour ?? 0}h–{d.limits.closeHour ?? 24}h
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => setEdit(toEdit(d))}>
                  {t("common.edit")}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => patch(d, { maintenance: !d.maintenance })}>
                  {d.maintenance ? t("admin.end_maintenance") : t("admin.start_maintenance")}
                </Button>
                <Button size="sm" variant="danger" onClick={() => estop(d)}>
                  ⛔ {t("remote.estop")}
                </Button>
                <Button size="sm" variant="ghost" className="ms-auto text-danger" onClick={() => remove(d)}>
                  ✕
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? t("common.edit") : t("admin.new_device")} wide>
        {edit && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("admin.col.name")}>
                <input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              </Field>
              <Field label={t("admin.driver")}>
                <select className="input" value={edit.driver} onChange={(e) => setEdit({ ...edit, driver: e.target.value as "MOCK" | "MQTT" })}>
                  <option value="MOCK">MOCK ({t("admin.driver_mock")})</option>
                  <option value="MQTT">MQTT ({t("admin.driver_mqtt")})</option>
                </select>
              </Field>
              <Field label="MQTT topic" hint="labs/<topic>/cmd | telemetry | status">
                <input className="input num" dir="ltr" value={edit.topic} onChange={(e) => setEdit({ ...edit, topic: e.target.value.toLowerCase() })} />
              </Field>
              <Field label={t("admin.video_url")} hint={t("admin.video_hint")}>
                <input className="input num" dir="ltr" placeholder="http://raspberrypi.local:8080/stream.mjpg" value={edit.videoUrl} onChange={(e) => setEdit({ ...edit, videoUrl: e.target.value })} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Num label={t("admin.slot_len")} v={edit.slotMinutes} on={(n) => setEdit({ ...edit, slotMinutes: n })} />
              <Num label="V min" v={edit.vmin} on={(n) => setEdit({ ...edit, vmin: n })} />
              <Num label="V max" v={edit.vmax} on={(n) => setEdit({ ...edit, vmax: n })} />
              <Num label="I max (mA)" v={edit.imax} on={(n) => setEdit({ ...edit, imax: n })} />
              <Num label={t("admin.rate")} v={edit.rate} on={(n) => setEdit({ ...edit, rate: n })} />
              <Num label={t("admin.open_hour")} v={edit.open} on={(n) => setEdit({ ...edit, open: n })} />
              <Num label={t("admin.close_hour")} v={edit.close} on={(n) => setEdit({ ...edit, close: n })} />
            </div>
            <div>
              <div className="mb-1 text-sm font-medium text-ink-2">{t("admin.allowed_loads")}</div>
              <div className="flex flex-wrap gap-2">
                {LOADS.map((l) => {
                  const on = edit.loads.includes(l);
                  return (
                    <button key={l} onClick={() => setEdit({ ...edit, loads: on ? edit.loads.filter((x) => x !== l) : [...edit.loads, l] })} className={`num rounded-full border px-3 py-1 text-sm ${on ? "border-brand-600 bg-brand-50 text-brand-700" : "border-line"}`} aria-pressed={on}>
                      {l}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={edit.maintenance} onChange={(e) => setEdit({ ...edit, maintenance: e.target.checked })} />
              {t("device.maintenance")}
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEdit(null)}>
                {t("common.cancel")}
              </Button>
              <Button loading={busy} onClick={save} disabled={!edit.name || !edit.topic || !edit.loads.length}>
                {t("common.save")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

const Mini = ({ l, v }: { l: string; v: string }) => (
  <div>
    <div className="font-semibold">{v}</div>
    <div className="text-xs text-ink-3">{l}</div>
  </div>
);
const Num = ({ label, v, on }: { label: string; v: number; on: (n: number) => void }) => (
  <Field label={label}>
    <input className="input num" type="number" step="any" value={v} onChange={(e) => on(Number(e.target.value))} />
  </Field>
);
