"use client"

import { useActionState, useState } from "react"
import Link from "next/link"

import {
  createLeadAction,
  type CreateLeadState,
} from "@/app/(app)/leads/actions"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const initialState: CreateLeadState = null

export function LeadForm() {
  const [state, formAction, isPending] = useActionState(createLeadAction, initialState)
  const [force, setForce] = useState(false)

  if (state?.duplicates && state.duplicates.length > 0 && !force) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Possible duplicate</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            The phone or email you entered matches an existing lead. Review it
            before creating a new record.
          </p>
          <ul className="flex flex-col gap-1">
            {state.duplicates.map((d) => (
              <li key={d.id} className="text-sm">
                <Link href={`/leads/${d.id}`} className="underline">
                  {d.name}
                </Link>{" "}
                &middot; {d.stage}
              </li>
            ))}
          </ul>
          <Button type="button" variant="outline" onClick={() => setForce(true)}>
            Create a new lead anyway
          </Button>
        </CardContent>
      </Card>
    )
  }

  const defaults = state?.submitted

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {force ? <input type="hidden" name="force" value="true" /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="name">Name *</Label>
          <Input id="name" name="name" defaultValue={defaults?.name} required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="businessName">Business name</Label>
          <Input id="businessName" name="businessName" defaultValue={defaults?.businessName} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="source">Source</Label>
          <Input
            id="source"
            name="source"
            placeholder="Facebook, referral, ..."
            defaultValue={defaults?.source}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="phone">Phone / WhatsApp</Label>
          <Input id="phone" name="phone" defaultValue={defaults?.phone} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" defaultValue={defaults?.email} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="serviceNeeded">Service needed</Label>
          <Input id="serviceNeeded" name="serviceNeeded" defaultValue={defaults?.serviceNeeded} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="budget">Budget</Label>
          <Input id="budget" name="budget" defaultValue={defaults?.budget} />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="consent" required className="size-4" />
        This person consented to be contacted about their inquiry. *
      </label>

      {state?.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}

      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving..." : "Create lead"}
        </Button>
      </div>
    </form>
  )
}
