import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config";
import { errorHandler, notFound } from "./middleware/error";
import { authRouter } from "./routes/auth";
import { labsRouter } from "./routes/labs";
import { simulationRouter } from "./routes/simulation";
import { quizRouter } from "./routes/quiz";
import { remoteRouter } from "./routes/remote";
import { adminRouter } from "./routes/admin";
import { teacherRouter } from "./routes/teacher";
import { notificationsRouter, reportsRouter, studentRouter } from "./routes/misc";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(cors({ origin: config.corsOrigin, credentials: true }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  app.use("/api/auth", authRouter);
  app.use("/api/labs", labsRouter);
  app.use("/api/labs", simulationRouter); // /api/labs/:id/simulation/...
  app.use("/api", quizRouter); // /api/labs/:id/quiz..., /api/quiz/attempts/...
  app.use("/api/remote", remoteRouter);
  app.use("/api/student", studentRouter);
  app.use("/api/teacher", teacherRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/admin", adminRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
