// أنواع البيانات القادمة من الـ API (مختصرة على ما تستعمله الواجهة)
export type Role = "STUDENT" | "TEACHER" | "ADMIN";
export type Lang = "fr" | "ar";
export interface Bi {
  ar: string;
  fr: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  locale: Lang;
  classroomId: string | null;
}

export interface Stage2 {
  state: "locked" | "available" | "passed" | "failed_final";
  attemptsUsed: number;
  attemptsAllowed: number;
  attemptsLeft: number;
  bestPercent: number | null;
  threshold: number;
  cooldownUntil: string | null;
  reviewAvailable: boolean;
}
export interface Status {
  stage1: { state: "in_progress" | "completed"; percent: number };
  stage2: Stage2;
  stage3: { state: "locked" | "available" | "completed" };
}

export interface LabSummary {
  id: string;
  slug: string;
  titleAr: string;
  titleFr: string;
  descriptionAr: string;
  descriptionFr: string;
  simulator: string;
  passThreshold: number;
  maxAttempts: number;
  cooldownMinutes: number;
  quizTimeLimitSec: number;
  quizQuestionCount: number | null;
  questionCount: number;
  published: boolean;
  deviceId: string | null;
  status?: Status;
  students?: number;
}

export interface Parameter {
  key: string;
  label: Bi;
  unit: string;
  min: number;
  max: number;
  step: number;
  default: number;
  options?: number[];
}
export type Step =
  | { id: string; type: "read"; title: Bi; body: Bi }
  | { id: string; type: "setup"; title: Bi; body: Bi; require: Record<string, number> }
  | { id: string; type: "measure"; title: Bi; body: Bi; minPoints: number; lock: string[]; xParam: string }
  | {
      id: string;
      type: "compute";
      title: Bi;
      body: Bi;
      quantity: Bi;
      unit: string;
      tolerancePct: number;
      estimator: { kind: "slope" | "rc_tau" | "threshold"; x: string; y: string; invert?: boolean; factor?: number; e?: string; level?: number };
    }
  | { id: string; type: "report"; title: Bi; body: Bi };

export interface RemoteConfig {
  load: "R100" | "R220" | "R470" | "RC" | "DIODE";
  minPoints: number;
  plot: { x: string; y: string; xLabel: Bi; yLabel: Bi };
  voltageMax?: number;
  instructions: Bi;
}

export interface LabDefinition {
  version: 1;
  simulator: "ohm" | "rc" | "diode" | "generic";
  parameters: Parameter[];
  constants: Record<string, number>;
  equations: { name: string; expr: string }[];
  outputs: { key: string; label: Bi; unit: string; decimals: number }[];
  noise: number;
  plot: { x: string; y: string; xLabel: Bi; yLabel: Bi };
  steps: Step[];
  remote?: RemoteConfig;
}

export interface Point {
  params: Record<string, number>;
  values: Record<string, number>;
  at: string;
}

export interface Telemetry {
  ts: number;
  voltage: number;
  current: number;
  vLoad: number;
  power: number;
  temp: number;
  tSwitch: number;
  switchOn: boolean;
  setpoint: number;
  load: "NONE" | "R100" | "R220" | "R470" | "RC" | "DIODE";
  tripped: boolean;
  estop: boolean;
}

export interface Notification {
  id: string;
  kind: string;
  params: Record<string, any>;
  readAt: string | null;
  createdAt: string;
}
