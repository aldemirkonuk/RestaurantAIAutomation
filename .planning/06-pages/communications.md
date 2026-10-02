---
type: page
route: /communications
slug: communications
softwares: [communications-hub]
component: apps/web/src/pages/Communications.tsx
audience: owner
tier: core
archetype: list+detail # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 3
maturity: hollow
status: documented
updated: 2026-09-02
links: ["[[PAGE-CONTRACT]]", "[[documents-reports]]"]
---

# /communications — Communications

> **Part of** [[08-softwares/communications-hub|Communications Hub]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

- **Templates / Send History / Scheduled Reports / Procurement Emails tabs** → (on this page)
- **New Email / SMS template** → (builder on this page) — legacy only; with the
  flag ON both builders are retired (ADR 0118) and this rail carries the two
  controls below instead
- **Write a letter** (flag ON) → the house composer, a **wide sheet** over this
  page (`Compose/ComposeSheet.tsx`; ADR 0112's `Sheet` with `wide`)
- **The house's letter templates** (flag ON) → the house letter library, a wide
  sheet (`TemplateSheet.tsx`)
- **Send** (inside the composer) → `POST /communications/letters` — **queues, never
  sends**; **Pull it back** → `POST /communications/letters/:id/cancel`
- **Connect a mailbox** (named in the sender line's copy) → `/connections`
- **Generate report now** → API `POST /reports/generate`; success toast's **Open** → [[documents-reports]] `/documents-reports`
- **Delete schedule** → API (report-schedule delete)

## 1. Purpose

"Vendor email threads, classified and ready to reply" (`Sidebar.tsx:122`). Four tabs
(`Communications.tsx:258,384`): **Templates** (Gmail + SMS builders with saved
templates), **Send History** (classified vendor conversation threads), **Scheduled
Reports** (recurring report delivery), and **Procurement History** (Phase 34
outbound-email audit trail, labelled by `outbound_email_type`).

## 1a. Features

[changed 2026-10-02, walk-through R2 (§14, ADR 0260): the tab list below describes the legacy page, deleted 2026-09-28. The page at `/communications` is CommunicationsNext: "Waiting on you" (letters staff asked a manager to send, card A with the letter formatted, W11c; drafted replies, one row per order, W24; house drafts, locked with their reason while the house has no mailbox, W13b), the conversation book (flat, newest first; a queued letter can be pulled back from it, W23; a read that fails after answering keeps its rows and says when, W33), Write to a vendor and the Templates sheet (W21, W28; words left in a sheet stay as a Stub, W34), Who is writing (W32), the mailbox chooser (W16e), the open scope, letter and reply in the address (W19, W35), and the tour in #571's order (W38).]
- **Templates** tab: build Gmail and SMS templates; save and reuse them (🚧 saved client-side, not cross-device)
- **Send History** tab: browse classified vendor conversation threads; regenerate a thread's AI summary
- **Scheduled Reports** tab: create, list and delete recurring report schedules (🚧 the send itself is feature-flagged off server-side — no mailer)
- **Procurement History** tab: audit trail of outbound procurement emails, labelled by type
- Filter by channel: all / email / SMS
- **The text sender's money meter** (ADR 0121 addendum, 2026-09-05, OD-23's
  message-billing half): `GET /communications/text-credits/meter` returns the
  month **in the house's own timezone**, messages counted and messages the
  provider charges nothing for, the plan's allowance and the credit balance in
  minor units with its currency. Three states this page must render as written
  rather than as numbers: `allowance: null` is **"no allowance stated"** and never
  0; `usedThisMonth: null` means the count could not be READ and is never "none";
  and a ledger holding two currencies is flagged rather than summed. Buying
  credits is `POST /communications/text-credits/purchase` and is **sealed** —
  bound to the amount and the currency, so a hold obtained for one figure cannot
  be spent on another. **The currency is normalised ONCE, before the check, the
  seal binding and the write** (2026-09-11, audit of `b6d2e4b4`). Until then the
  gate upper-cased without trimming while `isIso4217` trims, so `" try"` passed
  as `" TRY"`, was bound into the seal's args, redeemed, and only then met
  `house_message_credit_intents.currency CHAR(3) CHECK (currency ~ '^[A-Z]{3}$')`
  as a four-character value — a 500 with a SPENT seal where a 400 refusal
  belonged. Nothing was charged (the intent row precedes the provider), but the
  same purchase spelt two ways was two purchases to the seal and one the
  database would not take. Both gates now go through `currencyCode(...)`, which
  trims, folds and asks membership in one call, and the code it returns is the
  only one used from there on — the controller's
  (`text-credits.controller.ts:187`) and the service's, which also writes the
  normalised code rather than the raw one into the ledger row and its `detail`
  sentence (`text-usage.service.ts:514`, `:543`). Pinned at
  `text-credits.seal.spec.ts:428` and `text-usage.spec.ts:407`; all three cases
  fail against the pre-fix modules. Measured on fakes, not against Postgres: the
  `CHAR(3)` outcome is read from the column definition, never executed. **Updated 2026-09-05 (founder: *"Wire it to the card on
  file, sealed"*): that route now CHARGES** the house's Stripe instrument for the
  stated amount before the credit is written. A refused charge writes nothing and
  says why. **Updated 2026-09-06 (founder: *"Close it now with the intent row"*):
  the response no longer carries `charged` and `recorded` as separate booleans.**
  It carries ONE `state` — `settled`, `voided`, or `charge_may_exist` — because
  two booleans that can disagree are two facts a caller has to reconcile in its
  head, and the reconciling is now done on disk. A purchase writes an intent row
  and marks it `charge_may_exist` **before** the provider is asked, so there is no
  longer a moment where money can move with nothing recorded. A page rendering
  `charge_may_exist` must say the purchase is unfinished and will be completed by
  a reconcile — never that it failed, and never that it succeeded.
- **Unfinished purchases are resolved by asking the provider, not by guessing.**
  `POST /communications/text-credits/reconcile` (service-key, ADR 0099; there is
  no person to bind a seal to) reads Stripe by the seal id and settles or voids.
  Two refusals it will not be argued out of: an intent younger than the provider's
  search lag is **left open** rather than voided, because Stripe's search index
  runs behind and an empty answer that soon is not evidence; and a provider that
  could not be reached is never read as "no charge exists". The runner is
  `scripts/reconcile_message_credit_purchases.py`, `--apply` refused without
  `--i-have-the-founders-word`.
- **The allowance a house sees may be its own, not its plan's** (2026-09-05,
  founder: *"One house first, deliberately, then watch"*). `MeterReadout`
  carries `allowanceScope`: `"house"`, `"plan"` or `"none"`. The page must say
  which — *"200 because we set it for this house"* and *"200 because every house
  on its plan has it"* are different facts and only one of them was decided. A
  house row that could not be READ does not fall through to the plan's number,
  and a house row carrying NULL is not the absence of a row.

### Redesign feature summary (behind the flag)

- **Mudavym redesign behind `mudavym_design_communications` (OFF)**: four-figure glance strip (threads · drafts waiting · sent-30d · report schedules), the conversation book as a short-row ledger with prose inside the expansion, honest channel-state line (Gmail inbound watch queried, never asserted), scheduled-reports rail **[2026-09-25, ADR 0083 amendment: now a THREE-figure strip — the report-schedules figure, the scheduled-reports rail card and the Gmail inbound-watch line left this page; the watch line reads on `/admin`. See "The house page names the three sources it owns" below.]**
- **The house email composer** (flag ON, ADR 0118): a wide sheet that writes one
  letter — the sender line first, a recipient chosen **from the vendor book only**
  with "add to the book" inline, a house template picker, a body, and a merge
  picker that inserts **the engine's whole sentence with a provenance chip**
  (rule key · window · computed-at). Send queues the letter; it never claims a send
- **The house's reply, drafted — a PANEL with the seal** (built 2026-09-06, packet 2
  of the overlay layer; census 102 · ADR 0112 · ADR 0118).
  `pages/communications/next/DraftedReplyPanel.tsx`, opened from *The house has
  written* above the ledger. Until it landed the page could COUNT drafts waiting —
  `glance.draftsPending` — and open none; the act lived on `/orders`
  (`components/orders/DraftEmailApprovalPanel.tsx:130`).
  - **TWO NEW GATEWAY ROUTES, because nothing could seal a SEND.** The legacy panel
    posted `POST orders/:id/approve-draft`: one click, and mail left the building on
    an unsealed request. Now `POST /procurement/orders/:id/draft-seal-challenge`
    mints when the hold BEGINS and `POST /procurement/orders/:id/send-drafted-reply`
    spends it (both `procurement.controller.ts`; the act is `ORDER_SEND_DRAFT_ACT`
    in `procurement/order-seal.ts`, spec `draft-send-seal.spec.ts`, 13 assertions).
  - **The seal is over the LETTER, not the order**: the words normalised, the
    recipient, and the copies sorted (`draftSealArgs`). A paragraph edited between
    the hold and the release is refused by the args hash rather than posted; a
    trailing newline the textarea added is not a change. A seal minted to approve an
    order's MONEY cannot be spent to send its MAIL — `send_draft` is its own act for
    the same reason `cancel` is.
  - **The list and the strip's figure come from the same read**, so they cannot
    disagree; a figure over an empty column is how a page starts lying quietly.
  - **A draft never looks sent**: the engine's words are grey until a person edits
    them, and nothing about opening the panel changes a draft. Each engine flag
    names the rule it tripped.
  - **The older route still exists and the legacy desk still calls it — CORRECTED
    2026-09-21 (round 5, CLAUDE.md §5b).** This bullet used to call it "the older
    UNSEALED route", implying the two new routes are sealed by contrast. They are
    not, by default: `sendDraftedReply` lets an absent `X-Seal-Challenge` through
    on ALL THREE routes (the legacy one and both packet-2 ones) while
    `REQUIRE_DRAFT_SEND_SEAL` is unset — the flag's default, unset in every
    environment this has shipped to (`legacyDraftSendMayGoUnsealed`,
    `procurement.service.ts`; ADR 0118's dated bracket on "Codex execution,
    2026-09-13"). What actually differs is CLIENT behavior: the legacy desk never
    sends a challenge, and this panel always mints and sends one — a UI habit, not
    a server requirement, until the flag flips. Still true and still FILED (§9):
    this packet does not break a live send path, and deleting the legacy panel is
    packet 4's business.
    **[2026-09-21, ADR 0175 amendment ("Staff ask, manager sends").]** The flag
    is deleted and the seal is required on every route. The panel now reads the
    viewer's `sendOrAsk` beside the draft (`GET orders/:id/draft`): an owner, a
    manager or a grantee holds to send; anybody else holds to ask a manager, who
    releases their exact words with one hold. The composer's sender readout
    carries the same field, and its queue is sealed and gated too. Proved by
    `DraftedReply.test.tsx`, 25 tests as measured 2026-09-21 (the count below
    is the packet-2 count, kept as its record).
    **[2026-09-21, ADR 0175 second amendment.]** A staff member's composer shows
    "Ask a manager to send it" (a click, like the composer's send; answer 3/7):
    `POST /communications/letters/requests` keeps the exact letter after checking
    the book and the guardrails. "Letters waiting for a manager"
    (`LetterRequestsPanel.tsx`, `GET /communications/letters/requests`) lets an
    owner or a manager release one with one hold that mints the composer's seal
    over it and names the request; it still waits out the 2-minute undo. A draft
    refused before sending reads as failed, "Refused before sending — draft closed"
    (answer 6).
  - Proved by `DraftedReply.test.tsx` (18 assertions).
- **The house letter library** (flag ON): house-owned templates under five vendor
  purposes, each showing its declared merge fields, who last edited it and when it
  was last used, plus a "start from something the house noticed" flow that opens
  the editor on an engine sentence. HELD: the four columns behind it arrive with
  migration `20260904150000`; until it applies the library says **"could not be
  read — unknown, not empty"** rather than rendering an empty shelf
- **The undo window** (flag ON): a letter from the house's own mailbox is
  **queued** for two minutes and can be pulled back; the ledger chip reads
  "Queued · not yet sent", never "Sent"
- **The guardrails over a human draft** (flag ON): commitment language and an
  unfilled `{{merge_field}}` **block** Send with the sentence; the round count on
  an order is **stated, not blocked**
- **The sending mailbox** (2026-09-04, founder: "add the gmail send integration
  now"): `gmail_send` is now a declared `IntegrationDefinition` requesting
  `https://www.googleapis.com/auth/gmail.send` **and no other scope** — a separate
  house-declared, person-consented grant, not a widening of the Drive one. A
  letter can leave as soon as somebody in the house consents; until one does the
  sender line still says "no house sender" in words and Send stays disabled, but
  it now names the row to click. Google app verification for the scope is
  outstanding (ADR 0111) — see §9
- **The receiving mailbox** (2026-09-04, founder: the send grant stays send-only
  *"on condition the house can also receive on its own mailbox and have the whole
  comms there"*; asked how, *"A second grant, read-only, house-declared and
  person-consented"*): `gmail_read` is a declared `IntegrationDefinition`
  requesting `https://www.googleapis.com/auth/gmail.readonly` **and no other
  scope** — its own id, its own consent screen, its own disconnect. Two grants,
  each asking for one thing
- **The house-inbox reader** (ADR 0118 D9/D10): a scheduled read every five
  minutes, **OFF unless a restaurant sets `enable_house_inbox_read`**, through the
  consented grant's own token. Bounded **twice** — every request carries a
  `from:` filter built from this house's vendor book, and any message Gmail's own
  fuzzy sender matching returns from outside the book is discarded before its
  body is read. The **first tick seeds the cursor at now**, so switching it on
  never reaches backwards into somebody's mail. An admitted reply is mirrored by
  **publishing the same `email.inbound.received` event the shared mailbox
  publishes**, so `RabbitMqBridgeService.handleInboundEmail` writes the row, runs
  the dedupe and hands it to the same triage — a house-mailbox reply is the same
  kind of thing as a shared-mailbox one
- **The sender line states the WHOLE conversation, in four states** (ADR 0118 D11):
  `whole_conversation_here` · `letters_leave_only` ("letters leave from X; replies
  still arrive through the shared mailbox until someone consents to reading") ·
  `replies_arrive_only` · `shared_mailbox`, plus `unknown` for a failed read,
  which is not a fifth arrangement. **A consent is not a switch**: a house where
  somebody granted reading but the flag is off is placed with the houses that are
  not being read, and the words name which of the two doors is shut
- **The consent screen says where what is read lands, and who can see it**
  (founder's rule: everything valuable is welcome, no person's privacy touched by
  surprise). Every integration carries a required **five**-part `dataHandling`
  block — what we read, what we never read, where it lands, who can see it, and
  **how long it is kept** — served from the same constant the scope list comes
  from, so the sentence cannot drift from what the server does
- **A mirrored reply is kept as two objects, with two rules** (ADR 0118 D12-D15,
  founder 2026-09-05). The RAW MAIL — body, headers, attachment bytes — has a
  window and goes on revocation; the FACTS the understand step wrote onto the
  order stay under the house's bookkeeping floor. `communications/retention/`
  holds the rule table, the derivation and the sweep
- **The window is derived, never a constant.** The longest dispute the house has
  recorded (`procurement_credits`, measured from the first message on that
  order) plus a margin of 92 days — one re-derivation interval, because the
  figure is only re-derived quarterly and a shorter margin could expire mail on a
  three-month-old figure. A house with no dispute recorded gets the margin alone
  and `longest_dispute_days` is NULL, never 0
- **The bookkeeping floor is per house, from its country, with the statute named
  and the date it was read.** TR 10 years (TTK 6102 Art. 82), GB 6 (Companies Act
  2006 s.388 + HMRC), US 7 (IRS), US-CA 7 (+ CDTFA and CCPA's disclosure duty). No
  country recorded means the strictest rule and a printed sentence saying why
- **Revoking the reading grant deletes the raw mail immediately**, scoped to that
  grant by `procurement_conversations.mirrored_by_grant_id`, with a notice to the
  grant's owner and a count recorded whether or not anything changed. The consent
  screen says all of this BEFORE the grant, from
  `GET /communications/retention/disclosure`, and disables Continue for a
  mirroring grant when it cannot read the figure
- **A house can keep its own copy of the mail, and it is offered both ways**
  (ADR 0118 D16). `own_cloud` exports every mirrored reply to the house's own
  Google Drive through the `drive.file` grant it already holds — no scope
  widened; `mudavym_archive` is a billed tier that is **recorded and never
  armed** while OD-23 is open, refusing in words on every path; `none` is
  today's behaviour, now stated rather than defaulted into. **No row at all**
  means nobody was asked, which the disclosure reports differently from a
  recorded `none`
- **One file per conversation, verified by reading it back.** The layout is
  `Mudavym mail archive/<restaurant> (<id>)/<vendor>/<YYYY-MM>/<conversation id>.json`
  and the document carries the body, the headers and every attachment inline as
  base64 with its own sha256. The export is confirmed by downloading the file and
  re-hashing it: a 200 is Drive's claim, the matching hash is the evidence, and a
  mismatch is recorded as a failure
- **The retention sweep READS the export table before it deletes.** With an armed
  archive, a reply past its window with no `status = 'exported'` row is HELD, not
  deleted, counted in `house_mail_retention_sweeps.held_for_export`, and named in
  words. A sweep that cannot consult the archive at all deletes nothing. A
  REVOCATION is the one exception and says so: it exports what it can, records
  each failure per conversation, and deletes anyway, because D15 is about a
  person withdrawing consent
- **Choosing an archive and running an export are sealed acts on the house**
  (ADR 0107; seal kind `house_mail_export`, subject = the restaurant). The daily
  03:10 job carries no seal and records NULL rather than borrowing the arming one
- **A Turkish house is told the truth about Art. 82 either way.** With an armed
  archive, the exported file is the copy it keeps for ten years; without one, the
  consent screen says Mudavym holds a mirror it deletes on the window and the
  duty is the restaurant's own. A GB or US house is never shown that sentence
- **RETIRED — the two legacy template workshops are gone from the rebuilt page** (ADR
  0118 D7). They are untouched and the legacy page still mounts them

### Who is writing, 2026-09-19 (ADR 0160 §113 Open item 3 · sketch 113 direction A, frames 2a and 4c)

Moved here from `/promotions` (founder, 2026-09-18: *"they move to /communications, and the hold-to-trust and add-vendor acts go with them; /promotions holds offers only"*). A section under the conversation book, two columns: **Trusted senders** (a ledger of the sender register — state, orders, injection and spam signals, updated; **Trust…** opens a centred panel that takes the `HoldToApprove`, **Untrust** is a plain button) and **Strangers** (mail from senders matching no vendor, with the reason it was kept; **Add as a vendor…** opens the plain-create ask and trusts nothing, **Put away** has an eight-second undo; a *this house / all houses* switch when the account has more than one). A trust is read back from the register before it is called saved; a failed read is a sentence, never an empty register; a full 100-row strangers window prints as a floor. **[2026-09-25: committed on `fix/comms-house-sources`. The flag gate this sentence described is moot — `communications` is in `LIVE_PAGES`, so every house renders the section.]** It sat, uncommitted, behind `mudavym_design_communications` when written.

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_communications`)

> **Chrome (2026-09-04).** With the flag on, this page is framed by the house
> header — `apps/web/src/components/mudavym/HouseHeader.tsx`, mounted by
> `PageGate` above every `next` tree: the A+M mark, this page's name, the ⌘K
> "Search or act" trigger, the house (or the branch switcher when there is more
> than one), the bell, ~~the theme menu~~ and the account menu **[2026-10-01: the theme
> menu left the header — founder, page walk-through DASH-W23; the ground is chosen on
> `/profile`]**. Chrome is excluded
> from §Surface by PAGE-CONTRACT, so it is named here and nowhere else in this
> note; its motions live in `components/mudavym/MOTIONS.md`, not the table
> below.

Canonical source with curves: `apps/web/src/pages/communications/next/MOTIONS.md`
— this list is the note-side index (ADR 0044 §2).

| id | name | fires |
|---|---|---|
| `cm-row-settle` | Row settles open | a ledger row's expansion — `settle`, 320ms house curve, 4px drop |
| `cm-ink` | Ink micro-state | row and rail-button hover/focus — one paper step, nothing translates |
| `cmp-pick` | Picker ink | a recipient, a template or an engine sentence taking hover/focus inside the composer — `ink`, 160ms; the same paper step as a page row |
| `mdv-sheet-tuck` | The sheet arrives | the composer and the letter library sliding in from the right — `tuck`, 300ms spring; owned by `components/mudavym/Sheet.tsx` (ADR 0112) |
| `cm-draft-settle` | The drafted reply opens | *Read it* on a waiting draft — the house `Panel` on `settle`, 320ms. The panel adds no motion of its own; the hold inside it is `pour` → `stamp`, and `prefers-reduced-motion` renders none of the three |

Deliberate non-motions: glance figures never tally; draft chips never pulse (a
draft drawing attention to itself starts to look like activity — prc-02); the
undo countdown ticks as a number and gets no progress bar (a two-minute window
is a decision that can still be reversed, not a process being watched); a
queued letter's chip does not pulse either, for prc-02's reason one step
further; a refusal appears in place, in words, and never shakes or flashes;
and **the seal is not on this page's Send** — `HoldToApprove` fires only for the
Mudavym subdomain sender, which is not provisioned, so nobody sees it today.

**2026-08-31 wave polish (Sorting Office two-Opus review):** the ledger row's
expand/collapse toggle carried an inline `background: 'transparent'` that
permanently outranked `.cm-row:hover` — a dead hover; fixed by removing the
inline value rather than adding `!important` (verified via a static cascade
repro, since the route sits behind auth). The two template-workshop buttons
in the channels rail (`setSheet('gmail')`/`setSheet('sms')`) also carry
`.cm-row` with a static inline background, but theirs is `var(--paper-0,…)`,
a deliberate card fill, not `'transparent'` — deferred to a design call in
this pass, and **fixed later the same day** in the follow-up below. `fmtWhen`
in `cm-format.ts` was checked against the same-day `so-format.ts` date-parser
bug: `sentAt`/`createdAt`/`nextRunAt` are all `timestamp with time zone`
columns, not date-only, so the bare `new Date(iso)` it uses is already
correct — no backport needed here.

**2026-08-31 dead-hover follow-up (channels-rail template-workshop
buttons):** the "Email template workshop" / "SMS template workshop" buttons
carry `.cm-row` but rested on a static inline `background: 'var(--paper-0,
…)'`, which — like the ledger-row toggle's inline `'transparent'` fixed in
the same day's wave-polish pass — permanently outranked `.cm-row:hover`
regardless of selector specificity, so hovering did nothing. Unlike the
ledger row, this resting value is a deliberate paper-0 card fill, not a bare
`'transparent'`, so it couldn't just be deleted without changing the resting
look. Fixed by moving the resting value into a new `.cm-card` class (kept
alongside `.cm-row` on both buttons) instead of the inline style — the
existing `.cm-row:hover` rule now governs them, and the resting appearance
is unchanged (verified via computed-style diff: same `rgb(26,26,26)` at
rest, `.cm-row:hover`'s value while `:hover` matches). Still no
`!important` used anywhere on this page.

### Design used, and why (ADR 0045 §5 wave · MAKEOVER-VERDICTS: MERGE, warning on both sides)

The founder liked **today's page** because "it shows basically everything" and
rejected the redesign as "too much text" — while calling today's template-ish
UI also to be avoided. The build takes both warnings structurally: a
four-figure **glance strip** (threads · drafts waiting · sent 30d · report
schedules — each derived from a live query and shown as an em dash until that
query answers) restores at-a-glance completeness; the conversation book is a
**ledger of short rows** (date · vendor · type · wine · state chip) with all
prose held inside the settle-open expansion; and the founder's two named
additions are built in — the **channels rail** makes the page's integrations
visible in words, and the template builders open inside a **TemplateSheet**
whose header answers "what's going on" before anything renders: *"You are
editing a new template. Nothing is sent from here."* (it said "a saved
template" until 2026-09-02 — the sheet never passes `editingTemplate`, so the
builder always opens on a new, unsaved one; ADR 0083). prc-02 carried: a
DRAFT/PENDING_APPROVAL exchange wears a dashed "AI draft · not sent" chip and
its body renders in a dashed frame. Legacy page untouched; flag defaults OFF;
override `mudavym.design.communications`.

### The house writes its own mail, 2026-09-04 (ADR 0118)

**What the founder asked.** Build the composer from sketch 100 and retire both
legacy builders behind `mudavym_design_communications`; the sender is per house
and commercial; Send costs the seal on a Mudavym address and a plain button with
a short undo window on the house's own mailbox; recipients are the book only,
with "add to the book" inline; the merge unit is the engine's whole sentence with
its provenance. Two further calls on 2026-09-04: the Mudavym address is a
**paid-tier** option (a free house sends from its own mailbox, and the row never
shows a price — OD-23), and a **staff broadcast is not a composer template** at
all (crew messages stay on `/team`).

**What was built.** `pages/communications/next/Compose/` — `ComposeSheet` (the
wide sheet), `SenderLine`, `RecipientField`, `InsightPicker`, `useComposeData`,
`compose-format` — plus `TemplateSheet.tsx` rewritten as the house letter
library. Gateway: `apps/api-gateway/src/communications/letters/`
(`house-sender.service.ts`, `house-letters.service.ts`,
`house-letters.controller.ts`, `house-letters.cron.ts`) and migration
`20260904150000_the_house_writes_its_own_mail.sql`.

**The structure that enforces the verdict.** The sender line is the FIRST thing
in the sheet, above To and Subject, because which address a letter leaves from
decides whether there is a letter at all. Everything below it is disabled or
enabled by what that line says, and the line's four states are read from a stored
scope rather than a flag: a Google grant that did not ask for `gmail.send` is
**not** a sending identity, and saying so is the difference between this page and
one that lights a button because a connection exists.

**Design used, and why.**
- **A wide sheet (640px), not the standard 440.** ADR 0112 fixed one width on
  purpose and named this as the anticipated exception; 440 minus padding is a
  ~46-character body column, which is too narrow for a writer to judge their own
  paragraph. `Sheet` gained a `wide` boolean — a boolean, not a number, so it
  cannot become per-page freedom by increments.
- **Two alternative directions considered, and not built.** (a) *A full-page
  composer at `/communications/compose`*: more room, and it would have let the
  conversation book sit beside the draft. Rejected because a letter is one
  object's edit, which is exactly what the sheet shape means (ADR 0112) — and
  because a route is a commitment to a place, while a letter is written from
  wherever the reason to write it appeared (a recommendation, a vendor row, this
  page). (b) *An inline composer docked at the foot of the conversation book*,
  the Gmail idiom. Rejected because the book is a ledger of what happened and a
  half-written letter is not one of those things; a draft parked inside a record
  of sent mail is the same category error the "AI draft · not sent" chip exists
  to prevent.
- **What was substituted.** The sketch's seven templates became **five** (the
  staff broadcast is out by decision, and "in-house creation" is a flow rather
  than a template). The sketch's recommended build order shipped **against a new
  route rather than `manual-reply`**: that route lives in `procurement/`, which
  another builder owns this pass, and it derives the subject
  (`procurement.service.ts:3436`) — a composer whose subject is computed for it is
  not a composer.

### Modal shape, 2026-09-03 (ADR 0112) — RETIRED 2026-09-04

**Superseded by the section above.** The `.cm-builder-skin` three-selector
re-skin described below no longer exists: the builders it re-skinned are no
longer mounted from this page at all, so there is nothing left to re-skin. Kept
as the record of what was tried and why it was only ever a boundary, not a
finish.


**TemplateSheet re-skins the OUTER SURFACE only, and this is the one place in the
wave where that is true.** The clarity banner is unchanged. Below it, the wrapper
now carries `.cm-builder-skin`, and three structural selectors repaint the two
legacy builders' *backdrop*, *card* and *header band* in house tokens — the
blue/teal gradients become the one seal. **Everything inside those cards is still
the legacy look**: toolbars, panel palettes, preview panes, buttons. That was a
deliberate boundary, not an oversight — `GmailTemplateBuilder` is 1700+ lines and
`SMSTemplateBuilder` 900+, and re-skinning their internals is a page rebuild, not
a modal pass. Filed in §9/§13 as the remaining coherence gap.

The selectors are structural (`> div`, `> div > div`, `> div > div > :first-child`)
rather than Tailwind class-string matches, because a class string is not a
contract; `AnimatePresence` and `Suspense` render no DOM node, so `> div` is and
stays the builder's own overlay root. The wrapper deliberately does **not** carry
a second `.mudavym` class — it already sits inside the page root, and a nested
bare `.mudavym` re-declares the light token column on itself, which is the exact
charcoal bug PageGate's header documents.

### Overlays, 2026-09-05 (sketch 102 · ADR 0112)

<!-- sketch-102-overlays -->
Generated by `.planning/sketches/102-modal-census/build.py --docs` from `census.py` — edit the census, not this table.
The rule: an object gets a sheet, a question a panel, a choice a popover; the seal never sits in a popover.

**`/communications`** — The composer and the template library are built at 640. Eight legacy modals retire with the two builders (ADR 0118). One act is owed: approving a reply the house drafted.

| Page | Overlay | Shape | Status | Where the act lives or went | Source |
|---|---|---|---|---|---|
| `/communications` | A letter from the house | sheet · wide · seal | Built | A letter is prose; 440 minus padding is ~46 characters — the one wide case ADR 0112 anticipated. | `pages/communications/next/Compose/ComposeSheet.tsx:209` |
| `/communications` | Templates | sheet · wide | Built | The library is one object; a template is edited in place inside it. | `pages/communications/next/TemplateSheet.tsx:132` |
| `/communications` | The house's reply, drafted | panel · seal | Built | A question with the seal — nothing reaches a vendor without a person's hold (ADR 0118). BUILT 2026-09-06 (packet 2) WITH TWO NEW GATEWAY ROUTES: POST orders/:id/draft-seal-challenge mints over the LETTER when the hold begins, and POST orders/:id/send-drafted-reply spends it. `send_draft` is its own seal act, so a seal minted to approve an order's money cannot send its mail, and a paragraph edited after the hold is refused rather than posted. | `BUILT 2026-09-06 as pages/communications/next/DraftedReplyPanel.tsx (was components/orders/DraftEmailApprovalPanel.tsx:130, on /orders)` |
| `/communications` | Gmail template builder | — | Retires | The composer and the template library (ADR 0118 retires both builders). | `components/documents/GmailTemplateBuilder.tsx:852` |
| `/communications` | SMS template builder | — | Retires | The house's text sender (ADR 0121, research). | `components/documents/SMSTemplateBuilder.tsx:423` |
| `/communications` | Select report type | — | Retires | 'Start from something the house noticed'. | `components/communications/ReportTypeModal.tsx:122` |
| `/communications` | Create category | — | Retires | A template's Purpose. | `components/documents/NewCategoryModal.tsx:112` |
| `/communications` | Switch component type | — | Retires | Builder-internal; goes with the builder. | `components/documents/VariationSelectorModal.tsx:124` |
| `/communications` | Quick Gmail send | — | Retires | The composer. | `components/emails/QuickGmailModal.tsx:238` |
| `/communications` | Send email (saved template) | — | Retires | The composer; the seal on the subdomain, an undo window on the house's own mailbox. | `components/documents/SavedTemplates.tsx:580` |
| `/communications` | Send SMS (saved template) | — | Retires | The text sender (ADR 0121). | `components/documents/SavedSMSTemplates.tsx:619` |
| `/communications` | Template library (new template · sent) | — | Delete | Dead code. Delete. | `components/documents/TemplateLibrary.tsx:606 and :945 — nobody imports it` |

Drawn in sketch 102 (`.planning/sketches/102-modal-census/index.html`); the policy is [[0112-one-modal-policy-three-shapes-one-primitive]].

## 2. Entry

- Sidebar (`components/layout/Sidebar.tsx:120`); command palette
  (`components/command/commands.ts:81`).
- [PAGE_MAP](../foundation/PAGE_MAP.md):113 lists it as no-inbound — the scan missed
  layout components; the sidebar is the real entry.

## 3. Files

- Route binding: `apps/web/src/App.tsx:279` (lazy import :95).
- `apps/web/src/pages/Communications.tsx` (562 lines).
- Rendered: `components/documents/{GmailTemplateBuilder, SMSTemplateBuilder, SavedTemplates, SavedSMSTemplates}.tsx`, `components/communications/{ReportScheduler, ClassifiedConversationList}.tsx` (Communications.tsx:13-31; mounts :506,513,544,553).

**Behind the flag (ADR 0118):**

- `apps/web/src/pages/communications/next/CommunicationsNext.tsx` · `useCommsNextData.ts` · `cm-format.ts` · `MOTIONS.md`
- `apps/web/src/pages/communications/next/TemplateSheet.tsx` — the house letter library (no longer the two legacy builders)
- `apps/web/src/pages/communications/next/Compose/` — `ComposeSheet.tsx`, `SenderLine.tsx`, `RecipientField.tsx`, `InsightPicker.tsx`, `useComposeData.ts`, `compose-format.ts`
- `apps/web/src/components/mudavym/Sheet.tsx` — extended with the `wide` prop (640px) this composer is the only user of
- Gateway: `apps/api-gateway/src/communications/letters/` — `house-sender.service.ts`, `house-letters.service.ts`, `house-letters.controller.ts`, `house-letters.cron.ts`, `house-letters.dto.ts`, `house-letters.spec.ts`
- Migration: `supabase/migrations/20260904150000_the_house_writes_its_own_mail.sql`
- `apps/web/src/pages/communications/next/WhoIsWriting.tsx` · `SenderActs.tsx` · `useSendersDeskData.ts` · `senders-format.ts` — Trusted senders and Strangers with the hold-to-trust and add-vendor acts (ADR 0160 §113 Open item 3, 2026-09-19)

## 4. Endpoints

Atlas rows: [ENDPOINTS](../foundation/ENDPOINTS.md):495 (`reports`), :180
(`conversations`), :389 (`procurement`).

| Method | Path | Call site |
|---|---|---|
| POST | `/reports/generate` | `Communications.tsx:305` → `services/api/reports.ts:69` |
| POST | `/reports/schedule` | `Communications.tsx:277` → `reports.ts:74` |
| GET | `/reports/schedules` | `Communications.tsx:265` → `reports.ts:79` |
| DELETE | `/reports/schedules/:id` | `Communications.tsx:325` → `reports.ts:84` |
| GET | `/conversations/threads`, `/conversations/thread/:id`, `/conversations/stats/overview` | `ClassifiedConversationList` → `hooks/queries/useConversationQueries.ts:194,209,225` |
| POST | `/conversations/:id/summarize` | `useRegenerateSummary` → `useConversationQueries.ts:240` |
| GET | `/senders/reputation` | `useSendersDeskData.ts` (`useSenderRegister`) — owner/manager (`sender-trust.controller.ts`) |
| POST | `/senders/trust` | `useSetSenderTrust` — owner/manager; the page reads the register back, the gateway ignores a failed upsert |
| GET | `/prospects[?scope=all]` | `useStrangers` — any member; capped at 100 rows server-side |
| POST | `/prospects/:id/promote` · `/dismiss` · `/restore` | `usePromoteStranger` (owner/manager) · `usePutAwayStranger` · `useRestoreStranger` |
| GET | `/procurement/conversations/history` | `useProcurementConversationHistory` (Communications.tsx:28) → `useConversationQueries.ts:284` |

| POST | `/procurement/orders/:id/draft-seal-challenge` | **NEW 2026-09-06** (packet 2) — `pages/communications/next/DraftedReplyPanel.tsx`, at the moment the hold begins. Mints over the letter, the recipient and the copies; 404 when no draft is waiting |
| POST | `/procurement/orders/:id/send-drafted-reply` | **NEW 2026-09-06** (packet 2) — the same panel, carrying the seal in `X-Seal-Challenge`. Redeems, then calls the same `approveDraft` service the older unsealed route calls |
| POST | `/procurement/orders/:id/discard-draft` | the same panel's *Throw the draft away* |

**Behind the flag (ADR 0118), all JWT-guarded and tenant-scoped from the signed token:**

| Method | Path | Call site | Answers today |
|---|---|---|---|
| GET | `/communications/letters/sender` | `Compose/useComposeData.ts` | Measured live 2026-09-04 on the demo tenant: `kind: "none"`, `conversation.where: "shared_mailbox"`, `reader: {granted:false, enabled:false, lastRun:{grants:0, error:null}}` — nobody has consented to either grant, and the reader cron ran and truthfully found nothing (§9). Also carries `dispatcher` (letters out) and `conversation` (the four states, ADR 0118 D11) |
| GET | `/communications/letters/book` | `Compose/useComposeData.ts` | the vendor addresses on record; a failed read THROWS rather than answering `[]` |
| GET | `/communications/letters/templates` | `Compose/useComposeData.ts` | **400 in words** until migration `20260904150000` applies |
| GET | `/communications/letters/queued` | `Compose/useComposeData.ts` | letters still inside their undo window |
| POST | `/communications/letters/templates` | `TemplateSheet.tsx` | creates/edits a house letter template; refuses a non-vendor purpose |
| POST | `/communications/letters` | `Compose/ComposeSheet.tsx` | **202 = queued**, never sent. 422 off-book / guardrail, 409 no sender, 403 the house revoked the grant |
| POST | `/communications/letters/:id/cancel` | `Compose/ComposeSheet.tsx` | pulls a queued letter back; refuses once the window has closed |
| GET | `/analytics/insights/:restaurantId` | `Compose/useComposeData.ts` | the engine's sentences with `candidate_key` / window / `computed_at` |
| POST | `/providers/:id/contacts` | `Compose/RecipientField.tsx` | "add to the book" — the contact is created BEFORE a letter can address it |

Note: the conversation hooks use their **own axios instance** against
`VITE_API_GATEWAY_URL` (`useConversationQueries.ts:4-7`), not the shared `apiClient`.

## 5. Signals

**None.** No tracking, no `data-ux-key`; reporter dark (`lib/uxSignals.ts:15`).

## 6. Tier cut

**Core** with Plus content: templates and scheduled sends are operate; the
classified-thread view and drafted credit emails are the S02/S03 **Plus**
"understand" rows ([TIER-MAP](../03-scenarios/TIER-MAP.md):38-39). Inbound
classification behind it shipped as Phase 0 (memory: inbound-email-intelligence-plan).

## 7. Rebrand surface

**3 user-visible strings** — the email template preview header/footer renders
"WineOps AI": `components/documents/GmailTemplateBuilder.tsx:1349,1417,1464`
(mounted from this page, `Communications.tsx:544`). Page file itself: 0. Layout
chrome per dashboard.md §7.

## 8. State & config

- Channel filter (all/email/SMS) is page state (`Communications.tsx:237`).
- Procurement-history labels depend on `outbound_email_type` staying in sync with the
  DB CHECK constraint (memory: procurement-conversations-schema-gotchas).

## 9. Gaps

[changed 2026-10-02, walk-through R2: the gaps the walk-through found and did not build here are in §14 as own-branch rows (W10's phases, W10f, W10i, W12a–W12d, W13b's gateway part, W17, W18b, W20c, W24's server half, W25), in the R2 rows of `p4-scratch/review-shared-queue.md` (W26, W34, W35, W36), in `.planning/tech-debt.d/2026-10-01-fix-review-communications.md`, and in the OD-TBD on iCloud's terms (W18).]

### The composer's own gaps, 2026-09-04 (ADR 0118)

- **~~BLOCKING — no house can send a letter today~~ — CLOSED 2026-09-04.** The
  third `IntegrationDefinition` this gap asked for exists: `gmail_send`, in
  `apps/api-gateway/src/integrations/integrations-oauth.constants.ts`, requesting
  `https://www.googleapis.com/auth/gmail.send` and nothing else, with its own
  consent-screen disclosure stating that it can send and cannot read, search,
  list, modify or delete a single message. The Drive grant was **not** widened —
  `google_drive` still lists "Your Gmail messages" under `notRequested`, and a
  Drive-only house still resolves to `kind: "none"`. Proved by
  `apps/api-gateway/src/integrations/gmail-send-asks-for-one-thing.spec.ts` (8
  assertions, 6 of which fail against `HEAD`'s constants file) and by the
  dispatcher's own end-to-end spec in
  `apps/api-gateway/src/communications/letters/house-letters.spec.ts`.
  **What remains open, and is now the only thing between a house and a sent
  letter:**
  - **Google app verification.** `gmail.send` is a restricted scope; the OAuth
    client is unverified and `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are unset
    on every deployment, so nobody outside the test-user list can complete the
    consent. Justification text is filed in ADR 0111. **Why not yet:** it is an
    external review with a lead time, and the submission is the founder's to make.
  - **The connections page's attachment row prints the wrong permissions for
    it.** The row itself appears automatically (the catalogue drives the list),
    but `apps/web/src/pages/connections/next/ConnectionsNext.tsx:964-968` (grep
    `'Never mail, never other documents'` — the file is moving) hard-codes "Create and edit files it made" / "Never mail, never other
    documents" for **every** unconnected integration — which is precisely untrue
    of a sending grant. **Why not yet:** `pages/**` is outside this pass's paths;
    the patch is written out in this session's report and in §13.
  - **No live end-to-end send has been made.** The local gateway points at the
    **production** Supabase project and consenting a real Google account would
    put a real credential and a real sent message into it. **Why not:** ADR 0020
    — a verification that requires fabricating production state is not a
    verification worth having.
- **HELD — the template library reads 400 until migration `20260904150000` applies.**
  `category`, `merge_fields`, `updated_by` and `last_used_at` do not exist on
  `communication_templates` yet. Measured live against `:4000` on 2026-09-04, the
  route answers `"The house's letter templates could not be read (column
  communication_templates.category does not exist). This is a failed read — the
  library is not empty, it is unknown."` and the sheet renders that sentence.
  **Why not yet:** migrations auto-apply on merge and are never hand-applied
  first (that produces a version mismatch); the file ships in the same change.
- **HELD — two writers now touch `communication_templates`.**
  `restaurant-templates/` writes `type='email'|'sms'|'sender_identity'`; the house
  letters write `type='letter'` through `communications/letters/`. **Why not yet:**
  `restaurant-templates/`'s DTO is `whitelist: true, forbidNonWhitelisted: true`
  and models four columns; growing it to carry the purpose, the merge fields, the
  author and the last-use was outside this pass's paths. §13.
- **NOT FIXED, BY DESIGN — a `gmail_send` grant records no email address.** The
  scope list is send-only, so it carries no `openid`/`email` and
  `fetchAccountEmail` (`integrations-oauth.service.ts:446-462`) stores `null`.
  The sender line therefore names the **person** who consented rather than an
  address, and the dispatcher **omits** the `From:` header instead of emitting a
  blank one, letting Gmail stamp the authenticated mailbox. **Why not yet:**
  adding `email` to the grant would make the address readable, but it widens a
  grant the founder specified as the send scope and nothing else — that is a
  founder call, filed in the session report, not one to take by default.
- **NOT BUILT — a letter carries no attachment.** There is no attachment path on the
  manager-written route, and the composer does not pretend there is.

### Retention's own gaps, 2026-09-05 (ADR 0118 D12-D15)

- **THE DELETION IS NOT COMPLETE, and this is the sentence that says so rather
  than a claim that it is.** `public.conversation_embeddings.message_text` is
  `text NOT NULL` and holds a second copy of a message's text beside its vector
  (`services/agent-orchestrator/agents/provider_conversation_agent.py:1161-1175`).
  That table carries `session_id`, `provider_id` and `restaurant_id` and **no
  `conversation_id`**, so nothing can join a mirrored conversation row to its
  embedding row and the sweep cannot reach it. A mirrored reply whose text also
  reached that table still has its text in the database after its raw mail is
  "deleted". Closing it needs either a `conversation_id` column on that table or
  a rule that the Python agent never embeds a mirrored row.
- **Google's required Limited Use sentence is still absent from the consent
  screen.** Measured 2026-09-04 (`messaging-senders.md` §8.1) and re-measured
  2026-09-05: no `dataHandling` field carries "The use of information received
  from Google Workspace APIs will adhere to the Google User Data Policy,
  including the Limited Use requirements", which Google's own policy requires be
  disclosed in the application. One sentence in
  `integrations-oauth.constants.ts`; deliberately not folded into the retention
  field, because a use disclosure hidden inside a retention answer is a
  disclosure nobody will find.
- **`message_text` cannot be nulled**, so a deleted body is a tombstone sentence
  rather than absence. `procurement_conversations.message_text` is `text NOT
  NULL` on the production baseline and relaxing that is a constraint change on a
  table five subsystems write to. The tombstone names the date and the reason;
  an empty string would have read as "the vendor sent nothing".
- **Two grants in one house make two independently deletable halves of one
  thread.** The sweep keys on `mirrored_by_grant_id`, so one person revoking
  deletes only what their mailbox produced. A conversation view will show one
  half tombstoned and the other intact. That is correct behaviour and it will
  look like a bug the first time somebody sees it.
- **The window is derived but never yet exercised on real data.** Measured
  2026-09-05 through the local gateway against production: the readable tenant
  `550e8400-e29b-41d4-a716-446655440000` has zero `procurement_credits` and zero
  `procurement_conversations`, so every house on this deployment would derive
  `no_dispute_recorded` and get the 92-day margin alone. The dispute-span branch
  is proved by unit test and by nothing on live rows.
- **`setHouseGrantAccess(houseUses: false)` deliberately does NOT delete.** The
  house withdrawing its own use of a member's grant is not that member revoking
  consent, and deleting on it would let a manager destroy a colleague's mirrored
  correspondence without the colleague acting. Named as a founder question in
  ADR 0118 rather than defaulted either way.

### The house inbox's own gaps, 2026-09-04 (ADR 0118 D8-D11)

- **CLOSED 2026-09-05 — the house can switch the reader on.** The founder was
  shown the fork and chose *"the flags route gains a manager check"* — one rule
  for every flag rather than a second control elsewhere. `PUT
  /settings/feature-flags` now calls `assertCanManageRestaurant`
  (`settings.controller.ts:105-109`), the same helper the approval thresholds in
  that controller already used, so the route refuses anyone who is neither owner
  nor manager with the sentence that helper writes. With the route asking who is
  asking, `enable_house_inbox_read` joined `UpdateFeatureFlagsDto`
  (`settings/dto/feature-flags.dto.ts`) — it had been withheld from it in commit
  `3925cde6` for exactly this reason — and the rebuilt `/settings` grew its own
  row for it, disabled with the reason for a non-manager (ADR 0083,
  `pages/settings/next/FeaturesSection.tsx`). The same pass closed the wider
  hole the fork exposed: `enable_ai_autonomous_send`, which puts AI-written
  email in front of a vendor unread, had been flippable by any authenticated
  member since it shipped. Proven both ways in
  `apps/api-gateway/src/settings/flag-writes-are-role-gated.spec.ts` (8 cases),
  with the pre-fix acceptance measured against a `git show HEAD:` copy of the
  controller.
- **CLOSED 2026-09-04 — the consent screen refused `gmail_send` outright.**
  `AuthorizeIntegration.tsx` held `const VALID_IDS = ['google_drive', 'excel']`
  and checked the route parameter against it *before* reading the catalogue. Every
  Connect row on `/connections` and `/profile` links to `/authorize/:id`, so the
  only path to consenting to the sending grant declared that morning ended at
  *"Unknown integration. That integration doesn't exist."* — the grant was
  unreachable and no test failed. Measured against `git show HEAD:` (5 of 5
  assertions fail on HEAD's page; a one-off run confirms HEAD rendered the wall).
  Fixed by removing the copy: the server's catalogue decides. Widening
  `IntegrationId` then surfaced two more copies of the same fault at compile time
  and both are corrected.
- **NOT FIXED, BY DESIGN — a vendor who writes from an address the book does not
  hold is invisible to this reader.** The `from:` bound is the grant's promise, so
  the reader cannot widen itself to catch a new address. That mail still reaches
  the shared mailbox's cold-email/prospect path, which is unchanged. **Why not
  yet:** lifting it means either an unbounded read (refused) or a second, wider
  consent — the founder's call, ADR question 6.
- **NOT FIXED, BY DESIGN — `gmail_read` records no email address.** Same shape as
  the send grant: the scope list is one scope, so no `openid`/`email`, so
  `fetchAccountEmail` stores `null` and the reader's status names the **person**
  who consented rather than a mailbox address.
- **NOT BUILT — the reader polls; it does not watch.** A per-grant `users.watch`
  with Pub/Sub push would be lower-latency and cheaper per tick. **Why not yet:**
  a topic per grant with an IAM binding, a 7-day renewal and a per-house push
  endpoint is Google Cloud plumbing nobody has been asked to buy. §13.
- **NOT MEASURED LIVE — no mailbox has been read.** Every claim above is proved by
  spec with a stubbed `fetch`, plus read-only curls of the catalogue and the
  sender route. **Why not measured live:** consenting a real Google account
  through the local gateway would put a real credential into the **production**
  Supabase project it points at and read a real person's mail. ADR 0020 — a
  verification that requires fabricating production state is not a verification
  worth having.
- **STATED, NOT FIXED — nothing says how long a read reply is kept.** A vendor
  reply now reaches `procurement_conversations` from a person's private mailbox
  and no retention rule covers it. ADR question 7.
- **PRE-EXISTING, NOT CAUSED HERE — `GET /settings/feature-flags` answers 500 on
  this branch.** Measured live on `:4000`, 2026-09-04:
  `{"message":"Could not read your feature settings.","statusCode":500}`. The
  cause is that the p4 wave's own flag-column migrations
  (`20260903150000_mudavym_design_flags_connections.sql` and the rest) are not on
  `origin/main` yet while `getFeatureFlags` selects every ACTIVE key. This build
  adds one more column to that same select and does not change the outcome;
  recorded so a reader meeting the 500 does not attribute it here.
- **NOT MEASURED LIVE — the guardrail refusal and the no-sender refusal are proved by spec, not by
  curl, on this deployment.** The demo tenant
  (`550e8400-e29b-41d4-a716-446655440000`) has **zero** providers, so the
  book check — which deliberately runs first, so it is reachable at all — answers
  every request before the other two can. **Why not measured live:** creating a
  vendor to unblock them would write a fabricated row to the **production**
  Supabase project the local gateway points at (`SUPABASE_URL=…exzueerziesmczwlhomd…`).
- **STATED, NOT FIXED — `max_rounds` counts only a letter attached to an order.** The AI path's
  count is `outbound` rows for `order_id` (`inbound-responder.service.ts:248`), so
  a letter with no order is not one of its rounds — there is no thread for it to
  be a round of. Stated on the row rather than papered over.


- ReceiptsNext-style parity, deliberate: with the flag ON, three legacy
  surfaces are not carried yet — the saved-templates lists (workshops open,
  but the saved library isn't browsable), the classified-history tab's
  filter controls, and the report-scheduler's create/delete forms (schedules
  render read-only). Flip the flag back to operate them; carrying them over
  is the flag-ON exit criterion (§1b).

- **Scheduled report *sending* is feature-flagged off server-side** — "no mailer —
  scheduled send is feature-flagged" ([TIER-MAP](../03-scenarios/TIER-MAP.md):51, S15
  Plus). The scheduler UI here creates schedules a mailer never executes.
- **Who a send actually reaches was decided by two columns that do not exist,
  until 2026-09-02** ([ADR 0098](../decisions/0098-a-preference-is-read-from-the-column-it-lives-in.md)).
  `communications/recipient-resolver.service.ts` is the module every scheduled
  send here resolves through, and its `checkChannelPreference` read
  `prefs.order_channels` and `prefs.report_channels` — names no migration has
  ever declared (the table has `order_approval_channels` and
  `financial_reports_channels`). The row arrives via `.select("*")`, so the reads
  were `undefined` with no error, and on the stock production row the check ran
  backwards on both axes: email refused to users who had enabled it, SMS sent to
  users who had disabled it. Anything in this note that reasons about *who*
  received a scheduled send before that date should be re-checked, not trusted.
- **The cross-tenant fallback OD-87 closed in the resolver was still open one
  layer up.** `notifications/low-stock-alerts.service.ts:resolveEmails` runs once
  per restaurant and reached the global `MANAGER_EMAIL` twice over — it omitted
  `allowDefaultFallback` (which defaults to `true`) and then read the env var
  directly inside a `catch {}`. Fixed in the same change; the legacy
  `DEFAULT_RESTAURANT_ID` tenant's recipient list is deliberately unchanged, per
  [ADR 0022](../decisions/0022-scheduled-jobs-serve-opted-in-tenants.md).
- ~~Saved templates persist client-side through the builder components rather than a
  server store~~ — **stale and wrong, corrected 2026-09-02.** The builders persisted
  *nowhere*: they made no network call and touched no storage (§10). A server store
  has existed all along (`useTemplates` → `/restaurants/:rid/templates`); the
  redesign's workshops are wired to it as of [ADR 0083](../decisions/0083-a-page-may-not-claim-a-write-it-never-makes.md).
  The **legacy** page's workshops are still no-ops (they do not claim otherwise).
- An email template's panel layout is stored as JSON in `body` and **cannot be
  re-opened in the builder** — the row is a record, not a document the workshop
  can reload (ADR 0083).

### The house's own archive (ADR 0118 D16, 2026-09-05)

- **The archive is ONE PERSON's Drive.** `integration_oauth_connections` is
  `UNIQUE (user_id, integration_id)`, so an armed `own_cloud` archive writes every
  vendor reply the house holds — including replies mirrored under a second
  person's mailbox grant — into one colleague's personal Drive, and it leaves with
  them. Founder question 1 on ADR 0118.
- **`google_drive`'s consent copy does not mention vendor mail.** Its
  `dataHandling` describes what the app writes out as "inventory exports and menu
  scans"; arming `own_cloud` writes correspondence. No scope is widened and the
  copy is still narrower than the act. Founder question 2.
- **A house that chose the paid archive still loses its mail on the window.**
  `mudavym_archive` cannot arm while OD-23 is open, and an unarmed mode changes
  nothing. Correct, and it will read as a bug to whoever chose it; the choice
  screen says so at the time.
- **A wiring mistake now STOPS retention rather than widening it.** With no
  `HOUSE_MAIL_ARCHIVE` provider the sweep refuses and records why. The safe
  direction, and it means mail can sit past its window with nothing but the sweep
  row's `error` to say so.
- **Nothing is billed and no billing table exists.** `billing_customers` and
  `billing_webhook_events` are the only `billing_*` tables in the migrations;
  there is no line-item or metered shape to write a GB-month into.

## 10. Maturity

[changed 2026-10-02, walk-through R2: the grade and paragraph below are about the legacy tabs. CommunicationsNext went through all ten walk-through passes (§14, P1–P10); the book's layout (W10 phase 1) and the server halves in §9 are what remain. The grade itself was not re-taken.]

**hollow.**

Three of the four tabs are real. The **Scheduled Reports** tab — the tab this page
is named for in the sidebar subtitle — is a UI over two tables nothing consumes.

**That was only half the story until 2026-09-02.** The reason recorded above is
entirely about the *legacy* page's Scheduled Reports tab. It said nothing about
the **template workshops**, on either page, which claimed a persistence they
never had:

| Claim | Evidence | Status |
|---|---|---|
| ~~The redesign's template workshop stores what you save~~ | `TemplateSheet.tsx:85` read *"Saving stores it for later"* while both builders were mounted `onSave={onClose}` (`:106,108`) — the template object handed to a function that ignores its argument. `GmailTemplateBuilder.handleSaveTemplate:482-537` made no network call and wrote no storage; `SMSTemplateBuilder:378` said `// Simulate save delay`. Both set `saveSuccess` and closed on a 1500 ms timer, so Save showed a green tick and **discarded the work**. Legacy has the same no-op and does *not* claim otherwise — a regression the rebuild introduced | **FIXED 2026-09-02 ([ADR 0083](../decisions/0083-a-page-may-not-claim-a-write-it-never-makes.md))**. `onSave` now posts through `useTemplates().createTemplate`; both builders `await` it and confirm only after the server accepts; a rejection keeps the builder open and says why |
| The saved template is re-openable in the builder | **No such round trip exists.** `communication_templates` holds `name`, `subject`, `body`, `type` and nothing else — no panels, thumbnail, category or usage count — and the global pipe is `whitelist: true, forbidNonWhitelisted: true` (`main.ts:52-56`), so the builder's own object would 400. SMS stores its message verbatim; email stores the panel structure as JSON in `body`. The sheet says so rather than implying an edit-later flow | **Stated, not fixed** — a real document store is a founder decision (ADR 0083, "revisit when") |
| The redesign's schedule rail distinguishes a failure from a wait | `schedulesKnown = data !== undefined` (`useCommsNextData.ts:94`) could not, so the rail printed *"The schedule list hasn't answered yet — —"* **forever**: `scheduled_reports` is created by no migration in `supabase/migrations/` and the endpoint 500s every time. The **legacy page held this distinction** (`Communications.tsx:269,293-299`) and the rebuild deleted it | **FIXED 2026-09-02 (ADR 0083)** — `schedulesError` restored, with legacy's sentence |
| The redesign's error banner covers the page | It covered **one query of five** (`isError: historyQ.isError`, `:96`); the other four rendered a failure as the em dash reserved for "has not answered", and "Try again" was unreachable unless the history itself failed | **FIXED 2026-09-02 (ADR 0083)** — one banner naming every failed source, a per-figure failed state, and a retry that refetches all five |
| The redesign's caches are tenant-scoped | Two were not — `['procurement','history']` and `['report-schedules']` — while the sibling hook in the same file was. The gateway **never reads `X-Restaurant-Id`** (grep finds it only in test fixtures), so scoping is JWT-only, and `AuthContext.tsx:433` catches a failed switch and proceeds on a fallback that does nothing | **FIXED 2026-09-02 (ADR 0083)**, and held by `scripts/check_windowed_figures.py` W6 + the new W7 |
| SMS templates "stage for the messaging channel" (`CommunicationsNext.tsx:333`) | All 27 production `procurement_conversations` rows are `channel='email'`; `POST /communications/sms` existed in the gateway with **no web client calling it** — and was **deleted the same day by [ADR 0084](../decisions/0084-the-communications-gateway-says-what-it-did.md)**, so there is now no raw SMS route at all | **FIXED 2026-09-02 (ADR 0083)** — workshop kept (Save is now real), copy states no SMS sender is reachable from this page |

| Claim | Evidence |
|---|---|
| ~~"Generate report now" produces a report~~ **FIXED 2026-08-26 (OD-81)** | Was: `POST /reports/generate` inserts one row with `status: "pending"` and NULL file urls (`reports.service.ts:42-71`) — **the only writer of `generated_reports` in the repo**, and there is no `UPDATE` on that table anywhere, so `pending` was permanent. The toast claimed "Report generated · Filed in Documents & Reports". Now: `handleGenerateReportNow` is **deleted**, the button is disabled and carries the reason, and no toast claims a generation. Production check: `generated_reports` holds **0 rows** |
| ~~A schedule causes a send~~ **CORRECTED + FIXED 2026-08-26 (OD-81)** | The dossier said the table "appears in three places, all in this one service". Two corrections. (a) It has a **web reader** too — `GET /reports/schedules` → `services/api/reports.ts:116` → this page → `ReportScheduler` (NEW-359). (b) **`public.scheduled_reports` does not exist in production** — verified against the live DB; it lives only in `supabase/migrations_archive/20260208024921_baseline_schema.sql:408`, never applied. So both the insert and the list fail 100% of the time, and the list failure used to render as an empty list. Still true: no cron, no consumer, no `next_run_at` writer. The UI now says "Saved schedules (n) · not running", and a failed read is shown as a failure rather than as "none" |
| The only weekly report that *does* send is unrelated | `@Cron("0 8 * * 1")` `sendWeeklyEmailReport` (`apps/api-gateway/src/communications/scheduled-tasks.service.ts:162-215`) is a **hardcoded single-restaurant** job gated on `DEFAULT_RESTAURANT_ID` + `MANAGER_EMAIL` env vars (`:70-79`, `:167-172`). It never reads `scheduled_reports` |
| ~~"The one place a manager sees every vendor conversation" (§12) — it showed **1 of 26**~~ **FIXED 2026-09-02 (ADR 0084)** | Was: `getConversationHistory` filtered `status IN (AUTO_SENT, APPROVED, SENT, COMPLETED, CLOSED, SEND_UNCONFIRMED)` **and** embedded `procurement_orders!inner`. Measured on production 2026-09-02: **27** rows, **12** pass the status filter, **2** survive the inner join, and 2 is what the query returned — because **25 of 27 carry `order_id IS NULL`**, so the join was the binding constraint and the status filter was not. On the one real tenant: **26 rows, 1 shown**. Every inbound vendor reply was excluded twice over (null `order_id`, and `DRAFT` — the column DEFAULT the inbound path never overwrites). Now: `!left` embed, and a **deny-list** withholding only `PENDING_APPROVAL` and outbound `DRAFT`, which are live in the approval queue on `/orders`. **25 of 26 visible** |
| ~~A conversation body renders as "No message body was recorded for this exchange"~~ **FIXED 2026-09-02 (ADR 0084)** | Was: `draftContent: row.content`, and **`content` is NULL on all ten inbound rows in production** — their body is in `message_text`, the `NOT NULL` column. So the page said no body was recorded about ten messages whose bodies were recorded. `getActiveConversations` (`:3584`) and `getOrderConversations` both already read `content ?? message_text`; this one method did not |
| "Regenerate" summary | `POST /conversations/:id/summarize` publishes `email.summarize.requested` (`apps/api-gateway/src/conversations/conversations.service.ts:438-446`) and returns `{success:true, message:"Summary regeneration requested"}` (:451-455). **That routing key has zero subscribers** — `EmailParsingAgent.get_subscribed_routing_keys()` returns only `email.inbound.received` (`services/agent-orchestrator/agents/email_parsing_agent.py:81-84`), and the string appears nowhere else in the repo |

What **is** real: templates persist server-side (`useTemplates` → `GET/POST/PATCH/DELETE /restaurants/:rid/templates`, `apps/web/src/hooks/useTemplates.ts:15-50`; controller `apps/api-gateway/src/restaurant-templates/restaurant-templates.controller.ts:23-83`, JWT-guarded) — **§9's "saved templates persist client-side" is stale and wrong**. Classified threads and procurement history read live rows.

The nine `@Public` communications test routes named in the P3 brief are confirmed closed: `communications.controller.ts:216,286,329,406,589,704,786,840,897,964` now carry `@UseGuards(NonProductionGuard)`; only `POST /webhooks/gmail` stays `@Public()` (:1030), authenticated by a Google OIDC token instead.

**Still open, and now written down (ADR 0084, 2026-09-02).** `POST /communications/email`
is an open relay: `@Body()` only, no `@CurrentUser()`, no tenant, no ownership
check on the destination address, and no record written — so any authenticated
user of any of the ten restaurants can send arbitrary HTML to any address on the
internet from the OAuth-verified sender domain, untraceably. It was scheduled for
deletion alongside its SMS twin. **The SMS twin was deleted; this one has a live
caller** — `services/agent-orchestrator/services/email_composer_service.py:354`
← `agents/provider_conversation_agent.py:3074`, the path every approved vendor
email travels — and it sends no `Authorization` header, so any check tight enough
to close the hole also stops vendor mail. Giving the orchestrator a caller
identity is a service-to-service auth decision, filed for the founder. Until it
lands, this route is open.

[CLOSED 2026-09-17, ADR 0149 #19 "Two doors, both locked" — the caller identity
came first, in ADR 0099 (`X-Admin-Key`, 2026-09-02), which still let a key holder
mail any address for no house. The route now lives in
`apps/api-gateway/src/communications/relay/`, and `RelayDoorGuard` picks one
door from the credential. **Service door:** the existing `X-Admin-Key`; the send
must name `restaurantId`, `providerId` and `conversationId` or `orderId`; the
conversation and order must be that house's, and every to/cc/bcc must be one of
that vendor's addresses in `HouseLettersService.book`. **Person door:** the full
`JwtAuthGuard` check, owner or manager of the session's house (read from the
database for that house), recipients limited to its members and its vendors'
contacts, the body sent as escaped `bodyText` (raw HTML refused), and a letter to
a vendor runs the two blocking house-letter guardrails. [CORRECTED 2026-09-17,
same day, after the lane's adversarial review: the person door runs every check
above and then REFUSES 409 — nothing a person writes leaves this route. The one
mailbox it can send from is the deployment's shared one, which ADR 0118 D1/D2
rule out for a house's own mail (and D2 rules out a send with no undo window);
#19 did not decide which mailbox a person's mail leaves from, so that fork is
the founder's and is not defaulted. A letter to a vendor already leaves from the
house's own mailbox through `POST /communications/letters`. The role is read by
`OrganizationsService.readRestaurantRole`, so an unreadable role is a 503, not
"no role". "Sent as escaped `bodyText`" was also false while it stood: the MIME
boundary was `boundary_${Date.now()}` and both bodies went out unencoded, so a
body carrying guessed `--boundary_<ms>` lines closed the text part and injected
its own HTML part or attachment. Fixed for every sender in
`GmailService.createMimeMessage` (128-bit random boundary, both parts base64),
and both bodies are bounded (`bodyText` 100,000, `bodyHtml` 500,000 characters).
An order-only service send is now also refused 403 when the order's vendor is
not the one named.] [SUPERSEDED 2026-09-17, later the same day — the founder
answered the fork the correction above left open: a person's mail leaves through
the house's OWN connected mailbox (`HouseSenderService.resolve`'s `gmail_send`
grant, the same one the letters composer already resolves — never the
deployment's shared one), sent with `HouseLettersService`'s `sendThroughGrant`,
naming the acting person as author (a signature line, since the grant may ride
on a different member's mailbox than the one who wrote the words). A house with
no connected mailbox — nobody has consented, or the read failed — still gets no
send: the door refuses with the resolver's own sentence and a machine-readable
`code: "house_mailbox_not_connected"`, never a bare 409. ADR 0114's house
cutoff on the grant still applies and surfaces as 403, not this refusal. Also
found and fixed the same day, out of this lane's own diff: `sendThroughGrant`
(`house-letters.service.ts`, shared by both the composer's dispatcher and this
door) wrote `Subject:` straight into the MIME header block with no line-break
guard, unlike `GmailService`'s DTO-guarded subject — a subject carrying a line
break could add a header (`Bcc:`) no recipient check ever saw. Fixed with a
`sanitizeHeaderValue` applied to every header line the function writes.]
[CORRECTED 2026-09-21, merging `origin/main`: `sanitizeHeaderValue` is gone.
Main's ADR 0172 encoder (`mime-headers.ts`) now writes every header
`sendThroughGrant` builds, this door's Cc/Bcc/Reply-To/In-Reply-To/References
included. A line break in the subject still folds to a space; one inside an
address is now refused before any fetch rather than folded and sent.]
[SUPERSEDED 2026-09-17, later the same day — the founder closed one more fork
the paragraph above left open: `GET /communications/letters/sender` already
promises this mailbox a server-side 2-minute undo window (ADR 0118 D2), and
an immediate send from the person door made that promise false for its own
callers. Founder: **the person door queues like every other send from this
mailbox** — D2's window is a property of the mailbox, not of any one
composer. Built the same day: `sendAsPerson` now inserts a
`relay_email_queue` row (`status: HOUSE_QUEUED`, `scheduled_send_at = now +
undoMs`, the already-signed body) and answers **202**, not 200, carrying the
row id, `dispatchAt`, `undoMs` and the resolver's own sentence — never a
`messageId`, since nothing has been sent. `RelayEmailCron` (once a minute,
same shape as `HouseLettersCron`) → `dispatchQueued` claims due rows
(`HOUSE_QUEUED` → `HOUSE_SENDING`, so two ticks or two instances cannot both
claim one), RE-RESOLVES the sending identity from the row's own actor rather
than trusting the grant captured at queue time, and sends through the same
`sendThroughHouseGrant`. `POST /communications/email/:id/cancel`
(`cancelQueued`, a plain JWT route, not behind `RelayDoorGuard`) pulls a
still-`HOUSE_QUEUED` row back before its window closes; a row already claimed,
sent, failed or another house's is refused (409/404), never silently
no-opped. New table `relay_email_queue`
(`20261001090000_a_persons_mail_queues_like_the_houses_own.sql`) [renamed
2026-09-27, PR #429 merge-train, to `20261025000000_a_persons_mail_queues_like_the_houses_own.sql`
— ADR 0212] [renamed again 2026-09-27, PR #429 audit fix round after 2b97a7563, to `20261105000000_a_persons_mail_queues_like_the_houses_own.sql` — ADR 0212; main's ceiling had moved to `20261031174623` (#438)] [renamed again 2026-09-27, PR #429 item-76 round, to `20261115100000_a_persons_mail_queues_like_the_houses_own.sql` — ADR 0212; main's ceiling had moved to `20261115000000` (#482)] — a
door-agnostic sibling of this page's own `HOUSE_QUEUED` rows on
`procurement_conversations`, not the same table, because that table's
`provider_id` is `NOT NULL` and the person door also reaches this house's own
members with no vendor at all. Proved by the four cases
`relay-email.doors.spec.ts` names: queued not sent, the undo cancels inside
the window, dispatch after the window through the re-resolved grant, and the
mailbox-not-connected refusal is unchanged and still synchronous.] **Record:**
every send writes `relay_email_attempted` to `system_audit_log` before the
provider is called (unwritable → 503, nothing sent), then `relay_email_sent` or
`relay_email_failed`; refusals where a house is known write `relay_email_refused`.
[CORRECTED 2026-09-17, review: a check that could not be made (a 5xx) writes
`relay_email_unavailable`, not a refusal; a person not shown to be owner or
manager gets a refusal row with the status and the gateway's reason only, never
the subject, recipients or ids they typed; the row no longer carries a
`letterId` that was really the conversation id.] [CORRECTED 2026-09-17, the
queuing answer above: a person-door send writes a fifth row first,
`relay_email_queued`, at queue time, before any attempt row exists — nothing
is attempted with a provider until the window closes and the cron claims the
row.]
A subject or threading header with a line break is refused 400 (it would add a
`Bcc:`). No web or mobile caller exists; the orchestrator now sends the house,
vendor, conversation and order. Proved by `relay-email.doors.spec.ts` and
`test_vendor_email_gateway_auth.py`, which share the orchestrator's body as a
fixture. Still open: whether a relay 4xx should release a vendor conversation
for retry or park it (ADR 0099's rejected alternative, never decided). [Which
mailbox a person's mail leaves from — the other question this paragraph
originally left open — was answered by the founder 2026-09-17, above; only the
4xx-release-vs-park fork remains open and unfiled.]] [DECIDED 2026-09-19,
founder, lane answers batch 4: that fork is closed; 400, 403 and 422 release
the vendor conversation's claim as definite send refusals, 401 still parks it
as SEND_UNCONFIRMED, and 404 and 429 are unchanged. ADR 0099 is now Locked,
see its bracket.] [CORRECTED 2026-09-18,
relay3 confirmer: the migration declared `scheduled_send_at NOT NULL`, and
`cancelQueued` and both of `dispatchQueued`'s terminal writes all set it to
`null` — Postgres rejected every one of the three with 23502. The undo could
never cancel anything (a 400, then the mail left anyway two minutes later),
and every dispatched row — sent or failed — stayed `HOUSE_SENDING` forever.
The in-memory spec double did not enforce `NOT NULL`, so the four required
tests passed while none of this held against the real schema. Fixed: the
column is now nullable (unshipped when found, so editing the migration was
safe; matches `procurement_conversations`' own column), re-proved by a PGlite
replay of the migration and every write the service makes, printing `PROBE:
all held`. Also fixed the same pass: `dispatchQueued`'s SENT/HOUSE_FAILED
writes now check their own update for an error instead of discarding it (a
failure is counted separately, `statusUpdateErrors`, never folded into `sent`
or `failed`); and `cancelQueued`'s update now carries `.select("id")` and
answers 409 if it matched no row, so a cancel racing the dispatcher's own
claim can no longer be told "pulled back" for a mail that is leaving.] **Who
may cancel (founder, 2026-09-18, ADR 0149 row 43 — his words, typo kept:
"only author is the best option but I also belirve the pool inbox is a good
idea"):** pulling a
queued send back is the author's alone, on both queues —
`RelayEmailService.cancelQueued` (this door) and `HouseLettersService.cancel`
(the letters composer's own queue, answering ADR 0118's open question 4 on
`procurement_conversations`). Either refuses a non-author with 403 and a
plain sentence before any state or window check runs, proved by
`relay-email.doors.spec.ts` and `house-letters.spec.ts`. **Direction, not
built:** the same answer named a pooled inbox — several owners of a house
sharing one view of what left and what is still queued, while each still
sends from and is named as the author of their own mailbox grant — as "a good
idea" worth having alongside the author-only rule, not instead of it. Nothing
here changes for it: no shared cancel right, no shared queue view, no new
table. If it is built, the natural seam is a read — a new `GET
.../email/queued` alongside the letters composer's own `GET
.../letters/queued`, which is tenant-scoped already (`house-letters.controller.ts:93`);
this door has no such route yet — rather than
a write — showing every member the house's own queue without widening who
may act on someone else's row — but that is a design the founder has not
been asked to choose yet, only floated.

## 11. Data flow

### Calls out

| Method | Path | Auth | Gateway controller | Returns |
|---|---|---|---|---|
| POST | `/reports/generate` | JWT (class) | `reports.controller.ts:31-46` | A `pending` row with null file urls |
| POST | `/reports/schedule` | JWT | `reports.controller.ts:132-147` | A `scheduled_reports` row nothing reads |
| GET | `/reports/schedules` | JWT | `reports.controller.ts:70-84` — declared **above** `@Get(":id")` on purpose (OD-45) | The list of unread schedules |
| DELETE | `/reports/schedules/:id` | JWT | `reports.controller.ts:149-166` | 204; scoped by `restaurant_id` |
| GET | `/conversations/threads` | JWT (class, `conversations.controller.ts:48`) | `:145-211` | Threads with `detected_sentiment`, `conversation_summary` |
| GET | `/conversations/thread/:id`, `/stats/overview` | JWT | `:216-237`, `:308-325` | Thread messages; sentiment counts |
| POST | `/conversations/:id/summarize` | JWT | `:291-304` | `{success:true}` — see §10 |
| GET | `/procurement/conversations/history` | JWT | `procurement.controller.ts:726-744` (svc `procurement.service.ts` `getConversationHistory`) | **Every** vendor conversation except the approval queue, since ADR 0084. Was: 2 rows out of production's 27 |
| GET/POST/PATCH/DELETE | `/restaurants/:rid/templates` | JWT (class) | `restaurant-templates.controller.ts:23-90` | Saved email templates |

### Fed by

| Surface | Producer | Live? |
|---|---|---|
| Classified threads | Gmail Pub/Sub push → `communications.controller.ts:1030-1180` publishes `email.inbound.received` → `RabbitMqBridgeService.handleInboundEmail` (`rabbitmq-bridge.service.ts:224-228,528`) inserts `procurement_conversations`; `InboundResponderService` writes `detected_sentiment`/`detected_intent` (`inbound-responder.service.ts:300,520`) | **Yes** — a live Gmail watch carries production traffic (OD-78) |
| Same, provider-agnostic path | `POST /webhooks/inbound-email` — `@Controller("webhooks")` + `@Post("inbound-email")` in `common/orchestrator/inbound-email.controller.ts:42,53` | **Dormant** — gated on two env vars in **two different files**: `INBOUND_WEBHOOK_SECRET` in the controller (`inbound-email.controller.ts:61-68`, returns `{status:"disabled"}` when unset) and `INBOUND_EMAIL_DOMAIN` in the address resolver (`inbound-address.service.ts:29`), not in the controller at all. Both unset |
| Procurement history | `provider_communication_agent` outbound drafts, `AgentTier.CORE` since the Phase-32 fix (`services/agent-orchestrator/core/agent_registry.py:132-146`) | Yes |
| Report archive | **none** — see §10 | No |
| Templates | Manual authoring on this page | Yes |

### Writes

| Write | Downstream reaction |
|---|---|
| `generated_reports` row (`pending`) | Realtime `report:generated` → toast on `/documents-reports` (`DocumentsPage.tsx:331-347`). Nothing else |
| `scheduled_reports` row | **none** |
| `restaurant_templates` row | Read back by this page and the SMS/Gmail builders. Not consumed by any sender |
| `email.summarize.requested` | **none** — unbound routing key on a topic exchange, so the message is dropped |

## 12. Design intent

**Should be:** the one place a manager sees every vendor conversation the system had on their behalf, and sets what goes out on a schedule.

| State | Handled? | Evidence |
|---|---|---|
| Loading | Partial | Procurement-history table has a spinner (`Communications.tsx:142-144`); schedules list has none |
| Empty | Yes | `Communications.tsx:145` |
| Error | **No** | Schedule/generate failures toast (`:301,:323,:333`), but read failures are silent — `useTemplates` swallows a fetch error into `[]` (`hooks/useTemplates.ts:70-75`), so a broken template API renders "no templates" |
| Permission-denied | **No** | No 403 branch anywhere on this page |

**Where the UI misleads**

1. "Report generated · Filed in Documents & Reports" with an **Open** deep link (`:315-318`) — the row exists, the report does not.
2. The Scheduled Reports tab renders a `nextRunAt` for a job that will never run.
3. **Regenerate** spins, succeeds, invalidates the query, and the summary is byte-identical (`useConversationQueries.ts:235-247`).
4. `GmailTemplateBuilder.tsx:1349,1417,1464` previews mail branded "WineOps AI" (§7).

## 13. Roadmap

[changed 2026-10-02, walk-through R2 (ADR 0260): next comes this branch's PR. W25 follows it on its own branch (ruled "after this PR"). W10 phase 1 (the classified book), W13b's gateway part, W17, W18b, W20c, W24's server half and W12 (rich letters) each go on their own branch, and no order was ruled among them.]

0. **The text sender's transport, and what stands between it and a message**
   (ADR 0121 addendum, 2026-09-05). The provider abstraction now exists —
   `communications/text/providers/`: one `TextTransport` interface, a
   `MetaCloudAdapter` and a `TwilioAdapter` whose request and response shapes are
   proven against fixtures transcribed from the providers' own published pages
   (`provider-fixtures.ts` carries the URL and fetch date for every shape), and a
   `TextCredentialsService` that stores a house's own token encrypted at rest with
   the same `TokenCryptoService` the OAuth grants use. **Nothing dispatches**, and
   that is enforced by a test rather than promised: the adapter sources are read
   with comments stripped and the suite fails if `fetch`, `axios` or an `http`
   import appears. What is missing is registration, not code — the two checklists
   under `07-reference/` say exactly what Meta and Twilio ask for, and **nothing
   on either has been done**.

0a. **What could not be established, so that nobody fills it in later by
   accident.** No WhatsApp per-message rate appears anywhere in this work:
   `business.whatsapp.com`, which hosts the rate cards, disallows this agent by
   name in its `robots.txt`, and `www.facebook.com` (the Business Verification
   document list) is `Disallow: /`. The design carries that absence rather than a
   guess — `house_message_meter.provider_cost_state` records **not_reported_yet**
   until a provider says otherwise, which is also the true state at send time on
   Twilio, whose `price` "is populated after the message has been sent/received".
   Twilio's UK sender-ID rules were not established either, and
   `TWILIO-ISV-CHECKLIST.md` §6 is deliberately empty: "not checked" and "not
   required" render identically to a house and only one of them is true.


1. **Decide what a generated report is** — a renderer that fills `pdf_url`, or delete the generate button. Blocker: founder decision; nothing in `.planning/decisions/` defines a report artifact. Everything below depends on this.
2. **Make Regenerate honest** — either subscribe an agent to `email.summarize.requested` (`email_parsing_agent.py:81-84`) or remove the button. One line of Python or one of TSX; today it lies for free.
3. **Run the schedules** — a cron reading `scheduled_reports` per restaurant. The weekly job it would replace is **no longer single-tenant**: as of 2026-08-26 (OD-87 / [ADR 0022](../decisions/0022-scheduled-jobs-serve-opted-in-tenants.md)) `sendWeeklyEmailReport` iterates opted-in tenants via `ScheduledTenantsService`, so this item is now "read the schedule table" rather than "add multi-tenancy". Still blocked by (1).
4. Surface read errors instead of empty states (`useTemplates.ts:70-75`).
5. Rebrand the three template-preview strings (§7).
6. Resolve the duplication with `/documents-reports` — `ClassifiedConversationList` is mounted on both (retire-to-write, CLAUDE.md §4). No ADR either way.
7. **A `gmail_send` integration, so a house can actually send** — a third
   `IntegrationDefinition` in
   `apps/api-gateway/src/integrations/integrations-oauth.constants.ts` requesting
   `https://www.googleapis.com/auth/gmail.send` with its own scope disclosure and
   `notRequested` list, plus Google verification for a sensitive scope. Nothing
   else in ADR 0118 is blocked on anything else; this is the whole of it. The
   resolver, the queue, the undo window, the dispatcher and the refusals are
   built and tested against a stubbed grant already.
8. **Grow `restaurant-templates` or fold the house letters into it** — the two
   modules now write one table under different `type` values (§9). Either the
   existing DTO grows to carry `category`/`merge_fields`/`updated_by`/`last_used_at`
   and `communications/letters` reads through it, or the letter templates move to
   their own table. Retire-to-write applies either way.
9. **The Mudavym sending subdomain** (paid tier; price is OD-23) — an ESP that
   supports a delegated sending subdomain and inbound parsing, DKIM/SPF CNAMEs and
   an MX on `mail.mudavym.com`, a DMARC policy on the parent, a parse webhook with
   its own signature check, and a table for the provisioned address, its owner,
   its state and its release date. The composer's `mudavym_subdomain` branch (the
   seal, no undo window) is written and unreachable until `MUDAVYM_SENDING_DOMAIN`
   is set.
10. **"Write to the vendor" from a recommendation** — `ComposeSheet` already takes
    a `prefill` prop (`providerId` / `subject` / `body`); the call site belongs to
    `pages/recommendations/next/`, another builder's path this pass.
11. **Attachments on a house letter**, if the founder wants them — a storage
    path, a size bound, and a decision about whether an attachment may carry a
    figure the body may not.
12. ~~**A manager-gated switch for the house-inbox reader**~~ — **DONE
    2026-09-05.** The founder took the first of the two paths: `PUT
    /settings/feature-flags` gained `assertCanManageRestaurant`, and it does also
    change who may flip autonomous sending, which was the point rather than a
    side effect. §9 carries the detail. What is left here is smaller and separate:
    `/connections` still has no row for the reading grant's house-level switch, so
    a manager who arrives from the consent screen has to cross to `/settings` to
    finish switching the reader on.
13. **A per-grant `users.watch` instead of the five-minute poll** — a Pub/Sub
    topic per grant with an IAM binding Gmail can publish to, a renewal before the
    7-day expiry, and a push endpoint that resolves the house from the
    notification. Lower latency, `history.list` at 2 units instead of
    `messages.list` at 5 — but `history.list` takes no `q`, so the book bound
    would have to move from the query into a post-filter over the whole mail flow,
    which is a weaker promise. Worth doing only if the latency is felt.
14. **The house's text sender** — [ADR 0121](../decisions/0121-the-houses-text-sender.md),
    survey in [`07-reference/messaging-senders.md`](../07-reference/messaging-senders.md).
    **UPDATED 2026-09-05: ACCEPTED IN THREE PARTS AND BUILT TO THE EDGE OF A
    SEND, so the "Nothing is built" sentence below is now wrong and is corrected
    here rather than in place.** The founder decided a crew text exists, that the
    first market is *both* (Türkiye WhatsApp-first, the US on SMS), and that a
    house gets a number *either* by bringing its own name *or* by Mudavym
    registering per house. Built: `house_text_senders`, `person_text_consents`
    and `team_note_deliveries` (migration `20260905210000`), one
    `TextSenderService` behind `/communications/text-senders`, and rows on
    `/connections`, `/team` and `/profile`. **The composer's text mode is still
    NOT built** — this item's own subject — and nothing sends: no per-house
    provider credential exists, so `send()` returns `transport_not_built` even
    for a connected sender with a consenting recipient. The per-market
    registration checklist a house must work through is ADR 0121's own
    "registration playbook" section.
    The founder answered ADR 0118's founder-question 2 on 2026-09-04: *"No letters
    only, however, we def need a sms sender, and text mesg sender since most
    conversations might just go with text"*, so this page's "letters only" framing
    is superseded and the composer gains a text mode. **Nothing is built.** What
    the research found, in four lines. **(1)** The existing sender is **Plivo, not
    Twilio** — one `PLIVO_PHONE_NUMBER` for the whole deployment
    (`communications/sms.service.ts:30-33`), the same shared-identity fault ADR
    0118 D1 refused for mail, plus one email has no analogue for: **a STOP reply to
    a shared number opts that person out of every restaurant on the deployment**,
    for five years (47 CFR 64.1200(d)(6)). **(2)** Measured on production
    2026-09-04, **0 of 21 providers are reachable by phone only** (4 have a phone
    and all 4 also have an email), so turning SMS on today buys zero
    conversations. **(3)** In Türkiye, the market where "most conversations go
    with text" is most likely true, **two-way SMS is not supported at all**
    (Twilio TR guidelines, fetched 2026-09-04) — an SMS there can carry a notice,
    never a thread. **(4)** WhatsApp Cloud API bills **per message since
    2025-07-01** and free-form messages inside an open 24-hour window are **free**,
    which is the exact shape of this product's traffic (a vendor writes, the house
    answers). Proposed: WhatsApp as a house-declared connection under ADR 0114
    first, SMS per house second, never a shared number. Six founder questions are
    open in the ADR — including whether book-only (D3) survives for a phone
    number, which is harder to hold than an email address because a number is easy
    to type from memory. The strongest counter-argument is in the ADR and is
    genuinely strong: WhatsApp-first puts the house's vendor thread in Meta's
    custody, and Meta may "pause and reject any Message Template at any time".

15. **Reach the second copy of a mirrored body, or stop making one** (ADR 0118
    D12-D15, §9). `conversation_embeddings.message_text` holds the text again,
    beside its vector, and has no `conversation_id` to join on — so the retention
    sweep deletes the body from `procurement_conversations` and cannot touch the
    copy. Two shapes: add `conversation_id` to that table and extend the sweep,
    or bound the Python embedder so a row with `mirrored_by_grant_id` is never
    embedded. The second is smaller and loses the search over mirrored replies;
    the first keeps the search and needs a migration plus a backfill nobody can
    make truthful for existing rows. Founder's call, and it is a real one
    because until it is closed the consent screen's deletion promise is broader
    than the deletion.
16. **Put Google's Limited Use affirmative sentence on the consent screen** (§9).
    Google's own policy requires the application to disclose that its use of
    Workspace data adheres to the Limited Use requirements, and no field carries
    it. One sentence in `integrations-oauth.constants.ts` for both Gmail grants.
    Not blocked on anything; deliberately left out of the retention change so it
    is visible as its own item rather than buried in a retention field.
17. **Exercise the dispute-span branch on real data.** The window derivation's
    long branch is proved by unit test only: measured 2026-09-05, the readable
    production tenant has zero `procurement_credits` and zero
    `procurement_conversations`, so every house on this deployment derives
    `no_dispute_recorded`. The scenario harness (ADR 0093) is where a real
    dispute span can be produced without touching production.

18. **Answer OD-23 for the archive, then arm B** — **still open after batch
   54**, and the parent's reading of OD-23 (bill through the messaging credits
   path) was WITHDRAWN there: OD-23 was answered for messaging, not for the
   archive. Original note: — `mudavym_archive` is built
   as far as it can be: the settings row, the refusal, the consent copy and the
   run counts all exist, and
   `house_mail_archive_settings_paid_tier_arms_only_with_a_price` refuses to arm
   until `price_minor_units`, `price_currency`, `price_unit` and
   `price_decision` are on the row. What is missing is the price and the ledger
   to bill it through — there is no line-item or metered-usage table on this
   deployment. Whichever pass answers OD-23 owns both.
19. **A second cloud for `own_cloud`** — the mode is named for any cloud and
   only Google Drive is wired. `DriveArchiveWriter` is the whole provider
   surface (four calls: search folder, create folder, multipart upload, read
   back); a OneDrive sibling is that interface again against Graph, and
   `house_mail_exports.destination` is where a second value goes. Not started,
   and nobody has asked.
20. ~~**Print the archive's owner on /connections**~~ — **DONE 2026-09-05**
   (founder batch 53, "As built, owner's name printed"). `GET
   /communications/archive` returns `owner`, and /connections prints
   `owner.keptIn` verbatim in the personal-grants register. Three states, never a
   blank: a name that was read, an account that records none, and a read that
   FAILED. What remains is the CONTROL that sets the archive, which is
   `connections.md` §13 item 13 rather than this page's.
21. **Amend the Drive consent copy — DONE 2026-09-05** (founder batch 54,
   "Amend the copy; the sealed choice is the consent"). `google_drive`'s
   `description`, its `drive.file` scope reason, `landsIn` and `keptFor` now say
   the house's vendor mail may be written to that Drive, that it is off until a
   manager or owner turns it on, and that /connections names whose Drive.
   **No scope was added and nobody was sent back through Google** —
   `drive-says-it-may-hold-the-mail.spec.ts` fails if a future pass widens the
   scope list, which is what makes "no re-authorisation loop" checkable rather
   than remembered.


### Codex execution — overlay packet, 2026-09-13

The recovered communications overlays and their interaction regressions were reconciled with current main. The cross-page seal, partial-result and validation account is appended to ADR 0118 under “overlay commitments”; the workspace immutable manifest records exactly what was integrated. This is implementation evidence, not a new design decision.

## Execution reconciliation — 2026-09-13, reconciled 2026-09-17

The WhatsApp inbound webhook and the `POST communications/text-senders/whatsapp/reply` /
`GET .../whatsapp/window/:providerId` endpoints exist under ADR 0121 P1 — durable,
tenant-scoped inbound receipts, retryable database failures, a signed-actor reply path,
and (added 2026-09-17) delivery-status callbacks applied to the house's own outbound row.
**No page surface consumes either endpoint yet** — this page has no composer for a
WhatsApp reply and no rendering of the 24-hour window state; a grep of `apps/web/src`
for `whatsapp/reply` or `whatsapp/window` returns nothing. That is on the pages build
backlog, not shipped. See ADR 0121's 2026-09-17 review-trail row for what was fixed and
what still needs a founder answer.

## The house page names the three sources it owns — 2026-09-25 (ADR 0083 amendment)

Founder, census fork F1, option (a) "amend ADR 0083". The Mudavym page's banner
names three sources — the conversation book, the thread index, the drafts
awaiting action — and a real failure of any of them still raises it
(`useCommsNextData.test.tsx` fails each alone). Off the page, with their
requests: the **report schedules** (glance figure + rail card; `public.scheduled_reports`
is created by no migration, so the banner fired for every house) — back when a
real table exists, tracked in v3.0-TECH-DEBT "Scheduled reports is a dead
feature" and by `check_queried_tables_exist.py` KNOWN_MISSING; and the **Gmail
inbound-watch line**, now a row on the admin desk ([[admin]]). The legacy page's
Scheduled Reports tab (§1a) is unchanged and leaves at the ADR 0149 cutover.
Nightly manifest: "Saved schedules could not be loaded" removed from this page's
`failed_read`. Supersedes #457's blocked attempt.

## 14. Founder walk-through — 2026-10-01 (branch fix/review-communications)

Session R2 of the 2026-10-01 page walk-throughs. Local site at `wt-review-2` on the
production database through `review-gw.sh` (timers off, outbound mocked), signed in as
the Sim owner in Sim Meyhouse (`a229f22b`). [changed 2026-10-01, COMMS-W9: from W9 on, signed in as the founder's own account in his real houses (`review-gw.sh … me`), where mail and push are live; reads were stubbed with practice letters in the pane tab only (W9b), and every click that writes was asked first and is named in its row.] Every Sim house the Sim owner can open
(Sim Meyhouse, Sim Bistro, Sim Vanilla Kaleiçi) returned **0 rows from all nine of this
page's reads** on 2026-10-01 — book, threads, drafts, senders, strangers, letter
requests, templates, queued, house drafts — so the populated states below are read
from fixtures stubbed into the pane, never from rows created to test.

| id | what | evidence | ask | founder's words | state |
|---|---|---|---|---|---|
| COMMS-W0 | Setup: the house's data & privacy terms sheet (shared, `DashboardLayout.tsx:48`, no close control) covered the page until the Sim owner accepted | pane, first load | hold to accept in Sim Meyhouse | "Hold to accept in Sim Meyhouse" | approved → done (a write in Sim Meyhouse only) |
| COMMS-W1 | P1 purpose. Who: the owner and the manager (staff draft and ask). The one job, in their words: *"What did we say to our vendors, what did they say back, and what is waiting on me?"* Verdict **partial**: (a) the book lists outbound negotiation rows flat by date, not by vendor or conversation, while the **Threads** figure counts a different read (`conversations/threads`) the page never lists; (b) what waits on a person sits in five places — letters waiting for a manager (top), drafts waiting (box), Mudavym's drafts (rail), strangers (bottom) — and **Drafts waiting** counts one of them; (c) six paragraphs explain mechanics (the SMS line, four in Who is writing): the "too much text" verdict. Best in field (Front, Missive, Choco's supplier chat): one conversation per vendor, a "needs you" queue first, search by vendor | `CommunicationsNext.tsx:565`, `useCommsNextData.ts:120`, `:477-550`, `:608`, `WhoIsWriting.tsx`; MAKEOVER-VERDICTS `:158` | approve the job and the verdict | "Approve" | approved |
| COMMS-W1b | How to see populated states when every Sim house is empty: answer this page's GET reads in the pane with fictional fixtures (invented vendors, `.example` addresses); writes pass through untouched and none are clicked | `scratchpad/comms-stub.js`; `procurement.service.ts` history filter excludes PENDING_APPROVAL, outbound DRAFT, HOUSE_DRAFT, HOUSE_CANCELLED, so the fixture book holds none of them | stub fixtures in the pane | "[No preference]" → recommended option taken | approved |
| COMMS-W2 | P2. One "Waiting on you" region at the top. Waiting work sat in three places with three headings — letters staff asked a manager to send (top), the house's drafted replies (middle), the house's drafted letters (bottom of the rail) — and the strip's "Drafts waiting" counted only the middle one (fixture: strip 2, really waiting 4). Now one region, heading "Waiting on you · N", the three lists inside it, and the strip figure counts the same three reads; null until all three answer, failed if any fails | `CommunicationsNext.tsx` waiting block; `LetterRequestsPanel.tsx` `useLetterRequests` (one read shared by count and list) | approve | "Approve" | approved |
| COMMS-W3 | P2. Strip figures: "Threads" counted a list this page never shows; replaced by "Replies · 30 days" (vendor replies in the book, same floor rule as Sent). Order: Waiting on you · Sent · 30 days · Replies · 30 days. On approval the threads read leaves the page (a read it cannot show) | `useCommsNextData.ts:123` threads figure; no thread list anywhere on the page | approve | "Approve" | approved |
| COMMS-W4 | P2. The rail's SMS paragraph removed: it described an absence in builder words, with nothing to press. Rail heading "Channels & templates" becomes "Write to a vendor" (it now holds the two write buttons) | `CommunicationsNext.tsx` rail; the reason stays in the code comment | approve | "Approve" | approved |
| COMMS-W5 | P2. "Who is writing" folds to its one-line summary ("2 trusted senders · 1 suspended · 2 strangers waiting") with Show/Hide; open state lives in the URL (`?senders=open`) | `WhoIsWriting.tsx` | approve | "Approve" | approved |
| COMMS-W6 | P2. The page tip and "Take tour" still described the legacy page (four workspaces, a template builder, deleted 2026-09-28), and every tour step pointed at an anchor no page renders, so "Take tour" could only say the tour was unavailable. Rewritten to this page's four regions (Waiting on you · the conversation book · Write to a vendor · Who is writing), with `data-tour` anchors on each | live tip read "Pick a workspace…"; `TourEngine.tsx:53-66` keeps only steps whose anchor exists; `guidance/content/communications.ts` | approve | "Approve" | approved [changed 2026-10-02, COMMS-W38: #571 (merged on main) rewrote the same tour in job order on live anchors; the founder kept #571's order and widened only step 2 to "Waiting on you", so W6's region order, tip and its four `data-tour` anchors are gone] |
| COMMS-W7 | P2. Book layout. The book is ten rows flat by date; one vendor's exchange (ask, reply, counter) is scattered between other vendors' rows, and the job in W1 is "what did we say, what did they say back". Paths: (a) keep flat, newest first; (b) group under each vendor; (c) one row per conversation (vendor + order), newest activity first, opening to its letters in order | `CommunicationsNext.tsx:610-625` `data.rows.map(LedgerRow)`; fixture book | pick one | "show me visual change diffs"; then "do it per the new rule decided by the orchestrator" | the three layouts are live behind `?book=compare` (preview scaffolding, never to be committed); sketch `review-snap-2/sketches/COMMS-W7.html` opened in Safari (beacon `b=safari` seen); it is a copy of the live page DOM + CSS, not pane screenshots — the pane would not draw (hidden), so no before/after .jpg exists for this row; then, on the sketch: "What I need to see is a dynamic environment because communications are dynamic … properly categorized, classified … per communication channel, per person, per vendor, per price, per item … via Jev as well or other classifiers … I would definitely filter them … external communication, internal communication … divide that as well. Maybe sales, personal, kitchen environments or vendors or other things. Let's brainstorm … research … use cases … test cases to stress them out and see which one comes on top." → superseded by COMMS-W10; the `?book=` preview stays uncommitted until W10 lands |
| COMMS-W8 | SELF. Supporting edits made with W2/W3 and never shown on their own: (a) the CI guard `scripts/check_windowed_figures.py` now expects the strip figure `repliesLast30` instead of `threads` and no longer lists the threads read for this page; (b) one CLAIMS row (ADR-0083-AMEND-THREE-OWNED-SOURCES) now checks two sources, not three, with a bracketed correction; (c) tests rewritten for W2-W5. Without (a) and (b) CI fails on W3 | diff of those files; guard exit 0 + self-test passed; claim verify exit 0; 138/138 tests | approve | "Approve" | approved |
| COMMS-W9 | Process fork. The shared prompt §1 now says real houses and real data, with the gateway signed in as the founder (mail live); this session's own setup is the Sim owner in Sim Meyhouse (empty) with invented practice data. The visual-diff rule asks for real data. Paths: switch this gateway to the founder's account in the real house (restart on :4182, ask before any send), or keep Sim Meyhouse with practice data | `PAGE-REVIEW-PROMPT.md` §1 and §4; this session's setup message | pick one | "Real house, your account (Recommended)" | approved → gateway restarted as the founder |
| COMMS-W9b | Process fork. A cross-house read to find a real waiting letter was refused by the permission check; Meyhouse Palo Alto (the founder's real house) has no letters waiting. Paths: practice letters drawn over the real house in the pane only (stubbed reads, real sender check), or wait for a real one | permission refusal in this session; `/communications/letters/requests` empty | pick one | "Practice letters here" | approved → reads stubbed in the pane tab only; writes still go to the real gateway, so every write click is asked first |
| COMMS-W10 | Product fork (page ADR). How communications are classified and filtered: facets (channel, person, vendor, price, item), internal (inside the house) vs external (vendors, sales, personal, kitchen, others), which classifier assigns them (Jev, the inbound-mail intelligence already shipped, rules), and a filterable, live book. Founder asked for many ideas, research, use cases and stress tests, best one on top | founder's words in COMMS-W7; prompt §4 (a Workflow fan-out for an ADR fork, ask first); memory: Jev gate sends text to an outside service (egress) | run the research fan-out? | "use many agents as you need, deep dive, fan out but extract valuable data"; walk-through continues meanwhile ("Yes, keep walking") | running: workflow `wf_8ffee947-1d3` (6 finders, 4 designs, 8 stress lenses, judge, critic), output `p4-scratch/review-snap-2/research/comms-classification-2026-10-01.md` [changed 2026-10-01: the research landed and its forks were ruled in COMMS-W10a–W10i; the book's layout is its phase 1 (§8.8: one server-filtered book grouped by conversation), built on its own PRs after this one, so this branch keeps the book flat and drops the `?book=compare` preview] |
| COMMS-W10a | W10 forks F1-F4 from `review-snap-2/research/comms-classification-2026-10-01.md` §10 (first slice §8.8: one server-filtered vendor book, chips Vendor/Person/Channel/Where it stands/Time + search, grouped by conversation, "Waiting on you" unchanged) | research §10 F1-F4 | founder's forks | F1 "read-through phase 3, my intuition behind internal external was to divide and ease the job for the users, that s it, we don't want to overcrowd their eyes right away., new idea to the imneral chat this could be the wp group, telegram group, or any other communication channel, maybe a communication servie that interacts with the team, designed only for restyaurants? like notifies when order is ready to the waiter, or notifies when ...." · F2 "using JEv classify those, like vendors but are they verified vendor of ours or not? is  it about reservations? and so on" · F3 "Receiving view only (Recommended)" · F4 "Opt-in co-signer, later (Recommended)" | F1 → internal read-through in phase 3; the split exists to ease the eye, not to add a section up front; the team-channel idea (WhatsApp/Telegram group or a restaurant-only team service: "order ready" to the waiter…) is new → asked whether to research. F2 pulls against F4 (Jev sorting mail beyond the vendor book vs Jev only co-signing later) → re-asked as COMMS-W10b. F3 → staff get the receiving view (vendor, item, delivery date, state; no text, no prices), own branch. F4 → Jev co-signs in phase 4 |
| COMMS-W10b | W10 follow-ups. (b) F2 vs F4: how mail from outside the book is sorted (ours sorts + Jev co-signs · Jev sorts outside mail · vendor book first). Facts given: the read grant is `gmail.readonly` but promises "used only for the vendors in this house's book" (`integrations-oauth.constants.ts` gmail_read label); ADR 0207 sends Jev masked vendor mail only, TypeSafe has no DPA (OD-133); "is this our vendor" is the book match, no model needed. (c) research the team channel. F5 kitchen. F6 sales | research §10 F5-F6; `integrations-oauth.constants.ts` | founder's forks | (b) "can you find a JEV doppelganger open source from github to do this job" · (c) "Research it now, apart (Recommended)" · F5 "Both, two filters (Recommended)" · F6 "Pitches now, ours later (Recommended)" | (b) → research: an open-source, self-hosted classifier that does Jev's job (pick from our labels, score, Turkish + English) on our own servers, so outside mail is sorted with no egress; the F2 fork stays open until it reports. (c) → research launched. F5 → two filters: area (inside talk) and vendor kind (typed by a person, "Not stated" until then). F6 → "sales" = pitches to the house now; the house's own events and bookings later, after outside mail |
| COMMS-W10d | W10 forks F7, F8, F10, F12 (research §10). F9 (what quotes do on a revoke) was NOT asked: ADR 0118 D12 already locks it, facts incl. `negotiation_facts.exact_quote` stay on revocation and only raw mail goes (0118:450-466; `raw-mail-retention.service.ts` "WHAT IT NEVER TOUCHES"); the research's "quote text removed" contradicts D12 (its own critic gap C7). F11 (data-terms bump) waits on W10b's research, since a self-hosted classifier changes what leaves the house | research §10, §11 C7 | founder's forks | F7 "90% measured first (Recommended)" · F8 "Every figure, with its kind (Recommended)" · F10 "using the AI assistant and only if the vendor comms is pre approved to be autonomous" · F12 "Fixed + house tags (Recommended)" | F7 → labels shown at once, drive views/counts only after ≥2 weeks shadow at ≥90% measured precision. F8 → a price fact for every quoted/countered/drafted figure with its kind, linked to its letter (one migration; every price surface names the kind; D12 facts). F10 → amends W2: the AI assistant may add a vendor reply to "Waiting on you" only where that vendor's comms are pre-approved to run autonomously. Today autonomy is house-wide (`restaurant_feature_flags.enable_ai_autonomous_send`, 20260826120000:41) plus a per-order pause (`ai_autonomy_paused`); no per-vendor pre-approval exists → which one "pre-approved" means is re-asked. F12 → fixed About list + house tags set by people, phase 2 |
| COMMS-W10e | Research back for W10b and W10c (two background workflows, 8 agents each: finders → judge → adversaries → writer). (b) Jev stand-in: the judge's pick was killed by both adversaries; the replacement is SetFit (or a logistic head) on multilingual-e5 (MIT/Apache-2.0) running on CPU, first labels suggested offline by Qwen3-30B-A3B and confirmed by a person, vendor = address-book match only; ~$15-50/month; runner-up a Qwen3 llama.cpp sidecar (~$560/month, misses the 8 s deadline, weakest on injection). The replacement has NOT had its own adversarial pass (CLAUDE.md §3: owed before any ADR). Correction to W10b's framing: OD-133 is resolved (2026-09-28, TypeSafe retention accepted, not a DPA; OD-133, OPEN-DECISIONS.md:109), and vendor mail already goes whole to Anthropic and to Gemini (`house-data-terms.ts:57-75`), so "no egress" holds only for the new, non-vendor mail. (c) Team channel: the judge's "Floor Call" was killed (no order-ready event exists in Mudavym and Turkish POS already sells it; no one-tap action on iPhone web push; today's push sends with default urgency and a 4-week TTL, `notifications.service.ts:184`); replacement "Crew Line": events Mudavym already makes (call-outs, schedule, crew notes, asks, low stock, delivery) pushed to whoever is on shift (`shift-window.ts`), web push first; also not yet attacked itself | `p4-scratch/review-snap-2/research/jev-doppelganger-2026-10-01.md` §6 forks 6.1-6.6; `team-channel-2026-10-01.md` §9 forks 1-6 | founder's forks | — | asked in batches from COMMS-W10f |
| COMMS-W10f | Forks from W10e and F10. (f) self-host the sorter (attack it first) · extend Jev to outside mail · use the Anthropic/Gemini paths. (g) F10's "pre approved to be autonomous": a new per-vendor switch · the existing house switch (`enable_ai_autonomous_send`). (h) "order ready": leave it to the POS · our own "Hazır" tap · POS feed first | W10e; `house-data-terms.ts:57-75`; OD-133 (OPEN-DECISIONS.md:109); 20260826120000:41 | founder's forks | (f) "Extend Jev to outside mail" · (g) "Per vendor, new switch (Recommended)" · (h) "this is going to be addition when the floor coverage software is integrated too, that feature come wit that note it" | (f) → Jev sorts mail from outside the vendor book; own branch + ADR: the house terms reworded to cover guest/landlord/authority mail and a `TERMS_VERSION` bump with re-acceptance (this answers F11: yes, bump), the KVKK notice, ADR 0207 amended (Jev today reads masked vendor mail only), masking as for vendor mail; the self-hosted SetFit/e5 path is rejected for now (research kept). (g) → a per-vendor autonomy switch a manager sets; only those vendors' replies may be added to "Waiting on you" by the assistant; own branch: migration + vendor-page switch + ADR amending W2. (h) → noted: "order ready" arrives with the floor coverage software's integration, not in the Crew Line's phase 1 |
| COMMS-W10i | Crew Line forks (team-channel note §9 forks 2-6). (i) push first: web push then the app · the app first. (j) off shift: only opt-in cover offers + schedule changes · nothing · no rule. (k) receipts: acknowledgement only · shown and read too. (l) WhatsApp/Telegram groups out of scope + escalation: out of scope, none yet · out of scope, escalate now · keep groups open. Evidence relayed: WhatsApp Cloud API groups need an Official Business Account, max 8 members, no interactive messages (team note :63); KVKK's 29.01.2026 warning on staff WhatsApp groups (data abroad, :117); a group the house does not control cannot target, acknowledge or retain (:141) | `team-channel-2026-10-01.md` §3, §5, §9 | founder's forks | (i) "Web push, then the app (Recommended)" · (j) "Only cover offers + schedule (Recommended)" · (k) "Acknowledgement only (Recommended)" · (l) "Out of scope; no escalation yet (Recommended)" | approved → the Crew Line is its own product branch + ADR (not this page): web push first (`urgency: high`, short TTL for crew events), the app after OD-109; off shift gets only opt-in cover offers and schedule changes, wording checked by counsel; only "I acted" acknowledgements are kept until counsel answers; WhatsApp/Telegram groups recorded out of scope (1:1 WhatsApp a possible later fallback under an ADR 0121 amendment); no escalation in phase 1. The Crew Line pick was the adversary's replacement and still owes its own attack pass before that ADR (CLAUDE.md §3) |
| COMMS-W12a | W12 forks F0-F3 from `review-snap-2/research/comms-letter-features-2026-10-01.md` §6, with its critic's restatement (§9f): with today's one-line orders a structured letter gives a letterhead and styled lists; graphs, logos and banners stay unmet until multi-line orders or a price series exist; a hosted image is a per-letter "opened" signal and a public link to the house's price series | research §6 F0-F3, §9f | founder's forks | F0 "A, letter formatted (Recommended)" · F1 "Full rich now" · F2 "Both, and keep line breaks (Recommended)" · F3 "all in parallel" | F0 → card A with its letter formatted. F1 → vendor letters go rich now (images, charts, logos, banners): own branch + ADR that supersedes ADR 0174 D1 (no banners) and D4 (letterhead only), 0180 D6 (text only) and 0180 D5's test-first order; the Gmail/Outlook render test runs alongside the build rather than before it (F3's "all in parallel"); costs stated when asked: image hosting, a rasteriser, classic Outlook blocking images by default, seal hashing of images. F2 → the seal binds both the canonical letter (+ snapshot + renderer version) and the rendered MIME bytes, and stops collapsing whitespace. F3 → table-cell bars AND server-rendered image charts AND the render test, in parallel; no price series exists yet, so the first charts need a data source; the open-tracking rule for hosted images is re-asked (COMMS-W12b) |
| COMMS-W12b | W12 forks: the open-tracking rule for hosted images (research §9f), F4 logo, F5 banner, F6 money and roles | research §6 F4-F6, §9f | founder's forks | tracking "No tracking by design (Recommended)" · F4 "Owner uploads, never ours (Recommended)" · F5 "Image banner, house colours (Recommended)" · F6 "Owner/manager letters only (Recommended)" | tracking → images content-addressed (one link per image, not per letter), no access logs, price-chart links expire; Mudavym never learns who opened what. F4 → an owner upload on the house's settings, PNG on a light tile, hashed into the seal; no logo = the house name set as text; never the Mudavym logo (`logo_url`'s fallback must go). F5 → an image banner in the house's colours, superseding ADR 0174 D1 and D2, the text band kept underneath as the images-off fallback. F6 → money blocks only in owner/manager letters; a staff letter's order table shows quantities only (0180 D6 holds) |
| COMMS-W12c | W12 forks F7-F10. F7 restated with the critic's correction: the price the deal door already told the vendor is `final_price ?? negotiated_price ?? quoted_price` (`procurement.service.ts:9041-9043`), not `final_unit_price`. F10 names live defects 2f-4 (any engine sentence, incl. sales and staff ones, can enter a vendor letter) and 2f-6 (an inserted sentence's figure can be edited in the body and the letter keeps the unedited sentence's provenance; `ComposeSheet.tsx:178-183,202-205`, `house-letters.service.ts:782,1872`) | research §6 F7-F10, §9d, §9f | founder's forks | F7 "The price already told (Recommended)" · F8 "No market data" · F9 "The writer + the house (Recommended)" · F10 "Allow-list per purpose (Recommended)" | F7 → an order line shows the figure the vendor was already told, in the line's own currency; no currency = "currency not recorded", never USD. F8 → no market data in vendor letters (no other vendors' prices, spend share, FX, held price or public index). F9 → signed by the writer and the house; the releasing manager is not shown. F10 → a per-purpose allow-list enforced in page and gateway, vendor-scorecard sentences first, sentences as server-resolved blocks (closes 2f-6); 2f-4 and 2f-6 filed as tech debt |
| COMMS-W12d | W12 forks F11-F13 | research §6 F11-F13 | founder's forks | F11 "Own previews + test-send (Recommended)" · F12 "it needs to render perfectly to email environment option 1" · F13 "Reply buttons, later slice (Recommended)" | F11 → phone/iPad/desktop preview frames on the page, a CI lint of the HTML, and a test letter to the house's own inbox; no paid screenshot service. F12 → our own small deterministic renderer in the gateway (hardened string templates, one escaper, `RENDERER_VERSION`), with the bar "renders perfectly in the email environment": the render test (F3, run alongside the build) is the proof of that bar. F13 → `mailto:` Confirm / Can't fill + "or just reply" in a later slice, one line in the rich-letter ADR. All of W12 (F0-F13) is its own branch + ADR, not built on this page branch |
| COMMS-W11 | P3. A staff letter waiting, seen by an owner in a house with no connected mailbox: the owner was told "Waiting for an owner or a manager" and given only Decline. The sender check says the owner may send (`sendOrAsk.maySend`, basis owner) but `sendable` is false (no "Gmail — sending only" grant). Now: "You can send this once the house has its own mailbox: connect “Gmail — sending only”. Nothing has been sent." linking to /connections | `/communications/letters/sender` reply in Meyhouse Palo Alto (booleans only); `LetterRequestsPanel.tsx` no-mailbox branch; `useComposeData.ts` `noMailbox`; sketch `review-snap-2/sketches/COMMS-W11.html` (Safari, beacon seen) | approve | "make it more dynamic and in a way that resembles industry products but in our wrapper" | rework → COMMS-W11b |
| COMMS-W11b | P3, rework of W11. Two industry-style cards, both live (blocked → checking → ready by themselves when a mailbox is connected and the tab is revisited, or on "Check again"): (A) one card per letter with its own readiness checklist, like a merge box; (B) one house-wide "can't leave yet" banner with the connect button, compact cards under it. Both: who asked, how long ago, a state chip, To + subject, long letters fold to 3 lines, the hold stays visible but locked | `LetterRequestsPanel.tsx` `RequestHead`/`Readiness`/`MailboxBanner` behind `?w11=a|b` (preview, only the approved one stays); `useComposeData.ts` `basis`/`checking`/`checkedAt`/`recheck`; sketch `review-snap-2/sketches/COMMS-W11b.html` (Safari, beacon seen); DOM copies, not pane screenshots (pane hidden); the ready frames faked the sender READ inside the page only, nothing connected or sent; the sketch shows fallback fonts | pick A or B | "Do A with bformatting the email body as well, into not one line but in a more formatted enironment + earlier communicatons page had the ability to add graphs, functions, banners ,logos, and other features you might come up with (research baout if not already) find any kind iof usable email feature, also showcase it in for templates as in phone, computer ipad review. ) if needed use financial market datas, other industries to see what can be useful" | A chosen → COMMS-W11c (A + the letter body as a formatted letter; "with b" read two ways, both shown: A alone, A + B's banner); rich letters (graphs, functions, banners, logos) + phone/iPad/desktop template previews → COMMS-W12, research workflow `wf_09c44317-274` → `p4-scratch/review-snap-2/research/comms-letter-features-2026-10-01.md`. Note: the legacy builder he names (`components/documents/GmailTemplateBuilder.tsx`, still on disk, unmounted) was retired by him 2026-09-04 (`TemplateSheet.tsx:4-17`); bringing its abilities back is checked against ADR 0118 in the research |
| COMMS-W11c | P3, A from W11b plus the letter as a formatted letter: an envelope (To, Subject) over the body in its own paragraphs and line breaks, folding at about 5 lines with "Show the whole letter"; nothing is added to the text (the letter leaves as plain text, so the preview must not be richer). "A with b" read two ways, both shown: A alone; A + B's house banner | `LetterRequestsPanel.tsx` `LetterPaper`, variants `?w11=a|ab`; two made-up practice letters in the pane only; sketch `review-snap-2/sketches/COMMS-W11c.html` (Safari, beacon seen); DOM copies (pane hidden) | pick A or A + banner | "A alone (Recommended)" | approved → card A is the only card (preview switch and banner removed); tests `LetterRequests.test.tsx` (3 new + 1 updated, 14/14 with `CommunicationsNext.test.tsx` 28/28) |
| COMMS-W13 | P3 fork. A drafted reply to a vendor, held on this page, leaves from the deployment's one shared mailbox, while a letter on the same page refuses that mailbox (ADR 0118 D1) and its card says "Can’t send yet" in a house with no mailbox. Neither the draft panel nor its hold says which mailbox the reply leaves from | `procurement.service.ts` `sendProviderEmail` → `gmailService.sendEmail` (`gmail.service.ts:248`, `userId: "me"` on the deployment token, SMTP fallback from `GMAIL_USER`); `house-sender.service.ts:236-256` refuses the deployment for letters; `DraftedReplyPanel.tsx` has no mailbox line; ADR 0118 D1 names no exemption for order replies. Four paths send through the shared mailbox: `approveDraft` (:7610), `processScheduledAutoSends` (:8266, the 30-second vendor auto-send), `manualReply` (:8617), `confirmDeal` (:9268); drafts are created by `requestDraftSend` (:7404) | founder's fork (offered: say it and decide later / same rule as letters / leave it) | "So we're going to have connectors. We're going to have MCPs. We're going to have any other technology that there is to connect our house mailbox to this. If not, no, if no, not one happens, no, not one of them happens. We're going to create one for them. And for your question, the draft cannot be created because there is no house mailbox, basically." | decided: every house gets a mailbox (connected by any means, or one we create); with no house mailbox a drafted reply is not created at all — stronger than "same rule as letters". Scope, the created mailbox's tier, the other three shared-mailbox paths and drafts already waiting → follow-up COMMS-W13b |
| COMMS-W14 | P5. The draft panel's failed-read line nested the server's sentence in brackets: "Whether your hold sends or asks could not be read (The pending draft could not be read. Nothing was sent.). Nothing can be held until it can." Proposed: a reason that already ends as a sentence is said whole, then "Nothing can be held until it can be read."; a bare reason ("Network Error") keeps the brackets. The line is shared, so /orders' DraftRail changes too (`components/orders/` is not a shared part under §4). Live after text (practice draft PO-014, tab forced visible): "The pending draft could not be read. Nothing was sent. Nothing can be held until it can be read." Pane hidden, so the sketch `COMMS-W14.html` is drawn from that live text (two SVGs, Safari beacon n=2 w=560-560), not pane screenshots. Test added in `DraftedReply.test.tsx`; mutation (sentence branch forced off) fails it; panel + rail tests 32/32. W14b: "Reading…" for ever while the tab is hidden is react-query pausing its retries in a background tab; a visible tab shows the error line | `components/orders/SendStanding.tsx:89-98`; `DraftedReply.test.tsx` | approve / deny / rework | W14: **Approve**. W14b: **No change (Recommended)** | built |
| COMMS-W20 | P5. "Write a letter" (and a drafted house letter) opened "Leaves from" with the gateway's four paragraphs: the shared mailbox by address (wineops.ai@gmail.com), "the deployment", DKIM/SPF/DMARC and "inbound parse route", the permission URL `https://www.googleapis.com/auth/gmail.send`, `/connections`, and the paid-tier line W13b(3) superseded; beside Send the same sentence again. Proposed: with no mailbox the box is the "Before it can leave" checklist + mailbox chooser + Check again of COMMS-W11c/W13/W16c, Send says "Send is disabled until this house has a mailbox to send from."; the deployment, subdomain and missing-permission lines are no longer shown (the gateway still returns them; reworded on the W13 gateway branch) | `Compose/SenderLine.tsx`; `Compose/ComposeSheet.tsx:664-667`; gateway source `communications/letters/house-sender.service.ts:247,254,354,370-371`; live read after; sketch `COMMS-W20-22.html` (Safari beacon n=6, w=600×6; drawn from live text, pane hidden); test `ComposeSheet.test.tsx` (mutation: checklist branch off → 1 failed) | founder's fork | rework: "either the own houses mail will send with the extension of our 'Sent via Mudavym ' or we will give ...@mudavym.com account" → COMMS-W20b/W20c | rework → W20b |
| COMMS-W20b | P5, rework of W20. Both paths in the mailbox chooser: the house's own mailbox (Gmail · Outlook · iCloud Mail), a separator, then "@mudavym.com · Not yet" (disabled, title: "A name@mudavym.com address for this house cannot be given yet; Gmail is the only way to send today.") until the created-mailbox build (W13b) lands; same chooser on waiting letters, drafted replies and the composer | `LetterRequestsPanel.tsx` MAILBOXES + `MailIcon` (`AtSign`); `LetterRequests.test.tsx`; live read 19:00: chooser 194×157, six rows 194×29 one line each, 1 separator, `mailbox-mudavym` disabled with its title (wrapped to 48px as "Mudavym address", so shortened to "@mudavym.com"); sketch `COMMS-W20b.html` (Safari beacon n=2, w=560-560; drawn from measured rows, pane hidden); communications suite 153/153 | founder's fork | "Both, Mudavym \"Not yet\" (Recommended)"; then W20b: **Approve** | approved → built |
| COMMS-W20c | Product fork from W20. "Sent via Mudavym" on every letter from the house's own mailbox (composer, waiting letters, drafted replies): last line under the signature, small grey plain text, no tracking. Amends ADR 0118 ("the letter is from the house") and enters what the seal signs, so it is built in the gateway with the W12 rich-letter branch, not here | `house-letters.service.ts` (letter body), seal hashing (W12 F2) | founder's fork | "Last line, small (Recommended)" | approved → own branch (W12), not built here |
| COMMS-W21 | P5. Templates sheet and composer words: "declares the fields it merges… crew messages stay on /team" → "kept for one vendor purpose. Letters to the team are sent from the Team page."; "That is the honest state… seven guesses…" → "No templates yet. A template comes from a letter the house has sent twice, so write the letter first."; "The engine is holding no sentence… That is an answer, not a gap…" (sheet + composer) → "Nothing the house noticed is waiting to be written about."; the {{name}} note → "Write a field as {{name}}. A letter is never sent with a field left empty."; "Add one on /providers" → "on the Vendors page" | `TemplateSheet.tsx:142-173,292,394`; `Compose/InsightPicker.tsx:155`; `Compose/RecipientField.tsx:184`; tests `TemplateSheet.test.tsx`, `ComposeSheet.test.tsx`; live read after; sketch `COMMS-W20-22.html` | approve / deny / rework | "Approve" | approved → built |
| COMMS-W22 | P5 + P3. A held draft in the book said "Held by rule: C-20, C-21" (orchestrator rule codes) and "order PO-014" was plain text. Now "Held because its tone is heated and it holds personal details." (words for all nine hard rules, `constraint_engine.py` C-01…C-05, C-13, C-19-C-21; an unknown code says "a rule this page has no words for yet"), and "order PO-014" links to `/orders/<orderId>` when the row has an order id | `cm-format.ts` `heldBecause`; `CommunicationsNext.tsx` LedgerRow; tests `CommunicationsNext.test.tsx` (2 new; mutations: codes joined → 1 failed, link off → 1 failed); live with a practice row: text as above, `order PO-014 → /orders/o14` | founder's fork | "Approve"; then, on the all-beverages news (founder 2026-10-01, relayed): C-01 words → "it does not seem to be about the order" — "\"does not seem to be about the order\" (Recommended)" (the rule checks wine words plus bottle/case/delivery/invoice/distributor, so a beer or whiskey letter can be held: tech debt) | approved → built [changed 2026-10-01: C-01 words] |
| COMMS-W23 | P3. A letter sent from "Write a letter" can be pulled back for 2 minutes only while the sheet stays open; closed, the book shows "Queued · not yet sent" with no pull-back. The composer reads `GET /communications/letters/queued` and never shows it (`useComposeData.ts:184-191`, `queued` unused). Proposed: the book's queued row shows the countdown and "Pull it back" from that read and `POST /communications/letters/:id/cancel`; cannot be tried live (no house can queue without a mailbox), proven by tests | `QueuedPullBack.tsx` (new), mounted under a queued outbound row in `CommunicationsNext.tsx` LedgerRow; `useQueuedLetters` in `Compose/useComposeData.ts` (same cache key as the composer); route `POST /communications/letters/:id/cancel`; the queued read carries no author, so the button says "Only the person who wrote it can pull it back." and a refusal is printed in the server's words (gateway follow-up: add the author to the queued read so a non-author's button is disabled with the reason, W13 gateway branch); tests `QueuedPullBack.test.tsx` 6 + 1 page test (mutations: inbound row admitted → 1 failed; refusal as success → 1; local clock → 2; wrong route → 1); live with a practice queued row (stub answered the queued read): "Pull it back (102s)" ticking 94→91, then "The window has closed. The book will say whether it left.", no write sent; sketch `COMMS-W23.html` (Safari beacon n=2, w=560-560) | founder's fork | "Build it here (Recommended)"; then W23: **Approve** | approved → built |
| COMMS-W24 | P3. One order with two drafted replies waiting: "The house has written" listed two rows and counted "2 waiting", but both Open buttons opened the newer one (the panel is keyed by order, `CommunicationsNext.tsx` `drafts.find(d => d.orderId === draftOpen)`; the send reads `getPendingDraft`, newest PENDING_APPROVAL, `.limit(1)`, `procurement.service.ts:9753-9757`), so the older could never be opened, sent or thrown away here. Now one row per order, the newest, with "An earlier draft for this order was replaced by this one." (or "N earlier drafts…"), and the count is by order | `useCommsNextData.ts` `newestDraftPerOrder`; `CommunicationsNext.tsx` drafts list; tests `useCommsNextData.test.tsx` + `CommunicationsNext.test.tsx` (mutations: oldest kept → 1 failed; count by rows → 1; line hidden → 1). Server half (a new draft closes the older as replaced) is the INV-W26 branch's, with COMMS-W25. The /orders DraftRail reads the same source and was not checked | founder's fork | "Page now + server later (Recommended)"; then W24: **Approve**; live with practice drafts (a second draft on o14): "The house has written · 2 waiting", one PO-014 row with the line, "Waiting on you · 4"; sketch `COMMS-W24.html` (Safari beacon n=2, w=600-600) | approved → built |
| COMMS-W25 | Relayed by the /inventory session (founder ruling INV-W26, 2026-10-01): an "Order request" vendor-letter template in the catalogue (ADR 0173/0180), and the order-created AI draft (`provider_communication_agent.py` `_handle_order_created`) written from it instead of free text (`email_composer_service.compose_vendor_email`). Unverified on the way: `approveOrder` also publishes `procurement.conversation_request`, which may draft one order twice; this page shows only the newest (`CommunicationsNext.tsx:937`) | gateway template registry; orchestrator; not this branch | founder's fork | "Own branch, after this PR (Recommended)" | approved → own branch; /inventory session told. Checks that branch owes, from the /inventory session (not re-verified here): `approveDraft` (`procurement.service.ts:7610`) does not check the order's status, so a released staff request can mail for a still-pending order; `createOrder`'s merge path returns at `:1201`, before the draft trigger at `:1343`, so a merged order keeps a draft with the old quantity; the merge answer carries no merged flag |
| COMMS-W26 | P9. About four reloads a minute land any page on "Sign in · Mudavym" while still signed in: each dev load reads `/auth/me` 3× + `/auth/me/role` (gateway log 19:09:37-39), the auth bucket is 10 a minute per IP, and on the 429 AuthContext keeps the tokens but leaves `user` null, so the route guard shows sign-in | `contexts/AuthContext.tsx:377-428`; `stores/authStore.ts:264`; `common/rate-limit/rate-limit.guard.ts:29`; R1b's queue row on the same cause | founder's fork | "Queue it as shared (Recommended)" | approved → shared queue (`review-shared-queue.md`, R2 line) |
| COMMS-W27 | P5. Fourteen of the page's own sentences named the machinery (relay, endpoint, rows, gateway, engine, server, provenance, "failed read") or showed an internal insight key. Rewritten in the house's words: refused row "Not sent — it was refused on the way out: {reason}"; strip floor "the book holds only the latest 100 letters, and it is full"; unreadable drafts / manager letters "That does not mean none are waiting."; book loading "Reading the conversation book…"; mailbox-unreadable tail dropped; insight chip and pick rows "Noticed {window} · worked out {date}" with no key (title too); "each saying where it came from"; drafted reply "· as Mudavym drafted it", "the house is making a counter-offer" / "replying in a person’s own words" (two kinds did not finish "the house is …"); "No sending time came back with it."; template "Saved as “X”.", "That does not mean the house has none.", "What the house noticed could not be read", "From something the house noticed · worked out {date}"; vendor not added "— no vendor was made."; put-away failure "it was not put away". The server's own reasons stay verbatim (the practice refusal reason "gateway refused the send: HTTP 403" in the test is the server's sentence: a server-words follow-up) | `CommunicationsNext.tsx` (refused line, floor note ×2, drafts-unreadable, book loading); `Compose/SenderLine.tsx`; `Compose/InsightPicker.tsx` (`ProvenanceChip`, heading, failure, pick rows); `DraftedReplyPanel.tsx` (`KINDS`, sent line, letter label); `LetterRequestsPanel.tsx`; `TemplateSheet.tsx`; `WhoIsWriting.tsx`; `senders-format.ts`; tests updated in `CommunicationsNext`, `ComposeSheet`, `TemplateSheet`, `DraftedReply`, `LetterRequests`, `senders-format`; suite 166/166, tsc and eslint clean; mutations: key back in chip → 1 failed; relay back → 1; manager-letters tail back → 1; "gateway" back in not-added → 1; "engine" label back → 1 (the ask said 3 caught; 2 had run then, 3 more after). Live (practice stub, no reload): refused row reads the new line, no "relay" on the page; drafted reply "Albariño 2022 — the house is making a counter-offer." and "THE LETTER · AS MUDAVYM DRAFTED IT". Not seen live (need a failure or ≥100 rows): floor note, unreadable drafts/manager letters/mailbox/library, sent line. "Reaching the gateway…" also stands on /receipts, /providers and /team: theirs, not changed here. Sketch `COMMS-W27.html` (Safari beacon n=2, w=1100-1100) | approve / deny / rework | "Approve" | approved → built |
| COMMS-W28 | P3. The Templates sheet: "Write a new template", a library row and a noticed sentence each replaced the open form, wiping what was typed; Save sat disabled on an empty letter looking pressable, with no reason. Now: once the open template differs from how it was opened, those three dim (opacity .5, not-allowed) and "Save or discard the template below to start another." says why; an untouched one can be swapped freely; an empty Save dims and says "Write the letter first." (`aria-describedby`). Also corrects my own W21 words, which wrongly suggested templates make themselves: intro "a letter the house writes again and again, kept for one vendor purpose"; empty "No templates yet. Write one below, or start from something the house noticed." | `TemplateSheet.tsx` (`opened`, `unsaved`, `openDraft`, `noLetter`); `TemplateSheet.test.tsx` 4 new tests; mutations: guard off → 1 failed; body ignored → 1; Save reason hidden → 1; old empty words → 1. Live (real Templates sheet, Meyhouse Palo Alto, nothing saved): empty Save `disabled`, opacity 0.5, cursor not-allowed, "Write the letter first."; after typing "Merhaba," Write-new disabled with the note; Discard cleared both. Sketch `COMMS-W28.html` (Safari beacon n=2, w=1100-1100) | approve / deny / rework | "Approve" | approved → built [changed 2026-10-01: corrects COMMS-W21's template words] |
| COMMS-W29 | SELF, disclosed. The /receipts session (R3) warned that a page load can send `PATCH /users/<id>/preferences` with default guidance values before the preferences read answers (`GuidanceProvider`; arrays and scalars replace in the gateway's merge), overwriting dismissed tips and seen lists. This session's gateway log shows two such writes from the pane as the founder: 16:02:40 and 16:30:25 (EDT); what they wrote is not in the log. None on the reloads since (checked after each) | `$SCRATCH/gw.log` lines 1287, 2146 (TenantGuard warning lines name the method and route); R3's row in `review-shared-queue.md` (guidance overwrite) | how to go on | "Keep going, fewest reloads (Recommended)" | resolved → page switches inside the app (history push, no reload), live checks only between test edits, gateway log checked after each reload; the product fix is R3's shared-queue row |
| COMMS-W30 | P4, long data. An unbroken run (a pasted link in a letter, a mail server's refusal reason, a long sender domain or address) did not wrap: opened in the book, a refused letter scrolled the whole page 566px sideways at a 1024px window (reason 1278px wide in a 296px column; 1067px sideways at the earlier, wider measurement); the manager-letter card cut the letter off (`overflow: hidden`; 1993px of text in a 604px card); Who is writing scrolled the page 463px sideways on a long domain; the drafted-reply sheet's To line ran 928px in a 618px sheet. Now those runs wrap (`overflowWrap: 'anywhere'`), ordinary words still break at spaces | `CommunicationsNext.tsx` (row body, refused line); `LetterRequestsPanel.tsx` (To, Subject, paragraphs); `WhoIsWriting.tsx` (domain, stranger name, stranger address); `DraftedReplyPanel.tsx` (`draft-to`, `draft-subject`); 10 checks added to existing tests in `CommunicationsNext`, `LetterRequests`, `WhoIsWriting`, `DraftedReply`; suite 166/166; mutations, one per site, all 10 caught (the stranger-address one first broke the syntax, which proves nothing; redone cleanly, caught). Live (practice stub, refused practice row, nothing sent): before 566px sideways, after 0; body 294 ≤ 296, reason 296 ≤ 296; no gateway request ≥400 since the page load, prefs writes still 2. Sketch `COMMS-W30.html` (Safari beacon n=2, w=1100-1100) | approve / deny / rework | "Approve" | approved → built |
| COMMS-W31 | P4, role. Three reads and writes on this page are owner/manager only in the gateway (`route-access.expected.json`: `GET communications/letters/drafts`, `/senders/*`, `POST prospects/:id/promote`); a staff member's page asked anyway, so every staff visit showed "Waiting on you" failed (red, "could not be loaded"), the drafts card in red "Forbidden resource. Whether any letter is waiting is unknown, not none.", the trusted senders as a withheld-register alert, and "Add as a vendor…" pressable until the ask had been filled in ("The vendor was not saved: only an owner or manager can do this."); a `?draft=` link told staff the letter was "no longer a draft", which may be false. Now, by the role in this house (`managesHouse`, read as /receipts' `canSeeCreditLedger`, ADR 0167): staff are not asked for the drafts (not counted, no card; a 403 that still comes back is the same fact, not a failure), Trusted senders reads "Only an owner or manager sees which senders are trusted." with no read, "Add as a vendor…" is disabled and dimmed with "Only an owner or manager can add a vendor." (`aria-describedby`), Put away stays (open to any member), the link says "is opened by an owner or manager of this house" | `cm-format.ts` (`managesHouse`); `Compose/HouseDrafts.tsx` (`enabled`, `withheld`, 403); `CommunicationsNext.tsx` (link note); `useSendersDeskData.ts` (`useSenderRegister(enabled)`); `WhoIsWriting.tsx` (`useHouse().manages`, Trusted senders, Add); new `Compose/HouseDrafts.test.tsx` (4), `WhoIsWriting.test.tsx` 3 new + owner role in `beforeEach`, `CommunicationsNext.test.tsx` 1 new; suite 174/174, tsc clean, eslint 0 errors (2 pre-existing fast-refresh warnings in `HouseDrafts.tsx`); mutations all 8 caught (staff read made, 403 not recognised, old link words, register read for staff, staff sentence gone, add pressable, reason blank, account role over house role). Live, owner only: drafts and senders reads still 200, no staff sentence shown; the founder's house has 0 senders and 0 strangers, so no Add/Trust button to see. NOT seen live as staff (no staff account in this review): proved by tests only. Sketch `COMMS-W31.html` drawn from code and test text (Safari beacon n=2, w=1100-1100) | approve / deny / rework | "Approve" | approved → built |
| COMMS-W32 | P5, words, found late: P5 was first thought done, but Who is writing and its Trust/Add asks (found while doing W31) still said "spoof quarantine", "sender register", "triage lane", "injection signals"/"inj.", raw figure keys (`completed_orders`, `injection_signals`, `spam_signals`, `updated_at`), "a vendor row from the sender's own header fields", "Nothing below is claimed — this is not an empty list", and the empty strangers list said "This lane is active and listening", which claims a health nothing on the page measures (absence as health). Seventeen places now say it in the house's words, with the same meaning: what trust does was checked in the gateway (`inbound-responder.service.ts`: a trusted domain lifts only the "sender unverified" hold on answering by itself; trust suspends itself on an injection attempt or sustained spam, `sender-reputation.service.ts`), e.g. "When mail cannot prove it came from the vendor, Mudavym waits for a person before answering it. Trusting a sender lifts that one hold for their future mail — nothing else."; the three read-failure sentences end "That does not mean there are none."; the empty strangers list reads "No strangers waiting. Mail from vendors you have not added yet lands here."; server words (a suspension reason) stay verbatim | `WhoIsWriting.tsx` (both ledes, loading, empty, row counts and title, both notes, read-back errors); `SenderActs.tsx` (Trust and Add labels, notes, figure labels, saved/undo/not-saved lines); `senders-format.ts` (`readFailureSentence`, reused-vendor sentence); `senders-format.test.ts` (sentence end + no-machinery-words check), `WhoIsWriting.test.tsx` (8 pinned sentences updated, 1 new words test over the section and the Trust ask); suite 175/175, tsc clean, eslint 0 errors (2 pre-existing fast-refresh warnings in `SenderActs.tsx`); mutations, 6 of 17 sites sampled, all 6 caught (old forbidden sentence, "active and listening", raw `completed_orders`, "already quarantined", "spoof quarantine" lede, "inj."). NOT live: the founder's houses have 0 trusted senders and 0 strangers, so these words show nowhere today. Sketch `COMMS-W32.html`, old → new word table drawn from code and test text (Safari beacon n=2, w=1100-1100) | approve / deny / rework | "Approve" | approved → built |
| COMMS-W33 | P4, error. A read that failed after it had answered (a page left open, then a network blip) emptied its part of the page: the three figures went red with the number gone (a screen reader heard only "could not be loaded"), the banner printed the HTTP client's own "Request failed with status code 500", the book, the letters waiting and the drafted letters vanished, "Nothing is waiting on you." could show while the read behind it had failed, a reply link said the reply was gone, and Who is writing dropped its rows to "—". Fork asked: A keep what was last read and say when, or B empty it and say it could not be read. Founder: "A: keep, say when (Recommended)". Now a read that failed after answering keeps its last data with "Could not be read again (<the server's words>). This is as it was at 22:12; there may be more or fewer now." (or "At 22:13 there were none; there may be some now."); a read that never answered says "<X> could not be read (<words>). That does not mean none are waiting."; the figures say "Waiting on you: 4 as it was at 22:05. It could not be read again."; the banner names each part that failed and the oldest time, and Try again re-reads every read on the page; never the status-code text. Who is writing was not among the four parts the question named; it emptied the same way, so it was built the same way and disclosed at the approval ask (rows kept, summary ends " · as it was at HH:MM", Retry kept; an expired session or a changed role is a refusal, not a blip, and still says why with no rows) | `cm-format.ts` (`fmtAsOf`, `failedReadWords`, `readAgainFailed`, `failedReadsSentence`); `useCommsNextData.ts` (`historyAt`, `draftsAt`, `draftsError`, words); `CommunicationsNext.tsx` (figures, banner, Try again, book, waiting, drafts, reply link); `Compose/HouseDrafts.tsx`; `LetterRequestsPanel.tsx`; `WhoIsWriting.tsx` (`staleRead`, `Stale`, summary); new `cm-format.test.ts`, 6 new in `CommunicationsNext.test.tsx`, 3 in `Compose/HouseDrafts.test.tsx`, 1 in `LetterRequests.test.tsx`, 5 in `WhoIsWriting.test.tsx`; suite 239/239 over `communications/next` + `components/orders`, tsc clean, eslint 0 errors (10 pre-existing fast-refresh warnings, none in a changed line); mutations 16/16 caught (status code back, figure hides the time, Try again skips the letters, "nothing waiting" on a failure, letters vanish, drafted vanish, a duplicated "none" line — caught only after an assertion was added —, banner absent, reply called gone; Who is writing: never stale, summary hides the time, the later of two times, a refusal treated as a blip, "none then" read as "none", Retry lost, trusted line missing). Live (practice stub, every read answered, then all seven made to fail with 500; nothing sent, 0 writes, prefs writes still 2): figures "4/3/3 as it was at 22:05", the banner and every region's line as above; Who is writing "2 trusted senders · 1 suspended · 2 strangers waiting · as it was at 22:12" with its rows. Sketches `COMMS-W33.html` (the fork: before live, A and B from code; Safari beacon n=4) and `COMMS-W33-built.html` (before/after live; beacon n=3, w=540-540-540) | A / B, then approve / deny / rework | "A: keep, say when (Recommended)"; then "Approve" | approved → built |
| COMMS-W34 | P6, overlays. Every sheet passed focus in, Tab wrap, Escape, focus back to the opener, scroll lock and a worded close, but leaving one lost the words in it: the drafted letter's sheet and the template sheet TORE on one Escape or a stray click outside and threw away an edited letter or a half-written template without a word, and "Write a letter" kept its words where nothing showed it. Now the words stay on the row the sheet was opened from, as the house's Stub (sketch 103 · 1b): under a drafted letter ("Discard my changes", "The drafted letter itself stays as it was; only your changes are held here, until you leave this page."), under Write a letter ("To <vendor>. Not sent. Kept on this page until you leave it.") and under Templates ("Not saved. Kept on this page until you leave it."); Resume reopens the sheet with them, Discard with Put it back for ten seconds; an untouched sheet holds nothing; a drafted letter holds only what was changed, measured against the draft. Asked at the build: the drafted stub quoted the letter's opening, which reads exactly as the draft — founder: "Quote the change (Recommended)": it now quotes a new subject, then the first paragraph that is not the draft's (live: "“Two bottles on PO-009 arrived corked. Could you issue a credit note for both bottles this week?”"). Found live and fixed in this row: Resume unmounted the stub (and its focused button) in the same commit the sheet opened, so focus fell to the page after the sheet closed — Resume now moves focus to the row, Write a letter or Templates first; two sibling stubs drew a duplicate React key warning — keys now prefixed. The shared Stub moves no focus when Discard or its ten seconds end: queued for the shared owner (`review-shared-queue.md`, R2 row), founder "Queue it (Recommended)"; the page passes the opener focus itself meanwhile. Nothing here is saved anywhere: the words live in this page's memory only, and the stubs say so | new `held-words.ts` (`useHeldWords`, `heldLine`, `changedLine`); `CommunicationsNext.tsx` (three stubs, `openDraft`/`openCompose`/`openLibrary`, `writeRef`, `libraryRef`); `Compose/ComposeSheet.tsx` (`HeldLetter`, `onHold`, `baseline`); `TemplateSheet.tsx` (`HeldTemplate`, `held`, `onHold`); `Compose/HouseDrafts.tsx` (`below`, `focusRow`); tests: new `held-words.test.ts` (7), `ComposeSheet.test.tsx` 6 new (2 older composer tests now inside a router), `TemplateSheet.test.tsx` 3 new, `Compose/HouseDrafts.test.tsx` 2 new, `CommunicationsNext.test.tsx` 9 new; suite 265/265 over `communications/next` + `components/orders`, tsc clean, eslint 0 errors; mutations 29, all caught: 20 on the hold/stub wiring (one, Put it back on a drafted letter, survived until a test was added, then caught), 4 on focus, 4 on the quoted change, 1 on the stub keys (the first try reverted one key only, which made no collision and proved nothing; redone with both, caught). Live (practice stub, nothing sent, 0 writes, prefs writes still 2): each sheet left with words draws its stub; focus returns to the opener after a tear, after Resume then a tear, after Resume then Close, for all three; the quoted change as above; one later local check (typing and Escape only) ran on real reads after a test-edit reload dropped the practice stub — still 0 writes. Sketches `COMMS-W34.html` (the proposal) and `COMMS-W34-built.html` (before live, after live with the quoted change; Safari beacon n=2, w=540-540) | approve / deny / rework; then approve / deny / rework, quote, queue | "Approve (Recommended)"; then "Approve", "Quote the change (Recommended)", "Queue it (Recommended)" | approved → built |
| COMMS-W35 | P7, phone. Measured at 375×812, 390×844 and desktop with the practice stub: no sideways scroll; all seven overlays fit the screen (the two sheets full width, the panels 16px in), close on Escape and hand focus back. Three gaps: (1) the phone's back gesture with a changed drafted letter open left the page, not the sheet, and the change was lost with nothing said (Escape or a tap outside keeps it, W34; back did not); (2) Who is writing's "all 8 houses" was not in the address, so a refresh or a shared link came back as "this house"; (3) a drafted letter or reply opened from its row was not in the address either, though `?draft=` and `?reply=` already open them from links. Founder: "A: page + queue back (Recommended)". Now `?senders=all` is Who is writing open with every house's strangers (`?senders=open` this house; Hide drops both, so the folded line always counts this house — before, a scope chosen and then hidden kept counting every house under a line that does not say so); opening a drafted letter or reply from its row writes `?draft=<id>` / `?reply=<order>` in place (no new back step; history length unchanged live) and closing takes it away, as the links already did; the "no longer a draft" note is not shown while that letter's sheet is open. The back gesture is queued for the shared sheet's owner (`review-shared-queue.md`, R2 row: back closes the topmost overlay as Escape does); until it lands, back still leaves the page. Left as is: the book's opened letters (several open at once) and the composer and templates (typed words never go in an address) | `WhoIsWriting.tsx` (scope from `?senders=`); `CommunicationsNext.tsx` (`openDraft` writes `?draft=`, new `openReply`, the note's guard); tests: `WhoIsWriting.test.tsx` 2 new, `CommunicationsNext.test.tsx` 3 new; suite 270/270 over `communications/next` + `components/orders`, tsc clean, eslint 0 errors; mutations 9: 8 caught; 1 survived — `setReplyOpened` in `openReply` was redundant (the link's effect already marks it), so the line was taken out rather than tested, and a mutation of that effect was caught. Live (390×844): "all 8 houses" → `?senders=all`, kept across a reload (real reads, 8 houses); with the practice stub, opening the drafted letter → `?draft=d1`, the reply → `?reply=o15`, both gone on close, focus back on each row, no link note, 0 writes, prefs writes still 2, 0 failed resources in the document after the reload. The mutation runs edit files Vite serves, so the open pane hot-reloaded mutated code for seconds at a time (real reads, no write path touched); the console's 500s and one failed hot reload from that window predate the checked document. Sketch `COMMS-W35.html` (before live, after from code; Safari beacon n=2, w=540-540) | A / B / C / deny | "A: page + queue back (Recommended)" | approved → built |
| COMMS-W36 | P8, brand and accessibility. Measured live (practice stub): on the paper ground and on charcoal, 0 lines under 4.5:1 on the page or in any overlay. But /profile → Preferences → Theme "Dark" (kept in this browser) puts `.dark` on `<html>` while the ground stays paper (ADR 0169), and `globals.css`'s `.dark h1–h4` / `.dark p` outrank the house reset, so every heading or paragraph that only inherits its ink turns pale: the page title 1.13:1, a waiting letter's words 1.70:1, the drafted reply's first line 1.70:1, and every sheet title the shared Sheet draws 1.13:1 (System on a dark phone does the same; Dark was simulated by putting the class on the page for the measurement only, then taken off; nothing saved). Heading outline: the two lists inside "Waiting on you" were h2 beside it, and the conversation book had no heading, so a heading list skipped it. lang, names and image labels clean. Targets: "Check again" 66×18 sits in a sentence and "Decline" 44×18 has 37px clear around it, so both pass WCAG 2.5.8 and stay as they are. Founder: "Page + queue shared (Recommended)" · "Visible label (Recommended)" | `CommunicationsNext.tsx` (title ink; "The house has written" h2 → h3; new h2 "The conversation book" in the house's mono label); `LetterRequestsPanel.tsx` ("Letters waiting for a manager" h2 → h3; the letter's paragraphs, what a hold says and what went wrong name ink-1, the ink they inherited); `DraftedReplyPanel.tsx` (`INK2`: the first line and the five state lines — empty, refused copy, asked, sent, failed — name ink-2, the body's ink). The two lowered headings keep the line height and spacing they had as h2 (`2rem`), so nothing on the page moved. Beyond the three lines measured, seven state lines that show only after an act got the same fix; on paper they draw exactly as before. Shared part queued: `review-shared-queue.md` R2 row (globals.css, every sheet title, every page). Tests: `CommunicationsNext.test.tsx` 2 new, `LetterRequests.test.tsx` 2 new, `DraftedReply.test.tsx` 4 new; mutations: 18, all caught (the title's ink, each lowered level and the line and spacing it kept, the book's heading, each named ink in the two panels); suite: communications/next + components/orders 278/278, tsc clean, eslint 0 errors on the six files. Live, after a fresh load (the mutation runs had hot-reloaded mutated code into the pane, so the earlier look was redone): H1 Communications → H2 Waiting on you → H3 Letters waiting for a manager, H3 The house has written, H3 Drafted, not sent → H2 The conversation book → H2 Write to a vendor → H2 Who is writing; the two lowered headings 32px as before; 0 lines under 4.5:1 on paper, charcoal, Dark + paper and Dark + charcoal; no console error | page + queue shared / queue shared only / page only / deny · visible label / screen readers only / sub-headings only / deny | "Page + queue shared (Recommended)" · "Visible label (Recommended)" | approved → built [changed 2026-10-02, at the merge of main: since #576 (8588a77c9) /profile offers Paper / Charcoal and no longer sets the old theme; a browser that saved Dark or System keeps `html.dark` with no control left (shared queue, coordinator row from DASH-W23), so W36's inks still apply there.] |
| COMMS-W37 | SELF, disclosed. P9: the gateway log holds 39 errors "The pending draft could not be read. Nothing was sent." (500), every one a `GET /procurement/orders/o14/draft` or `/o15/draft`: the practice stub's made-up order ids, which the stub did not answer, so the drafted-reply panel's read reached the real gateway. Reads only, nothing written. The gateway answers a malformed id with a 500 rather than a 400 (`@Get("orders/:id/draft")` has no id check, so Postgres refuses the id and `getPendingDraft` throws `InternalServerErrorException`), which counts a caller's mistake as a server fault; no page sends such an id (ids come from the server's own drafts) | `$SCRATCH/gw.log` (39 `ERROR [SentryService]` lines, each after a TenantGuard line naming the route); `procurement.controller.ts:1288`, `procurement.service.ts:9761` | none asked: reads only, no effect | — | disclosed → the 400-for-a-malformed-id fix noted in this branch's tech-debt fragment, not built here (gateway, not this page) |
| COMMS-W38 | Sync fork, found when bringing main into this branch (2026-10-02): #571 "Tours as job steps on live anchors" (merged, `e39935fbc`) and W6 both rewrote `guidance/content/communications.ts`. #571 orders the tour by job (Read the book → Answer what is drafted → Write a letter → Know who is writing) on aria-label anchors plus `data-tour="comms-write"`; W6 ordered it by region on four `data-tour` anchors. On this branch #571's step 2 points at "Drafts waiting", which is drawn only while a drafted reply waits, so on a quiet day that step drops out (`TourEngine` leaves out a step whose element is missing) and "Letters waiting for a manager" is never pointed at. Now: #571's tip, order, titles and comment, with step 2 on `section[aria-label="Waiting on you"]` (always drawn), titled "Answer what waits": "Letters your staff asked you to send and replies drafted for you. Read one, change it if you need to, then hold to send it, or to ask a manager to send it." The Write a letter button carries #571's `comms-write` beside this branch's handler; W6's four `data-tour` anchors are removed, as no step reads them | trial merge `git merge-tree origin/main <lane-sync snapshot>`: conflicts in `guidance/content/communications.ts` and the Write button only; `CommunicationsNext.tsx` "Drafts waiting" section renders under `data.drafts.length > 0` | #571's order, step 2 widened / #571 exactly as merged / W6 as approved | "#571's order, step 2 widened (Recommended)" | approved → built: `guidance/content/communications.ts` (step 2 only differs from main), `CommunicationsNext.tsx` + `WhoIsWriting.tsx` (anchors); `CommunicationsNext.test.tsx` 1 new (every step's element is on the page with nothing drafted, and the step list is #571's with step 2 widened); mutations: 3, all caught (step 2 back to "Drafts waiting", the button's `comms-write`, the waiting region's label); suite 282/282, tsc clean, eslint 0 errors |
| COMMS-W13b | P3, scope of W13. (1) Where it is built: the page part here, the gateway part (no draft created without a house mailbox; the shared mailbox stops sending) on its own branch + ADR. (2) Whether the other three shared-mailbox sends follow the same rule. (3) Whether the mailbox Mudavym creates is included for every house (replacing ADR 0118's paid-plan line). (4) Drafts already waiting in a no-mailbox house: kept, locked, with reason. Page part built live for the before/after: each draft row carries the "Can’t send yet" chip and the list says why; the opened draft shows card A's "Before it can leave" checklist (you may send · no mailbox + connect · vendor address on file · Check again), the hold is locked, "The draft stays here, unsent." | asked 2026-10-01 18:22Z by the previous session, unanswered at handoff; re-asked by the session that took over. `DraftedReplyPanel.tsx` (readiness block, `noMailbox` on the hold), `CommunicationsNext.tsx` drafts list chip + line, `LetterRequestsPanel.tsx` exports `Check`/`ConnectLink`/`Recheck`/`PILL`; mailbox state is the real `/communications/letters/sender` read for Meyhouse Palo Alto, drafts are W9b practice rows; sketch `review-snap-2/sketches/COMMS-W13b.html` (Safari, beacon `b=safari` widths 800×4), shots `COMMS-W13b-{list,panel}-{before,after}.jpg` | approve scope / other sends / created mailbox | (1) "Page here, gateway apart (Recommended)"; (2) "Same rule, all four (Recommended)"; (3) "Every house, included" | approved → page part kept in this branch; the gateway part (no draft without a house mailbox; nothing leaves from the shared mailbox for any house: `approveDraft`, `processScheduledAutoSends`, `manualReply`, `confirmDeal`; behind a flag the founder flips) is NOT built here — its own branch, ADR and review; (3) supersedes ADR 0118's paid-plan line for the created mailbox, recorded in the page ADR |
| COMMS-W15 | SELF. Meyhouse Palo Alto has not accepted the house's data & privacy terms, so the shared terms sheet (no close control) covers every page for the founder's account. For the W13b shots the sheet was hidden in the pane only (a style on the overlay); nothing was accepted, nothing written | pane, first load after the takeover; `[role=dialog]` overlay, `position:fixed; z-index:100` | founder's verdict on hiding it for shots, or he holds to accept it himself | no ruling on the sheet; answered with a new ask instead: "also when tryimng to connect gmail button replace with a popover that shows couple gmail options in simple bar like Gmail , apple, outlook, and at last a \"show more\" where it will take it to connect its desired mail. BTw, if gmail is conencted to the house the gmail must be already configured every time it log ins, right?" | re-asked with COMMS-W16, answered: "thats mine so accept it already" | resolved → accepted 2026-10-01 in the pane on the founder's word, keyboard path of the hold (POST `/settings/data-terms/acceptances` → 200); the sheet text says accepting turns on Jev (TypeSafe) for this house's vendor mail, which needs Jev's own switch too, and the house reads no vendor mail today; pane hiding ended |
| COMMS-W16 | P3, founder's ask. The connect button in "Before it can leave" (waiting letter, card A; and the opened draft, W13b) becomes "Connect a mailbox", which opens a small chooser: Gmail (Google's own sending-only page, back to this page after), Outlook and Apple Mail greyed "Not available yet", then "Show more ways to connect" to `/connections#sender` | Only Gmail sending exists (`integrations-oauth.constants.ts` `gmail_send`); no Outlook/Apple/IMAP connector in the gateway. `LetterRequestsPanel.tsx` `ConnectLink` → button + mudavym `Popover` (`components/mudavym/Sheet.tsx`); Gmail tile links `/authorize/gmail_send?returnPath=<this page>` (`App.tsx` route, not clicked: an /authorize grant is the founder's click). Sketch `review-snap-2/sketches/COMMS-W16.html` (Safari, beacon `b=safari` widths 800×2), shots `COMMS-W16-{before,after}.jpg` | approve / deny / rework | "more small, 4 small bars, and maybe we could just connect ical? or mail app from apple?" | rework → COMMS-W16b (four `mdv-item` bars: Gmail · Outlook · Apple Mail · Show more, popover 232px, no title); Apple question → COMMS-W18 |
| COMMS-W17 | P3 finding, from the founder's question "if gmail is conencted to the house the gmail must be already configured every time it log ins, right?". Yes: the grant is kept on the server per person and house, survives sign-out, and its access is renewed by itself. But when Google refuses the renewal (password changed, access removed in Google, long unused), nothing records it: the house still reads as having a mailbox, letters and drafts show ready, and the failure only appears when a send is tried | `integrations-oauth.service.ts` `getAccessToken` throws "needs to be reconnected" on a failed refresh and writes nothing; `house-sender.service.ts:278-282` counts any row with `revoked_at IS NULL` as `sendable: true`, no token probe; the reconnect banner on /connections covers `gmail_read` only (`ConnectionsNext.tsx:340-355`) | propose: gateway records a refused renewal and the sender read says "reconnect"; page shows it in "Before it can leave" (own branch, gateway) | "Fix, own branch (Recommended)" | approved → NOT built here: own branch, ADR and review (gateway records a refused renewal; sender read says reconnect; page shows it) |
| COMMS-W16b | P3, rework of W16. Same chooser, smaller: four small bars in the house's menu-row style (`mdv-item`, as the ground menu uses): Gmail "Sending only" (to Google's sending-only page, back here), Outlook "Not yet", Apple Mail "Not yet" (greyed, cannot be pressed, the reason on hover), "Show more ›" to `/connections#sender`. Popover 232px, no title, no close mark | `LetterRequestsPanel.tsx` `ConnectLink` + `Mark`; sketch `review-snap-2/sketches/COMMS-W16b.html` (Safari, beacon `b=safari` widths 800×3), shot `COMMS-W16b-after.jpg` | approve / deny / rework | "smaller, use real app icons not placeholders" | rework → COMMS-W16c |
| COMMS-W16c | P3, rework of W16b. Popover 232 → 196px, bars tighter (`5px 12px`, 12.5px text), the letter marks replaced by each app's own icon drawn inline (Gmail M, Outlook, Apple Mail; nothing fetched). Brand research then found the icons are not ours to show: Google asks partners to request permission for the Gmail icon, Microsoft needs a licence for the Outlook app icon, Apple allows no Apple icon without a licence; each publishes a sign-in mark (Google G, Microsoft four squares) for its own sign-in buttons → options drawn as COMMS-W16d (A as built · B sign-in marks + our envelope for "iCloud Mail" · C our envelope for all) | `LetterRequestsPanel.tsx` `MailIcon`; research `review-snap-2/research/connect-mailbox-ux-benchmark-2026-10-01.md` §3; sketches `COMMS-W16c.html` (Safari, beacon widths 800-800-800-680, shots `COMMS-W16c-{after,detail}.jpg`) and `COMMS-W16d.html` (drawn at 2×, no images, the pane was hidden; beacon `b=safari` with no widths) | founder picks A/B/C | "B: sign-in marks (Recommended)", then changed: "change this to as built now, where we need google s permission and microsoft license only if its to get otherwse sign in marks?" | built: each app icon waits behind its own grant (`ICON_GRANT` in `LetterRequestsPanel.tsx`, null today), so Google's G and Microsoft's four squares show until Google (Partner Marketing Hub form) or Microsoft (trademark licence) says yes; the as-built Gmail and Outlook icons are kept and switch on per grant; iCloud keeps our envelope; Apple renamed "iCloud Mail". Test asserts the sign-in marks while no grant is recorded (mutation: both grants set → 1 failed). Live pane read: G + four squares + envelope, popover 194px. Pane shot owed (pane hidden). What shows while pending, Apple, and who sends the requests: re-asked as COMMS-W16e |
| COMMS-W16e | P3 fork, from W16c's change. (1) What the chooser shows while Google's and Microsoft's permission is pending: sign-in marks until each yes · the app icons now, asking meanwhile · hold the branch until both. (2) The iCloud bar: our envelope · ask Apple for a licence too. (3) The requests (Google Partner Marketing Hub approval form; trademarks@microsoft.com) are the founder's to send: draft both · not now | W16c row; research `connect-mailbox-ux-benchmark-2026-10-01.md` §3 | founder's fork | "Sign-in marks until yes (Recommended)" · "Our envelope (Recommended)" · "Not now" | approved → as built in W16c: `ICON_GRANT` stays null, sign-in marks show, iCloud keeps our envelope; no request drafted. The research also suggests a trademark attribution line ("Gmail is a trademark of Google LLC…"); it would belong on /connections, a different page, and was not asked: noted in `p4-scratch/handoff-2.md` for that page's session, not queued, not built |
| COMMS-W19 | P3, from the coordinator (shared batch 2, founder-approved DASH-W16e: the house counter's "Replies waiting" act links to `/communications?reply=<orderId>`). The page reads `?reply=`: once the drafts read answers it opens that order's drafted reply as a row click does; closing the panel drops the param; no match → "That reply is no longer waiting." with Dismiss; drafts read failed → "That reply could not be looked up: the drafted replies did not load."; nothing while the read is in flight; a reply the link opened and that was then sent is not called gone | `CommunicationsNext.tsx` (reader after `closeDraft`, note in "Waiting on you", panel `onClose`); 5 tests in `CommunicationsNext.test.tsx` "the counter link to a waiting reply"; 4 mutations each fail a test (no open → 2 failed; no opened-guard → 1; failed-read text → 1; no drop on close → 1); suite 150/150, tsc clean, eslint 0 on both files. Live pane read (practice stub over Meyhouse Palo Alto): `?reply=o14` opened the practice counter-offer draft, "Leave it waiting" left `/communications`, `?reply=o99` showed the note, Dismiss cleared it. No pane shots: the pane is hidden. Practice-only: the panel's `GET /procurement/orders/o14/draft` → 500 because "o14" is a practice id, not a uuid (same on a row click) | approve | "Approve" | approved, built |
| COMMS-W18 | P3 fork, from "maybe we could just connect ical? or mail app from apple?". iCal is Apple's calendar, it cannot send mail. iCloud Mail can be sent through only with an app-specific password the owner makes at account.apple.com (two-factor on) and gives Mudavym, which then sends through `smtp.mail.me.com:587`; that password opens the whole mailbox, not sending only. Apple's "authorize with your Apple Account" path is for apps Apple lists as supported; no public way for a web service to join it was found. The Mail app on a Mac or iPhone is a program on that device: a server cannot send through it; the only route is "open in Mail" (`mailto:`), which sends from that person's own address outside Mudavym, with no seal record and no reply tracking. Outlook can get the same sending-only permission shape as Gmail (Microsoft `Mail.Send`) | support.apple.com/en-us/102525 (iCloud SMTP settings), /102654 (app-specific passwords), /121539 (third-party access); gateway has only `gmail_send`/`gmail_read` (`integrations-oauth.constants.ts`) | founder's fork | "can we make a shortcut for it, and show the customer effortless feel?" | researched → re-asked: `review-snap-2/research/apple-mail-access-2026-10-01.md` (no non-password route open to a new web service; Apple's Allow flow confirmed only in Microsoft Outlook; app passwords: 2FA, ≤25, all revoked on an Apple password change, SMTP 587, 1000 messages/day; iCloud terms say personal use, flagged for counsel), `apple-shortcuts-route-2026-10-01.md` (a Shortcut sends from Apple Mail only with the owner present; locked phone, Low Power, Focus interrupt; no delivery proof, no reply tracking), `connect-mailbox-ux-benchmark-2026-10-01.md` §2 (effortless pattern: detect iCloud from the address, one button to Apple's page, forgiving paste, prove sign-in before "connected"); re-asked with paths (house address first · iCloud guided app password · Shortcut) → "House address, iCloud optional (Recommended)" | approved → own branch and ADR, not built here: the iCloud bar offers the house's own Mudavym address first (needs the created-mailbox build, W13b(3)), then a guided iCloud app-password connect; iCloud waits on counsel for the personal-use terms (OD-TBD), and the adversarial pass on this recommendation is owed in that branch's ADR (CLAUDE.md §3) |
| COMMS-W18b | P3 fork, from W18: Outlook can get the same sending-only permission shape as Gmail (Microsoft Graph `Mail.Send`, delegated). Paths: build it on its own branch, or leave Outlook "Not yet" | gateway has only `gmail_send`/`gmail_read` (`integrations-oauth.constants.ts`) | founder's fork | "Build it, own branch (Recommended)" | approved → own branch, not built here; the Outlook bar stays "Not yet" until it lands |

P1 Purpose — done: verdict partial, job approved (COMMS-W1).
P2 Regions — done except the book: W2-W6 approved; the book's layout waits on COMMS-W10. [changed 2026-10-01: the book's layout is W10's phase 1, on its own PRs; the book stays flat in this branch]
P3 Controls — done: W11 → W11c, W13 / W13b, W16 → W16e, W17, W18 / W18b, W19, W22, W23, W24, W28 ruled. Built here: W11c, W13b's page part, W16c as ruled in W16e, W19, W22, W23, W24's page half, W28. Own branches, not built here: W13b's gateway part, W17, W18, W18b, W24's server half. Write controls are proved by tests; a write made live is named in its row.
P4 States — done: error (W33), role (W31), long data (W30). Role seen live as owner only; staff is proved by tests (W31).
P5 Words — done: W14, W20 / W20b, W21, W22, W27, W32. P5 was first thought done after W27; Who is writing and its two asks were found later, while doing W31, and fixed in W32.
P6 Overlays — done: all seven (a new letter and a drafted letter, both `ComposeSheet`; the templates, `TemplateSheet`; the drafted reply, `DraftedReplyPanel`; the mailbox chooser, a `Popover` in `LetterRequestsPanel`; Who is writing's Trust and Add asks, two `Panel`s in `SenderActs`) pass focus in, Tab wrap, Escape, focus back to the opener, scroll lock and a worded close; reduced motion is proved from code and tests (`components/mudavym/Sheet.tsx` draws the Sheet, Panel and Popover alike; under reduced motion `useReducedMotion` skips the enter and tuck animations), not emulated. The one failure — leaving a sheet lost its words — is W34. The shared Stub's missing focus move is queued for its owner.
P7 Mobile — done: 375×812, 390×844, desktop; no sideways scroll; every overlay fits. W35 put the open scope, letter and reply in the address; the back gesture is queued for the shared sheet. Two small targets ("Check again" 66×18, "Decline" 44×18 in the waiting letter) are carried to P8.
P8 Brand and accessibility — done: on the paper ground and on charcoal, 0 lines under 4.5:1 on the page or in any overlay; lang, names and image labels clean; "Check again" (in a sentence) and "Decline" (37px clear) pass WCAG 2.5.8 by its inline and spacing exceptions. Under /profile's Dark theme on the paper ground, W36 named the page's own inks (title, the waiting letter, the drafted reply) and queued the sheet titles' cause, `globals.css`'s `.dark` heading and paragraph rules, to the shared owner. The heading outline was fixed and the book given a visible heading (W36). Dark was simulated by the class on the page, not chosen in /profile. [changed 2026-10-02, at the merge of main: since #576 (8588a77c9) /profile offers Paper / Charcoal and no longer sets the old theme; a browser that saved Dark or System keeps `html.dark` with no control left (shared queue, coordinator row from DASH-W23), so W36's inks still apply there.]
P9 Console and network — done. Baseline, a fresh load of this page as the founder: no console error (one warning, "[ErrorTracking] No DSN provided", dev only); the page's 11 reads each run once, all 200, slowest `analytics/insights` 1.04s, then `letters/sender` 0.70s. Polling: the page's drafted replies (`procurement/conversations/active`) every 30s, which react-query pauses in a hidden tab; the shell's notification count and house counter every 60s. Shell duplicates on a full load: `/auth/me` 3× (W26, queued), `organizations/branches` 2× (one caller in an effect, so StrictMode's second run in dev; one in production, inferred, not measured) and `users/:id/preferences` 2× (second read not attributed; R3's queued preferences-at-load row covers that path). Errors seen this session and attributed: 429s and the landing on sign-in after quick reloads (W26); 401s in the same burst (the guard's answer while rate-limited, same cause); 39 gateway 500s from the practice stub's made-up ids (W37, SELF); one Vite "Failed to reload WhoIsWriting.tsx" from a mutation run; Google sign-in's FedCM errors on /login only.
P10 Live — done. https://mudavym.com runs b8192c2d5 (#567), which is origin/main's tip and not an ancestor of this branch (6 commits behind its merge-base 1c1a676f8: #563, #568, #575, #578, #571, #567); the branch takes them through `lane_sync.sh` before its PR, keeping #571's `data-tour="comms-write"`. Production shows the page as it was before this branch, for another house and account. Every difference is this branch not being live yet or a different house, role or data; none is a bug, so no rows.
