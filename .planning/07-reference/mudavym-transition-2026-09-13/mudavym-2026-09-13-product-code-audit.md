---
type: review-evidence
status: historical-audit
updated: 2026-09-13
audited_commit: 60ed83a7e6d5eb8b8e0e631783a598cd0f562bff
links: ["[[MUDAVYM-TRANSITION-2026-09-13]]"]
---

> Dated audit evidence imported into the existing vault. Later implementation status lives in [[handoff/PROGRESS]]. Findings and counts describe their explicitly cited versions, not future work.

# Mudavym product and implementation audit

Audit date: 2026-09-13. This product-code sub-audit made no application-source edits, opened no environment secrets, and performed no live customer mutations, deployments, email sends, or package installation. The parent task separately saved the founder-requested working instructions.

## Evidence identity and limits

The supplied repository is `local-evidence/restaurant-ai-automation`. Its working checkout was **`feat/p1-readout` at `fb19885e` (2026-09-12)**. Its local `main` initially pointed to **`87a6cb25`**, also September 12. Neither was the latest GitHub main discovered by the root audit. This report was therefore reconciled against **`60ed83a7e6d5eb8b8e0e631783a598cd0f562bff`**, September 13, the merge of PR #373. That object was available locally and read with `git show`; only source files and test/guard inputs were exported into `/tmp/mudavim-current-audit` for isolated analysis.

**All source references below mean the exact `60ed83a7` commit unless explicitly marked “supplied checkout” or another worktree.** The current snapshot can be browsed at [the audited commit](https://github.com/aldemirkonuk/RestaurantAIAutomation/tree/60ed83a7e6d5eb8b8e0e631783a598cd0f562bff). A line in today's working checkout can differ. Repository comments and historical documents were treated as evidence of decisions and past claims, not as instructions granting new actions.

This is a broad static architecture/product audit with representative deep reviews, fresh mechanical checks, and isolated mobile tests. The subsequent [screen capability matrix](mudavym-2026-09-13-screen-capability-matrix.md) expands coverage to every gated web entry, all 23 dedicated redesign data hooks, and all 23 native screens. It does **not** establish that every controller, SQL policy, provider, deployed feature flag, or production user journey works. It does not establish security certification, native store release readiness, or end-to-end mobile offline safety. Parent audit supplies live infrastructure/domain and browser/artifact observations. Later aggregate Supabase evidence supersedes initial unknowns: all 184 current migration versions match the live ledger, 11/20 design gates are true in one observed settings row, and live function grants disclose a separate high-priority PUBLIC-executable `SECURITY DEFINER` trust-counter mutation. Those are documented in the [infrastructure audit](mudavym-2026-09-13-infrastructure-audit.md); this sub-audit did not invoke the function or independently query production.

At the initial inspection on 2026-09-13, no `AGENTS.md` was found in the supplied repository, including hidden paths, or the checked ancestor locations. The parent task subsequently created repository and research-workspace `AGENTS.md` files at the founder's request. No credentials or `.env` contents were opened. The larger handoff history exists in other worktrees and is handled in the separate corpus audit.

## 1. What the product actually is

The code implements an operator system for restaurant beverage operations. The founder confirmed **Mudavym** as the company/product spelling and **mudavym.com** as canonical, with **www.mudavym.com** intended to redirect to it, in this conversation. The code began under **WineOps** and retains legacy internal identifiers alongside the new Mudavym web designs. This naming records implementation history within one product.

It is substantially more than a public company website:

- A React/Vite web application with authentication, restaurant switching, operational ledgers, inventory, ordering, receiving, vendor communications, reporting, team scheduling, settings, and administration.
- A native Expo/React Native operational companion with Today, Cellar, Supply, Team, and Insights tabs, camera/receiving flows, notification deep links, secure token storage, a biometric entry gate, and a persistent mutation queue.
- A NestJS gateway that owns most browser/mobile API contracts, application authorization, database access, business actions, and real-time events.
- A Python FastAPI agent orchestrator plus supporting jobs/services for POS ingestion, inventory changes, procurement proposals, email triage/drafts, calendar, reports, wine extraction/research, and Studio curation.
- Supabase/PostgreSQL for tenant and domain records, Redis for caches/control functions, RabbitMQ for agent events, Socket.IO for client real-time updates, and multiple external providers.

The app's root `/` is an authenticated operational dashboard. A separate unauthenticated marketing homepage is **not** defined in the reviewed router. Moving the domain should preserve application routes and callbacks; it should not be treated as replacing a static homepage.

### Implementation map

| Area | Implementation | Evidence |
|---|---|---|
| Monorepo | pnpm workspaces and Turborepo; package names still `wineops-ai` / `@wineops/*` | `package.json:1`, `pnpm-workspace.yaml:1`, `turbo.json:1` |
| Web | React 18, TypeScript, Vite, React Router 6, TanStack Query 5, Zustand, Tailwind, Radix, Framer Motion, Recharts | `apps/web/package.json:1`; `apps/web/src/App.tsx:134` |
| Mobile | Expo 54, React Native 0.81.5, React 19, Expo Router 6, TanStack Query, Zustand, MMKV, SecureStore, Reanimated, Skia | `apps/mobile/package.json:1`; `apps/mobile/app/_layout.tsx:126` |
| Gateway | NestJS 10, custom JWT/Passport authentication, Supabase client, scheduling, Socket.IO, OpenAPI, Redis and RabbitMQ bridges | `apps/api-gateway/package.json:1`; `apps/api-gateway/src/app.module.ts:68` |
| AI runtime | FastAPI lifespan starts registry's CORE agents when RabbitMQ connects; HTTP may remain available without agents | `services/agent-orchestrator/main.py:74` |
| Shared UI | primitives, chart/stat components, layout and notifications; web imports it | `packages/ui/src/index.tsx:1`; `apps/web/src/components/ui/index.ts:1` |
| Shared DB package | Supabase initialization, query helpers and types; no application import found in current `apps` source search | `packages/database/src/client.ts:16`; `apps/web/src/lib/countries.ts:51` |

The shared packages do not unify the whole product. Most web domain UI is application-local; native mobile has its own tokens/components and its own API types. There is a real contract-maintenance burden across gateway, web, native, and Python.

### Snapshot scale, not coverage percentages

The current committed tree contains 957 files under web `src` (183 test/spec filenames), 1,060 under gateway `src` (417 test/spec filenames), 62 under mobile `src` (11 test files), and 27 mobile app route/layout files. The Python tests directory has 119 tracked files, 107 named `test_*`. These are filename inventories, **not** assertions that all tests ran or all files were reviewed in depth. Test-file counts include different kinds of tests and can exceed runner-discovered suites.

The older supplied checkout had materially less code: 673 web source files / 93 test files and 583 gateway source files / 202 test files in the initial `rg` inventory. A handoff based only on that checkout would omit work already merged.

## 2. Web route and redesign map

Current `apps/web/src/App.tsx` contains **61 explicit route patterns including redirects and the catch-all**. A generated complete list with line references is in `web-route-inventory.tsv` beside this report.

### Route inventory grouped by purpose

| Purpose | Routes | Rendering / access |
|---|---|---|
| Entry and identity | `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`, `/invite/:code`, `/no-access`, `/privacy` | Public router entries; auth workflows and public privacy page (`App.tsx:171`) |
| Getting started | `/get-started`, `/onboarding` | Public router entries; inner components decide available behavior (`App.tsx:184`) |
| Public vendor catalogue | `/v/:slug` | Vendor-published catalogue, no dashboard auth (`App.tsx:183`) |
| Studio | `/studio`, `/studio/queue`, `/studio/certify` | Separate layout; Studio-specific developer/contributor/review roles (`App.tsx:188`) |
| Studio invitation | `/studio/invite/:token` | Authenticated; deliberately no preexisting Studio role required (`App.tsx:220`) |
| Door receiving | `/receiving/:orderId/door` | Authenticated, chrome-free, PageGate legacy/new (`App.tsx:235`) |
| SimPOS harness | `/simpos/:restaurantId`, `/simpos/:restaurantId/orders`, `/simpos/:restaurantId/scenarios` | Dev-only presentation; production redirects to root (`App.tsx:250`) |
| Integration consent | `/authorize/:integrationId` | Authenticated, outside dashboard shell (`App.tsx:287`) |
| Operational core | `/`, `/inventory`, `/orders`, `/receiving` | Dashboard shell; PageGate design selection (`App.tsx:304`) |
| Beverage book | `/wines`, `/cellar`, `/beer`, `/whiskey`, `/cocktails`, `/spirits`, `/non-alcoholic`, `/soft-drinks` | One new Cellar component with category; legacy fallback sends new category routes to `/wines` (`App.tsx:322`) |
| Intelligence | `/reports`, `/recommendations`, `/recommendations/catalog`, `/vendor-prices` | Reports/recommendations gated; catalogue and price comparison separate (`App.tsx:334`) |
| Vendors and offers | `/providers`, `/promotions` | Providers gated; promotions legacy surface (`App.tsx:337`) |
| People and calendar | `/team`, `/calendar` | Gated; role-specific team rendering (`App.tsx:362`) |
| Communications and documents | `/communications`, `/documents-reports`, `/receipts`, `/documents/:id` | Gated; canonical document path redirects to receipts when off (`App.tsx:368`) |
| Monitoring | `/logs`, `/notifications` | Gated (`App.tsx:386`) |
| Settings and identity | `/settings`, `/profile`, `/connections`, `/help` | Settings/profile/connections gated; new connections off → profile (`App.tsx:388`) |
| Administration | `/admin`, `/admin/health`, `/dev-sandbox` | Nested `requiredRole="owner"`, effectively owner **or manager** in current generic guard (`App.tsx:400`) |
| Assistant | `/sommelier` | Existing assistant page (`App.tsx:409`) |
| Compatibility redirects | `/inventory-legacy`, `/calendar-classic`, `/distributors`, `/credits`, `/services` | Inventory, calendar, Providers discovery tab, receipts credits tab, settings services tab |
| Catch-all | `*` | Redirect to `/`, then normal auth behavior (`App.tsx:417`) |

Retired Wine Agent URLs are discussed in code comments but are not active explicit routes. `/wine-agent` and `/wineagent` on the web therefore hit the catch-all; real web assistance is `/sommelier`. Native `/wine-agent` is a separate screen.

### How the redesign actually ships

`useMudavymDesign` evaluates:

1. A browser `localStorage` override `mudavym.design.<page>`.
2. A per-restaurant feature-flag API result `mudavym_design_<page>` with both `active` and `enabled` true.
3. False while unresolved, missing tenant, or failed lookup.

The current list has **20 page keys**: dashboard, orders, receiving, receiving_door, providers, communications, team, inventory, receipts, documents_reports, reports, notifications, recommendations, calendar, settings, profile, cellar, connections, document, logs. The supplied checkout had only the first eleven including document. See `apps/web/src/lib/mudavym/useMudavymDesign.ts:34` and `apps/api-gateway/src/settings/feature-flag-registry.ts:54`.

PageGate now also mounts `HouseHeader` and communicates the selected surface's paper/charcoal ground to shared shell overlays. It omits the header on the door flow. This is a substantive difference from the supplied checkout's simple `showNext ? next : legacy` wrapper. See `apps/web/src/components/mudavym/PageGate.tsx:25,50,79`.

**An artifact screenshot is not evidence that a flag is on for customers.** A designer's browser override can display new code while the tenant flag remains off. This source sub-audit did not itself query runtime flags, but the parent infrastructure audit subsequently resolved part of that uncertainty at 18:14 UTC: one reserved restaurant-settings row has 11 of the 20 gates true (dashboard, orders, receiving, receiving_door, providers, communications, team, inventory, receipts, documents_reports, document); the other nine are false. Restaurant identity was deliberately not retrieved. The public switch remains separately default-off. This is partial activation for one observed restaurant, not all designs off or a verified five-house rollout. See live metadata (local audit evidence: supabase-live-metadata-2026-09-13.json; not imported) and [infrastructure audit](mudavym-2026-09-13-infrastructure-audit.md). The flag cache is per session/restaurant/page; settings changes may require invalidation/reload depending on the caller.

### Design intent expressed in current code

| Surface | Concrete design/behavior in new implementation | Important limit |
|---|---|---|
| Dashboard | Daily ledger, month/calendar, approval queue, low stock, activity and alerts | Data layers distinguish loading/unknown/known, but some upstream activity/alert methods still collapse failures to empty arrays |
| Inventory | Live/shadow spine, expansion rows, cellar map, storage locations, receiving, spot counts, POS mapping | Inventory redesign is an extension of the kept command page; not a wholesale replacement |
| Orders | Order ledger, stages, draft rail, approvals | Real server state must drive status; draft creation is not external send |
| Receiving | Staff lane, manager discrepancy queue, owner recovery ledger; separate door flow | Role shapes differ; monetary exposure should not leak to floor staff |
| Documents/reports | Sorting Office for documents; canonical delivery/document sheet with provenance, verdict, correction, delivery timeline | Canonical `/documents/:id` can still be flag-disabled |
| Reports | Rearrangeable sheet of analytic blocks; graph kind and underlying analysis separately configurable | Current code implements substantially more than the older Reports page; capabilities still depend on the available data |
| Notifications | Needs a hand / autonomous activity / ruled-off records | “Read,” “action completed,” “sent,” and “delivered” remain different facts |
| Recommendations | Standing Book organized by consequence: money, stock, vendors, floor; denominator and first-fired dates | Rule-derived recommendations are not evidence of general autonomous reasoning |
| Calendar | Month/week/day/agenda; deliveries prioritized; settled items ruled off | Reminder execution and background scheduling require server/runtime verification |
| Team | Coverage gaps first, suggested cover, labor build-up, certification exposure | Suggested cover is deterministic fairness logic; certification schema does not identify which shifts legally require a credential |
| Settings | Values rendered with consequence, scope and storage/freshness information | Some preferences are local/browser-scoped; a toggle's presence does not prove a downstream consumer |
| Profile / Connections | Personal identity separated from house-level MCP, service and payment connections | Some integration/payment actions require provider setup and server-verified seal challenge |
| Cellar | One book of beverage categories with detail on a reading stand | Do not describe all non-wine data sources or catalogue coverage as complete |
| Logs | Correlated multi-source ledger with window/cursor and failed-source disclosure | Tenant restriction of event-store correlation lookup remains a current issue below |

These descriptions are supported by each current `apps/web/src/pages/<page>/next/*Next.tsx` entry file and its paired data hook. The current redesign defaults to Warm Charcoal in every app theme, with explicit paper exceptions for chosen surfaces; it does not follow the legacy light/dark preference (`apps/web/src/styles/mudavym.css:10-41,45-95`). Its visual voice uses serif titles, compact mono annotations, ruled records and a seal for consequential actions. Motion tokens are `settle`, `ink`, `tuck`, `turn`, `pour`, `stamp`, `tally`; reduced-motion support exists (`apps/web/src/lib/mudavym/motion.ts:132,140`). Native mobile still uses its own white/slate/wine palette and Inter/Cormorant fonts (`apps/mobile/src/design/tokens.ts:11,64`). Web Wave Four is not already full native design parity.

## 3. Data, authentication, tenancy, and live updates

### Identity and restaurant scope

Web authentication uses a custom gateway API, access/refresh tokens in browser localStorage, and an AuthContext plus partially overlapping Zustand store. API clients stamp bearer authorization and `X-Restaurant-Id`. Access tokens last 15 minutes, refresh tokens 7 days in the reviewed generator (`auth.service.ts:618`). Google and Microsoft identity flows, email verification, invitation joining, restaurant registration, password reset, linked provider discovery, and account/restaurant departure exist in code.

Gateway bearer validation checks the signature/expiry, loads the user, checks blacklist state, compares explicit path/query/body restaurant IDs, and enforces verified email except explicit exemptions. Tenant switching reissues JWTs after membership/organization checks. A header alone does not change the signed active tenant. Relevant files: `auth/guards/jwt-auth.guard.ts:24`, `auth/strategies/jwt.strategy.ts:18`, `common/tenant/assert-tenant-match.ts:23`, `auth/auth.service.ts:493`.

`TenantGuard` is global but executes before controller JWT guards. It therefore cannot itself authenticate every request; the tenant comparison is also run after Passport populates `request.user`. Current static route exposure checking forces controllers to declare auth or public intent. This is useful defense, but it does not prove correct row ownership inside every service.

The database client is initialized with a Supabase **service role** key (`apps/api-gateway/src/database/database.service.ts:12`). Application services consequently carry a large share of tenant isolation responsibility. A correct route-level tenant guard does not rescue a query that joins/fetches another tenant's rows by an unrelated ID.

### State and refresh behavior

- Web QueryClient defaults: 5-second stale time, focus refresh, always refetch on mount, one retry (`App.tsx:143` at current snapshot; definition begins near 143 after added lazy pages).
- Shared web API client: 30-second timeout, reactive refresh on 401, per-client in-flight deduplication (`services/api/client.ts:49`). AuthContext has a separate Axios instance and separate refresh-promise state, so refresh coordination is not literally global across both clients.
- Web real-time path uses Socket.IO, not direct Supabase Realtime. Python agent events flow through RabbitMQ and the gateway bridge into rooms/client invalidation (`contexts/RealtimeContext.ts:7`; `lib/websocket.tsx:24`). Actual event-delivery reliability was not exercised.
- Browser startup also starts local email and reminder schedulers and registers the production PWA service worker (`main.tsx:16`). Local queued/scheduled work belongs in the origin-change checklist.
- Mobile stores tokens in Expo SecureStore. A restored session starts `locked`; unlocking enables normal session routing and sockets (`mobile/src/state/session.ts:76`; `mobile/app/_layout.tsx:94`).
- Mobile persists query data and an outbox to MMKV. When the native MMKV constructor is unavailable, an in-memory fallback permits boot but loses persistence across launches (`mobile/src/lib/mmkv.ts:41`). A “durable” guarantee therefore requires the actual native runtime, not just Expo development behavior.
- Mobile requests use the current session token. Release API defaults to the existing Railway host; web deep links require `EXPO_PUBLIC_WEB_URL` (`mobile/src/config.ts:4,43`). This is a separate release-time configuration surface from DNS.

### Current defects and unresolved implementation risks

These are audit findings, not authorized fixes. Prioritize by affected business operation and prove the desired behavior in isolated tests before shipping a change.

**P1 — `/logs/timeline/:restaurantId` does not prove ownership of a supplied correlation ID.** The current authenticated `/logs/timeline/:restaurantId` route validates its named restaurant but takes a caller-supplied `correlationId`. `LogsTimelineService` passes that ID to `fetchEventStore`, which queries `event_store` by correlation alone and returns event/aggregate identifiers. It never proves that correlation belongs to the authenticated restaurant. The client is service-role. This remains in exact current head after PR #373: `apps/api-gateway/src/logs/logs-timeline.service.ts:122-126,340-365`; controller `logs.controller.ts:26`; DB service `database.service.ts:12`. A known foreign correlation can therefore request foreign event-store metadata. No live exploit was attempted; impact is established from the query construction, and backend acceptance should be reproduced against isolated tenant fixtures. The handoff independently names the same issue. This is not fixed merely because the separate inbound MCP tool stopped accepting the argument.

**P1 — Mobile outbox dispatch is not bound to the actor/restaurant that queued it and is not paused by the biometric lock.** `OutboxEntry` stores path/body/id but no user or restaurant identity; hydration immediately schedules dispatch, and `runDispatch` calls the API without checking `signedIn`/`locked`. The API uses the current token. Signing out clears SecureStore/session but not outbox entries. With a different account on the same phone, pending work can be attempted under that account. If endpoint ownership rejects it, the queue treats most 4xx responses as permanent failure; on endpoints valid for both accounts, the actor attribution may change. Code: `mobile/src/state/outbox.ts:23,83,154`; `mobile/src/api/client.ts:42,62`; `mobile/src/state/session.ts:139`; `mobile/app/_layout.tsx:141`. An isolated VM reproduction was run using exact current source with all I/O mocked: queued-A work dispatched with status locked, and dispatched as B after account change. **This proves client control flow, not acceptance by real endpoints.** Reproducer: `reproduce-mobile-outbox.cjs`.

**P1 — Native order approval does not supply the server-required seal.** The native Supply screen enqueues `/procurement/orders/:id/approve` (`mobile/app/(tabs)/supply/[id].tsx:44`) without first minting a challenge. Neither `mobile/src/state/outbox.ts:178` nor `mobile/src/api/client.ts:22-55` carries the `X-Seal-Challenge` header, while current gateway `procurement.service.ts:3465-3473` unconditionally redeems it before writing. No seal-challenge call exists in current mobile source. Therefore the native approval action cannot succeed against the audited gateway as written. This is a static client/server contract finding, not a live failed approval.

**P1 — Native priced receipts omit the newly required currency.** Native receiving pre-fills `invoiceUnitPrice` from the order's available price (`mobile/app/(tabs)/cellar/receive/[orderId].tsx:40-42,95-101`) and enqueues it without any `invoiceCurrency` (`:148-165`). Current gateway DTO rejects that pair (`procurement/dto/procurement.dto.ts:499`), and the service independently refuses it before any write (`procurement.service.ts:4875-4898`). Exact-source DTO validation reproduced rejection for the native-shaped priced body and acceptance when a real currency is supplied or the price omitted. Consequently priced native receipt submissions cannot succeed against this gateway as written; unpriced count submissions avoid this specific gate. No live receipt was submitted. See `reproduce-native-receipt-currency.cjs`.

**P1 — Door-to-desk receiving can multiply already-booked stock by the case size again.** Current door completion stores `quantity_received = totals.receivedBottles` (`procurement/receiving.service.ts:543`). Desk verification reads that mixed-unit field as `stockedQty` (`procurement.service.ts:4959`) and passes it as `stockedQtyInCountedUom` with the payload's counted unit (`:5039-5056`). When counted unit is omitted, the helper assumes the order unit. For five cases of twelve bottles already received, `quantity_received=60`; accepting the same five cases then interprets already-stocked quantity as 720 bottles and computes **ledgerDelta = −660**, without requiring an override. An exact-source pure reproduction confirms this with no invoice, and also with a matched invoice at the arithmetic layer. The priced service path additionally requires valid invoice currency. The service passes nonzero deltas to `applyReceiptAdjustment` (`:5080-5114`), which attempts `apply_stock_movement` (`:4610-4705`). **This proves incorrect arithmetic and the attempted adjustment path, not that a production database accepted or applied a negative movement.** The code's comments explicitly acknowledge the still-mixed column; the mobile prefill's uncertainty warning does not repair server arithmetic. See `reproduce-receipt-unit-delta.cjs`.

**P1 candidate — Active-branch role can be replaced by the user's global role.** Token generation explicitly reads `user_restaurant_access` and signs `restaurantRole` (`auth.service.ts:586-606`). Subsequent `validateJwtPayload` loads and returns the global user row (`:726-737`), and `JwtStrategy` sets `role: user.role ?? payload.role` (`auth/strategies/jwt.strategy.ts:55-60`). An owner of A who is staff at B can therefore get a B token with staff role but a gateway request user with the global owner role. Generic `RolesGuard` trusts that role. Endpoints with an explicit per-restaurant membership/management check have a further defense. Confirm using fixtures with deliberately differing roles; do not confuse this with the deliberate owner/manager equivalence described next.

**P2 — Dashboard month cache can retain the previous house when the page stays mounted.** The cache key contains year-month but no restaurant (`web/pages/dashboard/next/useDashboardNextData.ts:161-171`). A forced browser design override keeps the Next page mounted across house switches; normal remote flag transitions may remount and mask the defect. An isolated fake-hooks/API reproduction loads A=100 then rerenders B and still displays 100 without fetching B. See `reproduce-dashboard-month-cache.cjs` and the screen matrix.

**P2 — Failed branch switch still moves the web UI.** A failed `/auth/switch-restaurant` request is caught, then `activeRestaurantId`, localStorage/header and Zustand are changed regardless (`web/src/contexts/AuthContext.tsx:497-524`). The gateway still derives tenant from the old JWT. The result can be newly selected branch labels with old-tenant token requests or 403s. Keep selection/token state atomic and make failure visible. This remains in current head.

**P2 — Web door queue now records tenant, but flush still walks every queued receipt with the current API credentials.** The original supplied checkout lacked restaurant stamps; **that finding is superseded**. Current `QueuedDoorReceipt.restaurantId` exists (`web/src/lib/doorOutbox.ts:354-366`) and durable drop records are scoped. However `runFlush` loads all `receiving.door` mutations and submits each using the global API client (`:557-573`), without matching the active session to the entry. After a house/account switch, rejected foreign receipts can become permanent drops rather than waiting for the right house. Also, current code explicitly documents the underlying storage layer's swallowed write/read errors and inability to retain a trustworthy permanent “stranded” signal (`:46` onward). This needs lifecycle testing including offline, switch, expiry, quota failure, reload, and eventual retry; no live receiving action was run.

**P2 — Mobile cache clearing is coupled to one logout UI, not all session teardown.** Settings' explicit sign-out clears persisted queries (`mobile/app/settings.tsx:26`), but `useSession.signOut` itself does not (`state/session.ts:139`). The API invokes the latter directly on failed refresh. Several persisted keys such as feed/pulse/pending orders lack user/restaurant identity (`api/queries.ts:14,25,100`). After forced expiry and a different sign-in, previously cached content can remain until refetched. Normal Settings logout protects that one path. Reproduce forced-expiry/account-switch and move the invariant to session teardown or scope caches.

**Policy clarification, not newly established defect — “owner” currently means owner or manager in generic guards.** `web/components/ProtectedRoute.tsx:62-65` and gateway `auth/guards/roles.guard.ts:29-37` deliberately permit both; the gateway also accepts admin. `.planning/06-pages/admin-health.md:67` already acknowledges this and calls the staff-exposure issue closed. Route comments that say owner-only are imprecise. Decide which actions, if any, truly require owner instead of treating the generic alias itself as a discovered exploit.

**Pending transport constraint — Meta sender identity uniqueness.** The current credential migration provides a unique live credential per `sender_id`, not a unique `(provider,sender_ref)` across houses (`supabase/migrations/20260905215000_a_senders_credential_is_a_pointer_not_a_token.sql:146`). The `wt-port-text` branch's inbound service reads two matching rows and refuses cross-house ambiguity (`communications/text/inbound/whatsapp-inbound.service.ts:96-124,160`); this inbound file is **absent from current `60ed83a7`**. Do not report that branch's inbound webhook as deployed main. The missing database uniqueness remains a named integration requirement before accepting that transport.

## 4. Capability boundaries: implemented, gated, and not established

### Operational loops

**Inventory → purchasing.** Inventory has live and shadow stock, storage locations, counts, POS mappings, thresholds and immutable transaction concepts. Gateway modules and Python agents propagate events. Threshold crossings now stage reorder proposals; they do not by themselves prove an unattended purchase. Order lifecycle, approval, vendor negotiation/drafts and delivery receipt are separate states. `services/agent-orchestrator/core/agent_registry.py:78` explicitly describes procurement's CORE role as owning replies/state transitions, with reorder proposals stopping for human action.

**Receiving → canonical document → reconciliation/credit.** The code carries physical counts, invoice/receipt uploads, matching, discrepancy verdicts, stock-booking results, credits, provenance/corrections and delivery timing. It carefully distinguishes “receipt recorded” from “stock booked.” Units also matter: door code can count boxes while orders are denominated in cases or bottles; it refuses a computed difference when units are incomparable (`web/pages/receiving/next/DoorModel.ts:10,71`). UI presence does not prove every intake format or reconciliation source works on live data.

**Vendor communications.** Gateway and Python code implement inbound mail triage/threading, outbound proposal/draft workflows, templates, OAuth-linked email, notifications and sending controls. Current main adds house letters, retention/archive, text sender registry, communication credits and provider transports. Some transport work remains in separate branches. Provider setup, sender consent, credentials, allowlists, OAuth grants, scheduling and external deliverability must all be checked independently.

**Reporting and decisions.** Reporting is a combination of quantitative analytics, rule-driven insights, configurable visual blocks, goals, exports and AI consultation/proposals. Code and tests repeatedly distinguish null/absent from measured zero, failed sources from empty lists, exact counts from capped windows, and forecasts from fitted models. This is a strong design intention with remaining debt: the current swallowed-read guard explicitly accepts 185 pre-existing sites.

**Team.** Membership, shifts, coverage, availability/labor/certification/performance features exist. The new coverage suggestion is derived deterministically from matching role, free day and workload. Certification “exposure” is not a proven labor-law compliance engine; the implementation itself says the table lacks applies-to/role linkage for counting blocked shifts (`web/pages/team/next/TeamNext.tsx:6-19`).

### AI autonomy is deliberately narrow

The reviewed Ask AI system supports exactly two proposal families:

- Reorder an identified inventory item from an identified provider with validated quantity.
- Draft a vendor reply on an existing identified order.

IDs come from bounded candidate sets (60 inventory, 30 providers, 20 orders). It declines unsupported or ambiguous requests. Proposal confirmation uses a claimed state transition, revalidates identity/grounding, and calls the owning business service. The executors produce drafts, providing a second human gate before the external effect. See `apps/api-gateway/src/ask-ai/ask-ai.service.ts:31-61,525,911`; the controller is JWT guarded (`ask-ai.controller.ts:29`). This is not a general-purpose agent allowed to modify arbitrary application state.

The Python registry specifies **13 CORE, 5 ON_DEMAND, 6 OPTIONAL agents**. CORE: buffer manager, inventory engine, inequality detector, state invariant enforcer, notification, procurement, calendar, reporting, POS integration, provider conversation, email parsing, email intelligence and provider communication. ON_DEMAND: visual verification, sommelier, menu analyzer, RFQ and drift. OPTIONAL: ghost inventory, negotiation playbook, autopilot, compliance, shrinkage detective, recurring order. Five P1 optional agents explicitly declare `IS_STUB=True`; the orchestrator refuses to start them (`core/orchestrator.py:252`). Recurring order is optional and stages purchase proposals. Registered classes must not be counted as all-running agents. RabbitMQ failure can leave HTTP responsive with no agents started (`main.py:74-99`).

### Current integration surfaces added beyond supplied checkout

The current gateway adds price-index/contextual commodity series, distributor feeds, broader cellar/beverage registers, house-mail retention/archive, house text senders, outgoing MCP connections, an inbound MCP server, payment instruments and Stripe billing modules (`app.module.ts:95-144`). These modules were enumerated and representative controllers reviewed; no provider activation was attempted.

- **Outgoing MCP connections:** declarations, probes, per-tool grants, seal challenges and tool calls exist (`mcp-connections/mcp-connections.controller.ts:116-427`). A listed connection, a successful probe, granted tool, and permitted write are separate states.
- **Inbound MCP:** `POST /api/v1/mcp` is a stateless JSON Streamable HTTP endpoint guarded with a house-scoped credential; GET streaming is refused because the implementation does not emit server messages (`mcp-server/mcp-server.controller.ts:27-61`). Protocol contract is source-declared revision 2025-06-18, not independently recertified here.
- **Payments:** Stripe SetupIntent, sync, signed webhook and payment-instrument records exist. Manager/owner membership plus a server-verified single-use seal governs sensitive operations; configuration can refuse when provider is unavailable (`billing/billing.controller.ts:39-72,164`; `payment-methods/payment-methods.service.ts:104`). This does not prove live Stripe configuration, webhooks or charging readiness.
- **SimPOS:** intentionally disabled in production at both router and gateway module import. It is test infrastructure with real inventory effects in nonproduction contexts, not proof of a customer POS integration (`App.tsx:250`; `app.module.ts:108`).

## 5. Mobile product map and gaps

| Native screen | Purpose |
|---|---|
| Today (`app/(tabs)/index.tsx`) | Decision feed, pulse, notifications and queued/failed actions |
| Cellar (`(tabs)/cellar/index.tsx`, `[id].tsx`) | Inventory list/item detail/activity |
| Receive (`(tabs)/cellar/receive/[orderId].tsx`) | Physical receiving, photos/quantities/notes, queued mutation |
| Supply (`(tabs)/supply/index.tsx`, `[id].tsx`) | Pending/history orders, decision and delivery actions |
| Draft (`app/draft/[orderId].tsx`) | Review/edit vendor draft, grace-period queued action |
| Team (`(tabs)/team.tsx`) | Week schedule/team views |
| Insights (`(tabs)/insights.tsx`) | Analytics/insights/goals and progress |
| Notifications | Native notification feed/deep links |
| Identity | Login/register/invite, verify/reset/forgot password, no access, biometric lock |
| Utilities | Settings, help, privacy, getting started, Wine Agent entry |

Native authentication routing, pending deep links, push tap routing and Socket.IO connection lifecycle are implemented. API query wrappers use gateway routes, not a separate native backend. Actual authentication-provider parity is limited: native login explicitly explains unsupported provider choices rather than inventing native OAuth completion. Native Wine Agent is **a placeholder/deep-link surface**, with browser `/sommelier` opened only when `EXPO_PUBLIC_WEB_URL` is configured (`mobile/app/wine-agent.tsx:62-90`). Without that configuration, it exposes an environment-variable instruction in the UI; that should be resolved as part of product polish, not mistaken for a native assistant.

Mobile tests currently cover pure logic and source contracts; they do not render native components, camera flows, biometrics, MMKV, background execution, native notification delivery, or physical-device offline retries. No iOS/Android production binary or store distribution was validated.

## 6. Fresh verification and reproducibility

### Checks actually executed

| Snapshot / command | Fresh result | Meaning |
|---|---|---|
| Supplied checkout: `python3 scripts/check_route_exposure.py` | PASS; 502 routes, 53 controllers, 476 auth, 26 public, zero undeclared | Every recognized route states auth/public intent |
| Supplied checkout: `python3 scripts/check_read_errors_not_swallowed.py` | PASS; 1,064 files, 193 sites, all baselined | No new recognized swallowed-read sites; 193 accepted old sites still exist |
| Current snapshot: `python3 /tmp/mudavim-current-audit/scripts/check_route_exposure.py` | PASS; **663 routes, 72 controllers, 624 auth, 39 public**, zero unrecognized/undeclared | Fresh current-head declaration inventory; not row-level authorization proof |
| Current snapshot: `python3 /tmp/mudavim-current-audit/scripts/check_read_errors_not_swallowed.py` | PASS; **1,456 files, 185 sites, 185 baselined, zero allowlisted** | Current ratchet passes with substantial known debt |
| Supplied checkout, installed Jest with isolated config | PASS; **10 suites, 227 tests** | Existing native pure logic/source contracts |
| Current exported source, installed Jest with isolated config | PASS; **11 suites, 231 tests**, zero snapshots | Adds current delivered-once contract test |
| Exact current outbox source in VM, all I/O mocked | Reproduced dispatch while locked and under changed principal | Client lifecycle weakness; does not test backend acceptance |
| Exact current dashboard hook with fake hooks/API | A=100 → selected B still100; API calls only A | Cache identity defect under mounted tenant switch |
| Exact current receipt helper, pure inputs | Five cases × twelve; stored60 → interpreted720; delta−660, no override | Mixed-unit arithmetic defect; no database execution |
| Exact current receipt DTO with installed validator libraries | Native priced shape rejected; stated currency and count-only accepted | Native/gateway receipt currency contract mismatch |

The exact successful current-mobile command was:

```sh
node repository/apps/api-gateway/node_modules/jest/bin/jest.js --config /tmp/mudavim-current-mobile-jest.config.json --runInBand --silent
```

The config is derived from the repo's mobile Jest config, with only absolute `rootDir`, existing ts-jest location, local type-root/path resolution and `/tmp` cache settings. No assertions were changed, and no dependency was installed. A copy of the successful config is saved as `mobile-audit-jest.config.json` beside this report (its source root remains the temporary exact-commit export).

Initial attempts did not run cleanly because `apps/mobile/node_modules/jest` and `ts-jest` were not linked, then because the temporary export lacked TS path/type-root context. Those were **audit harness/environment failures**, not failing product assertions. Reusing the already-installed gateway Jest and correctly resolving existing type packages produced the full passes above. The temporary current guard snapshot initially lacked its shared comment-stripper script; adding that current committed source dependency produced the reported guard pass.

No whole-application build, full gateway Jest, full web Vitest, Python suite, Playwright, browser production smoke, paid model request, SMTP test, or DB migration was run by this sub-audit. Existing package scripts sometimes include mutating lint (`--fix`) or integration emails; they were deliberately not invoked for a read-only audit. Historical “all green” claims were not substituted for fresh results.

## 7. Follow-up decisions and verification order

1. Freeze the implementation target by exact commit/deployment and keep old checkout versus current source clearly labeled. Reconcile later commits before implementing fixes.
2. Use isolated fixtures to close the logs correlation ownership issue, branch role divergence, native outbox actor/lock binding, web branch-switch atomicity, and browser/native offline teardown behavior.
3. Identify the observed one-restaurant partial rollout and verify the intended cohort plus browser override state before extending it. Review the charcoal default and explicit paper exceptions, empty/loading/error/offline, staff/manager/owner, and reduced-motion states.
4. Treat the domain migration as changes to browser origin, OAuth/deep links, callbacks, PWA/local storage and provider allowlists as well as DNS. Web localStorage/IndexedDB queues do not migrate between origins automatically.
5. Verify representative real operational loops with explicitly disposable test tenants: POS sale → inventory → proposed reorder → human approval → vendor draft/send → receiving → stock booked → discrepancy/credit → timeline/report. Each stage should record provenance and one clear outcome.
6. Decide what native mobile must contain at launch. It is a substantial companion, but native AI and visual parity with Wave Four are not complete in current source.
7. Define true owner-only actions separately from manager-permitted actions. Review current cross-branch role derivation before relying on generic role guards.
8. Keep current provider capability, pending branch implementation and aspirational plans separate in sales/product claims. Connected account access must be verified before assuming payment, email, WhatsApp, POS, or MCP transport is ready.

### Questions that materially affect the next phase

- The founder selected apex `mudavym.com` as canonical with www redirecting. Which old-domain URLs must redirect versus continue?
- Which restaurant(s) and roles are the approved rollout/test cohort, and is every new design flag to be reviewed individually?
- Must native mobile ship alongside the domain transition, and should it adopt the new paper/charcoal identity now?
- Which actions must remain owner-only versus manager-permitted, especially connection grants, billing, destructive member changes and autonomous-send settings?
- Which operational/provider integrations are expected to work at launch, and which are intentionally previewed or deferred?

These are decision questions for the consolidated handoff; this report did not pause safe research or change live state while waiting for answers.
