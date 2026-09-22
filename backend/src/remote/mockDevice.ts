// ============================================================================
//  جهاز وهمي (Mock): "لوحة كهربائية" تحاكي فيزيائياً:
//   • مقاومات R100/R220/R470 (قانون أوم + تسخين)
//   • دارة RC (R=4.7kΩ, C=470µF ⇒ τ≈2.2s) شحن/تفريغ
//   • ثنائي (Is=1nA, n·Vt=46.5mV) مع مقاومة توالٍ 220Ω
//  يعمل بدون أي عتاد، بنفس واجهة الجهاز الحقيقي (DeviceDriver).
// ============================================================================
import { EventEmitter } from "events";
import type { DeviceCommand, DeviceDriver, DeviceLimits, LoadType, Telemetry } from "./types";

const TICK_MS = 100;
const R_LOADS: Record<string, number> = { R100: 100, R220: 220, R470: 470 };
const RC = { R: 4700, C: 470e-6 };
const DIODE = { Rs: 220, Is: 1e-9, nVt: 0.0465 };

const gauss = () => {
  let u = 0,
    v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/** حل جهد الثنائي من Vs = Vd + Rs·I(Vd) بطريقة التنصيف (الدالة رتيبة) */
function solveDiode(vs: number): { vd: number; i: number } {
  if (vs <= 0) return { vd: 0, i: 0 };
  let lo = 0,
    hi = vs;
  const f = (vd: number) => vd + DIODE.Rs * DIODE.Is * (Math.exp(vd / DIODE.nVt) - 1) - vs;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    f(mid) > 0 ? (hi = mid) : (lo = mid);
  }
  const vd = (lo + hi) / 2;
  return { vd, i: DIODE.Is * (Math.exp(vd / DIODE.nVt) - 1) };
}

export class MockDevice extends EventEmitter implements DeviceDriver {
  readonly kind = "MOCK" as const;
  private setpoint = 0;
  private out = false;
  private load: LoadType = "NONE";
  private uc = 0;
  private tSwitch = 0;
  private temp = 25;
  private estop = false;
  private tripped = false;
  private last: Telemetry | null = null;
  private timer: NodeJS.Timeout;

  constructor(private limits: DeviceLimits) {
    super();
    this.timer = setInterval(() => this.step(TICK_MS / 1000), TICK_MS);
    this.timer.unref();
  }

  isOnline() {
    return true;
  }
  latest() {
    return this.last;
  }

  async send(cmd: DeviceCommand) {
    switch (cmd.name) {
      case "emergency_stop":
        this.estop = true;
        this.out = false;
        this.setpoint = 0;
        break;
      case "reset":
        this.estop = false;
        this.tripped = false;
        this.out = false;
        this.setpoint = 0;
        this.uc = 0;
        this.tSwitch = 0;
        break;
      case "set_voltage":
        this.setpoint = cmd.params.value ?? 0;
        break;
      case "select_load":
        this.load = cmd.params.load ?? "NONE";
        this.uc = 0;
        this.tSwitch = 0;
        break;
      case "switch": {
        const on = cmd.params.state === "on";
        if (on !== this.out) this.tSwitch = 0;
        this.out = on;
        break;
      }
    }
    this.step(0); // يعكس الأمر فوراً في القياسات
  }

  async safeState() {
    await this.send({ name: "reset", params: {} });
    this.load = "NONE";
    this.step(0);
  }

  async close() {
    clearInterval(this.timer);
  }

  private step(dt: number) {
    const vs = this.out && !this.estop && !this.tripped ? this.setpoint : 0;
    let iA = 0,
      vLoad = 0;
    this.tSwitch += dt;

    if (this.load in R_LOADS) {
      const R = R_LOADS[this.load];
      iA = vs / R;
      vLoad = vs;
    } else if (this.load === "RC") {
      const tau = RC.R * RC.C;
      const target = vs; // out=false ⇒ vs=0 ⇒ تفريغ
      this.uc = target + (this.uc - target) * Math.exp(-dt / tau);
      iA = (vs - this.uc) / RC.R;
      vLoad = this.uc;
    } else if (this.load === "DIODE") {
      const s = solveDiode(vs);
      iA = s.i;
      vLoad = s.vd;
    }

    const pW = Math.abs(vs * iA);
    const tEq = 25 + 30 * pW; // θ = 30 °C/W
    this.temp += (tEq - this.temp) * (dt ? 1 - Math.exp(-dt / 20) : 0);

    // فصل تلقائي عند تجاوز التيار أو الحرارة
    if (!this.tripped && (Math.abs(iA) * 1000 > this.limits.maxCurrentMa || this.temp > 85)) {
      this.tripped = true;
      this.out = false;
      this.setpoint = 0;
      this.emit("trip", Math.abs(iA) * 1000 > this.limits.maxCurrentMa ? "OVERCURRENT" : "OVERTEMP");
    }

    const n = (x: number, rel = 0.004, abs = 0.0005) => (x === 0 ? 0 : x + gauss() * (Math.abs(x) * rel + abs));
    const t: Telemetry = {
      ts: Date.now(),
      voltage: Math.max(0, n(vs)),
      current: n(iA * 1000, 0.004, 0.003),
      vLoad: Math.max(0, n(vLoad)),
      power: n(pW * 1000, 0.006, 0.002),
      temp: this.temp + gauss() * 0.05,
      tSwitch: this.tSwitch,
      switchOn: this.out,
      setpoint: this.setpoint,
      load: this.load,
      tripped: this.tripped,
      estop: this.estop,
    };
    this.last = t;
    if (dt) this.emit("telemetry", t);
  }
}
