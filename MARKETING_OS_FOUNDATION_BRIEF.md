# Rana's Marketing OS — Foundation Brief

## Purpose of this document

This document is the shared foundation for planning and building Rana's Marketing OS. It can be uploaded to ChatGPT or Claude so that both assistants work from the same goals, boundaries, terminology, and product decisions.

Treat this file as project context, not as permission to invent missing business information. If a required answer is missing, ask Rana. Do not guess it, mark it complete, or generate a final project export.

## Product vision

Build a focused Marketing OS that keeps every important item connected:

```text
Workspace
└── Client
    └── Project
        └── Campaign
            ├── Creative
            ├── Channel
            ├── Keyword
            ├── Evidence
            ├── Action
            └── Result
```

The system will be used mainly from a project folder in VS Code with ChatGPT or Claude. AI subscriptions will be used interactively by reading and writing approved project files. The first version does not require ChatGPT or Claude API integration.

## Core operating principle

The system is **AI-assisted and human-directed**.

AI may organize information, detect omissions, calculate results, produce drafts, offer options, and format approved records. AI must not take control of strategy, silently fill unknown information, approve creative work, or publish important changes without Rana's decision.

Rana's input must remain part of all work that requires taste, judgment, context, strategy, or approval.

## Confirmed technology stack

The first version will use a small TypeScript stack:

| Layer | Choice | Reason |
|---|---|---|
| Web application | Next.js with the App Router | One codebase for the interface and server-side operations |
| Language | TypeScript | Shared types and validation across the application |
| Interface | React with Tailwind CSS and shadcn/ui | Fast, maintainable internal-tool UI |
| Database | Supabase Postgres | Relational data suits clients, projects, questions, answers, and exports |
| Authentication | Supabase Auth with email/password and mandatory TOTP 2FA | Login and session management with a required second factor for the Owner account |
| Authorization | Postgres Row Level Security plus server-side permission checks | Protect workspace data at the database and application boundaries |
| Validation | Zod at input boundaries plus server-side domain validation | Clear field errors and a reliable completion gate |
| File storage | Supabase Storage | Evidence and attachments; not needed for basic Markdown text exports |
| Hosting | Vercel for Next.js and Supabase Cloud for database/auth/storage | Simple deployment and low operational overhead |
| Local work | VS Code, Git, and local Markdown exports | Supports manual work with ChatGPT or Claude subscriptions |

NestJS is deliberately excluded from the MVP. Next.js server actions or route handlers are sufficient for this limited scope. A separate backend should be introduced only if future integrations or background jobs create a demonstrated need.

The initial application will be a responsive web app. Offline-first behavior, desktop packaging, social OAuth, queues, and AI APIs are outside the MVP.

Public signup is disabled in the MVP. The Owner must complete authenticator-app enrollment before accessing business data. If TOTP is unavailable, a verified-email recovery flow may authorize replacement of the lost factor, but it does not directly unlock business data. The Owner must enroll and verify a new TOTP factor first. Recovery invalidates existing sessions, is rate-limited, and creates a security event.

## Reference repositories

Three open-source repositories were inspected as architectural references. Their source code must not be combined into one application or copied without a separate license review.

### Twenty CRM

Use as a reference for:

- workspace and membership structure
- clients, contacts, records, and relationships
- custom objects and fields
- linked tasks, notes, and attachments
- role and permission concepts
- workflow versions and execution history

Twenty is the strongest reference for the connected business-data foundation.

### Postiz

Use as a reference for:

- content calendar
- media library
- channel-specific post versions
- draft, queued, published, and error states
- grouped and parent/child posts
- publishing receipts such as remote post ID and URL
- provider-specific publishing adapters
- analytics adapters and duplicate-publishing protection

Postiz is the strongest reference for the creative, social scheduling, publishing, and social analytics module.

### Mautic

Use as a reference for:

- required form fields and server-side validation
- conditional rules
- campaign decisions, conditions, and actions
- event execution history
- evidence and configurable reports
- roles and campaign permissions

Mautic is the strongest reference for mandatory questionnaires, rule-based campaign workflows, and activity reporting.

## Original implementation rule

Use these repositories as references for concepts and patterns. Write the Marketing OS in an original structure suited to our selected technology stack.

- Twenty core is mainly AGPL, with some MIT packages and some commercially licensed Enterprise files.
- Postiz is distributed under AGPL-3.0 at repository level.
- Mautic is GPL-3.0-or-later.
- Do not assume that code is safe to copy because a pattern is useful.
- Any direct component reuse needs a file-level and dependency-level license check.
- General ideas such as relations, validation gates, state machines, queues, roles, and event logs may guide an independent implementation.

## Proposed core data model

The long-term model is shown below. The MVP implements only the items marked **MVP**.

```text
Workspace — MVP
├── Membership — MVP
├── Role — MVP
└── Client — MVP
    ├── Contact
    ├── Brand Asset
    ├── Evidence
    └── Project — MVP
        ├── Questionnaire Version — MVP
        │   ├── Question — MVP
        │   └── Answer — MVP
        ├── Campaign
        │   ├── Channel
        │   ├── Creative
        │   │   ├── Creative Version
        │   │   ├── Approval
        │   │   └── Publication
        │   ├── Keyword
        │   │   └── Rank Observation
        │   ├── Metric Snapshot
        │   ├── Evidence
        │   └── Action
        └── Context Export — MVP
```

All records must retain stable IDs and explicit relationships. Files should not become disconnected copies of business data.

## Source of truth

Supabase Postgres is the only source of truth for application state. Markdown files are immutable, generated snapshots for use in VS Code, ChatGPT, or Claude.

Rules:

1. Users edit answers and project data through the application, which writes to Postgres.
2. The exporter reads one validated database state and creates a Markdown snapshot with an export ID, data-version number, project ID, and generation timestamp.
3. Editing an exported Markdown file does not update the database.
4. Information returned by an AI assistant must be reviewed and entered as a proposed or accepted record before it becomes authoritative.
5. Regenerating an export creates a new version. Previous exports remain historical evidence and are never treated as the latest state automatically.

## Roles and permissions

The MVP supports four workspace roles:

| Role | Access |
|---|---|
| Owner | Full workspace access; manage members and roles; approve a project; generate final exports |
| Editor | Create and edit clients, projects, questions, and answers; run validation; cannot manage owners or finalize approval unless explicitly granted later |
| Viewer | Read workspace records and existing exports; cannot edit or approve |
| Client Read-only | Read only the specifically assigned client/project and its approved exports; no internal notes, unrelated clients, editing, or approval |

Every business record carries a `workspace_id`. Client access also requires an explicit client or project assignment. Supabase Row Level Security enforces visibility, while server-side checks enforce actions such as approval and export. UI hiding is convenience, not a security boundary.

## Mandatory questionnaire

Every project begins with required and optional questions.

Each answer should record:

- question ID
- answer value
- whether the question is required or optional
- who supplied the answer
- answer date
- source or evidence link when relevant
- verified or unverified status

Rules:

1. Missing required answers keep the project incomplete.
2. The system must list the exact missing questions.
3. The assistant must ask Rana for missing required information.
4. The assistant must never invent an answer.
5. Optional answers may remain empty and should be labelled as unanswered.
6. Final project completion and final context export remain blocked until all applicable required answers are valid.
7. Draft autosave, if implemented, must remain separate from final completion and export.

### Enforcement mechanism

Question completeness is enforced synchronously; no cron job is involved.

- Zod validates input shape and field format before submission.
- A server-side validation service loads the active questionnaire version and all applicable required questions.
- Conditional required rules are evaluated on the server using stored answers.
- Saving an individual answer is allowed so work is not lost.
- The `complete project`, `approve project`, and `generate final export` operations all call the same validation service inside their server-side operation.
- If validation fails, the database status remains `INCOMPLETE`, the operation returns the exact missing or invalid question IDs, and no final export row/file is created.
- Postgres foreign keys, uniqueness rules, `NOT NULL` columns for structural fields, and Row Level Security protect data integrity and access. Conditional questionnaire completeness belongs in domain logic because it spans multiple rows and questionnaire versions.
- A database transaction prevents project status and export records from being created from different data states.

Suggested project states:

```text
INCOMPLETE → READY_FOR_REVIEW → APPROVED
```

Any change to a required answer after approval returns the project to `READY_FOR_REVIEW` and requires a new approval before another final export.

Expected validation result:

```text
Project status: Incomplete
Required questions: [count from the approved questionnaire version]
Completed: [current count]
Missing: [current count]
Final export: Blocked
```

After all required answers pass validation:

```text
Project status: Ready for review
Required questions: Complete
Human approval: Pending
```

Rana gives the final approval.

## Project context exports

After validation and approval, generate deterministic Markdown files such as:

```text
CLIENT.md
BRAND_CONTEXT.md
PROJECT_CONTEXT.md
CAMPAIGN_CONTEXT.md
```

The exporter must use approved structured records. It must not add imagined facts or AI-generated strategy as if they were confirmed business information.

Each export should include:

- client and project identifiers
- generation date and data-version identifier
- validated business answers
- goals and constraints
- campaign and channel details
- approved creative references
- keyword targets and dated observations
- evidence and source links
- accepted decisions
- current results and next actions
- unanswered optional questions

These files will be uploaded or opened manually in ChatGPT or Claude. Useful AI responses return to the system as proposed notes or actions. Human review is required before they become accepted records.

## Campaign planning

Each campaign should contain:

- objective
- target audience
- offer
- budget and currency
- start and end date
- channels
- KPIs
- keyword or message targets
- linked evidence
- owner
- status

AI may analyze the brief and propose options. Rana selects the objective, positioning, budget, message direction, and final plan.

## Creative workflow

Use this simple workflow:

```text
Brief
→ Idea options
→ Human-selected idea
→ Draft
→ Human review
→ Revision
→ Human approval
→ Ready to publish
→ Published or Failed
```

Each revision is a separate creative version:

```text
Creative
├── Version 1 — Rejected
├── Version 2 — Changes requested
└── Version 3 — Approved
```

Approval belongs to a specific version. Editing an approved version creates a new version and invalidates the previous approval for publication.

A master creative may have separate channel versions:

```text
Master Creative
├── Facebook version
├── Instagram version
├── Google Business Profile version
├── LinkedIn version
└── YouTube version
```

The system may automatically check caption length, aspect ratio, missing media, file naming, required fields, and publishing readiness. Hook, message, visual direction, final copy, and approval require human input.

## Content calendar and publishing

The calendar should show:

- client
- campaign
- creative and version
- channel
- planned date and timezone
- owner
- current status
- publication URL when available

Static checks may detect schedule conflicts, missing assets, unapproved versions, and invalid dates.

The first version should support manual publication tracking. Direct social-platform publishing, OAuth token management, and large background-processing infrastructure can be added later only when there is a demonstrated need.

## SEO and keyword tracking

Track at least 40 commercially relevant keywords for each suitable project. Ranking is a business target, not a guaranteed outcome.

Each keyword record should include:

- keyword phrase
- location
- language
- device
- search surface, such as Google Search or Google Maps
- target page
- target position
- dated rank observation
- evidence source
- required or proposed action

Use this relationship:

```text
Goal
→ Observation and evidence
→ Proposed action
→ Human decision
→ Completed work
→ New observation
→ Result
```

Keep Google organic Search, Google Maps/local visibility, and Meta discovery or advertising measurements separate. Label manually observed ranks and imported average-position metrics accurately; they are not the same measurement.

The first version may use manual entry or imported files. The system can automate historical comparison, movement calculations, missing-data checks, and report formatting. AI may suggest SEO actions but must not directly modify a live website without Rana's instruction.

## Analytics and evidence

Metric records should include:

- source
- measurement name
- value and unit
- date range
- timezone
- linked client, project, campaign, creative, or keyword
- collection method
- evidence link or file

The system may automatically calculate totals, changes, target-versus-actual results, and period comparisons. It must distinguish unavailable data from a real zero.

AI may draft an explanation or recommendation. Rana decides whether the explanation is accepted and which action to take.

## Automation boundary

Automate work that is static, repeatable, and does not require judgment:

- required-answer validation
- missing-question lists
- stable IDs, dates, and file names
- standard folder creation
- deterministic Markdown export
- duplicate detection
- relationship and status consistency checks
- arithmetic and period comparison
- content length and format checks
- missing asset or link detection
- keyword movement calculations
- report formatting
- version and change history

Keep these under Rana's control:

- business strategy
- target-audience selection
- campaign objectives
- offers and budgets
- keyword selection
- creative ideas and selection
- message and visual direction
- final content approval
- publication decisions
- accepting or rejecting AI analysis
- choosing the next action

## Proposed folder structure

```text
marketing-os/
├── app/                         # Next.js routes and server operations
├── components/                  # reusable interface components
├── lib/
│   ├── validation/              # Zod and completion rules
│   ├── permissions/             # role/action checks
│   ├── exports/                 # deterministic Markdown generation
│   └── supabase/                # database clients
├── supabase/
│   └── migrations/              # schema, constraints, and RLS policies
├── clients/
│   └── client-slug/
│       ├── CLIENT.md
│       ├── brand/
│       ├── evidence/
│       └── projects/
│           └── project-slug/
│               ├── PROJECT_CONTEXT.md
│               ├── questionnaire/
│               ├── campaigns/
│               ├── creatives/
│               ├── seo/
│               ├── analytics/
│               └── exports/
├── templates/
├── schemas/
└── scripts/
```

The `clients/` tree is the local export destination and working context for VS Code. It is not a second writable application database. Preserve stable IDs, linked data, validation, evidence, versioning, and human approval.

## MVP scope and milestones

The MVP is intentionally limited to Client/Project structure, the questionnaire engine, validation, approval, and Markdown export. Creative workflow, SEO tracking, analytics, and publishing calendar move to later phases.

Assumption for planning: one developer working with AI assistance. The estimates are working targets, not contractual deadlines. The schedule includes explicit content-design and contingency time.

### Questionnaire content must precede engineering

The number and wording of required questions are not confirmed. `57 required questions` was an illustrative example and must not be treated as a product requirement.

Before building the questionnaire UI, Rana and the assistant must produce and approve Questionnaire Version 1. This is a business/content-design milestone, not merely an engineering task.

For every proposed question, define:

- stable question key
- section and display order
- exact student/client-friendly wording
- why the answer is needed
- answer type and allowed format
- required or optional status
- conditional visibility/requirement rule
- validation rule and useful error message
- whether evidence is required
- whether the answer may contain sensitive information
- where the answer appears in `PROJECT_CONTEXT.md`

Questionnaire V1 should contain only information needed to make the first project context useful. Avoid choosing a target count first and filling the form to reach it. A question is included only when its answer changes planning, execution, validation, or context quality.

The approved question bank becomes versioned seed data. Wording or rules may change in later questionnaire versions without rewriting answers collected under an older version.

### MVP — 15 working days

Target window: **21 September–9 October 2026**.

| Milestone | Target | Deliverable | Acceptance check |
|---|---:|---|---|
| Questionnaire discovery | Days 1–2 | Candidate sections/questions, rationale, types, conditional rules, export mapping | Every candidate has a clear purpose; duplicates and unnecessary questions are removed |
| Questionnaire approval | Day 3 | Approved Questionnaire V1 and acceptance examples | Rana approves wording, required/optional status, rules, and expected context output |
| Foundation | Days 4–5 | Next.js project, Supabase environments, initial schema, authentication | Owner can sign in and create a workspace |
| Access model | Days 6–7 | Four roles, membership, workspace/client scoping, initial RLS policies | Cross-workspace access tests fail; permitted access succeeds |
| Client and project | Day 8 | Client/project create, view, and edit screens | Project is always linked to one client and workspace |
| Questionnaire engine | Days 9–10 | Versioned questions, required/optional/conditional rules, draft answers | Approved V1 renders correctly and missing answers do not erase completed work |
| Completion and export | Day 11 | Server gate, approval invalidation, deterministic Markdown export | Invalid projects cannot complete, approve, or export; valid approved data exports |
| Integrated verification | Day 12 | Permission, validation, transaction, and full-flow checks | Owner completes the full flow; forbidden role/workspace cases are rejected |
| Contingency and hardening | Days 13–15 | RLS debugging, fixes, usability polish, seed/demo workspace, setup guide | Critical issues are resolved and the documented flow works in a clean environment |

Days 13–15 are reserved capacity, not advance allocation for extra features. If earlier work finishes cleanly, use the time for permission tests, accessibility, error handling, and documentation. Do not pull Phase 2 features into the MVP merely because buffer remains.

MVP acceptance flow:

```text
Owner signs in
→ creates Client and Project
→ completes required questionnaire
→ receives an exact missing-answer list until complete
→ reviews and approves the project
→ generates versioned PROJECT_CONTEXT.md
→ opens the export in VS Code or uploads it to ChatGPT/Claude
```

### Phase 2 — after MVP acceptance

Prioritize from real usage rather than building all modules together:

1. Campaign records and creative versions with human approval.
2. Evidence, keyword, and action tracking with manual/imported observations.
3. Analytics snapshots and deterministic reports.
4. Content calendar and manual publication receipts.

### Phase 3 — only if justified

- automatic social publishing
- autonomous campaign execution
- embedded AI API integration
- automatic strategy decisions
- complex workflow infrastructure such as Temporal
- a full email/contact automation engine

## Rules for AI assistants

When ChatGPT or Claude works on this project:

1. Read the current context files before proposing work.
2. Treat missing facts as unknown.
3. Ask Rana for any required answer that is missing.
4. Clearly separate confirmed facts, AI suggestions, and accepted decisions.
5. Do not mark a project complete or generate its final context export while required answers are missing.
6. Do not silently change approved strategy, creative content, budget, keywords, or publication decisions.
7. Preserve IDs, relationships, evidence links, and version history.
8. Automate mechanical work and leave judgment to Rana.
9. Keep the system focused and maintainable; do not introduce large infrastructure without a real requirement.
10. Never claim that a Google or Meta ranking outcome is guaranteed.

## Current decision

The direction is approved at the planning level: combine selected ideas from Twenty, Postiz, and Mautic into an original, lightweight Marketing OS while preserving Rana's direct input.

The technology stack and MVP boundary are now confirmed. All pre-build decisions are tracked in `BUILD_READINESS_QUESTIONNAIRE.md`. The next step is to complete that discovery, approve Questionnaire V1 and the export template, and then turn the confirmed answers into an implementation-ready specification before writing application code.
