# Marketing OS — Build Readiness Questionnaire

## Status

- Discovery status: **READY FOR FINAL PRE-BUILD REVIEW**
- Build authorization: **NOT REQUESTED**
- Application build work: **NOT STARTED**
- Rule: Build work may begin only after every applicable required item is answered, contradictions are resolved, and Rana reviews the final specification.

This document tracks the information needed before implementation. `Required` means the decision must be recorded before build begins. `Optional` may remain unanswered and will be labelled as such.

All applicable foundational required decisions are now confirmed. Remaining open values are either optional, intentionally guarded by a future approval, or must be supplied per client/project before that project can be approved; they do not block building the MVP framework.

## How answers are recorded

Each decision will eventually have:

- stable ID
- current answer
- status: `MISSING`, `PROPOSED`, `CONFIRMED`, or `NOT_APPLICABLE`
- decision owner
- rationale or evidence when relevant
- date confirmed

No assistant may convert a proposed answer into a confirmed answer without Rana's approval.

## A. Product foundation

| ID | Requirement | Priority | Status |
|---|---|---|---|
| A01 | Final product name | Required | CONFIRMED |
| A02 | One-sentence purpose | Required | CONFIRMED |
| A03 | Who will use the first release | Required | CONFIRMED |
| A04 | Is the first release for one business, multiple businesses owned by Rana, or external clients | Required | CONFIRMED |
| A05 | Primary language of the interface | Required | CONFIRMED |
| A06 | Language of generated context files | Required | CONFIRMED |
| A07 | Desktop and mobile expectations | Required | CONFIRMED |
| A08 | Definition of a successful MVP | Required | CONFIRMED |
| A09 | Product logo/name/brand styling | Optional | MISSING |

### Recorded product-foundation answers

| ID | Answer | Status | Confirmed by |
|---|---|---|---|
| A01 | `ResultGrid Digital` | CONFIRMED | Rana, 21 September 2026 |
| A02 | It will help Rana and his team build digital workflows for clients. | CONFIRMED | Rana, 21 September 2026 |
| A03 | Rana will be the only user of the first release. | CONFIRMED | Rana, 21 September 2026 |
| A04 | The first release will manage multiple businesses owned by Rana plus one external client. | CONFIRMED | Rana, 21 September 2026 |
| A05 | English only. | CONFIRMED | Rana, 21 September 2026 |
| A06 | Context-export language will be selectable per project. | CONFIRMED | Rana, 21 September 2026 |
| A07 | Desktop is the primary working interface. Mobile is view-only for the first release, with no editing. | CONFIRMED | Rana, 21 September 2026 |
| A08 | The MVP is usable when Rana can select a business/client and date range, then view its digital operating cost, marketing spend, recorded revenue/results, calculated profit or loss, and target-versus-actual progress in one place and export it as a Markdown report. | CONFIRMED | Rana, 21 September 2026 |

The product cannot guarantee that a client becomes profitable. The system can make profitability and progress measurable when the required cost, revenue, attribution, and result data are available. The exact calculation boundary is tracked in Section M.

## B. Workspace and tenancy

| ID | Requirement | Priority | Status |
|---|---|---|---|
| B01 | Can one account belong to multiple workspaces | Required | CONFIRMED |
| B02 | Can one workspace contain multiple clients | Required | CONFIRMED |
| B03 | Can a client belong to more than one workspace | Required | CONFIRMED |
| B04 | Can one client contain multiple projects | Required | CONFIRMED |
| B05 | Can a project move between clients | Required | CONFIRMED |
| B06 | Archive and restore rules for clients/projects | Required | CONFIRMED |
| B07 | Hard-delete policy | Required | CONFIRMED |
| B08 | Default timezone and per-workspace timezone behavior | Required | CONFIRMED |
| B09 | Currency behavior | Required | CONFIRMED |

### Recorded workspace and tenancy decisions

| ID | Decision | Confirmed by |
|---|---|---|
| B01 | The first release uses one personal workspace for Rana. Multiple workspaces are outside the first-release scope. | Rana, 21 September 2026 |
| B02 | The workspace may contain multiple owned businesses and external clients. Both use the same `Client/Business` record type with a category that distinguishes them. | Rana, 21 September 2026 |
| B03 | A client/business belongs to exactly one workspace. | Rana, 21 September 2026 |
| B04 | A client/business may contain multiple projects. | Rana, 21 September 2026 |
| B05 | A project belongs to exactly one client/business and cannot be transferred. An incorrect project is archived and recreated under the correct parent. | Rana, 21 September 2026 |
| B06 | Clients/businesses and projects support archive and restore. Archived parents cannot receive new active work until restored. | Rana, 21 September 2026 |
| B07 | Permanent deletion is restricted to the Owner and requires an explicit destructive-action confirmation. Related-data behavior will be specified before schema approval. | Rana, 21 September 2026 |
| B08 | Workspace default timezone is `Asia/Dhaka`. Stored timestamps use UTC and are displayed in the workspace timezone. | Rana, 21 September 2026 |
| B09 | Currency is selected per project. Financial records inherit the project currency unless an explicitly supported multi-currency rule is approved later. | Rana, 21 September 2026 |

## C. Authentication and roles

| ID | Requirement | Priority | Status |
|---|---|---|---|
| C01 | Login method: email/password, magic link, Google, or a selected combination | Required | CONFIRMED |
| C02 | Who may create a workspace | Required | CONFIRMED |
| C03 | Who may invite members | Required | CONFIRMED |
| C04 | Confirm Owner permissions | Required | CONFIRMED |
| C05 | Confirm Editor permissions | Required | NOT_APPLICABLE |
| C06 | Confirm Viewer permissions | Required | NOT_APPLICABLE |
| C07 | Confirm Client Read-only permissions | Required | NOT_APPLICABLE |
| C08 | Can an Editor approve a project | Required | NOT_APPLICABLE |
| C09 | Can a client see questionnaire answers | Required | NOT_APPLICABLE |
| C10 | Can a client download approved exports | Required | NOT_APPLICABLE |
| C11 | Member removal and ownership-transfer rules | Required | NOT_APPLICABLE |

### Recorded authentication and access decisions

| ID | Decision | Status |
|---|---|---|
| C01 | Owner signs in with email and password, followed by mandatory TOTP 2FA through an authenticator app. Public signup, SMS login, and passwordless login are outside the first release. | CONFIRMED |
| C02 | The single pre-authorized Owner account creates and owns the one workspace. | CONFIRMED |
| C03 | Member invitation and additional active users are disabled in the first release. | CONFIRMED |
| C04 | Owner has all first-release operations: manage client/project/questionnaire data, approve, export, archive, restore, and explicitly confirm permanent deletion. | CONFIRMED |
| C05–C11 | Editor, Viewer, Client Read-only, invitations, client visibility, member removal, and ownership transfer remain future-ready concepts but have no active behavior in the single-user first release. They require fresh confirmation before being enabled. | NOT_APPLICABLE |

### Required 2FA security decisions

| ID | Requirement | Priority | Status |
|---|---|---|---|
| C12 | TOTP enrollment is mandatory before accessing workspace data | Required | CONFIRMED |
| C13 | Define recovery method if the authenticator device is lost | Required | CONFIRMED |
| C14 | Define recovery-code generation, display, storage, regeneration, and invalidation rules | Required | NOT_APPLICABLE |
| C15 | Define session duration and whether sensitive actions require recent re-authentication | Required | CONFIRMED |
| C16 | Define failed-login/2FA attempt throttling and lockout behavior | Required | CONFIRMED |
| C17 | Define security-event log and owner notifications | Required | CONFIRMED |

### Recorded 2FA recovery requirement

Status: **CONFIRMED by Rana on 21 September 2026**.

- Normal login requires email, password, and a verified TOTP factor from Google Authenticator or another compatible authenticator.
- Google Authenticator account sync may restore the factor on a new phone, but ResultGrid Digital must also provide a recovery path through the Owner's verified recovery email.
- Email recovery is a break-glass factor-replacement process. Email OTP/link is not treated as a completed Supabase MFA session and does not directly grant access to workspace data.
- A recovery request requires the correct account password, sends a short-lived single-use approval link or code to the pre-verified recovery email, and is rate-limited.
- Successful recovery revokes existing sessions and permits only the security setup flow.
- The Owner must enroll and verify a new TOTP factor. Workspace data remains inaccessible until the session reaches `AAL2` again.
- The recovery event, factor replacement, timestamp, and relevant security metadata are written to the security log, and the Owner receives notification.
- ResultGrid Digital will not create application recovery codes in the MVP. Supabase's current user MFA API supports multiple TOTP/phone factors but does not provide recovery codes; the chosen email recovery is therefore custom security-sensitive logic that requires dedicated tests and review.

### Recorded session and security-event rules

Status: **CONFIRMED by Rana on 21 September 2026**.

- An authenticated login session lasts no more than 8 hours.
- After 30 minutes without activity, the application locks and requires a valid TOTP challenge to unlock.
- Permanent deletion, password change, TOTP-factor change, and recovery-email change require password plus TOTP re-authentication within the preceding 5 minutes.
- Five failed password or TOTP attempts trigger a 15-minute login cooldown. Platform rate limits still apply independently.
- New-device login, password change, TOTP change, recovery request, successful recovery, and repeated failed attempts create security events and email alerts to the verified Owner address.
- Security alerts must not contain passwords, TOTP secrets, one-time codes, session tokens, or sensitive business data.

## D. Client and project records

| ID | Requirement | Priority | Status |
|---|---|---|---|
| D01 | Required client fields | Required | CONFIRMED |
| D02 | Optional client fields | Required | CONFIRMED |
| D03 | Required project fields | Required | CONFIRMED |
| D04 | Optional project fields | Required | CONFIRMED |
| D05 | Allowed project types | Required | CONFIRMED |
| D06 | Project status list and transition rules | Required | CONFIRMED |
| D07 | Who may approve a project | Required | CONFIRMED |
| D08 | What changes invalidate project approval | Required | CONFIRMED |
| D09 | Project numbering or naming convention | Optional | MISSING |
| D10 | Client/project tags or categories | Optional | MISSING |

### Recorded client/business and project fields

Status: **CONFIRMED by Rana on 21 September 2026**.

Client/Business required fields:

- display name
- record type: `OWNED_BUSINESS` or `EXTERNAL_CLIENT`
- status: `ACTIVE` or `ARCHIVED`
- country
- timezone

Client/Business optional fields:

- legal name
- website
- industry
- primary contact name
- email
- phone
- address
- logo
- internal notes

Project required fields:

- project name
- parent client/business ID
- project type
- status
- default currency
- context-export language
- timezone

Project optional fields:

- start date
- target completion date
- short description
- internal notes
- tags

Detailed business, brand, and marketing information belongs to the versioned questionnaire and is not duplicated in core client/project fields.

### Recorded project types, statuses, and approval rules

Status: **CONFIRMED by Rana on 21 September 2026**.

Allowed project types:

- `FULL_DIGITAL_MARKETING`
- `MARKETING_AUDIT_STRATEGY`
- `SEO`
- `SOCIAL_MEDIA`
- `PAID_ADVERTISING`
- `WEBSITE`
- `BRANDING_CREATIVE`
- `CUSTOM`; a custom type label is required when selected

Project lifecycle and questionnaire readiness are separate fields:

```text
Lifecycle: ACTIVE → ON_HOLD → COMPLETED → ARCHIVED
Readiness: INCOMPLETE → READY_FOR_REVIEW → APPROVED
```

- A new project begins as `ACTIVE + INCOMPLETE`.
- Allowed lifecycle moves (explicitly confirmed by Rana on 9 October 2026, replying "yes" to the proposed matrix): `ACTIVE` → `ON_HOLD`, `COMPLETED` or `ARCHIVED`; `ON_HOLD` → `ACTIVE`, `COMPLETED` or `ARCHIVED`; `COMPLETED` → `ACTIVE` (reopen; a reason is required) or `ARCHIVED`; `ARCHIVED` → restore to the status it had when archived. `ON_HOLD` is optional, not a mandatory step.
- Only the Owner may approve a project in the first release.
- Changing a questionnaire answer, required project field, currency, export language, or any other data included in the context export invalidates the current approval and moves readiness to `READY_FOR_REVIEW` if validation still passes, otherwise `INCOMPLETE`.
- Changing internal notes or tags does not invalidate approval because those fields are excluded from the approved context export.
- Prior approval records and exports remain immutable history.

## E. Questionnaire Version 1 content

Question count will follow actual need; there is no target number.

### Candidate sections to confirm

| ID | Section | Priority | Status |
|---|---|---|---|
| E01 | Business identity and locations | Required | CONFIRMED |
| E02 | Products/services and commercial priorities | Required | CONFIRMED |
| E03 | Target audience and geography | Required | CONFIRMED |
| E04 | Brand positioning, voice, and visual rules | Required | CONFIRMED |
| E05 | Competitors and differentiation | Required | CONFIRMED |
| E06 | Marketing goals and KPIs | Required | CONFIRMED |
| E07 | Current website, SEO, and local presence | Required | CONFIRMED |
| E08 | Social channels and content history | Conditional/nullable | CONFIRMED |
| E09 | Advertising accounts, access status, and budget | Conditional/nullable | CONFIRMED |
| E10 | Offer, conversion path, sales process, and follow-up | Required | CONFIRMED |
| E11 | Available assets, evidence, and reporting sources | Required | CONFIRMED |
| E12 | Legal, privacy, claim, and publishing constraints | Required | CONFIRMED |
| E13 | Project-specific scope, deadlines, and approval process | Required | CONFIRMED |
| E14 | Costs, revenue, attribution, profitability, and progress targets | Required | CONFIRMED |

### Recorded Questionnaire V1 section decision

Status: **CONFIRMED by Rana on 21 September 2026**.

- Questionnaire V1 contains sections E01–E14.
- Project type and earlier answers determine which detailed questions are applicable.
- Existing social channels/content history in E08 may be absent before work begins. Those detail fields are nullable and do not block completion when the project has no prior social activity.
- Existing advertising accounts/history in E09 may likewise be absent. Those detail fields are nullable and do not block completion when advertising has not started or does not apply.
- The system distinguishes `NOT_STARTED` or `NOT_APPLICABLE` from `UNANSWERED`. A legitimate absence is not reported as missing information.
- The final required/optional status is assigned per question during the Questionnaire V1 content-design pass; confirming a section does not make every field inside it required.

For every confirmed section, a separate question-definition table must be approved with:

- question key and wording
- answer type
- required/optional status
- conditional rule
- validation and error message
- evidence requirement
- sensitivity classification
- context-export destination

## F. Questionnaire behavior

| ID | Requirement | Priority | Status |
|---|---|---|---|
| F01 | One long form, section-by-section wizard, or both | Required | CONFIRMED |
| F02 | Manual draft save or automatic draft save | Required | CONFIRMED |
| F03 | Whether users may skip required questions temporarily | Required | CONFIRMED |
| F04 | How missing questions are presented | Required | CONFIRMED |
| F05 | Conditional-question behavior | Required | CONFIRMED |
| F06 | Evidence attachment/link behavior | Required | CONFIRMED |
| F07 | Sensitive-answer visibility | Required | CONFIRMED |
| F08 | Who may edit confirmed answers | Required | CONFIRMED |
| F09 | Whether answer changes require a reason | Required | CONFIRMED |
| F10 | Questionnaire-version migration behavior | Required | CONFIRMED |

### Recorded questionnaire behavior

Status: **CONFIRMED by Rana on 21 September 2026**.

- The primary interface is a section-by-section wizard with a full completion overview.
- Answers autosave as drafts.
- Required questions may be skipped temporarily, but completion, approval, and final export remain blocked.
- Missing or invalid items are grouped by section and linked to the exact question.
- Conditional questions appear or become required based on prior answers and project type.
- Evidence supports both URL links and file attachments.
- Sensitive answers are Owner-only and excluded from Markdown exports by default.
- The Owner may edit confirmed answers. Editing approved, export-relevant information requires a reason and invalidates approval.
- A published questionnaire version is immutable.
- Existing projects do not migrate automatically. The Owner explicitly starts an upgrade to a newer questionnaire version, reviews mapped answers, completes new requirements, and approves again.

## G. Review and approval

| ID | Requirement | Priority | Status |
|---|---|---|---|
| G01 | Readiness-review screen contents | Required | CONFIRMED |
| G02 | Approval actor and confirmation method | Required | CONFIRMED |
| G03 | Approval note requirement | Required | CONFIRMED |
| G04 | Which data changes invalidate approval | Required | CONFIRMED |
| G05 | Whether prior approvals remain visible | Required | CONFIRMED |
| G06 | Rejection/change-request behavior | Required | CONFIRMED |

### Recorded review and approval rules

Status: **CONFIRMED by Rana on 21 September 2026**.

- The readiness review shows completion percentage, missing/invalid answers linked to their questions, unresolved decisions, evidence status, sensitive-data warnings, and the exact export preview.
- Only Rana may grant final approval in the MVP. Approval is a sensitive action and requires password plus TOTP reauthentication within the configured recent-authentication window.
- An approval note is optional for an ordinary clean approval. A reason is mandatory for any exception, unresolved-warning override, or manual override. Required/invalid answers cannot be overridden merely with a note.
- Changing approved export-relevant answers, financial formulas, visibility rules, scope, targets, attribution, or export content invalidates the current approval automatically. Ordinary notes and tags do not invalidate it.
- Prior approval versions remain visible with version, actor, date/time, note, and invalidation reason.
- A change request returns the project/questionnaire to draft, lists the exact required changes, and requires a new validation and approval after editing.

## H. Markdown export

| ID | Requirement | Priority | Status |
|---|---|---|---|
| H01 | Required export file names | Required | CONFIRMED |
| H02 | One combined file or multiple context files | Required | CONFIRMED |
| H03 | Exact export sections and order | Required | CONFIRMED |
| H04 | Include or exclude unanswered optional questions | Required | CONFIRMED |
| H05 | Sensitive-data exclusion/redaction rules | Required | CONFIRMED |
| H06 | Evidence link/file representation | Required | CONFIRMED |
| H07 | Export destination and download behavior | Required | CONFIRMED |
| H08 | Export version naming | Required | CONFIRMED |
| H09 | Whether old exports can be deleted | Required | CONFIRMED |
| H10 | Claude/ChatGPT instruction block inside the export | Required | CONFIRMED |

### Recorded Markdown export rules

Status: **CONFIRMED by Rana on 21 September 2026**.

- Each approved export package is named `ResultGrid-Digital_{client}_{project}_{YYYY-MM-DD}_vNN` and contains `PROJECT_CONTEXT.md`, `EVIDENCE_INDEX.md`, and `EXPORT_MANIFEST.md`.
- `PROJECT_CONTEXT.md` is the single main file intended for manual upload to ChatGPT or Claude. No AI API integration is part of the MVP.
- Context section order: AI Instructions; Business & Project Identity; Objectives and Scope; Audience and Brand; Services and Channels; Website, SEO and Advertising; Sales Workflow; Deliverables and Schedule; KPIs and Targets; Costs, Revenue and Profit Rules; Progress and Current Status; Approved Decisions; Open Optional Items; Restrictions.
- Unanswered optional questions are omitted from their normal sections. Relevant unresolved optional items appear only in `Open Optional Items` with an explicit unknown/pending status.
- Credentials, personal contact details, payment details, private notes, unrelated-client data, and restricted internal financial fields are excluded by default.
- `EVIDENCE_INDEX.md` records evidence name, date, verification state, source, scope, and safe local/reference location without copying sensitive source content.
- The user may download the complete package as a ZIP or download `PROJECT_CONTEXT.md` by itself.
- Export versions use `v01`, `v02`, and so on. Approved exports are immutable and may be archived but not hard-deleted through the app.
- The AI instruction block requires facts, assumptions, unknowns, targets, projections, and evidence to remain distinct and prohibits invented missing information.
- Client read-only reports are generated separately from AI context exports and follow their own visibility configuration.

## I. Interface and screens

| ID | Requirement | Priority | Status |
|---|---|---|---|
| I01 | Required MVP screens | Required | CONFIRMED |
| I02 | Dashboard contents | Required | CONFIRMED |
| I03 | Navigation structure | Required | CONFIRMED |
| I04 | Table, card, and search/filter needs | Required | CONFIRMED |
| I05 | Visual direction and reference products | Required | CONFIRMED |
| I06 | Accessibility expectation | Required | CONFIRMED |
| I07 | Empty, error, loading, and permission-denied behavior | Required | CONFIRMED |
| I08 | Mobile actions that must work | Required | CONFIRMED |

### Recorded interface rules

Status: **CONFIRMED by Rana on 21 September 2026**.

- Required screens: Login/TOTP/email recovery; Owner dashboard; clients/businesses; projects; questionnaire wizard; readiness review/approval; costs/revenue/results/profit; leads/sales stages; files/evidence; reports/client sharing; AI Markdown exports; and security/settings/audit history.
- Desktop navigation: Dashboard, Clients, Projects, Leads, Reports, Files, Exports, Settings.
- The dashboard uses Owner-configurable cards/tables, required truthfulness warnings, target progress, weekly/monthly comparison, and project/date filters.
- Clients, projects, leads, transactions, evidence, and reports support search, filter, sort, and archive.
- Visual direction is light, calm, professional, and technology-oriented with purposeful animation, transitions, animated progress, and subtle depth. Motion must support hierarchy/feedback and keep the product visually alive without obscuring data or delaying routine work. Respect reduced-motion preferences.
- Accessibility includes keyboard navigation, readable contrast, explicit labels/errors, and status communication that does not rely on color alone.
- Empty, loading, error, stale, missing-data, and permission-denied states show clear explanations and the exact available next action.
- Mobile supports login/TOTP and read-only dashboard, report, and project-data viewing; editing remains desktop-only in the MVP. Client report links are responsive.
- Client share links are project-scoped and revocable. Both an expiry and PIN protection are mandatory. Default expiry is 2 days; only Rana may explicitly extend or replace the link after that.

## J. Files, privacy, and retention

| ID | Requirement | Priority | Status |
|---|---|---|---|
| J01 | Allowed attachment types and maximum size | Required | CONFIRMED |
| J02 | Sensitive data that must never be stored | Required | CONFIRMED |
| J03 | Data-retention period | Required | CONFIRMED |
| J04 | Backup/restore expectation | Required | CONFIRMED |
| J05 | Audit-log requirement | Required | CONFIRMED |
| J06 | Data export/deletion request behavior | Required | CONFIRMED |
| J07 | Production region/data-location requirement | Optional | CONFIRMED selection deferred until provider setup |

### Recorded file, privacy, and retention rules

Status: **CONFIRMED by Rana on 21 September 2026**.

- Allowed initial types: PDF, DOCX, XLSX, CSV, PNG, JPG/JPEG, WEBP, and short MP4. Validate both extension and detected content type; additional types require an explicit allow-list change.
- The maximum linked-file size policy is 1 GB per file. The MVP uses a Google Workspace Shared Drive with a separate client structure: `Clients/{client}/01_Client_Upload_Inbox`, `02_Working_Private`, `03_Approved_Assets`, and `04_Final_Deliverables`.
- Each client receives Contributor access only to its own `01_Client_Upload_Inbox`. Client uploads occur through Google Drive on the web. Contributor access is chosen so the client can add files without permission to move existing content to trash or reorganize the shared drive. Workspace policy must permit the relevant external contributor before onboarding is marked ready.
- Rana moves/copies selected inputs into the private working area and controls access to approved assets/final deliverables. A client never receives access to the Shared Drive root, another client's folder, or internal working folders.
- ResultGrid Digital stores the Drive link plus safe metadata, client/project relationship, ownership/access state, evidence status, and any private working-copy reference. ResultGrid Digital does not transfer the binary through Vercel or automatically connect to the Google Drive API in the MVP.
- Small application attachments, if retained in scope, use the selected application storage with a separate technically verified upload limit. A Drive link is required for a file that exceeds that limit.
- Upload limit: 25 MB (26,214,400 bytes), confirmed by Rana on 9 October 2026.
- Prohibited storage includes passwords, OTP/TOTP secrets or codes, access tokens, private keys, card/bank authentication data, identity documents, and unnecessary health/personal data.
- Client/project records remain until Rana initiates archive/deletion. Ordinary deletion first archives the record, followed by a 30-day recovery period before permanent deletion where permitted.
- Use managed daily database backups plus a weekly downloadable backup/export. A restore procedure must be demonstrated before MVP acceptance.
- Security, approval, financial-edit, publication, and export audit history cannot be hard-deleted through ordinary application actions.
- A data export/deletion request produces an authorized project-scoped package. After the recovery period, delete eligible data while retaining only records that must remain for agreed financial/legal/audit reasons, with the reason recorded.
- Select the nearest suitable available production region when creating the database/storage project and record the actual region. No region is assumed before provider setup.

## K. Environments and ownership

| ID | Requirement | Priority | Status |
|---|---|---|---|
| K01 | GitHub repository owner/account | Required | CONFIRMED; exact account selected during setup |
| K02 | Vercel account/team and project ownership | Required | CONFIRMED; exact account selected during setup |
| K03 | Supabase organization/project ownership | Required | CONFIRMED; exact account selected during setup |
| K04 | Development and production environment separation | Required | CONFIRMED |
| K05 | Domain/subdomain | Optional for local MVP | CONFIRMED |
| K06 | Who controls environment secrets | Required | CONFIRMED |
| K07 | Initial Owner account | Required | CONFIRMED |
| K08 | Cost ceiling for hosted services | Required | CONFIRMED_UNDECIDED_APPROVAL_GATE |

Credentials and secret values must never be written into this document. Only ownership and readiness status belong here.

### Recorded environment ownership decisions

- The GitHub repository, Vercel project, and Supabase organization/project will belong to Rana's personal accounts. Exact account identifiers will be selected during setup without recording credentials here.
- The confirmed public domain is `resultgriddigital.com`.
- The confirmed initial Owner login, security-alert, 2FA-recovery, report, and administrative email is `mustafiz@resultgriddigital.com`.
- Rana alone controls environment secrets.
- The monthly hosting/service budget remains undecided. No paid plan or upgrade may be activated without Rana's explicit approval.
- Development and production are separate. Local development and a dedicated non-production Supabase project use test data; the production Vercel/Supabase environment contains real data only after validation and release. Secrets, storage, databases, and authentication configuration do not cross environments.

## L. MVP acceptance and operating process

| ID | Requirement | Priority | Status |
|---|---|---|---|
| L01 | Final end-to-end acceptance scenario | Required | CONFIRMED |
| L02 | Seed/demo client and project | Required | CONFIRMED |
| L03 | Required browsers/devices | Required | CONFIRMED |
| L04 | Minimum permission/security checks | Required | CONFIRMED |
| L05 | Error cases that must be demonstrated | Required | CONFIRMED |
| L06 | Who accepts the MVP | Required | CONFIRMED |
| L07 | How change requests are recorded after MVP | Required | CONFIRMED |
| L08 | Definition of build-ready | Required | CONFIRMED |

`L08`: Build-ready means all applicable required items in this document are confirmed, Questionnaire V1 and the export template are approved, contradictions are resolved, the implementation specification is reviewed, and Rana explicitly authorizes moving into VS Code build work after receiving a readiness notice.

### Recorded MVP acceptance process

Status: **CONFIRMED by Rana on 21 September 2026**.

- End-to-end acceptance covers secure password/TOTP login and tested email recovery; client/project creation; Questionnaire V1; exact validation blockers; approval; financial/result/evidence entry; dashboard periods and visibility; weekly and monthly reports; protected client sharing; and the complete Markdown/ZIP export package.
- The seed/demo client is named **Vera Wellness**. Acceptance uses synthetic metrics, financial values, contacts, and credentials. Real Vera Wellness data may be imported only after Rana explicitly authorizes its use and the evidence/privacy rules are satisfied.
- Desktop editing must work in current Chrome and Edge. Android Chrome must support the approved read-only mobile experience and protected client report view.
- Demonstrate Owner-only access, mandatory TOTP, email recovery restrictions, recent reauthentication for sensitive actions, project isolation, redaction, link PIN/expiry/revocation, and prevention of unauthorized edits.
- Demonstrate safe handling for wrong password/TOTP, expired link, wrong PIN, missing/invalid required data, missing evidence/status, possible duplicate lead, invalid CSV, stale/unavailable data, and unauthorized access.
- Rana is the sole MVP acceptance authority.
- Post-MVP change requests are recorded in the relevant ResultGrid Digital project change log with scope, reason, priority, status, decision, and any cost/deadline impact.

## M. Cost, results, progress, and profitability

This section was added after the product-foundation answers. It is potentially part of MVP scope because Rana identified profitability visibility as the definition of usefulness.

| ID | Requirement | Priority | Status |
|---|---|---|---|
| M01 | Define whose profitability is measured: each owned business, external client, project, campaign, or selected levels | Required | CONFIRMED |
| M02 | Define income/revenue data to record and its source | Required | CONFIRMED; source/evidence policy continues in M15 |
| M03 | Define digital operating-cost categories | Required | CONFIRMED; allocation rules continue in M08 |
| M04 | Define marketing-spend categories and distinguish spend from fees/operating cost | Required | CONFIRMED |
| M05 | Define whether agency/service fees are income, cost, or both depending on business/client view | Required | CONFIRMED |
| M06 | Define currency rules and whether multi-currency conversion is required | Required | CONFIRMED |
| M07 | Define reporting periods: daily, weekly, monthly, campaign, custom date range | Required | CONFIRMED |
| M08 | Define the profit formula and required inputs | Required | CONFIRMED; project time-cost rate/allocation values set per project |
| M09 | Define how marketing results connect to revenue and what counts as attributed revenue | Required | CONFIRMED; attribution window set per project |
| M10 | Define progress targets and target-versus-actual measurements | Required | CONFIRMED; target values set per project |
| M11 | Define manual entry, CSV import, or external data-source behavior for MVP | Required | CONFIRMED |
| M12 | Define handling of missing, estimated, pending, refunded, or disputed values | Required | CONFIRMED |
| M13 | Define the minimum financial/result dashboard needed for MVP acceptance | Required | CONFIRMED |
| M14 | Define access and sensitivity rules for cost, revenue, and profit figures | Required | CONFIRMED |
| M15 | Define whether records need evidence such as invoice, receipt, ad-platform report, or source URL | Required | CONFIRMED |

M01–M15 were confirmed by Rana on 21 September 2026. Cost/profitability is therefore part of the MVP specification. Do not label revenue as caused by marketing unless the chosen attribution rule supports that claim.

## Deferred modules

The following do not block the MVP and should not be fully specified yet:

- campaign and creative workflow
- creative version approval
- SEO keyword tracking
- general analytics snapshots and reports beyond the minimum cost/result/progress dashboard defined in Section M
- content calendar
- manual publication receipts
- automatic social publishing
- AI API integration

Only record a deferred module decision during MVP discovery if it affects the current database boundary or would cause destructive rework later.

## Build-readiness gate

Before any application build begins, produce these approved artifacts:

1. Confirmed answers to all applicable required items above.
2. Questionnaire V1 definition.
3. Approved `PROJECT_CONTEXT.md` export template.
4. MVP screen list and user flow.
5. Database/entity specification.
6. Role and Row Level Security matrix.
7. Validation and status-transition contract.
8. Acceptance checklist and seed scenario.
9. Risks, open optional decisions, and explicitly deferred items.
10. A final readiness notice to Rana. Build starts only after Rana's instruction following that notice.
