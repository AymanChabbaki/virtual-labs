// بيانات تجريبية: 1 مدير، 1 أستاذ، 2 طالبان، فصل، جهاز وهمي، 3 TPs مع الكويزات.
// التشغيل: npm run db:seed   (آمن لإعادة التشغيل: لا يكرّر ما هو موجود)
import bcrypt from "bcryptjs";
import { prisma } from "../src/db";
import { LabDefinitionSchema } from "../src/labs/definition";
import { QuestionInput } from "../src/quiz/schemas";
import { DEFAULT_LIMITS } from "../src/remote/types";
import { computeAll } from "../src/labs/engine";
import { diode, diodeQuestions, ohm, ohmQuestions, rc, rcQuestions, type SeedQuestion } from "./seed-data";

async function user(email: string, name: string, role: "ADMIN" | "TEACHER" | "STUDENT", password: string, classroomId?: string) {
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name, role, locale: "fr", passwordHash: await bcrypt.hash(password, 10), classroomId },
  });
}

async function createLab(slug: string, titleFr: string, titleAr: string, descFr: string, descAr: string, def: unknown, qs: SeedQuestion[], ownerId: string, deviceId: string, classroomId: string) {
  const existing = await prisma.lab.findUnique({ where: { slug } });
  if (existing) {
    console.log(`  = ${slug} (exists)`);
    return existing;
  }
  const definition = LabDefinitionSchema.parse(def); // يتحقق من التعريف عند البذر
  const lab = await prisma.lab.create({
    data: {
      slug, titleFr, titleAr, descriptionFr: descFr, descriptionAr: descAr,
      definition: definition as object,
      passThreshold: 70, maxAttempts: 3, cooldownMinutes: 2, quizTimeLimitSec: 600,
      published: true, ownerId, deviceId,
      classrooms: { create: [{ classroomId }] },
    },
  });
  for (const [i, q] of qs.entries()) {
    const parsed = QuestionInput.parse({ ...q, order: i });
    await prisma.question.create({ data: { ...parsed, payload: parsed.payload as object, labId: lab.id, explanationAr: parsed.explanationAr ?? null, explanationFr: parsed.explanationFr ?? null } });
  }
  console.log(`  + ${slug} (${qs.length} questions)`);
  return lab;
}

async function main() {
  console.log("Seeding…");
  const classroom = await prisma.classroom.upsert({ where: { name: "Licence 2 — Physique" }, update: {}, create: { name: "Licence 2 — Physique" } });
  await user("admin@labs.test", "Admin Labs", "ADMIN", "Admin123!");
  const teacher = await user("prof@labs.test", "Pr. Karim Idrissi", "TEACHER", "Prof123!");
  const s1 = await user("student1@labs.test", "Yassine El Amrani", "STUDENT", "Student123!", classroom.id);
  const s2 = await user("student2@labs.test", "Salma Benali", "STUDENT", "Student123!", classroom.id);

  const device =
    (await prisma.device.findUnique({ where: { topic: "bench-mock" } })) ??
    (await prisma.device.create({
      data: { name: "Banc électrique virtuel (simulé)", driver: "MOCK", topic: "bench-mock", limits: DEFAULT_LIMITS as object, slotMinutes: 15 },
    }));

  const lab1 = await createLab("loi-d-ohm", "Loi d'Ohm", "قانون أوم", "Vérification expérimentale de la loi d'Ohm sur une résistance de 220 Ω : courbe U = f(I) et détermination de R.", "التحقق التجريبي من قانون أوم على مقاومة 220 Ω: رسم المنحنى وتحديد قيمة R.", ohm, ohmQuestions, teacher.id, device.id, classroom.id);
  await createLab("charge-condensateur-rc", "Charge d'un condensateur (circuit RC)", "شحن مكثف (دارة RC)", "Étude de la charge d'un condensateur à travers une résistance et détermination de la constante de temps τ.", "دراسة شحن مكثف عبر مقاومة وتحديد ثابت الزمن τ.", rc, rcQuestions, teacher.id, device.id, classroom.id);
  await createLab("caracteristique-diode", "Caractéristique d'une diode", "مميّزة الثنائي", "Relevé de la caractéristique I(U) d'une diode à jonction et détermination de sa tension de seuil.", "قياس المميّزة I(U) لثنائي ذي وصلة وتحديد توتر عتبته.", diode, diodeQuestions, teacher.id, device.id, classroom.id);

  // ---- student2: مسار جاهز للعرض (المرحلة 1 مكتملة + كويز ناجح ⇒ المرحلة 3 مفتوحة) على TP قانون أوم
  const def = LabDefinitionSchema.parse(ohm);
  const has = await prisma.progress.findUnique({ where: { userId_labId: { userId: s2.id, labId: lab1.id } } });
  if (!has || !has.stage1CompletedAt) {
    const now = new Date();
    const steps: Record<string, object> = {};
    def.steps.forEach((s) => (steps[s.id] = { done: true, at: now.toISOString() }));
    const points = [2, 4, 6, 8, 10, 12].map((U) => {
      const params = { U, R: 220 };
      const v = computeAll(def, params);
      return { params, values: { I: v.I, P: v.P }, at: now.toISOString() };
    });
    await prisma.progress.upsert({
      where: { userId_labId: { userId: s2.id, labId: lab1.id } },
      update: {},
      create: {
        userId: s2.id, labId: lab1.id, stage1Percent: 100, stage1Steps: steps, stage1Points: points,
        stage1CompletedAt: now, quizAttemptsUsed: 1, quizBestPercent: 85, quizLastSubmittedAt: now, quizPassedAt: now, remoteUnlockedAt: now,
      },
    });
    await prisma.quizAttempt.create({
      data: { userId: s2.id, labId: lab1.id, number: 1, status: "SUBMITTED", startedAt: now, deadlineAt: now, submittedAt: now, served: [], answers: {}, score: 8.5, maxScore: 10, percent: 85, passed: true },
    });
    console.log("  + student2 preset on loi-d-ohm (stage 3 unlocked)");
  }
  void s1;

  console.log(`
Comptes de démonstration (mot de passe entre parenthèses):
  admin     admin@labs.test     (Admin123!)
  enseignant prof@labs.test     (Prof123!)
  étudiant 1 student1@labs.test (Student123!)  → parcours vierge
  étudiant 2 student2@labs.test (Student123!)  → TP à distance déjà débloqué sur "Loi d'Ohm"
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
