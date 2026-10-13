import { z } from "zod"

import { EVIDENCE_CATEGORIES, EVIDENCE_STATUSES } from "@/lib/domain/enums"

export const evidenceItemSchema = z.object({
  category: z.enum(EVIDENCE_CATEGORIES),
  originalFilename: z.string().trim().max(300).optional().or(z.literal("")),
  externalUrl: z.url("Enter a valid link."),
  verificationStatus: z.enum(EVIDENCE_STATUSES),
  evidenceDate: z.string().trim().optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
})

/** Metadata recorded with an uploaded file; the file itself is checked separately. */
export const evidenceAttachmentSchema = z.object({
  category: z.enum(EVIDENCE_CATEGORIES),
  verificationStatus: z.enum(EVIDENCE_STATUSES),
  evidenceDate: z.string().trim().optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
})
