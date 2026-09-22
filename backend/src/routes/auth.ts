import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../db";
import { ah, clientIp, HttpError, parse } from "../lib/http";
import { signToken } from "../lib/jwt";
import { audit } from "../lib/audit";
import { authenticate } from "../middleware/auth";
import type { User } from "../generated/prisma/client";

export const authRouter = Router();

export const publicUser = (u: User) => ({ id: u.id, name: u.name, email: u.email, role: u.role, locale: u.locale, classroomId: u.classroomId });

// حماية من تخمين كلمات السر
const loginLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: { code: "RATE_LIMITED" } } });

authRouter.post(
  "/login",
  loginLimiter,
  ah(async (req, res) => {
    const { email, password } = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    const ok = user && user.active && (await bcrypt.compare(password, user.passwordHash));
    if (!ok) {
      await audit(user?.id ?? null, "login_failed", "user", user?.id, { email }, clientIp(req));
      throw new HttpError(401, "BAD_CREDENTIALS");
    }
    await audit(user.id, "login", "user", user.id, undefined, clientIp(req));
    res.json({ token: signToken({ sub: user.id, role: user.role }), user: publicUser(user) });
  }),
);

authRouter.get("/me", authenticate, (req, res) => res.json({ user: publicUser(req.user!) }));

authRouter.patch(
  "/me",
  authenticate,
  ah(async (req, res) => {
    const d = parse(z.object({ name: z.string().min(2).max(80).optional(), locale: z.enum(["ar", "fr"]).optional() }), req.body);
    const user = await prisma.user.update({ where: { id: req.user!.id }, data: d });
    res.json({ user: publicUser(user) });
  }),
);

authRouter.post(
  "/change-password",
  authenticate,
  ah(async (req, res) => {
    const d = parse(z.object({ current: z.string(), next: z.string().min(8).max(100) }), req.body);
    if (!(await bcrypt.compare(d.current, req.user!.passwordHash))) throw new HttpError(400, "BAD_CURRENT_PASSWORD");
    await prisma.user.update({ where: { id: req.user!.id }, data: { passwordHash: await bcrypt.hash(d.next, 10) } });
    await audit(req.user!.id, "password_changed", "user", req.user!.id, undefined, clientIp(req));
    res.json({ ok: true });
  }),
);
