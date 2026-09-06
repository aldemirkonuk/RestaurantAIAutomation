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
- **Every change to how the house pays is HELD, and the server redeems the seal**
  *(2026-09-04; ADR 0110's addendum)*. **Charge this first** and **Remove** are
  hold-to-approve on every instrument row: the gesture mints a one-time token for
  its own act when it begins, and the write carries it back to be spent exactly
  once. A mint that fails approves nothing and says so; a refused write prints the
  gateway's own sentence on the row it was refused for, never as a page-wide
  banner and never as a status code.
- **A card is added here, in the provider's own fields** *(new 2026-09-05; §9
  G-C9 closed)*. `components/mudavym/StripeCardPanel.tsx` — the SAME component
  `/profile` mounts, moved out of that page's directory rather than copied — opens
  under Register II. The number is typed into Stripe's iframes on Stripe's origin
  and never reaches this page, this bundle or the gateway. The control sits in
  exactly one place at a time: the empty row's control column when nothing is on
  file, an action bar under the list when something is. When it cannot open, the
  disabled control carries the reason as a sentence — the gateway's own words when
  the gateway sent them (`STRIPE_SECRET_KEY`), ours when the missing half is this
  bundle's (`VITE_STRIPE_PUBLISHABLE_KEY`) — never an empty box and never a form
  to type a brand and four digits into by hand.
- **Adding a card is sealed at the gateway as of 2026-09-05, and the panel does not
  mints — so it is SEALED here too.** ~~Charge-this-first and Remove each spend a
  one-time token; the add confirms a SetupIntent on Stripe's origin and then
  reconciles, and neither of those two routes takes a seal today.~~ Both of those
  routes now do: `POST /billing/setup-intent` redeems a `create` seal before it
  touches Stripe, and `POST /billing/sync` proves the same seal by reading its id
  back off the intent at the provider (ADR 0110's third addendum). And
  `StripeCardPanel.tsx` now mints on a hold that comes before the client secret
  exists: *Hold to open the card form* mints `create` through this hook's
  `mintPaymentSeal` and spends it on the intent, and the confirm hold syncs
  naming the intent so the provider proves the same seal back. A mint that fails
  opens no form and says so. See `profile.md` §9 G-PAY-SETUP, closed.
- **Register III — personal grants that act inside this house.** Every OAuth
  grant recorded against this restaurant, named with its owner, plus a count of
  live grants belonging to people who work here that carry no recorded
  restaurant. A manager may stop the house using one; **never** revoke it, and
  **never** approve it.
- **The catalogue** of what could be connected, read from the same route the
  other three surfaces read — an unconnected entry is drawn at the same weight
  as a live one. **Four entries as of 2026-09-04**: Google Drive, Microsoft
  Excel, and the house's mail as **two grants each asking for one thing** —
  *Gmail — sending only* (`gmail.send`) and *Gmail — reading vendor replies only*
  (`gmail.readonly`). The second is the founder's condition on the first: the send
  grant stays send-only *on condition the house can also receive on its own
  mailbox and have the whole comms there* (ADR 0118 D8). Both rows appear here
  for free, because this register maps the catalogue rather than a hand-written
  list — and until 2026-09-04 the **Connect button on both led nowhere**: see §13
  item 7.
- **Every catalogue row now states where what it fetches lands, and who can see
  it** — a required four-part `dataHandling` block on the consent screen at
  `/authorize/:id` (what we read · what we never read · where it lands · who can
  see it), served from the same constant the scope list comes from. The reading
  grant's answers are the load-bearing ones: mail from the vendors in this
  house's book and nothing else; anything else discarded unread; landing in
  `procurement_conversations`; visible to everyone who works in this restaurant
  and nobody outside it.
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

- **The house's text senders** *(ADR 0121, 2026-09-05)*. Two rows in Register I —
  **WhatsApp Business** and **SMS sender** — because they are different products
  with different registrars, different fees and, in Türkiye, different
  *capabilities*: an alphanumeric Sender ID there is one-way and cannot receive
  a reply, so one averaged row would have claimed a conversation the channel
  cannot hold. Each row offers the founder's two paths — *bring our own* and
  *ask Mudavym to register one* — **both disabled, carrying the server's own
  sentence** rather than one this page invented: no provider credential for a
  per-house sender exists on this deployment. The rows are drawn at full weight
  with nothing connected, which is this page's structural rule applied to its
  newest attachment: a live POS feed and an unconnected sender get the same
  amount of design, so an absence cannot be flattered by being drawn thinner.
  `Last proven reachable` is empty and says **never probed**, which is neither
  "unreachable" nor health (ADR 0107). An unread register is named and is never
  allowed to fall through to the "none" row — an outage must not read as a fact
  about the restaurant.

- **A licensed distributor connection, defined and not offered** *(ADR 0126,
  2026-09-05; endpoint only, no component reads it yet)*. `GET
  /distributor-feed/:jurisdiction` (or `me`) returns, per distributor measured
  for this house's state, the verbatim `robots.txt` rule, the verbatim terms
  clause, the day it was measured, the evidence URLs, and one sentence saying
  what is true today. Every row is `connectable: false` and the connection
  itself carries `offerable: false` with its reason: no Illinois distributor
  publishes a feed a house could connect, and two forbid an automated reader in
  their own terms. There is no declare route, no credential column and no
  fetcher.
- **A manager states what a sender's price code means** *(ADR 0126 §7, the
  founder 2026-09-05: "Manager maps it, recorded on every row"; endpoint only)*.
  `GET/POST /distributor-feed/codes/:distributorKey` and
  `POST /distributor-feed/codes/:distributorKey/:mappingId/withdraw`, all three
  manager-or-owner through `assertCanManageRestaurant`. An EDI 832 prices each
  line under a `CTP02` code whose meaning X12 leaves to the two trading
  partners, so the person holding their own distributor's guide says what it
  means — once, with the evidence they had, under their name. **Nothing is
  seeded and there is no default**: a code nobody has mapped is still refused,
  and a code with two live meanings is refused rather than resolved by recency.
  Every price the statement admits carries its id in a real column, so one query
  finds them all; withdrawing needs who, when and why, keeps the statement,
  frees the code for a corrected one, and **marks** the rows it admitted by join
  without deleting or rewriting one.

- **The house's own copy of its vendor mail names WHOSE Drive it is in** (ADR
  0118 D16; the founder's answer to question 1, 2026-09-05: "As built, owner's
  name printed; Shared Drive later"). A `google_drive` grant is
  `UNIQUE (user_id, integration_id)` — it belongs to a PERSON — so an armed
  archive puts the house's ten-year record in one colleague's personal account,
  and it leaves when they do. The row sits inside the personal-grants register
  because the archive IS one of those grants doing a house job, and it prints
  the folder it writes into, whether it is exporting, and the sentence naming
  the owner
- **Three owner states, and never a blank.** A name that was READ prints
  `Kept in <name>'s Google Drive`; an account that records no name names the
  address instead and says the name is genuinely absent; a read that FAILED says
  the name could not be read and that somebody owns the archive. The sentence is
  composed by the gateway (`GET /communications/archive`, `owner.keptIn`) and
  printed verbatim, because only the server can tell a failed read from a
  nameless account — `peopleFor` on the sibling house-grants route already
  returns an empty map on error, so a name-shaped hole would have told a house
  its record sits in nobody's Drive
- **Licensed distributors — what yours will and will not send you** *(new
  2026-09-05; ADR 0126, the founder's batch 56)*. A panel between Register I and
  Register II — deliberately **not** a fifth register, because every distributor
  on it is something that **cannot** be attached, and a register of nothing is a
  worse lie than no register. Each row prints the distributor's **robots rule and
  terms clause verbatim**, the **day they were read**, `connectable: false` and
  the measured reason. There is no Connect control anywhere on it, and the page
  says why in the gateway's own sentence
- **A portal whose terms are UNREAD says so** *(the correction this pass owed)*.
  The SG Proof row used to quote `southernglazers.com`'s Terms of Use as if they
  governed the buyer portal; those Terms define "Website" as that corporate host,
  and `shop.sgproof.com`'s own terms have never been read — its visit window was
  shut on both passes. The row now says the portal's position is unknown, and
  that an unread term is not a permissive one
- **The two ways in, and both of them are real controls.** *Hand over a file you
  already have* posts to `POST /procurement/documents` — the **same door every
  invoice goes through**, not a second one — with the sender named for a
  catalogue. *Ask your Sales Consultant* downloads the invoice-feed request
  letter the house signs on its own letterhead. **Neither holds a distributor
  login, and this product never sends the letter**, which the panel says beside
  the control rather than leaving to be assumed
- **A catalogue's answer is per line, and never a bare zero.** An EDI 832 comes
  back with what was priced (and under whose statement), every refused line with
  its reason, and — when the reason is a price code nobody at this house has
  stated a meaning for — **the codes by name**, because that is the one refusal a
  person can fix in five minutes. Three states are kept apart that a count would
  collapse: admitted, already on the record at that exact price, and **could not
  be written**, which is never counted as admitted. A mapping read that FAILED
  refuses the whole document with the read's reason rather than refusing every
  line as unmapped and blaming the distributor for our own failed read
- **The price-code register lives in the distributor row** (ADR 0126 §7; the
  founder, batch 59: *"Build it on /connections in the distributor row"*). Under
  each distributor: what this house has said that sender's codes mean, and a
  form to say it. Each live statement prints the code, the meaning, **the
  evidence the manager had**, and *stated by <name> on <date>* with the code
  field beside it; each withdrawn one is **kept**, with its reason and its day,
  and says so. Withdrawing is a ceremony, not a button: it asks for the reason
  first, and what comes back is the gateway's own sentence about how many prices
  that statement admitted — a number, or **unknown**, never a reassuring zero
- **The form refuses three things before it sends anything**, each saying
  *nothing was sent*: a blank code, a blank meaning (there is no default trade
  level and there will not be one), and blank evidence. It refuses **nothing the
  gateway would admit** — the code's shape, a code already live, a session that
  resolves no name are all the server's judgements, and its sentence is printed
  verbatim rather than paraphrased
- **The refused code is a link into the form.** An 832 that came back with
  `unmappedCodes` prints each one as *State what MSR means*, which fills that
  sender's form in and focuses it. An upload that named no sender says why there
  is no link instead of drawing a dead one
- **Owner and manager only.** A staff account never reaches the register at
  all: `ConnectionsNext.tsx:274-292` returns the whole page's written refusal
  (*"This page is for managers and owners"*) **before** `DistributorFeedPanel`
  is mounted, which is the admission recorded at line 65 above and is unchanged.
  The panel's own `canManage=false` state — the form, the withdraw control and
  the code field disabled and never hidden, with the sentence saying the gateway
  refuses both acts for anyone who is not a manager or an owner (ADR 0083) — is
  a **tested defence for any page that later admits staff**, not a state a staff
  member sees on `/connections` today. The prop **defaults to false**, so a
  panel mounted somewhere that forgot to pass it refuses rather than admits: a
  missing prop must not read as permission (ADR 0051). *(Corrected 2026-09-06,
  batch 62 Q3 — the founder: "Keep the page-level refusal; correct the note".
  The bullet this replaces claimed staff saw the register greyed, which
  contradicted line 65 and could not happen.)*
- **A failed read of the statements is a failure with its reason**, per sender
  and never shared: the gateway's own sentence when the gateway could not read
  the table, this browser's when the request never landed, and in both cases the
  words *unknown, not none*. One distributor being unreadable never blanks
  another's
- **The declared currency sits beside the sender picker.** Three characters, no
  default and no placeholder, sent as `declaredCurrency`; a half-typed value is
  refused here and nothing is sent, a blank one is **omitted rather than
  padded**. Beside it the sentence that an 832 with no `CUR` is the *common*
  case — the published MSSS sample carries none — and that a file with neither
  is refused whole rather than read as dollars
- **The door is open to staff; the price register is not.** The upload route
  itself keeps no role gate — a runner photographs paper at the delivery door,
  and a check there would lose documents as they arrive — so the gate sits on
  the act that writes prices: `assertCanManageRestaurant` runs before a single
  mapping is read. It is **not** a 403: the document is already stored when the
  check runs, so the refusal comes back as the catalogue's own answer naming the
  rule and saying the file is on the record. The upload is **not sealed**, on
  purpose — an upload is not money, and the write it can cause is a price
  sighting a manager can see, question and have withdrawn

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

### Second pass, 2026-09-04 — Register II can act again, and every act is held

**What the founder asked.** "Extend to order approval and payments; settings stay
asserted." The gateway half shipped first (`cd2b86d8`).

**What was built.** Register II's two controls were disabled placeholders after the
collapse, so the seal had nothing to sit on: they came back as `HoldToApprove`, not as
buttons. `useConnectionsNextData.ts` gained `paymentSeal` (the mint, called from
`onChallenge` when the gesture BEGINS), `setDefaultPayment` and `removePayment` (both
carrying `X-Seal-Challenge`). `AttachmentRow` gained one prop, `alert`: a refused write
prints the gateway's whole sentence in the control column with `role="status"`, keyed by
the mutation's own `variables` so the refusal lands on the row it was refused for and on
no other. `readError` moved from the data hook to `cx-format.ts`, because the page's own
tests mock the hook wholesale and a sentence extractor imported from the mock would have
made the test prove the fixture.

**The structural idea.** The seal is not a weight the page chooses to apply; it is where
the server redeems one. That is why *Remove* is a hold and *Regenerate* is not, and why
this pass could not "just re-enable" the two controls — re-enabling them as buttons would
have shipped two controls that fail every time.

**Motions.** No new token. `pour`, `tuck` and `stamp` arrive with the shared
`HoldToApprove`; `MOTIONS.md` now names them, which the table had omitted since the
re-consent hold.

**What was deliberately not built.** The card panel. Adding a card needs Stripe's own
iframes, which is a ~400-line port bound to `/profile`'s hook and UI kit, into a directory
another builder is live in — and it buys nothing while `STRIPE_SECRET_KEY` is unset. The
row says so instead of pointing at a page that no longer holds it. **Built the next day —
see the third pass below.**

**Proof.** `vitest run src/pages/connections/next/ConnectionsNext.test.tsx` — **43
passed**; six of them fail against a HEAD copy of the whole directory (`git show HEAD:`
into a same-depth probe, never a git state change). Live on `:4000`, both writes answer
403 with the whole refusal sentence when no seal is sent, and neither writes anything.

### Third pass, 2026-09-05 — the card panel arrives, and there is only one of it

**What the founder asked.** *"Port the card panel to /connections now"* — one home for the
whole payment register before the flag reaches any house.

**What was built.** `pages/profile/next/StripeCardPanel.tsx` →
`apps/web/src/components/mudavym/StripeCardPanel.tsx`, plus
`pages/profile/next/stripe-js.ts` → `components/mudavym/stripe-js.ts` (the panel is its
only `loadStripe` caller) and a new `components/mudavym/stripe-card-panel.css`. Register II
renders it under its rows; `PaymentRegister.tsx` renders the same file. Two things had to
be cut for that to be one component rather than two copies:

- **The data binding.** The panel called exactly two functions on `ProfileNextData`. The
  prop is now `CardPanelClient` — `createSetupIntent` and `syncPayments`, nothing else —
  which `ProfileNextData` satisfies structurally (so `/profile` still passes its hook in
  unchanged) and which `useConnectionsNextData` grew.
- **The chrome binding.** `Card`, `Note`, `StatusLine` and `Btn` came from `pf-ui`, whose
  hover and focus rules are injected by `/profile` alone. They are redrawn inside the
  component over the house tokens, and `.scp-btn`'s three rules travel with it.

**Measured, not assumed.** `components/mudavym/index.ts` does NOT re-export the panel, and
the file says why: it imports a stylesheet, `App.tsx` takes `PageGate` from that barrel, and
a CSS import in a barrel is a side effect no bundler tree-shakes. Both callers import by
path.

**Where the button is.** Exactly one place at a time — the empty row's control column when
nothing is on file, an action bar under the list when something is. Two buttons for one act
would make a reader ask which is the real one.

**The disabled state stopped being about us.** It used to read *"the panel … has not been
rebuilt here yet"*, which is a sentence about our backlog printed to an operator. It now
names the missing credential, preferring the gateway's own words
(`provider.reason`) over ours so the disabled control and the 503 the create path would
answer with say the same thing. `secretList` stopped reading
`import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY` a second time and takes the hook's value, so
the subtitle cannot print "set" beside a control disabled for being unset.

**What the port did NOT do, and what the next day did.** The port did not seal `create`,
and said so in words: the hold was the house's ceremony, not a redeemed seal. On 2026-09-05
the gap closed at both ends — `POST /billing/setup-intent` redeems a `create` seal and
`POST /billing/sync` proves it back off the intent, and the panel mints at a first hold
that opens the form. `POST /payment-methods` still has no caller in either app. See
`profile.md` §9 G-PAY-SETUP, closed.

**Two charcoal defects this pass found by capturing, and fixed in passing.** Neither was
caused by the port; both were found because the port required a charcoal capture of
Register II, which this page had never had.

1. **The page never painted its own ground.** `connections-next.css` opened with
   `.mudavym .cx { background: var(--paper-0); color: var(--ink-1) }` — a DESCENDANT
   selector — while the page root is one element carrying both classes (`<div
   className="mudavym cx" data-ground={ground}>`). So the rule could never match.
   Invisible on paper, because the app shell behind it is already light; on charcoal the
   tokens flipped and the background did not. Measured:
   `getComputedStyle(root).backgroundColor` was `rgba(0, 0, 0, 0)` with `--paper-0`
   resolving to `#15130F`. Fixed by adding the compound selector `.mudavym.cx` beside the
   descendant one; the same measurement now reads `rgb(21, 19, 15)`.
2. **Three headings could not inherit a colour.** `globals.css:129-136` sets `h1` and `h2`
   to `text-slate-900` app-wide, and any matching rule beats an inherited value, so
   `.cx-title`, `.cx-sec-h h2` and `.cx-refused h1` rendered slate-900 on both grounds —
   dark headings on the dark one. Each now states `color: var(--ink-1)`.

**Measured live, and it is not what the tests show — G-C10.** With a dev-bypass session
against the running gateway, `GET /api/v1/billing/provider` answers exactly the sentence
this page prints (*"Stripe is not connected — STRIPE_SECRET_KEY is not set on this
deployment…"*), but `GET /api/v1/payment-methods` answers **500**:
*"The payment register could not be read: Could not find the table
'public.payment_methods' in the schema cache"*. So Register II on this deployment is an
**unread** register, not an empty one, and the page says so — the add-a-card bar correctly
renders nothing, because it is gated on `!d.payments.error` rather than on the register
being empty. Filed in §9 as G-C10; it is a deployment fact, not a page defect, and it is
the reason the live captures show a named failure where the stubbed ones show the row.

**Proof.** `npx vitest run src/pages/profile/next src/pages/connections/next
--reporter=basic` from `apps/web` — **122 passed / 3 files**. Against a same-depth probe
built with `git show HEAD:` (never a git state change), **7 of 49** connections cases fail
and **1 of 65** profile cases fails; the second new profile case pins copy that already
existed and is a guard against the port dropping it, which is stated rather than counted as
a proof.

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
| `apps/web/src/pages/connections/next/useConnectionsNextData.ts` | ten reads, seven writes, the tally arithmetic (reads 9 and 10 and the catalogue upload are new 2026-09-05, ADR 0126) |
| `apps/web/src/pages/connections/next/DistributorFeedPanel.tsx` | the licensed-distributor panel: the measurement per distributor, the two ways in, and the per-line admission report (2026-09-05) |
| `apps/web/src/pages/connections/next/DistributorFeedPanel.test.tsx` | 19 render-contract tests for that panel |
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
| POST | `/payment-methods/seal-challenge` | JWT + **manager/owner** | `paymentSeal`, from `HoldToApprove`'s `onChallenge`. One-time, 120s, bound to (actor, act, instrument, its brand and last four); returned once and never stored in the clear (2026-09-04) |
| PATCH | `/payment-methods/:id/default` | JWT + **manager/owner** + **a REDEEMED seal** | `setDefaultPayment` — "Charge this first". The seal rides in `X-Seal-Challenge`; written at the provider before the local flag (2026-09-04) |
| DELETE | `/payment-methods/:id` | JWT + **manager/owner** + **a REDEEMED seal** | `removePayment` — "Remove". Detaches at the provider first, then drops the row (2026-09-04) |
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
| GET | `/distributor-feed/me` | JWT + **manager/owner** | **new 2026-09-05 (ADR 0126)** — the distributors measured for THIS house's own state, each with its robots rule, its terms clause, the day measured and `connectable: false`. A failed jurisdiction read comes back as `silence`, in words |
| GET | `/distributor-feed/letter` | JWT + **manager/owner** | **new 2026-09-05** — the invoice-feed request letter the house signs. A READ: nothing on this gateway sends it, and there is no address field |
| GET | `/distributor-feed/codes/:distributorKey` | JWT + **manager/owner** | **wired 2026-09-05 (batch 59)** — every price-code statement this house holds for one sender, live and withdrawn. Existed since ADR 0126 §7 and had no caller; the panel now reads one per distributor in the register, each failing alone. A failed read answers 200 with `readFailed` and the reason, never an empty list |
| POST | `/distributor-feed/codes/:distributorKey` | JWT + **manager/owner** | **wired 2026-09-05** — a manager states what a code means. Refuses with **200 and a sentence**, not a status code, so the caller reads `ok`. The name comes off the token and is never sent from the browser — fixed this pass to read the session's `name` (it read `fullName`, which nothing sets, so it recorded the email) |
| POST | `/distributor-feed/codes/:distributorKey/:mappingId/withdraw` | JWT + **manager/owner** | **wired 2026-09-05** — marks, never deletes. Requires a reason. Answers with how many price rows named that statement, and `null` — rendered as *unknown* — when it could not be counted |
| POST | `/procurement/documents` | JWT (the store); **manager/owner** for the catalogue half | **not new, and that is the decision.** The 832/810 hand-over uses the door every invoice already uses. New optional fields: `distributorKey` (which sender's price-code statements to read a catalogue against) and `declaredCurrency` (used only when the file states no `CUR`; there is no USD default). The answer gains a `catalog` block with the per-line admission report. Storing stays open to staff; `CatalogIngestService.admit` runs `assertCanManageRestaurant` before it prices anything, and refuses in the report rather than throwing a 403 over a file already stored |

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

- **G-C10 — neither text-sender control does anything yet.** Both paths are
  drawn and both are disabled. `POST /communications/text-senders/own` and
  `…/request` exist and are manager-gated, but this page has no form that calls
  them: connecting a WhatsApp number means running Meta's Embedded Signup in
  Meta's own window, which is a browser flow this page does not yet host, and
  requesting a registration means collecting a legal name, an address, a tax-id
  reference, a use case, two sample messages and a 40-2049-character opt-in
  description — a sheet, not a button. Filed rather than papered over with a
  control that would open nothing.
- **G-C11 — a sender can never reach `connected` from this surface.** Only a
  live probe may move a row there and no probe exists (`last_probe_at` is NULL
  on every row, by construction). So the `connected` state is currently
  unreachable in production, and the row says "never probed" rather than
  implying the state is merely unused.

- ~~**G-PAY-SEAL — the payment register's controls are buttons, not the seal
  ceremony**~~ — **CLOSED 2026-09-04.** Gateway half in `cd2b86d8`; page half in
  this pass. On this page it closed together with half of G-C9 below, because the
  two controls had to exist before they could be sealed: Register II's *Remove*
  and *Charge this first* were disabled placeholders, and they came back as
  `HoldToApprove` rather than as buttons. `paymentSeal` mints the one-time token
  for its own act when the gesture BEGINS; the write carries it in
  `X-Seal-Challenge` and spends it exactly once; a mint that fails approves
  nothing and the control says so; a refusal prints the gateway's whole sentence
  on the row it was refused for. Six tests pin it, six failing against a HEAD copy
  of the directory. Proven live on `:4000`: both writes answer 403 with the
  refusal sentence when no seal is sent, and neither writes anything.

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

- **G-C10 — `payment_methods` is not in this deployment's schema cache, so Register II
  reads as UNREAD (measured 2026-09-05).** `GET /payment-methods` answers 500 with
  *"Could not find the table 'public.payment_methods' in the schema cache"*, while the
  migration that creates it (`20260903094600_payment_methods.sql`) is applied. The page
  behaves correctly — it NAMES the failed read and carries the gateway's sentence rather
  than drawing an empty register (ADR 0020) — and every control below it is therefore
  absent rather than disabled. **Not a page defect and not fixed here:** it is a PostgREST
  schema-cache state on the deployment, and reloading that cache is an operator act. It is
  recorded because it is the state a founder opening `/connections` today will see, and
  because it means no capture on this deployment can show a real instrument row.

- ~~**G-C9 — nothing on this page can ADD a card; removing and preferring one work
  again.**~~ **CLOSED 2026-09-05.** Opened 2026-09-04 by the collapse, half-closed
  the same day, closed whole the next.
  **The first half (2026-09-04):** *Remove* and *Charge this first* are live on
  every instrument row and both are `HoldToApprove`, because the gateway REDEEMS a
  one-time seal on each of those writes (ADR 0110's addendum) — a plain button
  there would be a control that always fails, not a lighter ceremony. The write
  client is `useConnectionsNextData.ts` (`paymentSeal`, `setDefaultPayment`,
  `removePayment`); a refused write prints the gateway's own sentence on its own
  row (`.cx-ctl-alert`), keyed by the mutation's `variables` so no untouched row
  is told nothing changed.
  **The second half (2026-09-05, founder: "port the card panel to /connections
  now"):** the panel is not a copy. `profile/next/StripeCardPanel.tsx` became
  `components/mudavym/StripeCardPanel.tsx` and its two bindings were cut — the
  data (it wanted two functions, never a page object: `CardPanelClient`) and the
  chrome (four `pf-ui` primitives redrawn over the house tokens, with the hover
  and focus rules moved into `stripe-card-panel.css` so the component looks
  finished on a page that has never had a `.pf-` class). `useConnectionsNextData`
  grew `createSetupIntent` and `syncPayments` and exposes
  `stripePublishableKey`; `pages/profile/next/stripe-js.ts` moved to
  `components/mudavym/stripe-js.ts` with the panel, its only `loadStripe` caller.
  Both pages render the one component: `/profile` with the flag off (which is
  production), `/connections` with it on. The disabled state is now about the
  DEPLOYMENT — which credential is missing, in the gateway's words where the
  gateway sent them — and never about our own backlog.
  *What the port did NOT change, and 2026-09-05 did:* adding a card now redeems a
  seal — the panel's first hold mints `create` and the intent spends it. Mirror:
  `profile.md` §9 G12a, and G-PAY-SETUP there, closed.

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

### The house's mail archive (ADR 0118 D16, 2026-09-05)

- **The archive is one person's Drive, by decision and not by omission.** The
  founder chose to keep that shape and print the owner's name (batch 53); a
  Google Workspace Shared Drive is the upgrade when a house has one, and most
  small houses do not. Until then, a departing manager takes the house's
  exported record with them and the page says so in as many words.
- **The row shows state, and does not yet CHOOSE.** `POST /communications/archive`
  is built and sealed, and this page has no control wired to it — a house
  currently arms the archive through the API, not through /connections. Named
  here rather than left to be discovered.
- **`mudavym_archive` cannot be armed at all** while OD-23 is unanswered for the
  archive (batch 54 superseded the parent's reading of it). A house that chooses
  it sees "Chosen, not running" and the sentence naming the open decision.

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

**Before everything below — the distributor panel's three open ends** (ADR 0126,
batch 56; the panel itself shipped 2026-09-05). ~~**(a)** There is no control on
this page for *stating what a price code means*. The routes exist
(`GET`/`POST /distributor-feed/codes/:distributorKey` and
`POST …/:mappingId/withdraw`, ADR 0126 §7) and **nothing on any page calls
them**, so a manager told by the report that `MSR` is unmapped has nowhere here
to say what it means.~~ **CLOSED 2026-09-05 (batch 59)**: the register and its
form are in the distributor row, the withdrawal is a ceremony that asks for the
reason first, and a refused code in the ingest report is a link that fills the
form in. ~~**(b)** `declaredCurrency` is accepted by the door and is **not**
offered by the panel, so a catalogue with no `CUR` — the published MSSS sample's
shape, and therefore the common one — is refused whole with no way to answer it
from this page.~~ **CLOSED 2026-09-05 (batch 59)**: the field sits beside the
sender picker, three characters, no default, blank omitted rather than padded.
**(c)** The letter's brackets are listed but not filled: the house's licence and
account number are not held anywhere in this product, and whether they should be
is a decision, not an oversight. **STILL OPEN.**

**New, from building (a) and (b)** — two things this pass measured rather than
assumed, one fixed and one left alone because it is out of this pass's scope:

- **A statement was being signed with the manager's EMAIL, not their name.**
  `distributor-feed.controller.ts` read `user.fullName`, and `JwtStrategy.validate`
  sets no such field — it returns `{ userId, email, name, role, restaurantId, … }`.
  Measured with `grep -rn fullName apps/api-gateway/src`, which finds only the two
  places that READ it and none that writes it, and proved against pre-fix code by
  running a probe spec on `git show HEAD:…/distributor-feed.controller.ts`
  (it asserted `declaredByName === 'ada@example.test'` and passed). Fixed here to
  `fullName ?? name ?? email`, pinned by `distributor-feed.controller.spec.ts`.
- **The same line is still wrong in `documents.controller.ts:326`**
  (`uploadedByName: (user.fullName ?? user.email ?? "").trim() || null`), so the
  handover block on an admitted price sighting records the uploader's email where
  it means to record their name. Out of this pass's scope (`procurement/**` was
  fenced off) and named rather than fixed quietly.
- **A withdrawal records no NAME.** The table holds `declared_by_name` for a
  statement and only `withdrawn_by` — an account id — for a withdrawal, so the
  register can say *when* and *why* a statement was withdrawn but not *by whom* in
  words. The panel says exactly that rather than printing a uuid as if it were a
  person. Closing it is a migration plus a controller line, which is a decision
  (see the founder question in ADR 0126 §7's built note).

0. **The two text-sender flows** (ADR 0121, §9 G-C10/G-C11): host Meta's
   Embedded Signup for *bring your own*, and a registration sheet for
   *Mudavym registers* carrying the per-market checklist the ADR's playbook
   section holds. Then the live probe, which is the only thing that may move a
   sender to `connected`. The submitting act itself is sealed and has no route
   at all today — the seal on it is satisfied vacuously, which the ADR states
   rather than leaving to be inferred.


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
7a. ~~**The Connect button on a Gmail row led nowhere.**~~ **Fixed 2026-09-04 by
   the `gmail_read` build.** This register maps the catalogue, so `gmail_send`
   appeared here the morning it was declared — and every Connect row on this page
   and on `/profile` links to `/authorize/:id`, where
   `apps/web/src/pages/AuthorizeIntegration.tsx` held
   `const VALID_IDS = ['google_drive', 'excel']` and checked the route parameter
   against it **before reading the catalogue**. So the only route to consenting to
   a sending grant ended at *"Unknown integration. That integration doesn't
   exist."* The grant was unreachable and nothing failed. Same fault as a
   hard-coded scope list, one layer out. Fixed by deleting the copy — the
   catalogue the server returns decides, and an id it does not carry now gets a
   sentence about **this deployment's catalogue** rather than about existence.
   Proved by `apps/web/src/pages/AuthorizeIntegration.test.tsx` (5 passing; 5 of 5
   fail against a `git show HEAD:` copy of the page, and a one-off run confirms
   HEAD rendered the wall). Widening `IntegrationId` surfaced two more copies of
   the same fault at compile time — an exhaustive icon map in
   `components/settings/IntegrationsAuth.tsx` and a narrowed handler parameter in
   `pages/profile/next/ConnectionsRegister.tsx:63` — both corrected in the same
   change.
7b. **The house cannot switch the inbox reader on from anywhere** (filed
   2026-09-04 by the `gmail_read` build). `enable_house_inbox_read` is a real
   column and a real gate, and no surface sets it.
   `PUT /settings/feature-flags` was deliberately left alone: it carries
   `JwtAuthGuard, TenantGuard` and **no role check**
   (`settings.controller.ts:38-40`), so adding the key there would let any
   authenticated member start reading a colleague's mailbox. Either that route
   gains `assertCanManageRestaurant` — which also changes who may flip
   `enable_ai_autonomous_send`, the founder's call — or this page grows a
   manager-only control beside the reading grant's row. **Until one lands, the
   reading grant can be consented to and nothing is read.**
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
10. ~~**Port the card panel** (G-C9 below) — the one thing the collapse
    subtracted.~~ **Done 2026-09-05.** `components/mudavym/StripeCardPanel.tsx`,
    one component with two callers rather than a second copy; the row that said
    adding a card had no home is the panel. §9 G-C9 closed.
11. **A licensed distributor connection — defined, and deliberately not offered**
    (ADR 0126, 2026-09-05). The founder's call that day was *"build the
    distributor connection as a class C source"*: house-declared,
    person-consented, the portal's price list mirrored into the register. It is
    **defined and inert**. `DISTRIBUTOR_FEED_CONNECTION`
    (`apps/api-gateway/src/distributor-feed/distributor-feed.registry.ts`) carries
    the id, the label, `declaredBy: "restaurant"` / `consentedBy: "person"` per
    ADR 0114, and the same four required disclosure questions the OAuth
    catalogue asks — what is read (**a price list**), what is not (**orders,
    invoices, deliveries, credit terms, rep messages, balances**), where it lands
    (`vendor_price_observations`, **this** restaurant, `api_catalog` / tier 3 —
    *not* `price_index_postings`, which has no restaurant column and is read by
    every house in the state) and who can then see it. It carries
    **`offerable: false`** with the reason on the same object, and there is **no
    declare route, no credential column and no fetcher**.

    **Why nothing is offered, measured 2026-09-05.** No Illinois distributor
    publishes a feed a house could connect, and two forbid the attempt in their
    own words: `now.breakthrubev.com/robots.txt` is `Disallow: /` for every path
    but its login; Breakthru's Terms §6.2(c) ban "web crawlers, data mining,
    scraping, robots, spiders"; and Southern Glazer's Terms ban "any robot,
    spider, or other automatic device" **and, separately, providing "any other
    person with access to this Website … using your username, password, or other
    security information"** — which is exactly what declaring a portal login
    here would be. Building the box first and asking later is how a product ends
    up holding credentials it may not use.

    **What a person sees instead.** `GET /distributor-feed/:jurisdiction` (owner
    and manager, read-only; `me` resolves the house's own state) returns, per
    distributor, the verbatim robots rule, the verbatim terms clause, the day it
    was measured, the evidence URLs, and a sentence that says what is true rather
    than "coming soon". For Illinois it ends where the answer actually is: the
    house's own invoices are the licensee price list, and this house already
    records them (ADR 0117 class A). **Drawing that on this page is web work this
    session did not do** — the endpoint returns everything a register needs and
    no component reads it yet, so a manager cannot reach it from the product.
    That is the honest state of this item, not a claim that the register exists.

---

**Retention is now part of what a grant means, 2026-09-05 (ADR 0118 D12-D15).**
A `gmail_read` grant is the one connection on this page that copies a person's
mail into the house's book, and until today nothing on the consent screen said
how long that copy was kept or what disconnecting did to it. Four things changed
that reach this register:

1. **Disconnecting a mirroring grant now deletes, and can now fail loudly.**
   `DELETE /integrations/oauth/gmail_read` revokes upstream, drops the tokens,
   and then deletes the raw mail that grant mirrored — body, headers and
   attachment bytes — scoped by `procurement_conversations.mirrored_by_grant_id`.
   It returns the sweep's own counts. If the deletion cannot run it **throws**
   rather than reporting `{success: true}` for a revocation whose second half
   silently did not happen, so a disconnect row on this page can now report a
   failure it previously could not have known about.
2. **The catalogue carries `mirrorsMail`.** Every entry says whether consenting
   copies mail into the house, served from `MIRRORING_INTEGRATION_IDS` rather
   than inferred from the id — `gmail_send` is a Gmail grant that mirrors
   nothing, and a page that guessed from the prefix would get it wrong. Any
   register on this page that wants to mark the mirroring grants differently
   reads that field.
3. **`dataHandling` has a fifth question**, `keptFor`, required on every
   definition like the other four. A grant that keeps nothing says so; that is a
   real answer and a different one from silence.
4. **NOT wired, deliberately: the house-grant suspend control.**
   `PUT /integrations/oauth/house-grants/:id/access` with `houseUses: false` is
   the house withdrawing its own use of a member's grant (ADR 0114). It does
   **not** delete raw mail, because the member has not revoked anything and
   their consent still stands — deleting on it would let a manager destroy a
   colleague's mirrored correspondence without the colleague acting. Filed as a
   founder question in ADR 0118 rather than defaulted either way. If the founder
   wants the stronger version it is one call beside the upsert in
   `setHouseGrantAccess`.
12. ~~**Draw the price-code register**~~ **DONE 2026-09-05 (batch 59)** — it is
    in the distributor row on this page: the live statements with their evidence
    and who stated them when, the withdrawn ones kept with their reason, the
    withdraw ceremony that asks for the reason and reports how many prices the
    statement admitted (`null` rendered as unknown), and the form with its three
    refusals. What follows is the note as it stood before it was built, kept
    because its reasoning is still the reasoning. (ADR 0126 §7, answered and
    built 2026-09-05
    — *"Manager maps it, recorded on every row"*). The gateway half is done:
    three manager-gated routes, a table whose every CHECK was exercised against
    a real Postgres, and a parser that stamps the statement's id, the manager's
    name and the day on every row it admits. **What has no surface yet** is the
    part a manager touches — a register on this page listing what this house has
    said each sender's codes mean, the evidence beside each, a control to
    withdraw one with its reason, and the count of prices that statement
    admitted shown before the withdrawal is confirmed (the endpoint returns that
    count, and returns `null` rather than 0 when it could not be read). Until it
    is drawn, the capability exists and no person can reach it, which is stated
    here rather than implied to be live.

    It has no urgency on its own: nothing ingests a distributor catalogue today,
    because no distributor was found to send one (item 11). The register becomes
    reachable the day a house has a file — and the parser it feeds is proved
    against fixtures rather than against any distributor's real bytes.

    **What is still true after building it**: nothing ingests a distributor
    catalogue on its own, so the register is reachable but unexercised — no row
    of `distributor_price_code_mappings` exists in production and none was
    written by this pass. The panel was captured against a stubbed gateway, not
    against real distributor bytes.

    **Corrections and follow-ups, 2026-09-06 (batches 61 and 62, and the audit
    of `da71cebe`).**

    - **Who may reach it.** The claim that staff see the register greyed was
      wrong and is corrected in §1a: `ConnectionsNext.tsx:274-292` refuses a
      staff session with the whole page's written sentence before this panel is
      ever mounted, which is the admission line 65 already recorded and which
      the founder kept (*"Keep the page-level refusal; correct the note"*). The
      panel's `canManage=false` state is real and tested — including with the
      prop **omitted entirely**, which the commit asserted and nothing pinned —
      but it is a defence for a page that later admits staff, not something a
      staff member sees here today.
    - **A withdrawal now names the person.** `withdrawn_by_name` (migration
      `20260906150000`, the founder: *"Add withdrawn_by_name now"*) is present
      exactly when `withdrawn_at` is, refused blank by a CHECK and by the
      service in words. The panel prints *withdrawn by &lt;name&gt; on
      &lt;date&gt;: &lt;reason&gt;*, and a withdrawal recorded before that day
      carries no name — which the row says as a gap in the record rather than
      printing an account id as if it were a person.
    - **A currency disagreement refuses the whole file.** When an 832 states its
      own `CUR` **and** the declared currency disagrees, the parser refuses the
      document naming both (*"the file states EUR and the declaration says USD;
      nothing was read"*) instead of letting the file win silently, which is
      what it did until this pass. Agreement and absence are unchanged. The 810
      path is untouched because it never reads a declared currency at all.
    - **Three failure states for the register, not two.** The commit message
      named two. There are three, each with its own sentence and each now
      tested: `registerError` — *this house's price-code statements could not be
      read … no code is shown here as unmapped on the strength of a read that
      failed* — is the whole query failing and is the only one not per sender;
      `unreadable` — *&lt;sender&gt;'s price-code statements could not be read …
      that is unknown, not none* — is this browser never reaching the gateway;
      `readFailed` carries the **gateway's own** sentence about the table it
      could not read. A fourth branch, `!statements`, says *that is silence, not
      an empty register* when a sender was never fetched at all.

13. **Wire the archive's CHOICE onto this page** (ADR 0118 D16). The row now
    states which archive the house keeps and whose Drive holds it, and the
    control that SETS it is not here — `POST /communications/archive` is built,
    sealed (`house_mail_export`, subject = the restaurant) and reachable only by
    API today. It needs the hold-to-approve shape the other sealed controls on
    this page already use, plus a picker for which connected Drive grant carries
    it. Nothing is blocked on a decision: this is a control that was not drawn.
14. **Offer a Shared Drive as the archive's destination** — the founder's
    batch-53 answer named it as the upgrade path once a house has Google
    Workspace. `drive.file` can already write into a Shared Drive, so this is a
    destination picker and a sentence, not a new scope; what it removes is the
    "it leaves when they leave" line this page currently has to print.

### Correction to 2dc891bd's message (audit a0b6c185ab03442e2, 2026-09-05)

The commit message said `npx vitest run src/pages/connections src/pages/AuthorizeIntegration: 79 passed / 3 files`. The archive run printed 87 passed / 4 files (`cx-permissions.test.ts` 8, `AuthorizeIntegration.test.tsx` 8, `AuthorizeIntegration.retention.test.tsx` 12, `ConnectionsNext.test.tsx` 59); the parent pasted the builder's number over its own run — the third such slip today, each now recorded.

### Founder answer, 2026-09-06 (batch 60) — an emailed 832

**"Leave it; an 832 enters only by hand."** The mail sweep's filter does not list `.832`: an
emailed file has no uploader identity and no sender key, so it could be stored but never
priced, and admitting prices from a channel that cannot name who handed the file over is the
shape ADR 0126 §7 exists to prevent. A manager uploads the file on this page with the sender
named. Rejected: store emailed 832s unpriced.
