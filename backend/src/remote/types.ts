import type { EventEmitter } from "events";

export type LoadType = "NONE" | "R100" | "R220" | "R470" | "RC" | "DIODE";
export type CommandName = "set_voltage" | "select_load" | "switch" | "reset" | "emergency_stop";

export interface DeviceCommand {
  name: CommandName;
  params: { value?: number; load?: LoadType; state?: "on" | "off" };
}

/** قياسات الجهاز (الوحدات: V, mA, mW, °C, s) */
export interface Telemetry {
  ts: number;
  /** جهد المنبع الفعلي عند الخرج */
  voltage: number;
  /** التيار (mA) — سالب أثناء تفريغ المكثف */
  current: number;
  /** الجهد على الحمل: U للمقاومة، Uc للمكثف، Vd للثنائي */
  vLoad: number;
  power: number;
  temp: number;
  /** الزمن (ثانية) منذ آخر تبديل للمفتاح */
  tSwitch: number;
  switchOn: boolean;
  /** قيمة الجهد المطلوبة (setpoint) */
  setpoint: number;
  load: LoadType;
  tripped: boolean;
  estop: boolean;
}

/** حدود الأمان المخزَّنة في Device.limits */
export interface DeviceLimits {
  voltage: { min: number; max: number };
  maxCurrentMa: number;
  loads: LoadType[];
  maxCommandsPerSec: number;
}

export const DEFAULT_LIMITS: DeviceLimits = {
  voltage: { min: 0, max: 12 },
  maxCurrentMa: 150,
  loads: ["R100", "R220", "R470", "RC", "DIODE"],
  maxCommandsPerSec: 8,
};

/** واجهة موحّدة للأجهزة: المحاكي (Mock) أو الحقيقي عبر MQTT */
export interface DeviceDriver extends EventEmitter {
  readonly kind: "MOCK" | "MQTT";
  /** هل الجهاز متصل ويرسل قياسات حديثة؟ */
  isOnline(): boolean;
  latest(): Telemetry | null;
  /** يرسل أمراً (سبق التحقق منه بواسطة safety.ts) */
  send(cmd: DeviceCommand): Promise<void>;
  /** يضع الجهاز في حالة آمنة (0 فولت، الخرج مفصول) */
  safeState(): Promise<void>;
  close(): Promise<void>;
  // أحداث: 'telemetry' (t: Telemetry), 'trip' (reason: string)
}
