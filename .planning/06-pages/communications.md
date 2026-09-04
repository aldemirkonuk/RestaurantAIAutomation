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
- **New Email / SMS template** → (builder on this page)
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

- **Mudavym redesign behind `mudavym_design_communications` (OFF)**: four-figure glance strip (threads · drafts waiting · sent-30d · report schedules), the conversation book as a short-row ledger with prose inside the expansion, honest channel-state line (Gmail inbound watch queried, never asserted), template workshops behind a what's-going-on banner, scheduled-reports rail

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_communications`)

Canonical source with curves: `apps/web/src/pages/communications/next/MOTIONS.md`
— this list is the note-side index (ADR 0044 §2).

| id | name | fires |
|---|---|---|
| `cm-row-settle` | Row settles open | a ledger row's expansion — `settle`, 320ms house curve, 4px drop |
| `cm-ink` | Ink micro-state | row and rail-button hover/focus — one paper step, nothing translates |

Deliberate non-motions: glance figures never tally; the template sheet appears
in place; draft chips never pulse (a draft drawing attention to itself starts
to look like activity — prc-02).

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

### Modal shape, 2026-09-03 (ADR 0112)

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
| SMS templates "stage for the messaging channel" (`CommunicationsNext.tsx:333`) | All 27 production `procurement_conversations` rows are `channel='email'`; `POST /communications/sms` exists in the gateway but **no web client calls it** | **FIXED 2026-09-02 (ADR 0083)** — workshop kept (Save is now real), copy states no SMS sender is reachable from this page |

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
