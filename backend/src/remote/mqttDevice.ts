// ============================================================================
//  جهاز حقيقي عبر MQTT (Mosquitto) — وسيط Raspberry Pi / Arduino.
//  المواضيع:
//    labs/<topic>/cmd        (الخادم → الجهاز)  {id,name,params}
//    labs/<topic>/telemetry  (الجهاز → الخادم)  Telemetry JSON (انظر types.ts)
//    labs/<topic>/status     (الجهاز → الخادم)  "online" | "offline" (retained + LWT)
//  مثال وكيل Python للجهاز: hardware/bench_agent.py
// ============================================================================
import { EventEmitter } from "events";
import mqtt, { type MqttClient } from "mqtt";
import { config } from "../config";
import type { DeviceCommand, DeviceDriver, Telemetry } from "./types";

export class MqttDevice extends EventEmitter implements DeviceDriver {
  readonly kind = "MQTT" as const;
  private client: MqttClient;
  private last: Telemetry | null = null;
  private statusOnline = false;
  private seq = 0;

  constructor(private topic: string) {
    super();
    this.client = mqtt.connect(config.mqtt.url, { username: config.mqtt.username, password: config.mqtt.password, reconnectPeriod: 3000, clientId: `labs-server-${topic}-${Math.random().toString(16).slice(2, 8)}` });
    this.client.on("connect", () => {
      this.client.subscribe([`labs/${topic}/telemetry`, `labs/${topic}/status`], { qos: 1 });
      console.log(`[mqtt] connected, watching labs/${topic}/#`);
    });
    this.client.on("error", (e) => console.warn(`[mqtt:${topic}]`, e.message));
    this.client.on("message", (t, payload) => {
      if (t.endsWith("/status")) {
        this.statusOnline = payload.toString() === "online";
        return;
      }
      try {
        const m = JSON.parse(payload.toString()) as Telemetry;
        m.ts = Date.now();
        const wasTripped = this.last?.tripped;
        this.last = m;
        this.emit("telemetry", m);
        if (m.tripped && !wasTripped) this.emit("trip", "DEVICE_REPORTED_TRIP");
      } catch {
        /* رسالة تالفة — تُتجاهل */
      }
    });
  }

  /** الجهاز يعتبر متصلاً إذا كان status=online وآخر قياس أحدث من 3 ثوانٍ */
  isOnline() {
    return this.statusOnline && !!this.last && Date.now() - this.last.ts < 3000;
  }
  latest() {
    return this.last;
  }

  async send(cmd: DeviceCommand) {
    await new Promise<void>((res, rej) =>
      this.client.publish(`labs/${this.topic}/cmd`, JSON.stringify({ id: ++this.seq, ...cmd }), { qos: 1 }, (e) => (e ? rej(e) : res())),
    );
  }

  async safeState() {
    await this.send({ name: "emergency_stop", params: {} }).catch(() => undefined);
    await this.send({ name: "reset", params: {} }).catch(() => undefined);
  }

  async close() {
    await new Promise<void>((r) => this.client.end(false, {}, () => r()));
  }
}
