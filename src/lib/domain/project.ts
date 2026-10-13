import { z } from "zod"

import { PROJECT_TYPES, type ProjectLifecycleStatus } from "@/lib/domain/enums"
import type { createClient } from "@/lib/supabase/server"

/**
 * project_answers/project_exports rows also carry workspace_id (owned by
 * a DB trigger that derives it from the project, ignoring whatever the
 * client sends -- see their migrations). TypeScript still requires the
 * field in the Insert type because the column has no DB-level default it
 * can see, so callers fetch the real value here rather than passing a
 * meaningless placeholder just to satisfy the type.
 */
export async function getProjectWorkspaceId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("projects")
    .select("workspace_id")
    .eq("id", projectId)
    .maybeSingle()
  return data?.workspace_id ?? null
}

/**
 * Field-level rules matching BUILD_READINESS_QUESTIONNAIRE.md section D
 * and the projects migration's CHECK constraints. The client/business is
 * chosen once, at creation (B05: a project cannot be transferred), and the
 * lifecycle status is not a form field: a project starts ACTIVE and moves
 * only along PROJECT_LIFECYCLE_TRANSITIONS (set_project_lifecycle /
 * restore_project, migration 20261008100000).
 */
export const projectDetailsSchema = z
  .object({
    projectName: z.string().trim().min(1, "Project name is required.").max(200),
    projectType: z.enum(PROJECT_TYPES),
    customTypeLabel: z.string().trim().max(200).optional().or(z.literal("")),
    defaultCurrency: z
      .string()
      .trim()
      .length(3, "Use a 3-letter currency code, e.g. BDT.")
      .transform((v) => v.toUpperCase()),
    exportLanguage: z.string().trim().min(2).max(10),
    timezone: z.string().trim().min(1, "Timezone is required."),

    startDate: z.string().trim().optional().or(z.literal("")),
    targetCompletionDate: z.string().trim().optional().or(z.literal("")),
    shortDescription: z.string().trim().max(1000).optional().or(z.literal("")),
    internalNotes: z.string().trim().max(5000).optional().or(z.literal("")),
    tags: z.string().trim().max(500).optional().or(z.literal("")),
  })
  .refine((v) => v.projectType !== "CUSTOM" || v.customTypeLabel, {
    message: "Custom project type requires a label.",
    path: ["customTypeLabel"],
  })
  .refine(
    (v) =>
      !v.startDate ||
      !v.targetCompletionDate ||
      v.targetCompletionDate >= v.startDate,
    {
      message: "Target completion date can't be before the start date.",
      path: ["targetCompletionDate"],
    }
  )

export const projectCreateSchema = z
  .object({ clientBusinessId: z.uuid("Choose a client/business.") })
  .and(projectDetailsSchema)

export type ProjectDetailsInput = z.infer<typeof projectDetailsSchema>

/**
 * Allowed lifecycle moves, mirroring
 * private.project_lifecycle_transition_allowed in
 * supabase/migrations/20261008100000_lifecycle_archive_delete_rules.sql
 * (the database is the enforcer; this drives which buttons are shown).
 * ARCHIVED leaves only through restore_project, back to the status it had
 * when it was archived.
 */
export const PROJECT_LIFECYCLE_TRANSITIONS: Record<
  Exclude<ProjectLifecycleStatus, "ARCHIVED">,
  ProjectLifecycleStatus[]
> = {
  ACTIVE: ["ON_HOLD", "COMPLETED", "ARCHIVED"],
  ON_HOLD: ["ACTIVE", "COMPLETED", "ARCHIVED"],
  COMPLETED: ["ACTIVE", "ARCHIVED"],
}

/** Permanent deletion becomes possible this many days after archiving. */
export const PERMANENT_DELETE_AFTER_DAYS = 30

export function parseTags(tags: string | undefined): string[] {
  if (!tags) return []
  return tags
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
}

/** When an archived record becomes eligible for permanent deletion (the database re-checks). */
export function deletionEligibility(archivedAtIso: string): { eligibleOn: string; eligibleNow: boolean } {
  const eligibleAt = new Date(new Date(archivedAtIso).getTime() + PERMANENT_DELETE_AFTER_DAYS * 86_400_000)
  return { eligibleOn: eligibleAt.toISOString().slice(0, 10), eligibleNow: eligibleAt.getTime() <= Date.now() }
}
