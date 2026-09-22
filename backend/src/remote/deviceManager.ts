// سجلّ الأجهزة: ينشئ سائقاً (Mock أو MQTT) لكل جهاز ويعيد بث القياسات
import { EventEmitter } from "events";
import type { Device } from "../generated/prisma/client";
import { prisma } from "../db";
import { MockDevice } from "./mockDevice";
import { MqttDevice } from "./mqttDevice";
import { DEFAULT_LIMITS, type DeviceDriver, type DeviceLimits, type Telemetry } from "./types";

/** أحداث: 'telemetry' (deviceId, t) و 'trip' (deviceId, reason) */
export const deviceBus = new EventEmitter();

const drivers = new Map<string, DeviceDriver>();

export const limitsOf = (d: Pick<Device, "limits">): DeviceLimits => ({ ...DEFAULT_LIMITS, ...(d.limits as object) }) as DeviceLimits;

function create(d: Device): DeviceDriver {
  const drv: DeviceDriver = d.driver === "MQTT" ? new MqttDevice(d.topic) : new MockDevice(limitsOf(d));
  drv.on("telemetry", (t: Telemetry) => deviceBus.emit("telemetry", d.id, t));
  drv.on("trip", (reason: string) => deviceBus.emit("trip", d.id, reason));
  return drv;
}

export async function initDevices() {
  for (const d of await prisma.device.findMany()) drivers.set(d.id, create(d));
  console.log(`[devices] ${drivers.size} device driver(s) started`);
}

/** يعيد تحميل جهاز بعد تعديله من لوحة المدير */
export async function reloadDevice(id: string) {
  const old = drivers.get(id);
  if (old) {
    await old.safeState().catch(() => undefined);
    await old.close();
    drivers.delete(id);
  }
  const d = await prisma.device.findUnique({ where: { id } });
  if (d) drivers.set(id, create(d));
}

export async function removeDevice(id: string) {
  const old = drivers.get(id);
  if (old) await old.close();
  drivers.delete(id);
}

export const getDriver = (id: string) => drivers.get(id);

export async function shutdownDevices() {
  for (const d of drivers.values()) await d.close().catch(() => undefined);
}
