import { prisma } from "../db";

/** سجل تدقيق عام (دخول، إدارة مستخدمين، تعديل تجارب...) — لا يفشل أبداً الطلب الأصلي */
export async function audit(userId: string | null, action: string, entity?: string, entityId?: string, meta?: object, ip?: string) {
  try {
    await prisma.auditLog.create({ data: { userId, action, entity, entityId, meta: meta ?? undefined, ip } });
  } catch (e) {
    console.warn("[audit] failed", (e as Error).message);
  }
}
