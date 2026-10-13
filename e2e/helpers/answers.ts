import type { QuestionDefinition, StructuredValue } from "@/lib/questionnaire/types"

/**
 * A complete, valid answer set for a synthetic project in which every
 * conditional question applies (operating business, live website, active
 * social profiles, running ads, every scope item in E13.Q02). Used by the
 * browser E2E seed and the unit tests; "Vera Wellness" is a synthetic
 * fixture, never real client data.
 */
export const STRUCTURED_ANSWERS: Record<string, StructuredValue> = {
  "E01.Q03": { type: "Health/beauty" },
  "E01.Q05": { country: "BD" },
  "E01.Q06": { reach: ["Specific address/service area"], locations: "Bangladesh -- Dhaka (Gulshan studio)" },
  "E01.Q07": { languages: ["Bangla", "English"], primary: "Bangla" },
  "E01.Q09": { answer: "No" },
  "E02.Q06": { limitType: "Numeric limit", amount: "40", unit: "clients", period: "Per month" },
  "E04.Q03": { traits: ["Professional", "Trustworthy", "Caring", "Calm"] },
  "E04.Q07": { status: "Partial assets exist", assets: "logo -- https://example.com/vera/logo -- client -- approved for use" },
  "E04.Q09": { authority: "ResultGrid Digital Owner (Rana)" },
  "E05.Q01": { status: "Direct competitors named", competitors: "Calm Spa -- https://example.com/calm -- Dhaka -- same services" },
  "E05.Q02": { alternatives: ["Freelancers", "Doing nothing or postponing"] },
  "E06.Q09": { authority: "ResultGrid Digital Owner (Rana)", changeRule: "Changes after approval need a reason and a new version." },
  "E07.Q01": { status: "Live", url: "https://example.com/vera", ownership: "Owned by the business" },
  "E08.Q01": { status: "Active profiles" },
  "E09.Q01": { status: "Running" },
  "E09.Q05": { status: "Approved budget", amount: "30000", currency: "BDT", period: "Per month", hardCap: "35000" },
  "E12.Q07": { categories: ["Health", "Beauty/cosmetics"], constraints: "Health claims need review before publishing." },
  "E13.Q02": {
    scope: [
      "Website",
      "SEO",
      "Local listings / Google Business Profile",
      "Content or creative production",
      "Publishing content, ads, or website changes",
      "Lead capture (forms, booking, messaging)",
      "Results reporting",
      "Revenue, cost, or profit reporting",
      "Public claims or case studies",
    ],
    included: "Website refresh, local SEO, social content, Meta ads, monthly reporting",
    excluded: "Product photography",
  },
  "E13.Q04": {
    startDate: "2026-11-01",
    finalDate: "2027-04-30",
    milestones: "2026-11-15 -- Launch plan approved\n2027-01-31 -- Mid-project review",
  },
  "E14.Q01": { levels: ["Business/client", "Project", "Campaign"], allocationRule: "Every record belongs to one client and one project." },
  "E14.Q06": { projectCurrency: "BDT", conversion: "No conversion needed" },
  "E14.Q07": { periods: ["Monthly", "Campaign"], boundaries: "Weeks start Saturday; months are calendar months in Asia/Dhaka." },
}

const SINGLE_SELECT_ANSWERS: Record<string, string> = {
  "E01.Q04": "Operating",
}

/** A valid answer for `question`; `text` is used for free-text questions. */
export function validAnswer(question: QuestionDefinition, text: string): string | StructuredValue {
  if (question.type === "STRUCTURED") {
    const answer = STRUCTURED_ANSWERS[question.key]
    if (!answer) throw new Error(`no fixture answer for ${question.key}`)
    return answer
  }
  if (question.type === "SINGLE_SELECT") return SINGLE_SELECT_ANSWERS[question.key] ?? question.options![0].value
  if (question.type === "DATE") return "2026-11-01"
  return text.padEnd(question.minLength ?? 0, ".")
}
