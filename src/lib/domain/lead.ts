import { z } from "zod"

/**
 * Duplicate-detection normalization, per BUILD_READINESS_QUESTIONNAIRE.md:
 * "If either normalized phone or normalized email matches, show a
 * possible-duplicate review rather than automatically creating or merging
 * a record."
 */
export function normalizePhone(phone: string | undefined | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/[^\d]/g, "")
  return digits.length > 0 ? digits : null
}

export function normalizeEmail(email: string | undefined | null): string | null {
  if (!email) return null
  const trimmed = email.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

export const leadIntakeSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required.").max(200),
    businessName: z.string().trim().max(200).optional().or(z.literal("")),
    phone: z.string().trim().max(50).optional().or(z.literal("")),
    email: z.email().optional().or(z.literal("")),
    serviceNeeded: z.string().trim().max(500).optional().or(z.literal("")),
    budget: z.string().trim().max(200).optional().or(z.literal("")),
    consent: z.boolean(),
    source: z.string().trim().max(200).optional().or(z.literal("")),
  })
  .refine((v) => v.phone || v.email, {
    message: "Provide at least a phone number or an email.",
    path: ["phone"],
  })

export type LeadIntakeInput = z.infer<typeof leadIntakeSchema>

const FOLLOWUP_DUE_DAYS = 2
const MAX_FOLLOWUP_ATTEMPTS = 3
const OPEN_STAGES = ["NEW", "QUALIFIED", "MEETING_BOOKED", "QUOTE_SENT"]

export function isFollowupDue(lead: {
  stage: string
  followup_count: number
  last_followup_at: string | null
  created_at: string
}): boolean {
  if (!OPEN_STAGES.includes(lead.stage)) return false
  if (lead.followup_count >= MAX_FOLLOWUP_ATTEMPTS) return false
  const since = lead.last_followup_at ?? lead.created_at
  const daysSince = (Date.now() - new Date(since).getTime()) / (1000 * 60 * 60 * 24)
  return daysSince >= FOLLOWUP_DUE_DAYS
}
