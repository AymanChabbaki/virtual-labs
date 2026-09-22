import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../lib/http";

export function notFound(_req: Request, _res: Response, next: NextFunction) {
  next(new HttpError(404, "NOT_FOUND"));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  console.error("[error]", err);
  res.status(500).json({ error: { code: "INTERNAL", message: "Internal server error" } });
}
