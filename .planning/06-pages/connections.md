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
- **Connections** (from `/profile`'s moved-registers line, flag on) → this page `#payment`, from [[profile]]
- **Connections** (from `/profile`'s consent register, flag on) → this page `#servers`, from [[profile]]
- **Connections — what acts for this house** (from `/settings`' contents column, flag on) → this page, from [[settings]]
- **Declare a server** → API `POST /api/v1/mcp-connections` *(arrived from `/profile` 2026-09-04)*
- **Hold to revoke &lt;server&gt;** → API `DELETE /api/v1/mcp-connections/:id` *(same)*

**Fragments this page answers to** (`REGISTER_ANCHORS`, `ConnectionsNext.tsx`), each the
landing place of a retired `/settings?tab=`: `#attached` · `#till` · `#sender` · `#feed` ·
`#servers` · `#payment` · `#grants` · `#deployment`.

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
- **Every tool the server LISTS, with two facts on one line** — what the SERVER
  declared about it (`annotations.readOnlyHint`, or that it declared nothing)
  and what this house granted. A listed tool nobody granted is shown as refused
  rather than omitted: a list of only what is permitted cannot be read as a list
  of what exists. A manager who classified a declared read as a write is named
  as overriding the server, so the row never passes a person's judgement off as
  the server's word.
- **"Last seal: proven" vs "asserted"** — on every tool granted as a write, what
  the most recent sealed call was actually worth. A seal is now *redeemed*: the
  gateway mints a one-time token bound to the manager, the server, the tool and
  the arguments when the hold begins, and spends it exactly once on the write.
  A replay, a different actor, a different tool, changed arguments or an expired
  token is refused in words and filed in the call log. Calls made before
  2026-09-04 read "asserted, never checked", because they were.
  *(New this pass; ADR 0107 addendum of 2026-09-04, second.)*
- **"Needs re-consent: what changed"** — one line per grant the gateway is
  currently refusing because the server's declaration moved since the grant
  ("the server changed readOnlyHint true to false"), a warn chip counting them,
  and a **Re-consent** control behind the seal that re-grants against what the
  server says *now*. A tool the server has stopped listing is revoked outright,
  and a probe that FAILED changes nothing — an outage is not a permission
  change. *(New this pass; ADR 0107 addendum of 2026-09-04.)*
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
- **Declare a server, and revoke one** *(arrived from `/profile` 2026-09-04 with the
  collapse; `HouseServerControls.tsx`)*. Four fields and only four — name, endpoint,
  scopes, credential — with the credential disabled carrying the deployment's own reason
  when it cannot be stored. Revoke carries the seal, because it destroys a stored
  credential and re-declaring the same server does not undo it. A non-manager sees the
  refusal in words rather than a hidden panel. *Changing a credential afterwards is
  **not** here — the route answers, the button does not exist (§9 G-C8).*
- **Register anchors** *(the collapse, 2026-09-04)*. Eight ids, one per register or
  moved tab, so a `/settings?tab=pos` bookmark lands on the till rather than at the top
  of a long list. Honoured once the register behind the fragment has answered, so a
  deep link never scrolls to a skeleton.

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

**The collapse (2026-09-04) added none.** `HouseServerControls` reuses `cx-btn-hover`
and the shared `HoldToApprove` ceremony on revoke; the register anchors scroll with the
browser's own `scrollIntoView` (`auto` under `prefers-reduced-motion`), which is not a
house token because it is not a house gesture.

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
- ~~**G-C8 — declaring a server is not on this page.**~~ **CLOSED 2026-09-04 by
  the collapse.** Declaring, and revoking, are on this page:
  `HouseServerControls.tsx`, mounted under the model-context row. Both routes are
  `assertCanManageRestaurant` at the gateway (`mcp-connections.controller.ts:150`
  and `:203`), which is why they are the house's and belong here rather than on
  `/profile`. The credential field is disabled carrying the deployment's own
  reason when `MCP_CONNECTION_SECRET_KEY` is absent, and revoke is behind the
  seal because it destroys a stored credential and re-declaring does not undo it.
  *Still not here:* CHANGING a credential afterwards. `PUT /:id/secret` answers;
  what is missing is a button, and the declare panel says which.

- **G-C9 — nothing on this page (or anywhere) can add or remove a card, opened
  2026-09-04 by the collapse.** Register V left `/profile`, but
  `profile/next/StripeCardPanel.tsx` did not: it mounts Stripe's own iframes and
  is bound to that page's data hook (`ProfileNextData`) and UI kit (`pf-ui`), so
  moving it means moving both. The row therefore renders **Add a card** disabled
  saying *"the panel that mounts the provider's own card fields has not been
  rebuilt here yet, and it is no longer on /profile"*, and **Remove** disabled
  naming the provider's own dashboard. This is the one capability the collapse
  subtracted, and it is written here rather than left to be discovered.
  *Why not yet:* it is a ~400-line port into a directory another builder was live
  in, and it buys nothing today — `STRIPE_SECRET_KEY` is unset on this
  deployment, the create path 503s, and the control was already disabled carrying
  that sentence. It becomes urgent the day a key is set. Mirror: `profile.md`
  §9 G12a.

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

**Closed 2026-09-04 — G-C7, who says a tool is a write.** The gap was that
`mcp_tool_grants.writes` was a manager's answer to a question about a tool they
had never seen, frozen forever: the server's own `annotations.readOnlyHint` was
never stored, so nothing could be checked and a server that changed its
declaration changed nothing here. It is now stored per grant
(`declared_read`, `declared_annotations`, `tool_fingerprint`, `tool_list_hash`;
migration `20260904160000_the_server_declares_the_manager_confirms.sql`), the
declaration is the default a manager confirms, an unknown annotation counts as a
write, and a moved declaration suspends the grant with the change in words until
someone re-consents behind the seal. The rule, the spec citation and the two
independent reasons silence is a write are in the ADR 0107 addendum of
2026-09-04.

**Closed 2026-09-04 — G-C8, a seal that proved nothing.** ADR 0114 shipped
`sealed: true` as an assertion and said so; anything holding a manager's session
could spend the house's money by setting a boolean. It is now challenge and
redeem, bound four ways and single-use
(`20260904170000_a_seal_is_redeemed_not_asserted.sql`,
`mcp-connections.seal-redemption.spec.ts`). What it still does not prove is that
a human held the button — see the ADR addendum for exactly where that line now
sits and what moving it would cost.

**Still open here.** An annotation is the server's own word about itself. This
mechanism makes that word visible, checkable and re-confirmable; it does not
make it true, and no amount of storage would. A server that lies about
`readOnlyHint` is refused by nothing but the manager reading the tool's name —
which is why the override direction is one-way and why the seal stayed.

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
   gate is built and specced, and since 2026-09-04 so is the provable seal:
   `POST :id/tools/:tool/seal-challenge` mints the one-time token and
   `HoldToApprove` takes an `onChallenge` prop that requests it when the gesture
   begins. **Nothing on this page passes that prop yet**, because the page still
   has no control that calls a tool — the browser half of the seal is wired and
   unused, and is written here rather than implied to be live. Blocked on
   nothing but review of this surface.
2. ~~**Move Register IV/V/VI off `/profile` entirely**, leaving the pointer.~~
   **Done 2026-09-04** — the founder's call was *"Move the registers and collapse
   the four tabs."* Register V (how the house pays) and Register VI (the house)
   left whole; Register IV **split** along the gateway's own role gates — declare,
   probe, secret and revoke are `assertCanManageRestaurant` acts and moved
   (`HouseServerControls.tsx`), while `PUT /mcp-connections/:id/consent` has no
   role check (`mcp-connections.controller.ts:218-235`) and stayed, because this
   page is manager-only and a staff member would otherwise have lost the only
   place they could stop a server acting in their name. `/profile` keeps five
   registers and one line naming where each of the three went. See
   `profile.md` §1b, *Fifth pass, 2026-09-04*.
3. **A connection event log** — who attached, granted, revoked or cut off what,
   and when. §6b's cheapest absent item; `mcp_tool_calls` is one third of it.
4. **The house's own sender** (G-C5). Needs a domain, a DNS record and a
   provider decision — not a page.
5. **A last-used stamp on OAuth grants** (G-C6), so Register III can say what a
   personal grant actually did here.
6. ~~**Re-consent when a server's advertised tools change.**~~ **Built
   2026-09-04.** Every probe reconciles the live grants against the fresh list:
   a removed tool's grant is revoked, a changed annotation suspends the grant
   with the change in words, an added tool suspends nothing, and a failed probe
   changes nothing at all. `McpConnectionsService.reconcileGrants`, specced in
   `mcp-connections.tool-declaration.spec.ts`.
6b. ~~**Notify the house when a grant is suspended.**~~ **Built 2026-09-04**, on
   the founder's call ("yes, one notification per suspension"). It is NOT the
   single `persistForRestaurant` call this entry guessed at: it is the seventh
   member of the `/notifications` producer family,
   `apps/api-gateway/src/notifications/producers/grant-suspended.producer.ts`,
   which sweeps `mcp_tool_grants` for `needs_reconsent_at` every 15 minutes
   rather than emitting from inside `reconcileGrants` — an emit there has no
   tenant, no quiet-hours audience and no run row, and would lose every manager
   who was asleep when the probe ran. Dedupe `grant:<grantId>:<toolListHash>`
   writes a standing suspension once and says it again after a re-consent and a
   fresh change; recipients are this house's owners and managers only. Nothing
   on THIS page changed, and the producer is off until
   `NOTIFICATION_PRODUCERS_ENABLED` is set. The register row, the gaps and the
   one tool-list case it deliberately cannot report (an ADDED tool) are in
   [`notifications.md`](notifications.md) §11 and §13.30.
7. **Correct the unconnected row's permission bullets** (filed 2026-09-04 by the
   `gmail_send` build, which cannot touch `pages/**`). A third integration now
   exists — **Gmail, sending only**, one scope, `gmail.send`, declared in
   `apps/api-gateway/src/integrations/integrations-oauth.constants.ts` and served
   by `GET /integrations/oauth/catalog`. The row appears on this page for free,
   because Register III maps the catalogue rather than a hand-written list. Its
   **permission bullets do not**: `ConnectionsNext.tsx:964-968` (verified 2026-09-04 16:40; the file is moving, so grep `'Never mail, never other documents'`) hard-codes
   `"Create and edit files it made"` / `"Never mail, never other documents"` on
   every catalogue row, which is false for a sending grant and false in the exact
   direction this page exists to prevent — it tells a manager the connection
   cannot mail, next to a Connect button for a connection whose only power is to
   mail. The fix is to render `c.scopes` and `c.notRequested`, both already on the
   catalogue payload, instead of two literals; the patch is in the 2026-09-04
   session report. **Until it lands this row is wrong, not merely thin.**
8. **A house public page** (G-C2), if the founder wants one.
9. ~~**Retire `/settings`' `services` / `pos` / `email` / `calendar` tabs into
   this page.**~~ **Done 2026-09-04.** The four leave the contents column when
   `mudavym_design_connections` is on and one line — *"Connections — what acts for
   this house"* — replaces them; their `?tab=` links redirect to
   `/connections#grants|#till|#sender|#feed`, and this page answers those
   fragments (`REGISTER_ANCHORS` in `ConnectionsNext.tsx`, mapped by
   `CONNECTIONS_ANCHOR` in `settings/next/st-format.ts`). **Measured: fourteen
   registers become ten plus one line out.** §6b's counter-argument — that this
   page must reduce surface count rather than add to it — is now satisfied: one
   new route in exchange for four tabs and three registers. What is NOT done is
   deleting the four sections' code; it still renders with the flag off, and its
   retirement is gated on the flag reaching production (`settings.md` §13).
10. **Port the card panel** (G-C9 below) — the one thing the collapse subtracted.
