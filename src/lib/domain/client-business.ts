import { z } from "zod"

import { CLIENT_BUSINESS_RECORD_TYPES } from "@/lib/domain/enums"

/**
 * Field-level rules matching BUILD_READINESS_QUESTIONNAIRE.md section D
 * ("Recorded client/business and project fields") and the
 * client_businesses migration's CHECK constraints.
 */
export const clientBusinessSchema = z.object({
  displayName: z.string().trim().min(1, "Display name is required.").max(200),
  recordType: z.enum(CLIENT_BUSINESS_RECORD_TYPES),
  country: z.string().trim().min(1, "Country is required."),
  timezone: z.string().trim().min(1, "Timezone is required."),

  legalName: z.string().trim().max(200).optional().or(z.literal("")),
  website: z.url().optional().or(z.literal("")),
  industry: z.string().trim().max(200).optional().or(z.literal("")),
  primaryContactName: z.string().trim().max(200).optional().or(z.literal("")),
  email: z.email().optional().or(z.literal("")),
  phone: z.string().trim().max(50).optional().or(z.literal("")),
  address: z.string().trim().max(500).optional().or(z.literal("")),
  internalNotes: z.string().trim().max(5000).optional().or(z.literal("")),
})

export type ClientBusinessInput = z.infer<typeof clientBusinessSchema>

/** Empty-string optional fields become null for storage, never "". */
export function normalizeOptional(value: string | undefined): string | null {
  return value && value.trim().length > 0 ? value.trim() : null
}
