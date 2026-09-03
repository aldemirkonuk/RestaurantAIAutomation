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
links: ["[[PAGE-CONTRACT]]", "[[login]]", "[[settings]]"]
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
  *The house* · *Ruled off*. **One row shape draws every ATTACHMENT**
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
  scoped to the user AND the restaurant on the token. **"Last call" is `—` on every row
  and says why in one line** — nothing in this product dispatches to a model-context
  server yet, so `last_used_at` is nullable rather than defaulted, and the register states
  that a row is a declaration, not traffic. Revoked rows are kept, marked revoked
- **Payment register — REAL table and routes as of 2026-09-03, provider still absent.** A
  list model over a new gateway module (`apps/api-gateway/src/payment-methods/`) and a new
  table (`payment_methods`, migration `20260903094600`): cards / bank (ACH) / Apple Pay /
  invoice terms, with `brand`, `last4`, `exp`, `is_default`, `provider`, `provider_ref`.
  **"Add a card" opens the real form and its submit is `disabled` with one line** —
  *"Stripe is not connected — this saves nothing until it is"* — and the gateway agrees:
  `POST /payment-methods` returns 503 with the same reason while no credential is
  configured. The empty register says WHICH kind of empty it is, from the server's own
  `provider.connected` field: not "you have not added a card" but "no provider is
  connected, so no card can exist". Its chip is **`Provider not connected`**, a state of
  its own — reusing `Not built` there would have said the same word about a register with
  a table, a module and three working routes as about a feature with zero code behind it,
  and the two have completely different fixes (an env var versus a build)
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

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_profile`)

Canonical copy: `apps/web/src/pages/profile/next/MOTIONS.md`. Every motion is a token
from `apps/web/src/lib/mudavym/motion.ts`.

| id | token | curve · ms | fires |
|---|---|---|---|
| `pf-open` | `settle` | `cubic-bezier(.16,1,.3,1)` · 320ms | the opening block — wordmark, role/location line, the name in Fraunces, the standing sentence — once on mount; opacity + 6px rise via `animate()` |
| `pf-expand` | `settle` | `cubic-bezier(.16,1,.3,1)` · 320ms | a connection row's panel: "What you granted" / "What it would ask for" (Workspace), "Scopes and dates" (a model-context server), "Show the working" (the session row). CSS `grid-template-rows: 0fr → 1fr` (053's row-expand, the founder's named favourite) |
| `pf-ink` | `ink` | `cubic-bezier(.16,1,.3,1)` · 160ms | hover/focus on rows, buttons and membership entries — border and ground only; nothing translates or scales |
| `pf-pour` | `pour` | `linear` · 620ms | the İznik fill under **Hold to delete this account** inside `HoldToApprove`; an early release retreats on `tuck` (spring 380/32, ~300ms) and says what did not happen |
| `pf-stamp` | `stamp` | sampled spring 500/26 (~11% overshoot) · 360ms | the seal landing when that hold completes — the only overshoot on the page, and the only place the seal is pressed |

Deliberate non-motions: no stagger or arrival (an account page is a reference, not an
event); no tally (the plan became a figure on 2026-09-03 and still does not animate — it
is a label read once, not a total that moved); no skeleton sheen (loading is stated in
words, so a moving bar would make "in flight" and "failed" look alike again); chips do not
transition; the two forms that open ("Add a server", "Add a card") swap in with no
transition — a form whose submit is disabled must not arrive with a flourish that would be
the only part of it that worked; a revoked model-context server is not animated away,
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

1. **Connect the MCP server, not just declare it.** The obvious next move is a handshake:
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
- **The Nest boot guard could not be run whole.** `scripts/check_gateway_boots.sh` fails on
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

## 2. Entry
In-degree 3 per [PAGE_MAP](../foundation/PAGE_MAP.md): header user menu (`Header.tsx:277`), sidebar bottom nav (`Sidebar.tsx:166-170`), plus `/help`, `/privacy`, `/settings` link here. Inside `DashboardLayout` + `ProtectedRoute` (`App.tsx:247-252,286`).

## 3. Files
- Route binding: `apps/web/src/App.tsx:347` — `<PageGate page="profile" legacy={<Profile/>} next={<ProfileNext/>}/>` (both lazy, `App.tsx:92,121`)
- Legacy: `apps/web/src/pages/Profile.tsx` (907 lines)
- API module: `services/api/profile.ts`; `components/auth/GoogleLinkButton.tsx`
- **Mudavym rebuild** (`apps/web/src/pages/profile/next/`, flag `mudavym_design_profile`):
  `ProfileNext.tsx` (shell, opening voice, Register VII / the exit) ·
  `useProfileNextData.ts` (six reads and twelve writes, tenant-keyed) ·
  `IdentityRegister.tsx` (I) · `SecurityRegister.tsx` (II) ·
  `ConnectionsRegister.tsx` (III — sign-in + workspace) · `McpRegister.tsx` (IV) ·
  `PaymentRegister.tsx` (V) · `HouseRegister.tsx` (VI) ·
  `GoogleLink.tsx` (the one real token acquisition) ·
  `pf-ui.tsx` (the row shape, chip, rail, card, field, select) · `pf-format.ts` ·
  `ProfileNext.test.tsx` (29 tests) · `MOTIONS.md`
- **Gateway, built for this page (2026-09-03):**
  `apps/api-gateway/src/mcp-connections/` (module, controller, service, dto, 2 spec files)
  · `apps/api-gateway/src/payment-methods/` (module, controller, service, dto, 1 spec file)
  · `apps/api-gateway/src/organizations/get-location-is-role-gated.spec.ts`
- **Migrations:** `supabase/migrations/20260903094500_user_mcp_connections.sql` ·
  `supabase/migrations/20260903094600_payment_methods.sql`

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
| POST | `/payment-methods` | not called by the page (its submit is disabled) | `JwtAuthGuard` + `assertCanManageRestaurant`; **503 with the reason** while `STRIPE_SECRET_KEY` is unset |
| DELETE | `/payment-methods/:id` | `removePaymentMethod` | `JwtAuthGuard` + `assertCanManageRestaurant` |
| POST | `/auth/logout` | `AuthContext.logout`, via the Security register's "Sign out of this browser" | JWT; blacklists the presented token only |

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
- `VITE_SUPPORT_EMAIL` (`Profile.tsx:445`). The rebuild reads the same variable and, when
  it is unset, renders a sentence instead of a `mailto:` to the dead fallback domain.
- `VITE_GOOGLE_CLIENT_ID` (`lib/googleIdentity.ts:73`) — without it the Sign-in rail's
  Google row says Google sign-in is not configured on this deployment rather than
  rendering a button that cannot work.
- Role gating in-page: `isManagerOrOwner` gates the Restaurant/Payment/Memberships sections and the locations fetch (`Profile.tsx:127,158`). The rebuild keeps the gate on the *fetch and the controls* but renders the section either way (permission-denied is a state, not an absence).
- Theme via `ThemeContext`.
- **Mudavym redesign gate:** feature flag `mudavym_design_profile`
  (`apps/api-gateway/src/settings/feature-flag-registry.ts:172-177`, `defaultValue: false`),
  read through `useMudavymDesign('profile')` and `<PageGate page="profile" …>`
  (`App.tsx:347`). Per-browser override: `localStorage["mudavym.design.profile"]` —
  `1|true|on` forces the redesign, `0|false|off` forces legacy, absent falls through to
  the flag (`lib/mudavym/useMudavymDesign.ts:60-79`).

## 9. Gaps
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
| G9 | nothing calls a model-context server | **MCP dispatch.** `user_mcp_connections` records declarations; no agent, cron or route in this product calls one, so `last_used_at` is null on every row and stays null. The page says so in one line rather than letting the column read as "idle". Closing it means an MCP client in the gateway (or the orchestrator) that stamps `last_used_at` on each call — and, before that, a decision on the handshake: which transports, whose credential, what happens when a trusted server starts exposing a new tool. The table deliberately has **no token column** until that decision exists |
| G10 | `apps/api-gateway/src/payment-methods/payment-methods.service.ts` (`assertProviderConnected`) | **No payment provider credential.** Everything except the credential is built. Setting `STRIPE_SECRET_KEY` plus a hosted-checkout callback that posts the provider's `pm_...` reference to `POST /payment-methods` switches the register on; the page's disabled submit then becomes a redirect into the hosted flow. Blocked on OD-23 (pricing), not on code |
| G11 | `apps/api-gateway/src/auth/**` | **No session register, no second factor, no passkeys, no personal API tokens.** Measured 2026-09-03. The Security register renders four `Not built` rows carrying these measurements. The session one is the cheapest and the most valuable: a `user_sessions` row per issued refresh token (device, address, last-seen, revoked_at) would turn one honest row into the list every account page in the field shows, and would make "sign out everywhere" possible |
| G12 | `scripts/check_no_seeded_defaults.py` (`SERVER_SCAN_ROOTS`) | **The two new gateway modules are outside the S5 arm.** `SERVER_SCAN_ROOTS` lists only `apps/api-gateway/src/team` and `apps/api-gateway/src/restaurants`, so `mcp-connections/` and `payment-methods/` get no automated check that a row-shaped literal is not asserting a measurement nobody supplied. Reviewed by hand and clean — the only literals in either module are the provider's refusal sentence and the `'stripe'` provider id — but hand-checking is not a ratchet. `scripts/` is outside this page's paths, so this is filed rather than fixed. One line each in `SERVER_SCAN_ROOTS` closes it |
| G7 | `apps/api-gateway/src/auth/auth.controller.ts:487-491` | there is no **authenticated** way to fetch the identity-provider registry. `POST /auth/sign-in-methods` is `@Public()` and rate-limited by IP (10 / 600s), which a shared restaurant network would exhaust. An authenticated `GET /auth/me/sign-in-methods` returning `declared`/`methods`/`unavailable` would let the Sign-in rail use the server's own labels and reasons instead of page prose |

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
| No payment provider | `payment_methods` and its routes exist; `STRIPE_SECRET_KEY` does not. The register lists, the form opens, and both the submit and `POST /payment-methods` refuse with the same sentence. Blocked on OD-23 (pricing), not on code — G10 |
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
> Remaining, in the order it is worth doing — **G11's session half** (a `user_sessions` row
> per issued refresh token: it is the cheapest of the four and it turns one honest row into
> the list every account page in the field shows, plus a real "sign out everywhere"),
> **G3** (stop `listConnections` swallowing its query error — the one place left where this
> page must *infer* a failed read), **G10** (one credential, blocked on OD-23), **G9** (an
> MCP client, blocked on a handshake decision), then **G7** / **G6**. All specified in §9.

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
