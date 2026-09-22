// إعدادات الخادم — تُقرأ من متغيرات البيئة (.env)
import "dotenv/config";
import path from "path";

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

export const config = {
  port: num(process.env.PORT, 4000),
  databaseUrl: process.env.DATABASE_URL ?? "postgresql://labs:labs@localhost:5432/labs",
  corsOrigin: (process.env.CORS_ORIGIN ?? "http://localhost:3000").split(",").map((s) => s.trim()),
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "12h",
  storageDir: path.resolve(process.env.STORAGE_DIR ?? "./storage"),
  mqtt: {
    url: process.env.MQTT_URL ?? "mqtt://localhost:1883",
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
  },
  /** منطقة التوقيت لعرض المواعيد في الإشعارات وساعات فتح الجهاز */
  timezone: process.env.APP_TIMEZONE ?? "Africa/Casablanca",
  noShowGraceSec: num(process.env.NO_SHOW_GRACE_SEC, 120),
  reminderMinutes: num(process.env.REMINDER_MINUTES, 10),
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: num(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.MAIL_FROM ?? "Virtual Labs <no-reply@labs.local>",
  },
};

if (process.env.NODE_ENV === "production" && config.jwtSecret === "dev-secret-change-me") {
  throw new Error("JWT_SECRET must be set in production");
}
