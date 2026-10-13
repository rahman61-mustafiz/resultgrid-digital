"use client"

import { useActionState } from "react"

import type { ClientBusinessFormState } from "@/app/(app)/clients/actions"
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

export type ClientBusinessFormValues = {
  displayName: string
  recordType: "OWNED_BUSINESS" | "EXTERNAL_CLIENT"
  country: string
  timezone: string
  legalName: string
  website: string
  industry: string
  primaryContactName: string
  email: string
  phone: string
  address: string
  internalNotes: string
}

const initialState: ClientBusinessFormState = null

export function ClientBusinessForm({
  action,
  defaultValues,
  timezones,
  submitLabel,
}: {
  action: (
    prevState: ClientBusinessFormState,
    formData: FormData
  ) => Promise<ClientBusinessFormState>
  defaultValues?: Partial<ClientBusinessFormValues>
  timezones: string[]
  submitLabel: string
}) {
  const [state, formAction, isPending] = useActionState(action, initialState)

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="displayName">Display name *</Label>
          <Input
            id="displayName"
            name="displayName"
            defaultValue={defaultValues?.displayName}
            required
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="recordType">Type *</Label>
          <Select
            name="recordType"
            defaultValue={defaultValues?.recordType ?? "EXTERNAL_CLIENT"}
          >
            <SelectTrigger id="recordType" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="OWNED_BUSINESS">Owned business</SelectItem>
              <SelectItem value="EXTERNAL_CLIENT">External client</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="country">Country *</Label>
          <Input
            id="country"
            name="country"
            defaultValue={defaultValues?.country}
            placeholder="Bangladesh"
            required
          />
        </div>

        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="timezone">Timezone *</Label>
          <Select name="timezone" defaultValue={defaultValues?.timezone ?? "Asia/Dhaka"}>
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
          <Label htmlFor="legalName">Legal name</Label>
          <Input
            id="legalName"
            name="legalName"
            defaultValue={defaultValues?.legalName}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="website">Website</Label>
          <Input
            id="website"
            name="website"
            type="url"
            placeholder="https://example.com"
            defaultValue={defaultValues?.website}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="industry">Industry</Label>
          <Input
            id="industry"
            name="industry"
            defaultValue={defaultValues?.industry}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="primaryContactName">Primary contact name</Label>
          <Input
            id="primaryContactName"
            name="primaryContactName"
            defaultValue={defaultValues?.primaryContactName}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={defaultValues?.email}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="phone">Phone / WhatsApp</Label>
          <Input id="phone" name="phone" defaultValue={defaultValues?.phone} />
        </div>

        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="address">Address</Label>
          <Textarea
            id="address"
            name="address"
            defaultValue={defaultValues?.address}
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
