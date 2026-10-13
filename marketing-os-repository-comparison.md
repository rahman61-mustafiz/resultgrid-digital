# Marketing OS — repository comparison
Inspected 21 September 2026 • Rana's planning brief • Read-only source review

**Recommendation:** build an original, focused Marketing OS using Twenty's relationship concepts, Postiz's publishing lifecycle, and Mautic's validation/event concepts. Do not merge the three applications into one codebase. If an existing platform is preferred, evaluate a Twenty application through its published interfaces first; the current license expressly permits independently licensed applications within that boundary.

This report is a research deliverable, not a completed client/project context export. No missing business answers have been invented.

## Repositories retained

All three are full working-tree, depth-1 clones of their default branches, including Git metadata. Older commit history and other branches were not downloaded. No dependencies, services, migrations, or application tests were run. All working trees were verified clean.

| Repository | Branch | Inspected commit | Tracked files |
|---|---|---|---:|
| Twenty | main | `28460e1488f960ccd8d0226cab2c8f21457d9912` | 32,795 |
| Postiz | main | `e3c9f1fa01ea630a2c07408b4ef2360a774eaef4` | 985 |
| Mautic | 7.x | `7912edbd7ede249ddbb2721abd6def94bee52f3e` | 7,115 |

Local parent directory: `C:/Users/musta/Documents/Codex/2026-09-21/referenced-chatgpt-conversation-this-is-an/work/repos/`, containing `twenty`, `postiz-app`, and `mautic`. Twenty required repository-local `core.longpaths=true` and a checkout retry; no source changes were made. These are development-branch snapshots, not certified production releases. The adjacent repository manifest records absolute locations and verification.

## What each contributes

| Area | Twenty CRM | Postiz | Mautic |
|---|---|---|---|
| Structure / architecture | Nx/Yarn TypeScript monorepo; React frontend; NestJS/TypeORM backend; PostgreSQL, Redis/BullMQ. Metadata engine separate from business modules. | pnpm monorepo: Next.js frontend, NestJS API, Temporal orchestrator; shared libraries, Prisma/PostgreSQL, Redis. | PHP/Symfony/Doctrine application; domain bundles, plugins, Twig/themes; MySQL/MariaDB and scheduled commands/workers. |
| Questionnaire validation | Typed fields, nullability, relations and workflows are useful primitives. No inspected end-to-end mandatory Marketing OS questionnaire/export gate. | Publishing DTOs and provider validation address posts, not business onboarding completeness. | Strongest reference: field-level required flags, validation metadata, conditional visibility and server-side submission checks. |
| Linked data | Strongest reference: companies/people, custom objects/relations, tasks, notes, attachments. Our project/campaign/creative hierarchy still needs modeling. | Organization → Customer → Integration → Post; comments, media and tags. Customer is lightweight; no inspected first-class project/campaign chain. | Companies/contacts, campaigns and related content. **ProjectBundle exists:** projects associate many-to-many with campaigns and other entities, rather than enforcing our ownership chain. |
| Workflow / campaign | Workflow → Version → Run; trigger, steps, execution state and logs. Also has email MessageCampaign objects with schedule and delivery counters. | Per-channel posts, grouped variants, parent/child posts, calendar dates, recurring intervals and publishing jobs. | Contact-centered journeys: sources/segments/forms → decisions, conditions and actions → timed events and execution logs. |
| Creative / social | Tasks, notes and custom statuses can support review; no inspected Postiz-style social publishing engine. | Best fit: media library, comments, provider-specific settings, queued/draft/published/error states, remote publication ID/URL. Order-related approval fields are not a general creative revision/approval system. | Email/page/form assets and scheduled campaign actions. Social plugin files exist; their presence does not prove current platform compatibility or a complete multi-channel editorial calendar. |
| Analytics | Dashboards plus CRM/workflow/message delivery data; marketing attribution needs custom work. | Account/post analytics through optional provider methods, with Redis caching. Availability varies by provider. | Campaign event logs and configurable reports with sources, columns, filters and graphs; strong contact/campaign reporting concepts. |
| Workspace / permissions | Workspace schema reference, membership, roles and object/field/action controls; docs identify row-level permissions as premium. | Organization membership and roles (USER/ADMIN/SUPERADMIN); org-scoped records and authentication middleware. Permission service also mixes subscription entitlements with access checks. | Roles, permissions and own/other record access. Reviewed entities do not establish a SaaS tenant boundary; projects are not tenant isolation. |
| SEO / AI context export | Custom implementation needed. | Custom implementation needed. | Custom implementation needed. |

The inspected model files and targeted source searches found no dedicated SEO rank-history module, Marketing OS questionnaire, or `PROJECT_CONTEXT.md` export pipeline. This is a scoped finding, not proof about every plugin or future version.

Architecture docs are useful but can lag code: Twenty's server-folder document uses older folder names, while current source uses `engine/` and `modules/`. Postiz's CLAUDE.md calls the frontend Vite, but its package scripts actually run Next.js. This comparison follows current source/manifests.

## Patterns to adapt

| Marketing OS need | Adapt from | Original implementation needed |
|---|---|---|
| Mandatory questionnaire | Mautic's required fields and server validation; Twenty's typed metadata | Versioned questions and answers, required/optional/conditional rules, missing-answer prompts, readiness validation. Block final Save/Complete and context-file export until all applicable required answers pass. Do not silently treat optional or unknown values as answers. Draft autosave would be a separate product decision, not assumed permission to weaken this rule. |
| Client → project → campaign → creative | Twenty's relationships; Mautic's explicit associations | Required foreign keys and workspace ownership checks. A reusable creative can have campaign associations; each publication should identify its campaign, channel and creative version. |
| Creative workflow | Postiz's assets, comments and scheduling; Twenty's version/run separation | Brief → Draft → Review → Approved → Scheduled → Published/Failed. Approval must attach to a specific version; later edits invalidate approval. Keep approved content separate from the delivery attempt. |
| Publishing reliability | Postiz's provider interface and Temporal workflow | Store attempt IDs and remote receipts; distinguish retryable reads from publication with an unknown outcome. Inspect platform state before retrying an uncertain mutation. Temporal itself can be deferred for the initial manual-publishing scope. |
| Analytics | Mautic's event/report model; Postiz's metric adapters | Store durable metric snapshots with source, time range, timezone, unit and linked IDs. Distinguish unavailable from zero. Cache is not historical evidence; avoid adding metrics with incompatible meanings. |
| SEO | Use Twenty-style relations only | At least 40 relevant tracked keywords, target URL, market/location, language, device, search surface, target rank and dated observations with evidence. Connect Goal → Observation/Evidence → Action → Result. |
| AI-ready export | Twenty's versioning concepts | Deterministic Markdown assembled from validated records, a data-version identifier, source links and an export manifest. No AI provider integration required. |

The SEO target should remain an objective, not a guaranteed ranking result. Keep Google organic, Maps/local observations and Meta discovery/advertising measurements separate. Label manually observed rank and imported average-position metrics distinctly; do not pretend they measure exactly the same thing.

A compact original data model would be:

`Workspace → Client → Project → Campaign → Creative association → CreativeVersion → Publication`

Alongside it: `Membership/Role`, `ChannelAccount`, `QuestionnaireVersion/Question/Answer`, `Approval`, `Keyword/RankObservation`, `MetricSnapshot`, `Evidence`, `Action` and `ContextExport`. This is a proposed design, not a schema copied from any repository. Client-facing access needs an explicit client/project scope inside each workspace.

## ChatGPT / Claude without API integration

1. Collect required answers through the app's questionnaire. Missing-answer prompts can be deterministic; an LLM is unnecessary.
2. Validate the current record version on the server before creating a file. Block export on missing required answers, invalid relationships or unauthorized data.
3. Generate `PROJECT_CONTEXT.md` with identifiers, generation date, objectives, validated answers, constraints, linked campaigns/creatives, keyword targets, dated evidence, results, decisions and next actions. Record unanswered optional questions explicitly.
4. Rana manually copies/uploads that context to the chosen ChatGPT/Claude conversation. Export only the selected project's permitted information; exclude credentials and unrelated client records.
5. Bring useful responses back as proposed notes/actions linked to the export version. Human review precedes applying changes. Regenerate context after accepted updates so an old chat does not become the sole source of truth.

This path needs no LLM API key, automated chat access or embedded AI services from these repositories. Social publishing APIs, if later enabled, would be a separate integration decision.

## License and complexity boundaries

General concepts such as foreign keys, roles, validation gates, queues, state machines and event logs can guide independently written code. Copying source, schemas, UI assets or a close code translation is a different decision; renaming variables does not resolve licensing.

| Source | Verified terms | Reuse decision |
|---|---|---|
| Twenty core | AGPLv3 with a Twenty Application Exception | Core modifications remain subject to AGPL, including its network-source requirement. An application using only the defined interfaces without incorporating/modifying core may have its own license under the exception. |
| Twenty toolkit/UI | MIT verified in `twenty-ui`, `twenty-sdk`, `twenty-client-sdk`, `twenty-shared`, `create-twenty-app` | Candidate for direct reuse with copyright/license notices retained. Check the selected file, transitive dependencies and assets. MIT availability does not make the whole CRM MIT. |
| Twenty Enterprise-marked files | Separate commercial license | Do not import these into a proprietary Marketing OS assuming they are AGPL. Production use requires the agreement/subscription described by the license; development/testing permission is narrower. |
| Postiz | Root LICENSE, README and root manifest specify AGPL-3.0 | Adapting covered code for a network service brings AGPL obligations. Frontend package metadata says ISC, conflicting with the repository-level statement; do not rely on that field as clearance for proprietary extraction. |
| Mautic | LICENSE.txt grants GPLv3 or later; Composer labels GPL-3.0 | Distribution of covered modified/combined code carries GPL obligations. GPL alone does not impose AGPL's remote-network source offer. Private hosted use and distribution must be assessed separately. |

For modified AGPL software supporting remote interaction, section 13 requires a prominent offer of corresponding source to those users. That is about the covered work, not automatically every independent service in a business. Separate-service integration is worth evaluating but is not a blanket license workaround. Relevant primary terms: [Twenty license](https://github.com/twentyhq/twenty/blob/28460e1488f960ccd8d0226cab2c8f21457d9912/LICENSE), [Postiz license](https://github.com/gitroomhq/postiz-app/blob/e3c9f1fa01ea630a2c07408b4ef2360a774eaef4/LICENSE), [Mautic license](https://github.com/mautic/mautic/blob/7912edbd7ede249ddbb2721abd6def94bee52f3e/LICENSE.txt).

**Complexity recommendation:** start with one original application and database. Borrow concepts; selectively evaluate MIT components. Defer three-platform deployment, schema-generation machinery, social OAuth/token renewal, Temporal operations, and contact/email automation until justified by real requirements. A Twenty-hosted application is a credible alternative if its UI, tenancy and premium-permission requirements fit. A final component-level license/dependency check is needed before importing code; this review is not blanket legal clearance.

## Evidence for follow-up inspection

Links are pinned to the cloned commits.

| Topic | Source files inspected |
|---|---|
| Twenty architecture | [Architecture overview](https://github.com/twentyhq/twenty/blob/28460e1488f960ccd8d0226cab2c8f21457d9912/CLAUDE.md); [Server architecture doc](https://github.com/twentyhq/twenty/blob/28460e1488f960ccd8d0226cab2c8f21457d9912/packages/twenty-docs/developers/contribute/capabilities/backend-development/folder-architecture-server.mdx) |
| Twenty model | [Objects and relationships](https://github.com/twentyhq/twenty/blob/28460e1488f960ccd8d0226cab2c8f21457d9912/packages/twenty-docs/getting-started/core-concepts/data-model.mdx); [Field metadata](https://github.com/twentyhq/twenty/blob/28460e1488f960ccd8d0226cab2c8f21457d9912/packages/twenty-server/src/engine/metadata-modules/field-metadata/field-metadata.entity.ts) |
| Twenty isolation / permissions | [Workspace entity](https://github.com/twentyhq/twenty/blob/28460e1488f960ccd8d0226cab2c8f21457d9912/packages/twenty-server/src/engine/core-modules/workspace/workspace.entity.ts); [Permissions and premium boundary](https://github.com/twentyhq/twenty/blob/28460e1488f960ccd8d0226cab2c8f21457d9912/packages/twenty-docs/user-guide/permissions-access/capabilities/permissions.mdx) |
| Twenty workflows / campaigns | [Workflow version](https://github.com/twentyhq/twenty/blob/28460e1488f960ccd8d0226cab2c8f21457d9912/packages/twenty-server/src/modules/workflow/common/standard-objects/workflow-version.workspace-entity.ts); [Run state/logs](https://github.com/twentyhq/twenty/blob/28460e1488f960ccd8d0226cab2c8f21457d9912/packages/twenty-server/src/modules/workflow/common/standard-objects/workflow-run.workspace-entity.ts); [Message campaign](https://github.com/twentyhq/twenty/blob/28460e1488f960ccd8d0226cab2c8f21457d9912/packages/twenty-server/src/modules/emailing/standard-objects/message-campaign.workspace-entity.ts) |
| Twenty permissive component | [UI MIT license](https://github.com/twentyhq/twenty/blob/28460e1488f960ccd8d0226cab2c8f21457d9912/packages/twenty-ui/LICENSE); [UI package/dependencies](https://github.com/twentyhq/twenty/blob/28460e1488f960ccd8d0226cab2c8f21457d9912/packages/twenty-ui/package.json) |
| Postiz schema | [Organization, membership, customer, integration, post, comments, media, states](https://github.com/gitroomhq/postiz-app/blob/e3c9f1fa01ea630a2c07408b4ef2360a774eaef4/libraries/nestjs-libraries/src/database/prisma/schema.prisma) |
| Postiz orchestration | [Schedule, pending status and retry distinctions](https://github.com/gitroomhq/postiz-app/blob/e3c9f1fa01ea630a2c07408b4ef2360a774eaef4/apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.1.2.ts); [Provider contract](https://github.com/gitroomhq/postiz-app/blob/e3c9f1fa01ea630a2c07408b4ef2360a774eaef4/libraries/nestjs-libraries/src/integrations/social/social.integrations.interface.ts) |
| Postiz analytics | [Analytics endpoints](https://github.com/gitroomhq/postiz-app/blob/e3c9f1fa01ea630a2c07408b4ef2360a774eaef4/apps/backend/src/api/routes/analytics.controller.ts); [Provider data/cache](https://github.com/gitroomhq/postiz-app/blob/e3c9f1fa01ea630a2c07408b4ef2360a774eaef4/libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts) |
| Postiz access / runtime | [Membership resolution](https://github.com/gitroomhq/postiz-app/blob/e3c9f1fa01ea630a2c07408b4ef2360a774eaef4/apps/backend/src/services/auth/auth.middleware.ts); [Permissions/entitlements](https://github.com/gitroomhq/postiz-app/blob/e3c9f1fa01ea630a2c07408b4ef2360a774eaef4/apps/backend/src/services/auth/permissions/permissions.service.ts); [Development services](https://github.com/gitroomhq/postiz-app/blob/e3c9f1fa01ea630a2c07408b4ef2360a774eaef4/docker-compose.dev.yaml); [Next.js scripts / ISC metadata](https://github.com/gitroomhq/postiz-app/blob/e3c9f1fa01ea630a2c07408b4ef2360a774eaef4/apps/frontend/package.json) |
| Mautic architecture | [Bundle architecture](https://github.com/mautic/mautic/blob/7912edbd7ede249ddbb2721abd6def94bee52f3e/AGENTS.md); [Dependencies](https://github.com/mautic/mautic/blob/7912edbd7ede249ddbb2721abd6def94bee52f3e/composer.json) |
| Mautic forms | [Required/validation metadata](https://github.com/mautic/mautic/blob/7912edbd7ede249ddbb2721abd6def94bee52f3e/app/bundles/FormBundle/Entity/Field.php); [Server-side validation](https://github.com/mautic/mautic/blob/7912edbd7ede249ddbb2721abd6def94bee52f3e/app/bundles/FormBundle/Model/SubmissionModel.php) |
| Mautic relationships | [Project](https://github.com/mautic/mautic/blob/7912edbd7ede249ddbb2721abd6def94bee52f3e/app/bundles/ProjectBundle/Entity/Project.php); [Many-to-many associations](https://github.com/mautic/mautic/blob/7912edbd7ede249ddbb2721abd6def94bee52f3e/app/bundles/ProjectBundle/Entity/ProjectTrait.php); [Campaign](https://github.com/mautic/mautic/blob/7912edbd7ede249ddbb2721abd6def94bee52f3e/app/bundles/CampaignBundle/Entity/Campaign.php) |
| Mautic automation / evidence | [Event graph/timing](https://github.com/mautic/mautic/blob/7912edbd7ede249ddbb2721abd6def94bee52f3e/app/bundles/CampaignBundle/Entity/Event.php); [Decisions/conditions/actions](https://github.com/mautic/mautic/blob/7912edbd7ede249ddbb2721abd6def94bee52f3e/app/bundles/CampaignBundle/Event/CampaignBuilderEvent.php); [Execution](https://github.com/mautic/mautic/blob/7912edbd7ede249ddbb2721abd6def94bee52f3e/app/bundles/CampaignBundle/Executioner/EventExecutioner.php); [Event log](https://github.com/mautic/mautic/blob/7912edbd7ede249ddbb2721abd6def94bee52f3e/app/bundles/CampaignBundle/Entity/LeadEventLog.php) |
| Mautic reports / access | [Report definition](https://github.com/mautic/mautic/blob/7912edbd7ede249ddbb2721abd6def94bee52f3e/app/bundles/ReportBundle/Entity/Report.php); [Roles](https://github.com/mautic/mautic/blob/7912edbd7ede249ddbb2721abd6def94bee52f3e/app/bundles/UserBundle/Entity/Role.php); [Campaign permissions](https://github.com/mautic/mautic/blob/7912edbd7ede249ddbb2721abd6def94bee52f3e/app/bundles/CampaignBundle/Security/Permissions/CampaignPermissions.php) |

Scope: source and documentation inspection only. No application was installed or exercised; live provider compatibility, runtime isolation and production suitability remain untested. No code or assets were extracted for reuse.

