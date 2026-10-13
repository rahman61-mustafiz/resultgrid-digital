import { readFileSync } from "node:fs"

import { expect, test } from "@playwright/test"

import { QUESTIONS } from "@/lib/questionnaire/v1"
import {
  answerIssues,
  buildContext,
  evaluateCondition,
  formatAnswerValue,
  isApplicable,
  isRequired,
  normalizeAnswerValue,
  QUESTION_BY_KEY,
  type AnswerRecord,
} from "@/lib/questionnaire/engine"
import { computeReadiness } from "@/lib/questionnaire/readiness"
import type { Condition, QuestionDefinition, StructuredValue } from "@/lib/questionnaire/types"
import { generateProjectContextMarkdown } from "@/lib/export/project-context"
import { STRUCTURED_ANSWERS, validAnswer } from "../helpers/answers"

function q(key: string): QuestionDefinition {
  const question = QUESTION_BY_KEY.get(key)
  if (!question) throw new Error(`no question ${key}`)
  return question
}

function answered(key: string, value: string | StructuredValue): AnswerRecord {
  return { question_key: key, status: "ANSWERED", value }
}

/** Every question answered validly; `overrides` replace or (null) remove answers. */
function fullAnswers(overrides: Record<string, string | StructuredValue | null> = {}): AnswerRecord[] {
  const records: AnswerRecord[] = []
  for (const question of QUESTIONS) {
    const override = overrides[question.key]
    if (override === null) continue
    records.push(answered(question.key, override ?? validAnswer(question, `Synthetic answer for ${question.key}`)))
  }
  return records
}

function ctxWith(overrides: Record<string, string | StructuredValue | null>, projectType = "FULL_DIGITAL_MARKETING") {
  return buildContext(projectType, fullAnswers(overrides))
}

function conditionsOf(question: QuestionDefinition): Condition[] {
  const out: Condition[] = []
  const walk = (c: Condition | undefined) => {
    if (!c) return
    out.push(c)
    if ("any" in c) c.any.forEach(walk)
    if ("all" in c) c.all.forEach(walk)
    if ("not" in c) walk(c.not)
  }
  walk(question.showWhen)
  walk(question.optionalWhen)
  for (const f of question.fields ?? []) for (const rule of Object.values(f.optionConditions ?? {})) walk(rule.when)
  return out
}

test.describe("questionnaire definition", () => {
  test("has the draft's 130 unique keys: 127 required, 3 optional", () => {
    expect(QUESTIONS).toHaveLength(130)
    expect(new Set(QUESTIONS.map((x) => x.key)).size).toBe(130)
    expect(QUESTIONS.filter((x) => x.required)).toHaveLength(127)
    expect(QUESTIONS.filter((x) => !x.required).map((x) => x.key)).toEqual(["E01.Q02", "E02.Q07", "E05.Q06"])
  })

  test("E13.Q04 is required and structured as the draft specifies", () => {
    const e13q04 = q("E13.Q04")
    expect(e13q04.required).toBe(true)
    expect(e13q04.question).toBe(
      "When may work start, what is the final target date, and which milestones or recurring deadlines apply?"
    )
    expect(e13q04.fields?.map((f) => f.id)).toEqual(["startDate", "finalDate", "milestones", "flexibility"])
  })

  test("the database's key list matches v1.ts exactly", () => {
    const sql = readFileSync("supabase/migrations/20261007100000_reject_unknown_question_keys.sql", "utf8")
    const block = sql.slice(sql.indexOf("when 1 then array["), sql.indexOf("]::text[]"))
    const dbKeys = [...block.matchAll(/'(E\d\d\.Q\d\d)'/g)].map((m) => m[1])
    expect(dbKeys).toEqual(QUESTIONS.map((x) => x.key))
  })

  test("every condition, field reference, and rule is well-formed", () => {
    for (const question of QUESTIONS) {
      for (const c of conditionsOf(question)) {
        if (!("answer" in c)) continue
        const controller = q(c.answer)
        if (controller.type === "STRUCTURED") {
          const field = controller.fields?.find((f) => f.id === c.field)
          expect(field, `${question.key} -> ${c.answer}.${c.field}`).toBeTruthy()
          const values = new Set(field!.options?.map((o) => o.value))
          for (const v of c.in) expect(values.has(v), `${question.key}: "${v}" is an option of ${c.answer}.${c.field}`).toBe(true)
        } else {
          expect(c.field, `${question.key} -> ${c.answer} has no fields`).toBeUndefined()
          const values = new Set(controller.options?.map((o) => o.value))
          for (const v of c.in) expect(values.has(v), `${question.key}: "${v}" is an option of ${c.answer}`).toBe(true)
        }
      }
      if (question.type === "STRUCTURED") {
        const ids = new Set(question.fields?.map((f) => f.id))
        expect(ids.size, `${question.key} has fields`).toBeGreaterThan(0)
        for (const f of question.fields ?? []) {
          if (f.kind === "select" || f.kind === "multi_select") expect(f.options?.length, `${question.key}.${f.id} options`).toBeGreaterThan(0)
          if (f.requiredWhen) {
            const sibling = question.fields!.find((s) => s.id === f.requiredWhen!.field)
            expect(sibling, `${question.key}.${f.id} requiredWhen sibling`).toBeTruthy()
            const opts = new Set(sibling!.options?.map((o) => o.value))
            for (const v of f.requiredWhen.in) expect(opts.has(v), `${question.key}.${f.id} requiredWhen "${v}"`).toBe(true)
          }
          for (const v of Object.keys(f.optionConditions ?? {})) {
            expect(f.options?.some((o) => o.value === v), `${question.key}.${f.id} optionConditions "${v}"`).toBe(true)
          }
        }
        for (const rule of question.rules ?? []) {
          expect(ids.has(rule.field), `${question.key} rule field ${rule.field}`).toBe(true)
          expect(ids.has(rule.kind === "oneOfSelected" ? rule.from : rule.than), `${question.key} rule ref`).toBe(true)
        }
        expect(STRUCTURED_ANSWERS[question.key], `fixture answer for ${question.key}`).toBeTruthy()
      }
    }
  })

  test("conditions evaluate without cycles for empty and full answer sets", () => {
    for (const answers of [[], fullAnswers()]) {
      const ctx = buildContext("CUSTOM", answers)
      for (const question of QUESTIONS) {
        expect(() => isApplicable(question, ctx)).not.toThrow()
        expect(() => isRequired(question, ctx)).not.toThrow()
      }
    }
  })
})

test.describe("conditions", () => {
  const adQuestions = ["E09.Q03", "E09.Q04", "E09.Q05", "E09.Q06", "E09.Q07", "E09.Q09", "E09.Q10"]

  test("ads out of scope removes every ad question; running ads keep them", () => {
    const out = ctxWith({ "E09.Q01": { status: "Out of scope" } })
    for (const key of [...adQuestions, "E09.Q02", "E09.Q08"]) expect(isApplicable(q(key), out), key).toBe(false)
    const running = ctxWith({ "E09.Q01": { status: "Running" } })
    for (const key of [...adQuestions, "E09.Q02", "E09.Q08"]) expect(isApplicable(q(key), running), key).toBe(true)
  })

  test("planned ads need the planning questions but not account/history questions", () => {
    const planned = ctxWith({ "E09.Q01": { status: "Planned" } })
    for (const key of adQuestions) expect(isRequired(q(key), planned), key).toBe(true)
    expect(isApplicable(q("E09.Q02"), planned)).toBe(false)
    expect(isApplicable(q("E09.Q08"), planned)).toBe(false)
  })

  test("an unanswered controller keeps dependent questions shown and required", () => {
    const ctx = ctxWith({ "E09.Q01": null, "E13.Q02": null })
    expect(evaluateCondition({ answer: "E09.Q01", field: "status", in: ["Running"] }, ctx)).toBeNull()
    for (const key of [...adQuestions, "E10.Q02", "E12.Q08", "E14.Q02"]) expect(isRequired(q(key), ctx), key).toBe(true)
  })

  test("SEO questions follow project type or SEO scope", () => {
    const scopeWithoutSeo = { ...STRUCTURED_ANSWERS["E13.Q02"], scope: ["Website"] }
    const social = ctxWith({ "E13.Q02": scopeWithoutSeo }, "SOCIAL_MEDIA")
    expect(isApplicable(q("E07.Q06"), social)).toBe(false)
    expect(isApplicable(q("E07.Q06"), ctxWith({ "E13.Q02": scopeWithoutSeo }, "SEO"))).toBe(true)
    expect(isApplicable(q("E07.Q06"), ctxWith({ "E13.Q02": { ...scopeWithoutSeo, scope: ["SEO"] } }, "SOCIAL_MEDIA"))).toBe(true)
  })

  test("social not in scope removes the social planning questions", () => {
    const ctx = ctxWith({ "E08.Q01": { status: "Social not in scope" } })
    for (const key of ["E08.Q02", "E08.Q03", "E08.Q04", "E08.Q05", "E08.Q06", "E08.Q07", "E08.Q08"]) {
      expect(isApplicable(q(key), ctx), key).toBe(false)
    }
    const creating = ctxWith({ "E08.Q01": { status: "Profiles being created" } })
    expect(isApplicable(q("E08.Q02"), creating)).toBe(true)
    expect(isApplicable(q("E08.Q04"), creating)).toBe(false)
  })

  test("contact methods become optional only before launch", () => {
    expect(isRequired(q("E01.Q08"), ctxWith({ "E01.Q04": "Operating" }))).toBe(true)
    expect(isRequired(q("E01.Q08"), ctxWith({ "E01.Q04": "Idea/pre-launch" }))).toBe(false)
  })

  test("visual guidance is optional with a complete brand kit", () => {
    expect(isRequired(q("E04.Q08"), ctxWith({}))).toBe(true)
    expect(isRequired(q("E04.Q08"), ctxWith({ "E04.Q07": { status: "Complete approved brand kit", assets: "kit -- link -- client -- approved" } }))).toBe(false)
  })

  test("competitor observations apply only when competitors are named", () => {
    expect(isApplicable(q("E05.Q05"), ctxWith({ "E05.Q01": { status: "Not researched yet" } }))).toBe(false)
    expect(isApplicable(q("E05.Q05"), ctxWith({}))).toBe(true)
  })

  test("local presence applies only to businesses serving a place", () => {
    const online = ctxWith({ "E01.Q06": { reach: ["Online only"], locations: "Worldwide" } })
    expect(isApplicable(q("E07.Q04"), online)).toBe(false)
  })
})

test.describe("answer shape (save time)", () => {
  test("rejects values that cannot belong to the question", () => {
    expect(normalizeAnswerValue(q("E01.Q04"), "Bankrupt").ok).toBe(false)
    expect(normalizeAnswerValue(q("E07.Q01"), "Live").ok).toBe(false)
    expect(normalizeAnswerValue(q("E07.Q01"), { status: "Live", password: "x" }).ok).toBe(false)
    expect(normalizeAnswerValue(q("E07.Q01"), { status: "Online" }).ok).toBe(false)
    expect(normalizeAnswerValue(q("E13.Q04"), { startDate: "2026-02-30" }).ok).toBe(false)
    expect(normalizeAnswerValue(q("E01.Q05"), { country: "XX" }).ok).toBe(false)
    expect(normalizeAnswerValue(q("E13.Q02"), { scope: "SEO" }).ok).toBe(false)
    expect(normalizeAnswerValue(q("E01.Q01"), { text: "x" }).ok).toBe(false)
    expect(normalizeAnswerValue(q("E01.Q01"), "x".repeat(2001)).ok).toBe(false)
  })

  test("accepts incomplete drafts and canonicalizes them", () => {
    expect(normalizeAnswerValue(q("E01.Q01"), "  Vera  ")).toEqual({ ok: true, value: "Vera" })
    expect(normalizeAnswerValue(q("E01.Q01"), "   ")).toEqual({ ok: true, value: null })
    expect(normalizeAnswerValue(q("E07.Q01"), { url: " not a url ", status: "Live" })).toEqual({
      ok: true,
      value: { status: "Live", url: "not a url" },
    })
    expect(normalizeAnswerValue(q("E07.Q01"), { status: "", notes: " " })).toEqual({ ok: true, value: null })
    expect(normalizeAnswerValue(q("E04.Q03"), { traits: ["Calm", "Professional", "Calm"] })).toEqual({
      ok: true,
      value: { traits: ["Professional", "Calm"] },
    })
    expect(normalizeAnswerValue(q("E09.Q05"), { currency: "bdt" })).toEqual({ ok: true, value: { currency: "BDT" } })
  })
})

test.describe("readiness issues", () => {
  const ctx = ctxWith({})
  const issuesFor = (key: string, value: string | StructuredValue) => answerIssues(q(key), value, ctx)

  test("dates: final before start, milestone before start, undated milestone", () => {
    const base = STRUCTURED_ANSWERS["E13.Q04"]
    expect(issuesFor("E13.Q04", base)).toEqual([])
    expect(issuesFor("E13.Q04", { ...base, finalDate: "2026-10-31" })).toEqual([
      "The final target date cannot be before the start date.",
    ])
    expect(issuesFor("E13.Q04", { ...base, milestones: "2026-10-20 -- Kickoff" })).toHaveLength(1)
    expect(issuesFor("E13.Q04", { ...base, milestones: "Kickoff soon" })).toHaveLength(1)
    expect(issuesFor("E13.Q04", { ...base, milestones: "No interim milestones" })).toEqual([])
    expect(issuesFor("E13.Q04", { milestones: "No interim milestones" })).toEqual([
      "Work may start is required.",
      "Final target date is required.",
    ])
  })

  test("amounts: hard cap below planned spend, negative or non-numeric amounts, missing currency", () => {
    const base = STRUCTURED_ANSWERS["E09.Q05"]
    expect(issuesFor("E09.Q05", base)).toEqual([])
    expect(issuesFor("E09.Q05", { ...base, hardCap: "20000" })).toEqual([
      "The hard spending limit cannot be lower than the planned spend.",
    ])
    expect(issuesFor("E09.Q05", { ...base, amount: "-5" })).toContain("Planned spend must be a non-negative number.")
    expect(issuesFor("E09.Q05", { ...base, currency: "TAKA" })).toHaveLength(1)
    const noCurrency = Object.fromEntries(Object.entries(base).filter(([id]) => id !== "currency"))
    expect(issuesFor("E09.Q05", noCurrency)).toEqual(["Currency is required."])
    expect(issuesFor("E09.Q05", { status: "Undecided" })).toEqual([])
  })

  test("URLs must be real web addresses", () => {
    const base = STRUCTURED_ANSWERS["E07.Q01"]
    expect(issuesFor("E07.Q01", { ...base, url: "veraspa.com.bd" })).toEqual([])
    expect(issuesFor("E07.Q01", { ...base, url: "not a url" })).toHaveLength(1)
    expect(issuesFor("E07.Q01", { ...base, url: "ftp://example.com" })).toHaveLength(1)
    expect(issuesFor("E07.Q01", { status: "Live", ownership: "Owned by the business" })).toEqual(["URL or domain is required."])
    expect(issuesFor("E07.Q01", { status: "Planned" })).toEqual([])
  })

  test("choices: primary language, exclusive None, counts, required options, draft-only values", () => {
    expect(issuesFor("E01.Q07", { languages: ["English"], primary: "Bangla" })).toEqual([
      "The primary language must be one of the selected customer languages.",
    ])
    expect(issuesFor("E12.Q07", { categories: ["None", "Health"], constraints: "x" })).toHaveLength(1)
    expect(issuesFor("E12.Q07", { categories: ["None"] })).toEqual([])
    expect(issuesFor("E12.Q07", { categories: ["Finance"] })).toEqual(["Project-specific constraints is required."])
    expect(issuesFor("E04.Q03", { traits: ["Calm", "Warm"] })).toEqual(["Traits: choose at least 3."])
    expect(issuesFor("E14.Q01", { levels: ["Project"], allocationRule: "One client, one project." })).toEqual([
      'Levels: "Business/client" must be included.',
    ])
    expect(issuesFor("E13.Q02", { ...STRUCTURED_ANSWERS["E13.Q02"], excluded: "No exclusions identified yet" })).toHaveLength(1)
    expect(issuesFor("E01.Q03", { type: "Other" })).toEqual(["Custom label is required."])
    expect(issuesFor("E01.Q09", { answer: "Yes" })).toEqual(["What is unconfirmed is required."])
  })

  test("unknown capacity is allowed only before launch", () => {
    const unknown = { limitType: "Unknown", notes: "New service, no history yet." }
    expect(answerIssues(q("E02.Q06"), unknown, ctxWith({ "E01.Q04": "Operating" }))).toEqual([
      "Unknown capacity is only allowed before launch (see E01.Q04).",
    ])
    expect(answerIssues(q("E02.Q06"), unknown, ctxWith({ "E01.Q04": "Idea/pre-launch" }))).toEqual([])
  })

  test("text length bounds from the draft", () => {
    expect(issuesFor("E01.Q01", "V")).toEqual(["Answer must be at least 2 characters."])
    expect(issuesFor("E05.Q07", "Too short.")).toEqual(["Answer must be at least 15 characters."])
    expect(issuesFor("E02.Q05", "x".repeat(1001))).toEqual(["Answer must be at most 1000 characters."])
  })
})

test.describe("readiness", () => {
  test("a full valid answer set is complete with 127 required questions", () => {
    const r = computeReadiness(fullAnswers(), "FULL_DIGITAL_MARKETING")
    expect(r.problems.map((p) => `${p.question.key}: ${p.issues.join("; ")}`)).toEqual([])
    expect(r.totalRequired).toBe(127)
    expect(r.completed).toBe(127)
    expect(r.notApplicable).toEqual([])
    expect(r.isComplete).toBe(true)
  })

  test("NOT_APPLICABLE never satisfies a required question", () => {
    const answers = fullAnswers().map((a) =>
      a.question_key === "E13.Q04" ? { question_key: "E13.Q04", status: "NOT_APPLICABLE" as const, value: null } : a
    )
    const r = computeReadiness(answers, "FULL_DIGITAL_MARKETING")
    expect(r.isComplete).toBe(false)
    expect(r.problems.map((p) => p.question.key)).toEqual(["E13.Q04"])
  })

  test("malformed stored values never pass readiness (shape is re-checked, not trusted)", () => {
    // Values that can't come through saveAnswerAction but can be stored by a
    // direct RPC call: each must be reported, and the set must not be complete.
    const malformed: Record<string, unknown> = {
      "E01.Q04": "Bankrupt", // not an option
      "E13.Q04": { startDate: "2026-02-30", finalDate: "2026-13-01", milestones: "No interim milestones" }, // impossible dates
      "E07.Q01": { status: "Live", url: "https://example.com", ownership: "Owned by the business", password: "x" }, // unknown field
      "E04.Q03": { traits: ["Calm", "Grumpy", "Warm"] }, // option not in list
      "E01.Q05": "Bangladesh", // text where a structured answer is required
      "E01.Q01": 42, // not text
      "E09.Q05": { status: "Approved budget", amount: 30000 }, // number instead of text field value
    }
    for (const [key, value] of Object.entries(malformed)) {
      const answers = fullAnswers().map((a) =>
        a.question_key === key ? { question_key: key, status: "ANSWERED" as const, value: value as AnswerRecord["value"] } : a
      )
      const r = computeReadiness(answers, "FULL_DIGITAL_MARKETING")
      expect(r.isComplete, key).toBe(false)
      const problem = r.problems.find((p) => p.question.key === key)
      expect(problem?.issues[0], key).toMatch(/^Stored answer is not valid for this question: /)
    }
  })

  test("an invalid answer blocks completion even on an optional question", () => {
    const r = computeReadiness(fullAnswers({ "E01.Q02": "X" }), "FULL_DIGITAL_MARKETING")
    expect(r.problems.map((p) => p.question.key)).toEqual(["E01.Q02"])
    expect(r.totalRequired).toBe(127)
  })

  test("questions excluded by conditions drop out of the required count", () => {
    const r = computeReadiness(
      fullAnswers({
        "E09.Q01": { status: "Out of scope" },
        "E08.Q01": { status: "Social not in scope" },
      }),
      "FULL_DIGITAL_MARKETING"
    )
    expect(r.isComplete).toBe(true)
    expect(r.notApplicable.map((x) => x.key)).toEqual([
      "E08.Q02", "E08.Q03", "E08.Q04", "E08.Q05", "E08.Q06", "E08.Q07", "E08.Q08",
      "E09.Q02", "E09.Q03", "E09.Q04", "E09.Q05", "E09.Q06", "E09.Q07", "E09.Q08", "E09.Q09", "E09.Q10",
    ])
    expect(r.totalRequired).toBe(127 - 16)
  })

  test("a newly required question after a controller change blocks completion", () => {
    const answers = fullAnswers({ "E09.Q01": { status: "Out of scope" }, "E09.Q05": null })
    expect(computeReadiness(answers, "FULL_DIGITAL_MARKETING").isComplete).toBe(true)
    const nowRunning = answers.map((a) => (a.question_key === "E09.Q01" ? answered("E09.Q01", { status: "Running" }) : a))
    const r = computeReadiness(nowRunning, "FULL_DIGITAL_MARKETING")
    expect(r.problems.map((p) => p.question.key)).toEqual(["E09.Q05"])
  })
})

test.describe("export rendering", () => {
  const project = {
    id: "p",
    project_name: "Synthetic",
    project_type: "FULL_DIGITAL_MARKETING",
    custom_type_label: null,
    default_currency: "BDT",
    export_language: "en",
    readiness_status: "APPROVED",
  }
  const clientBusiness = { display_name: "Synthetic client", record_type: "EXTERNAL_CLIENT", country: "Bangladesh" }

  test("structured answers render readably and deterministically", () => {
    expect(formatAnswerValue(q("E07.Q01"), STRUCTURED_ANSWERS["E07.Q01"])).toBe(
      "- Website status: Live\n- URL or domain: https://example.com/vera\n- Ownership: Owned by the business"
    )
    expect(formatAnswerValue(q("E01.Q05"), { country: "BD" })).toBe("- Primary country: Bangladesh (BD)")
  })

  test("answers to questions excluded by a condition are not exported", () => {
    const answers = fullAnswers({
      "E07.Q01": { status: "Not needed" },
      "E07.Q02": "STALE-WEBSITE-ACTION-CANARY",
    })
    const md = generateProjectContextMarkdown({
      project,
      clientBusiness,
      answers,
      generatedAtIso: "2026-10-07T00:00:00.000Z",
      exportVersion: "v01",
    })
    expect(md).toContain("- Website status: Not needed")
    expect(md).not.toContain("STALE-WEBSITE-ACTION-CANARY")
    expect(md).not.toContain("What should visitors do on the website?")
  })
})
