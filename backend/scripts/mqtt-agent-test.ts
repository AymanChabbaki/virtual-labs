// اختبار تكامل: وكيل Python الحقيقي (hardware/bench_agent.py مع عتاد محاكى) ↔ سائق MqttDevice في الخادم عبر وسيط مدمج.
// التشغيل: MQTT_URL=mqtt://localhost:18831 npx tsx scripts/mqtt-agent-test.ts   (يتطلب python3 + paho-mqtt)
import { spawn } from "child_process";
import { createServer } from "net";
import path from "path";
import Aedes from "aedes";
import { MqttDevice } from "../src/remote/mqttDevice";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c: unknown, n: string) => { console.log(c ? "  ✓" : "  ✗ FAIL:", n); if (!c) failed++; };

(async () => {
  const broker = await Aedes.createBroker();
  const srv = createServer(broker.handle);
  await new Promise<void>((r) => srv.listen(18831, r));
  const agent = spawn("python3", [path.join(__dirname, "../../hardware/bench_agent.py"), "--port", "18831", "--topic", "bench-py"], { stdio: ["ignore", "inherit", "inherit"] });
  const drv = new MqttDevice("bench-py");
  await sleep(1800);
  ok(drv.isOnline(), "Python agent online (status + telemetry)");
  await drv.send({ name: "select_load", params: { load: "R220" } });
  await drv.send({ name: "set_voltage", params: { value: 5 } });
  await drv.send({ name: "switch", params: { state: "on" } });
  await sleep(700);
  const t = drv.latest()!;
  ok(t.load === "R220" && t.switchOn && Math.abs(t.voltage - 5) < 0.1, `load/voltage applied (V=${t.voltage.toFixed(2)})`);
  ok(Math.abs(t.current - 22.73) < 0.6, `Ohm's law holds: I=${t.current.toFixed(2)} mA (expected 22.73)`);
  await drv.send({ name: "set_voltage", params: { value: 99 } });
  await sleep(400);
  ok(drv.latest()!.setpoint === 5, "agent rejects out-of-range voltage locally (defense in depth)");
  await drv.send({ name: "emergency_stop", params: {} });
  await sleep(400);
  ok(drv.latest()!.estop && !drv.latest()!.switchOn && drv.latest()!.setpoint === 0, "E-stop latches, output off, 0 V");
  await drv.send({ name: "set_voltage", params: { value: 3 } });
  await sleep(300);
  ok(drv.latest()!.setpoint === 0, "commands ignored while E-stop latched");
  await drv.send({ name: "reset", params: {} });
  await sleep(300);
  ok(!drv.latest()!.estop, "reset clears E-stop");
  agent.kill("SIGTERM");
  await sleep(3800);
  ok(!drv.isOnline(), "agent stop → device offline");
  await drv.close(); broker.close(); srv.close();
  console.log(failed ? "FAILED" : "MQTT AGENT OK");
  process.exit(failed ? 1 : 0);
})();
