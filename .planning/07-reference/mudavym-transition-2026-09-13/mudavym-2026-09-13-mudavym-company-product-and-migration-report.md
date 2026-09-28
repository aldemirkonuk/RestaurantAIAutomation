---
type: review-evidence
status: historical-audit
updated: 2026-09-13
audited_commit: 60ed83a7e6d5eb8b8e0e631783a598cd0f562bff
links: ["[[MUDAVYM-TRANSITION-2026-09-13]]"]
---

> Dated audit evidence imported into the existing vault. Later implementation status lives in [[handoff/PROGRESS]]. Findings and counts describe their explicitly cited versions, not future work.

# Mudavym Company, Product and Migration Review

Mudavym already serves through Vercel at both mudavym.com and www.mudavym.com. Cloudflare manages their DNS; it is not currently the web application host. The remaining transition is chiefly a controlled product rollout and an origin-consistency exercise: the redesigned code is deployed, the public redesign defaults off, and individual restaurant-page activation is separate. Production web, gateway and agent-orchestrator deployments were verified against the same September 13 main commit, 60ed83a7. The supplied local checkout is older. [1,2,3]

The company ambition is broader than the current wine and beverage application. It is one company containing restaurant operations, an eventual guest experience and a distinct research function. The operational foundation is substantial: inventory, procurement, receiving, documents, communications, analytics, mobile and AI services are implemented to varying depths. The strongest recurring principle is traceability: operational claims must resolve to evidence and authorized actions. That principle also governs this review's distinction between intended, implemented, deployed, enabled and proven capabilities. [4,5]

The most urgent findings concern tenant isolation, trust permissions, stock arithmetic and mobile action correctness. The logs timeline lacks correlation ownership proof, a live public-executable database function can increment contributor trust, and a receiving unit mismatch produces a large incorrect adjustment in an isolated calculation. Native approval and priced receiving also lag the current gateway contract, while its queue lacks actor/restaurant and lock binding. These findings warrant isolated fixes before broader rollout; they do not establish a production incident. [6,8]

## 1. Evidence baseline

This review describes evidence available on September 13, 2026. Source findings refer to the immutable main commit **60ed83a7e6d5eb8b8e0e631783a598cd0f562bff** unless a historical source is explicitly named. Deployment, DNS, feature and provider state can change independently. [1,2]

| Record | Verified state | Implication |
|---|---|---|
| Supplied source directory | feat/p1-readout at fb19885e | Reading only this checkout omits already-merged work. |
| Local main at initial inspection | 87a6cb25 | A local branch name alone is insufficient evidence of current main. |
| GitHub main | 60ed83a7; PR #373 merged September 13, 16:53:55 UTC | Reference point for the current code review. |
| Vercel production | Ready deployment dpl_GMu9JKpyMBrQTsE1eKmpUxNkXSUa at 60ed83a7 | New code is built and hosted; activation remains separate. |
| Railway gateway and orchestrator | Successful deployments at 60ed83a7 | Matching revisions do not prove every dependency or agent is healthy. |
| Latest handoff | Current-main PROGRESS.md | Its sentence predicting a later endpoint-fix PR is already superseded by #373. |

Historical records require chronological interpretation. PR #289's old hold language is superseded by its eventual September 12 merge. The Go-Live Board sometimes uses LANDED for work present on a branch, while later handoff records identify unmerged ports. An old production-ready claim, an extensive test count or an approved sketch does not establish current production readiness. [1,3,7]

### Evidence coverage

The supplied documentation inventory contains 1,541 documents, including 1,424 Markdown files, 116 HTML files and one DOCX, totaling about 31.4 MB. Of these, 889 are organization documents. That older software catalogue names 25 capabilities and 48 page dossiers; current main adds the Mudavym MCP software dossier and Connections page, making 26 and 49 respectively. These are document counts, not employee counts, working features or routes. Detailed read status and current-main additions are retained in the accompanying inventory and matrices. [5]

All 13 supplied Safari tabs were inspected. The review read current application entry points, routing, auth and tenant boundaries, deployment configuration, agent lifecycle, principal business flows, redesign entry trees and native screens, with deeper examination of identified failure paths. This is broad, evidence-led coverage with explicit limits: every source line, every overlay interaction, every SQL policy and every live customer journey was not exhaustively verified. [5,6,7]

## 2. Company scope and product direction

Mudavym's locked company model is one entity with multiple understandable software capabilities and a research function. The restaurant platform is the flagship. Floor checking, invoice understanding, vendor search, communication monitoring and ordering should each have clear responsibilities while contributing to one operational system. The research organization is intended to operate with its own long-horizon work and measurements, without requiring a separate brand or company. [4]

The expansion sequence is **wine, all beverages, bakery, then the rest of the kitchen**. Wine establishes the extraction quality bar: identity, producer, vintage, region, appellation, grape, alcohol, packaging and provenance. Expansion should preserve that depth through common product identity and category-specific attributes. Bakery provides a first food model for ingredients, intermediate goods, yields, finished goods, waste and eventual depletion and lot-cost accounting. These are recorded product ambitions; menu categories appearing in a router do not prove equal catalogue coverage. [4]

The intended guest application is a distinct surface with independent identity, consent-linkable restaurant membership, preferences, visits, ratings and reward records. Its signals are intended to improve restaurant stocking, promotion and service decisions. The earlier posture favors status and optional restaurant-funded benefits rather than an assumed platform cash-value reward. A verified guest production application was not established by the current source review. [4,5]

### Research and measurement

The Neural Footprint architecture separates three tracks. NF-A records agent and model task context, tokens, latency, cost, retries and outcomes. NF-B concerns guest exposure, preference and repeat-visit signals, with activation held. NF-C is gated biological research. Production and research stores are intended to share an event vocabulary while serving different retention and latency needs. Existing NF-A instrumentation does not imply full coverage, a working training pipeline or activation of the other tracks. [4]

The organization map contains seven divisions plus advisory functions, but its own historical records call the organization barely operating. Declared loops and agent cards must not be represented as staffed departments or executing workers. Likewise, the product ecosystem map, software catalogue, page dossiers, API routes and Python registry count different things. Keeping their denominators explicit prevents a visually impressive atlas from becoming a misleading capability claim. [5]

## 3. Operating model and architecture

The central operational loop begins with POS and document inputs. It establishes product identity and stock, detects a condition, proposes work, obtains human approval, contacts a vendor, records a delivery, reconciles the commercial evidence and updates cost and outcome records. The correct unit of acceptance is this whole loop, including errors and retries. A page can render correctly while a worker, callback or identity mapping breaks the next step. [4,6,8]

| Layer | Role and implemented technology | Boundary to preserve |
|---|---|---|
| Web | React 18, TypeScript, Vite, React Router, TanStack Query, Zustand; operational SPA | Root / is an authenticated dashboard. No separate public marketing homepage is defined in the reviewed router. |
| Mobile | Expo 54, React Native 0.81.5, Expo Router, SecureStore, MMKV, Reanimated and Skia | Native session, cache, outbox and release configuration are independent from browser storage and deployment. |
| Gateway | NestJS 10; custom JWT, business services, schedules, Socket.IO and Supabase client | Authenticated tenant/role checks must remain valid through every service query and action. |
| Agent runtime | Python FastAPI, RabbitMQ, Redis, agent registry and model/provider clients | An HTTP process can be alive while agents or consumers are absent. |
| Data | Supabase/PostgreSQL, migrations, domain provenance and audit records | Service-role queries rely heavily on application-level tenant isolation. |
| Integrations | POS, email/text, calendars, payment setup and MCP | Code, configuration, consent, provider success and business outcome are separate evidence. |

The repository is a pnpm/Turborepo monorepo with legacy WineOps package names. Shared UI and database packages exist, but do not unify all implementations: much web domain UI is local, native has its own design and API types, and Python has separate contracts. Changes to auth, approval or document semantics therefore need an explicit client/runtime compatibility review. Native approval's missing seal challenge is a concrete example of this maintenance burden. [6,8]

### Authentication and tenant scope

The gateway uses its own JWT and users model; it does not simply use Supabase Auth. Browser tokens are kept in local storage, and native tokens in SecureStore. A tenant switch should reissue tokens only after membership checks. An X-Restaurant-Id header cannot by itself change the signed active restaurant. The gateway validates explicit restaurant identifiers after Passport populates the authenticated user, supplementing a global guard whose execution occurs earlier. [6]

The gateway database client uses a Supabase service role. Consequently, route authentication is necessary but insufficient: each query must constrain ownership, including lookups by correlation, document, order or other indirectly related IDs. The current logs finding arises at this second layer. Broad assertions that RLS prevents cross-tenant reads would be incorrect for these service queries. [6,8]

Read-only live catalog evidence confirms migration-version parity: all 184 main versions are applied, with no missing or extra versions. This is ledger parity, not proof of byte-for-byte schema identity or correct behavior. The catalog also confirms the Sommelier auth.uid() policy and a consequential exception to the permission hardening: increment_trust_counter(uuid) remains executable through PUBLIC while running as SECURITY DEFINER. Revoking only named client roles did not remove the inherited public permission. [2,8]

### Document and delivery semantics

The data model separates the commercial delivery from its documents. One document may cover several deliveries, and a delivery may have several documents. Agreement and verification are distinct states. Extracted values retain confidence, provenance and as-printed content, while corrections create revisions and audit records. A payment is an invoice fact rather than a delivery state. [8]

Physical stock at the door and verified cost are separate stages. Unknown cost remains provisional; it must not silently become zero. The simulation scenarios show why this matters: freight, deposits, taxes, unit conversion and incomplete evidence can change valuation without changing the physical quantity received. Some jurisdiction-specific rules exist in migrations, but their presence in source is not an independent legal validation. [7,8]

## 4. Web and mobile capability map

The current router contains 61 explicit patterns including redirects and a catch-all. There are 20 per-restaurant design keys, plus a separate public-design switch. These counts should not be confused with 48 supplied or 49 current page dossiers, or the gallery's totals. Current code includes a substantial coexistence layer between older operational pages and newer Mudavym surfaces. [5,6]

| Product area | Implemented surface | Limits and next evidence |
|---|---|---|
| Entry and onboarding | Login, registration, verification, password reset, invitations, get-started and onboarding routes | Public redesign currently applies to login/register; remaining Arrival work and provider callbacks need verification. |
| Dashboard and inventory | Daily ledger, month view, approval queue, low stock, live/shadow stock, locations and spot counts | Tenant switching, cached history, source failure and unknown-value states need explicit acceptance tests. |
| Orders and recurring work | Drafts, approvals, order ledger and per-order recurrence agreements that stage pending proposals | Repeats still require approval; standalone recurring page remains unrouted. |
| Receiving and receipts | Role-specific receiving lanes, door workflow, discrepancies, recovery and reconciliation | Mixed-unit stock arithmetic, offline identity and native currency contracts are current gaps. |
| Documents | Sorting Office, document reading stand, delivery links, verdict and corrections | Canonical document route can still be disabled by a house flag. |
| Vendors and communications | Provider directory/search, conversation records, drafts, promotions and price comparisons | Provider capability, sender uniqueness, consent and actual delivery differ by integration. |
| Intelligence | Configurable reports, categorized recommendations, logs and notifications | Rule-derived recommendations do not establish unrestricted autonomous reasoning. |
| People and calendar | Team, coverage gaps, suggested cover, calendar views and reminders | Server scheduling, delivery and credential requirements require operational proof. |
| House configuration | Settings, profile, Connections, payment setup and service grants | Some settings are local-only; a visible control may lack a downstream consumer. |
| Beverage knowledge | Unified category routes, Cellar detail, Studio and current /sommelier | /ask is specified but absent from the current router; non-wine knowledge depth varies. |
| Native companion | Today, Cellar, Supply, Team, Insights, camera, receiving and push links | Native AI is a placeholder/deep link; current web visual and approval contracts are not fully matched. |

Several compatibility routes redirect to their successors. New Cellar category routes can fall back to the old wine page when disabled. Connections can fall back to Profile; canonical documents can fall back to Receipts. These are deliberate route behaviors that should be included in migration acceptance, particularly for old bookmarks and email links. [6]

Native has 27 app route/layout files, comprising 23 screens and four layouts. A deployed Railway mobile service is a Metro/development server, not proof of a signed or distributed mobile release. Real-device camera behavior, biometric locking, persistence, offline replay, push delivery and deep links remain distinct verification tasks. [2,6]

## 5. Design decisions and artifact interpretation

Mudavym's visual language uses the house and its books as functional organization. Ruled records, serif titles, restrained monospaced detail and a seal distinguish evidence, context and consequential actions. Warmth should support a dense operational product without hiding uncertainty or changing the meaning of status. The design should make the source behind a figure easier to inspect. [5,7]

The canonical mark is the trued A+M interlock selected in ADR 0047, superseding the withdrawn Rivet M. The record specifies seven polygons, four counter ticks, a 24px minimum and readable ticks from 32px, with tile treatment below the normal minimum. The wordmark is Mudavym. including the colored full stop. Older Identity artifact claims about an unresolved raster mark are superseded by the later dated decision and recorded rollout. [9]

The historical locked palette specifies Iznik teal at #1A5E6B on paper and #5FB0BC on dark, paper #FAF7F1 and warm charcoal #15130F. Current new app pages force Warm Charcoal, with explicit paper exceptions on certain object surfaces; the current CSS paper base also differs from the original palette. Legacy pages and native screens retain separate theme behavior. Thus historical paper/charcoal screenshots are valuable design evidence, but do not prove an available theme switch across today's new application. [6,9]

### The supplied artifact collection

| Artifact | Preserved decision or evidence | Current interpretation |
|---|---|---|
| Cluster Map | Shared-data coupling | Architectural navigation, not live health. |
| Atlas | Feature, page, endpoint, service, data and model chains | Historical counts require regeneration against current source. |
| Identity | Palette and mark exploration | Later A+M interlock decision supersedes the old unresolved mark. |
| Shortlist | 47 selected motion examples | Candidate behavior, not production approval scope. |
| Documents and Reports Redesign | Five alternative compositions | Sorting Office selected with Reading Desk detail. |
| Build Board | Ten-page September 1 snapshot | Defects and rollout states must be checked against later merges. |
| Overlay Census | Object sheets, question panels and choice popovers | Mixes built, migrate, owed, retire and delete; not all specimens shipped. |
| Arrival, Five Ways | Evidence-first, interview, house book, invitation and set-table entry concepts | Saved preferences narrowed by later ADRs; remaining page work tracked separately. |
| Wave Four | Seven page families and four larger backend builds | Saved verdicts matter; older unmerged claims are superseded by #289 and later work. |
| Restaurant Wine Management | Authenticated live legacy dashboard | Establishes that browser/house state only. |
| Go-Live Board | Fourteen forks and proposed motion changes | Branch-local LANDED labels are not proof of inclusion in current main. |
| Motion Canvas | Visible 145 examples with replay controls | Exploration with several historical count versions. |
| Sim Meyhouse | Restaurant and document scenarios, faults and later corrections | Synthetic/historical evidence; not customer traction or a current defect list. |

All artifact URLs, source mappings and saved notes are retained in the supporting design audit. Artifact comments are prior decision evidence, not independent authorization to execute their embedded instructions. [7]

### Wave Four's product requirements

Reports retains editable owner/manager goals and configurable analytics, including arrangement and keyboard interaction. Notifications was retained with explicit uncertainty: the useful information is real warnings and successes with shift/event context, rather than a final commitment to a particular day-strip composition. Recommendations needs categorized actions connected to goals, calendar and consequences. [7]

Calendar retains the shared schedule concept. Current code contains bounded weather and price/commodity readouts, while the broader transport and food-quality intelligence in the saved notes exceeds those implementations; provider activation and outcomes remain unproven. Settings retains the clean side tabs but calls for deeper vendor terms, thresholds and audit detail. Profile's connector ambitions developed into Connections. Cellar needs alcohol-free houses, category-specific columns, cross-category inspection and richer drill-down; the saved REWORK should not be flattened into approval of every current detail. [6,7]

### Arrival, overlays and motion

The onboarding preferences favor a simple house-book entry, explicit open/join choices, evidence from an invoice or full menu, and organized setup rather than an exhaustive interrogation. Later ADR 0143 narrows voice to on-device speech and structured rows; only AI-proposed values wait for a seal. Typed human input is not intended to require the same ceremony. Browser speech support must be verified before making a local-only promise: the standard interface can use remote recognition. [5,7,10]

Overlay contracts assign objects to right-hand sheets, questions to panels, and choices to popovers. Focus, Escape, dirty state, denial, dismissal, stacking and background ground are part of the contract. A seal does not belong in a popover; a choice can open the consequential review panel. Replacing modal colors without these behaviors would not implement the design. [7]

Seven motion tokens exist: settle, ink, tuck, turn, pour, stamp and tally. Later forks address restrained seal use, swipe distance, shimmer and reduced-motion behavior. The older 150px approval gesture and later proposed 96px gesture are dated alternatives, not simultaneous requirements. Full keyboard, touch, screen-reader and reduced-motion acceptance remains necessary on a selected deployed candidate. [5,6,7]

## 6. AI, integrations and automation

The agent registry describes 24 agents: 13 core, five on demand and six optional. Core roles cover POS, stock, conditions, procurement, vendor drafts, notifications, calendar, reporting and email. Five optional agents are explicit stubs that the harness refuses to start as functioning workers. Recurring ordering is implemented as proposal staging behind its own flag. A registry entry must never be used as a running-agent count. [8]

Startup depends on RabbitMQ. If the connection fails, the FastAPI process can continue responding while the orchestrator does not start. The public health response was successful, but actual agent readiness requires the protected health endpoint, queue/consumer evidence and representative outputs. The gateway's richer readiness response established database initialization and reachability, not complete automation. [2,8]

### Grounded action and cost boundaries

Current Ask AI supports two narrow proposal families: a reorder grounded in known restaurant inventory/providers, or a vendor-reply draft for an existing order. It uses bounded candidate sets, validates proposed identifiers, revalidates confirmation and delegates to domain executors. Owner/manager confirmation and later approval/send behavior remain separate. This is a useful operational foundation; it is not evidence of general autonomous control over arbitrary restaurant actions. [6,8]

The current rate controls include ten proposals per person per minute and 200 per restaurant per hour. A first-attempt daily spend check exists, superseding older claims that none was present. However, it is opt-in, cached for 60 seconds and fail-open when its ledger read fails; unknown prices contribute zero to enforcement and concurrent work can overshoot. It is a bounded operational safeguard, not a hard provider billing cap. [8]

Model identifiers and routes are configuration evidence, not proof of availability, quality or provider credit. The simulation explicitly used a guarded route to supply synthetic extraction after model credit was unavailable. That scenario can validate later document processing, but cannot be cited as proof that the live model itself parsed those invoices. [7,8]

### External integration maturity

Outgoing MCP Connections include declaration, probing, grants, credential protection and consequential-action challenges. The separate inbound Mudavym MCP endpoint uses house-scoped hashed keys, ten read tools and eight declared write refusals pointing back to human approval. Its rate counter is process-local, which matters if replicas multiply. Neither system should be confused with the external connectors used by an engineering assistant. [8]

Payment-method setup and a separate real text-credit purchase path exist. The latter uses a seal, a prewritten purchase intent and provider reconciliation; it is not merely a simulated credit increment. Live charging was not exercised. POS registry breadth likewise differs from completed provider support; some adapters are partial or scaffolded, and production SimPOS is disabled. The Meta census found zero active non-revoked credentials and zero duplicate groups; the missing unique index remains a pre-rollout gap. Email, text, calendar and OAuth paths need consent, callbacks and outcome checks for the launch cohort. [2,5,6,8]

## 7. Domain and deployment transition

Cloudflare's mudavym.com zone is active. Apex and www DNS-only A records point to 76.76.21.21, and both are attached to the same Vercel production deployment. No Cloudflare Pages project was returned. DNS-only status means requests resolve toward the origin rather than traversing Cloudflare's HTTP proxy. Existing mail records also serve separate purposes and must be preserved during any future DNS changes. [2,11]

The verified old application alias is restaurant-ai-automation-web.vercel.app, which still serves HTTP 200 directly. A fresh HTTP check found www.mudavym.com returning a 308 redirect to https://mudavym.com/, which serves HTTP 200. The founder explicitly confirmed retaining **mudavym.com as canonical**, so the present www redirect matches the intended behavior. The initially mentioned restaurantAI.com was not established as a project-owned domain; its public response is not ownership evidence. A redirect decision for that hostname requires clarification and evidence. [2]

Vercel distinguishes assigning domains from selecting a primary domain and redirecting aliases. Its current guidance supports keeping external DNS at Cloudflare while serving the application on Vercel. There is no evidence-based reason to perform a hosting migration merely because the new domain uses Cloudflare DNS. A change to the actual host would be a separate architecture decision. [12,13]

### Remaining migration surfaces

| Surface | Current evidence | Acceptance needed before declaring completion |
|---|---|---|
| DNS and deployment | Both hosts attached; www redirects 308 to the confirmed canonical apex; old Vercel alias serves directly | Preserve canonical direction and determine legacy alias/link policy. |
| Public design | Deployed bundle defaults VITE_MUDAVYM_PUBLIC off | Review login/register, then intentionally activate the selected public experience. |
| Restaurant designs | One settings row: 11 design flags true, nine false; no tenant identity queried | Establish the intended named cohort and review roles/page dependencies. |
| Authentication links | Custom JWT auth; legacy fallback origin remains in source | Verify reset, verification, invitation and sign-in links resolve to one intended origin. |
| OAuth and integrations | Multiple provider paths implemented | Confirm authorized origins, registered callbacks, grants, redirects and disconnect behavior. |
| Browser state | Local storage, caches, PWA and queued work are origin-bound | Explicitly handle existing sessions and unsent work when origins change. |
| Native release | Separate API/web URL configuration and deep links | Verify actual binary settings, links, push, lock and offline flows on devices. |
| Operational data | All 184 migration versions match live; catalog grants/policies inspected | Correct trust-function grant; validate policy behavior, storage configuration and restore. |
| Observability | Gateway ready; simple orchestrator health successful | Verify consumers, agent output, failures, retries, spend and provider outcomes. |

The enabled stored design keys are dashboard, orders, receiving, receiving_door, providers, communications, team, inventory, receipts, documents_reports and document. Calendar, cellar, connections, logs, notifications, profile, recommendations, reports and settings remain false in the single settings row. Restaurant identity was not queried, so this does not establish which rollout cohort it represents. Browser overrides can still display a different experience. [2]

FRONTEND_URL is used as an origin list in some server configuration and as a scalar base for generated email links elsewhere. A multi-origin value can therefore produce malformed links. The actual configured value was not retrieved; the source inconsistency is sufficient to justify a dedicated canonical-origin accessor or a separate setting. Supabase Auth redirect configuration is not the central fix for an application whose login is custom gateway JWT. [6,8]

### Build and release controls

Vercel's effective production configuration uses pnpm 8.15.0 and Node 24, while the root project declares pnpm 9.15.9. The current deployment succeeds, but this divergence complicates reproducibility. Railway also hosts an older web development service and a mobile Metro service; current deployment statuses identify watched-path skips rather than failed new deployments. Another Vercel project named restaurant-ai-automation-api-gateway actually builds the web frontend, so its name is not proof of a second hosted NestJS gateway. These services' purpose and exposure should be documented before consolidation. [2,8]

The workflow named Deploy to Production is a post-push health and provenance audit. Platforms auto-deploy on push, so that workflow is not a pre-deployment approval gate. Live branch protection requires five checks with strict branch currency, prohibits force pushes/deletion, permits administrator bypass and requires no pull-request review. At the audited main commit, 39 checks succeeded and one rollback was skipped; all four CI, schema-parity, CodeQL and deployment workflows succeeded. The security scan uploads SARIF but source lacks an explicit Trivy failure policy; open security-gate work still needs reconciliation with effective enforcement. [2,8]

Scheduled production validation is materially weaker. The latest five Production E2E runs, September 9-13, failed. The latest run stopped at its required-credentials precondition before API, agent and browser waves ran; it predates the audited main commit. This does not invalidate current-main CI, but the nightly job currently supplies no successful end-to-end operational evidence. [2]

## 8. Findings and validation priorities

The following priority is an engineering judgment based on potential cross-tenant impact, action correctness and rollout dependency. Static evidence is distinguished from runtime confirmation. No production exploit, vendor send, payment, tenant change or migration was used to demonstrate these findings. [6,8]

| Priority | Finding | Evidence and required closure |
|---|---|---|
| High | Logs correlation ownership | Current service queries event_store by correlation alone for an authenticated restaurant timeline. Add ownership proof and a foreign-tenant refusal fixture. |
| High | Public trust-counter mutation | Live SECURITY DEFINER function retains PUBLIC execute and accepts a user ID without ownership validation. Revoke inappropriate execution and prove refusal in isolated fixtures; preserve required service access. |
| High | Receiving double-converts stored bottle quantity | Five cases of 12 are stored as 60 bottles, then treated as 60 cases. Exact helper reproduction yields 720 interpreted bottles and a -660 adjustment. Align declared units before applying any delta. |
| High | Native outbox actor/house/lock binding | Exact-source no-network reproduction confirms dispatch with current credentials and while locked. Bind entries to identity and gate replay; backend acceptance was not tested. |
| High | Native order approval contract | Mobile sends approve without X-Seal-Challenge; current gateway unconditionally requires a redeemed challenge. Add a supported native review/challenge flow and compatibility test. |
| High | Native priced-receipt contract | Mobile omits invoiceCurrency when submitting invoiceUnitPrice; current DTO refuses that shape. Isolated validation rejects it, while adding currency or omitting price passes. |
| High candidate | Active-house role overwritten by global role | JWT creation and later validation derive role differently. Cross-branch owner/staff fixtures must verify every affected authorization path. |
| Medium | Failed web switch changes visible house | UI state can change after failed token switching. Make token, active restaurant, cache and headers transition atomically. |
| Medium | Offline and cached state crosses sessions | Browser receiving replay uses current credentials; native cache teardown is not centralized. Validate logout, forced expiry, switch and stale work behavior. |
| Medium | Dashboard cache lacks house identity | Same mounted month hook can display the previous house's value; isolated reproduction confirms it. Normal flag remounts may hide the defect. Include house in cache identity. |
| High before text rollout | Active Meta sender reference lacks uniqueness | Live index is absent; census found no active credentials or duplicate groups. Add the appropriate constraint before enabling the text port. |
| Medium | Sommelier history auth mismatch | Anonymous browser Supabase query expects auth.uid(), while login uses gateway JWT; errors become empty history. Verify with a test identity and align the boundary. |
| Medium | AI spend and health claims exceed safeguards | Cached fail-open cost gate and simple HTTP health are weaker than hard cap and agent readiness. Expose the true operational status. |

The receiving reproduction proves the helper's incorrect delta and the service's subsequent adjustment path; it did not change live stock. The trust function was inspected, not called: it can inflate a contributor counter used in later auto-promotion logic, but invoking that function alone is not proof of direct role promotion. The native queue reproduction proves client dispatch only, not backend acceptance. The role finding's endpoint reach depends on additional checks. These qualifications preserve actionability without exaggerating impact. [6,8]

### Verification actually completed

The current route-exposure guard passed across 663 route declarations in 72 controllers: 624 authenticated, 39 public and zero undeclared. The swallowed-read guard passed with 185 existing baseline instances, which means no new unapproved cases rather than zero error-handling debt. Eleven native unit/source suites passed 231 tests against the exact current-commit export. No duplicate migration versions were found among 184 top-level migration files. [6,8]

Public gateway liveness/readiness and HTTP/Socket.IO CORS for the intended origin passed. Matching deployment commits, the shipped default-off public design function, live migration ledger, aggregate house flags and selected permission semantics were verified. Isolated reproductions cover queue dispatch, dashboard caching, receipt arithmetic and native priced-receipt validation. Full web/gateway/Python suites, live policy-behavior tests, provider journeys and physical-device tests were not comprehensively rerun. The scheduled production E2E failures remain separate evidence. [2,6,8]

## 9. Recommended continuation

First, establish an implementation branch from the then-current main and reconcile new work against this snapshot. Close logs ownership and public trust-function permission gaps, correct the receiving unit contract, and align native identity, approval and currency behavior with the gateway. Include mixed roles across two restaurants, case/bottle conversion, failed switching, token expiry, logout, locked restore and offline replay. These scenarios should demonstrate refusal or safe recovery as well as successful rendering. [6,8]

Second, build on the completed read-only Supabase verification rather than repeating it blindly. Migration versions match, aggregate flags are known, and a specific live permission defect is identified. The remaining data evidence includes full policy-behavior fixtures, bucket/public-object configuration and tested backup/restore. Zero storage policies and enabled storage RLS do not alone establish every object's exposure or the intended service-role workflow. Queue/agent readiness and integration-console consent/callback evidence remain separate gaps. Existing account access was sufficient for the narrow database queries; no new database password was required. [2,8]

Third, select the launch restaurant and roles, required integrations and mobile release scope, preserving the confirmed apex canonical address. Review the twenty page gates as related surfaces, including public entry, invitations, owner/manager/staff differences, denied/empty/error states, document links and approval ceremonies. Resolve the remaining design forks against later ADRs rather than treating an old gallery as a complete current specification. [5,7]

Fourth, validate one complete restaurant loop using a designated test house: ingest a sale, update inventory, produce a grounded proposal, review and approve, transmit through an explicitly authorized vendor channel, receive, reconcile discrepancies, verify cost and inspect the resulting timeline/report. Include duplicate delivery, unknown price, failed send and retry. Each stage should retain an identifier and one unambiguous outcome. [4,6,8]

Finally, activate the selected experience through the existing staged rollout with a recorded rollback state and observable success criteria. Activation should follow proven user journeys and operational readiness. Domain attachment and a green deployment are useful prerequisites; the launch decision belongs to the product behavior they enable.

## 10. Open decisions and durable records

The next consequential decisions are the exact legacy aliases and redirect policy; the rollout/test restaurant and roles; native release timing; required provider journeys; and owner-only versus manager-permitted actions. The apex canonical address is confirmed. Product forks remain around portions of Arrival, public pages, notifications, recommendation actionability and proposed motion/overlay work. Existing saved answers and later ADRs should be carried forward before requesting new decisions. [5,6,7]

The permanent knowledge base records company direction, current architecture, the source/deployment distinction, design decisions, findings, checks and open questions. Supporting audits retain per-file references, every supplied artifact URL, document review status, routes, migration inventory, sanitized live evidence and a reproducible queue demonstration. Together these records support future work without relying on conversation memory or unsupported claims of complete understanding.

## Sources

[1] RestaurantAIAutomation, [audited commit 60ed83a7](https://github.com/aldemirkonuk/RestaurantAIAutomation/tree/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff), [PR #373](https://github.com/aldemirkonuk/RestaurantAIAutomation/pull/373), and [current-main handoff](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/handoff/PROGRESS.md). Source and merge evidence, September 13, 2026; private repository access required.

[2] Mudavym infrastructure evidence, September 13, 2026. Authenticated Vercel deployment/domain records, Railway service/deployment records, Cloudflare zone/DNS records, public readiness/CORS/assets, HTTP/CI checks and read-only Supabase catalog/aggregate queries. Preserved in research/infrastructure-live-evidence.json, supabase-live-metadata-2026-09-13.json, supabase-readonly-audit.sql and infrastructure-audit.md; private local records with secrets and customer rows excluded.

[3] RestaurantAIAutomation, [PR #289](https://github.com/aldemirkonuk/RestaurantAIAutomation/pull/289) and [PR #353](https://github.com/aldemirkonuk/RestaurantAIAutomation/pull/353), merged September 12, 2026. Redesign and supplied-branch reconciliation; private repository.

[4] Mudavym planning records: .planning/PROJECT.md; FUTURES.md; decisions/0001-mudavym-single-entity.md; decisions/0006-neural-footprint-architecture.md; foundation/README.md; 04-specs/ECOSYSTEM-PLAN.md. Supplied checkout fb19885e and dated decision records, interpreted as company direction. Paths and source excerpts indexed in mudavym-2026-09-13-handoff-corpus-audit.md.

[5] Mudavym documentation and handoff audit, September 13, 2026, mudavym-2026-09-13-handoff-corpus-audit.md; current-documentation-delta.md; current-documentation-manifest.csv; documentation-inventory.csv; page-doc-index.csv; related capability matrices. Includes historical HOME/ORG-MAP, SOFTWARE-MAP, page dossiers, ADRs and current handoff; dates, review depth and supersession are recorded individually.

[6] Mudavym product and implementation audit, September 13, 2026, mudavym-2026-09-13-product-code-audit.md and related web/native matrices. Exact-source references at 60ed83a7 include apps/web/src/App.tsx; PageGate.tsx; useMudavymDesign.ts; publicDesign.ts; AuthContext.tsx; gateway logs-timeline.service.ts, auth.service.ts, jwt.strategy.ts and procurement.service.ts; mobile outbox.ts, session.ts, api/client.ts and supply/[id].tsx. Full paths, line references and test scope are in the audit.

[7] Mudavym artifact and design audit, September 13, 2026, mudavym-2026-09-13-artifact-design-audit.md and safari-artifact-source-map.md. Thirteen supplied Safari tabs, including [Wave Four](https://claude.ai/code/artifact/fb2f9455-8d35-411c-85c9-cfb0dbbf7abe), [Arrival](https://claude.ai/code/artifact/1d40bc3d-6ddd-49c6-b894-e626fc7f72ad), [Go-Live Board](https://claude.ai/code/artifact/260e2af7-8a3c-4bd0-8ff8-4fd1618007ee), [Motion Canvas](https://claude.ai/code/artifact/e281272f-c403-4780-a675-0e9a0a4289ba), and [Sim Meyhouse](https://claude.ai/code/artifact/d59646d4-0021-43dd-87e9-9fc70135849e). Private/authenticated artifact access may be required; historical examples and saved notes.

[8] Mudavym infrastructure and backend audit, September 13, 2026, mudavym-2026-09-13-infrastructure-audit.md and infrastructure-inventory.json. Exact-source references at 60ed83a7 include gateway database, model-client, Ask AI, MCP and procurement services; Python main.py, agent_registry.py and health routes; 184 migrations; CI/deployment configuration. Full paths and line references are preserved in the audit.

[9] Mudavym ADR 0042, Iznik seal and Warm Charcoal; ADR 0047, The mark is the trued A+M interlock, with August 31 rollout update. [ADR 0047 at audited main](https://github.com/aldemirkonuk/RestaurantAIAutomation/blob/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff/.planning/decisions/0047-am-interlock-supersedes-rivet-m.md). Current theme behavior reconciled against PageGate, DashboardNext and CSS in source audit.

[10] MDN Web Docs, [SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition), accessed September 13, 2026. Browser recognition may use a server; local processing capability must be verified rather than inferred from a microphone control.

[11] Cloudflare, [Proxy status](https://developers.cloudflare.com/dns/proxy-status/), accessed September 13, 2026. DNS-only versus proxied record behavior; applied to directly observed zone records.

[12] Vercel, [Deploying and redirecting domains](https://vercel.com/docs/domains/working-with-domains/deploying-and-redirecting), accessed September 13, 2026. Domain assignment and primary-domain redirects.

[13] Vercel, [Setting up a custom domain](https://vercel.com/docs/domains/set-up-custom-domain), accessed September 13, 2026. External DNS and deployment-domain configuration; provider-assigned values must be inspected for the actual project.
