# 0114 — Connections are the house's, profile is the person's

- **Status:** Locked on the route and on the four founder calls below; built behind a flag, founder review open on the surface
- **2026-09-04 — the collapse landed; the surface count fell by four tabs and three registers.** The founder, asked the two questions this ADR left open at the bottom, answered *"Move the registers and collapse the four tabs."* Measured: `/settings` goes from **14 registers to 10 plus one line out**, and `/profile` from **7 registers to 5**. Net, with the flag on, one new route in exchange for seven surfaces — which is the arithmetic the rejected alternative below said had to hold, and until this it did not. Two consequences of this ADR are now stale and are corrected here rather than in place: *"`/profile` is unchanged except for one pointer line"* is no longer true, and *"nothing is moved out yet"* is no longer true. One thing did **not** move whole: Register IV **split** along this gateway's own role gates — declare / probe / secret / revoke are `assertCanManageRestaurant` and moved; `PUT /mcp-connections/:id/consent` has no role check (`mcp-connections.controller.ts:218-235`), and since `/connections` is manager-only, moving it would have left a staff member with no way at all to stop a server acting in their name. That is decision 2 of this ADR ("house declares, each person consents") applied to placement. The collapse also **subtracted one capability** and says so: adding or removing a card has no home while the flag is on, because `StripeCardPanel.tsx` is bound to `/profile`'s data hook and UI kit — `connections.md` §9 G-C9, `profile.md` §9 G12a.
- **Date:** 2026-09-03
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** connections, integrations, MCP, model context, OAuth, payments, POS, sender identity, calendar feed, tenancy, role gate, consent, per-tool grant, absence-reported-as-health, G19, G20, G21
- **Links:** [[0020-no-fabricated-answers]] (the rule the ledger sentence is a test of), [[0042-iznik-seal-and-warm-charcoal]] (tokens, and the flag shape), [[0044-mudavym-implementation-kickoff]] (the wave), [[0107-a-declared-server-is-not-a-reachable-one]] (extended by this — see the addendum in that file), [[0110-a-card-on-file-is-the-providers-record-not-ours]] (Register II's provider path), `.planning/06-pages/DESIGN-FOUNDATION.md` §6b (the ten-product survey and the 28-item checklist), `.planning/06-pages/connections.md` (the page), `.planning/06-pages/profile.md` §13a (what leaves that page)

## Context

`/profile`'s Mudavym rebuild shipped seven registers on 2026-09-03. The founder
read it and wrote:

> *"be definite about comprehensiveness of design, MCP's to connectors, to Third
> party apps and so on. Maybe not in profile you're right."*

DESIGN-FOUNDATION §6b answered that with a ten-product survey (Stripe, Linear,
Notion, Slack, Vercel, GitHub, Zapier, Claude, Toast, Square) and one rule the
field agrees on: **placement is decided by whose credential it is and in whose
name the action is taken, never by what the thing is called.** Applied to what
Mudavym actually has, three of `/profile`'s seven registers came out on the
wrong side of that line, and the measurements were not close:

| Measured on this branch | Finding |
|---|---|
| `payment_methods` has **no `user_id` column at all** (`20260903094600_payment_methods.sql:53`) | A house object living on a personal page |
| `GET /payment-methods` (`payment-methods.controller.ts:65-79`) and `GET /billing/provider` (`:66-78`) took any authenticated member while every write called `assertCanManageRestaurant` | The read posture and the write posture disagreed — **G19** |
| `listConnections` filtered on `user_id` alone (`integrations-oauth.service.ts:476-484`) while `restaurant_id` was written at `:150` and `:439` | A grant made in restaurant A listed in restaurant B — **G21** |
| The same OAuth catalogue rendered at `components/settings/IntegrationsAuth.tsx:161`, `settings/next/ServicesSection.tsx:128` and `profile/next/ConnectionsRegister.tsx:224`, each a different subset; POS, sender identity, calendar feed and payments in **none** of them | There is no one list anywhere in the product — **G20** |
| `user_mcp_connections.user_id NOT NULL … ON DELETE CASCADE` with the comment *"acts with the user's authority, so it hangs off the user"* (`20260903094500:53-56`), against `McpRegister.tsx:319` *"Servers the house agents may call"* | Two contradictory answers, both in the tree |

## Decision

### 1. A route, not a settings section

`/connections`, opening on *"What acts for this house"*, manager-and-owner,
behind `mudavym_design_connections`. With the flag off the route redirects to
`/profile` and the nav entry is absent, so nothing in production changes until a
restaurant opts in.

`/profile` keeps what is personal: who you are, what protects this account, what
is attached to *you*, and the exit. That is the same cut Stripe makes between
Personal and Business settings, and the same one GitHub makes between a user's
authorized OAuth apps and an organization's installed Apps.

### 2. House declares, each person consents

The founder's words. Consequences, all three built:

- The attachment is the **restaurant's**. `user_mcp_connections` is renamed
  `restaurant_mcp_connections`, `user_id` is replaced by `declared_by … ON
  DELETE SET NULL`, and the live-name uniqueness moves from
  `(user, restaurant, name)` to `(restaurant, name)`. Deleting the manager who
  typed the URL no longer deletes the house's Toast bridge.
- A person's agreement is a row in `mcp_connection_consents`, withdrawable
  without touching the attachment or anybody else's consent.
- The table is renamed rather than merely re-commented, because
  `user_mcp_connections` is a name asserting the answer this decision rejects.

### 3. Per-tool grant, plus the seal on every write

Also the founder's words: *"A manager grants each tool once, by name; a tool
that changes the world outside the app runs only behind HoldToApprove, reads run
freely."*

`mcp_tool_grants` holds one row per (connection, tool) with a `writes` boolean
that has **no default at any layer** — table, DTO or UI. One gate,
`McpConnectionsService.assertCallable`, refuses five ways: no consent; a consent
the house has withdrawn (a *different* sentence, because telling someone to
consent again would send them round a loop they cannot finish); no grant for
that tool; a write to a caller who is not a manager; a write with no seal. Every
call is recorded in `mcp_tool_calls`, **including the ones that failed** — a log
that holds only successes omits exactly the call it will one day be read for.

This supersedes ADR 0107's `invocation.enabled: false`. That flag said *"that
decision comes before the code"*; the decision arrived, so the code follows it.

### 4. The house's own sending address

Decided in direction: a house gets its own mailbox, or a Mudavym subdomain.
**Not built** — there is no sender column, no verified domain and no DNS. What
is built is `GET /communications/sender-identity`, so the page can state the
truth (one mailbox shared by every restaurant on this deployment) from the
server rather than from page prose, and the control is disabled carrying the
server's own reason.

### 5. A manager may see, not approve

A manager sees every personal grant recorded against the house, named with its
owner, and may **stop the house using one** — enforced in
`IntegrationsOauthService.getAccessToken`, the single door feature code uses, so
it is a refusal rather than a hidden button. A manager may never revoke someone
else's credential, and there is no pending state to approve: the migration's own
`DO` block raises if an `approved_at` / `approval_status` / `pending` column
ever appears on the consents table.

`restaurant_personal_grant_access` is a **revocation list**, not a permission
table: a row means the house has cut itself off. No row means it has not, which
is the true default — a permission table would have needed a row per grant that
something had to remember to write, and a missing row would have read as
"denied" for a grant that was in fact live. Absence reported as safety is the
same fault as absence reported as health wearing a different coat.

### 6. Three defects closed on the way

- **G19** — both reads now run `assertCanManageRestaurant`, with a spec each.
  The existing test asserting the opposite ("leaves the read open to any member")
  was green and pinned the defect, because the defect had been written down as
  the intent. It is replaced and the replacement says why.
- **G21** — `listConnections` takes the restaurant from the token and filters on
  it. `restaurant_id` is nullable, and a null is **not** dropped: a grant
  recorded before a tenant reached the token is live, and hiding it would turn a
  real attachment into an absence. It is listed everywhere, carrying
  `restaurantId: null`, so the surface can say its house was never recorded.
- **G20** — no fourth catalogue. `/connections` reads
  `GET /integrations/oauth/catalog`, the same route the other three read, served
  from the one shared constant (`integrations-oauth.constants.ts:43-66`).

## Alternatives rejected

**A settings section rather than a route.** §6b's own strongest counter-argument:
`/settings` already has `services`, `pos`, `email` and `calendar` tabs, all four
are connections, and retire-to-write says adding costs retiring. It genuinely
wins on surface count *if the four tabs collapse into it*. Rejected by the
founder in favour of the route; the obligation it names survives as roadmap item
8 on the page note, so the count still has to come down.

**One `GET /connections/ledger` endpoint.** One request instead of seven, one
loading state, one place to add the eighth register. Rejected: it has exactly two
answers, the whole page or a 500, so the till failing would blank the payment
register and the page could not say which had gone. On the one surface whose job
is to say what is missing, that is the wrong trade. Seven requests on a page a
manager opens rarely is the price.

**Adding `declared_by` and leaving `user_id NOT NULL`.** Cheaper, no rename, no
index churn. Rejected because it writes the new rule beside the old one and
*enforces the old one* — the cascade would still delete the house's servers with
the account. The migration asserts `user_id` is gone rather than asserting
`declared_by` is present, for exactly that reason.

**A client-side role gate only.** Rejected: the sidebar hiding an entry is
cosmetic, and `payment_methods` is one provider key away from holding real
instruments. The gate is at the gateway; the hidden nav row is a courtesy.

**Requiring cryptographic proof of the seal.** Considered and *not* done, and the
limitation is stated rather than hidden: `sealed: true` is an assertion made by
an authenticated manager and recorded with their id — it is not proof that the
hold-to-approve gesture happened. What actually holds is the grant plus the
role; the seal is the third lock, not the first. Making it provable needs a
server-issued challenge the ceremony redeems, which is a decision about how much
ceremony costs and is not this ADR's to take.

## Consequences

- Eighteenth entry in `ACTIVE_FEATURE_FLAGS`, and the first that gates a **new
  route** rather than a redesign. OFF means "this surface does not exist here",
  not "the old design".
- `NavItem` gains `minRole?: 'manager' | 'owner'`
  (`apps/web/src/components/layout/Sidebar.tsx`). One field, one filter, one
  entry using it.
- Two migrations: `20260903150000` (the flag column) and `20260903151000` (the
  rename, `declared_by`, consents with both withdrawal axes, per-tool grants,
  the call log, and the house's revocation list). All four new tables ship with
  RLS on, client roles revoked and in-file assertions.
- `scripts/check_order_capture_contract.py` learns `ALTER TABLE … RENAME TO`.
  Without it the shared migration replay kept the old table name and reported
  eleven false findings against correct code — a guard that goes blind on a
  rename is worse than one that fails, because it accuses the right code and
  would wave the wrong code through the day someone renamed a table by accident.
  `check_queried_tables_exist.py:652` already carried the rule; this puts it in
  the parse the three column guards share.
- `/profile` is unchanged except for one pointer line above its three house
  registers, shown only when the flag is on. Nothing is moved out yet: moving a
  register before the founder has seen the surface it moves to would build it
  twice.
- Four things the page describes and cannot do are rendered as disabled controls
  with reasons, not hidden: disconnect the till, publish a house page, use the
  house's own sending address, declare a model-context server. They are
  `connections.md` §9 G-C1, G-C2, G-C5 and G-C8.

## What this decision does NOT settle

- **Whether a house public page should exist at all.** `vendor_portal_pages` is a
  *vendor's* page (`20260805155901_vendor_portal.sql:27-33`); a restaurant has
  none. §6b called it "the house's" and that was wrong. Corrected on the row and
  here.
- **Pricing** (OD-23). Register II stops at a card on file, as ADR 0110 did.
- ~~**Whether the four `/settings` tabs collapse into this page**, which is what
  makes the surface count fall rather than rise.~~ **Settled 2026-09-04: they
  do.** See the dated status line at the top.
- **Still open: whose a model-context server is.** The 2026-09-04 pass split the
  register along the role gates the CODE already enforces, which is a placement
  answer, not an ownership one. The fork remains as this ADR left it.
