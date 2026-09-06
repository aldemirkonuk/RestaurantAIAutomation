# 0132 — Mudavym answers MCP: a house-scoped key, ten reads, eight declared refusals

- **Status:** Proposed (built on `feat/connect-mudavym-mcp-server`, awaiting the founder's lock)
- **Date:** 2026-09-06
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** MCP, model context, inbound server, Streamable HTTP, mcp_server_credentials, mcp_server_call_log, tools/list, tools/call, readOnlyHint, annotations, scopes, tenancy, refusal, ADR 0132
- **Links:** [[0107-a-declared-server-is-not-a-reachable-one]] (the client half + its 2026-09-04 addendum), [[0112-one-modal-policy-three-shapes-one-primitive]] / [[0113-the-assistant-proposes-the-seal-applies]] (the seal), [[0114-connections-are-the-houses-profile-is-the-persons]] (the attachment is the house's), [[0013-one-commitment-guardrail]], [[0020-no-fabricated-answers]], [[0096-a-route-declares-its-own-exposure]], `.planning/08-softwares/mudavym-mcp.md` (the capability note this builds), `supabase/migrations/20260906170000_a_house_gives_its_assistant_a_key.sql`, `apps/api-gateway/src/mcp-server/`

## Context

`.planning/08-softwares/mudavym-mcp.md` has said **"STATUS — documented, not built.
No code exists"** since 2026-09-03. Its §8 lists what a build would take and opens with
*"An ADR first. Nothing here is decided."* This is that ADR, written alongside the build
rather than after it, and it settles the four forks §8 named — transport, scope
vocabulary, where the grant lives, and multi-tenant versus one process per house — plus
two the note did not anticipate.

The half that already exists is the **outbound** one. `mcp-runtime/` (ADR 0107) performs
`initialize` → `notifications/initialized` → `tools/list` over Streamable HTTP, revision
`2025-06-18`, against **someone else's** server; `mcp-connections/` holds the rows. ADR
0111 §5 direction 4 names the inbound counterpart in one line — *"Expose … it reads
freely and it commits nothing."* Nothing in this repo answered an `initialize` until now.

Three facts from the tree shaped every choice below:

1. **`TenantGuard` fails open.** It returns `true` when `request.user` is unset
   (`common/tenant/tenant.guard.ts:47-52`) and an MCP request never sets it, so tenancy
   for this surface cannot be inherited — it has to be asserted by the façade.
2. **`RateLimitGuard` keys on user → restaurant → IP**
   (`common/rate-limit/rate-limit.guard.ts:246-266`). With no user, every assistant behind
   one cloud NAT would share one bucket.
3. **The gateway's Dockerfile copies `apps/api-gateway/dist` and nothing else**
   (`apps/api-gateway/Dockerfile:39`).

## Options considered

### Fork 1 — transport: stdio, or Streamable HTTP?

1. **stdio first** (the note's §8 step 2). A local process holding the user's own token:
   no new public surface, no CORS, no session store, and it is what a desktop client
   configures. Costs: it needs a *token to hold*, which means a person's JWT on a
   developer's laptop; it ships as a separate binary the founder's own build does not
   produce; and it reaches the services only over HTTP anyway, so it is a client of the
   gateway wearing a different coat.
2. **Streamable HTTP** — the same transport `mcp-runtime` already implements from the
   other side, on the process that already holds the services.
   Costs: a new authenticated public door, which §7.1 correctly names as the `toast/`
   failure shape if it is ever added without a guard.

**Chosen: Streamable HTTP**, and the note's stdio-first reasoning is superseded rather
than worked around. The reason stdio was safer — *no new public surface* — was true of a
build that authenticated with a JWT. It stops being the deciding factor once the
credential is a per-house, revocable, hashed key that grants **reads only**: the door is
new, but everything behind it is already reachable by anyone holding a session for that
house, and the key can be turned off from a page without ending anyone's session. Against
that, stdio's cost is real and permanent: a second artifact to build, sign and ship.

### Fork 2 — where the code lives: `packages/mcp-server/`, or the gateway?

The note's §8 step 3 said a third workspace, **not** inside `apps/api-gateway`, reasoning
from the Dockerfile. **Reading that Dockerfile settles it the other way.** Line 39 copies
only `apps/api-gateway/dist`, so a `packages/mcp-server/` would not be in the deployed
image at all — it would need a Dockerfile change, a second build target, a second process
and a second thing to operate. And the whole value of the tools is that each one calls the
**same service the page calls**; a separate package could only reach those services over
HTTP, which is a second query path with a network hop in it.

**Chosen: `apps/api-gateway/src/mcp-server/`.**

### Fork 3 — the credential: the gateway JWT, or a new per-house key?

§7b of the note says "authentication reuses the JWT the gateway already issues". That was
written on 2026-09-03, before ADR 0114 made the model-context attachment the **house's**
rather than a person's. A JWT-bearing assistant acts with one person's full authority,
cannot be revoked without ending that person's session, and silently outlives their role
change.

**Chosen: a per-house key** — `mcp_server_credentials`, SHA-256 hashed, shown once at
mint, soft-revoked, effective on the next call. §7b is amended in the note.

### Fork 4 — do the write tools appear in `tools/list`?

§7b says an ungranted scope **hides** a tool. That is right for reads and wrong for
writes, and the difference is what the client concludes from the absence. A read this key
was not granted is genuinely unavailable to this client. A write is different: **no** key
can be granted one in this build, so hiding all eight would tell every assistant that
Mudavym cannot draft an order — false, and the absence-reported-as-health shape exactly.

**Chosen: reads are hidden by scope; all eight writes are always declared**, each with
`readOnlyHint: false` and a description naming the human step, and each refused at
`tools/call` with a sentence naming the seal. This also satisfies our own client's rule
from the other side: `tool-classification.ts` treats an un-annotated tool as a write, so a
server emitting no annotations would be classified as all-writes by our own code.

### Fork 5 — multi-tenant, or one process per house?

One process per house would be a deploy per restaurant. **Chosen: multi-tenant**, with the
tenant taken from the credential row and from nowhere else — no tool's `inputSchema`
declares a `restaurantId`, and a resource URI naming another house is refused before any
read runs.

### Fork 6 — how many tools in the first release?

**Chosen: the note's own §8 step 4 list, unchanged** — `inventory.list`,
`inventory.low_stock`, `orders.list`, `orders.get`, `vendors.search`, `prices.compare`,
`insights.list`, `analytics.financial`, `logs.timeline`, `health.live`. The other 24 reads
of §3 are declared nowhere, not even as stubs: a tool that answers "not implemented" is
worse than one that is absent, because the client has already spent a turn on it.

## Decision

**Mudavym answers MCP at `POST /api/v1/mcp` over Streamable HTTP, revision `2025-06-18`,
authenticated by a hashed per-house key, serving ten read tools wired to the services the
pages already call, declaring eight write tools in order to refuse each one by name.**

Concretely:

- **Transport.** `POST /api/v1/mcp` answers `initialize`, `notifications/*` (202, no
  body), `ping`, `tools/list`, `tools/call`, `resources/list`, `resources/read`,
  `prompts/list`, `prompts/get`. `GET /api/v1/mcp` answers 405 with the sentence "this
  server never initiates a message" rather than holding a silent SSE connection open,
  which a client cannot distinguish from a server that is thinking. No session store and
  no `Mcp-Session-Id`: the credential is the whole of the state, presented on every
  request, so a revocation bites on the next call rather than at session expiry.
  The protocol revision is **imported from `McpRuntimeService.PROTOCOL_VERSION`**, not
  restated — two halves of one spec inside one process must not be able to drift.
- **Auth.** `McpCredentialAuthGuard` resolves an `Authorization: Bearer mud_mcp_…` header
  against `mcp_server_credentials`. A gateway JWT is refused **by shape, before the table
  is touched**. The class is named `…AuthGuard` deliberately: `check_route_exposure.py`
  recognises an authentication declaration only when the guard's name carries `Jwt` or
  `Auth`, and a route whose exposure the ratchet cannot see has declared nothing.
- **Tenancy.** The restaurant comes from the credential row. No tool argument and no
  resource URI can name a house.
- **Scopes.** Seven read slugs — `inventory:read`, `orders:read`, `vendors:read`,
  `prices:read`, `analytics:read`, `logs:read`, `platform:read` — the same lowercase-slug
  vocabulary `restaurant_mcp_connections.scopes` already validates. Minting is restricted
  to those by `@IsIn`, so no row can promise a write the server will refuse.
- **Rate limit.** 60 calls per credential per 60s, counted **in-process**, with
  `X-Mcp-RateLimit-*` headers deliberately distinct from the global guard's `X-RateLimit-*`
  (overwriting only its `Remaining` would leave one limiter's ceiling read against
  another's remainder — two true numbers making one false sentence).
- **Honesty (§7a, enforced).** Every result carries `provenance` — `readAt`, `rows`,
  `source`. An unknown is `null` **with a reason**. A refusal is an `isError` result inside
  a normal envelope, never a JSON-RPC error, because an error invites a retry with
  different arguments. An upstream failure says it is a fault and not an absence.
- **The register.** `/mcp-server-keys` (mint · list · revoke), manager-or-owner via
  `assertCanManageRestaurant`, deliberately **not** under `/mcp-connections`: one page,
  two opposite directions, and a shared prefix is how "we may call them" gets confused
  with "they may read us".
- **The log.** `mcp_server_call_log`, one row per request, `outcome` distinguishing
  `refused` (a result) from `error` (a fault). `asked_by` is a nullable column that this
  build always writes as NULL: MCP presents a key, not a person, and filling it with the
  key's minter would answer "who asked?" with a name nobody typed.

## Consequences

**Easier.** A house can point Claude, or any assistant it already uses, at its own
day-book and get real numbers with the row counts behind them. `/sommelier`, if it is ever
finished, should call these tools rather than grow a second action set (the note's §6).

**Harder / given up.**
- A new authenticated public door exists. It is read-only by construction, but it is a
  door, and `check_route_exposure.py` must keep recognising its guard.
- The in-process limiter is `60 × replicas` in a multi-replica deployment.
  `describeLimiter()` says so on the wire rather than letting anyone assume otherwise.
- `insights.list` inherits a defect it cannot see past: `getStored` logs its own read
  error and returns `[]` (`analytics/insights/insight-generator.service.ts:299-308`), so
  the tool cannot tell "none computed" from "the read failed". It says exactly that, in
  the result, rather than reporting "no insights".
- The two vault resources of §7c are **not** served: `.planning/` is not in the deployed
  image, so they would work locally and 404 in production.

**A count the capability note got wrong, corrected here.** §3 closes with "42 tools. 33
read-only, 9 write". Counting its own eight tables gives **42 tools, 34 read and 8 write**
(Restaurant 8R/4W, Vendor 6R/1W, POS 3R/1W, Sommelier 4R, Intelligence 6R/1W, Platform 5R,
Customer 1R, Agent 1R/1W). §7 of the note now carries the correction, and the eight writes
declared here are that corrected set.

**What would trigger revisiting this.**
- *A write is asked for.* The moment the founder wants one MCP write to actually land, the
  commitment guardrail has to be extended to model-context dispatch — the fork ADR 0107
  left open on the client side and this build inherits on the server side. Nothing here
  weakens it; the eight refusals are the placeholder.
- *A second replica.* The limiter becomes a shared store, or the number stops meaning
  anything.
- *A client that carries an end-user identity.* `asked_by` starts being filled — by the
  caller who knows it, never by a default.
- *stdio is asked for.* The catalogue and the dispatcher are transport-agnostic; only the
  controller would be new.

## What was measured, and what was not

Measured on 2026-09-06 (see the CLAIMS rows): typecheck (both projects), 35 specs,
`check_gateway_boots.sh`, nine guards, the migration applied and rolled back on the local
Supabase Postgres **and** its `auth.users` assertion proved to fire against a deliberately
broken copy, and a live end-to-end run — `initialize`, `tools/list` (14 tools for a
4-scope key), two read tools, a write refused, a scope refused, `resources/list`,
`prompts/list`, an unauthenticated 401, a JWT-shaped 401, a `GET` 405, and a **revoked key
401 taken on the very next call**, with all eight log rows written and `asked_by` NULL on
every one.

**Not measured:** production. This has never run against the deployed database, and the
`/connections` page has no UI for the register yet — the routes exist and nothing calls
them from the browser. That gap is recorded in `06-pages/connections.md` §9 rather than
being left for someone to discover.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-06 | — | Created alongside the build; six forks stated, awaiting the founder's lock |
