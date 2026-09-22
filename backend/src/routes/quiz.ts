// المرحلة 2 — الكويز (كل قرارات القفل والمحاولات والمؤقّت في الخادم)
import { Router } from "express";
import { z } from "zod";
import { ah, parse } from "../lib/http";
import { authenticate, requireRole } from "../middleware/auth";
import { loadLabOr404 } from "../labs/stages";
import { assertLabAccess } from "./labs";
import { getAttempt, lastReview, quizStatus, saveAnswers, startAttempt, submitAttempt } from "../quiz/service";

export const quizRouter = Router();
// ⚠️ الحراسة مقيَّدة بمسارات الكويز فقط (الراوتر مركَّب على /api)
quizRouter.use("/labs/:id/quiz", authenticate, requireRole("STUDENT"));
quizRouter.use("/quiz", authenticate, requireRole("STUDENT"));

const answersSchema = z.object({ answers: z.record(z.unknown()).default({}) });

quizRouter.get(
  "/labs/:id/quiz",
  ah(async (req, res) => {
    const lab = await loadLabOr404(req.params.id);
    await assertLabAccess(req.user!, lab);
    res.json(await quizStatus(req.user!, lab));
  }),
);

/** بدء (أو استئناف) محاولة — 403 STAGE_LOCKED إن لم تكتمل المرحلة 1 */
quizRouter.post(
  "/labs/:id/quiz/attempts",
  ah(async (req, res) => {
    const lab = await loadLabOr404(req.params.id);
    await assertLabAccess(req.user!, lab);
    res.status(201).json(await startAttempt(req.user!, lab));
  }),
);

quizRouter.get(
  "/labs/:id/quiz/review",
  ah(async (req, res) => {
    const lab = await loadLabOr404(req.params.id);
    await assertLabAccess(req.user!, lab);
    res.json(await lastReview(req.user!, lab));
  }),
);

quizRouter.get("/quiz/attempts/:attemptId", ah(async (req, res) => res.json(await getAttempt(req.user!, req.params.attemptId))));

quizRouter.put(
  "/quiz/attempts/:attemptId/answers",
  ah(async (req, res) => res.json(await saveAnswers(req.user!, req.params.attemptId, parse(answersSchema, req.body).answers))),
);

quizRouter.post(
  "/quiz/attempts/:attemptId/submit",
  ah(async (req, res) => res.json(await submitAttempt(req.user!, req.params.attemptId, parse(answersSchema, req.body).answers))),
);
