/**
 * Literal-union types matching the CHECK constraints in
 * supabase/migrations/*.sql. Keep these in sync by hand whenever a
 * constraint changes -- see the header comment in
 * src/lib/supabase/types.ts for why these aren't generated.
 */

export const WORKSPACE_ROLES = [
  "OWNER",
  "EDITOR",
  "VIEWER",
  "CLIENT_READONLY",
] as const
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number]

export const CLIENT_BUSINESS_RECORD_TYPES = [
  "OWNED_BUSINESS",
  "EXTERNAL_CLIENT",
] as const
export type ClientBusinessRecordType = (typeof CLIENT_BUSINESS_RECORD_TYPES)[number]

export const CLIENT_BUSINESS_STATUSES = ["ACTIVE", "ARCHIVED"] as const
export type ClientBusinessStatus = (typeof CLIENT_BUSINESS_STATUSES)[number]

export const PROJECT_TYPES = [
  "FULL_DIGITAL_MARKETING",
  "MARKETING_AUDIT_STRATEGY",
  "SEO",
  "SOCIAL_MEDIA",
  "PAID_ADVERTISING",
  "WEBSITE",
  "BRANDING_CREATIVE",
  "CUSTOM",
] as const
export type ProjectType = (typeof PROJECT_TYPES)[number]

export const PROJECT_LIFECYCLE_STATUSES = [
  "ACTIVE",
  "ON_HOLD",
  "COMPLETED",
  "ARCHIVED",
] as const
export type ProjectLifecycleStatus = (typeof PROJECT_LIFECYCLE_STATUSES)[number]

export const PROJECT_READINESS_STATUSES = [
  "INCOMPLETE",
  "READY_FOR_REVIEW",
  "APPROVED",
] as const
export type ProjectReadinessStatus = (typeof PROJECT_READINESS_STATUSES)[number]

export const SECURITY_EVENT_TYPES = [
  "NEW_DEVICE_LOGIN",
  "PASSWORD_CHANGE",
  "TOTP_ENROLLED",
  "TOTP_CHANGED",
  "RECOVERY_EMAIL_CHANGED",
  "RECOVERY_REQUESTED",
  "RECOVERY_COMPLETED",
  "FAILED_PASSWORD_ATTEMPT",
  "FAILED_TOTP_ATTEMPT",
  "ACCOUNT_LOCKED_COOLDOWN",
  "SESSION_LOCKED",
  "SESSION_UNLOCKED",
  "RECENT_REAUTH_COMPLETED",
] as const
export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number]

export const PROJECT_READINESS_TRANSITIONS = {
  INCOMPLETE: ["READY_FOR_REVIEW"],
  READY_FOR_REVIEW: ["INCOMPLETE", "APPROVED"],
  APPROVED: ["READY_FOR_REVIEW"],
} as const

/** See QUESTIONNAIRE_V1_DRAFT.md "Standard answer states". */
export const ANSWER_STATUSES = [
  "UNANSWERED",
  "ANSWERED",
  "CONFIRMED",
  "NOT_STARTED",
  "NOT_APPLICABLE",
  "UNKNOWN",
] as const
export type AnswerStatus = (typeof ANSWER_STATUSES)[number]

/** See BUILD_READINESS_QUESTIONNAIRE.md section M and E14. */
export const FINANCIAL_RECORD_TYPES = [
  "CLIENT_PAYMENT_RECEIVED",
  "CLIENT_OWN_REVENUE",
  "MARKETING_SPEND",
  "RESULTGRID_FEE",
  "DIRECT_DELIVERY_COST",
  "ALLOCATED_OPERATING_COST",
  "OTHER_CAMPAIGN_COST",
] as const
export type FinancialRecordType = (typeof FINANCIAL_RECORD_TYPES)[number]

export const FINANCIAL_RECORD_TYPE_LABELS: Record<FinancialRecordType, string> = {
  CLIENT_PAYMENT_RECEIVED: "Client payment received (to ResultGrid Digital)",
  CLIENT_OWN_REVENUE: "Client's own sales/revenue",
  MARKETING_SPEND: "Marketing spend",
  RESULTGRID_FEE: "ResultGrid Digital service fee",
  DIRECT_DELIVERY_COST: "Direct project-delivery cost",
  ALLOCATED_OPERATING_COST: "Allocated operating cost",
  OTHER_CAMPAIGN_COST: "Other agreed campaign cost",
}

/** See BUILD_READINESS_QUESTIONNAIRE.md E14.Q09 -- the attribution model
 * this restricts to. */
export const ATTRIBUTABLE_RECORD_TYPE = "CLIENT_OWN_REVENUE" satisfies FinancialRecordType

export const VALUE_STATUSES = [
  "CONFIRMED",
  "ESTIMATED",
  "PENDING",
  "REFUNDED",
  "DISPUTED",
] as const
export type ValueStatus = (typeof VALUE_STATUSES)[number]

export const EVIDENCE_STATUSES = [
  "VERIFIED",
  "OWNER_REPORTED",
  "CLIENT_REPORTED",
  "UNVERIFIED",
] as const
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number]

/** See BUILD_READINESS_QUESTIONNAIRE.md "Leads and follow-up". */
export const LEAD_STAGES = [
  "NEW",
  "QUALIFIED",
  "MEETING_BOOKED",
  "QUOTE_SENT",
  "PAYING_CLIENT",
  "LOST",
] as const
export type LeadStage = (typeof LEAD_STAGES)[number]

export const EVIDENCE_CATEGORIES = [
  "brand",
  "evidence",
  "reports",
  "financial",
  "creative",
  "seo",
  "ads",
  "website",
  "contracts",
  "exports",
] as const
export type EvidenceCategory = (typeof EVIDENCE_CATEGORIES)[number]

/** See BUILD_READINESS_QUESTIONNAIRE.md E14.Q10 and the minimum dashboard list. */
export const TARGET_METRICS = [
  "PAYING_CLIENTS",
  "LEADS",
  "MEETINGS",
  "CONVERSION_RATE",
  "ACQUIRED_CUSTOMERS",
  "MARKETING_SPEND",
  "CUSTOMER_ACQUISITION_COST",
  "REVENUE",
  "PROFIT",
  "KEYWORD_RANKING",
] as const
export type TargetMetric = (typeof TARGET_METRICS)[number]

export const TARGET_METRIC_LABELS: Record<TargetMetric, string> = {
  PAYING_CLIENTS: "Paying clients",
  LEADS: "Leads",
  MEETINGS: "Meetings",
  CONVERSION_RATE: "Conversion rate",
  ACQUIRED_CUSTOMERS: "Acquired customers",
  MARKETING_SPEND: "Marketing spend",
  CUSTOMER_ACQUISITION_COST: "Customer acquisition cost",
  REVENUE: "Revenue",
  PROFIT: "Profit",
  KEYWORD_RANKING: "Keyword ranking",
}

/** See CLAUDE_CODE_BUILD_HANDOFF.md "Creative workflow". */
export const CREATIVE_STATUSES = [
  "DRAFT",
  "INTERNAL_REVIEW",
  "CLIENT_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "PUBLISHED",
] as const
export type CreativeStatus = (typeof CREATIVE_STATUSES)[number]
