"use client"

import { useActionState, useState } from "react"

import type { ProjectFormState } from "@/app/(app)/projects/actions"
import { PROJECT_TYPE_LABELS } from "@/lib/domain/project-labels"
import { PROJECT_TYPES } from "@/lib/domain/enums"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export type ProjectFormValues = {
  clientBusinessId: string
  projectName: string
  projectType: (typeof PROJECT_TYPES)[number]
  customTypeLabel: string
  defaultCurrency: string
  exportLanguage: string
  timezone: string
  startDate: string
  targetCompletionDate: string
  shortDescription: string
  internalNotes: string
  tags: string
}

const initialState: ProjectFormState = null

export function ProjectForm({
  action,
  defaultValues,
  clients,
  timezones,
  submitLabel,
  lockedClientName,
}: {
  action: (
    prevState: ProjectFormState,
    formData: FormData
  ) => Promise<ProjectFormState>
  defaultValues?: Partial<ProjectFormValues>
  clients: { id: string; display_name: string }[]
  timezones: string[]
  submitLabel: string
  /** Edit mode: the project's client, shown read-only (B05 -- no transfer). */
  lockedClientName?: string
}) {
  const [state, formAction, isPending] = useActionState(action, initialState)
  const [projectType, setProjectType] = useState(
    defaultValues?.projectType ?? "FULL_DIGITAL_MARKETING"
  )

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="projectName">Project name *</Label>
          <Input
            id="projectName"
            name="projectName"
            defaultValue={defaultValues?.projectName}
            required
          />
        </div>

        {lockedClientName !== undefined ? (
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label>Client/business</Label>
            <p className="text-sm" data-testid="locked-client">{lockedClientName}</p>
            <p className="text-xs text-muted-foreground">
              A project can&apos;t be moved to another client/business. If it was created under the
              wrong one, archive it and create it again under the right one.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="clientBusinessId">Client/business *</Label>
            <Select
              name="clientBusinessId"
              defaultValue={defaultValues?.clientBusinessId}
            >
              <SelectTrigger id="clientBusinessId" className="w-full">
                <SelectValue placeholder="Choose a client/business" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
  
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="projectType">Project type *</Label>
          <Select
            name="projectType"
            defaultValue={projectType}
            onValueChange={(v) => setProjectType(v as typeof projectType)}
          >
            <SelectTrigger id="projectType" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROJECT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {PROJECT_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {projectType === "CUSTOM" ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="customTypeLabel">Custom type label *</Label>
            <Input
              id="customTypeLabel"
              name="customTypeLabel"
              defaultValue={defaultValues?.customTypeLabel}
              required
            />
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <Label htmlFor="defaultCurrency">Currency *</Label>
          <Input
            id="defaultCurrency"
            name="defaultCurrency"
            placeholder="BDT"
            maxLength={3}
            defaultValue={defaultValues?.defaultCurrency}
            required
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="exportLanguage">Context-export language *</Label>
          <Input
            id="exportLanguage"
            name="exportLanguage"
            placeholder="en"
            defaultValue={defaultValues?.exportLanguage ?? "en"}
            required
          />
        </div>

        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="timezone">Timezone *</Label>
          <Select
            name="timezone"
            defaultValue={defaultValues?.timezone ?? "Asia/Dhaka"}
          >
            <SelectTrigger id="timezone" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {timezones.map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="startDate">Start date</Label>
          <Input
            id="startDate"
            name="startDate"
            type="date"
            defaultValue={defaultValues?.startDate}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="targetCompletionDate">Target completion date</Label>
          <Input
            id="targetCompletionDate"
            name="targetCompletionDate"
            type="date"
            defaultValue={defaultValues?.targetCompletionDate}
          />
        </div>

        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="tags">Tags (comma-separated)</Label>
          <Input id="tags" name="tags" defaultValue={defaultValues?.tags} />
        </div>

        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="shortDescription">Short description</Label>
          <Textarea
            id="shortDescription"
            name="shortDescription"
            defaultValue={defaultValues?.shortDescription}
          />
        </div>

        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="internalNotes">Internal notes</Label>
          <Textarea
            id="internalNotes"
            name="internalNotes"
            defaultValue={defaultValues?.internalNotes}
          />
          <p className="text-xs text-muted-foreground">
            Owner-only. Never included in client-facing reports or AI exports.
          </p>
        </div>
      </div>

      {state?.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}

      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving..." : submitLabel}
        </Button>
      </div>
    </form>
  )
}
