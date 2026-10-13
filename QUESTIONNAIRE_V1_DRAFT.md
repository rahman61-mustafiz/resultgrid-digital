# ResultGrid Digital — Questionnaire V1 Draft

## Review status

- Overall status: **QUESTIONNAIRE V1 CONTENT APPROVED FOR PRE-BUILD SPECIFICATION**
- Approved sections: **E01–E14**
- Current review section: **Complete; implementation mapping and final pre-build review are next**
- First seed record: `SEED_PROJECT_RESULTGRID_DIGITAL.md` (completed discovery answers with project-specific open values)
- Rule: A question becomes part of Questionnaire V1 only after its wording, purpose, type, applicability, validation, evidence rule, sensitivity, and export destination are approved.

## Standard answer states

- `UNANSWERED`: no usable answer has been supplied; blocks readiness when required.
- `ANSWERED`: a value has been supplied but is not yet confirmed.
- `CONFIRMED`: Owner has accepted the answer.
- `NOT_STARTED`: the activity/account/history does not exist yet; valid only where explicitly allowed.
- `NOT_APPLICABLE`: the question does not apply because of project type or an earlier answer.
- `UNKNOWN`: the information should exist but is not currently known; it remains visible and may block readiness when required.

## Sensitivity levels

- `NORMAL`: may appear in approved context exports.
- `INTERNAL`: Owner-only in the app; excluded from exports unless explicitly selected.
- `SENSITIVE`: Owner-only, masked where practical, and excluded from standard exports.
- Credentials, passwords, authentication codes, access tokens, private keys, and card/bank authentication data must never be collected as questionnaire answers.

## E01 — Business identity and locations

### E01.Q01 — Public business name

- Question: **What business or brand name should be used publicly?**
- Purpose: Gives every plan, campaign, and export a consistent public identity.
- Answer type: Short text, 2–120 characters.
- Requirement: Required for every project.
- Condition: Always shown.
- Validation: Trim whitespace; reject an empty answer.
- Evidence: Optional website, registration, or official profile link.
- Sensitivity: NORMAL.
- Export destination: `Business Snapshot → Public name`.

### E01.Q02 — Legal or registered name

- Question: **What is the legal or registered business name, if different?**
- Purpose: Distinguishes public branding from billing, contracts, and formal records.
- Answer type: Short text, 2–160 characters.
- Requirement: Optional.
- Condition: Always shown; may be marked `NOT_APPLICABLE` for an unregistered/new venture.
- Validation: Trim whitespace when supplied.
- Evidence: Optional registration document reference; do not collect confidential document numbers by default.
- Sensitivity: INTERNAL.
- Export destination: Excluded from standard AI context; optional in an Owner-selected administrative export.

### E01.Q03 — Business type

- Question: **Which description best matches this business?**
- Purpose: Helps interpret goals, customer journey, revenue, and marketing constraints.
- Answer type: Single select plus optional custom label.
- Options: Local service, ecommerce, retail store, professional service, education, hospitality, health/beauty, media/content, software/digital product, nonprofit, personal brand, other.
- Requirement: Required for every project.
- Condition: Always shown; `Other` requires a custom label.
- Validation: One option required.
- Evidence: None.
- Sensitivity: NORMAL.
- Export destination: `Business Snapshot → Business type`.

### E01.Q04 — Operating status

- Question: **What is the business's current operating status?**
- Purpose: Prevents plans from assuming that sales, channels, or historical data already exist.
- Answer type: Single select.
- Options: Idea/pre-launch, preparing to launch, operating, temporarily paused, relaunching.
- Requirement: Required for every project.
- Condition: Always shown.
- Validation: One option required.
- Evidence: None.
- Sensitivity: NORMAL.
- Export destination: `Business Snapshot → Operating status`.

### E01.Q05 — Primary operating country

- Question: **Which country is the main operating market for this project?**
- Purpose: Sets geographic, currency, language, legal, and reporting context.
- Answer type: Country selector.
- Requirement: Required for every project.
- Condition: Always shown.
- Validation: Valid ISO country selection.
- Evidence: None.
- Sensitivity: NORMAL.
- Export destination: `Market Context → Primary country`.

### E01.Q06 — Service or sales locations

- Question: **Where can customers buy from or receive service?**
- Purpose: Defines the true market boundary for local, national, or online marketing.
- Answer type: Repeatable location entries plus reach type.
- Options for reach type: Specific address/service area, city-wide, nationwide, international, online only.
- Requirement: At least one reach entry is required.
- Condition: Always shown. Full street address is required only when location-specific activity needs it.
- Validation: Each entry needs a country and the relevant city/area; online-only requires supported countries or `Worldwide`.
- Evidence: Optional Google Business Profile, Maps, store-locator, or website link.
- Sensitivity: Public business addresses are NORMAL; private/home operational addresses are SENSITIVE and excluded from export.
- Export destination: `Market Context → Service/sales coverage`.

### E01.Q07 — Customer-facing languages

- Question: **Which languages are used with customers, and which one is primary?**
- Purpose: Controls content language, tone, localization, and export expectations.
- Answer type: Multi-select languages with one primary language.
- Requirement: Required for every project.
- Condition: Always shown.
- Validation: At least one language and exactly one primary language.
- Evidence: None.
- Sensitivity: NORMAL.
- Export destination: `Market Context → Customer languages`.

### E01.Q08 — Public contact points

- Question: **Which public contact methods should customers use?**
- Purpose: Establishes valid calls to action and prevents AI drafts from inventing contact details.
- Answer type: Repeatable typed entries: phone, WhatsApp, email, website, booking URL, store URL, other.
- Requirement: At least one public contact method is required for an operating business; optional for idea/pre-launch status.
- Condition: Requirement depends on E01.Q04.
- Validation: Format by type; URL scheme required for links; international format recommended for phone numbers.
- Evidence: Optional official page/profile link.
- Sensitivity: NORMAL only when explicitly marked public. Private contact data is SENSITIVE and excluded from export.
- Export destination: `Business Snapshot → Approved public contacts`.

### E01.Q09 — Location or contact uncertainty

- Question: **Is any location or public contact information still unconfirmed?**
- Purpose: Makes uncertainty explicit instead of silently treating incomplete information as final.
- Answer type: Yes/no plus explanation when yes.
- Requirement: Required for every project.
- Condition: Always shown; explanation required for `Yes`.
- Validation: Explanation 5–500 characters when required.
- Evidence: Optional.
- Sensitivity: INTERNAL.
- Export destination: `Open Questions → Identity/location uncertainties`; excluded when answer is `No`.

## E01 review checklist

- [x] Wording is understandable.
- [x] Every required answer is truly necessary before approval/export.
- [x] Pre-launch businesses can complete the section honestly.
- [x] Public and private contact/location information are separated.
- [x] No credential or excessive personal information is requested.
- [x] Export mapping is useful for ChatGPT/Claude context.

E01 status: **APPROVED using the ResultGrid Digital seed answers on 21 September 2026**.

## E02 — Products/services and commercial priorities

### E02.Q01 — Offers provided

- Question: **What products or services does the business provide or plan to provide?**
- Purpose: Defines what the project is marketing and prevents vague or invented offers.
- Answer type: Repeatable offer entries with name and short description.
- Requirement: At least one offer is required.
- Condition: Always shown.
- Validation: Each entry needs a unique name and a 10–500 character description.
- Evidence: Optional service page, proposal, price list, or catalogue.
- Sensitivity: NORMAL unless explicitly marked internal.
- Export destination: `Offers → Product/service list`.

### E02.Q02 — Offer readiness

- Question: **What is the current readiness of each product or service?**
- Purpose: Separates sellable offers from ideas that are still being developed.
- Answer type: One status per E02.Q01 offer.
- Options: Idea, being prepared, available now, temporarily paused, retired.
- Requirement: Required for every listed offer.
- Condition: Generated from E02.Q01.
- Validation: One status per offer.
- Evidence: Optional.
- Sensitivity: NORMAL.
- Export destination: `Offers → Availability/readiness`.

### E02.Q03 — Pricing model

- Question: **How is each active or planned offer priced?**
- Purpose: Supports profitability, budgeting, positioning, and calls to action.
- Answer type: Per-offer pricing model plus amount/range and currency when known.
- Options: Fixed price, starting price, package/tier, hourly/daily, recurring subscription/retainer, commission/performance based, quote required, free, undecided.
- Requirement: Pricing model is required for active offers; amount may be `UNDECIDED` before launch.
- Condition: Generated from offers not marked retired.
- Validation: Currency required when an amount is supplied; no negative amount.
- Evidence: Optional proposal, price list, or public page.
- Sensitivity: Internal cost assumptions are not collected here; they belong in E14.
- Export destination: `Offers → Customer-facing pricing` when approved for export; otherwise `Internal commercial context`.

### E02.Q04 — Priority offers

- Question: **Which offers should marketing prioritize during this project, in order?**
- Purpose: Prevents resources from being spread equally across every possible service.
- Answer type: Ordered selection from E02.Q01.
- Requirement: At least one priority offer is required.
- Condition: At least one non-retired offer exists.
- Validation: No duplicate rank; only available/planned offers may be selected.
- Evidence: None.
- Sensitivity: NORMAL.
- Export destination: `Commercial Priorities → Ranked offers`.

### E02.Q05 — Priority reason

- Question: **Why are these offers the current priority?**
- Purpose: Captures the owner's commercial judgment instead of allowing AI to infer it.
- Answer type: Long text, 20–1,000 characters.
- Requirement: Required.
- Condition: E02.Q04 is answered.
- Validation: Minimum 20 characters.
- Evidence: Optional sales history, margin estimate, demand signal, or strategic note.
- Sensitivity: INTERNAL by default; a concise approved summary may appear in export.
- Export destination: `Commercial Priorities → Rationale`.

### E02.Q06 — Delivery capacity and constraints

- Question: **How many customers/orders can the business serve during the selected period, and what limits delivery?**
- Purpose: Keeps marketing targets aligned with operational capacity.
- Answer type: Capacity period, numeric or descriptive limit, and constraint notes.
- Requirement: Required for operating businesses; may be `UNKNOWN` with a required explanation for pre-launch businesses.
- Condition: Always shown.
- Validation: Non-negative capacity when numeric; explanation required for `UNKNOWN`.
- Evidence: Optional staffing or operational plan.
- Sensitivity: INTERNAL.
- Export destination: `Constraints → Delivery capacity`.

### E02.Q07 — Existing demand evidence

- Question: **What evidence shows current or expected demand for these offers?**
- Purpose: Separates demonstrated demand from assumptions.
- Answer type: Repeatable evidence entries plus summary.
- Requirement: Optional; `NOT_STARTED` is valid for a new business.
- Condition: Always shown.
- Validation: Evidence entries need a type and date/source when available.
- Evidence: Inquiry records, sales history, search data, customer interviews, competitor observations, or other source.
- Sensitivity: INTERNAL unless the evidence is public.
- Export destination: `Evidence → Demand signals`; clearly labelled as observed evidence or assumption.

### E02.Q08 — Offers excluded from this project

- Question: **Are any products or services explicitly outside this project's scope?**
- Purpose: Prevents AI drafts and plans from promoting excluded work.
- Answer type: Multi-select from E02.Q01 plus explanation; `None` allowed.
- Requirement: Required.
- Condition: Always shown.
- Validation: `None` cannot be combined with selected offers.
- Evidence: None.
- Sensitivity: NORMAL.
- Export destination: `Scope → Excluded offers`.

## E02 review checklist

- [x] Every marketed offer can be named without forcing final pricing too early.
- [x] Pre-launch businesses can use `UNDECIDED`, `UNKNOWN`, or `NOT_STARTED` only where explicitly allowed.
- [x] Priority order and rationale come from the Owner.
- [x] Delivery capacity is considered before setting marketing targets.
- [x] Demand evidence is never presented as stronger than its source supports.
- [x] Financial costs and profit calculations remain in E14 rather than being duplicated here.

E02 status: **APPROVED using the ResultGrid Digital seed answers on 21 September 2026**.

## E03 — Target audience and geography

### E03.Q01 — Target customer groups

- Question: **Which types of customers or organizations should this project target?**
- Purpose: Defines who marketing is intended to reach.
- Answer type: Repeatable audience entries with label and description.
- Requirement: At least one target group is required.
- Condition: Always shown.
- Validation: Each entry needs a unique label and 10–500 character description.
- Evidence: Optional customer list, interview, sales history, or market source.
- Sensitivity: NORMAL unless customer identities are included; named customer data is INTERNAL.
- Export destination: `Target Audience → Customer groups`.

### E03.Q02 — Decision makers

- Question: **Who normally decides, influences, and pays for this service?**
- Purpose: Separates the audience consuming content from the person making the purchase decision.
- Answer type: Repeatable roles with decision/influence/payment labels.
- Requirement: Required; `UNKNOWN` allowed with explanation for a new market.
- Condition: Always shown.
- Validation: At least one role or an `UNKNOWN` explanation.
- Evidence: Optional sales/conversation notes.
- Sensitivity: NORMAL when expressed as roles rather than named people.
- Export destination: `Target Audience → Buying roles`.

### E03.Q03 — Customer stage and size

- Question: **What business stage or size is the best fit?**
- Purpose: Prevents an offer meant for a small local company from being positioned to an unsuitable enterprise or pre-revenue customer.
- Answer type: Multi-select plus notes.
- Options: Idea/pre-launch, new operating business, established small business, growing SME, enterprise, individual/professional, other.
- Requirement: Required.
- Condition: Always shown.
- Validation: At least one selection.
- Evidence: Optional.
- Sensitivity: NORMAL.
- Export destination: `Target Audience → Business stage/size`.

### E03.Q04 — Problems to solve

- Question: **What important problems should these customers hire the business to solve?**
- Purpose: Grounds marketing in customer needs rather than a list of features.
- Answer type: Ordered list of problem statements.
- Requirement: At least one problem is required.
- Condition: Always shown.
- Validation: Each statement 10–300 characters; no unsupported claim of severity or prevalence.
- Evidence: Optional customer feedback or market observation.
- Sensitivity: NORMAL.
- Export destination: `Target Audience → Priority problems`.

### E03.Q05 — Geographic markets

- Question: **Which geographic markets should each priority offer target?**
- Purpose: Connects service priorities to actual locations and avoids mixing local and international plans.
- Answer type: Per-offer countries, regions/cities, and online/local reach.
- Requirement: Required for every priority offer.
- Condition: Generated from E02.Q04.
- Validation: At least one geographic market per priority offer.
- Evidence: Optional market or existing-client evidence.
- Sensitivity: NORMAL.
- Export destination: `Market Context → Offer/geography map`.

### E03.Q06 — Priority audience order

- Question: **Which audience and market combination should be targeted first, second, and later?**
- Purpose: Creates a practical sequence when more than one segment is possible.
- Answer type: Ordered audience-market combinations.
- Requirement: Required when more than one valid combination exists; otherwise automatically `NOT_APPLICABLE`.
- Condition: Based on E03.Q01 and E03.Q05.
- Validation: No duplicates; only defined combinations.
- Evidence: Optional.
- Sensitivity: NORMAL.
- Export destination: `Target Audience → Priority order`.

### E03.Q07 — Excluded audiences or locations

- Question: **Which customer types or locations should this project avoid?**
- Purpose: Prevents unsuitable leads, unsupported locations, and wasted spend.
- Answer type: Repeatable exclusions with reason; `None` allowed.
- Requirement: Required.
- Condition: Always shown.
- Validation: `None` cannot be combined with exclusions.
- Evidence: Optional.
- Sensitivity: INTERNAL by default; approved operational exclusions may be exported.
- Export destination: `Constraints → Audience/location exclusions`.

### E03.Q08 — Audience certainty

- Question: **Which audience assumptions are proven, observed, or still hypotheses?**
- Purpose: Keeps early-stage assumptions separate from validated customer knowledge.
- Answer type: Classification and evidence note for each target group.
- Options: Proven by sales, observed through enquiries, supported by external research, Owner hypothesis.
- Requirement: Required for each target group.
- Condition: Generated from E03.Q01.
- Validation: Source/evidence required for every classification except Owner hypothesis.
- Evidence: Customer/sales records or external source link/file.
- Sensitivity: INTERNAL.
- Export destination: `Evidence → Audience confidence`.

## E03 review checklist

- [x] Target groups are specific enough to guide messaging and channel choice.
- [x] Buying roles are separated from general content audiences.
- [x] Each priority service has an explicit geographic market.
- [x] Problems are customer problems, not a repetition of service features.
- [x] Exclusions are captured.
- [x] Hypotheses and evidence-backed conclusions are clearly separated.

E03 status: **APPROVED using the ResultGrid Digital seed answers on 21 September 2026**.

## E04 — Brand positioning, voice, and visual rules

### E04.Q01 — Desired market perception

- Question: **How should the target customer describe this business after understanding it?**
- Purpose: Defines the intended position in the customer's mind.
- Answer type: Three to five short perception statements.
- Requirement: Required; `UNDECIDED` is allowed during early discovery but blocks final approval.
- Condition: Always shown.
- Validation: Each statement 2–120 characters; avoid unverifiable superiority claims.
- Evidence: Optional customer feedback or positioning research.
- Sensitivity: NORMAL.
- Export destination: `Brand → Desired perception`.

### E04.Q02 — Core value proposition

- Question: **What valuable outcome does the business promise, for whom, and through what kind of service?**
- Purpose: Gives strategy and copy a clear central proposition.
- Answer type: Structured sentence plus supporting notes.
- Requirement: Required; an early draft may be saved but final wording requires Owner approval.
- Condition: Always shown.
- Validation: Must identify audience, problem/outcome, and service approach; no guaranteed result unless evidence and terms support it.
- Evidence: Optional proof references.
- Sensitivity: NORMAL.
- Export destination: `Brand → Value proposition`.

### E04.Q03 — Brand personality

- Question: **Which personality traits should the brand consistently show?**
- Purpose: Guides design, writing, and interaction style.
- Answer type: Select three to six traits plus optional notes.
- Example traits: Strategic, practical, friendly, energetic, premium, modern, direct, dependable, experimental, calm.
- Requirement: Required.
- Condition: Always shown.
- Validation: Three to six traits; contradictory traits require an explanation.
- Evidence: None.
- Sensitivity: NORMAL.
- Export destination: `Brand → Personality`.

### E04.Q04 — Communication voice

- Question: **How should the brand speak to customers?**
- Purpose: Makes AI-assisted writing consistent without copying a source brand.
- Answer type: Voice rules with `Use` and `Avoid` examples.
- Requirement: Required.
- Condition: Always shown.
- Validation: At least two `Use` rules and two `Avoid` rules.
- Evidence: Optional approved writing samples.
- Sensitivity: NORMAL.
- Export destination: `Brand → Voice and writing rules`.

### E04.Q05 — Languages and tone by market

- Question: **Should tone or language use change by audience, channel, or market?**
- Purpose: Applies the confirmed English/Bangla language choice correctly in different contexts.
- Answer type: Rules by audience/channel/market; `No variation` allowed.
- Requirement: Required.
- Condition: More than one customer-facing language or market exists.
- Validation: Each variation must name its trigger and resulting rule.
- Evidence: Optional examples.
- Sensitivity: NORMAL.
- Export destination: `Brand → Language and localization rules`.

### E04.Q06 — Approved and prohibited claims

- Question: **Which claims, phrases, guarantees, or topics may or may not be used publicly?**
- Purpose: Prevents unsupported ranking, revenue, performance, or capability claims.
- Answer type: Two lists: approved with evidence requirement, and prohibited/avoid.
- Requirement: Required; `None currently approved` is valid.
- Condition: Always shown.
- Validation: Any numerical/performance claim needs an evidence reference and scope.
- Evidence: Required for every approved performance claim.
- Sensitivity: INTERNAL rules; approved public wording is NORMAL.
- Export destination: `Brand → Claim guardrails`.

### E04.Q07 — Existing visual identity

- Question: **Which brand assets and visual rules already exist?**
- Purpose: Distinguishes supplied assets from concepts that still need design.
- Answer type: Status plus asset links/files for logo, colors, fonts, imagery, icons, and templates.
- Requirement: Required as a status check; `NOT_STARTED` is valid and does not block approval when visual identity is outside project scope.
- Condition: Always shown.
- Validation: Every listed asset needs ownership/source and usage status.
- Evidence: Asset file or source link.
- Sensitivity: NORMAL for approved public assets; INTERNAL for drafts/licensing records.
- Export destination: `Brand → Approved visual assets`; missing items appear under `Open brand work`.

### E04.Q08 — Visual direction

- Question: **What visual qualities should be used or avoided?**
- Purpose: Guides future design when a complete brand system does not exist.
- Answer type: `Use` and `Avoid` descriptions plus optional references.
- Requirement: Required when E04.Q07 is incomplete; optional when a complete approved brand kit is attached.
- Condition: Based on E04.Q07.
- Validation: At least two `Use` and two `Avoid` points when required.
- Evidence: Optional reference links/images, labelled as inspiration rather than assets to copy.
- Sensitivity: NORMAL.
- Export destination: `Brand → Visual direction`.

### E04.Q09 — Brand consistency authority

- Question: **Who gives final approval when new content or design conflicts with the brand rules?**
- Purpose: Defines the human decision point for subjective brand choices.
- Answer type: Owner/role selection plus notes.
- Requirement: Required.
- Condition: Always shown.
- Validation: One final authority required.
- Evidence: None.
- Sensitivity: INTERNAL.
- Export destination: `Approval Rules → Brand authority`.

## E04 review checklist

- [x] Positioning identifies a useful customer perception without unsupported superiority claims.
- [x] The value proposition names audience, outcome, and approach.
- [x] Voice and personality are specific enough to guide AI-assisted drafts.
- [x] English/Bangla usage rules are explicit.
- [x] Performance claims require scoped evidence.
- [x] Existing assets and future visual ideas are not confused.
- [x] Final brand judgment remains with a named human authority.

E04 status: **APPROVED using the ResultGrid Digital seed answers on 21 September 2026**.

## E05 — Competitors and differentiation

### E05.Q01 — Direct competitors

- Question: **Which businesses compete directly for the same customers and services?**
- Purpose: Defines the real comparison set instead of assuming every agency is a direct competitor.
- Answer type: Repeatable competitor entries with name, URL, market, and reason.
- Requirement: A status answer is required; `UNKNOWN` or `NOT_RESEARCHED` is valid during early discovery and creates a research action.
- Condition: Always shown.
- Validation: URL optional; reason required for each named competitor.
- Evidence: Competitor website/profile or observation source.
- Sensitivity: INTERNAL.
- Export destination: `Competitive Context → Direct competitors`, clearly dated.

### E05.Q02 — Alternative ways customers solve the problem

- Question: **What alternatives might customers choose instead of hiring this business?**
- Purpose: Includes freelancers, in-house work, software tools, doing nothing, and other substitutes.
- Answer type: Multi-select plus notes.
- Requirement: Required; `UNKNOWN` allowed with explanation.
- Condition: Always shown.
- Validation: At least one alternative or an `UNKNOWN` explanation.
- Evidence: Optional.
- Sensitivity: INTERNAL.
- Export destination: `Competitive Context → Alternatives`.

### E05.Q03 — Customer comparison criteria

- Question: **What factors are customers likely to compare before choosing a provider?**
- Purpose: Identifies the dimensions on which positioning and proof must work.
- Answer type: Ordered criteria list.
- Examples: Trust, demonstrated results, price, responsiveness, strategic understanding, speed, technical capability, local knowledge.
- Requirement: Required; early assumptions must be labelled as such.
- Condition: Always shown.
- Validation: At least three criteria.
- Evidence: Optional customer conversation or research.
- Sensitivity: NORMAL.
- Export destination: `Competitive Context → Buying criteria`.

### E05.Q04 — Factual differentiators

- Question: **What can this business truthfully do or demonstrate that should make it a better fit for the target customer?**
- Purpose: Creates differentiation from capabilities and proof rather than unsupported adjectives.
- Answer type: Repeatable differentiator, target segment, and proof status.
- Requirement: At least one proposed differentiator is required; public use requires evidence or careful qualification.
- Condition: Always shown.
- Validation: Each item must identify who benefits and why.
- Evidence: Required before an item is classified as `PROVEN`.
- Sensitivity: INTERNAL until approved for public use.
- Export destination: `Competitive Context → Differentiators and proof status`.

### E05.Q05 — Competitor strengths and gaps

- Question: **What do the named competitors appear to do well, and where might customer needs remain unmet?**
- Purpose: Encourages evidence-based positioning without false or disparaging claims.
- Answer type: Observation entries with source and observation date.
- Requirement: Conditional; required only when direct competitors are named or research is performed.
- Condition: Based on E05.Q01.
- Validation: Source and date required; label interpretations as observations.
- Evidence: Public source link or research note.
- Sensitivity: INTERNAL.
- Export destination: `Competitive Context → Dated observations`.

### E05.Q06 — Practices to adopt or avoid

- Question: **Which general market practices should the business adopt, and which should it avoid?**
- Purpose: Records strategic learning without copying competitor wording, visuals, or protected assets.
- Answer type: `Adopt` and `Avoid` lists with rationale.
- Requirement: Optional until competitor research is complete.
- Condition: Always shown.
- Validation: Do not instruct copying of distinctive content or assets.
- Evidence: Optional reference.
- Sensitivity: INTERNAL.
- Export destination: `Strategy Guardrails → Market practices`.

### E05.Q07 — Selection reason

- Question: **In one honest sentence, why should the priority customer choose this business?**
- Purpose: Tests whether positioning is clear and defensible.
- Answer type: Short text, 15–300 characters.
- Requirement: Required before final approval; an early draft is allowed.
- Condition: E05.Q03 and E05.Q04 have answers.
- Validation: No unsupported guarantee, absolute superiority, or invented proof.
- Evidence: Must be consistent with approved differentiators.
- Sensitivity: NORMAL after approval.
- Export destination: `Competitive Context → Why choose us`.

## E05 review checklist

- [x] Direct competitors and substitutes are separated.
- [x] Unknown competitor information creates research work rather than invented facts.
- [x] Comparison criteria are labelled as evidence or assumptions.
- [x] Every public differentiator is factual or carefully qualified.
- [x] Competitor observations have a source and date.
- [x] No competitor copy, design, or unsupported criticism is reused.

E05 status: **APPROVED using the ResultGrid Digital seed answers on 21 September 2026**. Competitor research remains an explicit future action.

## E06 — Marketing goals and KPIs

### E06.Q01 — Primary marketing outcomes

- Question: **What business outcomes should marketing contribute to during this project?**
- Purpose: Connects marketing activity to outcomes instead of treating posting or traffic as success by itself.
- Answer type: Ordered outcome list with description.
- Examples: Qualified enquiries, booked consultations, paying clients, repeat purchases, local visibility, brand awareness, operational efficiency.
- Requirement: At least one outcome is required.
- Condition: Always shown.
- Validation: Each outcome must describe a business effect; activities alone are not outcomes.
- Evidence: Optional existing plan or stakeholder decision.
- Sensitivity: NORMAL.
- Export destination: `Goals → Ordered business outcomes`.

### E06.Q02 — Goal period

- Question: **What start date, end date, and review intervals apply to each goal?**
- Purpose: Prevents timeless goals that cannot be assessed.
- Answer type: Date range and review cadence per goal.
- Requirement: Required for each goal.
- Condition: Generated from E06.Q01.
- Validation: End date after start date; review cadence within goal period.
- Evidence: None.
- Sensitivity: NORMAL.
- Export destination: `Goals → Period and review schedule`.

### E06.Q03 — Baseline

- Question: **What is the current measured starting point for each goal?**
- Purpose: Makes progress calculable and distinguishes new projects from established performance.
- Answer type: Metric value, period, source, collection date, or `NO_BASELINE`.
- Requirement: Required as a status; a numeric value is optional when no reliable baseline exists.
- Condition: Generated from E06.Q01.
- Validation: Source and period required for numeric baselines; `NO_BASELINE` requires a plan to establish one.
- Evidence: Report, platform screenshot/export, business record, or measurement note.
- Sensitivity: INTERNAL unless approved for export.
- Export destination: `Goals → Baseline and evidence status`.

### E06.Q04 — KPI definitions

- Question: **Which exact metrics will show progress toward each outcome?**
- Purpose: Defines what will be counted before results are reported.
- Answer type: Repeatable KPI definitions linked to goals.
- Requirement: At least one KPI per goal.
- Condition: Generated from E06.Q01.
- Validation: Name, definition, unit, data source, frequency, and owner required; avoid combining unlike metrics.
- Evidence: Data-source reference.
- Sensitivity: NORMAL or INTERNAL according to metric.
- Export destination: `Measurement Plan → KPI definitions`.

### E06.Q05 — Targets

- Question: **What target value, target range, or monitoring-only status applies to each KPI?**
- Purpose: Enables target-versus-actual progress without presenting targets as guarantees.
- Answer type: Numeric/text target, date, and confidence note; or `MONITOR_ONLY`; `UNDECIDED` allowed during discovery.
- Requirement: A target is required for KPIs used to determine goal success. Supporting observational metrics may be explicitly `MONITOR_ONLY`.
- Condition: Generated from E06.Q04.
- Validation: Target unit must match KPI unit; ranking targets need keyword, location, device, and search surface; `MONITOR_ONLY` metrics cannot be used to claim that a goal passed or failed.
- Evidence: Rationale or benchmark optional but recommended.
- Sensitivity: NORMAL or INTERNAL.
- Export destination: `Measurement Plan → Targets`.

### E06.Q06 — Leading and outcome indicators

- Question: **Which KPIs are early signals and which represent final business outcomes?**
- Purpose: Prevents impressions, clicks, or rankings from being confused with revenue or profit.
- Answer type: Classification per KPI.
- Options: Activity, leading indicator, conversion, revenue, profit, retention, operational efficiency.
- Requirement: Required for every KPI.
- Condition: Generated from E06.Q04.
- Validation: One classification per KPI; revenue/profit metrics require E14 definitions.
- Evidence: None.
- Sensitivity: NORMAL.
- Export destination: `Measurement Plan → KPI role`.

### E06.Q07 — Data sources and readiness

- Question: **Where will each KPI come from, and is that source currently accessible?**
- Purpose: Separates measurable goals from metrics that cannot yet be collected.
- Answer type: Source, access status, collection method, and responsible person.
- Requirement: Required for every KPI.
- Condition: Generated from E06.Q04.
- Validation: Access status must be `READY`, `NEEDS_ACCESS`, `NOT_CONFIGURED`, or `MANUAL`.
- Evidence: Source link/name; never store credentials in questionnaire answers.
- Sensitivity: INTERNAL; account identifiers may be SENSITIVE.
- Export destination: `Measurement Plan → Data readiness`, excluding sensitive identifiers.

### E06.Q08 — Result interpretation rules

- Question: **What must a report say when a target is missed, data is unavailable, or attribution is uncertain?**
- Purpose: Keeps reporting honest and aligned with the brand voice.
- Answer type: Required reporting rules.
- Requirement: Required.
- Condition: Always shown.
- Validation: Must distinguish zero from unavailable, target from guarantee, and correlation from attribution.
- Evidence: None.
- Sensitivity: NORMAL.
- Export destination: `Reporting Rules → Interpretation`.

### E06.Q09 — Goal approval authority

- Question: **Who approves goals, KPI definitions, and target changes?**
- Purpose: Prevents AI or imported data from silently changing success criteria.
- Answer type: Owner/role selection and change-note rule.
- Requirement: Required.
- Condition: Always shown.
- Validation: One authority required; changes after approval need reason and version history.
- Evidence: None.
- Sensitivity: INTERNAL.
- Export destination: `Approval Rules → Goal authority`.

## E06 review checklist

- [x] Goals describe business outcomes rather than activities alone.
- [x] Every goal has a period, baseline status, KPI, and target status.
- [x] KPI definitions include unit, source, frequency, and owner.
- [x] Leading indicators are not confused with revenue or profit.
- [x] Rank goals include keyword/location/device/search-surface context.
- [x] Missing data and uncertain attribution are reported honestly.
- [x] Goal or target changes require human approval and history.

E06 status: **APPROVED using the ResultGrid Digital seed answers on 21 September 2026**.

## E07 — Website, SEO, and local presence

### E07.Q01 — Website status

- Question: **Does the business have a live website or approved domain?**
- Purpose: Establishes the owned web destination and prevents invented URLs.
- Answer type: Status, URL/domain, ownership, platform, and launch state.
- Options: Live, being built, domain only, planned, not needed.
- Requirement: Required as a status; URL is conditional.
- Condition: Always shown.
- Validation: Valid domain/URL when supplied; ownership status required.
- Evidence: Live URL, registrar record reference, or project link. Never collect registrar credentials.
- Sensitivity: NORMAL for public URL; ownership/account identifiers are INTERNAL.
- Export destination: `Digital Presence → Website status`.

### E07.Q02 — Website purpose and conversion actions

- Question: **What should visitors do on the website?**
- Purpose: Connects pages and SEO traffic to measurable actions.
- Answer type: Ordered conversion actions.
- Examples: Book a meeting, call, WhatsApp, submit a form, buy, request a quote, download, visit a location.
- Requirement: Required when website status is live/being built/planned; otherwise `NOT_APPLICABLE`.
- Condition: Based on E07.Q01.
- Validation: At least one primary action and optional secondary actions.
- Evidence: Optional live page/form link.
- Sensitivity: NORMAL.
- Export destination: `Digital Presence → Website conversions`.

### E07.Q03 — Website ownership and access readiness

- Question: **Who controls the domain, website platform, analytics, and deployment, and is working access available?**
- Purpose: Identifies dependencies without storing credentials.
- Answer type: System/account category, owner, access status, and needed action.
- Requirement: Required for existing assets; `NOT_APPLICABLE` when none exist.
- Condition: Based on E07.Q01.
- Validation: Access status must be `READY`, `NEEDS_INVITE`, `UNKNOWN`, or `NOT_APPLICABLE`.
- Evidence: Optional masked account reference or invitation status; never password/token.
- Sensitivity: SENSITIVE and excluded from standard exports.
- Export destination: `Access Readiness → Website systems`, with sensitive identifiers removed.

### E07.Q04 — Google Business Profile and local listings

- Question: **Does the business have a Google Business Profile or other local listings?**
- Purpose: Establishes local-search presence and its ownership/status.
- Answer type: Repeatable profile entries with platform, public URL, status, location, owner, and access readiness.
- Requirement: Required as a status for location/service-area businesses; `NOT_STARTED` is valid.
- Condition: Business serves a physical location or service area.
- Validation: No claim of ownership/verification without evidence.
- Evidence: Public listing URL and dated verification/access evidence.
- Sensitivity: Public URL is NORMAL; account/access details are SENSITIVE.
- Export destination: `Local Presence → Profiles and status`.

### E07.Q05 — Search measurement tools

- Question: **Which search and website measurement sources exist and are accessible?**
- Purpose: Determines whether traffic, query, conversion, and technical data can be measured.
- Answer type: Google Search Console, analytics platform, tag manager, rank observation method, other; each with status.
- Requirement: Required as a readiness status when a website exists; `NOT_CONFIGURED` is valid.
- Condition: Based on E07.Q01.
- Validation: Source, property scope, and access status required; no credentials.
- Evidence: Masked property reference or screenshot/export.
- Sensitivity: INTERNAL/SENSITIVE.
- Export destination: `Measurement Plan → Search/web sources`, with sensitive identifiers removed.

### E07.Q06 — SEO baseline

- Question: **What is currently known about organic visibility, technical health, content, backlinks/citations, and local ranking?**
- Purpose: Creates a dated starting point before goals or actions are attributed to the project.
- Answer type: Structured baseline areas with value, source, date, and confidence; `NO_BASELINE` allowed.
- Requirement: Required as a status for SEO or full-digital-marketing projects.
- Condition: Project type includes SEO/full digital marketing or SEO is selected as a goal.
- Validation: Every measured statement needs source/date/scope; `NO_BASELINE` creates a measurement action.
- Evidence: Search Console export, crawl/audit, listing report, dated manual observation, or third-party report.
- Sensitivity: INTERNAL until approved summary.
- Export destination: `SEO Baseline → Findings and evidence status`.

### E07.Q07 — Keyword universe and priority set

- Question: **Which commercially relevant queries should be researched and tracked, and why?**
- Purpose: Builds keyword tracking from customer intent rather than an arbitrary count.
- Answer type: Candidate keyword themes, intent, offer, location, target page, and evidence; later approved keyword records.
- Requirement: Required for SEO/full-digital projects; candidate list may begin as `NOT_RESEARCHED` and creates research work.
- Condition: Same as E07.Q06.
- Validation: Final tracked keywords require location, language, device, search surface, target page, and commercial relevance.
- Evidence: Search Console, keyword research, GBP insights, customer language, or documented observation.
- Sensitivity: NORMAL/INTERNAL.
- Export destination: `SEO Plan → Keyword themes and approved tracking set`.

### E07.Q08 — Search goals and non-guarantee

- Question: **What search visibility target is desired, and how must it be qualified?**
- Purpose: Records ambition without treating rankings as controllable guarantees.
- Answer type: Goal statement plus measurement scope and non-guarantee acknowledgement.
- Requirement: Required when SEO/local visibility is in scope.
- Condition: Same as E07.Q06.
- Validation: Rank targets require keyword set, location, device, surface, date, and observation method; acknowledgement required.
- Evidence: Goal rationale optional.
- Sensitivity: NORMAL.
- Export destination: `SEO Goals → Target and limitations`.

### E07.Q09 — SEO and local constraints

- Question: **What limits website, SEO, Google Business Profile, or listing changes?**
- Purpose: Records access, platform, location, policy, content, development, and approval constraints before planning work.
- Answer type: Repeatable constraint entries with owner and resolution status; `None known` allowed.
- Requirement: Required.
- Condition: SEO, website, or local presence applies.
- Validation: Each known constraint needs an owner/status.
- Evidence: Optional platform/policy/source reference.
- Sensitivity: INTERNAL.
- Export destination: `Constraints → Website/SEO/local`.

## E07 review checklist

- [x] Website and domain existence/ownership are not inferred.
- [x] Conversion actions are explicit.
- [x] Access status is recorded without credentials.
- [x] Local profile ownership and verification require evidence.
- [x] SEO baselines are dated and sourced or explicitly absent.
- [x] Keyword tracking is based on commercial relevance, not a forced count alone.
- [x] Rank targets include full measurement context and no guarantee.

E07 questionnaire content is **APPROVED using the ResultGrid Digital seed baseline on 21 September 2026**. The seed project's search target remains open and prevents final project approval, but it does not prevent continuing discovery.

## E08 — Social channels and content history

### E08.Q01 — Social presence status

- Question: **Does the business currently have any social media profiles or channels?**
- Purpose: Distinguishes an existing presence from a new setup.
- Answer type: Status plus notes.
- Options: Active profiles, inactive profiles, profiles being created, no profiles yet, social not in scope.
- Requirement: Required as a status; `no profiles yet` and `social not in scope` are valid.
- Condition: Always shown.
- Validation: One status required.
- Evidence: Optional public profile link.
- Sensitivity: NORMAL.
- Export destination: `Social Presence → Current status`.

### E08.Q02 — Channel inventory and access

- Question: **Which profiles/channels exist, who controls them, and is working access available?**
- Purpose: Creates an accurate channel inventory without collecting credentials.
- Answer type: Repeatable platform, public URL/handle, business purpose, owner, and access status.
- Requirement: Conditional; required only when profiles exist.
- Condition: E08.Q01 indicates current/inactive/being-created profiles.
- Validation: Access status must be `READY`, `NEEDS_INVITE`, `UNKNOWN`, or `NOT_APPLICABLE`; never store passwords/tokens.
- Evidence: Public URL and masked ownership/access evidence.
- Sensitivity: Public profile is NORMAL; account/access information is SENSITIVE.
- Export destination: `Social Presence → Channel inventory`, excluding sensitive access data.

### E08.Q03 — Planned channels

- Question: **Which social channels should be created or prioritized, and what role should each play?**
- Purpose: Prevents opening channels without a clear audience or business purpose.
- Answer type: Ordered platform list with purpose, audience, and desired action.
- Requirement: Required when social media is in project scope; `UNDECIDED` allowed during draft.
- Condition: E08.Q01 is not `social not in scope`.
- Validation: Each selected channel needs a purpose and intended conversion/action.
- Evidence: Optional audience/channel research.
- Sensitivity: NORMAL.
- Export destination: `Social Plan → Channel roles and priority`.

### E08.Q04 — Audience and follower baseline

- Question: **What is the current audience baseline on each existing channel?**
- Purpose: Enables later progress comparisons without treating a new account as missing data.
- Answer type: Followers/subscribers, reach/engagement period, date, and source; `NO_BASELINE` valid.
- Requirement: Conditional for existing profiles; otherwise `NOT_APPLICABLE`.
- Condition: Based on E08.Q01/Q02.
- Validation: Date/source required for numeric values.
- Evidence: Platform export or dated screenshot.
- Sensitivity: INTERNAL until approved summary.
- Export destination: `Social Baseline → Audience metrics`.

### E08.Q05 — Content history and performance

- Question: **What content has been published, and what is known about its performance?**
- Purpose: Identifies useful patterns without inventing lessons from absent history.
- Answer type: Date range, content categories/formats, posting frequency, metrics, and findings; `NO_HISTORY` valid.
- Requirement: Conditional for existing/inactive profiles; `NO_HISTORY` is valid.
- Condition: Based on E08.Q01.
- Validation: Performance conclusions need source, period, and metric definition.
- Evidence: Platform export/report or dated observation.
- Sensitivity: INTERNAL.
- Export destination: `Social Baseline → Content history and evidence-backed findings`.

### E08.Q06 — Content formats and production responsibility

- Question: **Which content formats can be produced, and who will create or supply each one?**
- Purpose: Aligns content plans with real production capacity and the video-editing constraint.
- Answer type: Repeatable format, owner/supplier, capacity, and constraint.
- Requirement: Required when social is in scope.
- Condition: E08.Q01 is not `social not in scope`.
- Validation: Each priority format needs a responsible source and realistic frequency/capacity.
- Evidence: Optional sample or asset reference.
- Sensitivity: INTERNAL.
- Export destination: `Social Plan → Production capability`.

### E08.Q07 — Social content approval and publishing

- Question: **Who drafts, reviews, approves, and publishes social content?**
- Purpose: Establishes human control and prevents automatic publication.
- Answer type: Role per stage plus lead-time rule.
- Requirement: Required when social is in scope.
- Condition: E08.Q01 is not `social not in scope`.
- Validation: Final approver required; publishing cannot precede approval.
- Evidence: None.
- Sensitivity: INTERNAL.
- Export destination: `Approval Rules → Social content workflow`.

### E08.Q08 — Social constraints

- Question: **What topics, formats, platforms, frequencies, or activities should be avoided?**
- Purpose: Captures brand, resource, platform, and preference limits.
- Answer type: Repeatable constraints; `None known` allowed.
- Requirement: Required when social is in scope.
- Condition: E08.Q01 is not `social not in scope`.
- Validation: Each known constraint needs a reason or source.
- Evidence: Optional platform/brand policy.
- Sensitivity: INTERNAL.
- Export destination: `Constraints → Social media`.

## E08 review checklist

- [x] No existing profile or history is required when none exists.
- [x] Public profile information and sensitive access data are separated.
- [x] Planned channels have a purpose and intended action.
- [x] Baseline metrics are dated and sourced.
- [x] Content production reflects real capacity.
- [x] Human approval is required before publishing.
- [x] Video-editing and other production constraints are explicit.

E08 questionnaire content is **APPROVED using the ResultGrid Digital seed baseline on 21 September 2026**. Seed channel-role mapping and constraints remain open before project approval.

## E09 — Advertising accounts, access status, and budget

### E09.Q01 — Advertising status

- Question: **Is paid advertising currently running, previously used, planned, or outside scope?**
- Purpose: Allows a valid no-advertising baseline without forcing account details.
- Answer type: Single status plus notes.
- Options: Running, paused, previously used, planned, not decided, out of scope.
- Requirement: Required as a status; nullable details are allowed when ads have not started.
- Condition: Always shown.
- Validation: One status required.
- Evidence: Optional report or account reference.
- Sensitivity: NORMAL status; account details are SENSITIVE.
- Export destination: `Paid Media → Current status`.

### E09.Q02 — Advertising account inventory and access

- Question: **Which advertising accounts/assets exist, who owns them, and is working access available?**
- Purpose: Records readiness without collecting credentials.
- Answer type: Repeatable platform, asset type, owner, masked identifier, and access status.
- Requirement: Conditional when accounts/assets exist; otherwise `NOT_APPLICABLE`.
- Condition: E09.Q01 is running/paused/previously used.
- Validation: Access status must be `READY`, `NEEDS_INVITE`, `UNKNOWN`, or `NOT_APPLICABLE`; no password/token/payment-card data.
- Evidence: Masked account reference or invitation status.
- Sensitivity: SENSITIVE; excluded from standard exports.
- Export destination: `Access Readiness → Advertising`, redacted.

### E09.Q03 — Planned advertising platforms

- Question: **Which platforms should be evaluated or used first?**
- Purpose: Keeps channel selection tied to audience, objective, and budget.
- Answer type: Ordered platforms with rationale; `UNDECIDED` allowed in draft.
- Requirement: Required when ads are planned.
- Condition: E09.Q01 is planned/running/paused.
- Validation: Each platform requires target audience, objective, and rationale before approval.
- Evidence: Optional research.
- Sensitivity: NORMAL.
- Export destination: `Paid Media → Platform priority`.

### E09.Q04 — Advertising objectives and conversions

- Question: **What should paid advertising achieve, and which conversion events will count?**
- Purpose: Prevents spend without a measurable business outcome.
- Answer type: Ordered objectives linked to exact conversion definitions.
- Requirement: Required before any campaign is approved.
- Condition: Ads are in scope.
- Validation: At least one objective and conversion; awareness-only plans require an approved reach/recall measurement rule.
- Evidence: Measurement plan.
- Sensitivity: NORMAL.
- Export destination: `Paid Media → Objectives and conversions`.

### E09.Q05 — Budget and spending limits

- Question: **What budget, period, currency, and hard spending limit are approved?**
- Purpose: Separates available spend from agency fees and prevents uncontrolled cost.
- Answer type: Amount/range, period, currency, hard cap, and approval note; `UNDECIDED` allowed before launch.
- Requirement: Required before advertising activation; may be `UNDECIDED` during discovery.
- Condition: Ads are in scope.
- Validation: Non-negative amount; hard cap cannot be lower than planned spend; currency/period required.
- Evidence: Owner approval.
- Sensitivity: INTERNAL.
- Export destination: `Paid Media → Approved budget`, only when selected for export.

### E09.Q06 — Payment responsibility

- Question: **Who pays the platform directly, and how are fees, taxes, credits, and refunds recorded?**
- Purpose: Prevents platform spend from being confused with ResultGrid Digital fees or other costs.
- Answer type: Payer role, payment path, and accounting rules.
- Requirement: Required before advertising activation.
- Condition: Ads are in scope.
- Validation: Payment-card/bank credentials must never be collected; responsibility must be explicit.
- Evidence: Invoice/receipt reference after spend.
- Sensitivity: SENSITIVE; standard export contains only responsibility, not payment details.
- Export destination: `Cost Rules → Paid-media responsibility`.

### E09.Q07 — Tracking readiness

- Question: **Are conversion tracking, analytics, pixels/tags, consent, and landing pages ready?**
- Purpose: Makes tracking gaps visible before spend begins.
- Answer type: Component checklist with `READY`, `NEEDS_SETUP`, `BLOCKED`, or `NOT_APPLICABLE`.
- Requirement: Required before campaign approval.
- Condition: Ads are in scope.
- Validation: Blocking components prevent activation unless Owner records an exception and accepts measurement limitations.
- Evidence: Dated setup/test evidence.
- Sensitivity: INTERNAL/SENSITIVE.
- Export destination: `Paid Media → Tracking readiness`, redacted.

### E09.Q08 — Advertising history and baseline

- Question: **What prior spend, delivery, conversions, revenue, and lessons are available?**
- Purpose: Preserves history while allowing a valid new-account state.
- Answer type: Period metrics and findings; `NO_HISTORY` valid.
- Requirement: Required as a status when advertising applies.
- Condition: Ads are in scope.
- Validation: Values need currency/unit, date range, source, and attribution rule.
- Evidence: Platform report and business records.
- Sensitivity: INTERNAL.
- Export destination: `Paid Media Baseline → History and evidence`.

### E09.Q09 — Approval and stop rules

- Question: **Who approves campaigns, budget changes, and pausing, and what conditions require ads to stop?**
- Purpose: Keeps spending and campaign decisions under human control.
- Answer type: Authority plus change/stop rules.
- Requirement: Required before advertising activation.
- Condition: Ads are in scope.
- Validation: One final approver, hard-cap behavior, and at least one emergency stop path required.
- Evidence: None.
- Sensitivity: INTERNAL.
- Export destination: `Approval Rules → Paid media`.

### E09.Q10 — Advertising constraints

- Question: **Which offers, audiences, locations, claims, creative formats, or platform practices are prohibited or undecided?**
- Purpose: Captures scope and policy limits before campaigns are designed.
- Answer type: Constraint list; `None known` allowed only after review.
- Requirement: Required before advertising activation.
- Condition: Ads are in scope.
- Validation: Legal/platform constraints should cite a source; undecided items remain open.
- Evidence: Policy/legal/brand source where relevant.
- Sensitivity: INTERNAL.
- Export destination: `Constraints → Paid advertising`.

## E09 review checklist

- [x] No account, history, or budget is forced before ads exist.
- [x] Platform spend and ResultGrid Digital fees are distinct.
- [x] Credentials and payment details are never questionnaire answers.
- [x] Objectives connect to defined conversions.
- [x] Tracking readiness is checked before spend.
- [x] Human approval, hard caps, and stop rules are explicit.
- [x] Historical results include date, source, unit, and attribution limits.

E09 questionnaire content is **APPROVED using the ResultGrid Digital seed baseline on 21 September 2026**. Operational activation items remain open.

## E10 — Offer, conversion path, sales process, and follow-up

### E10.Q01 — Primary call to action by offer

- Question: **What should an interested customer do next for each priority offer?**
- Purpose: Connects each offer to one clear conversion path.
- Answer type: Primary and optional secondary action per priority offer.
- Options: Book meeting, request quote, call, WhatsApp, submit lead form, buy, visit, other.
- Requirement: Required for every priority offer.
- Condition: Generated from E02.Q04.
- Validation: Exactly one primary action per offer.
- Evidence: Optional live link/form when available.
- Sensitivity: NORMAL.
- Export destination: `Conversion Plan → Offer calls to action`.

### E10.Q02 — Lead capture fields and consent

- Question: **What information should be collected from a new lead, and what consent/privacy text is required?**
- Purpose: Collects enough information to respond without gathering unnecessary personal data.
- Answer type: Field list with required/optional status, purpose, retention, and consent statement.
- Requirement: Required before any lead form is published.
- Condition: A form, booking, quote, or messaging conversion exists.
- Validation: Every field needs a business purpose; credentials, highly sensitive data, and irrelevant personal data are prohibited.
- Evidence: Approved form/privacy copy.
- Sensitivity: INTERNAL/SENSITIVE according to field.
- Export destination: `Conversion Plan → Lead fields and consent`, excluding collected lead values.

### E10.Q03 — Lead source and deduplication

- Question: **How will lead source be recorded and duplicate enquiries identified?**
- Purpose: Prevents the same person from being counted multiple times and supports honest acquisition reporting.
- Answer type: Source taxonomy, identifiers used for matching, and merge/review rule.
- Requirement: Required before result reporting.
- Condition: Lead tracking is in scope.
- Validation: Source must distinguish channel/campaign where available; deduplication must not silently merge uncertain people.
- Evidence: None.
- Sensitivity: INTERNAL/SENSITIVE.
- Export destination: `Measurement Rules → Lead source and deduplication`.

### E10.Q04 — Response responsibility and time

- Question: **Who responds to new leads, during which hours, and within what target time?**
- Purpose: Connects lead generation to real follow-up capacity.
- Answer type: Owner/role, service hours, response target, and fallback.
- Requirement: Required.
- Condition: Always shown.
- Validation: Responsible person and target required; no unrealistic 24/7 claim without staffing.
- Evidence: None.
- Sensitivity: INTERNAL.
- Export destination: `Sales Process → Lead response rule`.

### E10.Q05 — Qualification criteria

- Question: **What makes a lead suitable, unsuitable, or in need of further review?**
- Purpose: Defines qualified leads consistently and incorporates budget/market-position fit.
- Answer type: Required, preferred, disqualifying, and review criteria.
- Requirement: Required.
- Condition: Always shown.
- Validation: Criteria must be relevant, lawful, and non-discriminatory; willingness/ability to invest may be included.
- Evidence: Optional sales experience.
- Sensitivity: INTERNAL.
- Export destination: `Sales Process → Qualification rules`.

### E10.Q06 — Sales stages and conversion definitions

- Question: **Which stages does a lead pass through, and what exact event moves it to the next stage?**
- Purpose: Makes conversion rate and acquired-customer counts consistent.
- Answer type: Ordered stages with entry/exit event.
- Requirement: Required.
- Condition: Always shown.
- Validation: Must define `new lead`, `qualified lead`, `meeting booked`, `quote sent`, `won/paying client`, and `lost` or approved alternatives.
- Evidence: None.
- Sensitivity: INTERNAL.
- Export destination: `Sales Process → Stages and definitions`.

### E10.Q07 — Meeting and quote workflow

- Question: **How are meetings booked, prepared, completed, and turned into quotes?**
- Purpose: Defines the two selected conversion paths beyond the initial click/form.
- Answer type: Step sequence, tools, required information, owner, and timing.
- Requirement: Required.
- Condition: Meeting booking or quote request is a selected action.
- Validation: Each step needs an owner; quote assumptions and validity period must be explicit.
- Evidence: Optional template or scheduling link.
- Sensitivity: INTERNAL.
- Export destination: `Sales Process → Meeting and quote workflow`.

### E10.Q08 — Follow-up cadence

- Question: **How and when should a lead be followed up if there is no response or decision?**
- Purpose: Creates consistent follow-up without uncontrolled automation or spam.
- Answer type: Ordered follow-up steps with timing, channel, stop condition, and Owner control.
- Requirement: Required before active lead generation.
- Condition: Lead capture is in scope.
- Validation: Must include opt-out/stop behavior and a maximum number of attempts.
- Evidence: Optional approved message templates.
- Sensitivity: INTERNAL.
- Export destination: `Sales Process → Follow-up rules`.

### E10.Q09 — Win, loss, and payment-start rules

- Question: **When is a client counted as acquired, and how are lost or delayed opportunities recorded?**
- Purpose: Prevents meetings or verbal interest from being counted as paying clients.
- Answer type: Won event, payment requirement, lost reasons, pending rule, refund/cancellation treatment.
- Requirement: Required.
- Condition: Always shown.
- Validation: `Acquired/paying client` must be tied to an approved commercial event such as received payment or signed agreement.
- Evidence: Invoice/payment/agreement reference; sensitive details excluded from standard exports.
- Sensitivity: INTERNAL/SENSITIVE.
- Export destination: `Measurement Rules → Acquisition and loss`.

### E10.Q10 — Sales record location

- Question: **Where will leads, stages, notes, meetings, quotes, and outcomes be recorded?**
- Purpose: Establishes one source of truth and prevents leads from disappearing across chats and spreadsheets.
- Answer type: Selected system and any temporary intake channels.
- Requirement: Required.
- Condition: Always shown.
- Validation: One authoritative record location required; temporary channels need a transfer rule.
- Evidence: None.
- Sensitivity: SENSITIVE.
- Export destination: `Operating Rules → Sales source of truth`, without lead data.

## E10 review checklist

- [x] Every priority offer has one primary call to action.
- [x] Lead forms collect only necessary data with appropriate consent.
- [x] Lead source and duplicates have explicit rules.
- [x] Response responsibility and realistic timing are defined.
- [x] Qualified lead, booked meeting, quote, paying client, and lost lead are measurable events.
- [x] Follow-up has a limit and stop/opt-out behavior.
- [x] Client acquisition requires a real commercial event.
- [x] One system is the authoritative sales record.

E10 status: **APPROVED using the ResultGrid Digital seed answers on 21 September 2026**.

## E11 — Available assets, evidence, and reporting sources

### E11.Q01 — Asset inventory

- Question: **Which usable business, brand, marketing, and technical assets currently exist?**
- Purpose: Prevents planning from assuming that logos, photos, copy, domains, accounts, templates, or code already exist.
- Answer type: Repeatable asset entries with type, status, location, owner, and project use.
- Requirement: Required as a status; `NO_ASSETS` is valid.
- Condition: Always shown.
- Validation: Each asset needs a source/owner and approval status.
- Evidence: File or source link.
- Sensitivity: NORMAL, INTERNAL, or SENSITIVE per asset.
- Export destination: `Available Assets → Approved inventory`, excluding sensitive locations/details.

### E11.Q02 — Ownership and usage rights

- Question: **Who created/owns each supplied asset, and may it be edited and published for this project?**
- Purpose: Avoids using material without confirmed rights or confusing inspiration with approved source assets.
- Answer type: Per-asset ownership, permission, editability, source, and restriction.
- Requirement: Required before an asset is used or published.
- Condition: Generated from E11.Q01 assets.
- Validation: Unknown rights keep the asset unavailable for publication.
- Evidence: Owner confirmation, license, purchase, agreement, or source reference.
- Sensitivity: INTERNAL.
- Export destination: `Asset Rules → Ownership and permitted use`.

### E11.Q03 — Evidence inventory

- Question: **What existing evidence supports business, capability, performance, customer, or market claims?**
- Purpose: Connects claims and decisions to traceable proof.
- Answer type: Repeatable evidence record with claim supported, source, date range, scope, reliability, and file/link.
- Requirement: Required as a status; `NO_EVIDENCE_YET` is valid but unsupported claims remain blocked.
- Condition: Always shown.
- Validation: Source/date/scope required before evidence can be marked verified.
- Evidence: The referenced source itself.
- Sensitivity: Usually INTERNAL; client/customer data may be SENSITIVE.
- Export destination: `Evidence Register → Approved summaries and references`.

### E11.Q04 — Data-source inventory

- Question: **Which systems or records can supply operational, marketing, sales, cost, and result data?**
- Purpose: Defines where metrics come from and avoids counting unavailable sources as connected.
- Answer type: Repeatable source, data supplied, owner, access status, collection method, and update frequency.
- Requirement: Required.
- Condition: Always shown.
- Validation: Access status must be `READY`, `NEEDS_ACCESS`, `NOT_CONFIGURED`, `MANUAL`, or `NOT_APPLICABLE`; never store credentials.
- Evidence: Masked source/property reference.
- Sensitivity: INTERNAL/SENSITIVE.
- Export destination: `Data Readiness → Sources and status`, redacted.

### E11.Q05 — Evidence verification status

- Question: **Who checked each evidence item, when, and what exactly does it prove?**
- Purpose: Prevents a file or screenshot from being treated as proof of a broader claim than it supports.
- Answer type: Verification status, reviewer, date, supported statement, limitations.
- Requirement: Required before evidence is used in approved reporting or public claims.
- Condition: Generated from E11.Q03.
- Validation: `UNVERIFIED`, `VERIFIED`, `PARTIALLY_VERIFIED`, or `REJECTED`; limitations required except for fully verified items.
- Evidence: Review record.
- Sensitivity: INTERNAL.
- Export destination: `Evidence Register → Verification and limitations`.

### E11.Q06 — File organization and naming

- Question: **How should files be grouped, named, versioned, and linked to clients/projects?**
- Purpose: Keeps VS Code and application records findable and prevents disconnected files.
- Answer type: Naming pattern, allowed folders/categories, version convention, and relationship rule.
- Requirement: Required before file import/attachment use.
- Condition: Always shown.
- Validation: Every stored file needs workspace/client/project IDs or relationships; duplicate names alone are not identifiers.
- Evidence: None.
- Sensitivity: INTERNAL.
- Export destination: `Operating Rules → File organization`.

### E11.Q07 — Reporting source priority

- Question: **When two sources disagree, which source wins for each metric?**
- Purpose: Creates deterministic reports and avoids silently choosing a favorable number.
- Answer type: Metric-to-source priority map and discrepancy rule.
- Requirement: Required before a metric is reported from multiple sources.
- Condition: E11.Q04 lists overlapping sources.
- Validation: Priority and discrepancy note required; raw values remain preserved.
- Evidence: Source documentation or Owner decision.
- Sensitivity: INTERNAL.
- Export destination: `Reporting Rules → Source priority`.

### E11.Q08 — Data freshness and missing data

- Question: **How fresh must each source be, and what should happen when an update is late or unavailable?**
- Purpose: Prevents stale data from appearing current.
- Answer type: Source/metric freshness threshold, update cadence, and missing-data display rule.
- Requirement: Required for recurring reports.
- Condition: Reporting is in scope.
- Validation: Missing/unavailable must remain distinct from zero; last-updated time must be shown.
- Evidence: None.
- Sensitivity: NORMAL rules.
- Export destination: `Reporting Rules → Freshness and missing data`.

### E11.Q09 — Report outputs and recipients

- Question: **Which reports/exports are needed, who may receive them, and how often?**
- Purpose: Ensures each output has a real audience and privacy boundary.
- Answer type: Report name, content, recipient role, cadence, language, and delivery method.
- Requirement: Required.
- Condition: Always shown.
- Validation: Recipient may only receive authorized client/project data; sensitive fields excluded by default.
- Evidence: None.
- Sensitivity: INTERNAL.
- Export destination: `Reporting Plan → Outputs and recipients`.

## E11 review checklist

- [x] Missing assets and evidence have valid explicit states.
- [x] Ownership and publishing permission are confirmed before asset use.
- [x] Evidence states exactly what it supports and its limits.
- [x] Data sources include access, collection, and update status without credentials.
- [x] Conflicting sources have a priority/discrepancy rule.
- [x] Stale/unavailable values never appear as current or zero.
- [x] Report recipients receive only authorized data.

E11 status: **APPROVED using the ResultGrid Digital seed answers on 21 September 2026**.

## E12 — Legal, privacy, claim, and publishing constraints

### E12.Q01 — Registration and contracting status

- Question: **What legal/registration status applies, and in whose name can work, invoices, or agreements currently be issued?**
- Purpose: Prevents the system from presenting an unregistered brand as a registered entity or inventing billing identity.
- Answer type: Status, current contracting/billing name, country, and planned review trigger.
- Requirement: Required.
- Condition: Always shown.
- Validation: Do not collect national ID, tax credentials, or bank details in this questionnaire.
- Evidence: Optional registration/agreement reference stored securely.
- Sensitivity: INTERNAL/SENSITIVE.
- Export destination: Standard AI context includes only operational status and limitations, not identifiers.

### E12.Q02 — Privacy notice and lawful data collection

- Question: **What privacy notice will explain lead/client data collection, purpose, retention, sharing, and contact rights?**
- Purpose: Ensures lead forms and client records have an approved transparency statement.
- Answer type: Status, approved text/link, jurisdiction notes, and owner.
- Requirement: Required before collecting production lead data.
- Condition: Lead/client personal data is collected.
- Validation: Must cover collected fields, purposes, retention, processors/sharing, contact method, and deletion/correction request path; legal review status must be stated.
- Evidence: Approved privacy page/document.
- Sensitivity: NORMAL public text; legal notes INTERNAL.
- Export destination: `Privacy Rules → Notice status and link`.

### E12.Q03 — Confidential and prohibited data

- Question: **Which information must never be entered into ResultGrid Digital, and which information requires restricted handling?**
- Purpose: Prevents credentials and unnecessary sensitive data from entering the system or AI exports.
- Answer type: Prohibited and restricted-data lists.
- Requirement: Required.
- Condition: Always shown.
- Validation: Credentials, passwords, TOTP secrets/codes, access tokens, private keys, complete payment-card/bank authentication data, and unnecessary identity documents are prohibited.
- Evidence: None.
- Sensitivity: NORMAL rule text.
- Export destination: `Privacy Rules → Data restrictions`.

### E12.Q04 — Client confidentiality and AI use

- Question: **What client information may be placed in ChatGPT/Claude context files, and what must be removed or anonymized?**
- Purpose: Defines the boundary for subscription-based AI work without assuming client permission.
- Answer type: Allowed, redacted, prohibited, and approval-required categories.
- Requirement: Required before client context export.
- Condition: AI-ready export is used.
- Validation: Credentials and unrelated client data always prohibited; sensitive/personal data excluded by default.
- Evidence: Client consent/agreement where needed.
- Sensitivity: INTERNAL.
- Export destination: `AI Context Rules → Privacy boundary`.

### E12.Q05 — Claims and proof

- Question: **Which performance, ranking, revenue, profit, or capability claims may be published, and what proof is required?**
- Purpose: Applies the confirmed no-guarantee policy consistently.
- Answer type: Claim category, allowed wording, required evidence, scope, expiry/recheck date, and approver.
- Requirement: Required before publishing a claim.
- Condition: Public claim/case study is planned.
- Validation: Numerical claims need date range, metric definition, source, subject/client permission, and limitations; targets are not results.
- Evidence: Verified evidence record.
- Sensitivity: INTERNAL rule; approved claim NORMAL.
- Export destination: `Claim Guardrails → Approved claims and evidence`.

### E12.Q06 — Content and asset rights

- Question: **What copyright, license, consent, or attribution rules apply to text, images, video, music, fonts, templates, code, and AI-generated material?**
- Purpose: Prevents unauthorized reuse and maintains source/permission records.
- Answer type: Rules by asset type plus source/license requirement.
- Requirement: Required before publication.
- Condition: Content/assets are produced or used.
- Validation: Unknown rights block publication; inspiration is not permission to copy.
- Evidence: License, owner consent, purchase, or source reference.
- Sensitivity: INTERNAL.
- Export destination: `Publishing Rules → Asset rights`.

### E12.Q07 — Regulated or sensitive industries

- Question: **Does the client/project involve health, beauty, finance, children, employment, or another regulated/sensitive subject?**
- Purpose: Triggers additional review for claims, consent, targeting, and platform policy.
- Answer type: Multi-select status plus project-specific constraints; `None` allowed.
- Requirement: Required.
- Condition: Always shown.
- Validation: Relevant category requires a policy/legal review task before related content/ads publish.
- Evidence: Applicable policy/legal source.
- Sensitivity: INTERNAL.
- Export destination: `Risk Context → Sensitive category and review status`.

### E12.Q08 — Publication approval

- Question: **Who must approve public content, ads, website changes, claims, and case studies before publication?**
- Purpose: Establishes final human authorization for external changes.
- Answer type: Approver and any client-approval requirement by content type.
- Requirement: Required.
- Condition: Publication is in scope.
- Validation: One final internal approver and any required client approver must be named; approval attaches to a version.
- Evidence: Approval record.
- Sensitivity: INTERNAL.
- Export destination: `Approval Rules → Publication`.

### E12.Q09 — Correction and removal rule

- Question: **What happens when published information is wrong, outdated, disputed, or permission is withdrawn?**
- Purpose: Creates a clear correction path instead of silently editing history.
- Answer type: Detection, stop/unpublish, correction, notification, evidence, and audit steps.
- Requirement: Required before publication.
- Condition: Publication is in scope.
- Validation: Must preserve internal history and record reason/date/approver.
- Evidence: Correction/removal record.
- Sensitivity: INTERNAL; public correction wording as approved.
- Export destination: `Publishing Rules → Correction/removal process`.

## E12 review checklist

- [x] Registration and billing identity are accurately described.
- [x] Production lead collection has an approved privacy notice before collection begins.
- [x] Prohibited credentials and sensitive data are explicit.
- [x] AI context exports exclude unrelated, credential, payment, and personal-contact data by default.
- [x] Numerical/public claims require scoped evidence and permission.
- [x] Asset rights are known before publication.
- [x] Sensitive industries trigger additional review.
- [x] External publication requires version-specific human approval.
- [x] Corrections/removals preserve an audit trail.

E12 status: **APPROVED using the ResultGrid Digital seed answers on 21 September 2026**.

## E13 — Project-specific scope, deadlines, and approval process

### E13.Q01 — Project objective and definition of done

- Question: **What exact business outcome should this project produce, and what observable result will mean the agreed work is complete?**
- Purpose: Prevents a broad service request from becoming an undefined project.
- Answer type: Objective, deliverables, measurable completion conditions, and exclusions.
- Requirement: Required.
- Condition: Always shown.
- Validation: Must describe an observable outcome; goals and guaranteed results remain distinct.
- Evidence: Optional brief/agreement.
- Sensitivity: INTERNAL.
- Export destination: `Project Scope → Objective and definition of done`.

### E13.Q02 — Included and excluded work

- Question: **Which services, channels, deliverables, and tasks are included, and which are explicitly outside this project?**
- Purpose: Establishes a clear scope boundary.
- Answer type: Included list and excluded list.
- Requirement: Required.
- Condition: Always shown.
- Validation: At least one included item; an explicit `No exclusions identified yet` state is allowed during draft only.
- Evidence: Optional proposal/agreement.
- Sensitivity: INTERNAL.
- Export destination: `Project Scope → In scope / Out of scope`.

### E13.Q03 — Deliverables, quantity, and acceptance criteria

- Question: **What must be delivered, in what quantity or frequency, and how will each deliverable be accepted?**
- Purpose: Converts the scope into reviewable outputs.
- Answer type: Repeatable deliverable table with owner, quantity/frequency, format, acceptance criteria, and evidence.
- Requirement: Required.
- Condition: Always shown.
- Validation: Every deliverable needs an owner and acceptance condition; unknown quantity must be resolved before approval.
- Evidence: Optional reference/example.
- Sensitivity: INTERNAL.
- Export destination: `Delivery Plan → Deliverables and acceptance`.

### E13.Q04 — Start date, deadline, and milestones

- Question: **When may work start, what is the final target date, and which milestones or recurring deadlines apply?**
- Purpose: Creates a realistic delivery calendar without inventing dates.
- Answer type: Start readiness/date, final target date, milestone table, timezone, and flexibility notes.
- Requirement: Required before project approval; dates may be `UNDECIDED` in draft.
- Condition: Always shown.
- Validation: Milestones must not precede the start date; dates use the project timezone.
- Evidence: Optional agreed schedule.
- Sensitivity: INTERNAL.
- Export destination: `Delivery Plan → Dates and milestones`.

### E13.Q05 — Dependencies and client inputs

- Question: **What access, files, information, decisions, payments, or approvals are needed before work or a milestone can proceed?**
- Purpose: Makes blockers visible and prevents delays from being treated as delivery failure.
- Answer type: Dependency list with owner, needed-by date, status, and blocking effect.
- Requirement: Required; `None known` allowed.
- Condition: Always shown.
- Validation: A blocking dependency must have an owner and status.
- Evidence: Optional request/receipt.
- Sensitivity: INTERNAL; credentials prohibited.
- Export destination: `Delivery Plan → Dependencies and blockers`.

### E13.Q06 — Working responsibilities

- Question: **Who prepares, reviews, approves, publishes, supplies data, and communicates for this project?**
- Purpose: Assigns responsibility without assuming every task belongs to Rana.
- Answer type: Responsibility matrix by activity.
- Requirement: Required.
- Condition: Always shown.
- Validation: Every applicable activity has one accountable person; unavailable roles are marked not applicable.
- Evidence: None.
- Sensitivity: INTERNAL.
- Export destination: `Project Governance → Responsibilities`.

### E13.Q07 — Review and approval timing

- Question: **Who approves each deliverable, how is approval recorded, and how long may review take?**
- Purpose: Defines the human approval gate for work and publication.
- Answer type: Deliverable/category, approver, response target, approval channel, and version rule.
- Requirement: Required.
- Condition: Deliverables require review or publication.
- Validation: Approval must identify the exact version; silence is not approval unless explicitly agreed for that project.
- Evidence: Approval record.
- Sensitivity: INTERNAL.
- Export destination: `Approval Rules → Project deliverables`.

### E13.Q08 — Revisions and change requests

- Question: **How many or what kind of revisions are included, what counts as a scope change, and how are new requests decided?**
- Purpose: Preserves the promised revision flexibility while protecting the schedule and scope.
- Answer type: Included revision rule, turnaround, scope-change test, decision owner, and impact treatment.
- Requirement: Required.
- Condition: Always shown.
- Validation: Must not imply unlimited work without a time/scope boundary; approved scope changes record impact on date and cost.
- Evidence: Change-request record.
- Sensitivity: INTERNAL.
- Export destination: `Project Governance → Revisions and changes`.

### E13.Q09 — Communication and status reporting

- Question: **Which channel will be used for decisions, routine communication, urgent issues, and status reports, and how often?**
- Purpose: Keeps decisions traceable while matching the client's communication preference.
- Answer type: Communication-purpose matrix plus reporting cadence.
- Requirement: Required.
- Condition: Always shown.
- Validation: Final decisions must be summarized in ResultGrid Digital even when agreed through WhatsApp, email, or a meeting.
- Evidence: Linked communication summary where relevant.
- Sensitivity: INTERNAL.
- Export destination: `Project Governance → Communication and reporting`.

### E13.Q10 — Pause, cancellation, and handover

- Question: **What happens if required input is late, the project is paused or cancelled, or completed work must be handed over?**
- Purpose: Defines a predictable operational close or pause path.
- Answer type: Pause triggers, overdue-input treatment, cancellation rule, deliverables/data to hand over, and responsible person.
- Requirement: Required before project approval; `To be agreed` allowed in draft.
- Condition: Always shown.
- Validation: Preserve completed work, approvals, financial records, and audit history; do not promise legal/refund terms that are not agreed.
- Evidence: Agreement/change record where applicable.
- Sensitivity: INTERNAL.
- Export destination: `Project Governance → Pause, cancellation, and handover`.

## E13 review checklist

- [x] Objective and completion conditions are observable.
- [x] Included work is explicit; unlisted requests require a case-by-case scope decision.
- [x] Deliverable categories and reporting frequency are recorded; project-specific acceptance details are required before approval.
- [x] Dates and milestones are confirmed or honestly marked undecided in draft.
- [x] Dependencies have owners and blocking status.
- [x] Responsibilities and approval authorities are assigned.
- [x] Approval records identify an exact version.
- [x] Revision flexibility has a project-specific cap and scope-change boundary.
- [x] Important decisions are captured in ResultGrid Digital.
- [x] Pause/cancellation/handover rules are defined.

E13 status: **APPROVED using the ResultGrid Digital seed answers on 21 September 2026; unresolved dates, quantities, and acceptance details remain per-project approval blockers rather than questionnaire-design gaps**.

## E14 — Costs, revenue, attribution, profitability, and progress targets

### E14.Q01 — Measurement levels

- Question: **At which levels must money, results, and profit be recorded and reported: business/client, project, campaign, channel, or individual activity?**
- Purpose: Prevents totals from different clients or campaigns being mixed.
- Answer type: Multi-select levels plus required allocation rule.
- Requirement: Required.
- Condition: Always shown.
- Validation: Every transaction/result has one business/client and project; optional lower levels cannot contradict the parent.
- Evidence: None.
- Sensitivity: FINANCIAL/INTERNAL.
- Export destination: `Measurement Model → Reporting levels`.

### E14.Q02 — Revenue records

- Question: **Which revenue amounts will be recorded, when are they recognized, and what source proves them?**
- Purpose: Defines revenue consistently.
- Answer type: Revenue category, gross/net basis, event date, status, source, and linked client/project.
- Requirement: Required.
- Condition: Profit or revenue reporting is enabled.
- Validation: Separate invoiced, received, refunded, cancelled, and pending amounts; unavailable is not zero.
- Evidence: Receipt/payment record, invoice where applicable, or approved manual source.
- Sensitivity: FINANCIAL/RESTRICTED.
- Export destination: `Financial Rules → Revenue`.

### E14.Q03 — Digital operating costs

- Question: **Which non-advertising digital costs will be tracked?**
- Purpose: Captures the real cost of delivering work.
- Answer type: Repeatable cost-category list with owner, recurrence, allocation, tax/fee treatment, and evidence rule.
- Requirement: Required.
- Condition: Cost/profit reporting is enabled.
- Validation: Categories distinguish direct project cost, shared overhead, and excluded personal cost.
- Evidence: Receipt/subscription statement or approved manual record.
- Sensitivity: FINANCIAL/RESTRICTED.
- Export destination: `Financial Rules → Operating costs`.

### E14.Q04 — Marketing spend

- Question: **Which marketing expenses count as media/marketing spend, and how are they separated from ResultGrid Digital fees and operating costs?**
- Purpose: Keeps ad spend, service income, and delivery expenses distinct.
- Answer type: Spend category, platform/vendor, payer, client/project/campaign allocation, period, and source.
- Requirement: Required.
- Condition: Marketing execution occurs.
- Validation: No spend may be counted for two clients/projects; platform spend and service fee are separate fields.
- Evidence: Platform report, receipt, or approved source.
- Sensitivity: FINANCIAL/RESTRICTED.
- Export destination: `Financial Rules → Marketing spend`.

### E14.Q05 — Service fees and reporting viewpoint

- Question: **From whose viewpoint is the report shown, and how should ResultGrid Digital's fee be treated in each view?**
- Purpose: Avoids calling the same fee revenue and client profit without context.
- Answer type: Owner/business view and client view rules.
- Requirement: Required.
- Condition: Client and ResultGrid Digital financial reports are produced.
- Validation: ResultGrid Digital fee is income in ResultGrid Digital's view and a cost in the client's view; views cannot be combined silently.
- Evidence: Agreement/payment record where applicable.
- Sensitivity: FINANCIAL/RESTRICTED.
- Export destination: `Financial Rules → Reporting viewpoint`.

### E14.Q06 — Currency

- Question: **Which currency is used per project, and is currency conversion needed in the MVP?**
- Purpose: Prevents invalid totals across currencies.
- Answer type: Project currency, transaction currency, conversion requirement, rate source/date.
- Requirement: Required.
- Condition: Always shown.
- Validation: Amounts in different currencies are never summed without an approved conversion record.
- Evidence: Exchange-rate source if conversion is used.
- Sensitivity: FINANCIAL/INTERNAL.
- Export destination: `Financial Rules → Currency`.

### E14.Q07 — Reporting periods

- Question: **Which time periods must the dashboard and reports support?**
- Purpose: Aligns data entry, comparisons, and reports.
- Answer type: Daily, weekly, monthly, campaign, and custom-range selections plus week/month boundary.
- Requirement: Required.
- Condition: Always shown.
- Validation: Timezone and inclusive date boundaries are explicit.
- Evidence: None.
- Sensitivity: INTERNAL.
- Export destination: `Measurement Model → Reporting periods`.

### E14.Q08 — Profit formulas

- Question: **What exact formulas should calculate ResultGrid Digital profit and client profit?**
- Purpose: Makes every displayed profit number reproducible.
- Answer type: Named formula definitions and included/excluded categories.
- Requirement: Required.
- Condition: Profit reporting is enabled.
- Validation: Formula inputs must exist for the selected period; incomplete inputs produce `INCOMPLETE`, not a misleading number.
- Evidence: Source links inherited from inputs.
- Sensitivity: FINANCIAL/RESTRICTED.
- Export destination: `Financial Rules → Profit formulas`.

### E14.Q09 — Result-to-revenue attribution

- Question: **When may a lead, booking, sale, or revenue amount be credited to a campaign/channel?**
- Purpose: Prevents correlation from being presented as marketing-caused revenue.
- Answer type: Attribution event, matching rule, window, precedence, manual override, and confidence/status.
- Requirement: Required.
- Condition: Marketing performance is connected to revenue.
- Validation: `ATTRIBUTED`, `ASSISTED`, `UNATTRIBUTED`, and `UNKNOWN` remain distinct; overrides require reason.
- Evidence: Lead source, tracking data, client confirmation, or approved manual record.
- Sensitivity: FINANCIAL/INTERNAL.
- Export destination: `Measurement Model → Attribution`.

### E14.Q10 — Targets and progress

- Question: **Which targets will be set, at what level and period, and how is progress calculated?**
- Purpose: Powers target-versus-actual progress without turning aspirations into results.
- Answer type: Metric, baseline, target, period, direction, actual source, and progress formula.
- Requirement: Required.
- Condition: Progress tracking is enabled.
- Validation: Target and actual use the same definition/unit/period; baseline may be `UNKNOWN` but must be labeled.
- Evidence: Source for actual values.
- Sensitivity: INTERNAL; financial targets RESTRICTED.
- Export destination: `Goals and KPIs → Targets and progress`.

### E14.Q11 — Data-entry methods

- Question: **For the MVP, which values are entered manually, imported by CSV, or retrieved from another source?**
- Purpose: Keeps automation limited to static/repetitive work as requested.
- Answer type: Data-source matrix with method, frequency, owner, and verification.
- Requirement: Required.
- Condition: Always shown.
- Validation: No live integration or automatic write is assumed unless explicitly approved; imports require preview and confirmation.
- Evidence: Import/source log.
- Sensitivity: INTERNAL.
- Export destination: `Operating Process → Data entry`.

### E14.Q12 — Exceptional value states

- Question: **How should missing, estimated, pending, refunded, cancelled, disputed, duplicated, or corrected values behave?**
- Purpose: Prevents inaccurate totals and silent rewriting.
- Answer type: Status-policy table.
- Requirement: Required.
- Condition: Financial/results data is recorded.
- Validation: Missing is never zero; estimates are visually distinct and excluded/included according to an explicit rule; corrections preserve history.
- Evidence: Status/change evidence where applicable.
- Sensitivity: FINANCIAL/INTERNAL.
- Export destination: `Financial Rules → Value status handling`.

### E14.Q13 — Minimum dashboard

- Question: **Which cards, tables, charts, comparisons, and warnings must appear in the MVP dashboard and client read-only view?**
- Purpose: Defines the minimum usable financial/results experience.
- Answer type: Component list by Owner view and client view.
- Requirement: Required.
- Condition: Always shown.
- Validation: Every component names metric, period, source/status, privacy visibility, and empty/error behavior.
- Evidence: None.
- Sensitivity: Mixed by component.
- Export destination: `Interface Requirements → Financial/results dashboard`.

### E14.Q14 — Financial access and redaction

- Question: **Which financial/result fields may Rana see, which may the client see, and which must be hidden or summarized?**
- Purpose: Enforces the single-user and read-only client-sharing boundary.
- Answer type: Field-level visibility matrix.
- Requirement: Required.
- Condition: Financial/result data or client links exist.
- Validation: Client view is project-scoped, revocable, and excludes other clients, internal margin/cost notes, and personal/payment identifiers by default.
- Evidence: Approval record for exceptions.
- Sensitivity: RESTRICTED.
- Export destination: `Privacy Rules → Financial visibility`.

### E14.Q15 — Evidence and audit trail

- Question: **Which financial and result records require evidence, and what audit history must be preserved?**
- Purpose: Makes reports verifiable without forcing unavailable proof to become fake data.
- Answer type: Record category, evidence requirement, acceptable source, verifier, and retention rule.
- Requirement: Required.
- Condition: Financial/result data is recorded.
- Validation: Evidence status is `VERIFIED`, `OWNER_REPORTED`, `CLIENT_REPORTED`, or `UNVERIFIED`; edits preserve old value, reason, actor, and date.
- Evidence: As defined per category.
- Sensitivity: RESTRICTED.
- Export destination: `Evidence Rules → Financial and result records`.

## E14 review checklist

- [x] Reporting levels and allocation prevent mixed client/project totals.
- [x] Revenue, operating costs, marketing spend, and service fees are distinct.
- [x] Currency and reporting-period rules are explicit.
- [x] Profit formulas are reproducible and handle incomplete inputs honestly.
- [x] Attribution distinguishes proven, assisted, unattributed, and unknown results.
- [x] Targets and actuals use matching definitions and periods.
- [x] MVP data entry keeps human review and avoids unwanted automation.
- [x] Exceptional value states cannot silently distort totals.
- [x] Owner and client dashboard requirements are explicit and individually switchable.
- [x] Financial visibility, evidence, and audit rules are approved.

E14 status: **APPROVED using the ResultGrid Digital seed answers on 21 September 2026**.

## Sections awaiting question design

- None. All Questionnaire V1 sections now have draft question definitions; E14 answers and final approval remain open.
