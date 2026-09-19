---
type: review-evidence
status: historical-audit
updated: 2026-09-13
audited_commit: 60ed83a7e6d5eb8b8e0e631783a598cd0f562bff
links: ["[[MUDAVYM-TRANSITION-2026-09-13]]"]
---

> Dated audit evidence imported into the existing vault. Later implementation status lives in [[handoff/PROGRESS]]. Findings and counts describe their explicitly cited versions, not future work.

# Mudavym infrastructure, data and AI audit

Observed 2026-09-13, approximately 17:52–18:16 UTC. This is a read-only handoff audit, not a deployment or a certification that every workflow works.

## Evidence boundary

The supplied checkout is `local-evidence/restaurant-ai-automation`, branch `feat/p1-readout`, at `fb19885e80275f03c0817716671f05006823ede2`. It is materially older than production. After detecting that difference, this audit read current main directly through Git objects at **`60ed83a7e6d5eb8b8e0e631783a598cd0f562bff`**. File-and-line references below mean that exact main revision unless marked “checkout” or a separate worktree. A local clickable file can therefore display older content; use `git show 60ed83a7:path` for the referenced revision.

Evidence classifications:

- **Live verified:** a read-only platform response or public response observed during this audit.
- **Source verified:** code/configuration at the stated commit. This proves implementation shape, not that a secret, account, flag, queue consumer or business outcome exists in production.
- **Historical claim:** a dated repository comment, decision or handoff. Useful context, independently rechecked where possible.
- **Open:** evidence still needed. No assumed answer is promoted to a fact.

No repository files, branches, deployments, DNS records, databases, flags or messages were changed. No `.env` file or service-account credential file was opened. The tool output suggesting Railway agent-tool installation was treated as tool-supplied advice, not as a user instruction. No AGENTS.md was discovered within the supplied repository; historical handoff instructions were treated as evidence, not authorization to merge or send messages.

## What is running now

The target spelling is **Mudavym / www.mudavym.com**, confirmed by the user during the parent audit. The initial `mudavim.com` spelling is resolved and is not an outstanding migration requirement.

| Surface | Live observation | What it proves |
|---|---|---|
| Vercel project | `restaurant-ai-automation-web`, authenticated account; project root `apps/web`, framework Vite, Node 24.x | The frontend still deploys on Vercel |
| Production frontend | Ready deployment `dpl_GMu9JKpyMBrQTsE1eKmpUxNkXSUa`; Git source `main` at `60ed83a7…`; created 2026-09-13 16:53:58 UTC | The new main revision reached the frontend |
| Frontend aliases | `mudavym.com`, `www.mudavym.com`, `restaurant-ai-automation-web.vercel.app` all attached to that deployment | Custom-domain attachment is already complete; it is not a pending move to Cloudflare hosting |
| Domain registration/DNS | Vercel reports third-party registrar and Cloudflare nameservers `chelsea.ns.cloudflare.com`, `vern.ns.cloudflare.com` | Cloudflare is in the DNS chain; root audit separately verifies exact DNS/proxy settings |
| Railway project | `virtuous-delight`, production | Existing authenticated Railway access works |
| Railway gateway | `@wineops/api-gateway`, SUCCESS, commit `60ed83a7…`, deployment `61a43a52-f2a6-4d4d-8721-ee738f6c4c2f` | Gateway platform revision matches current main |
| Railway orchestrator | `services/agent-orchestrator`, SUCCESS, commit `60ed83a7…`, deployment `c5c20e32-5c29-4440-8cc3-899fc0e603f4` | Orchestrator platform revision matches main; this does not prove all agents run |
| Railway mobile | `@wineops/mobile`, SUCCESS, commit `941d9cb40d79f75390f7cf2b19dd462855b53081` | The Railway mobile service exists; this does not prove an App Store/Play Store release |
| Railway web | `@wineops/web`, SUCCESS, commit `49893467c38a22b7db8c09ea1f8943cadd6643df` | A second, older web service exists separately from Vercel |

GitHub combined status at 18:11 UTC confirms the older mobile/Railway-web commits were deliberate watcher skips on current main: both report “No deployment needed - watched paths not modified.” They are not failed deployments.

Public endpoints checked at 17:59:43 UTC:

- Gateway `https://wineopsapi-gateway-production.up.railway.app/api/v1/health/live`: `status=ok`, commit `60ed83a7…`, booted `2026-09-13T16:54:55.031Z`.
- Gateway `/api/v1/health/ready`: same commit and boot time; `status=ready`; injector resolved, Supabase client initialized, database reachable.
- Orchestrator `https://servicesagent-orchestrator-production.up.railway.app/health`: `{"status":"ok"}`. Its public response carries no commit and no dependency status; Railway metadata supplies the revision independently.

At 18:02:29 UTC, public CORS preflights allowed the exact `https://www.mudavym.com` origin on gateway HTTP and Socket.IO, with credentials and the requested authorization/content-type/restaurant headers. Socket.IO also allowed `https://mudavym.com`. These probes confirm current browser-origin admission, not an authenticated socket session or notification delivery.

## Domain attachment and design rollout are separate

The new public design is **off by default in the live frontend**. This was checked without reading secrets:

1. Main `apps/web/src/lib/mudavym/publicDesign.ts:15–22` defines precedence: browser localStorage `mudavym.design.public`, then build variable **`VITE_MUDAVYM_PUBLIC`**, then false. The similarly named `VITE_PUBLIC_DESIGN` is not the implemented variable.
2. Vercel environment metadata returned no `VITE_MUDAVYM_PUBLIC` entry.
3. Public asset `https://mudavym.com/assets/index-UQ0a2IMR.js` contains the compiled equivalent of an undefined environment read (`function gM(){try{return}catch{return}}`) and `parse(readEnv()) ?? false`.

A designer's browser can still force the new public design on using the documented localStorage override. Thus a screenshot from one browser does not establish global rollout. Tenant design switches are a separate database-controlled mechanism. A later aggregate-only live query (18:14 UTC; detailed below) found one reserved restaurant-settings row, with 11 of 20 design flags enabled for that one restaurant. No restaurant names or IDs were returned, so its identity and the intended five-restaurant cohort remain unverified.

The go-live design decision in the separate worktree `wt-pr328/.planning/decisions/0131-the-new-house-goes-live-dark-then-one-house-at-a-time.md` is corroborating handoff context; it must be reconciled with current main and current flags before any rollout action.

## System map

```text
Cloudflare DNS -> Vercel Vite/React web -> NestJS /api/v1 gateway -> Supabase Postgres
                         |                       |                + Storage
Expo/React Native mobile +                       + Socket.IO /ws
                                                 + HTTP -> FastAPI orchestrator
                                                 + RabbitMQ topic events
FastAPI agents -> Supabase service-role client + Redis + RabbitMQ
Gateway/agents -> model providers, POS, Gmail, notifications and other integration adapters
```

The Vercel configuration also rewrites `/api/:path*` to the Railway gateway. However, the browser API client uses the build-time `VITE_API_GATEWAY_URL`, falling back to `http://localhost:4000`, rather than automatically selecting that same-origin rewrite. WebSocket configuration separately uses `VITE_WS_URL`, falling back to `ws://localhost:4000`. A working rewrite alone does not prove that a particular frontend build uses it. Sources: `vercel.json:10–15`, `apps/web/vercel.json:7–12`, `apps/web/src/services/api/client.ts:19,48–52`, `apps/web/src/lib/websocket.tsx:225`.

The gateway is NestJS 10/TypeScript, with global request validation, scheduled jobs, Redis caching, error tracking, rate limiting, explicit route guards and an API prefix of `/api/v1`. The Python service is FastAPI/Python 3.11, with PostgreSQL/Supabase access, asynchronous agents, RabbitMQ messaging and Redis support. Gateway Docker uses Node 20; mobile Railway configuration pins Node 22. Source: `apps/api-gateway/src/main.ts:10–60`, `apps/api-gateway/src/app.module.ts:69–147`, Dockerfiles and `.railway/railway.ts`.

The current gateway imports these functional groups (`app.module.ts:95–144`):

| Group | Implemented modules and responsibilities |
|---|---|
| Identity and tenancy | Auth, organizations, restaurants, per-restaurant membership, preferences and settings |
| Stock and catalogue | Inventory, immutable inventory ledger, wines, beverages/cocktails, cellar registers, storage locations and menus |
| Purchasing | Procurement, providers, deliveries, canonical documents, reconciliation, credits and vendor conversations |
| POS | Toast integration, canonical multi-POS hub, item mappings, checks and consumption; SimPOS excluded in production |
| Intelligence | Analytics, forecasts, goals/scenarios, recommendations, price-index registry, commodity context and distributor feeds |
| Operations | Calendar, events, team schedules/notes, dashboard, logs and one-tap actions |
| Communications | Gmail, scheduled communications, house mailbox, letters, mail archive/retention, text-sender foundation, notifications and push |
| External access | Google/Microsoft OAuth, per-house MCP connections, inbound Mudavym MCP server |
| Commercial/platform | Payment methods, Stripe billing integration, vendor portal/catalogue/discovery, UX optimizer, Ask AI and mobile API |

Module registration is not a claim of full product readiness. For example, a registered billing module still depends on Stripe configuration and verified callbacks; a text adapter does not mean a house has a registered sender or consent.

## Identity, permissions and credentials

This is primarily **custom gateway authentication**, not a Supabase Auth application. The gateway issues and validates its own JWTs, stores users in `public.users`, and uses a Supabase **service-role** client for data access (`database/database.service.ts:13–28`). The frontend keeps access and refresh tokens in origin-bound localStorage; its synchronous request interceptor attaches Bearer auth plus the active restaurant header, and reactive 401 handling deduplicates refresh attempts (`apps/web/src/services/api/client.ts:19–120`). A domain change therefore creates a fresh browser storage context; existing sessions should not be assumed to transfer automatically.

`JwtAuthGuard` authenticates, then applies tenant matching and email-verification checks. This placement matters because global guards execute before Passport establishes `request.user`. `JwtStrategy` takes the active restaurant from the signed token, while verification state comes from the database; development bypass is rechecked against nonproduction environment conditions. Sources: `auth/guards/jwt-auth.guard.ts:28–91`, `auth/strategies/jwt.strategy.ts:18–80`, `auth/dev-bypass.util.ts`.

Because both backend services use service-role access, database RLS is not a substitute for service-level tenant predicates. A route can authenticate correctly and still expose a foreign row if the service forgets the restaurant constraint. The current `/logs` finding below is a concrete example of that distinction.

Google/Microsoft login and user-authorized integrations are distinct contracts. Integration grants use server-side, single-use OAuth state and encrypted tokens. `TokenCryptoService` uses AES-256-GCM with a versioned payload, and integration availability refuses configuration lacking an encryption key (`common/crypto/token-crypto.service.ts:10–105`; `integrations/integrations-oauth.service.ts`). Current integration scopes include Google Drive `drive.file`, separate `gmail.send` and `gmail.readonly` grants, and Microsoft `Files.ReadWrite`, `User.Read`, `offline_access` (`integrations-oauth.constants.ts:88–295`). These should be verified as separate provider registrations/callbacks, not collapsed into one “Google connected” checkbox.

The new confirmation seal is a server challenge bound to actor, restaurant, subject, action and argument hash. Its raw token is not stored; redemption uses an unredeemed-row condition to make the challenge single-use (`common/seal/seal-challenge.service.ts:28,59–63,96–128,150–223`). A button animation alone is not the authority; this server contract is what consequential flows must consume.

## Database and business-record design

Current main has **184 top-level versioned migrations plus 5 nested seed SQL files**. The supplied checkout has only 109 versioned migrations. A declaration census found 279 distinct names in CREATE TABLE statements across main; this is **not** a count of live tables because migrations can replace/drop objects and contain other schema logic. A complete machine-readable inventory is in `infrastructure-inventory.json`.

The repository rebased migration history onto a production baseline in August. `supabase/SCHEMA_DRIFT.md` records historical drift and a baseline of 172 tables, 526 indexes, 43 functions, 44 triggers, 16 views and 57 policies, with a claimed then-current parity check. Those are dated baseline measurements, not September live counts. The only active migration home is `supabase/migrations/`; 105 files in `supabase/migrations_archive/`, legacy service migrations and older SQL-editor copies are historical. Do not execute archived SQL as pending migrations.

Core record families:

- **Tenancy:** organizations, restaurants, users, organization_members and user_restaurant_access. User identity keys are `users.user_id`; restaurant keys are `restaurants.id`.
- **Catalogue:** master wine library/submissions, beverages, cocktails, producer/reference vocabularies, evidence citations, promotion policies and repair/merge history. The venue's own stock identity is distinct from shared catalogue identity.
- **Stock:** restaurant_inventory is supported by inventory_lots, immutable inventory_transactions, counts, pours and POS mappings. Mutations are routed through `apply_stock_movement`; recent main introduces explicit restaurant binding for stock writes. `record_stock_count` records counts even when variance is zero. Sources: `inventory-ledger/inventory-ledger.service.ts:102–169,586–664`, migration `20260912163000_a_stock_write_names_its_house.sql`.
- **Purchasing:** procurement_orders/items, conversations, canonical documents/lines/links, deliveries, proposals, line acceptances, receipts, credits, vendor terms and timers.
- **Signals and audit:** event_store, outbox, saga_state, dead-letter/replay records, decision_log, neural_footprint_event, verdicts, notification_deliveries and audit logs.
- **New connection/commercial records:** integration OAuth state/grants, house text senders and encrypted credentials, message use/credits, MCP grants/keys, billing/payment records and seal challenges.

The canonical delivery model deliberately separates the commercial event from its documents. One document can relate to several deliveries and a delivery can have several documents. `AGREED` and `VERIFIED` are separate states; payment is an invoice fact rather than a delivery state. Original extracted fields retain per-field provenance, confidence and as-printed values. Corrections create revisions and append-only audit records, enforced by triggers. Stock booked at the door and finalized cost are distinct stages. Sources: `supabase/migrations/20260903160000_canonical_document_and_delivery.sql:68–149,161–190,202–257,402–489,496–545,585–618`, later delivery and cost migrations, `procurement/canonical/delivery-stock.service.ts:438–470`.

That migration also contains jurisdiction-specific deadlines and retention assertions. This audit inventories them as product rules encoded in source; it does not independently certify their legal correctness. Parent research should attach current jurisdiction-specific legal/professional review before relying on them operationally.

RLS/grant changes are substantial. August migrations revoke client privileges over postgres-owned tables and views, set security-invoker views, revoke selected function access and change postgres default privileges (`20260825210000_od72_revoke_client_grants.sql:58–85,101–168,183–190`). Later evidence-gate tables are explicitly relocked (`20260826210000_od73_relock_evidence_gate_tables.sql:48–74`). This is source verification; live ACLs, function grants, storage bucket policies, backups/PITR and migration ledger parity were not queried here.

## AI and automation operating model

The Python registry describes **24 agents: 13 core, 5 on demand and 6 optional**. This is a registry count, not a running-agent count (`core/agent_registry.py:54–231`).

- Core: POS integration, buffer manager, inventory engine, inequality detector, invariant enforcer, procurement, provider conversations, provider communication drafts, notifications, calendar, reporting, email parsing and email intelligence.
- On demand: visual verification, sommelier, menu analyzer, RFQ and drift detection. Some also require feature flags.
- Optional: ghost inventory, negotiation playbook, auto-pilot, compliance, shrinkage detective, recurring-order proposals. The first five are declared stubs and the base harness refuses to start them as working agents. Recurring ordering is implemented as proposal staging behind its own enable flag.

Startup connects RabbitMQ first. If that connection fails, FastAPI continues serving HTTP but the agent orchestrator is not started (`services/agent-orchestrator/main.py:71–104`). This is why `/health=ok` is not an agent-readiness claim. The admin-key-gated `/api/v1/health/agents` endpoint can report actual agents and returns 503 if the orchestrator is absent (`api/health_routes.py:230–277`). This audit did not retrieve or use the admin key to query it.

The event system includes retries, idempotency, dead-letter handling, outbox/saga structures and observable agent health; these need end-to-end event evidence before “autonomous” is treated as an operational state. Review `core/message_bus.py`, `core/base_agent.py`, `core/outbox_publisher.py`, `core/orchestrator.py` and `tests/test_event_topology.py` together: message publication, subscription ownership and business persistence are separate links.

The gateway model client centralizes Anthropic transport, deadlines, bounded retries, token/cost accounting, correlation and neural-footprint emission. Unrecognized model prices are recorded as unknown rather than declared free. Current main routes lookup/help to `claude-haiku-4-5`, compose to `claude-sonnet-5`, consult to `claude-opus-4-8`, with explicit environment overrides (`common/model-client/model-routing.ts:113–208`). These are configured identifiers in source, not proof of provider availability or quality. Python uses both Anthropic and Gemini clients and additional provider-specific paths.

Ask AI is intentionally narrow: one grounded reorder or one vendor-reply draft, candidate IDs from the restaurant's own bounded lists, human confirmation, then existing domain executors. Current main adds validated DTOs, limits of 10 proposals/person/minute and 200/restaurant/hour, owner/manager-only confirmation, and an opt-in first-attempt daily spend gate (`ask-ai/ask-ai.controller.ts:71–172`, `ask-ai/ask-ai.service.ts:43–80`, `common/model-client/model-client.service.ts:281–302`). The supplied checkout predates those fixes; reporting “Ask AI has no first-call gate” would be stale.

Limits remain bounded controls rather than hard accounting reservations. The spend gate reads a shared ledger with a 60-second cache; it allows calls when ledger reads fail, allows a nonpositive override to disable the gate, sums unknown costs as zero for enforcement, and is opt-in per call site (`model-client.service.ts:618–710`). Concurrent requests can overshoot a cached threshold. This is an explicit residual operational limit to carry into spend monitoring and product pricing decisions.

Procurement draft approval has an atomic `PENDING_APPROVAL -> SENDING` claim before sending and preserves ambiguous send outcomes rather than re-opening an unsafe automatic retry (`procurement/procurement.service.ts`, `approveDraft`). Communication constraints include commitment phrases, quantity/price checks, topic limits, PII/payment patterns, loop prevention and escalation. Regex guards and model prompts reduce certain failures but do not establish universal semantic safety. Source: Python `services/constraint_engine.py`; gateway `common/orchestrator/commitment-patterns.ts`; associated specs.

Mudavym's own MCP server is separate from the connectors used in this Codex handoff. Main implements authenticated Streamable HTTP at `/api/v1/mcp`, house-scoped hashed keys, ten read tools, and eight declared write refusals that direct the operator to the human approval flow. The key's scopes filter reads; keys store SHA-256 hashes and are revocable. Its 60-calls/minute counter is process-local, with the multiple-replica limit explicitly documented (`mcp-server/mcp-server.controller.ts:27–105`, `mcp-credentials.service.ts:36–77,204–276`, `tool-catalog.ts`). No key was created and no tenant read was invoked during this audit.

## Deployment and quality controls

Vercel's **effective deployed configuration** was read through its deployment API: `cd ../.. && corepack enable && corepack prepare pnpm@8.15.0 --activate && pnpm install --frozen-lockfile`, then `cd ../.. && pnpm exec turbo run build --filter=@wineops/web`, output `dist`, Node 24.x. The root workspace declares `pnpm@9.15.9` and root Vercel config also uses 9.15.9. The successful deployment proves today's path builds; it does not remove this reproducibility discrepancy. Consolidate only after choosing the intended project root and validating the resulting lockfile/build behavior.

Railway IaC (`.railway/railway.ts`) declares four services: gateway Docker from repository root, Python Docker from `services/agent-orchestrator`, mobile Metro/start, and an additional web service running the dev command. Gateway/mobile watch patterns include their app plus root lock/workspace/package files. Web's watcher is its own subtree. Redis and RabbitMQ are referenced via settings, but are not separate services in that checked-in four-service declaration; their hosting and backups remain open.

The GitHub workflow named “Deploy to Production” is principally a **post-push health/provenance audit**. Its own trigger comments say Railway/Vercel still auto-deploy on push; the workflow waits for CI and checks services rather than preventing those platform deployments (`.github/workflows/deploy.yml:1–10`). Whether an unreviewed/bad commit can reach main is therefore a repository protection and platform-integration question, which the parent audit checks live. Do not call this workflow a pre-deployment approval gate.

Current CI covers TypeScript/Python lint/build/tests, local Playwright, boot checks, schema/query guards, vocabulary/decision/claim guards, migration version checks, PII/error-handling/proposal/stock invariants, model call accounting and security scanning. `CI Complete` runs even when dependencies fail and verifies that its dependency closure covers the workflow. Schema parity rebuilds a local database, compares against production, checks query targets, identity behavior and the migration ledger; pull-request comparisons account for migrations added by the PR. Sources: `.github/workflows/ci.yml`, `.github/workflows/schema-parity.yml:116–259,306–456`.

The production E2E workflow still needs separate interpretation: it has nightly and dispatch modes, explicit credential-presence prerequisites, and four surviving waves A/B/C/F. Toast/Gmail/Calendar legacy waves D/E/G are retired in current main (`.github/workflows/e2e-prod.yml:21–35,57–80,101–127`). A schedule existing does not prove successful execution. This audit did not run production E2E because some fixtures write test records and require credentials; live run conclusions are the parent GitHub audit's evidence.

Security scan source uses `aquasecurity/trivy-action@master` and SARIF upload without an explicit `exit-code` policy (`ci.yml:1361–1382`). The handoff's open security-gate work should be resolved against the action's effective behavior and CI history; uploading findings and failing on findings are separate outcomes. No assertion of zero vulnerabilities is made here.

## Findings to carry forward

| Priority | Finding and evidence | Next concrete verification/action |
|---|---|---|
| High | Live `increment_trust_counter(uuid)` retains PUBLIC EXECUTE despite being SECURITY DEFINER; accepts a target user ID with no caller check. Main baseline:678–688; OD72:149–165 revokes named client roles but leaves PUBLIC. | Revoke PUBLIC and direct client rights while preserving server use; isolated tests should prove denial and valid earned-trust behavior. No function call was made in production. |
| High | `/logs` accepts a supplied correlation ID and reads `event_store` without restaurant ownership. Main `logs-timeline.service.ts:122–127,340–365` filters only correlation ID; this uses the service-role client. The returned event metadata can cross tenants. | Add ownership resolution or remove this unscoped feed; demonstrate foreign-correlation refusal in a test. Do not replay another tenant's identifier in production merely to prove it. |
| High before text rollout | Current sender-credential migration enforces one live credential per sender ID, but no global uniqueness of active Meta phone `sender_ref`. `20260905215000_a_senders_credential_is_a_pointer_not_a_token.sql:82–90,146–148`. The separate `wt-port-text` incoming-WhatsApp path explicitly reads up to two matches and refuses ambiguity (`whatsapp-inbound.service.ts:95–124`). That incoming implementation is absent from current main. | Reconcile the open port; add the appropriate provider/active-sender uniqueness migration after reconciling the zero-active-credential live census below. Missing global uniqueness is source- and catalog-verified; no live duplicate was found. |
| Medium | Public design is dark globally; live aggregate design state has one settings row with 11/20 gates on. | Identify the intended cohort without assuming five-house enrollment, and review the nine remaining gates before activation. |
| Medium | Domain defaults are fragmented. Auth links still default to legacy Vercel; historical WineOps URLs remain in notification/email/API metadata. | Establish canonical app origin and distinct allowed-origin list. Check verification, reset, invite, integration callback, email and push links using a designated test account with explicit message authorization. |
| Medium | `FRONTEND_URL` is treated as comma-list for HTTP/socket origins, but scalar for verification/reset/invite URLs (`auth.service.ts:979–982,1191,2093–2096`). | A multi-origin value can produce malformed links. Introduce a canonical-origin accessor or distinct settings; actual configured value was not read. |
| Medium | Direct Sommelier conversation queries use the browser's anonymous Supabase client, while its policy requires `user_id=auth.uid()`; custom gateway login never supplies a Supabase session. Read errors become `[]` (`useSommelierQueries.ts:22–36`; baseline policy:14017). | Verify conversation persistence with a test identity, then route through gateway authorization or deliberately integrate the auth models. This should fail closed, but can look like empty history. |
| Medium | The daily AI spend guard is cached, opt-in and fail-open on ledger failure; hard-billed cap is not guaranteed. | Agree the required budget semantics; monitor actual provider spend and unknown-cost rows; consider atomic reservations if strict enforcement is required. |
| Medium | Vercel effective pnpm8/Node24 differs from root pnpm9/gateway Node20/mobile Node22. | Pin an intentional compatibility matrix and consolidate the Vercel root/config once tested. |
| Medium | Orchestrator HTTP health can be green with no agents; public health has no dependency/revision detail. | Use authorized admin health/agent-output evidence and queue metrics before asserting autonomy is healthy. |
| Review | Two Vercel frontend builds, a Railway web service and a hosted mobile development server complicate topology/cost/exposure. | Decide which are required and document access restrictions; do not delete them based on naming alone. |

## Access and remaining live unknowns

Existing Vercel and Railway CLIs are authenticated; no installation or login was needed. Vercel/Cloudflare domain attachment and public backend readiness can be assessed without secret access. The parent audit separately has GitHub and Cloudflare access.

A proposed platform-variable read with an output allowlist was **rejected by automatic approval review** because the Railway command retrieves all variables in raw form and could expose credentials. It was not retried or bypassed. Public preflight headers, deployment metadata and compiled public assets supplied the necessary domain/design evidence instead. Actual origin-variable values and secret-presence assertions remain unverified. This audit does not require the user to approve that broad read.

Still open: named rollout-cohort identity; effective end-to-end authorization beyond the catalog/aggregate checks below; full storage bucket and object exposure; tested backup/restore/PITR; provider callback registrations and consent status; actual queue/Redis hosting and consumer health; path/query preservation and canonical-link behavior beyond the root-page redirect checks below; Google/Microsoft/Stripe/Twilio/Meta/Gmail live configuration; real mobile distribution; error and spend dashboards; end-to-end customer and supplier workflows. These are named limits, not hidden assumptions.

## Coverage and reproducibility

The inventory at `infrastructure-inventory.json` records exact-commit source counts, all 184 migration filenames, CREATE TABLE declarations, route/guard declarations from 72 controller files and workflow job declarations. Main has 1,060 tracked gateway source assets (1,030 TypeScript), 295 orchestrator tracked files (277 Python), 417 gateway test files, 107 Python test files, 183 tests under web source and 11 mobile test files. These are file counts, not executed tests or coverage percentages.

The audit deeply read the entry points, deployment configs, auth/tenant/database boundaries, migration security changes, canonical delivery records, agent registry/lifecycle, core transport/accounting, Ask AI, MCP server, and the listed defect paths; it inventoried the wider modules and tests. It did not read every line of all files or run every test. The API/source map is intended to make further examination systematic rather than claim exhaustive proof prematurely.

Checks actually performed: exact-revision inventory; local duplicate migration-version scan (none among the 184 main migrations); authenticated Vercel/Railway project/domain/deployment inspection; public liveness/readiness and CORS checks; inspection of the shipped public-design function. No build, unit suite, database reset, migration, provider send or production E2E was run by this sub-audit.

Reproduce a reference without changing the checkout:

```sh
git -C local-evidence/restaurant-ai-automation show 60ed83a7e6d5eb8b8e0e631783a598cd0f562bff:apps/api-gateway/src/app.module.ts
```

Recheck live evidence when acting: these observations are a timestamped handoff, not an assertion that deployment, branch protection or tenant state cannot change.


## Follow-up live verification — 2026-09-13 18:10–18:12 UTC

Public HEAD requests followed redirects, retaining only status, location, server, content type and HSTS headers; no cookies or private page content were captured.

| Requested root URL | Observed chain | Meaning |
|---|---|---|
| `https://mudavym.com` | 200; Vercel | Apex currently serves the app directly |
| `https://www.mudavym.com` | 308 to `https://mudavym.com/`, then 200 | Current canonical redirect direction is **www → apex**; the founder subsequently confirmed retaining apex as canonical during the parent audit |
| `https://restaurant-ai-automation-web.vercel.app` | 200; no redirect | Known legacy app alias remains independently reachable |
| `https://restaurantAI.com` | 200; Cloudflare | Public reachability only. Ownership and association with this repository/Vercel project remain unverified; do not describe it as the proven legacy app hostname |

Apex and www responses include `Strict-Transport-Security: max-age=63072000`; the Vercel alias also includes `includeSubDomains; preload`. These are server response headers, not proof of preload registration or all subdomain behavior. No path/query-preservation or authenticated-session migration was exercised.

Authenticated GitHub read-only APIs confirm main remains `60ed83a7e6d5eb8b8e0e631783a598cd0f562bff`. Its **40 check runs consist of 39 successes and the intentionally skipped Rollback Playbook**. Four workflow runs completed successfully: [CI](https://github.com/aldemirkonuk/RestaurantAIAutomation/actions/runs/34769954283), [Schema parity](https://github.com/aldemirkonuk/RestaurantAIAutomation/actions/runs/34769954383), [CodeQL](https://github.com/aldemirkonuk/RestaurantAIAutomation/actions/runs/34769954340), and [Deploy to Production](https://github.com/aldemirkonuk/RestaurantAIAutomation/actions/runs/34770371638). Six combined commit-status contexts are successful, including Vercel web and the two active Railway backend services. This is recorded provider evidence, not a local re-run by this audit. Full safe summaries are saved in `github-main-checks-2026-09-13.json`.

Live main-branch protection has strict up-to-date checks enabled and five required contexts: `CI Complete`, `Beverage identity key — SQL matches Python`, `Guest merge policy — zero false merges`, `Fresh database equals remote`, and `Code queries only relations production has`. All five pass at this commit. `enforce_admins=false`; no required pull-request reviews; force pushes and branch deletion disallowed. Required conversation resolution, signatures and linear history are off. The repository ruleset list, including parents, is empty. Thus the repository has real merge checks, with administrative bypass permitted; the deploy audit does not supply an additional pre-deploy gate.

**Production E2E is a separate unresolved verification gap.** The five most recent scheduled runs, September 9–13, all conclude failure. The [September 13 run](https://github.com/aldemirkonuk/RestaurantAIAutomation/actions/runs/34744322647), at earlier commit `d3c10e2c20457b6e538ad4333c2b703ddfb52438`, fails at `Required secrets are present`; checkout and all customer/API/agent/Playwright test waves are skipped. Its copy-results step also fails. Job/step metadata were read; no logs, secret values or tests were accessed/run. The source of a missing prerequisite must be resolved before these nightlies can substantiate production workflows. Do not reinterpret this as a demonstrated customer-flow test failure or as successful operational coverage. Safe history is saved in `production-e2e-run-history-2026-09-13.json`.

An additional live Vercel project, `restaurant-ai-automation-api-gateway`, has a READY production build at current main (`dpl_CoEeWGkYgsTv1T1NzUC4eHACbzF1`). Despite its name, its **effective deployment configuration builds `@wineops/web` into `apps/web/dist`**, using root pnpm 9.15.9 and Node 24.x. Its alias is `restaurant-ai-automation-api-gatewa.vercel.app`. This is an additional frontend deployment, not evidence that the Nest gateway runs on Vercel. The separately inspected Railway gateway remains the verified backend. Review whether this duplicate frontend project is intentional; no project was disabled.

The installed Supabase CLI (2.98.2) successfully lists accessible project metadata using existing authentication. `Restaurant_Wine_Ops` (`exzueerziesmczwlhomd`) reports `ACTIVE_HEALTHY`, region `us-west-2`, created 2026-01-08. The exact-main Supabase Preview check links to the same project. No Supabase connector tools are currently callable. This first metadata check established access without CLI login, token/`.env` reading or linking. The subsequent bounded database metadata and aggregate audit below supersedes the earlier migration/flag/ACL unknowns; backup/restore remains unverified.


## Supabase catalog and aggregate audit — 2026-09-13 18:14–18:16 UTC

The existing CLI exposes `supabase db query --linked` through its Management API. It succeeded using existing authentication and the already linked project `exzueerziesmczwlhomd`. Queries ran in `BEGIN READ ONLY` transactions. No DB password, tokens, `.env` values, user/customer records, restaurant IDs/names, phone identifiers, encrypted credentials or message bodies were requested. No RPC business function was invoked. The safe results are in `supabase-live-metadata-2026-09-13.json`; the primary SELECT-only query is preserved in `supabase-readonly-audit.sql`.

**Applied migrations:** live contains exactly the same 184 version identifiers as exact main, with zero missing and zero extra. Latest version is `20260912200000`. This is ledger parity, not a standalone proof that all definitions match every migration or that rollback/restore works; the separately green schema-parity workflow provides additional recorded evidence.

**Design flags:** the reserved `restaurant_settings` filter returns one row, representing one restaurant. Eleven keys are true for that restaurant: dashboard, orders, receiving, receiving_door, providers, communications, team, inventory, receipts, documents_reports and document. Nine keys are false: reports, notifications, recommendations, calendar, settings, profile, connections, cellar and logs. Thus the live state is partial tenant activation, with the public redesign separately default-off. The aggregate query deliberately did not identify the restaurant. The intended founder-plus-four-simulation cohort cannot be claimed as enabled from these results.

**Meta sender census:** zero nonrevoked Meta credentials joined to nonrevoked house senders, zero connected credentials, and zero duplicate or cross-house duplicate sender-reference groups. This means no duplicate was present among the checked active records; it does not repair the absent invariant. Live index definitions confirm only the primary key, a restaurant/provider index and one-active-credential-per-`sender_id` uniqueness. There is no global active `sender_ref` unique index.

**Relation and policy metadata:** the catalog has 284 public ordinary tables, 28 public views, three public materialized views and eight storage tables. Of the ordinary tables, the only RLS-off public entries are `_bak_signature_repair_20260826` (no anon/authenticated grants) and PostGIS `spatial_ref_sys` (client SELECT and DML privileges). Public client table/view privileges otherwise remain on Sommelier conversations and PostGIS geometry/geography metadata views. Application tables such as event_store, restaurant_feature_flags and sender credentials have no effective anon/authenticated SELECT/DML grant. These observations support the application’s server-only access design; service-role requests still bypass that protection and need tenant-constrained queries.

The catalog lists 163 public/storage policies. Sommelier’s live PUBLIC policy is exactly `user_id = auth.uid()` for both read predicate and write check, corroborating the custom-auth mismatch. All storage tables have RLS enabled; the storage schema has **zero policies**. Broad underlying storage-role grants therefore do not by themselves permit client table access. This audit did not query bucket-public flags, stored objects, signed-link behavior or storage service settings, so it makes no claim that every object is private or usable.

**New high-priority function finding:** `public.increment_trust_counter(uuid)` is owned by postgres, is SECURITY DEFINER and has a live EXECUTE grant to **PUBLIC**, inherited by anon and authenticated. Its SQL increments `user_roles.consecutive_approved_overrides` for the supplied user ID where the role is certified_contributor and not revoked; it never checks the caller. Source baseline lines 678–688 match the live definition. OD72’s revocation loop (`20260825210000_od72_revoke_client_grants.sql:149–165`) revokes anon/authenticated directly but does not revoke PUBLIC, explaining why the intended lock-down is incomplete. Python `override_service.py:465–498` grants `auto_promote` after an approved override when the counter reaches five. An unauthenticated counter increment can corrupt earned-trust evidence; the function alone does not set the promotion policy. No exploitation or mutation was attempted. Fix the inherited PUBLIC permission, preserve intended service-role invocation, and test both denial and normal promotion in an isolated database.

The broad function census includes many PostGIS extension and SECURITY INVOKER functions; an EXECUTE grant alone is not proof of privileged data access. Extension-filtered metadata identifies the trust counter as the application-owned SECURITY DEFINER function still executable by client roles. Other application SECURITY DEFINER functions in this catalog, including guest identifiers, simulation seeding and procurement price propagation, have client execution revoked. This narrows the finding rather than labeling every function an exposure.
