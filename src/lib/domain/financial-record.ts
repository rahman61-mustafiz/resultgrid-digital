import { z } from "zod"

import {
  ATTRIBUTABLE_RECORD_TYPE,
  EVIDENCE_STATUSES,
  FINANCIAL_RECORD_TYPES,
  VALUE_STATUSES,
} from "@/lib/domain/enums"

export const financialRecordSchema = z
  .object({
    recordType: z.enum(FINANCIAL_RECORD_TYPES),
    amount: z.coerce.number().nonnegative("Amount can't be negative."),
    valueStatus: z.enum(VALUE_STATUSES),
    periodStart: z.string().min(1, "Start date is required."),
    periodEnd: z.string().min(1, "End date is required."),
    evidenceStatus: z.enum(EVIDENCE_STATUSES),
    evidenceUrl: z.url().optional().or(z.literal("")),
    notes: z.string().trim().max(2000).optional().or(z.literal("")),
    attributedToMarketing: z.coerce.boolean().optional().default(false),
  })
  .refine((v) => v.periodEnd >= v.periodStart, {
    message: "End date can't be before the start date.",
    path: ["periodEnd"],
  })
  .refine(
    (v) => !v.attributedToMarketing || v.recordType === ATTRIBUTABLE_RECORD_TYPE,
    {
      message: "Only client revenue records can be attributed to marketing.",
      path: ["attributedToMarketing"],
    }
  )
  .refine(
    (v) => !v.attributedToMarketing || v.evidenceStatus !== "UNVERIFIED",
    {
      message:
        "Attributing revenue to marketing requires evidence -- set an evidence status other than Unverified.",
      path: ["attributedToMarketing"],
    }
  )

export const correctionSchema = z.object({
  newAmount: z.coerce.number().nonnegative("Amount can't be negative."),
  reason: z.string().trim().min(5, "Explain the correction (at least 5 characters)."),
})
