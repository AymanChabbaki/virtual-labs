// قفل استشاري (advisory lock) على مستوى معاملة PostgreSQL لمنع سباقات الحالة
// (مثل حجزين متداخلين على نفس الجهاز، أو بدء محاولتي كويز في نفس اللحظة).
import type { Prisma } from "../generated/prisma/client";
import { prisma } from "../db";

export async function withLock<T>(key: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      return fn(tx);
    },
    { timeout: 15_000 },
  );
}
