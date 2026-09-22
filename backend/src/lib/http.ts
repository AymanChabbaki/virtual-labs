import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodTypeAny, z } from "zod";

/** خطأ HTTP بكود آلي (code) تترجمه الواجهة إلى الفرنسية/العربية */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
    public details?: unknown,
  ) {
    super(message ?? code);
  }
}

/** يلتقط أخطاء الدوال غير المتزامنة ويمررها إلى معالج الأخطاء */
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) =>
    fn(req, res, next).catch(next);

/** تحقق من مدخلات الطلب بواسطة zod (يرمي 400 عند الخطأ) */
export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, "VALIDATION", "Invalid input", r.error.flatten());
  return r.data;
}

export const clientIp = (req: Request) => (req.headers["x-forwarded-for"] as string)?.split(",")[0] ?? req.ip;
