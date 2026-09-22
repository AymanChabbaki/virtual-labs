// ============================================================================
//  حدود الأمان: كل أمر يمرّ من هنا قبل الوصول إلى الجهاز (الحقيقي أو الوهمي).
//  - قيم دنيا/قصوى لكل أمر (حدود الجهاز، مضيَّقة بحد الـ TP)
//  - رفض أي أمر خارج المجال أو غير معروف
//  - تحديد معدل الأوامر (rate limit) لكل جلسة
//  - عند الإيقاف الطارئ/الفصل التلقائي: لا تُقبل أوامر إلا reset
//  ⚠️ الجهاز الحقيقي يجب أن يطبّق حدوده أيضاً محلياً (دفاع متعدد الطبقات) — انظر hardware/
// ============================================================================
import type { DeviceCommand, DeviceLimits, LoadType, Telemetry } from "./types";

export interface LabRemoteLimits {
  load: LoadType;
  voltageMax?: number;
}

export interface Verdict {
  ok: boolean;
  reason?: string;
  cmd?: DeviceCommand;
}

const NAMES = ["set_voltage", "select_load", "switch", "reset", "emergency_stop"] as const;

/** نافذة انزلاقية لتحديد معدل الأوامر لكل جلسة */
const windows = new Map<string, number[]>();
export function rateLimited(sessionId: string, maxPerSec: number, now = Date.now()): boolean {
  const w = (windows.get(sessionId) ?? []).filter((t) => now - t < 1000);
  if (w.length >= maxPerSec) {
    windows.set(sessionId, w);
    return true;
  }
  w.push(now);
  windows.set(sessionId, w);
  return false;
}
export const clearRate = (sessionId: string) => windows.delete(sessionId);

export function validateCommand(limits: DeviceLimits, lab: LabRemoteLimits, raw: unknown, state: Telemetry | null): Verdict {
  const c = raw as Partial<DeviceCommand> | null;
  if (!c || typeof c !== "object" || !NAMES.includes(c.name as never)) return { ok: false, reason: "UNKNOWN_COMMAND" };
  const params = (c.params ?? {}) as DeviceCommand["params"];
  const name = c.name as DeviceCommand["name"];

  // الإيقاف الطارئ مقبول دائماً وبأعلى أولوية
  if (name === "emergency_stop") return { ok: true, cmd: { name, params: {} } };
  if (name === "reset") return { ok: true, cmd: { name, params: {} } };

  if (state && (state.estop || state.tripped)) return { ok: false, reason: state.estop ? "ESTOP_LATCHED" : "DEVICE_TRIPPED" };

  switch (name) {
    case "set_voltage": {
      const v = params.value;
      if (typeof v !== "number" || !Number.isFinite(v)) return { ok: false, reason: "INVALID_VALUE" };
      const max = Math.min(limits.voltage.max, lab.voltageMax ?? Infinity);
      if (v < limits.voltage.min || v > max) return { ok: false, reason: `VOLTAGE_OUT_OF_RANGE:${limits.voltage.min}..${max}` };
      return { ok: true, cmd: { name, params: { value: Math.round(v * 100) / 100 } } };
    }
    case "select_load": {
      const l = params.load;
      if (!l || !limits.loads.includes(l)) return { ok: false, reason: "LOAD_NOT_ALLOWED" };
      if (l !== lab.load) return { ok: false, reason: "LOAD_NOT_ALLOWED_FOR_THIS_LAB" };
      // قاعدة سلامة: لا يُغيَّر الحمل والمنبع يعمل
      if (state && (state.setpoint > 0.5 || state.switchOn)) return { ok: false, reason: "UNSAFE_LOAD_CHANGE" };
      return { ok: true, cmd: { name, params: { load: l } } };
    }
    case "switch": {
      if (params.state !== "on" && params.state !== "off") return { ok: false, reason: "INVALID_VALUE" };
      if (state && state.load === "NONE") return { ok: false, reason: "NO_LOAD_SELECTED" };
      return { ok: true, cmd: { name, params: { state: params.state } } };
    }
  }
  return { ok: false, reason: "UNKNOWN_COMMAND" };
}
