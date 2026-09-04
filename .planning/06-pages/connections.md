---
type: page
route: /connections
slug: connections
softwares: [settings-integrations]
component: apps/web/src/pages/connections/next/ConnectionsNext.tsx
audience: owner
tier: core
archetype: list+detail
signals_today: none
rebrand_strings: 1
maturity: partial
status: documented
updated: 2026-09-03
links: ["[[PAGE-CONTRACT]]", "[[profile]]", "[[settings]]"]
---

# /connections

> **Part of** [[08-softwares/settings-integrations|Settings & Integrations]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

> **Retire-to-write.** This note does not add a document to the corpus without
> removing one's claim: it **supersedes the house half of [[profile]]**. The
> three registers `/profile` carries that are about the house — IV (model
> context), V (payments) and VI (the restaurant record) — are described HERE
> from now on, and `profile.md` §13a is reduced to a pointer plus the personal
> half. Nothing is deleted while the flag is off, because with the flag off this
> route redirects to `/profile` and the only true description of those registers
> is the one on that page.

## Surface — buttons → where they go

- **Copy address** → API `GET /api/v1/calendar/ical-token` (the value is copied, not navigated)
- **Regenerate** → API `POST /api/v1/calendar/ical-token/regenerate`
- **Consent / Withdraw consent** → API `PUT /api/v1/mcp-connections/:id/consent`
- **Check again** → API `POST /api/v1/mcp-connections/:id/probe`
- **Stop the house using it / Use it again** → API `PUT /api/v1/integrations/oauth/house-grants/:connectionId/access`
- **Connect yours** → [[authorize-integration]] `/authorize/:integrationId`
- **your profile** (in the role refusal) → [[profile]] `/profile`
- **Connections** (from the three house registers, flag on) → this page, from [[profile]]

## 1. Purpose

**What acts for this house** — one list of everything that can take an action in
this restaurant's name, for the manager or owner who is answerable for it.

The founder's note on `/profile` (2026-09-03) was *"be definite about
comprehensiveness of design, MCP's to connectors, to Third party apps and so on.
Maybe not in profile you're right."* Three of `/profile`'s seven registers were
about the house, not the person, and one of them was the house's cards on file
on a page every member reaches. Asked where they belong, the founder chose
**"Own route, role-gated"**. The ten-product survey, the placement rule and the
28-item comprehensiveness checklist behind that are
[[DESIGN-FOUNDATION]] §6b; the decision is
[ADR 0114](../decisions/0114-connections-are-the-houses-profile-is-the-persons.md).

Audience: **manager and owner only**. A staff member gets a written refusal, and
the two registers that would actually leak are refused at the gateway as well.

## 1a. Features

- **The ledger sentence** — how many things can act for this house, how many can
  spend, how many may call a tool. Every clause is a measurement; a register
  that could not be read removes its clause rather than contributing a zero.
- **One row for every attachment**, four columns and no fifth: whose it is ·
  what it may do · what it last did · how to stop it. A row that cannot be
  stopped here names who can.
- **Register I — what the house has attached.** The till (POS ingest over 30
  days, by source), the payment provider (which secrets are set, whether a
  signed delivery has ever arrived), the sender identity, the calendar feed
  (address, copy, regenerate), the public page *(states that none exists for a
  house — see §9)*, and the model-context servers with a row each.
- **Model-context rows** carry the declarer, the reader's own consent, how many
  people have consented, the tools granted by name, and which of those can
  change something outside this app. *(New this pass: consent and per-tool
  grants are real rows in the database.)*
- **Register II — what the house pays with.** Instruments on file, or the stated
  reason none can exist. *(Empty by construction today: no provider key.)*
- **Register III — personal grants that act inside this house.** Every OAuth
  grant recorded against this restaurant, named with its owner, plus a count of
  live grants belonging to people who work here that carry no recorded
  restaurant. A manager may stop the house using one; **never** revoke it, and
  **never** approve it.
- **The catalogue** of what could be connected, read from the same route the
  other three surfaces read — an unconnected entry is drawn at the same weight
  as a live one.
- **Register IV — set once for every house on this deployment.** Token
  encryption and the model provider, named and read-only. *(The model provider
  row claims nothing: no endpoint reports its state — see §9.)*
- **A written refusal for a non-manager**, which says the server refuses too.

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_connections`)

> **Chrome (2026-09-04).** With the flag on, this page is framed by the house
> header — `apps/web/src/components/mudavym/HouseHeader.tsx`, mounted by
> `PageGate` above every `next` tree: the A+M mark, this page's name, the ⌘K
> "Search or act" trigger, the house (or the branch switcher when there is more
> than one), the bell, the theme menu and the account menu. Chrome is excluded
> from §Surface by PAGE-CONTRACT, so it is named here and nowhere else in this
> note; its motions live in `components/mudavym/MOTIONS.md`, not the table
> below.

| id | token | curve / ms | when it fires |
|---|---|---|---|
| `cx-btn-hover` | `ink` | `cubic-bezier(0.16, 1, 0.3, 1)` · 160ms | the background of a live control settles as the pointer enters it |

One motion, deliberately. Full reasoning, and the three motions considered and
rejected (`tally` on the counts, `settle` per register, `stamp` on a granted
write), in `apps/web/src/pages/connections/next/MOTIONS.md`.
`prefers-reduced-motion: reduce` drops it outright.

### Design used, and why

**The founder's decision, quoted:** *"Own route, role-gated."* Plus four calls
the same day, each visible on the page: *"House declares, each person
consents."* · *"Per-tool grant plus the seal on every write."* · the house gets
its own mailbox or a Mudavym subdomain · *"A manager may SEE, not approve, what
a member has personally connected."*

**The structure that enforces it.** One row component draws every attachment,
with four columns and no fifth, and `stopNote` is a *required* prop — so a row
with no live control cannot be written without saying who can stop it. A live
POS feed and an unconnected Excel grant get the same amount of design; what
separates them is the chip, whether the control is live, and the sentence under
it. The page therefore cannot flatter an empty attachment by drawing it richer
than its evidence, and there is no control on it that can appear to succeed.

**The honesty rules applied.**
- The ledger sentence is the most dangerous line on the page — *"Nothing here
  can spend money today"* is enormously reassuring, and would be a lie if the
  payment register had simply failed to load. Every count is `null` when its
  register is unread, the sentence drops the clause rather than softening it,
  and a tally cell renders an em dash.
- A failed read is **named** and carries the gateway's own sentence. A refusal
  for the reader's role says something different from a failure, because
  "nothing is here" and "you may not see what is here" are different facts.
- A dead POS read renders *"could not be read, so this is silence rather than
  zero"*, never `0 checks` (ADR 0067's `unavailable` field is what makes that
  possible).
- Every disabled control carries the reason, and the reason is the server's
  wherever the server has one.

**Two directions considered and not built** (the founder decides after seeing
this page):
1. **A single `GET /connections/ledger`** assembling all seven sources in the
   gateway. One request instead of seven, one loading state, one place to add
   the eighth register. Rejected because it has exactly two answers — the whole
   page or a 500 — so the till failing would blank the payment register and the
   page could not say which had gone. That is the opposite of ADR 0020's rule,
   on the one surface whose job is to say what is missing.
2. **Sections in `/settings`** rather than a route, collapsing the existing
   `services` / `pos` / `email` / `calendar` tabs into one. Cheaper by one nav
   row and genuinely reduces surface count. Rejected by the founder in favour of
   the route; the argument for it is preserved in §6b so it can be revisited
   without re-deriving it.

**What was substituted or left out.** The sketch's "Public house page" row is
kept as a row and inverted: `vendor_portal_pages` is keyed by
`vendor_catalogue_id` / `provider_id`
(`supabase/migrations/20260805155901_vendor_portal.sql:27-33`) and has no
restaurant column, so a house has no public page and the row says so. Declaring
a model-context server is not on this page yet — it stays on `/profile` until
the register moves fully, and the control is disabled saying exactly that.

## 2. Entry

Sidebar, after Settings, in the bottom group
(`apps/web/src/components/layout/Sidebar.tsx`). The entry is hidden while the
flag is off (the route redirects, and a link to a redirect is a loop) and hidden
for non-managers via the new `NavItem.minRole` field. Also reachable from the
three house registers on `/profile` when the flag is on. Cold URL works for a
manager; a staff member reaches the written refusal.

## 3. Files

| File | Holds |
|---|---|
| `apps/web/src/App.tsx:373` | the route binding, `legacy={<Navigate to="/profile" replace />}` |
| `apps/web/src/App.tsx:93` | the lazy import |
| `apps/web/src/pages/connections/next/ConnectionsNext.tsx` | the page |
| `apps/web/src/pages/connections/next/AttachmentRow.tsx` | the one row, plus the unread and loading states |
| `apps/web/src/pages/connections/next/useConnectionsNextData.ts` | seven reads, six writes, the tally arithmetic |
| `apps/web/src/pages/connections/next/cx-format.ts` | em dash, counts, dates, feed URL |
| `apps/web/src/pages/connections/next/connections-next.css` | tokens only, both grounds |
| `apps/web/src/pages/connections/next/fonts.ts` | Fraunces, injected once |
| `apps/web/src/pages/connections/next/ConnectionsNext.test.tsx` | 20 render-contract tests |
| `apps/web/src/pages/connections/next/MOTIONS.md` | the one motion, and the three not built |

## 4. Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/pos-hub/status/:restaurantId` | JWT | `unavailable: true` distinguishes a dead read from a quiet till (`pos-hub.service.ts:1230`) |
| GET | `/billing/provider` | JWT + **manager/owner** | role gate added this pass (G19) |
| GET | `/payment-methods` | JWT + **manager/owner** | role gate added this pass (G19) |
| GET | `/communications/sender-identity` | JWT | **new this pass** — the address and its scope, never a credential |
| GET | `/calendar/ical-token` | JWT | provisions on read |
| POST | `/calendar/ical-token/regenerate` | JWT | revokes every subscription |
| GET | `/mcp-connections` | JWT | **house-scoped this pass**; carries consent and tool grants |
| GET | `/mcp-connections/runtime` | JWT | `invocation.enabled` is now `true`, with the terms |
| PUT | `/mcp-connections/:id/consent` | JWT | the caller's own consent; no user id is accepted |
| POST | `/mcp-connections/:id/probe` | JWT + **manager/owner** | |
| PUT | `/mcp-connections/:id/tools/:tool` | JWT + **manager/owner** | **new** — grant one tool by name, `writes` required |
| DELETE | `/mcp-connections/:id/tools/:tool` | JWT + **manager/owner** | **new** |
| POST | `/mcp-connections/:id/tools/:tool/call` | JWT + gate | **new** — five refusals; not called from this page yet (§13) |
| PUT | `/mcp-connections/:id/house-consent` | JWT + **manager/owner** | **new** — the house's side of a person's consent |
| GET | `/integrations/oauth/house-grants` | JWT + **manager/owner** | **new** — every personal grant recorded against this house |
| PUT | `/integrations/oauth/house-grants/:id/access` | JWT + **manager/owner** | **new** — stop, or resume, the house using one |
| GET | `/integrations/oauth/catalog` | JWT | the SAME route the other three surfaces read (G20) |

## 5. Signals

None. This page emits no NF event and no `uxSignals` entry, like every other
rebuilt surface in the wave. Filed rather than implied: an attachment being
granted, revoked or cut off is exactly the kind of thing a connection event log
would carry, and §6b named that log as the cheapest absent item on the
checklist. `mcp_tool_calls` is the first piece of it and covers tool calls only.

## 6. Tier cut

Core. Touched by any scenario that depends on the till, on vendor email, or on a
model-context server; no scenario currently exercises this page directly.

## 7. Rebrand surface

One string, and it is data rather than markup: the sender identity row prints
the deployment's fallback address `notifications@wineops.ai`
(`apps/api-gateway/src/communications/gmail.service.ts:79-80`). It is shown
because it is true, and it changes when the deployment's mailbox does.

## 8. State & config

- Flag `mudavym_design_connections`, registered
  (`apps/api-gateway/src/settings/feature-flag-registry.ts:179`), column added by
  `supabase/migrations/20260903150000_mudavym_design_flags_connections.sql`.
  **OFF renders no page at all** — the route redirects to `/profile` and the nav
  entry is absent. This is the only flag in the registry that gates a new route
  rather than a redesign.
- localStorage override `mudavym.design.connections` (`"1"`/`"0"`), per browser.
- Role: manager or owner. Enforced client-side for the page and server-side for
  `/payment-methods`, `/billing/provider` and every `house-grants` route.
- Env read *about*, never *by*, this page: `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `GMAIL_SENDER_EMAIL`,
  `INTEGRATION_TOKEN_ENCRYPTION_KEY`, `MCP_CONNECTION_SECRET_KEY`,
  `ANTHROPIC_API_KEY`.

## 9. Gaps

Each is rendered honestly on the page rather than hidden.

- **G-C1 — the POS bridge cannot be disconnected.** `pos-hub.controller.ts`
  carries no delete route of any shape, so "Disconnect" is disabled and the row
  says what actually stops the feed (removing the webhook secret). *Why not yet:*
  a disconnect that leaves 41k ingested checks in place needs a decision about
  what happens to them, which is a founder call and not a button.
- **G-C2 — a house has no public page.** `vendor_portal_pages` is keyed by
  `vendor_catalogue_id` / `provider_id` (`20260805155901_vendor_portal.sql:27-33`).
  DESIGN-FOUNDATION §6b listed this as "the house's"; that is **wrong**, and the
  correction is on the row. *Why not yet:* building one needs a
  restaurant-scoped page table and a public route — a feature, not a gap.
- **G-C3 — calendar feed fetches are not recorded.** No table counts
  subscribers or fetches, so "four subscribers have fetched it this week" (the
  sketch's line) cannot be said. The row shows an em dash and states that
  regenerating revokes an unknown number of subscriptions.
- **G-C4 — the model provider reports nothing.** No route exposes whether
  `ANTHROPIC_API_KEY` is set or when it was last used, so the row names the
  variable and claims nothing.
- **G-C5 — no per-restaurant sender.** The direction is decided (a house's own
  mailbox, or a Mudavym subdomain); neither is built and there is no sender
  column, no verified domain and no DNS. `perHouse.supported` is `false` with
  that sentence, from the server.
- **G-C6 — an OAuth grant has no last-used record.** `integration_oauth_connections`
  stores `token_expires_at` and `connected_at` and nothing about use, so
  Register III shows expiry rather than last action. Zapier shows a workflow
  count here; we cannot.
- **G-C7 — `listConnections` still returns `[]` on a query error** (G3,
  `integrations-oauth.service.ts`). Not on this page's path — the house-grants
  route throws — but the personal list on `/profile` still infers a failure from
  an empty array.
- **G-C8 — declaring a server is not on this page.** It stays on `/profile`.
  *Why not yet:* the form and its secret field are built there; duplicating them
  before the founder has reviewed this surface would build them twice.

**Correction to the commit message (a9747074, 2026-09-04).** Its body says the two ungated
reads were closed and "the old test pinned the defect and was replaced with its reason". There
was no old test: `git show --diff-filter=D --name-only a9747074` lists nothing, and
`payment-methods.service.spec.ts` is untouched by that commit. Neither read had ever been
covered by a spec; `apps/api-gateway/src/billing/billing-provider-read-is-role-gated.spec.ts` is
new (+109 lines, added by that same commit), and the payment-methods gate is covered by the
existing service spec rather than by a replacement for something deleted. The history stays as
written; this line is the correction.

**Closed this pass:** G19 (both reads role-gated, two specs), G21 (grants are
scoped to the restaurant on the token, two-tenant spec), G20 (no fourth
catalogue — this page reads the shared route).

## 10. Maturity

**partial.** Every register renders from a real endpoint and every claim on the
page is measured or explicitly absent. Four things it describes it cannot yet
do: disconnect the till (G-C1), publish a house page (G-C2), name the house's
own sender (G-C5), and declare a model-context server (G-C8). None of the four
is rendered as a working control.

## 11. Data flow

### Calls out
See §4. Seven reads, deliberately not one — the reasoning is in §1b.

### Fed by
POS webhooks (`pos-hub`), Stripe's signed webhook (`billing`), the Gmail
mailbox's own profile, the calendar's per-user token row, `restaurant_mcp_connections`
+ `mcp_connection_consents` + `mcp_tool_grants`, and `integration_oauth_connections`
written by the OAuth callback.

### Writes
`calendar` token regeneration; `mcp_connection_consents` (the reader's own
consent, and a manager's house-side withdrawal); `mcp_tool_grants`;
`restaurant_personal_grant_access` (the house's revocation list, enforced at
`integrations-oauth.service.ts` `getAccessToken`); `mcp_tool_calls` on every
dispatched tool call. Nothing downstream reacts to any of them yet.

## 12. Design intent

A register a manager opens when something has gone wrong, or before something is
granted. It should be readable, still, and complete — and it should be
impossible for it to be quietly incomplete.

Four states, all implemented: **empty** (a register that genuinely holds nothing
says so in the row's own words), **loading** (named per register — "Reading the
till…"), **error** (named, with the gateway's sentence, saying that silence is
not nothing), **permission-denied** (a written refusal that also says the server
refuses).

Where it could still mislead: the tally row is the one place a reader might take
a number as complete when a *different* register failed. It is mitigated (each
cell dashes independently and the sentence drops clauses) but not eliminated —
a reader who looks only at "0 may call a tool" while the model-context register
is unread would see the dash only in that cell.

## 13. Roadmap

1. **Call a granted tool from the row, behind hold-to-approve.** The gateway
   gate is built and specced; the page has no call control yet. Blocked on
   nothing but review of this surface.
2. **Move Register IV/V/VI off `/profile` entirely**, leaving the pointer.
   Blocked on the founder seeing this page.
3. **A connection event log** — who attached, granted, revoked or cut off what,
   and when. §6b's cheapest absent item; `mcp_tool_calls` is one third of it.
4. **The house's own sender** (G-C5). Needs a domain, a DNS record and a
   provider decision — not a page.
5. **A last-used stamp on OAuth grants** (G-C6), so Register III can say what a
   personal grant actually did here.
6. **Re-consent when a server's advertised tools change.** A trusted server that
   starts advertising `place_order` triggers nothing today; the probe already
   stores the tool list, so the diff is cheap.
7. **A house public page** (G-C2), if the founder wants one.
8. **Retire `/settings`' `services` / `pos` / `email` / `calendar` tabs into
   this page.** Blocked: `settings/next/st-format.ts` belongs to another builder,
   and §6b's counter-argument that this page must reduce surface count rather
   than add to it is only satisfied once those four collapse.
