// المصادقة (JWT) + RBAC (الأدوار)
import type { NextFunction, Request, Response } from "express";
import type { User } from "../generated/prisma/client";
import { prisma } from "../db";
import { HttpError } from "../lib/http";
import { verifyToken } from "../lib/jwt";

declare module "express-serve-static-core" {
  interface Request {
    user?: User;
  }
}

/** يقرأ الرمز من Authorization: Bearer ... ويحمّل المستخدم الحالي من قاعدة البيانات */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const h = req.headers.authorization;
    if (!h?.startsWith("Bearer ")) throw new HttpError(401, "UNAUTHENTICATED");
    let payload;
    try {
      payload = verifyToken(h.slice(7));
    } catch {
      throw new HttpError(401, "INVALID_TOKEN");
    }
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active) throw new HttpError(401, "UNAUTHENTICATED");
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}

/** يسمح فقط بالأدوار المذكورة (ADMIN مسموح له دائماً بمسارات الأستاذ) */
export const requireRole =
  (...roles: Array<"STUDENT" | "TEACHER" | "ADMIN">) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const u = req.user;
    if (!u) return next(new HttpError(401, "UNAUTHENTICATED"));
    const ok = roles.includes(u.role) || (u.role === "ADMIN" && roles.includes("TEACHER"));
    if (!ok) return next(new HttpError(403, "FORBIDDEN"));
    next();
  };
