import { z } from "zod"

import { TARGET_METRICS } from "@/lib/domain/enums"

/**
 * Empty string -> undefined ("not provided"), never 0 -- a blank baseline
 * or actual must stay unknown, not become a false zero. z.coerce.number()
 * alone would turn "" into 0 (Number("") === 0), which is exactly the
 * "missing treated as zero" bug BUILD_READINESS_QUESTIONNAIRE.md M12
 * warns against.
 */
const optionalNumber = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.coerce.number().optional()
)

export const targetSchema = z
  .object({
    metric: z.enum(TARGET_METRICS),
    unit: z.string().trim().min(1, "Unit is required (e.g. count, %, currency)."),
    baseline: optionalNumber,
    target: z.coerce.number(),
    actual: optionalNumber,
    actualSource: z.string().trim().max(300).optional().or(z.literal("")),
    periodStart: z.string().trim().min(1, "Start date is required."),
    periodEnd: z.string().trim().min(1, "End date is required."),
    notes: z.string().trim().max(1000).optional().or(z.literal("")),
  })
  .refine((v) => v.periodEnd >= v.periodStart, {
    message: "End date can't be before the start date.",
    path: ["periodEnd"],
  })
