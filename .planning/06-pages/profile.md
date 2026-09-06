---
type: page
route: /profile
slug: profile
softwares: [auth-onboarding]
component: apps/web/src/pages/Profile.tsx
audience: owner
tier: core
archetype: form # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 2
maturity: partial
status: documented
updated: 2026-09-03
links: ["[[PAGE-CONTRACT]]", "[[login]]", "[[settings]]", "[[connections]]"]
---

# /profile

> **Part of** [[08-softwares/auth-onboarding|Auth & Onboarding]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

- **Save changes** → API `PATCH /api/v1/auth/me`
- **Change password** → API `POST /api/v1/auth/me/password`
- **Contact support** → external `mailto:` (VITE_SUPPORT_EMAIL, default support@wineops.ai)
- **Leave restaurant** → API `POST /api/v1/auth/me/leave-restaurant`
- **Delete account** → API `DELETE /api/v1/auth/me`, then [[login]] `/login`
- **Settings → Team** → [[settings]] `/settings?tab=team`
- **Settings** → [[settings]] `/settings`

**With `mudavym_design_connections` ON (the collapse, 2026-09-04).** Three registers
leave this page and one line names where each went:

- **Connections** (from the moved-registers line) → [[connections]] `/connections#payment`
- **Connections** (from Register IV, the consents) → [[connections]] `/connections#servers`
- **Settings** (from the moved-registers line) → [[settings]] `/settings?tab=locations`
- **Agree / Withdraw my agreement** → API `PUT /api/v1/mcp-connections/:id/consent`

## 1. Purpose
Personal account page for every role: Account (name/phone; email read-only), Security (change password), Linked accounts (Google link/unlink), Preferences (theme). Managers/owners additionally get Restaurant (name/city/billing contact), Payment, Memberships sections (`Profile.tsx:36-48`). Danger zone: leave the active restaurant, or delete the account behind a type-DELETE confirmation (`Profile.tsx:877-891`).

## 1a. Features
- Account: edit name and phone (email read-only)
- Security: change password
- Linked accounts: link/unlink Google
- Preferences: theme
- Managers/owners additionally: Restaurant details (name/city/billing contact), Payment, Memberships
- Danger zone: leave the active restaurant; delete your account behind a type-DELETE confirmation

**Added by the Mudavym redesign** (flag `mudavym_design_profile`; the legacy page above
is unchanged while it is off). Marked `dark` where the capability renders but nothing
behind it exists:

- **A ledger in seven numbered registers** — *Who you are* · *What protects this
  account* · *What is connected to you* · *Model context* · *How the house pays* ·
  *The house* · *Ruled off*. **Five, once `mudavym_design_connections` is on** — see
  *The collapse* below. **One row shape draws every ATTACHMENT**
  (`ConnectionRow`, `pf-ui.tsx`; fifteen call sites across Registers II-VI, 5 · 4 · 1 ·
  4 · 1, with no second row component on the page), so a row's state chip
  (`Connected` / `Not connected` / `Unavailable` / `Provider not connected` /
  `Not built` / `—`) plus whether its control is live or `disabled`-with-a-reason is the
  whole difference between a working connection and one with no backend — never the
  amount of design spent on it. Registers I and VII are deliberately **not** row-shaped:
  they are forms (`Card`), because a field you edit about yourself is a different kind of
  object from a thing that acts on your behalf
- Sign-in rail: password / Google / Microsoft as three peer methods, with the server's
  last-credential rule (`auth.service.ts:2043-2058`) **stated before the click** — Unlink
  is disabled, with the reason, when it would remove the only credential
- Sign-in rail: Microsoft `Connect` renders **disabled with its reason** (a gateway route
  exists, no button does — `lib/identityProviders.ts` `RENDERABLE_PROVIDER_IDS`). The
  shipping page's Microsoft "Connect" is a toast-only stub that looks like it worked
  (`Profile.tsx:256-268`)
- **Workspace rail (new to this page)** — Google Drive and Microsoft Excel from
  `GET /integrations/oauth/catalog` + `/connections`: real connect (via the existing
  `/authorize/:integrationId` consent screen), real disconnect, the granted scopes shown
  under "What you granted", and the server's `unavailableReason` on a deployment that
  cannot offer one
- **Security register (new, second pass)** — the register Stripe, Linear and Vercel all
  open on. **One session row built from evidence**: this browser's device (its own
  user-agent), the signed-in and expiry times read from the `iat`/`exp` claims of the JWT
  this tab holds, and a live "Sign out of this browser" (`POST /auth/logout`). Address is
  `—` because the browser cannot see what the gateway saw. **Four protections that do not
  exist render `Not built` with the measurement behind each claim and no toggle at all**:
  *Other devices* (the gateway keeps no session register — logout blacklists only the
  presented token, `auth/services/token-blacklist.service.ts`), *Two-factor*, *Passkeys*
  and *API tokens* (measured 2026-09-03: zero matches for `2fa`/`totp`/`mfa`/`passkey`/
  `webauthn` in `apps/api-gateway/src`, `apps/web/src`, `supabase/migrations`, and no
  user-issued token anywhere). Password lives here now rather than in Register I
- **Model context (MCP) register — REAL as of 2026-09-03, was `dark`.** A list model over
  a new gateway module (`apps/api-gateway/src/mcp-connections/`) and a new table
  (`user_mcp_connections`, migration `20260903094500`): name, endpoint, scopes granted,
  declared date, last call, status, and a working **Add** and **Revoke**, JWT-guarded and
  scoped to the user AND the restaurant on the token. Revoked rows are kept, marked revoked
- **Model context — the register CALLS, third pass the same day (was: every "Last call" an
  em dash).** `POST /mcp-connections/:id/probe` runs the Model Context Protocol lifecycle
  over the Streamable HTTP transport (`initialize` → `notifications/initialized` →
  `tools/list`, spec revision `2025-06-18`) from a new module
  (`apps/api-gateway/src/mcp-runtime/`, migration `20260903104500`), and the row records
  what answered: **status, the server's own name and version, the protocol it negotiated
  to, and the names of the tools it lists**. Both response shapes the spec makes mandatory
  are handled (`application/json` and `text/event-stream`), the server's `Mcp-Session-Id`
  is echoed on every later request, `MCP-Protocol-Version` carries the version the SERVER
  negotiated to rather than the one we asked for, and `tools/list` is **not sent at all**
  to a server whose handshake declared no `tools` capability — "it never offered a tool
  list" and "it offered an empty one" are different sentences on the row
- **Two timestamps, because a call and an answer are two facts.** *Last call*
  (`last_probe_at`) is stamped on every probe; *Last answered* (`last_used_at`) only on a
  handshake that completed, keeping the meaning `20260903094500` gave that column. A failed
  check leaves the previous answer where it was, so a server dead for a month cannot read
  as busy. A server nobody has checked carries an **em-dash chip** — not `Connected`, not
  `Not connected` — because a declaration is not a measurement
- **A per-connection credential: encrypted, refused, or absent — never plaintext.** Optional
  on the Add form and settable per row; AES-256-GCM under `MCP_CONNECTION_SECRET_KEY`
  (`mcp-runtime/mcp-secret.service.ts`). With no key **the gateway refuses the whole write
  with a 503 naming the variable** and the field renders disabled carrying the same
  sentence, so a NULL never means "stored, unencrypted". A key that is not exactly 32 bytes
  is refused rather than stretched. No route returns the value:
  `McpConnectionsService.ROW_COLUMNS` does not name `secret_encrypted`, so it is never
  fetched rather than filtered afterwards, and the row reports only `hasSecret` and the
  **date** it was set. Revoking destroys the credential rather than orphaning it
- **Tool INVOCATION is not built, and the row says it is a decision, not a gap.** No
  `tools/call`, no route that reaches one, no column for one, and a structural test
  asserting the runtime service has no `call`/`callTool`/`invoke` method. Calling a tool
  can send an email or place an order, which is ADR 0013's commitment guardrail — undecided
  for model-context dispatch. The sentence under a tool list comes from **the server**
  (`GET /mcp-connections/runtime` → `invocation: {enabled: false, reason}`), so the page
  states a rule rather than making a promise of its own
- **The gateway will not fetch a private address, and the address is PARSED rather than
  string-matched.** A probe makes the *server* fetch a URL a *user* typed, so
  `mcp-runtime/mcp-endpoint.guard.ts` resolves the host and vets every address it resolves
  to. It expands IPv6 to sixteen bytes (`parseIPv6`) and judges the bytes, because the first
  build tested for a mapped address with `ip.includes(".")` and **shipped a working
  bypass** — `URL` canonicalises `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]`, so the branch was
  dead code. Refused now: loopback, unspecified, link-local (`169.254.0.0/16` and
  `fe80::/10`), RFC1918, CGNAT, unique-local (`fc00::/7`), site-local, multicast,
  documentation and reserved space, plus every IPv6 family that carries an IPv4 address in
  its bytes — IPv4-mapped, IPv4-compatible, NAT64, 6to4 and Teredo, each decoded and
  re-checked rather than judged on its prefix. An address that will not parse is refused, not
  allowed. A URL carrying its own credentials is refused. `MCP_ALLOW_PRIVATE_ENDPOINTS=true`
  unlocks the private ranges for a developer, and every refusal names the variable
- **The vetted address is pinned into the socket, so DNS cannot be rebound.** `checkEndpoint`
  returns the address it approved and the transport hands it to `http.request`'s `lookup`
  hook: the connection goes to the address that was checked, and there is no second
  resolution for a hostile resolver to answer differently. This is why the transport is
  `node:http`/`node:https` and not `fetch` — `fetch` offers no way to say which address a
  name must resolve to. The hostname still goes in `Host` and in TLS SNI, so certificate
  validation is untouched. Redirects cannot be followed at all, so a bearer cannot be
  carried to a host the check never saw.
  Bounded besides: one 8s deadline across all three requests, a 256 KiB body ceiling
  enforced by reading the stream chunk-by-chunk rather than buffering it, and a tool cap
  that stores what the server **said** (`probe_tool_count`) beside what was kept, so a
  truncation cannot read as the whole catalogue
- **Payment register — the PROVIDER is built now (ADR 0110, third pass 2026-09-03).**
  Was: a table, a module, three routes and an Add form whose four fields
  (`brand`, `last4`, `exp`, kind) were typed BY HAND, with the submit disabled
  because `STRIPE_SECRET_KEY` was unset. That form is deleted, not disabled —
  it described a create path that would have turned one env var into an
  operator-typed instrument. What replaced it:
  - **A card is collected by Stripe's own iframes** against a SetupIntent
    (`POST /billing/setup-intent` → `StripeCardPanel` → `confirmSetup`). The
    number is typed on `js.stripe.com` and never reaches this page, this bundle
    or the gateway, which is the whole reason the product stays in PCI SAQ-A.
    Stripe.js is loaded from Stripe's host, not from npm: the official package
    injects the same script tag, and the app ships no CSP to allow it through
    (measured — no `<meta http-equiv>` in `index.html`, no CSP header in either
    `vercel.json`, no `helmet` in the gateway)
  - **Hold-to-approve is the commitment.** *Hold to put this card on file* is
    the second and only other place on `/profile` the seal is pressed — the page
    note's earlier claim that it appears "exactly once" is superseded, and §1b
    says why two is still a ration
  - **A row says how stale it is.** `synced_at` records when we last agreed with
    the provider; every other column is a cached copy of Stripe's answer, so a
    row that has never been confirmed says so instead of implying a present
    tense. **Reconcile now** (`POST /billing/sync`) re-reads the provider's list
    and DROPS instruments it no longer holds
  - **Charging is structurally impossible.** `StripeClient` throws before it can
    build a request to `payment_intents`, `charges`, `subscriptions`, `invoices`,
    `refunds`, `transfers`, `payouts` or `checkout/sessions`. Pricing is OD-23
    and open; the guard is the version of that promise that outlives the ADR
  - **A new row, "The provider", is the honesty seam made visible.** It names
    each of the three secrets and the process each lives in
    (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` on the gateway;
    `VITE_STRIPE_PUBLISHABLE_KEY` in the web bundle, which the gateway cannot
    see and so the page reports itself), the key's mode from its own prefix, the
    pinned API version, and **when a signed delivery last arrived**. A webhook
    secret that is set and has never had a delivery reads *"configured, never
    delivered"* — not as health. That is the single most expensive
    absence-as-health inversion this register can have: without deliveries a
    card removed at Stripe goes on showing here forever
  - **An instrument our vocabulary does not span is filed as `other`** with
    Stripe's own word printed beside it, never as a `card` it is not. `kind`
    gained the value and the migration proves the widened CHECK still rejects an
    unlisted one
  - Its chip is still **`Provider not connected`** when no key is set, a state
    of its own — reusing `Not built` would say the same word about a register
    with a table, a module, a provider client and six working routes as about a
    feature with zero code behind it
- **Plan is a figure, not a dash (was `—`).** `GET /organizations/locations/:id` now
  selects and returns `subscription_tier`. The shipping page prints `Plan: Free` from a
  hardcoded `useState('Free')` (`Profile.tsx:90`, rendered `:723`); this page prints what
  the column holds, and still `—` when the record was not read
- Honest read states for **all six** fetches: loading, error-in-words with a retry, and
  **permission-denied rendered rather than hidden** — a staff member sees the Restaurant
  record and Billing contact rows with one line saying who may read and change them. As of
  2026-09-03 that line states a **server** rule: `getLocation` calls
  `assertManagerOrOwner` now (G8 closed), so the page no longer has to describe a gap
  between the read posture and the write posture in order to stay honest
- The restaurant record **never falls back to the cached branch name**; on a failed read
  the fields stay empty and disabled and Save is refused, closing the page's only
  data-loss path (`Profile.tsx:143-146`)
- Phone is disabled and declared unknown when `GET /auth/me` fails, and a Save then
  leaves it untouched instead of writing a blank
- Support mailto degrades to a sentence when `VITE_SUPPORT_EMAIL` is unset, rather than a
  link to the dead `support@wineops.ai` (§7)
- Delete account is **hold-to-approve**, armed by the existing typed `DELETE`; the seal is
  pressed nowhere else on the page. The sole-owner refusal (`auth.service.ts:2132-2176`, throw at `:2149-2151`)
  is stated before the act

- **"The house may text me at this number"** *(ADR 0121, 2026-09-05)*. A row in
  **Register IV**, not a seventh register: retire-to-write applies to surfaces
  as well as documents, and ADR 0114's whole justification was a surface count
  that FELL. Register IV already answers exactly one question — what has *this
  person* agreed to, which nobody else may agree to for them — and a number the
  house may reach you at is that question with a different object; its lead is
  widened to name both. The row **never pre-fills the number from the profile**:
  an account phone and a number somebody is willing to be texted at are
  different facts, and pre-filling one as the other collects a consent for an
  address that was never chosen. Withdrawing is the person's alone and is a
  **timestamp, never a delete** — a revocation that leaves no trace cannot be
  honoured, and 47 CFR 64.1200(d)(3)/(d)(6) require it recorded and kept for
  five years. It never claims the text will arrive: with no house sender the row
  says agreeing changes nothing today and is recorded for the day it does.

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_profile`)

> **Chrome (2026-09-04).** With the flag on, this page is framed by the house
> header — `apps/web/src/components/mudavym/HouseHeader.tsx`, mounted by
> `PageGate` above every `next` tree: the A+M mark, this page's name, the ⌘K
> "Search or act" trigger, the house (or the branch switcher when there is more
> than one), the bell, the theme menu and the account menu. Chrome is excluded
> from §Surface by PAGE-CONTRACT, so it is named here and nowhere else in this
> note; its motions live in `components/mudavym/MOTIONS.md`, not the table
> below.

Canonical copy: `apps/web/src/pages/profile/next/MOTIONS.md`. Every motion is a token
from `apps/web/src/lib/mudavym/motion.ts`.

| id | token | curve · ms | fires |
|---|---|---|---|
| `pf-open` | `settle` | `cubic-bezier(.16,1,.3,1)` · 320ms | the opening block — wordmark, role/location line, the name in Fraunces, the standing sentence — once on mount; opacity + 6px rise via `animate()` |
| `pf-expand` | `settle` | `cubic-bezier(.16,1,.3,1)` · 320ms | a connection row's panel: "What you granted" / "What it would ask for" (Workspace), "Scopes, tools and dates" (a model-context server — opened for you when a check comes back, so the answer is where you are already looking), "Show the working" (the session row). CSS `grid-template-rows: 0fr → 1fr` (053's row-expand, the founder's named favourite) |
| `pf-ink` | `ink` | `cubic-bezier(.16,1,.3,1)` · 160ms | hover/focus on rows, buttons and membership entries — border and ground only; nothing translates or scales |
| `pf-pour` | `pour` | `linear` · 620ms | the İznik fill under **Hold to delete this account** (Register VII), **Hold to put this card on file** (Register V, from 2026-09-03) and **Charge this first** / **Remove** on every instrument row (Register V, from 2026-09-04), all inside `HoldToApprove`; an early release retreats on `tuck` (spring 380/32, ~300ms) and says what did not happen |
| `pf-stamp` | `stamp` | sampled spring 500/26 (~11% overshoot) · 360ms | the seal landing when any of those holds completes — the only overshoot on the page, and now **four** places the seal is pressed. The ration was not loosened; the gateway moved: since ADR 0110's addendum the two payment-row acts REDEEM a one-time seal, so the die appears exactly where a server redeems one, plus the single irreversible act that has no server to ask |

Deliberate non-motions: no stagger or arrival (an account page is a reference, not an
event); no tally (the plan became a figure on 2026-09-03 and still does not animate — it
is a label read once, not a total that moved); no skeleton sheen (loading is stated in
words, so a moving bar would make "in flight" and "failed" look alike again); chips do not
transition; the two forms that open ("Add a server", "Add a card") swap in with no
transition — a panel that cannot store anything must not arrive with a flourish that would
be the only part of it that worked; Stripe's own card fields are iframes and are not
animated by this page at all, only given a palette read off the live `.mudavym` root;
"Reconcile now" gets a label change and no spinner, because a spinner would make waiting
look like progress while the outcome is words; a revoked model-context server is not animated away,
because that is the visual form of the thing the soft revoke exists to prevent; the
reversible exit ("Leave restaurant") arms with a label change and no motion at all.
`prefers-reduced-motion` collapses `pf-open` to its end state via `animate()`, disables
the two CSS transitions in `PF_CSS`, and swaps the timed hold for a two-step confirm.

### Design used, and why

**The verdict** (`MAKEOVER-VERDICTS.md:216`): *"Let's make this a lot cooler."* The
redesign is acceptable but thin; must include **MCPs** as a first-class section,
**linked accounts** *"to be cooler than this, not just like that"*, and **payments** —
*"we should be able to add the payment here"*, Stripe or comparable.

**The structure that enforces it.** The shipping page is eight boxes down a scroll-spy
rail, each a different shape, and the two sections with no backend are drawn exactly like
the six with one. The rebuild is a ledger in four registers — *Who you are*, *What is
connected to you*, *The house*, *Ruled off* — and all three of the founder's additions
land inside **one** register on **one** row shape, next to the connections that already
work. That is the single structural idea: **one component draws every row, and what
changes between a live Google link and an MCP server with no backend is its state chip
and whether its control is a live link or a disabled one carrying its reason.** A section cannot
flatter itself by being drawn richer than its evidence, and the reader can compare a real
connection with an unbuilt one at a glance instead of taking a "coming soon" box on
trust. It also makes "cooler" mean something other than more chrome: the page now answers
one question — *what is attached to me, and is it actually working?*

**Honesty rules applied** (ADR 0020 / the absence-reported-as-health rule):

- both silently-swallowed reads (`Profile.tsx:110-118`, `:143-146`) are first-class query
  states with an error branch that names the register that failed and offers a retry;
- **the only data-loss path on the page is closed**: the restaurant record has no cache
  fallback at all, so an unread record leaves the fields empty and disabled and
  `saveRestaurant` refuses outright — a value nobody read cannot become a write;
- the plan renders `—`, not `Free`. The column exists (`restaurants.subscription_tier`,
  `baseline_from_production.sql:3582`, default `pilot`) and is read only by the model-spend
  ceiling (`common/model-client/model-client.service.ts:565-577`); no browser-reachable
  endpoint returns it (`organizations.service.ts:137-152` selects `id, name, city, email,
  phone`). Unknown, therefore a dash;
- an **empty** connections array from `GET /integrations/oauth/connections` is read as
  *"the register could not be read"*, not as *"nothing connected"* — that endpoint returns
  one row per catalogued integration on success and a bare `[]` on a swallowed query error
  (`integrations-oauth.service.ts:485-488`);
- permission-denied is rendered, not hidden: staff see the Restaurant record and Billing
  contact rows with one line naming who may change them, and a 403 from the PATCH has its
  own message. That line was corrected after audit (2026-09-02) to say the *page* declines
  to fetch the record: the write really is manager/owner
  (`organizations.service.ts:178-187`), but the read is open to any member of the
  organisation (`:123-153`), and claiming otherwise would be the same class of untruth
  this page exists to remove — see G8;
- every control whose backend does not exist is a `disabled` element carrying its reason
  in words. There is no Connect on this page that can appear to succeed.

**Two alternatives considered and not built** (the founder decides after seeing this one):

1. **MCP and Payments as their own top-level registers**, each with a full disabled form
   (server URL field, card field, plan picker). It reads as more "first-class" at a
   glance and it is what "make it cooler" most obviously suggests — but a full dead form
   is exactly the shape ADR 0020 exists to stop: it looks like something you can fill in.
   Rejected in favour of one row plus an expandable *shape*, which shows what is coming
   without pretending it is here. **If the founder wants the bigger gesture, this is the
   fork to reverse** — the rails are already separate components.
2. **Fetching the declared provider registry from `POST /auth/sign-in-methods`**, which
   would give the Sign-in rail the server's own labels, `enabled` flags and
   `disabledReason` strings for Google, Microsoft *and* Apple instead of page prose. It is
   the more honest source — but that route is `@Public()` and rate-limited to 10 requests
   per 600s keyed **by IP** when unauthenticated (`auth.controller.ts:487-491`,
   `rate-limit.guard.ts:246-271`), so a restaurant behind one NAT would lock its own staff
   out of their profile page. Rejected on that measurement; the rail uses the
   authenticated `GET /auth/me` for linked state and states Microsoft's reason in prose.
   An authenticated `GET /auth/me/sign-in-methods` would make alternative 2 correct — §13.

**Substituted or left out, and why:**

- **The scroll-spy left rail is gone.** It indexed eight boxes; four named registers on a
  860px measure do the same job without a second navigation model to maintain.
- **The "Upgrade / Coming soon" block is gone**, absorbed into the Payment rail's plan
  row, which is more honest than a disabled button with no subject.
- **The active-restaurant `<select>` in Preferences is gone** — it duplicated the
  Memberships switcher, which now carries it alone.
- **Google's own GSI button is used unstyled.** It is Google-rendered and cannot be
  restyled; it is the only real token-acquisition path and a house-styled fake would be
  worse than a foreign-looking real one.
- **No toasts.** Every outcome is a settled `role="status"` line next to the control that
  caused it, so a failure cannot scroll away unread.
- **Size**: 2,111 non-blank lines across 8 source files, against the p4 brief's ~900
  guidance (the richest built page, `dashboard/next`, is 1,493). Called out rather than
  hidden: this page carries four registers, twelve rows, six forms and nine write paths,
  each with four read states, and is already split into components. A further pass would
  move the repeated inline text styles into a page stylesheet the way `dashboard-next.css`
  does; it was not done.

### Second pass, 2026-09-03

**What the founder asked.** *"/profile looks okay. Make sure it is almost identical to the
ones startups with $100B+ valuations have — a tech startup or kitchen startup — so add MCP
servers as well, payment types as well, we're going to need those."*

Pass one was honest about three absences and the founder read the honest dashes as holes.
This pass built the things.

**What was built.**

| | Was (2026-09-02) | Is (2026-09-03) |
|---|---|---|
| **Model context** | one `Not built` row plus an expandable "shape"; zero matches for `mcp` anywhere in the repo | **Register IV.** Real list / add / revoke over a new gateway module and a new table. `McpRegister.tsx` |
| **Payment types** | one `Not built` row plus a "shape" | **Register V.** Real table and routes; the Add form opens and its submit is disabled with the provider's stated reason. `PaymentRegister.tsx` |
| **Security** | one card inside Register I (change password only) | **Register II.** Password + one evidence-built session row + four `Not built` protections, each with its measurement. `SecurityRegister.tsx` |
| **Plan** | `—` (the column existed, no endpoint returned it) | a figure, read from `subscription_tier` |
| **The location read** | no role check; the page's copy had to say the *page* was withholding it | `assertManagerOrOwner` runs on the read too; the copy states a server rule |

**What was fixed in the gateway** (all outside `apps/web`, all with specs):

- `apps/api-gateway/src/organizations/organizations.service.ts` — `getLocation` now calls
  `assertManagerOrOwner(userId, restaurantId, "read the restaurant record")` **after** the
  restaurant lookup (so a restaurant outside the org stays a 404 rather than leaking its
  existence through a 403), and selects + returns `subscription_tier`.
  `assertManagerOrOwner` gained an `action` parameter so a refused GET does not carry the
  write's message, and a public `assertCanManageRestaurant` wrapper so the payment module
  reuses the one tested implementation of the rule instead of copying it. Spec:
  `organizations/get-location-is-role-gated.spec.ts` (7 tests, both role-lookup paths, the
  404-before-403 ordering, and the raw-`null` plan).
- `apps/api-gateway/src/mcp-connections/**` — **new module.** `GET` / `POST` / `DELETE`,
  `JwtAuthGuard` on the controller, user id AND restaurant id taken from the signed token
  and never from a parameter. The read **throws** on a query error rather than returning
  `[]` — deliberately not repeating `integrations-oauth.service.ts:485-488`, the shape
  that forces this page's Workspace rail to infer a failure from an empty answer (G3).
  Specs: `mcp-connections.service.spec.ts` (10), `mcp-connections.controller.spec.ts` (8,
  shared with payments).
- `apps/api-gateway/src/payment-methods/**` — **new module.** `GET` (open to any member
  with a tenant on the token) / `POST` / `DELETE` (both behind
  `assertCanManageRestaurant`). `GET` returns the **provider's state beside the rows**, so
  an empty register can say which kind of empty it is. `POST` refuses with 503 and the
  reason while `STRIPE_SECRET_KEY` is unset — it does **not** insert what the caller typed,
  because a row that looks exactly like a chargeable instrument and is not one is a
  fabricated record. Spec: `payment-methods.service.spec.ts` (9), including "writes
  nothing when it refuses" and "carries no PAN/CVC/address field into the row".
- `supabase/migrations/20260903094500_user_mcp_connections.sql` — table, indexes, RLS on,
  service-role policy, `anon`/`authenticated` revoked, and a `DO` block asserting all four
  plus that `last_used_at` is **nullable** (a NOT NULL there would force every insert to
  invent a call that never happened).
- `supabase/migrations/20260903094600_payment_methods.sql` — same lockdown shape, plus a
  `last4 CHECK (~ '^[0-9]{4}$')` PAN guard that the migration's own `DO` block **proves
  fires** by attempting a 16-digit insert and requiring the rejection.
- `apps/api-gateway/src/app.module.ts` — the two new modules registered (two import lines,
  two entries). The only shared-file change.

**The structural idea, unchanged and now carrying more weight.** One component
(`ConnectionRow`) still draws every row in all seven registers. That was easy to honour
when four rows were dark; it is the real test now that two registers went live and four
security rows stayed dark, because the live and the dark rows sit in the same shape on the
same page. What separates them is the state chip and whether the control is live or
`disabled` carrying its reason — never the design spent on it.

**Honesty rules applied to the new work.**

- **An empty register always says which kind of empty it is.** The MCP register
  distinguishes "reporting nothing" from "failing to answer" in two different sentences.
  The payment register gets its sentence from the **server** (`provider.connected` +
  `reason`), because "no cards on file" and "no provider is connected, so no card can
  exist" are the same empty array on the wire and the same screen in any UI that counts
  rows.
- **A declaration is not traffic.** Every MCP row's "Last call" is `—`, the column is
  nullable rather than defaulted to `created_at`, and the register's lead says in one line
  that nothing dispatches to these servers yet. A `last_used_at` quietly defaulted at
  insert would have been the absence-reported-as-health fault in a single column.
- **No fake toggles, and no fake success.** Four security rows are `disabled` buttons with
  the measurement behind each claim; the payment form's submit is `disabled` with the
  provider's own sentence; and the gateway refuses the same write for the same reason, so
  there is no path — through the UI or around it — that can appear to succeed.
- **A revoked grant stays visible.** Soft revoke on `user_mcp_connections`, and the row
  remains on the register marked revoked, so a grant that once existed does not become
  indistinguishable from one that never did.
- **The session row is evidence or nothing.** Device from this browser's own user-agent
  (`describeDevice` matches or returns `null`; it never guesses "Windows" from an
  unmatched string), times from the JWT's signed `iat`/`exp`, address `—` because the
  browser cannot see what the gateway saw. An undecodable token renders `unknown`, not
  "signed out".

**Two alternatives considered and not built** (the founder decides after seeing this one):

1. ~~**Connect the MCP server, not just declare it.**~~ **BUILT the same day — see “Third pass … the model-context register calls” below, and ADR 0107. The paragraph is kept unstruck below because its reasoning is what the third pass had to answer: the first reason turned out to be wrong (the handshake is a published spec, not a fork) and the second was right and is why the credential arrived with the code path rather than before it.** The obvious next move is a handshake:
   call the endpoint on save, list the tools it actually exposes, and store a credential.
   Not built, and the table deliberately has no token column. Two reasons: the handshake is
   an undecided fork (which transports, whose credential, what happens when a server the
   house trusts starts exposing a new tool), and storing a secret for a code path that does
   not exist yet is the worse half of a half-built feature. **If the founder wants it, this
   is the fork to open** — the table takes a nullable credential column and the service
   takes a `verify()` without touching the page.
2. **Stripe Checkout in a hosted redirect, wired now.** Everything except the credential is
   built, so this is one env var and one callback away. Not done because the pricing that
   would be charged is founder-deferred (OD-23, and `common/model-client/spend-tiers.ts:1-22`
   says its own figures are placeholders that must not be cited as pricing) — connecting a
   provider before there is a price is a payment surface that can take money for nothing.
   The refusal is one `assertProviderConnected` call, so switching it on is a decision, not
   a build.

**Substituted or left out, and why:**

- **No "sessions" list, and no empty devices table.** Every competitor shows one. Building
  it needs a session table the gateway does not have; an empty table would claim you are
  signed in nowhere else, which nothing in this product knows. One row and one sentence
  instead.
- **No plan MANAGEMENT.** The plan is shown because the restaurant is on one and it already
  decides something real (the model-spend ceiling). An upgrade button on a *personal*
  profile is the shape DESIGN-FOUNDATION §6 explicitly tells us to refuse.
- **No raw MCP config editor** (§6: "our users are not developers"). Three fields, and the
  transport is fixed to http(s) — a local `command:` transport would run a process on our
  servers, which is a decision rather than a text box.
- **Icons, not emoji.** Seven `lucide-react` glyphs, one per register eyebrow, in ink
  (`var(--seal-deep)` on the eyebrow, `var(--ink-3)` on a rail). Never on a chip: an icon
  here is a finding aid down a long ledger, not a status, and a coloured one would compete
  with the state chips for meaning. `grep -nP "[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]" -r`
  over the directory, the two new gateway modules and the two migrations: **empty**.
- **Size, disclosed rather than hidden**: 3,258 non-blank lines across 11 source files
  (~550 of them comment lines), against the p4 brief's ~900 guidance. Pass one was 2,115 across
  8. Seven registers, nineteen rows, eight forms and twelve write paths, each with four
  read states. It is split into components; the further pass that would actually shrink it
  is moving the repeated inline text styles into a page stylesheet the way
  `dashboard-next.css` does, and it was not done.

**What could not be verified, stated plainly (§0.5).**

- **Curled against the live gateway on `:4000` — measured, not predicted.** An earlier
  draft of this section claimed the curl "could not run" because `:4000` was refusing
  connections while the gateway changes were being written. It is listening
  (`GET /api/v1/health/live` → 200), so that claim is **struck** and replaced with the
  measurements. Session minted with `POST /auth/dev-bypass-login` + `X-Dev-Bypass`; the
  database has not taken the two new migrations, which is what makes the first four
  interesting:

  | Request | Status | Body |
  |---|---|---|
  | `GET /mcp-connections` | **500** | `The model-context register could not be read: Could not find the table 'public.user_mcp_connections' in the schema cache` |
  | `POST /mcp-connections` (valid) | **500** | `The model-context server was not added: Could not find the table …` |
  | `GET /payment-methods` | **500** | `The payment register could not be read: Could not find the table 'public.payment_methods' …` |
  | `POST /payment-methods` (valid body) | **503** | `Stripe is not connected — no provider credential is configured …` |
  | `POST /payment-methods` with `pan` + `cvc` | **400** | `["property pan should not exist","property cvc should not exist"]` |
  | `POST /mcp-connections`, `url: ftp://…` | **400** | `["url must be a URL address"]` |
  | `GET /mcp-connections`, no bearer | **401** | `Unauthorized` |

  Four things are proven there rather than asserted. The reads **name the failure** instead
  of returning `[]` — the whole point of not repeating `integrations-oauth.service.ts:485-488`.
  The payment `POST` returns **503 before it touches the database at all**, which is why it
  is the one route unaffected by the missing table: it refuses before it reads or writes.
  The `whitelist: true` pipe means a PAN or CVC cannot even reach the service. And the guard
  is on: no bearer, no register.
- ~~**The Nest boot guard could not be run whole.**~~ **SUPERSEDED 2026-09-03 (third pass): the unrelated `AnalyticsModule` defect was fixed by another session and `scripts/check_gateway_boots.sh` now returns PASS on this worktree. The substitution below was correct when written and is no longer needed.** `scripts/check_gateway_boots.sh` fails on
  this worktree for an unrelated in-flight change — `AnalyticsModule` cannot resolve
  `DayExclusionsService`. **Substituted, not skipped:**
  `mcp-connections.controller.spec.ts` compiles both new module graphs on their own
  (`Test.createTestingModule({ imports: [ModelClientModule, <module>] })`), which is exactly
  the class of defect the boot guard exists to catch — a controller with
  `@UseGuards(JwtAuthGuard)` whose module forgot `AuthModule` — scoped to the code this
  pass added. Both resolve, and the live curls above are the end-to-end confirmation the
  guard would have given.
- **No screenshot.** No dev server was running and the brief forbids starting one. Both
  grounds are argued from the tokens rather than seen: `grep -rnE "#[0-9A-Fa-f]{6}"` over
  the directory is **empty**, so every ground, ink and seal is a variable that the
  `.dark .mudavym` block re-defines.
- **The migrations have not been applied anywhere.** They are new files in
  `supabase/migrations/`; they apply on merge. So the two new registers will render their
  honest error state ("the register could not be read") against a database that has not
  taken them yet — which is the correct behaviour, and is what the error branches are for.
- ~~**A migration version collision was found in this worktree and half-resolved.**~~
  **STRUCK 2026-09-03 — the second half of that claim was already false when it was
  written.** What was true: three sessions on `feat/mudavym-design-p4` each picked
  `20260903090000`, `supabase_migrations.schema_migrations` keys on that prefix, and two
  files sharing it make the second INSERT violate the primary key so `supabase db reset`
  dies partway through — the failure `scripts/_migration_versions.py` was written for after
  it happened on 2026-08-25. This page's two moved to `20260903094500` / `20260903094600`.
  What was **not** true: that the other two files still collided. They had already been
  renamed to `20260903091000_days_the_engine_must_not_count.sql` and
  `20260903092000_restaurant_cellar_registers.sql` before this note was saved, and the
  claim was written from a `git status` snapshot rather than re-measured. Re-measured now:
  `ls supabase/migrations | cut -c1-14 | sort | uniq -d` → **empty**, and
  `python3 scripts/_migration_versions.py` prints nothing: **zero collisions in the whole
  directory**. Kept struck rather than deleted, because the lesson is the one this page is
  about — a claim about state outside your own paths has to be re-measured at the moment
  you write it down, not carried forward from when you first saw it.


### Third pass, 2026-09-03 — Stripe as the live payment provider (Register V only)

**What the founder asked.** *"Stripe as the live payment provider … with
`STRIPE_SECRET_KEY` set: create a SetupIntent, confirm on the client via
Stripe.js, store `provider_ref` (never a PAN), list/detach; without the key
everything renders and submit is disabled with the reason. Webhook endpoint with
signature verification and idempotency. No charges — the build stops at 'a card
on file'."*

**The first thing this pass found was that its own predecessor's gap note was
wrong.** G10 read *"Everything except the credential is built."* Measured on
this branch before writing any code:

| G10's claim | measured 2026-09-03 |
|---|---|
| a provider client exists | **no** — `grep -ril stripe apps/api-gateway/src` matched three files, all in `payment-methods/`, all prose or the literal `'stripe'`; zero HTTP calls to any provider |
| a webhook exists | **no** — the only signed webhooks in the repo were Toast and pos-hub (`pos-hub.controller.ts:72-115`) |
| the `pm_...` reference was obtainable | **no** — nothing minted a SetupIntent, so `CreatePaymentMethodDto.providerRef` was a required field no caller in this product could fill |
| `stripe` / `@stripe/stripe-js` installed | **no** — absent from both `package.json` files |

So setting `STRIPE_SECRET_KEY` on the pre-existing tree would not have switched
the register on. It would have enabled an Add form whose four hand-typed fields
(`brand`, `last4`, `exp`, kind) became the register's content — a row that
renders as `Visa ••••4242` and can never be charged. **The honest refusal was
one environment variable from a fabricated record.** That is why the form is
deleted rather than kept and disabled.

**What was built** (ADR `0110-a-card-on-file-is-the-providers-record-not-ours.md`):

| | Was (second pass) | Is (third pass) |
|---|---|---|
| **Collecting a card** | four fields typed by hand, submit disabled | Stripe Elements against a SetupIntent, on Stripe's origin. `components/mudavym/StripeCardPanel.tsx`, `components/mudavym/stripe-js.ts` (both moved out of this directory 2026-09-05 and shared with `/connections`) |
| **The commitment** | a disabled `Save payment method` button | `HoldToApprove` — *Hold to put this card on file*. The second and only other seal on the page |
| **Provider state** | one boolean + one sentence | each of three secrets named with the process it lives in, the key's mode from its own prefix, the pinned API version, and **when a signed delivery last arrived** |
| **Freshness** | nothing | `synced_at` per row, plus **Reconcile now** which also DROPS what the provider no longer holds |
| **Removal** | deleted our row | detaches at the provider FIRST, then deletes — otherwise the next reconcile faithfully restores it and the delete silently undoes itself |
| **Default instrument** | not offered | `PATCH /payment-methods/:id/default`, written at the provider before the local flag |
| **Stripe's own account of change** | nothing | `POST /billing/webhook`, HMAC over the exact request bytes, idempotent on the event id |

**What was built in the gateway** (all with specs; `pnpm --filter
@wineops/api-gateway exec tsc --noEmit -p tsconfig.spec.json` clean):

- `apps/api-gateway/src/billing/**` — **new module.** `stripe-signature.ts` (a
  pure verifier: exact bytes, constant-time compare, five-minute replay window,
  fails closed with no secret), `stripe.client.ts` (four calls over the `axios`
  already installed, `Stripe-Version` pinned, `Idempotency-Key` on every POST,
  and a `FORBIDDEN_PATHS` guard that throws before building a request to any
  money-moving resource), `stripe-config.service.ts` (the provider state,
  including the delivery evidence), `billing-customer.service.ts`,
  `payment-method-mirror.service.ts` (the provider→row mapping, pure and static
  so the place a fabricated value would enter is testable without a database),
  `billing.service.ts`, `billing.controller.ts`. Specs: `stripe-signature.spec.ts`
  (12), `stripe.client.spec.ts` (14), `payment-method-mirror.service.spec.ts` (8),
  `billing.service.spec.ts` (18, five of them added after an audit found the
  apply-failure retry path uncovered) — **52 new gateway tests**, all green.
- `apps/api-gateway/src/billing/billing-config.module.ts` — the primitives live
  in their own module so `PaymentMethodsModule` and `BillingModule` can both use
  them **without a cycle**. A cycle there takes down the whole Nest injector at
  boot, which is the failure `check_gateway_boots.sh` exists to catch.
- `apps/api-gateway/src/payment-methods/**` — `remove` detaches at the provider
  first; `setDefault` is new and writes at the provider first; `list` now returns
  the richer provider state and three new row fields; `providerState` delegates
  to the one `StripeConfigService` the billing routes use, so there is a single
  implementation of "is the provider connected". Spec rewritten (13, up from 9), and two of
  its assertions are about ORDER rather than about calls, because the ordering is
  the whole correctness argument.
- `supabase/migrations/20260903110000_billing_stripe_provider.sql` —
  `billing_customers` (unique per restaurant **per key mode**, so a test customer
  is never reused under a live key), `billing_webhook_events` (the provider's
  event id as the PRIMARY KEY, `outcome` NOT NULL so an ignored event is recorded
  as ignored with its reason), and three columns on `payment_methods`
  (`provider_type`, `synced_at`, `livemode`) plus a widened `kind` CHECK. Its
  `DO` block proves the widened CHECK still rejects an unlisted value, that the
  PAN guard from `20260903094600` is still armed after the `ALTER`, that
  `synced_at` is NULLABLE (a `NOT NULL DEFAULT now()` would make every row claim
  a confirmation that never happened), and that a duplicate event id is actually
  rejected.

**The idempotency half that is usually got wrong.** A claim row is written before
the event is applied, so a redelivery cannot double-apply. But a delivery that
was claimed and then failed halfway must still be retryable, or a transient
database error permanently swallows the event that tells us a card was removed.
So the claim records `handled`, and a redelivery of an event whose row says
`handled = false` is **processed**; only a completed event is ignored. Both
halves are asserted (`billing.service.spec.ts`).

**Honesty rules applied to the new work.**

- **A secret that is set is not a seam that works.** The provider row prints when
  a signed delivery last arrived, and never is never — in words, on the row.
- **A cached copy says when it was cached.** Every column except `provider_ref`
  is Stripe's answer at a moment; the row prints that moment rather than
  asserting a present tense.
- **A vocabulary mismatch is not resolved by guessing.** An instrument whose
  Stripe type our four kinds do not span is `other` with the provider's own word
  shown, never a `card` it is not.
- **An ignored webhook is recorded as ignored.** `billing_webhook_events.outcome`
  is NOT NULL; a delivery log holding only the events we acted on would report
  absence as health.
- **The refusal is by NAME.** "Stripe is not connected" became
  "`STRIPE_SECRET_KEY` is not set on the gateway" / "`VITE_STRIPE_PUBLISHABLE_KEY`
  is not set in this web bundle", because three secrets in two processes can be
  missing and one sentence told the operator nothing about which.

**The two directions considered and not built** (the founder decides after seeing
the page):

1. **Stripe's hosted Billing Portal instead of Elements.** One redirect, almost
   no code, and Stripe maintains it. Not built because it is a second visual
   language dropped into the middle of a page whose whole argument is one row
   shape, and because the portal's furniture is priced — it shows plans and
   invoices this product has neither of (OD-23).
2. **A `payment_events` audit trail per instrument** (added / made default /
   detached, with who and when), rendered as a small ledger under each row. Not
   built because the provider is already the system of record for an instrument's
   life and a second, unverifiable copy is exactly what the original migration
   refused when it declined a `revoked_at`. It becomes worth building the day a
   charge exists to attribute.

**What was NOT verified, stated plainly (§0.5).** The Elements mount and
`confirmSetup` were never exercised in a live browser. Both require a real
Stripe test key, `VITE_STRIPE_PUBLISHABLE_KEY` is baked into the bundle at
dev-server start, and this session may not restart the dev server — so the
furthest a browser got is the panel with its hold disabled and the missing
variable named. Everything up to that line
IS verified: the gateway's refusal by curl (503 with the reason), the whole
signature/idempotency path by 13 service tests against real HMACs, the
provider→row mapping by 8, the transport guard by 14, and both register states
rendered in both grounds with the one `GET /payment-methods` response stubbed at
the route (the `payment_methods` table is not in the dev database — its
migration is on this branch, unmerged — so the live page correctly renders the
error state and that hides the other three). **Those captures are session
scratch, not repository artifacts**: they live under the builder's scratchpad
(`payA-nokey-light.png`, `payA-live-light.png`, `payA-live-dark.png`,
`payA-light.png`) and no image file was added to `.planning/` by this build, so
nothing in the repo can be re-read to check that sentence — it is a claim about
work done, not a citation.

The **apply-failure retry path** — the one thing an audit found untested on
2026-09-03 — is now covered by five cases in `billing.service.spec.ts`
(`BillingService — an apply that FAILS is retryable, not lost`) and
mutation-proven: swallowing the rethrow fails 4 of them, settling the receipt
`handled: true` fails 4, and skipping the settle entirely fails 2.

**What is deliberately still not built.** Any charge. There is no
`payment_intents` call, no invoice, no subscription and no price, and the client
throws rather than letting one be added by accident. Pricing is OD-23 and
founder-deferred; a product that can take money before it has a price is the
surface `DESIGN-FOUNDATION` §6 tells us to refuse.

### Third pass, 2026-09-03 — the model-context register calls

**What the founder asked.** *"first small fixes, and then everything left including the
four large builds — make them elegant and pretty looking."* Build **D** of four: the MCP
runtime.

**What the second pass left, in its own words.** Its "Two alternatives considered and not
built" listed, first: *"Connect the MCP server, not just declare it … call the endpoint on
save, list the tools it actually exposes, and store a credential. Not built, and the table
deliberately has no token column."* Its two reasons were the handshake being an undecided
fork and a secret with no code path. The first turned out not to be a fork at all — the
Model Context Protocol publishes the transport, revision `2025-06-18` — and the second is
answered by building the code path first. So this pass built it, and **left the actually
undecided fork undecided**: invocation.

**What was built.**

| | Was (second pass) | Is (third pass) |
|---|---|---|
| **Last call** | `—` on every row, permanently, with a sentence explaining why | `last_probe_at`, stamped by a real handshake — beside a **second** column `last_used_at` ("Last answered"), moved only when the server answers |
| **Status** | the GRANT's state only (`active` / `revoked`) | that, plus a five-member `probe_status` (`ok` / `unreachable` / `refused` / `protocol_error` / `unconfigured`), **nullable with no default**, and the server's own words in `probe_detail` |
| **Tools** | not a concept | `tools/list` names on the row, capped, with `probe_tool_count` recording what the server *said* |
| **Credential** | "the table deliberately has no token column" | `secret_encrypted`, AES-256-GCM under `MCP_CONNECTION_SECRET_KEY`, never selected by any read path, destroyed on revoke |
| **Invocation** | not discussed | **explicitly refused**, in the gateway's own sentence, with a structural test that no invocation method exists |

**What was built in the gateway** (all with specs):

- `apps/api-gateway/src/mcp-runtime/` — **new module**, no database dependency, imported by
  `McpConnectionsModule` rather than registered in `AppModule` (nothing else speaks MCP,
  and a wire client registered globally for one consumer is how a capability becomes
  ambient before anyone decides it should be). **`app.module.ts` is unchanged.**
  - `mcp-runtime.service.ts` — the lifecycle, both response encodings, the session-id echo,
    the negotiated-version header, the whole-probe deadline, the chunk-by-chunk byte
    ceiling, and `redirect: "manual"`. Every failure is a *classified outcome*; `probe()`
    does not throw.
  - `mcp-endpoint.guard.ts` — resolve-then-vet, so the server will not fetch loopback,
    link-local, RFC1918, CGNAT, unique-local or IPv4-mapped-private addresses.
  - `mcp-secret.service.ts` — AES-256-GCM in the same `v1.iv.tag.ciphertext` envelope as
    `common/crypto/token-crypto.service.ts`, under its **own** variable with no fallback.
- `apps/api-gateway/src/mcp-connections/` — `POST /:id/probe` (200 even for a failed
  handshake: the probe succeeded in finding out the server is down, and a 5xx would make a
  broken third-party server indistinguishable from a broken Mudavym), `PUT /:id/secret`
  (`null` clears), `GET /runtime`. `ROW_COLUMNS` is a named constant that omits
  `secret_encrypted`, so the credential is never *fetched* rather than filtered later.
- `supabase/migrations/20260903104500_user_mcp_connection_runtime.sql` — ten nullable
  columns, a CHECK on `probe_status`, comments, and a `DO` block that **unconditionally**
  asserts all ten columns exist and are nullable, that the lockdown from `20260903094500`
  survived the `ALTER`, that the client roles still cannot reach `secret_encrypted`, and
  that the constraint exists — and that **proves the CHECK fires *when a seed row exists***,
  by attempting `probe_status = 'healthy'` and requiring the rejection. On a database with no
  `users`/`restaurants` row to hang a test row on it announces a skip instead. The
  conditional half is stated because dropping it would report an untested path as a tested
  one, which is this page's own subject one level up.

**Honesty rules applied to the new work.**

- **A declaration is still not a measurement.** A server nobody has checked shows an
  **em-dash chip** and the sentence *"This server has never been checked, so nothing is
  claimed about it either way."* The register gained a way to be certain and did not use it
  to become confident.
- **Four sentences, three chips, and the shortfall is stated in the code.** `unconfigured`
  (a stored credential this deployment cannot decrypt) shares the `Unavailable` chip with a
  server that answered badly, because the chip vocabulary is shared with the payment
  register and inventing a sixth word there would make every other register's chip mean
  slightly less. The distinction survives in the `reason` line under every title, and
  `chipFor` says so in a comment rather than leaving a reader to notice.
- **A stored secret that cannot be opened does NOT become an anonymous call.** The probe
  returns `unconfigured` and calls nothing, because a call that succeeded without the
  credential would be read as the credential working.
- **A truncation cannot read as the catalogue.** `probe_tool_count` is what the server
  reported; the array is what was kept; the row prints "N of M shown" when they differ.
- **`inputSchema` is dropped** — the largest field a tool carries, useful only to a caller
  that can invoke. Keeping it would be storing an argument spec for a call that cannot be
  made.

**Two alternatives considered and not built** (the founder decides after seeing this one):

1. **Probe on a schedule.** A cron under `ScheduledTenantsService.runPerTenant` would keep
   every row current instead of "as of the last check". Not built: it turns a page-level
   "check this" into standing outbound traffic from our infrastructure to addresses tenants
   typed in, which is a different security posture and wants quiet hours and back-off. Filed
   as **G14**. The manual probe is the honest smaller thing, and it is the one a person asks
   for at the moment they care.
2. **Call a tool, behind hold-to-approve.** The seal exists, the ceremony exists, and this
   is the demo everyone wants. Not built, and this is the pass's one real refusal: a tool
   call can send an email to a vendor or place an order, which is what ADR 0013's commitment
   guardrail governs — and that guardrail has never been extended to model-context
   dispatch. Building the ceremony first would put the most reassuring part of the feature
   in front of the undecided part. **The fork for the founder:** does ADR 0013 extend to a
   third-party tool call, and what is the human step? The table needs no new column either
   way.

**Substituted or left out, and why:**

- **No official `@modelcontextprotocol/sdk`.** It follows redirects and has no notion of a
  refused address range — half of what the endpoint guard exists for — and it is built for a
  long-lived session this product does not have. ~200 lines of `fetch` against a spec we can
  cite line for line instead. If a persistent client ever lands, the SDK is right for it.
- **No `GET` stream, no session `DELETE`, no 2024-11-05 HTTP+SSE fallback.** A probe is one
  round trip that answers one question; each of those belongs to a long-lived client.
- **No new motion.** "Check the server" makes a call that can take eight seconds — exactly
  where a spinner usually goes. It gets a label change and nothing else; see `MOTIONS.md`.

**What could not be verified, stated plainly (§0.5).**

- **The runtime was driven against a real server, and it was ours.** A throwaway MCP server
  on `127.0.0.1:7801` (`node:http`, JSON for `initialize`, **SSE** for `tools/list`) was
  driven by the **compiled** `dist/mcp-runtime/mcp-runtime.service.js` out of process. It
  returned `status: "ok"`, `serverName: "Stub POS bridge"`, `serverVersion: "0.9.2"`,
  `protocolVersion: "2025-06-18"` and three tool names; a closed port returned
  `unreachable | the request did not complete (ECONNREFUSED)`; and
  `http://169.254.169.254/latest/meta-data/` was **refused before any call**. The stub's own
  log shows the lifecycle exactly as the spec fixes it — `initialize` with no session and no
  version header, then `notifications/initialized` and `tools/list` both carrying
  `session=stub-session-7f3a proto=2025-06-18` and the bearer. Nothing in this verification
  touched a public MCP server.
- **The probe route itself could NOT be curled end to end, and the reason is the database.**
  `20260903094500` and `20260903104500` have not been applied anywhere — they apply on merge
  — so every route that reads the table answers with its honest failure. Measured against
  the live gateway on `:4000` with a minted dev-bypass session:

  | Request | Status | Body |
  |---|---|---|
  | `GET /mcp-connections/runtime`, no bearer | **401** | `Unauthorized` |
  | `GET /mcp-connections/runtime` | **200** | `secretStorage.configured: false`, reason names `MCP_CONNECTION_SECRET_KEY`; `invocation.enabled: false` with the ADR 0013 sentence |
  | `GET /mcp-connections` | **500** | `The model-context register could not be read: Could not find the table 'public.user_mcp_connections' in the schema cache` |
  | `POST /mcp-connections/:id/probe`, no bearer | **401** | `Unauthorized` |
  | `POST /mcp-connections/not-a-uuid/probe` | **400** | `Validation failed (uuid is expected)` |
  | `POST /mcp-connections/:id/probe` | **500** | `The model-context server could not be read: Could not find the table …` |
  | `PUT /mcp-connections/:id/secret` `{"secret":"tok"}` | **503** | `MCP_CONNECTION_SECRET_KEY is not set, so a model-context server secret cannot be stored or read.` |
  | `POST /mcp-connections` with a `secret`, no key | **503** | the same sentence |
  | `POST /mcp-connections`, `url: ftp://…` | **400** | `["url must be a URL address"]` |
  | `POST /mcp-connections`, body carries `secret_encrypted` | **400** | `["property secret_encrypted should not exist"]` |

  Four things are proven there rather than asserted. `GET /runtime` answers **200 without
  touching the database at all**, which is the whole point of reading the deployment's state
  separately from the register: an absent key is a sentence beside one disabled field, not a
  failure of the register. Both 503s land **before** any database call, which is why they are
  unaffected by the missing table — the refusal is the first thing that happens. The
  `whitelist: true` pipe means a caller cannot post a pre-encrypted envelope. And the guard
  is on.
- **The Nest boot guard now PASSES whole.** The second pass recorded that
  `scripts/check_gateway_boots.sh` failed on this worktree for an unrelated in-flight
  `AnalyticsModule` defect and substituted a module test. That defect has since been fixed by
  another session: re-run at the end of this pass, the guard prints *"PASS — the gateway
  dependency graph resolves; the app can boot."* The substitution is no longer needed and the
  claim is struck rather than carried forward.
- **Two required CI guards were failing on this build's paths, and the fix was to be
  READABLE rather than to raise a ceiling.** `check_queried_tables_exist.py` extracts every
  `.rpc(` in the tree as a Postgres function call; the runtime's private JSON-RPC helper was
  named `rpc`, so `this.rpc(url, …)` spent two slots of that guard's ratcheted
  unresolvable-site budget on a false positive and pushed it from its ceiling of 26 to 28.
  Renamed to `request` (and its transport helper `send` → `post`), with a comment at the
  definition saying why, so nothing renames it back: **26 of 26, PASS**.
  `check_read_columns_exist.py` could not resolve `McpConnectionsService.ROW_COLUMNS` — it
  resolves a same-file `const NAME = "…" + "…";` and not a class static — so all five reads
  counted UNREADABLE, the guard's word for *a read nobody is checking*. Moved to a
  module-level `const MCP_ROW_COLUMNS`, with the class static kept as an alias so the spec
  can still assert what it omits, and a new test pinning the two together: **PASS**.
  Neither guard was weakened and `scripts/` was not touched. The second fix is a net gain
  rather than a formality — proven by breaking it on purpose: misspelling one column to
  `probe_stattus` turns the guard red on all five sites, so **every one of the sixteen
  column names, including the ten this pass added by `ALTER TABLE`, is now checked against
  `supabase/migrations/`** where before none of them was.
- **The SSRF guard was BYPASSABLE when this section was first written, and the audit proved
  it.** `mcp-endpoint.guard.ts` detected the IPv4-mapped form with `ip.includes(".")`, and
  Node's `URL` canonicalises `http://[::ffff:127.0.0.1]/` to hostname `[::ffff:7f00:1]`
  before that code runs — no `.` left in the string, the branch dead, and a full MCP
  handshake completed against a loopback stub through the compiled `probe()` in the
  **default** posture with no dev flag. Fixed by parsing rather than string-matching (see
  §1a), and re-verified end to end against the same stub: `[::ffff:127.0.0.1]:38124` and
  `[::ffff:7f00:1]:38124` are both `refused` before any call, the dotted control
  `127.0.0.1:38124` is refused, and the stub's log shows exactly one session — the one made
  with `MCP_ALLOW_PRIVATE_ENDPOINTS=true` deliberately on. Recorded rather than smoothed
  over: the claim in this note was false for four hours, and the reason it was false is that
  the rule had no direct test of its own.
- ~~**DNS rebinding is not closed.**~~ **CLOSED with the same fix (G16).** The transport
  moved from `fetch` to `node:http`/`node:https` with a `lookup` hook that returns only the
  address `checkEndpoint` approved, so there is no second resolution to poison. All 79
  pre-existing gateway tests — the SSE path, the size cap, the deadline and the redirect
  refusal among them — passed unchanged across that transport swap, which is the evidence
  the rewrite preserved behaviour rather than merely compiling.
- **The two coverage defects the audit named are closed, and both are proven by breaking
  them.** (1) `mcp-endpoint.guard.spec.ts` did not exist — 33 tests now, one per FORM rather
  than per scenario, with `dns/promises` mocked so "every address a name resolves to must
  pass" is exercised instead of asserted; restoring the shipped `includes(".")` test turns
  **7 of them red**. (2) The database-level tenant scope was pinned by nothing: the audit
  deleted `.eq("restaurant_id", …)` from `list()` and watched every test stay green. The
  fake query builder records its filters now and six tests assert both ids on every read and
  write; repeating the audit's deletion turns the suite red (**2 failed, 116 passed**).
- **No screenshot.** Both grounds are still argued from the tokens rather than seen:
  `grep -rnE "#[0-9A-Fa-f]{6}"` over `McpRegister.tsx` is empty, so every ground, ink and
  seal is a variable the `.dark .mudavym` block re-defines. Emoji sweep over the register,
  both gateway modules and the migration: **empty**.
- **The web figure is 47, and only 15 of them are this build's.** `ProfileNext.test.tsx`
  passes 47/47, but the file is shared with the concurrently-rebuilt payment register:
  `vitest run … -t "model-context"` is **15 passed, 32 skipped**, and those 32 are build A's.
  An earlier draft of this line said "all ten model-context tests pass" — wrong in number
  (it was written before the last five were added and never re-counted), corrected here
  rather than quietly. Three of A's tests were failing while this was being written and are
  green now.

### Fifth pass, 2026-09-04 — the collapse. This page becomes personal.

**What the founder asked.** Put the fork of ADR 0114 — do the house registers leave
`/profile`, and do the four `/settings` connection tabs collapse into `/connections` —
the founder chose **"Move the registers and collapse the four tabs."** The route's own
justification (ADR 0114's rejected-alternatives section, and this note's §13a) was a
surface count that *fell*; until this pass it had *risen*.

**Which three, measured.** The brief guessed "the till / payment provider / sender
identity". Those are `/connections`'s own registers. **§13a of this file names a
different three**, and they are the ones that moved: **Register IV — Model context**,
**Register V — How the house pays**, **Register VI — The house**. The till, the sender
identity and the calendar feed were never on `/profile` at all.

**What is on the page now, with the flag on.** Five registers: *Who you are* ·
*What protects this account* · *What is connected to you* · **What may act as you** ·
*Ruled off*. The exit renumbers from VII to V (`ProfileNext.tsx`), because a gap where
three registers were reads as three that failed to render.

**Register IV did not simply leave — it SPLIT, and that is the one thing in this pass
that was not in the brief.** Measured, on the gateway:

| Route | Gate | Therefore |
|---|---|---|
| `POST /mcp-connections` (declare) | `assertCanManageRestaurant` (`mcp-connections.controller.ts:150`) | the house's |
| `POST /:id/probe` | `:174` | the house's |
| `PUT /:id/secret` | `:188` | the house's |
| `DELETE /:id` (revoke) | `:203` | the house's |
| `PUT /:id/consent` | **no role check** (`:218-235`), takes the caller's id from the token and accepts no user id in any shape | the **person's** |

`/connections` is manager-and-owner only. Had the consent control travelled with the
rest, a **staff member would have lost the only place they could stop a server acting
in their name**, and gained nowhere to do it — an absent control reads as consent. So
the declaration half moved and the consent half stayed, as
`ConsentRegister.tsx`. This is exactly the "reciprocal obligation" §13a named.

**A second measurement, and it is a defect this pass closes rather than a design
choice.** `/profile`'s model-context register **never had a consent control at all**:
`grep -n consent McpRegister.tsx useProfileNextData.ts` returned **nothing** before this
pass, while the wire has carried `consent: { given, at, liveCount }` since ADR 0114
(`mcp-connections/dto/mcp-connection.dto.ts:124`). Nobody but a manager could give or
withdraw consent anywhere in the product. `ConsentRegister` is the first place it can
be done by the person it belongs to.

**Two reads stop.** `locationQ` and `paymentsQ` are disabled when the flag is on
(`useProfileNextData.ts`, `enabled: … && !connectionsRouted`), and `paymentsState`
becomes `idle`, so the opening line drops its payment clause rather than printing a
confident "nothing on file that can bill you" about a register nobody asked. Nothing
else on the page read either: measured by grepping
`locationState|data.location|refetchLocation` and `paymentMethods|paymentProvider`
across `profile/next/*.tsx`, which hit only `HouseRegister.tsx` and
`PaymentRegister.tsx`. **The limitation, stated:** `useMudavymDesign` has no settled
state, so under the per-restaurant FLAG (not the localStorage override, which resolves
synchronously) both reads still fire **once** on first paint before the verdict lands.
This removes the steady-state reads, not the first pair. Filed in §13.

**What the move cost, and what repaid it the next day — G12a.** Three controls had their
only mount on this page. Declare and revoke moved to
`connections/next/HouseServerControls.tsx`. **Adding a card did not**, on 2026-09-04:
`StripeCardPanel.tsx` mounted Stripe's own iframes and was bound to this page's data hook
(`ProfileNextData`) and UI kit (`pf-ui`), so for one day there was nowhere in the product
to add a card with the flag on, and `/connections`' row said exactly that instead of
pointing at a page that no longer carried it. **Repaid 2026-09-05:** the panel left this
directory for `components/mudavym/StripeCardPanel.tsx` and both bindings were cut, so the
one component now renders on both pages. See §9 G12a (closed) and `connections.md` §9 G-C9
(closed).

**Retire-to-write.** This pass retires the duplicate: Registers IV, V and VI are
described by [[connections]] from now on, and §13a's status block above is superseded
by this subsection on the one point where they disagree — §13a said "nothing was moved
out"; three registers have now moved out.

**Motions: none added.** The table in §1b is unchanged, and `MOTIONS.md` says why —
animating the register that replaces three others would say the replacement is an event,
and this is a smaller page rather than a reveal.

**Proof.** `vitest run src/pages/profile/next` — **57 passed** (47 pre-existing,
unmodified and green with the flag OFF, which is this pass's proof that production is
untouched; 10 new with it ON). `tsc --noEmit` clean for this directory. Emoji grep over
`pages/profile/next`: empty.

### Sixth pass, 2026-09-04 — the payment register holds to approve, and proves it

**What the founder asked.** "Extend to order approval and payments; settings stay
asserted." The gateway half shipped first (`cd2b86d8`): `PATCH /payment-methods/:id/default`
and `DELETE /payment-methods/:id` now REDEEM a one-time seal minted by
`POST /payment-methods/seal-challenge`, bound to (this manager, this act, this
instrument, and the brand and last four the manager was looking at). The page had not
caught up, so every payment write on it was refused — G-PAY-SEAL.

**What was built.** *Charge this first* and *Remove* are `HoldToApprove` now
(`PaymentRegister.tsx`, `SealedControl`). `onChallenge` mints the seal for that act at the
moment the gesture BEGINS — not with the write, because a token a request fetches for
itself is the assertion model with extra steps — and `onApprove` hands it to the write,
which carries it in `X-Seal-Challenge`
(`useProfileNextData.ts`, `mintPaymentSeal` / `setDefaultPaymentMethod` / `removePaymentMethod`).
A mint that fails approves nothing and the control says "The seal could not be issued —
nothing sent". A 403 now reaches the operator as the gateway's own sentence: `spoken()`
promotes `response.data.message` onto `.message`, because axios otherwise hands the row
"Request failed with status code 403" — a status code standing in for the one refusal the
seal exists to produce.

**Motions: no new token.** `pour`, `tuck` and `stamp` arrive with `HoldToApprove`, and
`MOTIONS.md` restates the rule they now follow: the seal appears exactly where the server
redeems one, plus the single irreversible act that has no server to ask.

**What stayed open then, and closed on 2026-09-05.** `create` was sealed at the gateway
and not here, because nothing in `apps/web` or `apps/mobile` calls `POST /payment-methods`
at all — measured, not assumed — and the real path, `POST /billing/setup-intent` → Stripe's
origin → `POST /billing/sync`, took no seal. Both of those routes now redeem and prove one,
and the panel mints on a hold that comes BEFORE the client secret exists. See §9
**G-PAY-SETUP**, closed.

**Proof.** `vitest run src/pages/profile/next` — **63 passed**. Against HEAD copies of the
whole directory (`git show HEAD:` into a same-depth probe directory, never a git state
change), **6 of them fail**: the converted "charged first" test and the five new ones.
Live on `:4000`, `DELETE /payment-methods/<uuid>` and `PATCH /payment-methods/<uuid>/default`
with no seal header both answer 403 carrying the whole refusal sentence; neither wrote
anything, because an absent seal is refused before the instrument is read.

### Overlays decided (2026-09-06)

> **This page has no row in the overlay census at all** — measured: the census's 23 route keys do
> not include `/profile`, and one of the two finders built its whole per-row analysis on that file
> without noticing. The page nonetheless carries real ceremonies: `HoldToApprove` at
> `pages/profile/next/ProfileNext.tsx:412` and twice inside `pages/profile/next/PaymentRegister.tsx`,
> plus the shared `StripeCardPanel` mounted **inline** rather than in a portal. The absence is a
> census coverage gap, not a page without overlays; it is filed for the census owner in
> [ADR 0133](../decisions/0133-one-motion-per-act-across-every-page.md).

| Surface | Shape today | Contract sentence | Four states, denied included | Ceremony | Status |
|---|---|---|---|---|---|
| The card-on-file add flow | **in-page expansion, not a portal** — `PaymentRegister.tsx:511-512` | "Put a card on file. Saving stores it with the payment provider; the house never sees the number. Leaving stores nothing." | *error*, present and explicit (`StripeCardPanel.tsx:453,470`) · *denied* owed | the hold, where the gateway redeems a seal | keep the shape — it is not a modal and does not pretend to be; **denied state owed to packet 4** |
| Delete account, card on file, charge-first, remove | inline `HoldToApprove` | each states what the seal binds, using packet 0's `boundSummary` read-back | *denied* owed | the hold; wax exactly where the gateway redeems, plus the one act that is irreversible with no server to ask | **built**; `boundSummary` wiring owed to a page pass |
| **How this house knows it is you** — step-up enrolment | owed: a **sheet** on this page | "The devices and passkeys this house will accept for you. Adding one is told to every owner. Leaving adds none." | all four, denied included | plain to enrol; adding a device is on the security-change list | owed to **packet 4** — the two-hour step-up assumes a passcode or a passkey exists and **nothing enrols one** |
| A census row for this page | owed | — | — | — | owed to the census owner |

**A remembered four-digit manager passcode is a cognitive function test** under WCAG 2.2 SC **3.3.8
Accessible Authentication (Minimum), Level AA** — the criterion's own definition names memorisation
and transcription explicitly, and none of the sketch 102 research files names it. Decided: **the
manager's own passkey on their own phone is a peer path, and the passcode field accepts paste from
a password manager.** The house is building the WebAuthn ceremony anyway, so the marginal cost is a
second button; the four digits stay the fast path and nothing about the pass-side ceremony changes
for the common case. This page is where enrolment lives.

## 1c. Motions decided (2026-09-06)

| Act | Today (`file:line`) | Decided | Rejected, and why it loses | Status |
|---|---|---|---|---|
| Opening line | `settle` **320**, the token — `pages/profile/next/ProfileNext.tsx:220-227` | keep. This page and `/notifications` are the two that already do it right | — | no change |
| A connection row expands | `pf-expand` `settle` 320 on `0fr to 1fr` | keep for the row | — | no change |
| **"Show the working" on the session row** | the same `pf-expand` `settle` 320 | **`turn` 420.** The row expanding and the working being revealed are two acts; three pages already answer the second with `turn` | keep them the same token for simplicity — then this page and `/recommendations` are the two exceptions to a rule three pages state | owed to **packet 3** |
| The four holds (delete account, card on file, charge-first, remove) | `pour` 620 to `stamp` 360, wax only where the gateway **redeems** a seal | keep — **and this page's own sentence becomes the house's ration rule**: the seal appears exactly where the server redeems one, plus the one act that is irreversible here and has no server to ask | (a) ration by taste, which is what most pages do; (b) wax on Reconcile — it changes nothing we chose; (c) the *counter-party* rule (`/reports`) or the *consequence* rule (`/team`) as the house rule — both are true statements about their own pages and neither survives being applied to the other's | no change, promoted |
| The Stripe iframe fields | Stripe's own transitions, tuned to match `pf-ink` | keep, **and record it as the one place the house matches rather than drives** | re-skin them — the house does not own that frame | no change, recorded |
| Check the server (up to 8 s) | a **label change only** | keep — **and this becomes the house's anti-spinner rule**: the house never draws a spinner; it changes the label and writes a sentence. The two live `animate-spin` sites on `/inventory` and one on the door are the migration this rule owes, and they are named rather than left to be discovered | (a) a spinner — would make waiting look like progress; (b) a skeleton — then "in flight" and "failed" look alike again; (c) write the rule without naming the three live violations — a new rule that live code breaks on the day it lands | no change, promoted |
| Revoke an MCP server | the chip changes, the row stays | keep — a grant that once existed must not look like one that never did | the row leaves | no change |
| Plan and figures | no tally | keep | — | no change |
| Reduced motion | 2 mentions, with `HoldToApprove`'s own swap documented at `profile/next/MOTIONS.md:83` | keep, and extend to the arriving-surface cross-fade | — | owed to **packet 3** |
| Test coverage | `ProfileNext.test.tsx` has **zero** `HoldToApprove` references, and `PaymentRegister.tsx` — two ceremonies, "Charge this first" and "Removed" — has no test file at all | a test per ceremony. A ceremony with no test is a ceremony whose absence CI reports as health | leave it | owed to a page pass (see §9) |

## 2. Entry
In-degree 3 per [PAGE_MAP](../foundation/PAGE_MAP.md): header user menu (`Header.tsx:277`), sidebar bottom nav (`Sidebar.tsx:166-170`), plus `/help`, `/privacy`, `/settings` link here. Inside `DashboardLayout` + `ProtectedRoute` (`App.tsx:247-252,286`).

## 3. Files
- Route binding: `apps/web/src/App.tsx:347` — `<PageGate page="profile" legacy={<Profile/>} next={<ProfileNext/>}/>` (both lazy, `App.tsx:92,121`)
- Legacy: `apps/web/src/pages/Profile.tsx` (907 lines)
- API module: `services/api/profile.ts`; `components/auth/GoogleLinkButton.tsx`
- **Mudavym rebuild** (`apps/web/src/pages/profile/next/`, flag `mudavym_design_profile`):
  `ProfileNext.tsx` (shell, opening voice, Register VII / the exit) ·
  `useProfileNextData.ts` (six reads and fifteen writes, tenant-keyed) ·
  `IdentityRegister.tsx` (I) · `SecurityRegister.tsx` (II) ·
  `ConnectionsRegister.tsx` (III — sign-in + workspace) · `McpRegister.tsx` (IV) ·
  `PaymentRegister.tsx` (V) ·
  `components/mudavym/StripeCardPanel.tsx` (V — Stripe Elements, the hold, the four
  states; **shared with `/connections` since 2026-09-05**, which is why it is no
  longer in this directory) ·
  `components/mudavym/stripe-js.ts` (V — the loader for `https://js.stripe.com/v3`
  and the sliver of its API this product types by hand) ·
  `HouseRegister.tsx` (VI) ·
  `GoogleLink.tsx` (the one real token acquisition) ·
  `pf-ui.tsx` (the row shape, chip, rail, card, field, select) · `pf-format.ts` ·
  `ProfileNext.test.tsx` · `MOTIONS.md`
  (test count deliberately not quoted: three builders are adding tests to this one
  file on this branch, so any figure written here rots within the hour — it read 47
  green at the close of the payment build)
- **Gateway, built for this page (2026-09-03):**
  `apps/api-gateway/src/mcp-connections/` (module, controller, service, dto, 2 spec files)
  · `apps/api-gateway/src/payment-methods/` (module, controller, service, dto, 1 spec file)
  · `apps/api-gateway/src/organizations/get-location-is-role-gated.spec.ts`
  · **`apps/api-gateway/src/billing/`** (third pass, ADR 0110 — `billing.module.ts`,
  `billing-config.module.ts`, `billing.controller.ts`, `billing.service.ts`,
  `billing-customer.service.ts`, `payment-method-mirror.service.ts`,
  `stripe.client.ts`, `stripe-config.service.ts`, `stripe-signature.ts`,
  `dto/billing.dto.ts`, 4 spec files)
- **Migrations:** `supabase/migrations/20260903094500_user_mcp_connections.sql` ·
  `supabase/migrations/20260903094600_payment_methods.sql` ·
  `supabase/migrations/20260903110000_billing_stripe_provider.sql`

## 4. Endpoints
| Method | Path | Where called | Atlas |
|---|---|---|---|
| GET | `/auth/me` | `profileApi.getMe` (`profile.ts:20`), `Profile.tsx:111` | ENDPOINTS.md:67 |
| PATCH | `/auth/me` | `profileApi.updateMe` (`profile.ts:25`), `Profile.tsx:217` | ENDPOINTS.md:68 |
| POST | `/auth/me/password` | `profile.ts:36`, `Profile.tsx:240` | ENDPOINTS.md:73 |
| GET | `/auth/me/linked-providers` | `profile.ts:39-40`, `Profile.tsx:565` | ENDPOINTS.md:72 |
| POST/DELETE | `/auth/me/link/:provider` | `profile.ts:50,60`, `Profile.tsx:273` | ENDPOINTS.md:70-71 |
| POST | `/auth/me/leave-restaurant` | `Profile.tsx:290` | ENDPOINTS.md:69 |
| DELETE | `/auth/me` | `Profile.tsx:310` | ENDPOINTS.md:66 |
| GET | `/organizations/locations/:id` | `Profile.tsx:131` (manager/owner only) | ENDPOINTS.md:352 |
| PATCH | `/organizations/locations/:id` | `Profile.tsx:332,352` | ENDPOINTS.md:353 |

**Added by the Mudavym rebuild** — the workspace rail, all pre-existing and guarded
(`integrations-oauth.controller.ts`, `IntegrationsModule` wired at `app.module.ts:109`):

| Method | Path | Where called | Guard |
|---|---|---|---|
| GET | `/integrations/oauth/catalog` | `integrationsApi.getCatalog` (`services/api/integrations.ts:41`), `useProfileNextData.ts` | `JwtAuthGuard` (`integrations-oauth.controller.ts:39-41`) |
| GET | `/integrations/oauth/connections` | `integrationsApi.getConnections` (`integrations.ts:49`) | `JwtAuthGuard` (`:62-64`) |
| DELETE | `/integrations/oauth/:integrationId` | `integrationsApi.disconnect` (`integrations.ts:64`) | `JwtAuthGuard` (`:124-126`); revokes at the provider first (`integrations-oauth.service.ts:505-509`) |
| POST | `/auth/me/link/google` | `profileApi.linkProvider` via `profile/next/GoogleLink.tsx` | `JwtAuthGuard` (`auth.controller.ts:261-264`) |

**Added by the second pass (2026-09-03)** — two new gateway modules, registered at
`app.module.ts`, both `JwtAuthGuard`ed at the controller with the user id and the
restaurant id taken from the signed token rather than from a parameter:

| Method | Path | Where called | Guard / posture |
|---|---|---|---|
| GET | `/mcp-connections` | `useProfileNextData.ts` → `McpRegister` | `JwtAuthGuard`; scoped `(user_id, restaurant_id)`. **Throws** on a query error rather than returning `[]` |
| POST | `/mcp-connections` | `addMcpServer` | `JwtAuthGuard`; 409 on the partial unique index over `(user, restaurant, lower(name))` where `revoked_at is null` |
| DELETE | `/mcp-connections/:id` | `revokeMcpServer` | `JwtAuthGuard`; soft revoke, 404 when nothing live matched |
| GET | `/payment-methods` | `useProfileNextData.ts` → `PaymentRegister` | `JwtAuthGuard`; returns `{provider, methods}` — the provider's state is what stops an empty register from lying |
| POST | `/payment-methods` | **not called by anything** — not by this page, not by `/connections`, not by the mobile app (grep over `apps/web` and `apps/mobile`, 2026-09-04). A card is created by confirming a SetupIntent and reconciling | `JwtAuthGuard` + `assertCanManageRestaurant` + a REDEEMED seal; **503 with the reason** while `STRIPE_SECRET_KEY` is unset. Its seal is therefore unreachable from a browser — §9 G-PAY-SETUP |
| DELETE | `/payment-methods/:id` | `removePaymentMethod` — "Remove" | `JwtAuthGuard` + `assertCanManageRestaurant` + **a REDEEMED seal** from `X-Seal-Challenge` (2026-09-04); **detaches at the provider first** |
| POST | `/payment-methods/seal-challenge` | `mintPaymentSeal`, from `HoldToApprove`'s `onChallenge` — when the gesture begins, never with the write | `JwtAuthGuard` + `assertCanManageRestaurant`; mints a one-time, 120-second token bound to (actor, act, instrument, and that instrument's own brand and last four). Returned once and never stored in the clear |
| POST | `/auth/logout` | `AuthContext.logout`, via the Security register's "Sign out of this browser" | JWT; blacklists the presented token only |

**Added by the third pass (2026-09-03, ADR 0110)** — the `billing/` module, plus
one new route on `payment-methods/`. `check_gateway_boots.sh` PASS with the
module registered; the two lines `app.module.ts` needs are named in §9 G14
because that file is outside this page's paths.

| Method | Path | Where called | Guard / posture |
|---|---|---|---|
| GET | `/billing/provider` | not called by the page (the same state rides on `GET /payment-methods`); exists for a deployment check | `JwtAuthGuard`. `webhookLastReceivedAt: null` means no delivery has EVER been authenticated here — not health |
| POST | `/billing/setup-intent` | `createSetupIntent(challenge)` → `StripeCardPanel`, from the panel's FIRST hold | `JwtAuthGuard` + `assertCanManageRestaurant` + **a REDEEMED `create` seal** from `X-Seal-Challenge` (2026-09-05), spent BEFORE the provider is touched and stamped onto the intent's metadata; **503 with the reason** while `STRIPE_SECRET_KEY` is unset — §9 G-PAY-SETUP, closed |
| POST | `/billing/sync` | `syncPayments` — after a confirmation, and behind **Reconcile now** | `JwtAuthGuard` + `assertCanManageRestaurant`; with `setupIntentId`, the seal id is read back FROM STRIPE off that intent and proven redeemed by this person (2026-09-05); without it, a plain reconcile — `provenance` in the response says which. DROPS instruments the provider no longer holds |
| POST | `/billing/webhook` | Stripe | **`@Public()`** — authenticated by HMAC over the exact request bytes, not by a JWT. Fails closed with no `STRIPE_WEBHOOK_SECRET`. Always answers **200**, even on a refusal, so a permanently-wrong secret cannot become a retry storm; the body says `received: false` and names the failing check. Idempotent on the event id |
| PATCH | `/payment-methods/:id/default` | `setDefaultPaymentMethod` — "Charge this first" | `JwtAuthGuard` + `assertCanManageRestaurant` + **a REDEEMED seal** from `X-Seal-Challenge` (2026-09-04); written at the provider **before** the local flag |

**Added by the third pass (2026-09-03)** — the model-context runtime. Same module, same
guard, same tenancy: both scopes come from the signed token and neither is a parameter.

| Method | Path | Where called | Guard / posture |
|---|---|---|---|
| GET | `/mcp-connections/runtime` | `useProfileNextData.ts` (`mcpRuntimeQ`) → `McpRegister` | `JwtAuthGuard`; declared on a literal path **before** the `:id` routes so a connection cannot be addressed as `runtime`. Answers **without touching the database**, so an absent `MCP_CONNECTION_SECRET_KEY` is one sentence beside one disabled field rather than a failure of the register |
| POST | `/mcp-connections/:id/probe` | `probeMcpServer` → the row's "Check the server" | `JwtAuthGuard`; **200 even when the handshake failed** — the probe succeeded in finding out the server is down, and a 5xx would make a broken third-party server indistinguishable from a broken Mudavym. 404 when the id is not yours here; 409 on a revoked row |
| PUT | `/mcp-connections/:id/secret` | `setMcpSecret` → the row's Credential field | `JwtAuthGuard`; `{"secret": null}` clears. **503 naming `MCP_CONNECTION_SECRET_KEY`, before any database call**, when no key is configured |

`POST /mcp-connections` gained an optional `secret`, refused the same way. **There is no
route that calls a tool**, by decision — see §1b and ADR 0107.

`GET /organizations/locations/:id` **changed posture** in the same pass: it now calls
`assertManagerOrOwner` (a read that was open to any org member) and returns
`subscriptionTier`.

The consent step is **not** a new endpoint: the Connect control links to the existing
`/authorize/:integrationId?returnPath=/profile` page (`App.tsx:270`), which discloses the
scopes from the server's own catalogue before the redirect.

## 5. Signals
**none.** Account deletion and restaurant-leave — churn events — are untracked.

## 6. Tier cut
Core, every role. No `S..` touches it directly (OD-48).

## 7. Rebrand surface
- `Profile.tsx:445` — support mailto falls back to `support@wineops.ai` when `VITE_SUPPORT_EMAIL` is unset (a **domain**, not just a name — needs DNS/mailbox work, not a string swap)
- ~~`Profile.tsx:877` — "Permanently delete your WineOps account."~~ **Resolved.** Verified
  2026-09-02: that line now reads "Permanently delete your Mudavym account. This cannot be
  undone." `grep -in wineops apps/web/src/pages/Profile.tsx` matches only the `:445` mailto
  fallback above. Fixed by another session; kept here struck through rather than deleted so
  the register still shows what the surface was.

## 8. State & config
- **`mudavym_design_connections` changes what this page IS**, not how it looks. On:
  five registers, the three house ones gone, two reads (`locationQ`, `paymentsQ`)
  disabled. Off: the seven-register page above, byte for byte. Per-browser override
  `localStorage["mudavym.design.connections"] = "1" | "0"` (`useMudavymDesign.ts`),
  which resolves synchronously; the per-restaurant flag does not, so under the flag the
  two disabled reads still fire once on first paint (§13).
- `VITE_SUPPORT_EMAIL` (`Profile.tsx:445`). The rebuild reads the same variable and, when
  it is unset, renders a sentence instead of a `mailto:` to the dead fallback domain.
- `VITE_GOOGLE_CLIENT_ID` (`lib/googleIdentity.ts:73`) — without it the Sign-in rail's
  Google row says Google sign-in is not configured on this deployment rather than
  rendering a button that cannot work.
- Role gating in-page: `isManagerOrOwner` gates the Restaurant/Payment/Memberships sections and the locations fetch (`Profile.tsx:127,158`). The rebuild keeps the gate on the *fetch and the controls* but renders the section either way (permission-denied is a state, not an absence).
- Theme via `ThemeContext`.
- **Stripe (third pass, ADR 0110) — three variables in two processes.**
  `STRIPE_SECRET_KEY` (gateway) mints the SetupIntent and reads instruments
  back; `STRIPE_WEBHOOK_SECRET` (gateway) authenticates deliveries and, when
  unset, causes every delivery to be refused; `VITE_STRIPE_PUBLISHABLE_KEY` (web
  bundle, baked at build time) lets Stripe's card fields render. The gateway
  cannot see the third — it is in the bundle, not the process — so the page
  reports that one itself rather than letting the server guess.
  `STRIPE_API_VERSION` is optional and defaults to the pinned `2024-06-20`.
  Register V names each one, says which process it lives in, and states what it
  unlocks. **None is set on this deployment**, measured 2026-09-03 by curl
  against the local gateway: `GET /api/v1/billing/provider` → 200 with
  `secretKeyPresent: false, webhookSecretPresent: false`.
- **Mudavym redesign gate:** feature flag `mudavym_design_profile`
  (`apps/api-gateway/src/settings/feature-flag-registry.ts:172-177`, `defaultValue: false`),
  read through `useMudavymDesign('profile')` and `<PageGate page="profile" …>`
  (`App.tsx:347`). Per-browser override: `localStorage["mudavym.design.profile"]` —
  `1|true|on` forces the redesign, `0|false|off` forces legacy, absent falls through to
  the flag (`lib/mudavym/useMudavymDesign.ts:60-79`).

## 9. Gaps

- **G-TXT-P1 — a person cannot see who would be texting them.** The consent row
  says whether *this house* has a sender and how many, but not the number a
  vendor or a colleague would see, because the row that carries it is
  manager-scoped on `/connections`. A person is being asked to agree to be
  reached by an identity they cannot read. Filed; the fix is to return the
  connected sender's display identity on the person-scoped read, which is a
  gateway change and not a page one.
- **G-TXT-P2 — the crew count is hidden from staff and the row says so, but the
  distinction is thin.** `crewConsents` is `null` both when the caller may not
  see it and when the count could not be read. The page prints "a manager's to
  see" for both, which is right in the first case and wrong in the second.


- ~~**G-PAY-SEAL — the payment register's controls are buttons, not the seal
  ceremony**~~ — **CLOSED 2026-09-04.** Gateway half in `cd2b86d8`; page half in
  this pass (`PaymentRegister.tsx` `SealedControl`, `useProfileNextData.ts`
  `mintPaymentSeal` / `setDefaultPaymentMethod` / `removePaymentMethod`). *Charge
  this first* and *Remove* are `HoldToApprove`: the gesture mints the seal for its
  own act when it BEGINS, the write carries it in `X-Seal-Challenge`, a mint that
  fails approves nothing and says so, and a 403 reaches the operator as the
  gateway's own sentence rather than as a status code. Six tests pin it, all six
  failing against HEAD copies of the directory. See §1b, sixth pass.

- **G-PAY-SETUP — CLOSED 2026-09-05 (gateway sealed, and the panel now mints).**
  The founder's call, put at
  the end of this row, was answered: *"do option 1"* — seal the setup-intent
  route. `POST /billing/setup-intent` now redeems a `create` seal from
  `X-Seal-Challenge` **before** it asks the provider for anything, and stamps the
  spent seal's id into the SetupIntent's metadata; `POST /billing/sync` names the
  intent it is recording, reads that id back **from Stripe**, and proves it was
  redeemed by this person for this house's register. `SyncResponse.provenance`
  says which check ran, so a plain reconcile can never be read as a proven one.
  A guard covers the routes that do not exist yet:
  `scripts/check_money_routes_are_sealed.py` (CI, beside `check_route_exposure`)
  fails any non-GET route under `payment-methods/**` or `billing/**` that does not
  redeem, or carry an allow-list row with its reason. Measured: PASS on this tree,
  FAIL naming `setupIntent` and `sync` on a `git show HEAD:` copy. Live on `:4000`,
  `POST /billing/setup-intent` with no seal header answers **403** with the whole
  refusal sentence and asks the provider for nothing. Census, rejected
  alternatives and the webhook's four replay defences: ADR 0110's third addendum.
  **The browser half landed the same day.** `StripeCardPanel.tsx` opens on a
  `sealing` phase and asks the provider for nothing until a hold completes:
  *Hold to open the card form* mints `create` through each caller's hook
  (`mintPaymentSeal` in `useProfileNextData.ts`, `mintPaymentSeal` beside
  `paymentSeal` in `useConnectionsNextData.ts`) and spends it on the intent; the
  existing hold then confirms at Stripe and syncs **naming the intent**, and the
  panel prints which `provenance` came back rather than assuming the sealed one.
  A mint that resolves null opens nothing and says "The seal could not be issued
  — nothing sent." The hold had to move to the FRONT because Stripe Elements
  needs the client secret before it can mount a field, and the client secret is
  the capability: a seal minted on the confirm hold would be minted after the
  thing it authorises had already been handed out. Rejected: deferred Elements
  (`elements({mode:'setup'})`) keeps one hold and is a rewrite of the panel's
  mount/confirm cycle against an Elements API this repo has never used. Proof:
  `vitest run src/pages/profile/next src/pages/connections/next
  src/components/mudavym` — **219 passed**; pre-fix, a `git show HEAD:` copy of
  the panel rendered under a probe test called `createSetupIntent()` with zero
  arguments on mount and had no gate at all. Mirror: `connections.md` §9 G-C9.

  *The original entry, kept because the reasoning it records is the reasoning that
  was acted on:*

- **G-PAY-SETUP — adding a card is the one payment act with no redeemed seal, and
  the sealed `create` route has no caller (added 2026-09-04).** ADR 0110's
  addendum seals three writes; `POST /payment-methods` is one of them, and
  **nothing in `apps/web` or `apps/mobile` calls it** — measured by grep over both
  apps, not assumed. The real add-a-card path is `POST /billing/setup-intent` →
  Stripe's own iframes → `POST /billing/sync`
  (`components/mudavym/StripeCardPanel.tsx`, and since 2026-09-05 BOTH
  `useProfileNextData.ts` and `useConnectionsNextData.ts` — the port widened the
  blast radius of this gap from one page to two, which is a reason to close it and
  not a reason to have left the panel where it was), and both of those routes are
  role-gated and seal-free (`billing.controller.ts:101-166`). So the act the addendum most wanted
  to protect — "an attacker attaches their own instrument" — is protected on the
  route nobody uses and unprotected on the route everybody uses. *Why not yet:*
  the fix is in `apps/api-gateway/src/billing/**`, a module this pass's brief did
  not name, and the subject and args for it are already defined
  (`payment-seal.ts`: `create`'s subject is the house's register). The page states
  the gap in words on the panel and in the register's lead rather than implying a
  seal it does not have. **Founder's call: seal `POST /billing/setup-intent`, or
  make the panel record through the sealed `create` route instead?**

~~**G12a — nowhere to add a card while `mudavym_design_connections` is on (opened
2026-09-04 by the collapse; the one thing that pass subtracted).**~~ **CLOSED
2026-09-05** (founder: *"port the card panel to /connections now"*). The panel was not
copied — it was moved and unbound. `pages/profile/next/StripeCardPanel.tsx` is now
`components/mudavym/StripeCardPanel.tsx`, and `pages/profile/next/stripe-js.ts` is now
`components/mudavym/stripe-js.ts` (the panel is its only `loadStripe` caller). The two
bindings that had kept it here are gone: the data prop is `CardPanelClient`
(`createSetupIntent` + `syncPayments`, which `ProfileNextData` satisfies structurally, so
`PaymentRegister.tsx` passes `data` in unchanged and `useConnectionsNextData` grew the same
two members), and the four `pf-ui` primitives are redrawn inside the component over the
house tokens with their hover and focus rules in `components/mudavym/stripe-card-panel.css`.
One component, two callers: `/profile` with the flag off (production's state) and
`/connections` Register II with it on. **Changed the next day:** `CardPanelClient` gained a
third member, `mintPaymentSeal`, and adding a card is sealed on both surfaces — G-PAY-SETUP
above, closed. Mirror: `connections.md` §9 G-C9.

- Restaurant section edits (`PATCH /organizations/locations/:id`) rely on server-side role enforcement; the page gate is client-side only.
- The v3.0 UX catalog's "dashboard profile card with no handler" item (L102) was never located (`v3.0-TECH-DEBT.md:502`) — unverified, tracked there, not here.

**Found while building the Mudavym redesign (2026-09-02), then revisited on 2026-09-03
when the second pass was allowed to edit the gateway. Four of the eight are CLOSED — the
closure and the file that did it are named on each row, so this table stays a register of
what happened rather than a list of what is left.**

| # | File | What it needs |
|---|---|---|
| ~~G1~~ | `scripts/check_no_seeded_defaults.py` (`SCAN_ROOTS`) | **CLOSED.** `Path("apps/web/src/pages/profile/next")` is in `SCAN_ROOTS` with the rest of the p4 wave, so the guard reads this surface as shipped rather than on a patched copy — that is the durable claim, and it is checkable by reading `SCAN_ROOTS`. **PASS** on every run of the second pass. The file and character totals are deliberately NOT quoted here: nineteen roots are being edited by concurrent sessions on this branch, so any figure written down is stale within minutes (it read 125 / 1,402,280 early in the pass and 129 / 1,432,447 at the end, both PASS). A number that must rot is worse than the invariant it was standing in for |
| ~~G2~~ | `apps/api-gateway/src/organizations/organizations.service.ts` (`getLocation`) | **CLOSED 2026-09-03.** The select carries `subscription_tier` and the method returns `subscriptionTier` (raw — `?? null`, never defaulted to a friendlier tier). The Payment register names the plan. Pinned by `get-location-is-role-gated.spec.ts` ("returns the plan the browser could not previously read", and "returns the plan as null rather than a default when the column is empty") |
| G3 | `apps/api-gateway/src/integrations/integrations-oauth.service.ts:485-488` | `listConnections` logs a query error and returns `[]`, so a failed read is indistinguishable from "nothing connected" on the wire. The rebuild infers the failure (catalogue non-empty + connections empty) — a correct inference *today*, and a fragile one. The endpoint should surface the error |
| ~~G4~~ | `apps/api-gateway/src/mcp-connections/` + `supabase/migrations/20260903094500_user_mcp_connections.sql` | **CLOSED 2026-09-03.** Module, table, migration and three routes built; the page lists, adds and revokes for real. **What remains open is narrower and is now G9**: nothing *calls* a declared server, so `last_used_at` is null on every row — stated on the page in one line rather than left to a quiet column |
| ~~G5~~ | `apps/api-gateway/src/payment-methods/` + `supabase/migrations/20260903094600_payment_methods.sql` | **CLOSED as far as honesty allows, 2026-09-03.** Module, table, migration and three routes built; the register lists and the Add form opens with every real field. The provider is **still absent**, and that is deliberate rather than unfinished — pricing is founder-deferred (OD-23; `common/model-client/spend-tiers.ts:1-22` says its own figures are placeholders and must not be cited as pricing), and connecting a payment provider before there is a price is a surface that can take money for nothing. Both the form's submit and `POST /payment-methods` refuse with the same sentence. **What remains is G10**: one credential and one hosted callback |
| G6 | `apps/web/src/lib/identityProviders.ts:101-107` | Microsoft is declared but not renderable, so the Sign-in rail's Connect is disabled with that reason. A Microsoft sign-in button (the gateway route `POST /auth/oauth/microsoft` already exists) would switch it on |
| ~~G8~~ | `apps/api-gateway/src/organizations/organizations.service.ts` (`getLocation`) | **CLOSED 2026-09-03 — the profound fix, not a copy change.** The read now calls `assertManagerOrOwner(userId, restaurantId, "read the restaurant record")`, so a staff member calling the endpoint directly, past the UI, is refused instead of handed the restaurant's billing email and phone. Ordered **after** the restaurant lookup so a restaurant outside the org stays a 404 and the new check cannot leak existence through a 403. `assertManagerOrOwner` gained an `action` parameter so a refused GET does not carry the write's message. Both the profile page's and the audit's concern are closed; the copy now states a server rule. Callers checked before the change: only `Profile.tsx:137` and `profile/next`, both already manager/owner-gated client-side, so nothing regressed. Spec: `organizations/get-location-is-role-gated.spec.ts` |
| ~~G9~~ | `apps/api-gateway/src/mcp-runtime/` + `supabase/migrations/20260903104500_user_mcp_connection_runtime.sql` | **CLOSED 2026-09-03 (third pass), ADR 0107.** Something calls now. `POST /mcp-connections/:id/probe` runs the Model Context Protocol lifecycle over Streamable HTTP (`initialize` → `notifications/initialized` → `tools/list`, revision `2025-06-18`) and writes `last_probe_at`, `last_used_at`, `probe_status`, `probe_detail`, the tool list and the server's own name/version onto the row. The handshake question the first filing called an undecided fork was not one — the spec publishes the transport. The credential the table "deliberately" lacked is `secret_encrypted`, AES-256-GCM under `MCP_CONNECTION_SECRET_KEY`, never selected by a read path. **What remains open is narrower and is genuinely a decision, not a build: tool INVOCATION** — see G18 |
| ~~G10~~ | `apps/api-gateway/src/billing/**` + `supabase/migrations/20260903110000_billing_stripe_provider.sql` | **CLOSED 2026-09-03 (ADR 0110) — and its own wording was wrong before it was closed.** G10 read "everything except the credential is built". Measured before building: no Stripe client, no webhook, no SetupIntent, neither package installed — so `provider_ref` was a required field no caller could fill and setting `STRIPE_SECRET_KEY` would have enabled a form whose four hand-typed fields became the register's content. The honest refusal was one env var from a fabricated record. Now built: SetupIntent, Elements on Stripe's origin, `provider_ref` stored and never a PAN, list, detach-at-the-provider, default-at-the-provider, reconcile, and a signed idempotent webhook. **The remainder is a deployment step, and it is named: G13** |
| G13 | deployment, not code | **Three variables and one dashboard entry.** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` on the gateway, `VITE_STRIPE_PUBLISHABLE_KEY` in the web build, and the webhook endpoint registered at Stripe pointing at `POST /api/v1/billing/webhook`. Until the last of those, `webhookLastReceivedAt` stays null and Register V says *"configured, never delivered"* rather than implying the seam works — which is the point: the page can tell an unregistered endpoint from a working one, and nobody has to notice a stale card to find out. **Charging remains out of scope regardless** (OD-23) and the client throws before it can call `payment_intents` |
| G14 | `apps/api-gateway/src/app.module.ts` | **Two lines, outside this page's paths.** `import { BillingModule } from "./billing/billing.module";` beside the `PaymentMethodsModule` import, and `BillingModule, // Stripe: SetupIntents, reconcile, signed webhook (ADR 0110)` beside the `PaymentMethodsModule` entry. Verified by applying them temporarily on 2026-09-03: `scripts/check_gateway_boots.sh` → **PASS**, and curl against the local gateway with a minted session returned `GET /billing/provider` **200** (**401** with no token, so the guard is on), `POST /billing/setup-intent` **503**, `POST /billing/sync` **503**, `POST /billing/webhook` **200** both with no signature and with a bogus one (a refusal is 200 on purpose — see §4), and `PATCH /payment-methods/:id/default` **503**. Reverted afterwards, because `app.module.ts` is shared with three concurrent builders on this branch |
| G11 | `apps/api-gateway/src/auth/**` | **No session register, no second factor, no passkeys, no personal API tokens.** Measured 2026-09-03. The Security register renders four `Not built` rows carrying these measurements. The session one is the cheapest and the most valuable: a `user_sessions` row per issued refresh token (device, address, last-seen, revoked_at) would turn one honest row into the list every account page in the field shows, and would make "sign out everywhere" possible |
| G12 | `scripts/check_no_seeded_defaults.py` (`SERVER_SCAN_ROOTS`) | **The two new gateway modules are outside the S5 arm.** `SERVER_SCAN_ROOTS` lists only `apps/api-gateway/src/team` and `apps/api-gateway/src/restaurants`, so `mcp-connections/` and `payment-methods/` get no automated check that a row-shaped literal is not asserting a measurement nobody supplied. Reviewed by hand and clean — the only literals in either module are the provider's refusal sentence and the `'stripe'` provider id — but hand-checking is not a ratchet. `scripts/` is outside this page's paths, so this is filed rather than fixed. One line each in `SERVER_SCAN_ROOTS` closes it |
| ~~G16~~ | `apps/api-gateway/src/mcp-runtime/mcp-endpoint.guard.ts` + `mcp-runtime.service.ts` | **CLOSED 2026-09-03, same day, under audit.** Filed as the residual of a resolve-then-refuse guard; the audit then found a worse fault in the same file — the IPv4-mapped branch was dead code because `URL` canonicalises `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]`, and a loopback handshake completed in the default posture. Both are fixed together: the address is now PARSED to sixteen bytes and judged on the bytes (fail-closed on anything unparseable), and the vetted address is **pinned** into the socket via `http.request`'s `lookup` hook — which is why the transport is `node:http` rather than `fetch`, since `fetch` cannot say which address a name must resolve to. Certificate validation is untouched: the hostname still supplies `Host` and SNI. Pinned by `mcp-endpoint.guard.spec.ts` (33 tests; 7 go red against the shipped version) |
| G17 | `apps/api-gateway/src/mcp-runtime/` + the per-tenant scheduler (ADR 0022) | **A probe is manual.** The register is current as of the last check and prints that date; nothing keeps it fresh. A scheduled probe under `ScheduledTenantsService.runPerTenant` would — and would also turn a page-level "check this" into standing outbound traffic from our infrastructure to addresses tenants typed in, which wants quiet hours, back-off and its own decision. Deferred deliberately, not forgotten |
| G18 | nothing may CALL a model-context tool | **Tool invocation, and it is a DECISION not a gap.** Tools are listed on the row and there is no `tools/call`, no route reaching one, no column recording one, and a structural test asserting the runtime service has no `call`/`callTool`/`invoke` method. A tool call can send an email to a vendor or place an order — the subject of ADR 0013's commitment guardrail, which has never been extended to model-context dispatch. `GET /mcp-connections/runtime` returns that sentence and the page prints it. **The fork for the founder:** does ADR 0013 extend to a third-party tool call, and what is the human step (the seal, a draft, a per-tool grant)? The table needs no new column either way |
| G7 | `apps/api-gateway/src/auth/auth.controller.ts:487-491` | there is no **authenticated** way to fetch the identity-provider registry. `POST /auth/sign-in-methods` is `@Public()` and rate-limited by IP (10 / 600s), which a shared restaurant network would exhaust. An authenticated `GET /auth/me/sign-in-methods` returning `declared`/`methods`/`unavailable` would let the Sign-in rail use the server's own labels and reasons instead of page prose |
| G19 | `apps/api-gateway/src/payment-methods/payment-methods.controller.ts:65-79` + `billing/billing.controller.ts:66-78` | **The house's payment reads are not role-gated.** Every *write* on both modules calls `assertCanManageRestaurant` (`:92-98`, `:114-125`, `:138-148`); the two reads take any authenticated member of the restaurant, and the page gates only the controls — the card rows render for every role (`PaymentRegister.tsx:370-385`). Harmless today because the register is empty by construction, and live the moment `STRIPE_SECRET_KEY` is set (G13): a staff member's own `/profile` would show the house's cards. Toast gates this behind `Account Admin > Manage Integrations`, Square behind `account & settings`. The fix has a precedent in this repo — `assertManagerOrOwner(userId, restaurantId, "read the restaurant record")` on `getLocation`, pinned by `organizations/get-location-is-role-gated.spec.ts`. Filed 2026-09-03 (fourth pass); worth closing whether or not the Connections split happens |
| G20 | `components/settings/IntegrationsAuth.tsx:161` + `settings/next/ServicesSection.tsx:128` + `profile/next/ConnectionsRegister.tsx:224` | **Three renderings of one catalogue, each a different subset, and no one list anywhere.** All three navigate to `/authorize/:id`; POS, sender identity, the calendar iCal feed and payments appear in none of them. DESIGN-FOUNDATION §6 rates "one list of everything that acts on your behalf" as **now**, and §6b measures that the product has no such list. Closing it is the Connections surface (§13a) — a placement decision for the founder, not a defect this page can fix alone |
| G21 | `apps/api-gateway/src/integrations/integrations-oauth.service.ts:476-484` | **A grant is recorded against a restaurant and then listed across all of them.** `restaurant_id` is written on the connection row (`:150`, `:439`) and `listConnections` filters on `user_id` alone, so a Drive grant made while standing in restaurant A is listed while standing in restaurant B. The column is not merely unused — it is written and then ignored by the only read path, which is worse than absent because the schema implies a scope the code does not keep. Same file as G3; closing both is one change |

## 10. Maturity

**partial** on the shipping page; the Mudavym rebuild behind
`mudavym_design_profile` is materially further along. Every write on both reaches a real,
guarded endpoint and takes effect. The shipping page's two read paths still fail silently.
As of the second pass (2026-09-03) the rebuild has **two more real registers than the
shipping page has sections** — model context and payment, each with its own gateway module,
table and migration — and the four things it still cannot do (session list, second factor,
passkeys, personal API tokens) are rendered as `Not built` rows carrying the measurement
behind each claim, with no control that could turn nothing on.

**Real on the write side, and better than the page note assumed — but the READ is not
gated at all.** §9 flagged that the Restaurant section "relies on server-side role
enforcement; the page gate is client-side only". For the **write** that enforcement
exists and was verified:
`OrganizationsService.updateLocation` checks org membership, then calls
`assertManagerOrOwner(userId, restaurantId)` for any field that touches operations
(`apps/api-gateway/src/organizations/organizations.service.ts:178-186`, helper
`:94-118`). A non-manager PATCH gets a `ForbiddenException`. That half of the concern is closed.

The **read** half was not, until 2026-09-03. `getLocation` checked org membership and
stopped there, so any member of the organisation could `GET /organizations/locations/:id`
and read the restaurant's billing email and phone while both designs hid the section from
staff in the client only. The second pass added
`assertManagerOrOwner(userId, restaurantId, "read the restaurant record")` to `getLocation`
(after the restaurant lookup, so a restaurant outside the org stays a 404 and the check
cannot leak existence through a 403). **G8 is closed**, the two postures agree, and the
Mudavym rebuild's copy now states a server rule rather than describing a gap. Pinned by
`organizations/get-location-is-role-gated.spec.ts`.

Account deletion is likewise not a stub: `deleteAccount` refuses when the caller is
the sole owner of any restaurant (`auth/auth.service.ts:2132-2176` — the loop and
throw at `:2141-2153`) before doing
anything destructive.

**Not real:**

| Gap | Evidence |
|---|---|
| Two loaders swallow every error | `profileApi.getMe()` fails into an empty `catch` with the comment "Graceful: page still usable with auth context data" (`Profile.tsx:110-118`) — so phone, `hasPassword` and linked providers silently show stale or blank values. The restaurant loader falls back to cached branch data on failure (`:143-146`), meaning the Restaurant form can display one name while the server holds another, and a save then overwrites |
| Upgrade section is unbuilt | `Profile.tsx:831-851` — a disabled "Coming soon" button. Honest, and correctly not counted as hollow. The rebuild replaced it with a Plan row that names the actual `subscription_tier`, and deliberately offers no upgrade control: plan changes belong to the restaurant, not to a personal profile (DESIGN-FOUNDATION §6) |
| No payment provider **credential** | The whole provider path exists as of 2026-09-03 (ADR 0110): SetupIntent, Elements on Stripe's origin, detach, default, reconcile, signed idempotent webhook. What does not exist on this deployment is `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `VITE_STRIPE_PUBLISHABLE_KEY` — each named on the page with the process it lives in. Charging is a separate decision (OD-23) and the client throws before it can call `payment_intents` — G13 |
| Nothing calls a model-context server | `user_mcp_connections` records declarations and nothing dispatches to one, so `last_used_at` is null on every row. Said on the page in one line rather than left to a quiet column — G9 |
| No session register, second factor, passkeys or API tokens | Measured 2026-09-03 across `apps/api-gateway/src`, `apps/web/src`, `supabase/migrations`: zero matches for `2fa`/`totp`/`mfa`/`passkey`/`webauthn`, no session table, no user-issued token. Four `Not built` rows in Register II — G11 |
| Churn is untracked | §5 stands: account delete and leave-restaurant are the two highest-signal events on the page and emit nothing (`lib/uxSignals.ts:15`, dark) |

## 11. Data flow

### Calls out

| Method | Path | Auth | Gateway controller | Returns |
|---|---|---|---|---|
| GET | `/auth/me` | JWT (`auth/auth.controller.ts:166-167`) | same | Profile + `hasPassword` + linked providers |
| PATCH | `/auth/me` | JWT (`:178-179`) | same | Updated name/phone (email read-only) |
| POST | `/auth/me/password` | JWT (`:188-189`) | same | 200 / validation error |
| GET | `/auth/me/linked-providers` | JWT (`:243-244`) | same | `{google, microsoft}` |
| POST/DELETE | `/auth/me/link/:provider` | JWT (`:252-253`, `:271-272`) | same | Link state |
| POST | `/auth/me/leave-restaurant` | JWT (`:287-288`) | same | Membership removed |
| DELETE | `/auth/me` | JWT + `@AllowUnverified` (`auth.controller.ts:307-313`) | `auth.service.ts:2132-2176` — sole-owner guard at `:2141-2153` | 200 `{success}`, then the page redirects to `/login` |
| GET | `/organizations/locations/:id` | JWT + `assertManagerOrOwner` (added 2026-09-03, after the restaurant lookup) | `organizations.controller.ts:109-117` → `organizations.service.ts` `getLocation` | Restaurant name/city/billing contact **+ `subscriptionTier`** |
| GET | `/mcp-connections` | JWT; user + restaurant from the token | `mcp-connections.controller.ts` | Declared model-context servers, revoked included; **throws** on a query error |
| POST | `/mcp-connections` | JWT | same | The stored server; 409 on a duplicate live name |
| DELETE | `/mcp-connections/:id` | JWT | same | The revoked server; 404 when nothing live matched |
| GET | `/payment-methods` | JWT | `payment-methods.controller.ts` | `{provider, methods}` — provider state beside the rows |
| POST | `/payment-methods` | JWT + `assertCanManageRestaurant` | same | **503 with the reason** while no provider credential is configured |
| DELETE | `/payment-methods/:id` | JWT + `assertCanManageRestaurant` | same | `{removed}`; 404 when nothing matched |
| POST | `/auth/logout` | JWT | `auth.controller.ts:150-153` | Blacklists the presented token only — there is no session register to clear |
| PATCH | `/organizations/locations/:id` | JWT + `assertManagerOrOwner` | `:92-107` → `organizations.service.ts:155-215` | 204 |

### Fed by

| Data | Producer | Live? |
|---|---|---|
| Account fields | Registration, and this page | Yes |
| Linked providers | Google/Microsoft OAuth (`auth.controller.ts:103,118`) | Yes |
| Memberships list | `user_restaurant_access`, via the auth store's `availableRestaurants` (rendered `Profile.tsx:775-800`) | Yes |
| Restaurant + billing contact | `/settings` locations section and this page write the same `restaurants` columns | Yes |
| Subscription tier | `restaurants.subscription_tier` (default `pilot`), now returned by `GET /organizations/locations/:id` | Yes (read-only; changed by nobody through this page) |
| Payment instruments | `payment_methods` — table and routes exist as of 2026-09-03; **no provider is connected**, so the table is empty by construction and the create path refuses with a stated reason | Table yes, provider no |
| Model-context servers | `user_mcp_connections` — written by this page, read by this page. **Nothing else reads or calls them yet** (G9) | Yes (declarations only) |

No agent and no cron writes anything this page reads. Unlike the rest of this
cluster, `/profile` has no dormant producer to depend on.

### Writes

| Write | Downstream reaction |
|---|---|
| `PATCH /auth/me` | Header user menu and sidebar name update on next fetch |
| `POST /auth/me/password` | Session unaffected; `hasPassword` flips true for OAuth-first accounts |
| Link / unlink provider | Changes which login paths work; unlink is refused if it would leave no credential |
| `POST /auth/me/leave-restaurant` | Removes the `user_restaurant_access` row — the user disappears from `/team`'s roster and from broadcast targets (`team.controller.ts:346-350`) |
| `DELETE /auth/me` | Irreversible; blocked while sole owner (`auth.service.ts:2141-2153`) |
| `PATCH /organizations/locations/:id` | Restaurant name/city/billing contact change everywhere they render, including `/settings` locations |
| `POST /mcp-connections` | A declaration only. Nothing downstream reads it yet — the register is currently its own sole consumer (G9) |
| `DELETE /mcp-connections/:id` | Soft revoke: the row stays, marked revoked, so a grant that once existed stays distinguishable from one that never did |
| `POST /auth/logout` | This browser's token is blacklisted; other devices are unaffected because nothing tracks them |

## 12. Design intent

**Should be:** the account page every role can use without a manager — identity,
credentials, which restaurants you belong to, and the exit.

| State | Handled? | Evidence |
|---|---|---|
| Loading | **No** | Both loaders are fire-and-forget `useEffect`s with no loading flag (`Profile.tsx:108-150`); fields simply populate late |
| Empty | Yes | "No memberships yet." (`:780`) |
| Error | **No** | Reads: two empty `catch` blocks (`:116`, `:143`). Writes: every mutation toasts (`:212-361`) — so the page reports what it changed but never what it failed to read |
| Permission-denied | Partial | Manager-only sections are hidden client-side (`:127,:158`); the server refuses correctly (`organizations.service.ts:184`) but a 403 has no UI |

**Where the UI misleads**

1. The restaurant fallback (`:143-146`) can render cached values that differ from the
   server's, and Save then writes the stale value back over the real one — the only
   data-loss path found on this page.
2. `Profile.tsx:445` — the support mailto falls back to `support@wineops.ai`. Not a
   string swap: that is a **domain** needing DNS and a mailbox (§7).
3. ~~`Profile.tsx:877` — "Permanently delete your WineOps account."~~ **Resolved 2026-09-02**
   — the line now says "Mudavym account" (§7). The rebuild says the same.

## 13. Roadmap

### Motions and overlays — the rows this pass owes (2026-09-06)

From the decisions in §1c. Owner packets: **packet 3** the motion pass, **packet 4** the
states owed, **packet 5** the gestures; a *page pass* is this page's own next opening.
The reasoning is in §1c and in [ADR 0133](../decisions/0133-one-motion-per-act-across-every-page.md);
these are the rows.

1. A **step-up enrolment sheet** on this page — "How this house knows it is you": devices, passkey enrolment, TOTP and the manager's four digits. The two-hour step-up assumes a credential exists and nothing enrols one. **packet 4**
2. The manager's four digits gain a second, non-recall path — the manager's own passkey as a peer, and the field accepts paste from a password manager. WCAG 2.2 SC 3.3.8, Level AA. **packet 4**
3. `pages/profile/next/ProfileNext.tsx` — the session row's "Show the working" moves from `settle` 320 to `turn` 420. **packet 3**
4. The four holds carry packet 0's `boundSummary` read-back — the census draws failure on four of sixty rows and success on none. *page pass*
5. `pages/profile/next/PaymentRegister.tsx` carries two ceremonies ("Charge this first", "Removed") and has **no test file at all**; `ProfileNext.test.tsx` has zero `HoldToApprove` references. *page pass*
6. This page has **no row in the overlay census** despite live ceremonies. *census owner*

> **Added 2026-09-05 by the crew text (ADR 0121).**
> 0. **Show the person who would be texting them** (§9 G-TXT-P1), and split
>    "not yours to see" from "could not be read" on the crew count (G-TXT-P2).


> **Added 2026-09-04 by the collapse.**
> 1. **Give `useMudavymDesign` a settled state.** It returns `false` while the
>    per-restaurant flag is in flight, so a read gated on `!useMudavymDesign(...)`
>    fires once before the verdict arrives. This page now has two such reads
>    (`locationQ`, `paymentsQ`). The fix is a tri-state (`true | false | 'unknown'`)
>    in `apps/web/src/lib/mudavym/useMudavymDesign.ts` — a file every gated page
>    shares, so it is a wave-level change, not a page's.
> 2. ~~**Port the card panel to `/connections`** (§9 G12a) — `StripeCardPanel.tsx` plus
>    `stripe-js.ts`, and the four `pf-ui` primitives they use.~~ **Done 2026-09-05:**
>    both files moved to `components/mudavym/` and the `pf-ui` primitives were redrawn
>    inside the component, so there is one panel and two callers rather than two panels.
> 3. **The model-context ownership fork is still open** (ADR 0114, "what this decision
>    does NOT settle"). This pass split the register along the gateway's own role
>    gates, which is the cut the CODE already makes; it does not answer whose a
>    model-context server is.

> **Status 2026-09-02.** Item 1 is **done in the Mudavym rebuild only**
> (`apps/web/src/pages/profile/next/`, flag `mudavym_design_profile`, OFF by default).
> The shipping page still carries both silent reads, so this stays open until the flag
> is on for everyone or the legacy page is retired. Item 3 is now *degraded honestly*
> rather than fixed — the rebuild says "no support address is configured" instead of
> linking to a dead domain, but the domain and mailbox are still owed. Items 4 and 5 are
> **done in the rebuild**: both fetches have loading states, and permission-denied is
> rendered with a 403 branch on the write. Items 2 and 6 are untouched.
>
> **Status 2026-09-03 (second pass).** Of the eight gaps the first pass filed, **four are
> closed**: G1 (the guard reads this surface as shipped), G2 (`subscription_tier` is
> returned and the plan is a figure), G4 (MCP: module + table + migration + three routes),
> G5 (payments: module + table + migration + three routes, provider deliberately absent),
> and G8 (`getLocation` is role-gated — the profound fix, so the page's permission copy
> states a server rule instead of describing a gap). Three new ones were filed for what the
> build newly exposed: **G9** (nothing calls a declared MCP server), **G10** (no provider
> credential), **G11** (no session register / second factor / passkeys / API tokens).
>
> **Status 2026-09-03 (third pass — Register V only).** **G10 is closed** by ADR 0110, and
> the first thing the pass established is that G10's own wording was false: nothing in the
> repo spoke to Stripe, so "one credential away" would in fact have been "one credential
> away from an operator-typed instrument". Built: `apps/api-gateway/src/billing/**` (Stripe
> client with a `FORBIDDEN_PATHS` guard so no charge can be expressed, pure HMAC verifier,
> customer mapping, provider→row mirror, SetupIntent / sync / webhook routes), the migration
> `20260903110000_billing_stripe_provider.sql`, and Register V rebuilt around Stripe
> Elements with hold-to-approve as the commitment. Two new gaps filed for what the build
> exposed: **G13** (three environment variables and one Stripe-dashboard endpoint
> registration — a deployment step, not code) and **G14** (two lines in `app.module.ts`,
> outside this page's paths, verified by applying them temporarily and reverting).
>
> Remaining, in the order it is worth doing — **G11's session half** (a `user_sessions` row
> per issued refresh token: it is the cheapest of the four and it turns one honest row into
> the list every account page in the field shows, plus a real "sign out everywhere"),
> **G3** (stop `listConnections` swallowing its query error — the one place left where this
> page must *infer* a failed read), **G14** (two lines the parent adds to `app.module.ts`,
> which is what makes the billing routes exist at all), **G13** (three variables and the
> Stripe-dashboard endpoint; charging still blocked on OD-23), **G9** (an
> MCP client, blocked on a handshake decision), then **G7** / **G6**. All specified in §9.

> **Status 2026-09-03 (third pass, build D of four — the MCP runtime).** **G9 closes**:
> `POST /mcp-connections/:id/probe` performs the Model Context Protocol handshake over
> Streamable HTTP and the row records status, both timestamps, the server's name/version
> and its tool names; the credential the table deliberately lacked is now
> `secret_encrypted` under `MCP_CONNECTION_SECRET_KEY`, refused rather than stored in the
> clear when no key exists. **Three filed for what the build newly exposed or deliberately
> withheld:** **G16** (DNS rebinding — the endpoint guard resolves, then `fetch` resolves
> again), **G17** (a probe is manual; a scheduled one wants the per-tenant scheduler's
> quiet hours and back-off), and **G18** (tool invocation — refused, and it is a DECISION
> for the founder rather than a build: does ADR 0013's commitment guardrail extend to a
> third-party tool call, and what is the human step?). Recorded in ADR 0107.
>
> **Audited the same day and FAILED on one blocker — an SSRF bypass via IPv4-mapped IPv6
> literals, reproduced live through the compiled `probe()` against a loopback stub in the
> default posture. Fixed: the address is parsed to sixteen bytes rather than string-matched,
> and the vetted address is pinned into the socket, which closes **G16** as well. Two
> coverage defects closed with it (a spec for the guard itself; tenant scope pinned at the
> query), both proven by re-breaking them.**
>
> Order it is worth doing, from here: **G18** is a question, not work — asking it is the
> cheapest thing on this list and it unblocks the most. Then **G11's session half**, then
> **G3**, then **G17** (a scheduled probe), then G10 / G7 / G6.

1. **Stop the silent read failures** (`Profile.tsx:110-118`, `:143-146`) — surface
   the error, and do not let a cached restaurant name become a write. Highest value:
   it is the only overwrite risk on the page.
2. **Track leave-restaurant and delete-account** (§5). Churn is the one thing this
   page uniquely observes and it is thrown away today. Blocked on the signal spine
   (`lib/uxSignals.ts:15` ships dark, and its consent switch governs nothing — see
   settings.md §10).
3. **Fix the support address** — `VITE_SUPPORT_EMAIL` plus a real mailbox, or the
   rebrand leaves a dead `mailto:` (§7).
4. Loading state for both fetches.
5. 403 branch for the manager-only writes.
6. `v3.0-TECH-DEBT.md:502` (the "dashboard profile card with no handler", L102) was
   never located — leave it tracked there, not here.

---

## 13a. The Connections surface — where the outward connections belong (2026-09-03, fourth pass)

> **Status: DECIDED and BUILT, 2026-09-03.** The founder chose **"Own route,
> role-gated"**. `/connections` exists behind `mudavym_design_connections`, its
> page note is **[[connections]]**, and the decision is
> [ADR 0114](../decisions/0114-connections-are-the-houses-profile-is-the-persons.md).
> Retire-to-write is satisfied by that note **superseding the house half of this
> one**: Registers IV, V and VI are described there from now on, and this section
> is reduced to what `/profile` itself must do.
>
> **What changed on THIS page:** one pointer line above the three house registers,
> rendered only when the flag is on (`ProfileNext.tsx`, `ConnectionsPointer`).
> Nothing was moved out. Moving a register before the founder has seen the
> surface it moves to would build it twice, and with the flag off `/connections`
> redirects here — so this page remains the only true description of those three
> registers until the founder says otherwise. `settings.md` is another builder's
> file and was not touched.
>
> **The three defects this section filed are closed.** **G19** — `GET
> /payment-methods` and `GET /billing/provider` now run
> `assertCanManageRestaurant`, with a spec each; the existing test asserting the
> opposite was green and pinned the defect, and its replacement says so. **G21** —
> `listConnections` takes the restaurant from the token and filters on it, with a
> two-tenant spec; a grant whose `restaurant_id` is null is listed everywhere
> carrying `restaurantId: null` rather than dropped. **G20** — `/connections`
> reads the same catalogue route the other three surfaces read; there is no
> fourth copy.
>
> **One thing this section got wrong.** It described the vendor-facing public
> page as the house's. `vendor_portal_pages` is keyed by `vendor_catalogue_id` /
> `provider_id` (`20260805155901_vendor_portal.sql:27-33`) — it is a **vendor's**
> page, and a house has none. `/connections` states that on the row.

### The founder's note, and the answer

> *"Like the design, research once more, and be definite about comprehensiveness of
> design, MCP's to connectors, to Third party apps and so on. Maybe not in profile
> you're right."*

**You are right.** Three of this page's seven registers are about the house, not the
person — and one of them is the house's cards on file, on a page every member reaches.
The full argument, the ten-product survey with URLs and the twenty-eight-item
comprehensiveness checklist are in **`DESIGN-FOUNDATION.md` §6b**; the surface is drawn
in **`.planning/sketches/097-integrations-home/`** (`connections.html`,
`profile-after.html`, `checklist.html`). This section records only what `/profile`
itself must do about it.

### What leaves this page, and what it is replaced by

| Register | Today | Why it does not belong here | Where it goes |
|---|---|---|---|
| **V — How the house pays** | `PaymentRegister.tsx`, "an instrument added here charges the house" (`:240`) | `payment_methods` has **no `user_id` column at all** (`20260903094600_payment_methods.sql:53`). It is a house object on a personal page — and the *read* is ungated (below) | Connections, Register II |
| **IV — Model context** | `McpRegister.tsx`, "Servers the house agents may call" (`:319`) | The table's own comment disagrees with the register's lead — *"acts with the user's authority, so it hangs off the user"* (`20260903094500_user_mcp_connections.sql:53-54`). Both are in the tree, and both cannot be true | Connections, Register I — **after** the founder settles the scope (Q2) |
| **VI — The house** | `HouseRegister.tsx` — restaurant record, memberships, plan | Never personal; it is here because there was nowhere else | Connections' header, or `/settings` |

`/profile` keeps **Register I** (who you are), **Register II** (what protects this
account — the four `Not built` rows are the personal gap, G11), **Register III** (what
is attached to *you*: sign-in links, your own Drive/Excel grants, your devices) and
**Register VII** (the exit, where the seal is pressed once). That is the same cut Stripe
makes between Personal and Business settings, and the same one GitHub makes between a
user's authorized OAuth apps and an organization's installed Apps.

**The reciprocal obligation.** Connections must list every personal grant that acts
inside the house — named, with its scope and last action, and **explicitly not
revocable there**, linking to the owner's profile. One list, two owners marked, revoke
where the owner is. Without that, moving payments off `/profile` just creates a second
incomplete list, which is the fault the surface exists to fix.

### The defect this pass measured, which is not a design question

**`GET /payment-methods` and `GET /billing/provider` have no role check.**
`payment-methods.controller.ts:65-79` and `billing.controller.ts:66-78` take any
authenticated member of the restaurant; every *write* on both modules calls
`assertCanManageRestaurant` (`:92-98`, `:114-125`, `:138-148`) and the page gates only
the *controls* on `isManagerOrOwner` — the card rows themselves render for every role
(`PaymentRegister.tsx:370-385`). Today the register is empty by construction, so nothing
leaks. The day `STRIPE_SECRET_KEY` is set (G13), **a staff member's own `/profile` shows
the house's cards on file.** Toast gates this behind `Account Admin > Manage
Integrations`; Square behind `account & settings`. The precedent for the fix is already
in this repo: `assertManagerOrOwner(userId, restaurantId, "read the restaurant record")`
on `getLocation`, added 2026-09-03 and pinned by
`organizations/get-location-is-role-gated.spec.ts`. **Filed as G19 (see §9).** It is
worth closing whether or not the split happens.

### Two more measurements the split would fix

- **The same catalogue is rendered three times and each shows a different subset** —
  `components/settings/IntegrationsAuth.tsx:161`, `settings/next/ServicesSection.tsx:128`
  and `profile/next/ConnectionsRegister.tsx:224` all navigate to `/authorize/:id`, while
  POS, sender identity, the calendar feed and payments appear in **none** of them. There
  is no one list anywhere in the product. **G20.**
- **A grant is recorded against a restaurant and then listed across all of them.**
  `integration_oauth_connections.restaurant_id` is written at
  `integrations-oauth.service.ts:150` and `:439`, but `listConnections` filters on
  `user_id` alone (`:476-484`). A Drive grant made while standing in restaurant A is
  listed while standing in restaurant B. **G21.**

### What the parent must decide and add (nothing here was built)

If the recommendation is taken as a **route**, these lines are outside this page's paths
and belong to the parent:

- `apps/web/src/App.tsx` — a `<Route path="/connections">` inside the `DashboardLayout`
  block, alongside `/settings`.
- `apps/web/src/lib/mudavym/useMudavymDesign.ts` — `'connections'` in `MUDAVYM_PAGES`,
  plus `mudavym_design_connections` in the gateway's `ACTIVE_FEATURE_FLAGS` and a flags
  migration.
- `apps/web/src/components/layout/Sidebar.tsx` — a `NavItem`
  `{ name: 'Connections', href: '/connections', icon: Plug, description: 'What acts for
  this house — the till, payments, senders and model-context servers.' }`. **`NavItem`
  has no role field today** (`Sidebar.tsx:42-50`), so a manager-only entry needs one; the
  alternative is showing it to everyone and letting the page refuse, which is the weaker
  shape.

If it is taken as a **Settings section** instead, it is one new `SectionId` in
`settings/next/st-format.ts:82` and the retirement of `services` / `pos` / `email` into
it — but that file belongs to the settings builder, so it is named here and not touched.

### What was deliberately not done this pass

*(Written when this section was a recommendation. Kept, because it records why the
build waited.)* No page code changed; the founder asked for research and a
recommendation, and a page built before the route is decided is a page built
twice. The sketches carry full example data at 1440 (`shots-097/`), no emoji, and
every claim about the repo carries its `file:line`.

### What is still not done, now that it is built (2026-09-03)

- **Registers IV, V and VI stay on this page.** They gain a pointer, not a
  removal — see the status block above.
- **Declaring a model-context server stays here too.** The form and its secret
  field are built on this page; `/connections` disables its own "Declare a
  server" control saying exactly that (`connections.md` §9 G-C8).
- **The model-context register on this page is now house-scoped.** `GET
  /mcp-connections` returns the restaurant's servers rather than the reader's
  (ADR 0114), so this page shows what the house declared and offers the reader's
  own consent. That is the correct shape for both pages and it means this page's
  register is no longer strictly personal — the reason it should move once the
  founder has reviewed `/connections`.
- **G3 stands.** `listConnections` still returns `[]` on a query error, so this
  page's workspace rail still infers a failed read from an empty array against a
  non-empty catalogue. `/connections` does not depend on that inference — its
  house-grants route throws — but the personal list here still does.
