"use client"

import { useActionState, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import {
  addEvidenceItemAction,
  finalizeEvidenceUploadAction,
  prepareEvidenceUploadAction,
} from "@/app/(app)/projects/[id]/evidence/actions"
import { EVIDENCE_CATEGORIES, EVIDENCE_STATUSES } from "@/lib/domain/enums"
import { ACCEPT_ATTRIBUTE, MAX_ATTACHMENT_LABEL, checkUploadRequest } from "@/lib/evidence/attachments"
import { createClient } from "@/lib/supabase/client"
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

type Mode = "link" | "file"

function SharedFields() {
  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor="category">Category *</Label>
        <Select name="category" defaultValue="evidence">
          <SelectTrigger id="category" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EVIDENCE_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="verificationStatus">Verification *</Label>
        <Select name="verificationStatus" defaultValue="OWNER_REPORTED">
          <SelectTrigger id="verificationStatus" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EVIDENCE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  )
}

function TrailingFields() {
  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor="evidenceDate">Evidence date</Label>
        <Input id="evidenceDate" name="evidenceDate" type="date" />
      </div>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" rows={2} />
      </div>
    </>
  )
}

function LinkForm({ projectId }: { projectId: string }) {
  const action = addEvidenceItemAction.bind(null, projectId)
  const [state, formAction, isPending] = useActionState(action, null)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <SharedFields />
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="externalUrl">Link (Drive, screenshot, report) *</Label>
          <Input id="externalUrl" name="externalUrl" type="url" required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="originalFilename">Original filename</Label>
          <Input id="originalFilename" name="originalFilename" />
        </div>
        <TrailingFields />
      </div>
      {state?.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving..." : "Add evidence"}
        </Button>
      </div>
    </form>
  )
}

function FileForm({ projectId }: { projectId: string }) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const file = form.get("file")
    setError(null)
    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a file.")
      return
    }
    const check = checkUploadRequest(file.name, file.size)
    if (!check.ok) {
      setError(check.error)
      return
    }
    startTransition(async () => {
      try {
        setStatus("Preparing upload...")
        const prepared = await prepareEvidenceUploadAction(projectId, file.name, file.size)
        if (prepared.error !== null) {
          setError(prepared.error)
          return
        }
        setStatus("Uploading...")
        const { error: uploadError } = await createClient()
          .storage.from("evidence")
          .uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: prepared.contentType })
        if (uploadError) {
          setError("The upload failed. Check your connection and try again.")
          return
        }
        setStatus("Checking the file...")
        const result = await finalizeEvidenceUploadAction(projectId, prepared.uploadId, {
          category: String(form.get("category") ?? ""),
          verificationStatus: String(form.get("verificationStatus") ?? ""),
          evidenceDate: String(form.get("evidenceDate") ?? ""),
          notes: String(form.get("notes") ?? ""),
        })
        if (result.error) {
          setError(result.error)
          return
        }
        formRef.current?.reset()
        router.refresh()
      } catch {
        setError("Could not reach the server. Try again.")
      } finally {
        setStatus(null)
      }
    })
  }

  return (
    <form ref={formRef} onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <SharedFields />
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="file">File *</Label>
          <Input id="file" name="file" type="file" accept={ACCEPT_ATTRIBUTE} required />
          <p className="text-xs text-muted-foreground">
            PDF, DOCX, XLSX, CSV, PNG, JPG, WEBP or MP4, up to {MAX_ATTACHMENT_LABEL}. Larger files: store them in
            Drive and add the link. Never attach passwords, codes, keys, payment or identity documents.
          </p>
        </div>
        <TrailingFields />
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Uploading..." : "Upload file"}
        </Button>
        {status ? <span className="text-sm text-muted-foreground">{status}</span> : null}
      </div>
    </form>
  )
}

export function EvidenceForm({ projectId }: { projectId: string }) {
  const [mode, setMode] = useState<Mode>("link")
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2" role="radiogroup" aria-label="Evidence type">
        {(["link", "file"] as const).map((m) => (
          <Button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            variant={mode === m ? "default" : "outline"}
            size="sm"
            onClick={() => setMode(m)}
          >
            {m === "link" ? "Link" : "File"}
          </Button>
        ))}
      </div>
      {mode === "link" ? <LinkForm projectId={projectId} /> : <FileForm projectId={projectId} />}
    </div>
  )
}
