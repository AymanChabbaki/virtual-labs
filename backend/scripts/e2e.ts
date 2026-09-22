// اختبار شامل للمسار الإجباري + القفل + الكويز + التحكم عن بُعد (يعمل على خادم قيد التشغيل).
// الاستعمال:  npm run db:reset && (npm run dev &)  ثم  npm run test:e2e
import { io as ioc, type Socket } from "socket.io-client";
import { prisma } from "../src/db";

const API = process.env.API ?? "http://localhost:4000";
let pass = 0, failN = 0;
const ok = (c: unknown, name: string, extra?: unknown) => {
  if (c) { pass++; console.log("  ✓", name); }
  else { failN++; console.log("  ✗ FAIL:", name, extra !== undefined ? JSON.stringify(extra) : ""); }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(method: string, path: string, token?: string, body?: unknown) {
  const r = await fetch(API + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get("content-type") ?? "";
  const data = ct.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer());
  return { status: r.status, data: data as any, headers: r.headers };
}
const login = async (email: string, pw: string) => (await call("POST", "/api/auth/login", undefined, { email, password: pw })).data.token as string;
const code = (r: { data: any }) => r.data?.error?.code;

function connect(token: string): Promise<Socket> {
  return new Promise((res, rej) => {
    const s = ioc(API, { auth: { token }, transports: ["websocket"] });
    s.on("connect", () => res(s));
    s.on("connect_error", rej);
  });
}
const emit = (s: Socket, ev: string, msg: unknown) => new Promise<any>((res) => s.emit(ev, msg, res));

async function main() {
  console.log("\n== Auth & RBAC ==");
  let r = await call("GET", "/api/labs");
  ok(r.status === 401, "no token → 401");
  r = await call("POST", "/api/auth/login", undefined, { email: "student1@labs.test", password: "bad" });
  ok(r.status === 401 && code(r) === "BAD_CREDENTIALS", "bad password → 401");
  const t1 = await login("student1@labs.test", "Student123!");
  const t2 = await login("student2@labs.test", "Student123!");
  const tp = await login("prof@labs.test", "Prof123!");
  const ta = await login("admin@labs.test", "Admin123!");
  ok(t1 && t2 && tp && ta, "4 roles can log in");
  ok((await call("GET", "/api/teacher/overview", t1)).status === 403, "student blocked from teacher API");
  ok((await call("GET", "/api/admin/users", tp)).status === 403, "teacher blocked from admin API");
  ok((await call("GET", "/api/admin/users", ta)).status === 200, "admin can list users");

  console.log("\n== Labs visibility ==");
  const labs = (await call("GET", "/api/labs", t1)).data.labs;
  ok(labs.length === 3, "student sees 3 published labs", labs.length);
  const ohm = labs.find((l: any) => l.slug === "loi-d-ohm");
  ok(ohm.status.stage1.state === "in_progress" && ohm.status.stage2.state === "locked" && ohm.status.stage3.state === "locked", "fresh student: stage1 open, 2 & 3 locked");
  const L = ohm.id;

  console.log("\n== 🔒 Locking (server-side) before stage 1 ==");
  r = await call("POST", `/api/labs/${L}/quiz/attempts`, t1);
  ok(r.status === 403 && code(r) === "STAGE_LOCKED", "quiz start → 403 STAGE_LOCKED", r.data);
  r = await call("POST", "/api/remote/bookings", t1, { labId: L, startsAt: new Date(Date.now() + 3600e3).toISOString() });
  ok(r.status === 403 && code(r) === "STAGE_LOCKED", "booking → 403 STAGE_LOCKED");
  r = await call("POST", "/api/remote/queue", t1, { labId: L });
  ok(r.status === 403 && code(r) === "STAGE_LOCKED", "queue join → 403 STAGE_LOCKED");
  ok((await call("POST", `/api/remote/labs/${L}/complete`, t1)).status === 403, "remote complete → 403");
  const s1 = await connect(t1);
  ok((await emit(s1, "session:join", { bookingId: "nope" })).ok === false, "socket join with fake booking rejected");

  console.log("\n== Stage 1: virtual TP (sequential steps) ==");
  const sim = (await call("GET", `/api/labs/${L}/simulation`, t1)).data;
  ok(sim.definition.steps.length === 5 && sim.progress.percent === 0, "definition served, 0%");
  r = await call("POST", `/api/labs/${L}/simulation/steps/measure`, t1, {});
  ok(r.status === 409 && code(r) === "STEP_ORDER", "cannot skip to 'measure'");
  r = await call("POST", `/api/labs/${L}/simulation/points`, t1, { params: { U: 4, R: 220 }, values: { I: 18.18, P: 72.7 } });
  ok(r.status === 409, "cannot record points outside a measure step");
  ok((await call("POST", `/api/labs/${L}/simulation/steps/intro`, t1, {})).status === 200, "step intro ok");
  r = await call("POST", `/api/labs/${L}/simulation/steps/setup`, t1, { params: { U: 0, R: 100 } });
  ok(r.status === 422 && code(r) === "SETUP_MISMATCH", "setup with wrong R rejected");
  r = await call("POST", `/api/labs/${L}/simulation/steps/setup`, t1, { params: { U: 0, R: 220 } });
  ok(r.status === 200 && r.data.progress.percent === 40, "setup ok → 40%", r.data?.progress?.percent);
  r = await call("PUT", `/api/labs/${L}/simulation/draft`, t1, { draft: { notes: "hello", U: 5 } });
  ok(r.status === 200, "autosave draft");
  ok((await call("GET", `/api/labs/${L}/simulation`, t1)).data.progress.draft?.notes === "hello", "draft restored");
  r = await call("POST", `/api/labs/${L}/simulation/points`, t1, { params: { U: 4, R: 220 }, values: { I: 99, P: 72.7 } });
  ok(r.status === 422 && code(r) === "READING_INCONSISTENT", "fabricated reading rejected");
  r = await call("POST", `/api/labs/${L}/simulation/points`, t1, { params: { U: 4.3, R: 220 }, values: { I: 19, P: 80 } });
  ok(r.status === 422 && code(r) === "PARAM_OUT_OF_RANGE", "U off-grid rejected");
  r = await call("POST", `/api/labs/${L}/simulation/steps/measure`, t1, {});
  ok(r.status === 422 && code(r) === "NOT_ENOUGH_POINTS", "measure step needs ≥6 points");
  const pts: { U: number; I: number }[] = [];
  for (const U of [2, 4, 6, 8, 10, 12]) {
    const I = ((1000 * U) / 220) * (1 + (Math.random() - 0.5) * 0.01);
    const P = ((1000 * U * U) / 220) * (1 + (Math.random() - 0.5) * 0.01);
    r = await call("POST", `/api/labs/${L}/simulation/points`, t1, { params: { U, R: 220 }, values: { I, P } });
    if (r.status === 201) pts.push({ U, I });
  }
  ok(pts.length === 6, "6 valid points recorded", pts.length);
  r = await call("POST", `/api/labs/${L}/simulation/points`, t1, { params: { U: 12, R: 220 }, values: { I: 54.5, P: 654 } });
  ok(r.status === 409 && code(r) === "DUPLICATE_POINT", "duplicate x rejected");
  r = await call("POST", `/api/labs/${L}/simulation/steps/measure`, t1, {});
  ok(r.status === 200, "measure step accepted");
  r = await call("POST", `/api/labs/${L}/simulation/steps/compute-r`, t1, { answer: 100 });
  ok(r.status === 422 && code(r) === "WRONG_ANSWER", "wrong R rejected");
  const mx = pts.reduce((a, p) => a + p.U, 0) / pts.length, my = pts.reduce((a, p) => a + p.I, 0) / pts.length;
  const slope = pts.reduce((a, p) => a + (p.U - mx) * (p.I - my), 0) / pts.reduce((a, p) => a + (p.U - mx) ** 2, 0);
  r = await call("POST", `/api/labs/${L}/simulation/steps/compute-r`, t1, { answer: (1000 / slope).toFixed(1) });
  ok(r.status === 200 && r.data.progress.percent === 80, "correct R accepted → 80%", r.data);
  r = await call("POST", `/api/labs/${L}/quiz/attempts`, t1);
  ok(r.status === 403 && code(r) === "STAGE_LOCKED", "quiz STILL locked at 80%");
  r = await call("POST", `/api/labs/${L}/simulation/report`, t1);
  ok(r.status === 201 && r.data.progress.percent === 100, "report generated → 100%", r.data);
  const rep = await call("GET", `/api/reports/${r.data.reportId}/download`, t1);
  ok(rep.status === 200 && Buffer.from(rep.data).subarray(0, 4).toString() === "%PDF", "PDF downloadable", rep.status);
  require("fs").writeFileSync("/tmp/virtual-report.pdf", rep.data);
  ok((await call("GET", "/api/notifications", t1)).data.notifications.some((n: any) => n.kind === "stage2_unlocked"), "stage2_unlocked notification");

  console.log("\n== Stage 2: quiz ==");
  ok((await call("GET", `/api/labs/${L}/quiz`, t1)).data.stage2.state === "available", "stage 2 now available");
  // بنك الأسئلة (الأستاذ) لبناء الإجابات الصحيحة
  const qs = (await call("GET", `/api/labs/${L}/questions`, tp)).data.questions as any[];
  ok(qs.length === 6, "teacher sees 6 questions");
  ok((await call("GET", `/api/labs/${L}/questions`, t1)).status === 403, "student cannot read question bank");
  const correct = (q: any) => q.type === "MCQ" ? q.payload.correct : q.type === "TRUE_FALSE" ? q.payload.correct : q.type === "NUMERIC" ? q.payload.answer : q.payload.accepted.map((a: string[]) => a[0]);
  const allCorrect = Object.fromEntries(qs.map((q) => [q.id, correct(q)]));

  await call("PATCH", `/api/labs/${L}`, tp, { cooldownMinutes: 5 });
  let a1 = await call("POST", `/api/labs/${L}/quiz/attempts`, t1);
  ok(a1.status === 201 && a1.data.questions.length === 6, "attempt 1 started with 6 questions", a1.data);
  ok(!JSON.stringify(a1.data).includes('"correct"'), "served questions contain no correct answers");
  const again = await call("POST", `/api/labs/${L}/quiz/attempts`, t1);
  ok(again.data.id === a1.data.id && again.data.resumed, "refresh resumes same attempt (no new attempt)");
  ok((await call("GET", `/api/labs/${L}/quiz/review`, t1)).status === 403, "review locked before last attempt");
  r = await call("POST", `/api/quiz/attempts/${a1.data.id}/submit`, t1, { answers: {} });
  ok(r.status === 200 && r.data.passed === false && r.data.percent === 0 && !r.data.review, "attempt 1 fails, no correction revealed", r.data);
  r = await call("POST", `/api/labs/${L}/quiz/attempts`, t1);
  ok(r.status === 429 && code(r) === "COOLDOWN", "cooldown blocks immediate retry", r.data);

  await call("PATCH", `/api/labs/${L}`, tp, { cooldownMinutes: 0 });
  // محاولة 2: نصف الإجابات صحيحة → 40-60% (< 70)
  const a2 = await call("POST", `/api/labs/${L}/quiz/attempts`, t1);
  const half: Record<string, unknown> = {};
  qs.slice(0, 3).forEach((q) => (half[q.id] = allCorrect[q.id]));
  r = await call("POST", `/api/quiz/attempts/${a2.data.id}/submit`, t1, { answers: half });
  ok(r.status === 200 && !r.data.passed && r.data.percent > 0 && r.data.percent < 70 && !r.data.review, `attempt 2 partial fail (${r.data.percent}%)`, r.data);
  // محاولة 3 (الأخيرة): فاشلة → يظهر التصحيح
  const a3 = await call("POST", `/api/labs/${L}/quiz/attempts`, t1);
  r = await call("POST", `/api/quiz/attempts/${a3.data.id}/submit`, t1, { answers: {} });
  ok(r.status === 200 && !r.data.passed && Array.isArray(r.data.review) && r.data.review.length === 6, "last attempt → correction revealed", r.data.stage2);
  ok(r.data.stage2.state === "failed_final", "stage2 = failed_final");
  r = await call("POST", `/api/labs/${L}/quiz/attempts`, t1);
  ok(r.status === 403 && code(r) === "NO_ATTEMPTS_LEFT", "no attempts left");
  ok((await call("POST", "/api/remote/queue", t1, { labId: L })).status === 403, "stage 3 still locked after failing quiz");
  // الأستاذ يمنح محاولة إضافية
  const stu = (await call("GET", `/api/teacher/labs/${L}/results`, tp)).data.rows.find((x: any) => x.email === "student1@labs.test");
  ok(stu.stage === "stage2" && stu.quizAttemptsUsed === 3, "teacher dashboard shows student at stage2", stu);
  r = await call("POST", `/api/teacher/labs/${L}/students/${stu.studentId}/extra-attempts`, tp, { count: 1 });
  ok(r.status === 200 && r.data.stage2.attemptsLeft === 1, "teacher grants 1 extra attempt");
  // اختبار العتبة القابلة للضبط: نرفعها إلى 100% ثم نخفضها
  await call("PATCH", `/api/labs/${L}`, tp, { passThreshold: 100 });
  const a4 = await call("POST", `/api/labs/${L}/quiz/attempts`, t1);
  ok(a4.status === 201, "attempt 4 (extra) started");
  const wrongOne = { ...allCorrect, [qs[3].id]: qs[3].type === "FILL_BLANK" ? ["xxx"] : "zzz" };
  // نُنقص فراغاً واحداً ⇒ < 100% ⇒ فشل مع العتبة 100
  r = await call("POST", `/api/quiz/attempts/${a4.data.id}/submit`, t1, { answers: wrongOne });
  ok(r.data.passed === false && r.data.percent < 100 && r.data.percent >= 70, `threshold 100 → ${r.data.percent}% fails (would pass at 70)`, r.data);
  await call("PATCH", `/api/labs/${L}`, tp, { passThreshold: 70 });
  await call("POST", `/api/teacher/labs/${L}/students/${stu.studentId}/extra-attempts`, tp, { count: 1 });
  const a5 = await call("POST", `/api/labs/${L}/quiz/attempts`, t1);
  r = await call("POST", `/api/quiz/attempts/${a5.data.id}/submit`, t1, { answers: allCorrect });
  ok(r.data.passed === true && r.data.percent === 100 && r.data.stage3.state === "available", "attempt 5 passes → stage 3 unlocked", r.data);
  ok((await call("POST", `/api/labs/${L}/quiz/attempts`, t1)).status === 409, "cannot retake after passing");

  console.log("\n== Timer: expired attempt is auto-graded ==");
  // نستعمل student2 على TP RC مع نجاح المرحلة 1 مصطنعاً عبر DB لفحص انتهاء الوقت
  const rcLab = (await call("GET", "/api/labs", t2)).data.labs.find((l: any) => l.slug === "charge-condensateur-rc");
  const u2 = await prisma.user.findUniqueOrThrow({ where: { email: "student2@labs.test" } });
  await prisma.progress.upsert({ where: { userId_labId: { userId: u2.id, labId: rcLab.id } }, update: { stage1CompletedAt: new Date(), stage1Percent: 100 }, create: { userId: u2.id, labId: rcLab.id, stage1CompletedAt: new Date(), stage1Percent: 100 } });
  const ex = await call("POST", `/api/labs/${rcLab.id}/quiz/attempts`, t2);
  ok(ex.status === 201, "student2 starts RC quiz");
  await prisma.quizAttempt.update({ where: { id: ex.data.id }, data: { deadlineAt: new Date(Date.now() - 60_000) } });
  await sleep(2500); // المجدوِل يغلقها
  const st = await call("GET", `/api/labs/${rcLab.id}/quiz`, t2);
  ok(st.data.runningAttemptId === null && st.data.attempts[0].status === "EXPIRED", "expired attempt finalized by scheduler", st.data.attempts);
  r = await call("POST", `/api/quiz/attempts/${ex.data.id}/submit`, t2, { answers: {} });
  ok(r.status === 409, "cannot submit an expired attempt");

  console.log("\n== Stage 3: booking, queue, live control ==");
  r = await call("POST", "/api/remote/queue", t1, { labId: L });
  ok(r.status === 201 && r.data.booking, "student1 joins queue", r.data);
  const b1 = r.data.booking;
  r = await call("POST", "/api/remote/bookings", t1, { labId: L, startsAt: new Date(Math.ceil((Date.now() + 3 * 3600e3) / 900e3) * 900e3).toISOString() });
  ok(r.status === 201, "student1 second booking ok");
  const b1b = r.data.booking;
  r = await call("POST", "/api/remote/queue", t1, { labId: L });
  ok(r.status === 409 && code(r) === "BOOKING_LIMIT", "booking limit (2) enforced");
  ok((await call("DELETE", `/api/remote/bookings/${b1b.id}`, t1)).status === 200, "future booking cancellable");
  r = await call("POST", "/api/remote/bookings", t1, { labId: L, startsAt: new Date(b1.startsAt).toISOString() });
  ok(r.status === 409 && code(r) === "SLOT_TAKEN", "same slot cannot be double-booked");
  // student2 يدخل الطابور ⇒ فترة لاحقة
  r = await call("POST", "/api/remote/queue", t2, { labId: L });
  ok(r.status === 201 && new Date(r.data.booking.startsAt) > new Date(b1.startsAt) && r.data.position === 2, "student2 queued behind (position 2)", r.data);
  const b2 = r.data.booking;
  const q = await call("GET", `/api/remote/devices/${b1.deviceId}/queue`, t2);
  ok(q.data.queue.length >= 2 && q.data.queue[0].student === null && q.data.queue[1].student !== null, "queue hides other students' names");

  // نفعّل حجز student1 الآن (نضبط النافذة الزمنية على الحاضر)
  await prisma.booking.update({ where: { id: b1.id }, data: { startsAt: new Date(Date.now() - 5000), endsAt: new Date(Date.now() + 10 * 60_000) } });
  for (let i = 0; i < 10; i++) { await sleep(700); if ((await prisma.booking.findUnique({ where: { id: b1.id } }))!.status === "ACTIVE") break; }
  ok((await prisma.booking.findUnique({ where: { id: b1.id } }))!.status === "ACTIVE", "scheduler activated booking 1");
  ok((await prisma.booking.findUnique({ where: { id: b2.id } }))!.status === "BOOKED", "booking 2 still waiting (single device)");

  const sock2 = await connect(t2);
  ok((await emit(sock2, "session:join", { bookingId: b1.id })).ok === false, "student2 cannot join student1's session");
  ok((await emit(sock2, "session:join", { bookingId: b2.id })).ok === false, "student2 cannot join a not-yet-active booking");

  const j = await emit(s1, "session:join", { bookingId: b1.id });
  ok(j.ok && j.remote.load === "R220" && j.limits.voltage.max === 12, "student1 joins session", j);
  let tele = 0, ended: any = null, lastT: any = null;
  s1.on("telemetry", (t) => { tele++; lastT = t; });
  s1.on("session:ended", (e) => (ended = e));
  const cmd = (name: string, params: object = {}) => emit(s1, "device:command", { bookingId: b1.id, name, params });

  ok((await cmd("set_voltage", { value: 13 })).error?.startsWith("VOLTAGE_OUT_OF_RANGE"), "13 V rejected (out of range)");
  ok((await cmd("set_voltage", { value: -1 })).ok === false, "negative voltage rejected");
  ok((await cmd("select_load", { load: "R100" })).error === "LOAD_NOT_ALLOWED_FOR_THIS_LAB", "wrong load for this lab rejected");
  ok((await cmd("hack_the_planet")).error === "UNKNOWN_COMMAND", "unknown command rejected");
  ok((await cmd("set_voltage", { value: "abc" })).ok === false, "non-numeric value rejected");
  ok((await cmd("select_load", { load: "R220" })).ok, "select R220 ok");
  ok((await emit(s1, "device:record", { bookingId: b1.id })).error === "OUTPUT_OFF", "cannot record while output off");
  ok((await cmd("switch", { state: "on" })).ok, "output ON");
  ok((await cmd("select_load", { load: "R220" })).error === "UNSAFE_LOAD_CHANGE", "cannot change load while output is on");
  let recorded = 0;
  await sleep(1100); // نافذة تحديد المعدل (8 أوامر/ثانية) — انتظار بعد أوامر الإعداد
  for (const v of [2, 4, 6, 8, 10, 12]) {
    const sv = await cmd("set_voltage", { value: v });
    if (!sv.ok) console.log("   set_voltage failed:", sv);
    await sleep(450);
    const rr = await emit(s1, "device:record", { bookingId: b1.id });
    if (rr.ok) {
      recorded++;
      const expI = (v / 220) * 1000;
      if (recorded === 3) ok(Math.abs(rr.sample.values.current - expI) < expI * 0.05 + 0.1, `real reading ≈ physics (I=${rr.sample.values.current.toFixed(2)} mA vs ${expI.toFixed(2)})`);
    }
  }
  ok(recorded === 6, "6 samples recorded from device", recorded);
  ok(tele > 10, `live telemetry streamed (${tele} msgs)`);
  // تحديد المعدل
  const burst = await Promise.all(Array.from({ length: 25 }, (_, i) => cmd("set_voltage", { value: 5 + (i % 2) })));
  ok(burst.some((x) => x.error === "RATE_LIMITED"), "command burst rate-limited");
  await sleep(1100);
  // الإيقاف الطارئ
  ok((await cmd("emergency_stop")).ok, "EMERGENCY STOP accepted");
  await sleep(250);
  ok(lastT.estop === true && lastT.voltage === 0 && lastT.switchOn === false, "device is stopped (0 V, output off)", lastT);
  ok((await cmd("set_voltage", { value: 5 })).error === "ESTOP_LATCHED", "commands rejected while E-stop latched");
  ok((await cmd("reset")).ok, "reset clears E-stop");
  await sleep(1100);
  ok((await cmd("select_load", { load: "R220" })).ok, "device usable again after reset");

  // إكمال المرحلة 3 (تقرير)
  r = await call("POST", `/api/remote/labs/${L}/complete`, t1);
  ok(r.status === 201 && r.data.points === 6 && r.data.results.length === 1, "remote TP completed + report", r.data);
  ok(Math.abs(parseFloat(r.data.results[0].value) - 220) < 15, `estimated R from real data ≈ 220 (${r.data.results[0].value})`);
  const rr = await call("GET", `/api/reports/${r.data.reportId}/download`, t1);
  require("fs").writeFileSync("/tmp/remote-report.pdf", rr.data);
  ok(rr.status === 200 && Buffer.from(rr.data).subarray(0, 4).toString() === "%PDF", "remote PDF downloadable");

  // المؤقّت: ننهي الجلسة تلقائياً ⇒ الجهاز يتحرر ويبدأ الطالب الموالي
  await prisma.booking.update({ where: { id: b1.id }, data: { endsAt: new Date(Date.now() + 1500) } });
  await prisma.booking.update({ where: { id: b2.id }, data: { startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 10 * 60_000) } });
  for (let i = 0; i < 12 && !ended; i++) await sleep(500);
  ok(ended?.reason === "timeout", "session ended automatically by timer", ended);
  await sleep(1500);
  ok((await prisma.booking.findUnique({ where: { id: b1.id } }))!.status === "COMPLETED", "booking 1 COMPLETED");
  ok((await prisma.booking.findUnique({ where: { id: b2.id } }))!.status === "ACTIVE", "device handed over: booking 2 ACTIVE");
  ok((await emit(s1, "device:command", { bookingId: b1.id, name: "set_voltage", params: { value: 3 } })).error === "SESSION_NOT_ACTIVE", "student1 can no longer command the device");
  const j2 = await emit(sock2, "session:join", { bookingId: b2.id });
  ok(j2.ok && j2.telemetry.voltage === 0 && j2.telemetry.switchOn === false, "student2 gets a clean/safe device", j2.telemetry);
  await call("POST", `/api/remote/bookings/${b2.id}/end`, t2);

  console.log("\n== No-show ==");
  const b3 = (await call("POST", "/api/remote/queue", t2, { labId: L })).data.booking;
  await prisma.booking.update({ where: { id: b3.id }, data: { startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 10 * 60_000) } });
  await sleep(2200);
  ok((await prisma.booking.findUnique({ where: { id: b3.id } }))!.status === "ACTIVE", "booking 3 active");
  await prisma.booking.update({ where: { id: b3.id }, data: { activatedAt: new Date(Date.now() - 10 * 60_000) } });
  await sleep(2200);
  ok((await prisma.booking.findUnique({ where: { id: b3.id } }))!.status === "NO_SHOW", "student who never joined → NO_SHOW, device released");

  console.log("\n== Teacher & admin ==");
  const res = (await call("GET", `/api/teacher/labs/${L}/results`, tp)).data.rows;
  const row1 = res.find((x: any) => x.email === "student1@labs.test");
  ok(row1.stage === "done" && row1.remoteCompleted && row1.remotePoints === 6, "teacher sees student1 DONE with 6 remote points", row1);
  const csv = await call("GET", `/api/teacher/labs/${L}/export.csv`, tp);
  ok(csv.status === 200 && csv.data.toString().includes("student1@labs.test"), "CSV export");
  const xl = await call("GET", `/api/teacher/labs/${L}/export.xlsx`, tp);
  ok(xl.status === 200 && Buffer.from(xl.data).subarray(0, 2).toString() === "PK", "XLSX export");
  const logs = (await call("GET", "/api/admin/logs/commands?limit=200", ta)).data.logs as any[];
  ok(logs.some((l) => !l.accepted && l.reason === "RATE_LIMITED") && logs.some((l) => l.name === "emergency_stop" && l.accepted) && logs.some((l) => !l.accepted && l.reason?.startsWith("VOLTAGE_OUT_OF_RANGE")), "audit log has accepted + rejected commands");
  ok((await call("GET", "/api/admin/logs/audit", ta)).data.logs.length > 5, "general audit log");
  const dash = await call("GET", "/api/student/dashboard", t1);
  ok(dash.status === 200 && dash.data.labs.length === 3 && dash.data.quizResults.length >= 3, "student dashboard");
  // تعريف TP جديد بدون كود
  const bad = await call("POST", "/api/labs/validate-definition", tp, { definition: { simulator: "ohm" } });
  ok(bad.data.valid === false, "invalid definition reported");

  s1.close(); sock2.close();
  console.log(`\n${failN === 0 ? "ALL PASSED" : "FAILURES"}: ${pass} passed, ${failN} failed`);
  await prisma.$disconnect();
  process.exit(failN ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
