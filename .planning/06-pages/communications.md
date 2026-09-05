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
- **Templates** tab: build Gmail and SMS templates; save and reuse them (🚧 saved client-side, not cross-device)
- **Send History** tab: browse classified vendor conversation threads; regenerate a thread's AI summary
- **Scheduled Reports** tab: create, list and delete recurring report schedules (🚧 the send itself is feature-flagged off server-side — no mailer)
- **Procurement History** tab: audit trail of outbound procurement emails, labelled by type
- Filter by channel: all / email / SMS

### Redesign feature summary (behind the flag)

- **Mudavym redesign behind `mudavym_design_communications` (OFF)**: four-figure glance strip (threads · drafts waiting · sent-30d · report schedules), the conversation book as a short-row ledger with prose inside the expansion, honest channel-state line (Gmail inbound watch queried, never asserted), scheduled-reports rail
- **The house email composer** (flag ON, ADR 0118): a wide sheet that writes one
  letter — the sender line first, a recipient chosen **from the vendor book only**
  with "add to the book" inline, a house template picker, a body, and a merge
  picker that inserts **the engine's whole sentence with a provenance chip**
  (rule key · window · computed-at). Send queues the letter; it never claims a send
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
- **RETIRED — the two legacy template workshops are gone from the rebuilt page** (ADR
  0118 D7). They are untouched and the legacy page still mounts them

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_communications`)

> **Chrome (2026-09-04).** With the flag on, this page is framed by the house
> header — `apps/web/src/components/mudavym/HouseHeader.tsx`, mounted by
> `PageGate` above every `next` tree: the A+M mark, this page's name, the ⌘K
> "Search or act" trigger, the house (or the branch switcher when there is more
> than one), the bell, the theme menu and the account menu. Chrome is excluded
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
| GET | `/procurement/conversations/history` | `useProcurementConversationHistory` (Communications.tsx:28) → `useConversationQueries.ts:284` |

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

## 10. Maturity

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
