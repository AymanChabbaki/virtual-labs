// اختبار سائق MQTT: وسيط Aedes مدمج + "جهاز حقيقي" مُحاكى يستقبل الأوامر ويرسل القياسات.
// التشغيل: MQTT_URL=mqtt://localhost:18830 npx tsx scripts/mqtt-test.ts
import { createServer } from "net";
import Aedes from "aedes";
import mqtt from "mqtt";
import { MqttDevice } from "../src/remote/mqttDevice";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c: unknown, n: string) => { console.log(c ? "  ✓" : "  ✗ FAIL:", n); if (!c) failed++; };

(async () => {
  const broker = await Aedes.createBroker();
  const srv = createServer(broker.handle);
  await new Promise<void>((r) => srv.listen(18830, r));

  // الجهاز الحقيقي (وكيل): يستقبل الأوامر ويبث القياسات
  const agent = mqtt.connect("mqtt://localhost:18830", { will: { topic: "labs/bench-x/status", payload: Buffer.from("offline"), retain: true, qos: 1 } });
  const received: any[] = [];
  let setpoint = 0;
  await new Promise<void>((r) => agent.on("connect", () => r()));
  agent.subscribe("labs/bench-x/cmd");
  agent.publish("labs/bench-x/status", "online", { retain: true, qos: 1 });
  agent.on("message", (_t, p) => { const m = JSON.parse(p.toString()); received.push(m); if (m.name === "set_voltage") setpoint = m.params.value; });
  const tick = setInterval(() => agent.publish("labs/bench-x/telemetry", JSON.stringify({ voltage: setpoint, current: setpoint / 0.22, vLoad: setpoint, power: 0, temp: 25, tSwitch: 0, switchOn: true, setpoint, load: "R220", tripped: false, estop: false })), 200);

  const drv = new MqttDevice("bench-x");
  let tele = 0;
  drv.on("telemetry", () => tele++);
  await sleep(1200);
  ok(drv.isOnline(), "driver sees device online (status + fresh telemetry)");
  await drv.send({ name: "set_voltage", params: { value: 7 } });
  await sleep(600);
  ok(received.some((m) => m.name === "set_voltage" && m.params.value === 7), "command delivered over MQTT");
  ok(drv.latest()?.voltage === 7 && tele > 3, "telemetry updated after command");
  agent.publish("labs/bench-x/status", "offline", { retain: true });
  clearInterval(tick);
  await sleep(3500);
  ok(!drv.isOnline(), "driver detects device offline");
  await drv.close(); agent.end(); broker.close(); srv.close();
  console.log(failed ? "FAILED" : "MQTT OK");
  process.exit(failed ? 1 : 0);
})();
