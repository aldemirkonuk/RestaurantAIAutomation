---
type: software
slug: mudavym-mcp
name: Mudavym MCP Server
division: platform-admin
status: planned
tier: internal
routes: []
pages: []
api_modules: []
agents: []
owner_unit: ""
updated: 2026-09-03
links: ["[[SOFTWARE-MAP]]", "[[SOFTWARE-CONTRACT]]", "[[06-pages/profile]]", "[[0013-one-commitment-guardrail]]", "[[0020-no-fabricated-answers]]", "[[0050-agent-dispatch-hardness-threshold]]", "[[0052-software-catalog-layer]]"]
---

# Mudavym MCP Server

> **STATUS — documented, not built. No code exists.** There is no MCP *server* package
> anywhere in the tree: `packages/` holds exactly two workspaces, `database` and `ui`.
> Every `mcp` match in `apps/api-gateway/src` is the `mcp-connections/` module or its import
> (`app.module.ts:36,113`), which is the
> **client-side register** on `/profile` (a list of servers *we* may call), not a server
> that exposes Mudavym. This note is a capabilities document. Nothing below has been
> implemented, tested, or deployed, and every endpoint it cites is an endpoint that exists
> **today for the browser** — none is reached by an MCP client.

## §0 What it is

The restaurant's own operating data and actions, offered to any AI assistant the house
chooses — Claude, the founder's own agents, or a vendor's assistant — over the Model
Context Protocol, with the tenant's permission and inside the tenant's own boundary. Where
`/profile`'s Model context register records *which servers this house may call*, this is
the other half: **the server Mudavym itself presents.** An assistant asks "what is short
this week?" and reads the real count; it drafts an order; it never sends one.

The line that defines the product: **it reads freely and it commits nothing.** Every path
that could bind the restaurant to money — an order placed, an email sent to a vendor, a
reply that forms a contract — stops at a draft a human approves in Mudavym.

## §1 Features today

**None.** Nothing is built. The ladder below is the shape a build would take, smallest
first, and every rung is `planned`:

- Answer a handshake and list tools, resources and prompts for one authenticated tenant
- Read stock, ledger balances, orders, calendar and notifications for that tenant
- Read vendor, price and conversation records the house already holds
- Read wine and cellar records
- Read analytics insights, forecasts, goals and reports
- Expose read-only **resources** (cellar book, day-book, reports sheet, a vault note)
- Expose canned **prompts** ("close the week", "chase the short delivery")
- Write only through *proposal* verbs — draft an order, propose a POS match, post a
  count — each returning what it did **and what it did not**
- Refuse every send, approve and execute verb out loud, naming the human step

## §2 Screens

`backend-only — no user surface, by design.` Its consumers are:

- **MCP clients** — an assistant configured by the house.
- **[[06-pages/profile|/profile]]'s Model context register** — the *mirror* surface. It
  lists servers the house has declared to us (`mcp-connections.controller.ts:61,71,82`);
  a built Mudavym MCP server would appear in the client's own config, not there.
- **[[06-pages/sommelier|/sommelier]]** — the in-product chat, §6.

## §3 Backend

**No module exists.** The catalogue below is a *façade plan*: each tool fronts a gateway
endpoint that is live today for the browser. Prefix on every path is `/api/v1`
(`apps/api-gateway/src/main.ts:60`). Counts of the whole surface: **450 endpoints across
44 controller files** (`.planning/foundation/ENDPOINTS.md:11-12`, verified 2026-08-25 —
that figure predates `mcp-connections/` and `payment-methods/`, so it is a floor).

**Legend:** `R` read-only · `W` writes. Guardrail column: **UCC** = the commitment
guardrail ([ADR 0013](../decisions/0013-one-commitment-guardrail.md)); **approve** =
returns a draft/proposal a human confirms in Mudavym; **never** = the sending or executing
sibling of this endpoint is deliberately absent from the catalogue (§4).

### Restaurant — 12 tools

| Tool | Reads / does | Endpoint (`file:line`) | In → Out | R/W | Guardrail |
|---|---|---|---|---|---|
| `inventory.list` | every stock line for the house | `inventory/inventory.controller.ts:36` | — → items[] | R | tenant scope |
| `inventory.low_stock` | lines under par | `inventory/inventory.controller.ts:106` | — → items[] | R | tenant scope |
| `inventory.item_activity` | one item's movement history | `inventory/inventory.controller.ts:137` | itemId → events[] | R | tenant scope |
| `inventory.count` | records a physical count | `inventory/inventory.controller.ts:379` | itemId, qty, uom → movement | W | approve |
| `ledger.balance` | ledger balance for one item | `inventory-ledger/inventory-ledger.controller.ts:179` | inventoryId → balance | R | tenant scope |
| `ledger.post_transaction` | posts one ledger transaction | `inventory-ledger/inventory-ledger.controller.ts:50` | txn → receipt | W | approve |
| `orders.list` | purchase orders and their state | `procurement/procurement.controller.ts:151` | filters → orders[] | R | tenant scope |
| `orders.draft` | drafts a purchase order | `procurement/procurement.controller.ts:112` | lines[], vendorId → draft order | W | **UCC** + approve |
| `orders.get` | one order with lines | `procurement/procurement.controller.ts:220` | id → order | R | tenant scope |
| `receiving.log_door` | logs what arrived at the door | `procurement/receiving.controller.ts:233` | id, lines[] → receipt | W | approve |
| `calendar.events` | events in a window | `calendar/calendar.controller.ts:94` | from, to → events[] | R | tenant scope |
| `notifications.list` | open notifications | `notifications/notifications.controller.ts:84` | filters → notifications[] | R | tenant scope |

### Vendor — 7 tools

| Tool | Reads / does | Endpoint (`file:line`) | In → Out | R/W | Guardrail |
|---|---|---|---|---|---|
| `vendors.search` | searches the vendor directory | `distributor-discovery/distributor-discovery.controller.ts:39` | query, facets → vendors[] | R | public corpus |
| `vendors.profile` | one vendor record | `providers/providers.controller.ts:231` | id → vendor | R | tenant scope |
| `vendors.performance` | a vendor's delivery/price record | `providers/providers.controller.ts:317` | id → metrics | R | tenant scope |
| `prices.compare` | compares held prices across vendors | `vendor-intel/vendor-intel.controller.ts:41` | sku/wine → offers[] | R | tenant scope |
| `threads.list` | vendor conversation threads | `conversations/conversations.controller.ts:145` | filters → threads[] | R | tenant scope, PII redaction |
| `thread.read` | one thread's messages | `conversations/conversations.controller.ts:216` | threadId → messages[] | R | tenant scope, PII redaction |
| `reply.draft` | drafts a reply to a vendor | `procurement/procurement.controller.ts:410` | orderId, intent → draft | W | **UCC** + never auto-send |

### POS — 4 tools

| Tool | Reads / does | Endpoint (`file:line`) | In → Out | R/W | Guardrail |
|---|---|---|---|---|---|
| `pos.providers` | which POS providers exist and their rung | `pos-hub/pos-hub.controller.ts:55` | — → providers[] | R | none needed |
| `pos.status` | ingestion status over 30 days | `pos-hub/pos-hub.controller.ts:65` | — → status | R | tenant scope |
| `pos.mappings` | POS item → catalogue mappings | `pos-hub/pos-hub.controller.ts:137` | — → mappings[] | R | tenant scope |
| `pos.propose_matches` | proposes catalogue matches | `pos-hub/pos-hub.controller.ts:247` | — → proposals[] | W | approve (`:282` not exposed) |

### Sommelier — 4 tools

| Tool | Reads / does | Endpoint (`file:line`) | In → Out | R/W | Guardrail |
|---|---|---|---|---|---|
| `wines.search` | searches the wine library | `wines/wines.controller.ts:38` | query → wines[] | R | public corpus |
| `wines.get` | one wine record | `wines/wines.controller.ts:80` | wineId → wine | R | public corpus |
| `wines.similar` | neighbours of one wine | `wines/wines.controller.ts:72` | wineId → wines[] | R | public corpus |
| `cellar.registers` | the house's cellar registers | `cellar/cellar.controller.ts:32` | — → registers[] | R | tenant scope |

### Intelligence/Analytics — 7 tools

| Tool | Reads / does | Endpoint (`file:line`) | In → Out | R/W | Guardrail |
|---|---|---|---|---|---|
| `insights.list` | computed insights for the house | `analytics/analytics.controller.ts:289` | filters → insights[] | R | tenant scope |
| `insights.catalog` | which insight types are computable | `analytics/analytics.controller.ts:245` | — → types[] | R | none needed |
| `analytics.financial` | the financial rollup | `analytics/analytics.controller.ts:123` | window → figures | R | tenant scope |
| `analytics.forecast` | demand forecast | `analytics/analytics.controller.ts:206` | horizon → forecast | R | tenant scope |
| `goals.list` | goals and their progress | `analytics/analytics.controller.ts:481` | — → goals[] | R | tenant scope |
| `reports.list` | reports already generated | `reports/reports.controller.ts:51` | filters → reports[] | R | tenant scope |
| `reports.generate` | asks for a report | `reports/reports.controller.ts:34` | spec → report job | W | approve (no outward send) |

### Platform/Admin — 5 tools

| Tool | Reads / does | Endpoint (`file:line`) | In → Out | R/W | Guardrail |
|---|---|---|---|---|---|
| `health.live` | is the gateway up, and which build | `health/liveness.controller.ts:97` | — → commit, bootedAt | R | none needed |
| `logs.timeline` | the house's activity timeline | `logs/logs.controller.ts:26` | window → entries[] | R | tenant scope |
| `team.members` | who works here and their role | `team/team.controller.ts:74` | — → members[] | R | tenant scope, PII redaction |
| `settings.feature_flags` | which capabilities are on | `settings/settings.controller.ts:37` | — → flags | R | tenant scope |
| `mcp.connections` | the house's own MCP register | `mcp-connections/mcp-connections.controller.ts:61` | — → connections[] | R | tenant scope; `POST`/`DELETE` (`:71`, `:82`) **not exposed** |

### Customer — 1 tool

| Tool | Reads / does | Endpoint (`file:line`) | In → Out | R/W | Guardrail |
|---|---|---|---|---|---|
| `menus.list` | the house's menu | `menus/menus.controller.ts:27` | — → menu | R | tenant scope |

*The Customer division has **zero application code** (`.planning/04-specs/ECOSYSTEM-PLAN.md:73`);
this one tool is the guest-facing menu the Restaurant division happens to own.*

### Agent fleet/runtime — 2 tools

| Tool | Reads / does | Endpoint (`file:line`) | In → Out | R/W | Guardrail |
|---|---|---|---|---|---|
| `ask_ai.propose` | proposes an action from a question | `ask-ai/ask-ai.controller.ts:34` | question → proposal | W | approve (`:70` confirm **not exposed**) |
| `one_tap.pending` | actions awaiting a human | `one-tap-actions/one-tap-actions.controller.ts:118` | — → actions[] | R | tenant scope (`:214` execute **not exposed**) |

**42 tools. 33 read-only, 9 write — and every one of the 9 writes a draft, a proposal, or
a record of something that already physically happened. None sends, approves, or executes.**

## §4 Automation

`none — every tool call is client-initiated.` No `@Cron`, no agent, no bus subscription.
The server would be a request/response façade with no background behaviour at all.

**Never exposed, and named so the absence is deliberate rather than forgotten:**

| What | Where it lives | Why it stays out |
|---|---|---|
| Send a vendor email | `communications/communications.controller.ts:129` | outward send — human-only |
| Approve an order | `procurement/procurement.controller.ts:283` | commits money |
| Approve a drafted reply | `conversations/conversations.controller.ts:390` | forms a contract |
| Approve a draft order | `procurement/procurement.controller.ts:384` | commits money |
| Execute a one-tap action | `one-tap-actions/one-tap-actions.controller.ts:214` | acts without review |
| Approve a POS match | `pos-hub/pos-hub.controller.ts:282` | rewrites the depletion map |
| Declare/revoke an MCP server | `mcp-connections.controller.ts:71,82` | a server must not enrol itself |
| Any `@Public()` test/E2E route | `communications.controller.ts:667-1042` | unauthenticated live writes |

**The commitment guardrail.** Canon is 19 patterns in
`apps/api-gateway/src/common/orchestrator/commitment-patterns.ts:53-60`
(`containsCommitmentLanguage`), generated into
`services/agent-orchestrator/core/commitment_patterns.py:22` by
`scripts/sync_commitment_patterns.py` and held by three drift guards
([ADR 0013](../decisions/0013-one-commitment-guardrail.md)). Its live call site is
`inbound-responder.service.ts:895`, which forces manager approval on a match. **Any MCP
tool whose output text could reach a vendor calls the same canon — it does not carry a
copy.** ADR 0013 exists because two "ported verbatim" comments hid a 19-vs-8 gap and a
third undeclared list; a fourth copy inside an MCP package would be the same failure.

## §5 Data

**Owns nothing.** Every read and write goes through the gateway, so the server holds no
table of its own. It reads one existing table by name only through
`mcp.connections`: `user_mcp_connections`
(`supabase/migrations/20260903090000_user_mcp_connections.sql:51-80`) — user-scoped,
restaurant-scoped, soft-revoked, and deliberately **without a token column** (`:24-28`).

A built server would need one new table — a per-connection grant record (scopes, issuer,
last handshake, revocation) — and that is a migration and a decision, not a field. It is
not written here because it does not exist.

**Correction, 2026-09-04 (two facts above have moved on this branch).** First,
`user_mcp_connections` is now `restaurant_mcp_connections`: the attachment is the house's,
not a person's, and a person's agreement is a row in `mcp_connection_consents`
(ADR 0114, migration `20260903151000_the_house_declares_a_person_consents.sql`). Second,
the outbound half no longer has "no grant record" — `mcp_tool_grants` holds one row per
(server, tool), and since `20260904160000_the_server_declares_the_manager_confirms.sql` each
row also carries the SERVER's own `annotations.readOnlyHint` declaration, a fingerprint of
it, and a `needs_reconsent` state that suspends the grant when that declaration moves
(ADR 0107 addendum, 2026-09-04). Both citations above point at migrations that are still
accurate about what they themselves did; they are no longer accurate about the current
shape, and are left in place as history rather than rewritten.

**What it means for the INBOUND server, if it is ever built.** The rule the founder set for
the client half applies symmetrically and cheaply: this note's own R/W legend is exactly
the `readOnlyHint` / `destructiveHint` a Mudavym server would have to emit on every
`tools/list`, and the 9 write tools would each need `readOnlyHint: false`. A server that
omitted them would, under our own client's rule, be classified entirely as writes by any
careful client — including ours.

## §6 Owner

`unowned — gap.` No charter in `.planning/01-org/` mentions MCP, model context, or
`mcp-connections` in any form (grepped 2026-09-03, zero matches). The nearest neighbours
are [[platform-api-charter]] (owns `auth`, `settings`, `organizations`) and the teams
behind each fronted module — but none claims this. Recorded as a gap row in
[[SOFTWARE-MAP]] rather than assigned by guess.

**Relation to `/wine-agent` and to the profile register:**

- **`/wine-agent` does not exist.** It and `/wineagent` were retired 2026-08-26 (ADR 0019
  §B) — one inline placeholder under two spellings, zero buttons, zero endpoints
  (`.planning/06-pages/PAGES-MAP.md:105-109`; `apps/web/src/App.tsx:354-358`). The live
  general chat surface is **[[06-pages/sommelier|/sommelier]]**, whose own backend route
  is unregistered and falls back to a local rules answer
  (`.planning/06-pages/sommelier.md:38,55`). So the comparison is not "MCP vs. the
  chatbot": **`/sommelier` is one client, inside our UI, with one model we chose; the MCP
  server is the same capability offered to a client the house chose.** If both ship, the
  chat page should call the MCP tools rather than grow a second, divergent action set.
- **The profile register is the mirror, and as of 2026-09-03 it is a working one.**
  `/profile`'s Model context rail records servers *this house may call outward*; this note
  is *the server other clients call inward*. Same idea, opposite direction, and they must
  not be conflated in the UI: a row in `user_mcp_connections` is never evidence that the
  Mudavym MCP server exists. That warning is now **more** load-bearing, not less, because
  the mirror stopped being a list of shapes: `apps/api-gateway/src/mcp-runtime/` (ADR 0107,
  migration `20260903104500`) performs the client half of the handshake — `initialize` →
  `notifications/initialized` → `tools/list` over Streamable HTTP, revision `2025-06-18` —
  so a row can now read `Connected`, name a server's version and list its tools. Every one
  of those readings is about **someone else's** server. Nothing in this repo answers an
  `initialize`; the tooling to *make* the call exists and the thing to *receive* one does
  not, and §1's **None** is unchanged.
- **What the client half settles for a future server half, and what it does not.** Settled
  by demonstration: the transport (Streamable HTTP, both response encodings, the
  `Mcp-Session-Id` echo, the `MCP-Protocol-Version` obligation) is a published spec this
  codebase has now implemented once and can implement again from the other side. **Not**
  settled, and the more important half of §7a and §0's *"it reads freely and it commits
  nothing"*: the client deliberately has **no invocation path at all** — no `tools/call`,
  no route reaching one, no column recording one — because a tool call can bind the house
  and ADR 0013's commitment guardrail has never been extended to model-context dispatch.
  A server built here inherits that fork rather than resolving it, and inherits it in the
  harder direction: refusing to *make* a committing call is one absent method, while
  refusing to *serve* one is every write verb in §3's 42-tool ladder.

## §7 Maturity & seams

**`planned` — documented, not built, no code.** The honest seams a build would inherit:

1. **`TenantGuard` fails open.** It returns `true` when `request.user` is unset
   (`common/tenant/tenant.guard.ts:47-52`), and the two global guards are only
   `RateLimitGuard` and `TenantGuard` (`app.module.ts:139-145`). Tenancy for an MCP client
   therefore rests on `JwtAuthGuard` being present per route — which is exactly the posture
   that left 9 `toast/` routes unguarded (`.planning/foundation/ENDPOINTS.md:15,21`). An
   MCP façade must assert the tenant itself, not inherit the assumption.
2. **Rate limits key on the user, then the restaurant, then the IP**
   (`common/rate-limit/rate-limit.guard.ts:246-266`), defaults 100/60s, `ai` 20/60s
   (`:27-33`). A single MCP client would consume one user's whole budget.
3. **Read postures are not always the write postures.** `getLocation` enforces org
   membership only (`organizations/organizations.service.ts:123-153`), so a staff token
   reads the billing email; an MCP tool would inherit that.
4. **An empty array can mean "could not read".** `listConnections` logs a query error and
   returns `[]` (`integrations/integrations-oauth.service.ts:485-488`) — the shape §7a's
   honesty rules exist to stop reaching a tool result.

## §7a Honesty rules for tool results

Binding, and the reason this is a document before it is a package
([ADR 0020](../decisions/0020-no-fabricated-answers.md); the
absence-reported-as-health rule):

- **An unknown is `null` with a `reason`, never `0` and never an empty list.** A tool
  returns `{"value": null, "reason": "no POS check feed for this window"}`. Zero is a
  measurement; null is an absence; they are different answers and the client must be able
  to tell them apart.
- **Every write returns what it did *and what it did not*.** `orders.draft` returns the
  draft **and** `"sent": false, "requires": "manager approval in Mudavym"`. A write that
  partially succeeded says which part.
- **A refusal is a result, not an error.** Asking for a send returns a structured refusal
  naming the human step, so the assistant can tell the user rather than retry.
- **No tool invents an analysis.** Where the engine cannot compute an insight, the tool
  says so; it never composes a plausible sentence from adjacent numbers.
- **A stale read is dated.** Anything cached carries `as_of`.

## §7b Auth and tenancy

- **Authentication reuses the JWT the gateway already issues.** Payload is signed at
  `auth/auth.service.ts:521-536` and carries `sub` (= `public.users.user_id`) plus
  `restaurantId` (`:521-527`). Both scopes come from the token; **neither is ever a tool
  parameter** — the pattern `mcp-connections.controller.ts:44-59` already establishes,
  where a token with no tenant is a `400` saying so rather than an empty list.
- **Scopes** are the vocabulary `user_mcp_connections.scopes` already validates: lowercase
  slugs like `inventory:read`, `orders:draft` (`dto/mcp-connection.dto.ts:45-50`). A tool
  advertises the scopes it needs; an ungranted scope hides the tool from `tools/list`
  rather than failing at call time.
- **Rate limits** per grant, not per user, so one assistant cannot exhaust the house's
  budget (§7.2).
- **Never exposed:** secrets and tokens of any kind; any other tenant's rows; raw PII
  (staff wages, personal phone numbers, billing email) — redacted or omitted with a
  reason; the `@Public()` test/E2E write routes; and every verb in §4's table.

## §7c Resources and prompts

**Resources** — read-only documents, addressed by URI, that a client can attach whole:

| URI | What it is |
|---|---|
| `mudavym://cellar/{restaurantId}` | **the cellar book** — registers and their bottles (`cellar/cellar.controller.ts:32`) |
| `mudavym://day-book/{restaurantId}/{date}` | **the day-book** — one day's movements, deliveries and events (`logs/logs.controller.ts:26`) |
| `mudavym://reports/{reportId}` | **the reports sheet** — one generated report (`reports/reports.controller.ts:100`) |
| `mudavym://vault/pages/{slug}` | a page note from `.planning/06-pages/` |
| `mudavym://vault/softwares/{slug}` | a software note from this folder |

The two vault resources are the founder's own documentation, served read-only so an
assistant can answer "what is `/receiving` supposed to do?" from the contract rather than
from the code.

**Prompts** — canned tasks, each a fixed sequence of the tools above:

| Prompt | What it does |
|---|---|
| `close-the-week` | reads counts, ledger balances, orders and insights for the week; produces a written close, drafts nothing |
| `chase-the-short-delivery` | finds the order whose door log is short of its lines, reads the thread, **drafts** a chase reply — send stays human |
| `walk-the-cellar` | low-stock lines against the cellar book, ordered by what runs out first |
| `price-check-before-ordering` | compares held vendor prices for a draft's lines before a human approves it |
| `what-changed-since-yesterday` | day-book diff plus new notifications |

## §8 Where it's going — what building it would take

Not started. In order:

1. **An ADR first.** Nothing here is decided. The forks a build must not default:
   transport, scope vocabulary, whether a grant is a new table or a row shape on
   `user_mcp_connections`, and whether the server is multi-tenant or one process per
   house. Take the number from `next_free()` in `scripts/check_adr_numbers_unique.py:198`
   **plus a `git worktree list` sweep** — the guard sees refs only.
2. **Transport.** Ship **stdio first**: it is a local process holding the user's own token,
   with no new public surface, no CORS, no session store, and it is what a desktop client
   configures. **HTTP/SSE second**, and only behind the same `JwtAuthGuard` posture as the
   gateway — a remote MCP endpoint is a new unauthenticated-by-default door, which is the
   `toast/` failure repeated (§7.1).
3. **Package location.** `packages/mcp-server/` — a third workspace beside `database` and
   `ui`. **Not** inside `apps/api-gateway`: its Dockerfile copies only
   `apps/api-gateway/dist`, and ADR 0013 §Options-1 records that build boundary being
   discovered the expensive way.
4. **The first ten tools** — read-only, one division at a time, so the first release
   cannot commit anything: `inventory.list`, `inventory.low_stock`, `orders.list`,
   `orders.get`, `vendors.search`, `prices.compare`, `insights.list`, `analytics.financial`,
   `logs.timeline`, `health.live`. Write verbs land only after the refusal contract (§7a)
   has a test suite.
5. **Tests.** A contract test per tool asserting the honesty rules (null-with-reason, never
   0); a tenancy test proving a token for house A cannot read house B through any tool; a
   refusal test per §4 row proving the verb is absent from `tools/list`; and the guardrail
   test importing the **canon** patterns, never a copy — extending
   `commitment-patterns.spec.ts` rather than adding a fourth list.
6. **Dispatch note.** Building this scores ≥ 4 on [ADR 0050](../decisions/0050-agent-dispatch-hardness-threshold.md)
   — blast radius 2 (auth, tenancy, an outward-facing surface), ambiguity 2 (every fork in
   step 1 is open) — so any agent that builds it runs on Opus, not Sonnet.
