// الإشعارات: داخل التطبيق (DB + Socket) + بريد إلكتروني اختياري (SMTP)
import nodemailer from "nodemailer";
import { prisma } from "../db";
import { config } from "../config";
import { emitToUser } from "./realtime";

type P = Record<string, string | number>;

/** قوالب البريد (فرنسي/عربي) */
const MAIL: Record<string, Record<"fr" | "ar", (p: P) => { subject: string; text: string }>> = {
  stage2_unlocked: {
    fr: (p) => ({ subject: `Quiz débloqué — ${p.lab}`, text: `Bravo ! Vous avez terminé le TP virtuel « ${p.lab} ». Le quiz est maintenant disponible.` }),
    ar: (p) => ({ subject: `تم فتح الكويز — ${p.lab}`, text: `أحسنت! أتممت التجربة الافتراضية «${p.lab}». الكويز متاح الآن.` }),
  },
  stage3_unlocked: {
    fr: (p) => ({ subject: `TP à distance débloqué — ${p.lab}`, text: `Vous avez réussi le quiz de « ${p.lab} ». Vous pouvez réserver une séance de TP à distance.` }),
    ar: (p) => ({ subject: `تم فتح التحكم عن بُعد — ${p.lab}`, text: `نجحت في كويز «${p.lab}». يمكنك الآن حجز حصة تحكم عن بُعد.` }),
  },
  booking_created: {
    fr: (p) => ({ subject: `Réservation confirmée — ${p.lab}`, text: `Votre séance est réservée le ${p.when}.` }),
    ar: (p) => ({ subject: `تم تأكيد الحجز — ${p.lab}`, text: `تم حجز حصتك بتاريخ ${p.when}.` }),
  },
  booking_reminder: {
    fr: (p) => ({ subject: `Rappel : séance dans ${p.minutes} min`, text: `Votre séance « ${p.lab} » commence à ${p.when}.` }),
    ar: (p) => ({ subject: `تذكير: حصتك بعد ${p.minutes} دقيقة`, text: `تبدأ حصة «${p.lab}» على الساعة ${p.when}.` }),
  },
};

let transporter: nodemailer.Transporter | null = null;
function mailer() {
  if (!config.smtp.host) return null;
  transporter ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  return transporter;
}

/** ينشئ إشعاراً داخلياً ويبثه لحظياً؛ ويرسل بريداً إن وُجد قالب وإعداد SMTP */
export async function notify(userId: string, kind: string, params: P = {}) {
  const n = await prisma.notification.create({ data: { userId, kind, params } });
  emitToUser(userId, "notification", n);
  const tpl = MAIL[kind];
  if (tpl) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user) {
      const m = tpl[user.locale](params);
      const t = mailer();
      if (t) t.sendMail({ from: config.smtp.from, to: user.email, ...m }).catch((e) => console.warn("[mail] failed:", e.message));
      else console.log(`[mail:dry-run] to=${user.email} subject="${m.subject}"`);
    }
  }
  return n;
}
