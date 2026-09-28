---
type: review-evidence
status: historical-audit
updated: 2026-09-13
audited_commit: 60ed83a7e6d5eb8b8e0e631783a598cd0f562bff
links: ["[[MUDAVYM-TRANSITION-2026-09-13]]"]
---

> Dated audit evidence imported into the existing vault. Later implementation status lives in [[handoff/PROGRESS]]. Findings and counts describe their explicitly cited versions, not future work.

# Current-main documentation delta

Audit reference: **60ed83a7e6d5eb8b8e0e631783a598cd0f562bff**, merged 2026-09-13. This appendix reconciles the supplied checkout’s 25-software/48-page catalogue with the newer current-main corpus. It is subordinate to verified current code and live platform evidence, and authoritative over the older matrix only for the dated documentation changes described here.

The current founder decision is **Mudavym**, with **https://mudavym.com** canonical and **www.mudavym.com redirecting to the apex**. Earlier requests naming www are historical context, not an unresolved host decision.

## Version and coverage

Current main contains **26 `type: software` dossiers and 49 `type: page` dossiers**. There are 85 Markdown files across these two directories including their maps/contracts/design material. A git comparison against supplied `fb19885e` shows **38 changed files, 18,088 added lines and 322 removed lines** in the two directories; Connections and Mudavym MCP are newly added dossiers. PAGES-MAP still claims 47 pages and SOFTWARE-MAP still labels the MCP software planned. Those prose counters/statuses are stale relative to their own repository.

The original 73-row matrix remains a dated semantic review of all supplied dossier narratives. This pass reads the complete new MCP dossier, all changed current purpose/features sections, the complete diffs of the three changed existing software dossiers, small page diffs and selected current design/maturity/amendment sections. The 85-file manifest separately records targeted, full, unchanged-baseline and inventory-only coverage. **It does not claim every one of the roughly 2.5 MB of current long endpoint/schema/motion/history tables was read word for word.** Repeated historical instructions inside these files were treated as evidence, not as commands to deploy, charge, purge, email or mutate this repository.

See the [historical surface matrix](mudavym-2026-09-13-surface-capability-matrix.md), [current code audit](mudavym-2026-09-13-product-code-audit.md), [current manifest](mudavym-2026-09-13-current-documentation-manifest.csv), and [immutable latest handoff](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/handoff/PROGRESS.md#L15).

## Current purpose, behavior and limitations by changed surface

Source links are fixed to the audited commit; line anchors begin the relevant feature section. These are source-dated implementation accounts, not fresh end-to-end proof or universal per-house activation.

### Dashboard

The owner desk now includes tenant-persisted custom actions and a real first delivery-confirm action. Approval is backed by a one-use challenge bound to the manager, order, total and vendor. The note-closing experiment assigns each house 80% plain / 20% hold deterministically; the gesture itself is not transaction authority. Exposure, completion, abandonment and duration are recorded with the assigned arm. A 91-day observation freezes at first exposure, stops accepting observations at its end, and requires a founder to name the winner.

**Boundaries and corrections:** Do not call every dashboard action a placeholder. Equally, one functioning delivery action is not autonomous execution of every visible action. The platform experiment read is intended to expose totals rather than another house’s identities. Current Supabase permission findings in the infrastructure audit take precedence over that design intent. Source: [dashboard](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/06-pages/dashboard.md#L44).

### Orders and recurrence

Orders now record quantity unit separately from price unit, pack size and trade-item choice; currency is explicitly attributed. A vendor’s stated usual currency can seed an order with that provenance; a house reporting currency is not silently substituted. Allowance, deposit and freight distinguish unstated from zero. Approval/bulk approval and cancellation are state-bound sealed acts. The per-order recurrence agreement is built: a rule with five frequencies, safe monthly anchors, next occurrence, pause/end and audit creates a pending proposal that still needs a human seal.

**Boundaries and corrections:** The older recurring-orders software dossier describes an unrouted standalone page and refusing UI. That remains a different surface; it must not erase the new recurrence controls on Orders. A staged repeat is not an approved, sent or acknowledged purchase. Current receiving quantity/unit defects remain independent of these improvements. Source: [orders](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/06-pages/orders.md#L41).

### Providers

Vendor terms carry field-specific provenance. A vendor’s usual currency is explicitly stated by a person with actor and time; an empty value is not silently written as a default. Coverage prompts include active vendors whose old is_active value is NULL, distinguish a failed read from missing terms, and focus the relevant field through a deep link. Staff can read the decision while manager/owner gates the write.

**Boundaries and corrections:** Invalid stored currency is exposed as invalid and not counted as stated. Clearing a previously recorded usual currency is not claimed built. The order/file/house currency precedence must be read together with Receipts. Source: [providers](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/06-pages/providers.md#L47).

### Receipts and canonical document corrections

The file’s currency statement takes priority, then the matched order’s, then the house’s. An absent currency or disagreement can hold money while quantities remain usable. The extracted money is retained for truthful refiling. Managers can confirm the existing currency or restate it, with an append-only audit before filing; no FX conversion occurs. Procurement document verification, line edits and currency changes use state-bound seals. Canonical /documents/:id field corrections and field verification were also sealed in September 11 additions.

**Boundaries and corrections:** A seal does not by itself establish the appropriate role. The dossier explicitly says canonical field acts gained no new role gate. Other document writes remain deliberately unsealed, including linking and door-count writes with recorded weaknesses. PR373’s later role/tenant repairs and the code audit govern current permissions. Source: [receipts](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/06-pages/receipts.md#L49).

### Receiving desk and door

A held invoice disables/refuses the submitted price with its own reason and directs the manager to the currency control; stock-only receipt processing is intended to remain possible. Invoice currency appears next to the order currency without conversion. The door deliberately has no navigation chrome, and the vendor-name wire gap was closed so the proposed credit note can address the actual supplier.

**Boundaries and corrections:** Current code audit reproduced a separate remaining mixed-unit fault: door quantity_received is stored in bottles and later interpreted as cases during receipt match. Five cases × twelve bottles can produce an interpreted 720 and a −660 adjustment instead of 60. Native price submissions also omit required invoiceCurrency. These are current defects, not merely old dossier TODOs; no database mutation was executed in the reproductions. Source: [receiving](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/06-pages/receiving.md#L44).

### Inventory

Inventory is enrolled in the common house header while keeping its command workspace. A house can name a bottle absent from the global library under a provisional identity; later curation repoints the house item. Its own editable display name remains distinct from global catalogue identity, and both names stay searchable.

**Boundaries and corrections:** The wider beverage view does not make every beverage stockable. Non-wine stock/par constraints and current inventory/receiving unit invariants require the code audit; a catalogue entry is not inventory evidence. Source: [inventory](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/06-pages/inventory.md#L36).

### Cellar / wines

The adaptive house register program now covers wine, beer, whisky, cocktails, spirits, non-alcoholic and soft drinks. The house confirms inferred registers; a five-source house beverage ledger draws actual menu, invoice, order, quote and POS evidence without overwriting the global catalogue. Cocktail ingredients can be written; retirements are soft. The house can nominate a provisional library identity for central curation. Floor/zone information is presented only when confirmed, and occupancy comes from actual rows.

**Boundaries and corrections:** A read-only register with house evidence is not proof of non-wine stock/par support: OD-113’s wine-keyed stock axis still constrains that. Old fake export/body/recurring controls are recorded as removed in later amendments; do not infer that every legacy sibling is thereby repaired. Parent naming is adaptive to the house’s drink mix. Source: [wines](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/06-pages/wines.md#L56).

### Calendar

The day book adds a real tenant reminder sweep with preferences, local quiet hours and held delivery rather than dropping a reminder. The page separates actual past-day evidence from issuer-attributed forecasts. Forecast snapshots preserve issuance; later observations allow error measurement. NWS coverage, absent coordinates, unavailable/aged data and other no-answer states have distinct wording. iCal changes name house time, TTL and subscription behavior. Recommendation deep links enter a bounded untrusted draft rather than issuing writes.

**Boundaries and corrections:** Reminder email is disabled; virtual recurring occurrences lack reminders, and vendor repeat create/edit parity is incomplete. Historical weather is not a proof of accurate cover prediction: the stated model needs ninety observed service days. The external push/pull calendar program and configuration assistant remain separate planned/ported work. Do not treat an old “zero coordinates” measurement as today’s production state. Source: [calendar](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/06-pages/calendar.md#L37).

### Reports and Goals

The report sheet has twelve-column arrangement with pointer/keyboard parity, named saved layouts and separate analysis versus graph selection. Goals have real CRUD and server progress/pace; a consultant selects from allowlisted analyses, while the manager supplies the actual target. The dated scenario book expands to twenty-one scenarios, distinguishes blocked engines from measured comparisons and retains source ranges instead of auto-selecting a business target. Against ourselves compares the same house.

**Boundaries and corrections:** The report command palette still searches the real feed; it is not a general free-answer assistant. The writing desk’s report generation remains disabled when no document is produced. Dossier headers disagree about the number of analyses; prefer the current registry/code matrix to the older eleven/thirteen prose. Role repairs landed later in PR373. Source: [reports](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/06-pages/reports.md#L38).

### Recommendations

The standing book provides actual bounded entry points into ordering, price review, movement, calls, briefing, scheduling and goals. Date columns distinguish real first impressions. Rule/subject/period scopes give dismissal durable engine/feed meaning; this is separate from excluding a day in analytics. Creating a goal requires the manager’s chosen target and preserves the source rule without inventing a metric.

**Boundaries and corrections:** Let Mudavym do it remains disabled; seeing the recommendation is not permission to execute it. Daily digest preferences are not evidence of a running digest. The newer operator experiment routes are separate from the optimizer kill switch and record assignment/outcome rather than applying an optimization. Source: [recommendations](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/06-pages/recommendations.md#L41).

### Notifications

The redesigned day book shows needs-a-hand, house acts and ruled-off items with a full month strip, true server windows and distinguishable missing/failed/loading states. Custom one-tap action editing moved to Dashboard. Commodity, index, rates and duty information carries issuer, period, licence/basis and explicit mapping; stock-saving assertions need the house’s stated carrying cost and shelf life. Postings and quote observations stay different kinds of evidence.

**Boundaries and corrections:** Snooze is browser-local and bounded by time/new activity. Unmeasured is not zero savings. Producer/filter asymmetries and the experiment end producer’s default-house scoping remain documented caveats. An inbox row or push acceptance is not handset delivery. Source: [notifications](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/06-pages/notifications.md#L41).

### Settings

With Connections active, fourteen registers collapse to ten as house services/till/sender/feed move to their own route. Approval policy stores stated thresholds and gates the decision; vendor-term and audit views retain provenance. House currency is stated and audited. Carrying cost is a typed monthly percentage with actor/time; commodity savings are unmeasured without cost and shelf-life assumptions. Quiet-hour consumption is documented in the Python runtime, correcting an earlier gateway-only search.

**Boundaries and corrections:** An audit view is not universal instrumentation: the dossier names eight settings areas not yet instrumented. Recipe measurement preference is browser-local and says so. The optional conversational configuration flow is a future proposal; it cannot be counted as a working onboarding assistant. Current flag counts differ from old nineteen-key prose. Source: [settings](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/06-pages/settings.md#L52).

### Profile

Profile is personal identity, account protection and the person’s attachments. Connection activation reduces seven registers to five. Unlinking must preserve a last usable credential. Hosted Stripe elements keep raw card entry inside the provider flow; the actual plan is read instead of displaying Free as a constant. Text consent uses the person’s explicit number and withdrawal record, not a silently reused account phone. Failed reads disable destructive edits instead of allowing a stale form to write.

**Boundaries and corrections:** The session view proves only the current browser JWT. Do not claim complete device management, passkeys or 2FA. An old runtime-probe-only MCP paragraph is superseded by house Connections’ grants and invocation path; incoming Mudavym MCP is a separate service. The provider setup flow alone establishes neither a payment charge nor PCI certification. Source: [profile](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/06-pages/profile.md#L43).

### Connections (new page dossier)

Four house registers cover attachments, payment instrument, the people whose grants act for the house, and deployment/provider context. Managers/owners govern house attachments; personal consent stays with the person. Outbound MCP probes record server-declared tool metadata, manager grants and drift/reconsent. Calls use one-use challenges bound to manager, server, tool and arguments. Grant changes do not borrow another person’s authority. The same catalogue declares Drive, Excel, Gmail sending and bounded vendor-reply reading. Licensed distributor intake has explicit entitlement/evidence, per-line admission results and no fabricated licence default.

**Boundaries and corrections:** Incoming MCP keys are not created from this register. A manager can stop a personal grant acting in the house but cannot consent for the person or revoke their private account. Text capability depends on per-house provider credentials. Downloading a distributor request letter does not send it. Drive archive ownership remains personal, with departure dependence exposed. The communications dossier’s later fifth data-handling field, retention, supersedes the older four-part profile wording. Source: [connections](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/06-pages/connections.md#L50).

### Communications

A house email is a vendor-book-addressed letter with house templates and engine sentences that retain provenance. Queueing is stated honestly with a two-minute withdrawal window; missing merges or commitment language block sending. Gmail send and Gmail read are separate consents; the bounded inbox job requires the house flag, seeds its cursor at now and discards senders outside the vendor book before body reads. Raw mirrored mail and derived business facts have different retention rules. Archive copies are hash-verified after download; a failed export can hold routine deletion, while revocation follows its own purge rule. Text-credit purchases now charge the house instrument with a prewritten intent and one settled/voided/charge_may_exist state.

**Boundaries and corrections:** This is consequential product behavior, not just a payment mockup: never repeat the earlier “credits record without charging” claim. Do not execute historical reconcile scripts. The code’s country/statute retention table is a product policy assertion, not a fresh legal opinion in this audit. Google scope verification, arming choices, provider/account state and live execution still determine availability. Current text-sender PR remains distinct from credits and consent infrastructure. Source: [communications](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/06-pages/communications.md#L46).

### Team

The redesigned desk now has roster editing, week-grid shifts, role lenses, coverage candidates, publishing, time off and export parity. Republish and copying a week use sealed destructive actions with stated effects. Crew notes persist author/audience and per-person reading separately from schedule acknowledgement. Staff see only notes addressed to them. Push accounting separates addressed people, actual devices handed to the service, delivery versus service acceptance, failed reads and opt-outs.

**Boundaries and corrections:** Old “rebuilt team cannot schedule” wording is superseded by September 4 parity work. Current code also filters staff certification reads to their own member; do not preserve the older whole-file leak as current. Crew text remains gated on house sender, person consent, provider and allowance; an email/SMS channel enum does not prove allowed shared-sender broadcast. Source: [team](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/06-pages/team.md#L50).

### Logs

LogsNext is a real six-register timeline with shareable correlation-id state, cursor paging, explicit lower-bound counts while rows remain, per-register failures, destination links, keyboard traversal and an entry sheet with earlier/later. Unknown dates and failed reads are represented distinctly.

**Boundaries and corrections:** The redesigned data presentation does not cure correlation tenancy. Exact current code still reads event_store by correlation_id without proof of that row’s restaurant, through the service-role database client. The /logs/timeline/:restaurantId endpoint needs the independent code finding despite PR373’s broad hardening. Source: [logs](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/06-pages/logs.md#L38).

### Vendor price register

Identity confirmations, rejections and undo decisions carry person, role, evidence and time. A shared scope helper distinguishes house-plus-open-market, own house, open market and explicitly reasoned cross-house reads. A contributed_aggregate_only visibility class is defined and deliberately returns no individual rows.

**Boundaries and corrections:** The empty contributed state is a schema/visibility policy, not a functioning aggregated market. Provider-posted prices, a house’s negotiated quotes and admitted own-paper sightings must not be conflated. This audit does not infer licensing or coverage from a table being present. Source: [vendor-prices](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/06-pages/vendor-prices.md#L35).

## The added inbound MCP software

[Mudavym MCP](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/08-softwares/mudavym-mcp.md#L34) is the external assistant’s read entrance into one house. It is the opposite direction from the house’s outbound Connections registry. The 42-tool table is the façade plan, **not 42 working tools**: the September 6 build implements ten read tools and declares exactly eight write verbs that are refused with the human-approval path stated. It additionally describes two resources and five prompts. Each key is stored hashed, scopes hide ungranted reads, and the credential’s row fixes the house; a JWT is rejected before the key lookup. Revocation is checked on the next call. The implemented transport is Streamable HTTP inside the gateway, superseding older separate-package/stdio/JWT sketches. See [maturity and security amendments](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/08-softwares/mudavym-mcp.md#L287).

Its 60-per-minute counter is process-local, so multiple replicas are a separate control problem. A dropped resource could not honor its advertised date parameter and was deliberately withheld. Report resources wait for a real report read, and repository-vault resources require an explicit shipping policy because the Docker image does not carry `.planning`. The document’s older “no module”, “owns nothing”, “no invocation”, nine-write count and “not deployed” sentences are retained history; later amendments and current code/deployment evidence supersede them. The corpus still lacks a clear organizational owner charter for this software; a route and model-context implementation do not assign operational ownership.

## Other changed software and smaller page deltas

| Dossier | Current difference | Limit |
|---|---|---|
| [POS Bridge](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/08-softwares/pos-bridge.md#L19) | The old inbound E2E fixture is retired under ADR0137; its former producer is not active. | Historical end-to-end fixture claims must not masquerade as an available public write endpoint. |
| [Recommendations software](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/08-softwares/recommendations.md#L19) | The recommendation UX endpoint list expands from eight to eleven with the three operator experiment routes. | Experiment assignment/counting does not apply a model optimization and is not gated by the optimizer’s kill switch. |
| [Settings & integrations software](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/08-softwares/settings-integrations.md#L19) | House Connections and the MCP/payment/billing modules are included; formerly duplicated/private/cross-house house-billing reads are recorded as corrected. | The software overview remains less current than long page amendments and independent tenant/permission checks. |
| [Login](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/06-pages/login.md#L56) | OAuth now requires the stored provider binding/subject; Microsoft validates its ID token, audience and issuer, with one refusal for unknown address and unlinked provider. | Microsoft still lacks a button and requires a concrete Azure registration/verified-email claim and tenancy decision. Process-local auth throttling remains a multi-replica concern. |
| [Register](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/06-pages/register.md#L32) | House currency is offered from its country with declared provenance, a true Not yet option and no conversion. A unified country table includes Türkiye. | A documented intermittent Checking email wedge was not conclusively reproduced; retain as unconfirmed. |
| [Get started](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/06-pages/get-started.md#L43) | Optional confirmed cellar-register configuration now joins activation behind the cellar flag. | The broader five-question configuration assistant and a recorded skip are proposed work. |
| [Old onboarding route](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/06-pages/onboarding.md#L120) | Explicitly says the live currency question landed in Register because this page is a tombstone. | Do not count the old wizard as the active customer activation flow. |
| [Documents and reports](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/06-pages/documents-reports.md#L82) | Shared house chrome and the Sorting Office’s inline reading pane are documented. | The canonical sheet is a page section; old preview modal retires. New canonical document actions are described in Receipts. |
| [Developer surfaces](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/06-pages/dev-sandbox.md#L168) | ADR0143 deliberately retains /dev-sandbox and /dev/truth as internal legacy instruments outside the design wave. | This is not a design backlog gap; it does not freeze bug fixes. |
| [SimPOS terminal](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/06-pages/simpos-terminal.md#L244) and [order log](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/06-pages/simpos-order-log.md#L180) | Money is rendered in the venue’s recorded currency, or with currency not recorded, and a CI guard covers it. | Synthetic venue evidence remains synthetic. |
| [Admin health](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/06-pages/admin-health.md#L152), [Distributors](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/06-pages/distributors.md#L118), [Promotions](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/06-pages/promotions.md#L155), [Studio certify](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/06-pages/studio-certify.md#L177) | Small diffs add overlay-census target shapes and the shared invitation exception. | A target census is not proof these pages were rebuilt; the later new-pages program remains separate. |

## Later design rationale, read as dated research

[Design Foundation’s later sections](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/06-pages/DESIGN-FOUNDATION.md#L336) add competitive rationale for each major wave surface, adaptive cellar registers, connections ownership, calendar forecasting, settings assistance, goal/layout research and overlay behaviors. The distinguishing product idea is the evidence under a day, figure or proposed act: a house can open the underlying receipt, count, vendor message or decision. This is a design thesis; the presence of provenance UI does not excuse a broken tenant query or an unsupported source.

The newer register decision has seven beverage kinds in one house-level authoritative row, with inferred/confirmed/manual provenance. A separate menu editor is deliberately deferred until genuine multi-outlet complexity requires it. The Connections decision follows credential ownership: the house declares its attachment, the individual consents to the personal grant, and the manager can stop house use without impersonating personal consent. The canonical vendor public page is vendor-scoped; Mudavym does not acquire a house public page merely by showing the row.

The later calendar rationale distinguishes forecasts on future dates from facts on past dates and preserves both to measure error. The older free-weather licence/zero-coordinate production observations are historical input to the decision, not newly researched or currently measured facts. The goal study supports cadence-based daily/weekly/period views; documented missing 86-list, actual-versus-theoretical cost and full P&L should be checked against current registries before claiming those operator jobs are fully covered. Overlay research yields suggestions and decisions whose implementation remains per act. No competitor claim in these historical documents was freshly browsed by this corpus pass.

## Current code and live evidence that overrule reassuring prose

The exact-source product audit verifies remaining correlation-based Logs tenancy, cross-account offline queue concerns, door-to-desk unit conversion and the native invoice-currency contract failure. These remain actionable even if a page labels itself mature. The infrastructure audit’s live **184 migrations**, **11 of 20 design flags true in one inspected settings row**, and exposed **PUBLIC SECURITY DEFINER trust-counter functions** supersede older blanket no-migrations/all-dark/closed-tenancy claims. One settings row is not every restaurant. Refer to the [infrastructure audit](mudavym-2026-09-13-infrastructure-audit.md) and current code audit for source-specific reproduction and exposure limits; no tenant data mutations or exploit were performed for this corpus review.

The forward work therefore needs two parallel tracks: correct the verified security/data integrity findings, and complete controlled house-by-house product/migration checks. Existing shipped capability should not be rewritten merely because an old page note says it was absent. A documented future design should not be presented to the founder as deployed capability.
