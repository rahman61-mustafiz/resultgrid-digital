# Priority 9 independent review — 9 October 2026

Decision: not accepted yet. Fix the validation and retained-file deletion paths before marking Priority 9 complete. Priority 10 planning can proceed, but this review does not confirm the lifecycle matrix on the user's behalf.

## High: direct authenticated RPC bypasses byte verification and hash computation

`supabase/migrations/20261009150000_evidence_attachments_retention.sql:222` exposes `add_evidence_attachment` to authenticated users. It checks ownership, path prefix and Storage metadata, but Storage's MIME metadata comes from the upload request. It accepts the supplied SHA-256 if it has the correct shape. It never establishes that the server inspected these bytes.

Independent live reproduction: upload PNG bytes under a `.pdf` path with declared `application/pdf`, then call the RPC as the fixture Owner with a `.pdf` original filename, matching size, and 64 zeroes for SHA-256. The row was accepted. Thus both the type and exported fingerprint can be false despite the real form's validation passing.

Require a trusted server validation result bound to the object, project, actual hash, size and type. Ordinary authenticated callers must not be able to forge that result or invoke the recording operation without it. Preserve authorization and transactional lifecycle/approval checks.

## High: finalization failures can delete already recorded or retained files

Code review finding, not a browser reproduction: `src/app/(app)/projects/[id]/evidence/actions.ts:119-177` creates an admin deletion helper for the caller-supplied path. A matching UUID path is its only early path gate. Invalid fields, filename mismatch, failed verification or an RPC error all invoke that helper. There is no check that this path is an outstanding upload owned by the caller or that it is absent from existing evidence.

A replay of a successful finalization reaches the duplicate-path RPC error and then deletes the existing file. Supplying invalid fields with an existing path reaches deletion even earlier, including for evidence kept after export. Database retention triggers do not protect Storage API deletion. `assertEditingAllowed` only checks the mobile device rule; it does not authorize this object.

Bind finalize/discard to a server-recorded pending upload and authorized project. Repeated finalization should be idempotent. Never discard a path referenced by an evidence row, including removed evidence. Add real action tests for replay and forged existing paths.

## Medium: archive/restore reason is optional in the actual backend

Live reproduction: `set_export_archived` accepted a whitespace-only archive reason. The RPC defaults the reason to null and inserts a nullable reason without rejecting it; the Server Action also has no reason validation. Both archive and restore need a nonblank reason if the claimed behavior is the requirement. Add backend regression checks, not only form requiredness.

## Medium: successful deletion does not guarantee file deletion

`removeEvidenceItemAction` deletes the row first, then only logs a Storage deletion failure and returns success. `deleteProjectPermanentlyAction` similarly only logs failure and redirects; it also ignores errors when initially listing paths. A direct call to the project-deletion RPC does not execute the app's Storage cleanup. These are additional orphan paths beyond closing the upload tab. Use a durable cleanup queue/outbox with retries and observable failures; fail the operation on a failed path lookup.

## Verified behavior and limits

- Independent unit run: 42/42; typecheck and lint passed. The first sandbox unit attempt hit spawn EPERM; the permitted rerun passed.
- Independent evidence integration run: all original 47 checks passed, plus two added checks failed as described above. Log: `.qa-priority9-independent.log`; reproducible probe: `scripts/qa-priority9-independent.mjs`.
- Original live checks cover bucket privacy/type/size settings, blocked direct reads/listing/deletion, metadata mismatch rejection, evidence retention, removed-row immutability, export-evidence recording, append-only export events and archived-project upload preparation.
- This run's QA clients, projects, evidence rows and files, exports, membership, MFA factor and auth user were reported removed by the script's cleanup verification. This is scoped cleanup, not independent proof that the entire bucket is empty. The cleanup helper disables user triggers inside a transaction with exclusive table locks; it does not leave the guards disabled for concurrent sessions.
- Reviewed download authorization through session RLS and the 60-second signed URL, stored context download, manifest-backed package naming and evidence metadata rendering. Full browser, ledger, Vera and lifecycle suites were not rerun in this review; their reported totals remain builder evidence.
- Signature validation is deliberately limited: CSV examines only the first 64 KiB for UTF-8/no NUL; MP4 accepts any `ftyp` header without checking the brand. DOCX/XLSX only require their named ZIP part. Avoid claiming comprehensive format validity. No malware scan or duration enforcement exists.
- A 25 MiB limit (26,214,400 bytes, labelled 25 MB) is a reasonable proposed default, pending the user's decision. It is not approved by this review.
- Lifecycle matrix remains a user decision. The existing document's attribution of acceptance should not be treated as confirmed when the current handoff says it is still pending.
- Spec J deletion requests and Priority 10 navigation remain outstanding. No application code or migration was changed, committed or deployed by this review.
