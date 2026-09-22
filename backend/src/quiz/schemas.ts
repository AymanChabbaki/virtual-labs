import { z } from "zod";

const L = z.object({ ar: z.string().min(1), fr: z.string().min(1) });

export const McqPayload = z
  .object({
    choices: z.array(z.object({ id: z.string().min(1), ar: z.string().min(1), fr: z.string().min(1) })).min(2).max(8),
    correct: z.array(z.string()).min(1),
    multi: z.boolean().default(false),
  })
  .refine((p) => p.correct.every((c) => p.choices.some((x) => x.id === c)), "correct ids must exist in choices")
  .refine((p) => p.multi || p.correct.length === 1, "single-choice needs exactly one correct id");

export const TfPayload = z.object({ correct: z.boolean() });

export const NumericPayload = z.object({
  answer: z.number(),
  tolerancePct: z.number().min(0).max(100).default(2),
  toleranceAbs: z.number().min(0).optional(),
  unit: z.string().optional(),
});

export const FillPayload = z.object({ accepted: z.array(z.array(z.string().min(1)).min(1)).min(1).max(6) });

export const QuestionInput = z
  .object({
    type: z.enum(["MCQ", "TRUE_FALSE", "NUMERIC", "FILL_BLANK"]),
    textAr: z.string().min(1),
    textFr: z.string().min(1),
    payload: z.unknown(),
    points: z.number().int().min(1).max(20).default(1),
    explanationAr: z.string().nullish(),
    explanationFr: z.string().nullish(),
    order: z.number().int().default(0),
  })
  .transform((q, ctx) => {
    const schema = { MCQ: McqPayload, TRUE_FALSE: TfPayload, NUMERIC: NumericPayload, FILL_BLANK: FillPayload }[q.type];
    const r = schema.safeParse(q.payload);
    if (!r.success) {
      r.error.issues.forEach((i) => ctx.addIssue({ ...i, path: ["payload", ...i.path] }));
      return z.NEVER;
    }
    if (q.type === "FILL_BLANK") {
      const p = r.data as z.infer<typeof FillPayload>;
      for (const [lang, txt] of [["ar", q.textAr], ["fr", q.textFr]] as const) {
        if ((txt.match(/___/g) ?? []).length !== p.accepted.length)
          ctx.addIssue({ code: "custom", message: `text ${lang} must contain exactly ${p.accepted.length} blank(s) written as ___`, path: ["text" + lang] });
      }
    }
    return { ...q, payload: r.data };
  });

export type McqP = z.infer<typeof McqPayload>;
export type NumP = z.infer<typeof NumericPayload>;
export type FillP = z.infer<typeof FillPayload>;
export type TfP = z.infer<typeof TfPayload>;
export const _L = L;
