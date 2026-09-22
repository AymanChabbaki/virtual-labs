import jwt from "jsonwebtoken";
import { config } from "../config";

export interface JwtPayload {
  sub: string;
  role: "STUDENT" | "TEACHER" | "ADMIN";
}

export const signToken = (p: JwtPayload) =>
  jwt.sign(p, config.jwtSecret, { expiresIn: config.jwtExpiresIn as jwt.SignOptions["expiresIn"] });

export const verifyToken = (t: string): JwtPayload => jwt.verify(t, config.jwtSecret) as JwtPayload;

/** رمز قصير العمر لبث الفيديو (لأن وسم <img> لا يرسل ترويسة Authorization) */
export const signStreamToken = (bookingId: string, userId: string) =>
  jwt.sign({ b: bookingId, u: userId, typ: "stream" }, config.jwtSecret, { expiresIn: "2h" });

export const verifyStreamToken = (t: string) => {
  const p = jwt.verify(t, config.jwtSecret) as { b: string; u: string; typ: string };
  if (p.typ !== "stream") throw new Error("bad token type");
  return p;
};
