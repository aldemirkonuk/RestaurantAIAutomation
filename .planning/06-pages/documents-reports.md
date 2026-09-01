---
type: page
route: /documents-reports
slug: documents-reports
component: apps/web/src/pages/DocumentsPage.tsx # legacy default; flag-gated next: pages/documents-reports/next/DocumentsReportsNext.tsx
audience: owner
tier: core
archetype: list+detail # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 0
maturity: hollow
status: documented
updated: 2026-08-31
links: ["[[PAGE-CONTRACT]]", "[[receipts]]", "[[communications]]", "[[logs]]"]
---

# /documents-reports — Documents & Reports

## Surface — buttons → where they go

- **Reports / Communication History tabs** → (on this page)
- **View / Print** → opens `report.fileUrl` (preview / new tab for print)
- **Download** → opens `report.fileUrl` in a new tab
- **Email** → external `mailto:` compose with the report link
- **Copy link** → clipboard (`fileUrl` or `/documents-reports?doc=:id`)
- **Delete / batch delete** → API delete-report mutation
- (legacy render: no outbound navigation — dead-end page)
- Behind the flag (Sorting Office): **Waiting rows** → `/receipts` or
  `/communications` per row · **Open in Receipts** → `/receipts` ·
  **Open in Communications** → `/communications` · **Open the timeline /
  Open the drawer** → `/logs` · **File to…** → PATCH refile mutation ·
  **Cross-filed links** → `/receipts`, `/communications`

## 1. Purpose

"Invoices, receipts, and generated report history" (`Sidebar.tsx:128`). Two tabs
(`DocumentsPage.tsx:99`): **reports** — the generated-report archive (view, copy
deep link, delete), live-updating as new reports land; **history** — the classified
vendor conversation list shared with `/communications`.

## 1a. Features
- **Reports** tab: the generated-report archive — open a report, copy a share deep link, delete; new reports appear live as they land
- **History** tab: classified vendor conversation list (same component as `/communications`)
- Share links (`?doc=`) open the page with that document selected

Behind `mudavym_design_documents_reports` (OFF — the Sorting Office, §1b):
- **Waiting on you** drawer: vendor paper needing review + AI drafts awaiting approval + door-counted deliveries with no paperwork, one queue, oldest debt first (never by arrival); opens only when every register behind it has answered
- **Four countable registers**: House reports (inline list → reading pane) · Vendor paper (→ `/receipts`) · Conversations (→ `/communications`) · System log (→ `/logs`); a filled window renders its count as a floor (`≥`), never a total
- **Filed itself today**: the routine noise roll — today's timeline entries counted by source, filed, never deleted, never in the way
- **Reading pane** (Direction C, kept): serif title, metadata line, paragraph summary at reading width; copy-share-link; OD-81 file truth (no file → says so, disabled, with the reason)
- **File to…** (sketch affordance, founder-ordered 2026-08-31): re-file the open report under another type; the change writes a `system_audit_log` row the System-log drawer itself renders — the re-file files itself
- **Cross-filed under** (sketch affordance): the pane's footer counts the report's period in the other registers — vendor paper by `doc_date`, conversation threads via the production `list_conversation_threads` window total — linked to `/receipts` and `/communications`; a report with no period says nothing is cross-filed
- `?doc=` share links preselect in the pane, same as legacy

## 1b. Redesign state — Direction D chosen, built 2026-08-31

The REWORK verdict (MAKEOVER-VERDICTS: *"more modern, more transformative…
let's create three more sketches into this"*) is answered with a design
canvas, 2026-08-31, in the locked Mudavym system (0042 tokens, Fraunces /
DM Sans / JetBrains Mono, the P3 pages' panel idiom):
<https://claude.ai/code/artifact/620c531d-d060-449b-a5e1-cd2b35f9f533>

| Direction | Axis | Honest tradeoff |
|---|---|---|
| A — The Filing Room | calm archive: month-grouped report cards + reading pane | least transformative |
| B — The Ledger Spine | one dated book of everything written or received — house reports and vendor paper on a single spine, provenance chips | two sources share one list; the chip carries the burden |
| C — The Reading Desk | report-as-primary: the newest opens read-first like the morning paper; archive demoted to a rail | clean and readable — the founder kept this quality — but **not scalable** (his round-1 verdict) |

**Round 2, 2026-08-31 — founder feedback on round 1, verbatim in intent:**
*"be more creative, 2 more sketches. What we need is scalable — each will
create chaos, lots of data, logs of noise. Make the categorization of the UI
better. Direction C's full view of the report looks more clean and there is
more space to read, but it's not scalable."* Two scale-first directions added
to the same canvas; both assume 1,000+ entries a month, both make categories
named and countable, both keep C's clean reading as the detail surface:

| Direction | Axis | Honest tradeoff |
|---|---|---|
| D — The Sorting Office | categorization-first: everything sorts into named, countable drawers on arrival ("Waiting on you" · House reports · Vendor paper · Conversations · System log); noise files itself and stays countable, never deleted; windowed lists | the drawers are only as good as the sorter's rules |
| E — The Signal Press | compression-first: each day's chaos pressed into a few trusted signals read in C's calm, beside the full windowed feed with category chips; quiet days say so in one line | the press must earn trust before anyone stops reading the feed |

**Resolved 2026-08-31 — the founder chose Direction D** (*"go with direction
D, start building it"*), with C's clean reading kept inside it as the detail
surface — his round-1 praise for C, delivered scalably. Built the same day on
`feat/mudavym-design-p3` behind `mudavym_design_documents_reports` (OFF;
standard PageGate — legacy `DocumentsPage` renders until a restaurant opts in).

**Build** (`apps/web/src/pages/documents-reports/next/`):
- `useSortingOfficeData.ts` — seven queries over six registers, each
  answering for itself: gateway reports (OD-45 path), procurement documents
  (an unfiltered window of 100 for the count PLUS a status-filtered
  `needs_review` query for the debt queue — deriving debt from the recency
  window would hide anything older than the newest 100 of any status),
  conversation threads + live drafts (the DraftRail's own source, the
  communications audit's fix carried), unverified door counts, `/logs`
  timeline (window 100). The waiting queue is `null` until review + drafts +
  unverified have ALL answered — a half-known queue would misstate the debt
  order — and a failure in ANY of the seven raises the banner.
- `DocumentsReportsNext.tsx` — drawers left, reading pane right; branch-aware
  error banner ("last answer" vs "nothing below is claimed"); floor
  disclosure caption.
- `so-format.ts` (EM/fonts/fmtDate — date-only values parsed as local
  calendar days, never UTC-midnight) · `MOTIONS.md` (canonical) ·
  `DocumentsReportsNext.test.tsx` (16 contracts: drawer-null-until-answered,
  debt-from-its-own-query ordering, `≥` floors, OD-81 wording, `?doc=`
  preselect, empty honesty, branch-aware banner incl. waiting-register and
  all-down branches, four-register header sum, noise-roll counting, clipboard
  failure said on the control, date-only rendering).

**Per-page Sonnet audit, 2026-08-31 — all findings fixed same day:**
two blockers (needs_review derived from the unfiltered recency window, which
past 100 lifetime documents silently dropped the oldest debt → its own
status-filtered query, the receipts pattern; error surface blind to
threads/drafts/door failures, leaving the waiting drawer stuck with no banner
→ all seven queries feed `anyError`/message), three defects (date-only
`fmtDate` off-by-one west of UTC; "In the registers" omitted Conversations
from its sum; clipboard write with no `.catch` and a stuck "Link copied" →
tri-state label that recovers), one NIT fixed (inert `aria-disabled` on a
span, removed), one NIT accepted (the page `<style>` block is document-global
while mounted — class names are page-scoped `so-*`, verified collision-free).
Verified clean by the audit: all six data-source field shapes against gateway
code and production schema, `threads.total` is a true `count(*) OVER ()`,
timeline camelCase, `?doc=` never overrides a user click, the reduced-motion
selector is live, all ten flag anchors + guards. One out-of-scope find filed
as its own task: gateway `listUnverified` windows the OLDEST 500 receipt
events (predates this page).

**Two-Opus final review, 2026-08-31 (correctness + design/idiom) — all
in-scope findings fixed same day:**
- *Restaurant switch* (correctness blocker): four of seven queries were
  unkeyed by restaurant and kept serving the previous tenant's rows after a
  header switch with the page mounted → every Sorting Office query is now
  keyed by `activeRestaurantId`; `useConversationThreads` (shared) gained the
  same key; `useMudavymDesign` now consumes the auth context optionally and
  re-evaluates the flag (resetting to legacy) on a switch instead of carrying
  one restaurant's verdict into another's.
- *"Nothing below is claimed"* (correctness blocker): `hasData` covered 2 of
  7 registers, so the all-down copy could deny drawers that were still
  answering → any answered register keeps the partial branch, and the test
  now fails every register before asserting the all-down copy.
- *House reports register* (design blocker): the count was an array length
  from the only unwindowed query → the gateway's `count: "exact"` total is
  threaded through (`listReportsWithTotal`), the drawer renders it, and a
  "N more filed" line discloses what the 20-row list omits.
- Correctness defects fixed: sort/display disagreement on date-only values
  (shared `sortKey` = `fmtDate`'s calendar; unparseable dates sort LAST, never
  as oldest debt); the exact-looking waiting count now carries the review
  window's `≥`; the two disjoint paper windows are labelled ("need review,
  all paper"); banner errors are register-NAMED and gated on settled queries
  (a 30s drafts poll blip no longer flashes a `role="alert"` — partial
  failures are `role="status"`); a `?doc=` id that no longer resolves says
  so; `fmtDate` refuses rolled-over dates; the suite pins `TZ` so date
  assertions cannot pass vacuously in UTC CI (with a canary).
- Design defects fixed: dead hovers (inline `background: transparent` beat
  the hover rule — removed; Tailwind preflight keeps buttons transparent);
  raw `reportType` enum in the pane (labelized); row focus rings clipped in
  the scroller (`-2px` rows / `+2px` controls, the siblings' split); the two
  honesty-bearing lines promoted `--ink-3`→`--ink-4` (AA); type scale
  collapsed to 9·10·11.5·12.5·13.5·20·24·30; secondary numerals get
  `tabular-nums`; links get a real idiom (underline + color shift, per ADR
  0042's value-not-hue principle) recorded here; header figures 22px with the
  seal on "Needs a human" (sketch hierarchy); `aria-current` over
  `aria-pressed`; House drawer regains its descriptor line.
- **The two sketch affordances the build had deferred were surfaced to the
  founder, who ordered both built ("Build both now", 2026-08-31) — built the
  same day:** `PATCH /reports/:id` re-files a report (IsEnum-validated,
  restaurant-scoped, audit row → the timeline) and `GET
  /reports/:id/cross-file` computes the period's presence in the other
  registers (paper by `doc_date` count-exact; threads via the
  `list_conversation_threads` RPC's `total_threads`, date-bounded); both
  covered by gateway specs (9/9) and page tests (29 on this page).
  A follow-up Sonnet audit of the extension found one defect, fixed same
  day: the RPC's `timestamptz` end bound got a bare date — midnight — so the
  period's last day of conversations was silently excluded while the paper
  leg (a `date` column) included it; the bound is now end-of-day, with the
  spec pinning it. Hardened per the same audit: the paper leg's tenant scope
  is now asserted by a test; the footer links' routes are asserted; the
  cross-file query is skipped entirely when the report itself names no
  period; a synchronous ref backs the double-submit guard; reopening the
  filing row clears a stale failure message; the crossQ error and filing
  failure branches are tested. Verified clean by that audit: the dto can
  never smuggle extra columns into the update (single-field DTO +
  `forbidNonWhitelisted` + literal `{ report_type }` payload), route order,
  audit-row NOT NULLs, and the timeline rendering `report_refiled` rows
  unfiltered.
- Accepted, recorded: the register grid's asymmetry (House reports carries
  the selector list); the door count's window cannot be detected client-side
  (upstream fix filed — see §9); the wave-wide dead-hover and
  `PageGate` charcoal-nesting findings are filed as their own task, and the
  wave-wide `--ink-3` AA question as OD-112.

**Motions** (tokens from `lib/mudavym/motion.ts`; canonical table in
`next/MOTIONS.md`):

| id | token | curve · ms | fires |
|---|---|---|---|
| `so-settle` | `settle` | HOUSE · 320ms | the reading pane settling open per chosen report |
| `so-ink` | `ink` | HOUSE · 160ms | drawer rows and controls on hover/focus — background/border only |

Deliberate non-motions, load-bearing at this page's volume: counts never
tally (a register's number is a read fact, not a performance); the noise
roll never pulses (routine is the opposite of an alarm); the waiting drawer's
open swaps content with no entrance. Reduced motion kills both motions with
`!important`.

## 2. Entry

- Sidebar "Documents & Reports" (`components/layout/Sidebar.tsx:126`); command
  palette (`components/command/commands.ts:82`).
- Toast deep link after generating a report on `/communications`
  (`pages/Communications.tsx:315`).
- Self-produced share links `…/documents-reports?doc=:id` (`DocumentsPage.tsx:318`).
- [PAGE_MAP](../foundation/PAGE_MAP.md):116 lists it as no-inbound — scan missed the
  sidebar and the toast link.

## 3. Files

- Route binding: `apps/web/src/App.tsx` `/documents-reports` — now a
  `PageGate page="documents_reports"` (legacy `DocumentsPage`, next
  `DocumentsReportsNext`).
- `apps/web/src/pages/DocumentsPage.tsx` (962 lines) — legacy, still the
  default render.
- `apps/web/src/pages/documents-reports/next/` — the Sorting Office (§1b).
- Shared render (legacy): `components/communications/ClassifiedConversationList.tsx`
  (mounted :452).

## 4. Endpoints

Atlas row for conversations: [ENDPOINTS](../foundation/ENDPOINTS.md):180. The
report archive went through the gateway when OD-45 landed (the old
browser-direct Supabase path hit RLS-on-with-zero-policies and silently
rendered an empty archive — the rationale is written at the top of
`useReportQueries.ts`):

| Source | Operation | Call site |
|---|---|---|
| Gateway | `generated_reports` list/delete (restaurant from JWT) | `hooks/queries/useReportQueries.ts` → `services/api/reports.ts` |
| Gateway | `/conversations/threads` + `/thread/:id` + `/stats/overview`, POST `/:id/summarize` | ClassifiedConversationList → `hooks/queries/useConversationQueries.ts:194-240` |
| Gateway (next only) | procurement documents list · active conversations · unverified door counts · `GET /logs/timeline/:restaurantId` | `documents-reports/next/useSortingOfficeData.ts` |
| Gateway (next only) | `PATCH /reports/:id` (File to… — refile + audit row) · `GET /reports/:id/cross-file` | `DocumentsReportsNext.tsx` ReadingPane → `services/api/reports.ts` |

Realtime: `useReportSubscription` pushes `generated` report events into the list
(`DocumentsPage.tsx:31,125`).

## 5. Signals

**None.** No tracking, no `data-ux-key`; reporter dark (`lib/uxSignals.ts:15`).

## 6. Tier cut

**Core** — the archive half of S15 (owner opens the weekly digest); the digest
itself computes at Plus and its scheduled send is flagged off
([TIER-MAP](../03-scenarios/TIER-MAP.md):51).

## 7. Rebrand surface

**0 user-visible strings** in the page file (no `wineops` hits). Report *contents*
may carry the WineOps title given them at generation time
(`pages/Reports.tsx:531`) — that debt is counted on reports.md. Layout chrome per
dashboard.md §7.

## 8. State & config

- Report reads/deletes go through the gateway since OD-45 (§4) — the old
  browser-direct claim here is superseded; per-tenant RLS on authed clients
  remains a decided deferral (`v3.0-TECH-DEBT.md:450`).
- `?doc=:id` deep-link param produced (:318) and honoured by both renders.
- `mudavym_design_documents_reports` (registry entry, OFF; column on the
  `restaurant_settings` row via `20260831090000_mudavym_design_flags.sql`).

## 9. Gaps

- The two tabs duplicate `/communications` content (ClassifiedConversationList is
  mounted on both) — one of the split/merge candidates the retire-to-write rule
  exists for (CLAUDE.md §4); no decision recorded either way. The Sorting
  Office answers it differently for the next render: conversations become a
  countable drawer that points at `/communications`, no duplicated list — the
  legacy duplication remains until the flag flips and the tab dies with it.
- Direct-Supabase delete with deferred RLS (§8) means authorization for report
  deletion rests on the anon-key policy set — worth a verification pass, not
  asserted broken (no debt-register entry).
- **Flag-flip blocker — CLEARED 2026-09-01.** Gateway `listUnverified`
  windowed the OLDEST 500 lifetime receipt events (past 500, new door debt
  never surfaced; a phantom row could pin the top of the waiting queue).
  Fixed in PR #173 (newest-first window + timestamp-based latest-count +
  a 500+ regression test), merged to main and Railway-verified SUCCESS.
  Until `feat/mudavym-design-p3` merges, the page previews on dev via the
  localStorage override (`mudavym.design.documents_reports = 1`) — the
  production gateway's registry doesn't carry the flag yet, so a DB flip
  cannot render before the branch merges.
- `--ink-3` fails AA on every light paper ground (3.69–4.37:1, measured) —
  wave-wide, filed as OD-112; this page already moved its two honesty-bearing
  lines to `--ink-4`.
- Wave-wide siblings share the dead-hover inline-background pattern and the
  `PageGate` double-`.mudavym` charcoal-nesting latent — filed as one
  cross-page task, not fixed from this branch.

## 10. Maturity

**hollow.**

This is a document archive in which no document has a file. Every row it lists
comes from `generated_reports`, and the only writer of that table inserts
`status:"pending"` with `pdf_url`/`excel_url`/`csv_url` NULL
(`apps/api-gateway/src/reports/reports.service.ts:42-71`); nothing in the repo ever
completes a row or attaches a file. **Re-verified whole-repo 2026-08-26 (OD-81):**
no `UPDATE` on `generated_reports` exists anywhere — gateway, `agent-orchestrator`
(Python reads it once, `health_routes.py:165`), `self-evolution`, both
`migrations_archive/` folders, and there is no `supabase/functions/` directory.
Production holds **0 rows**. `mapGeneratedReportToUi` therefore always produces
`fileUrl: undefined` (`DocumentsPage.tsx:100-113`).

**The dead controls were fixed 2026-08-26 (OD-81).** The three `alert()` branches
below are gone; those controls are now disabled and carry the reason, a banner
states the condition once up front, and the disable is computed per row from
`reportFileUnavailableReason(report)` rather than hard-coded — so they re-enable
by themselves the day a generator fills `pdf_url`. The table records what the
failure branch *was*:

| Button | Line (pre-fix) | What used to happen | Now |
|---|---|---|---|
| View | `DocumentsPage.tsx:332-335` | `alert("No file available to preview for …")` | disabled + reason |
| Download | `:317-323` | `alert("No file available for …")` | disabled + reason |
| Print | `:357-366` | `alert("No file available to print for …")` | disabled + reason |
| Email | `:339-352` | `mailto:` body reads "(No file attached yet.)" | unchanged — already honest |
| Copy link | `:367-369` | Falls back to `…/documents-reports?doc=<id>` — **a link this page never reads.** No `useSearchParams`, no `doc` param handler anywhere in the file (verified by grep) | unchanged — still an open defect, see below |
| Delete / batch delete | `:325-329`, `:404-411` | Real — `DELETE /reports/:id`, scoped by `restaurant_id` | unchanged — real |

Two further fabrications: the Communication-History tab badge is fed by `commStats`,
which hardcodes `emailCount: 0, smsCount: 0` and renders `commStats.total` — the
count of **reports**, not messages (`:234-236`, rendered `:467`). And `sentTo`,
`fileSize` and `tags` are deliberately left empty because no column backs them
(`:94-113`) — that part is honest, and is the OD-45 correction.

**§3 and §4 above are stale.** The page is 1,012 lines, not 962, and it no longer
talks to Supabase directly: OD-45 routed reads and deletes through the gateway
(`hooks/queries/useReportQueries.ts:10-46`), because the table has RLS on with zero
policies and the anon-key client silently returned `[]`. §11 below is the current
shape.

## 11. Data flow

### Calls out

| Method | Path | Auth | Gateway controller | Returns |
|---|---|---|---|---|
| GET | `/reports` | JWT (class, `reports.controller.ts:27`) | `:48-63` | `{reports[], total}` — restaurant from the JWT, not the client |
| DELETE | `/reports/:id` | JWT | `:168-186` | 204; scoped by `restaurant_id` **and** `id` (OD-45) |
| GET | `/conversations/threads`, `/thread/:id`, `/stats/overview` | JWT (class, `conversations.controller.ts:48`) | `:145`, `:216`, `:308` | Thread list / messages / sentiment counts |
| POST | `/conversations/:id/summarize` | JWT | `:291-304` | `{success:true}` — the event it publishes has no subscriber (see communications.md §10) |

Unused by this page but present on the controller: `GET /reports/:id/download`
(`reports.controller.ts:103-130`) returns `{url: null}` for every report, for the
same reason.

### Fed by

| Data | Producer | Live? |
|---|---|---|
| Report rows | ~~`POST /reports/generate` from `/communications`~~ — **no producer at all as of 2026-08-26 (OD-81)**: that call site was deleted with the lying "Generate Now" handler, and `/reports` Generate was already disabled. The endpoint still exists and is still the table's only writer; nothing in the product calls it | Rows: **no** (production: 0 rows) |
| Report files | **none** — verified whole-repo, no `UPDATE` on `generated_reports` exists; no reports Storage bucket exists (production has one bucket, `vendor-attachments`) | — |
| Conversation history | Gmail push → `email.inbound.received` → `rabbitmq-bridge.service.ts:528` → `procurement_conversations`; sentiment/intent from `inbound-responder.service.ts:300,520` | Yes (live Gmail watch, OD-78) |
| Realtime toasts | `useReportSubscription` / `useCalendarEventsSubscription` (`DocumentsPage.tsx:157-187`) | Yes — but they only announce the same empty rows |

### Writes

| Write | Downstream reaction |
|---|---|
| Report delete (optimistic, `useReportQueries.ts:52-76`) | Cache rollback on error; no notification, no audit row |
| Nothing else — the page has no create path | — |

## 12. Design intent

**Should be:** the archive where anything the system produced on the owner's behalf
is findable months later — reports, invoices, receipts, vendor correspondence.

| State | Handled? | Evidence |
|---|---|---|
| Loading | **No** | `useGeneratedReports()` destructures only `data` with `= []` (`DocumentsPage.tsx:153`) — a slow fetch is indistinguishable from an empty archive |
| Empty | Partial | Folder tree renders with no years; no explanatory empty state |
| Error | **No** | `error` is never destructured; a 500 renders as an empty archive |
| Permission-denied | **No** | No 403 branch |

**Where the UI misleads**

1. A folder tree, grid/list toggle, filters, batch-select and six per-document
   actions, over rows that can never carry a document.
2. Copy link produces `?doc=<id>`, a URL that resolves to the unfiltered page.
3. The Communication-History badge shows the report count while the tab shows
   conversations.
4. `useReportQueries.ts:23-24` names the exact trap this page fell into once
   already — `placeholderData: []` making a failure look like an empty state — and
   the reports list still has no loading or error branch.

## 13. Roadmap

1. **Report rendering, or retire the archive tab.** Blocked on the same founder
   decision as communications.md item 1: nothing defines what a report artifact is.
2. **Read `?doc=`** (`DocumentsPage.tsx:368` produces it) — select and open that
   report on mount. Two lines; makes the existing share link mean something.
3. **Loading + error branches** on the reports query — the file's own comment
   explains why this matters.
4. **Fix or drop `commStats`** (`:234-236`) — a real message count or no badge.
5. **Decide the `/communications` overlap.** `ClassifiedConversationList` is mounted
   on both pages; retire-to-write (CLAUDE.md §4) requires naming one. No ADR exists.
6. Add procurement documents (`/receipts`) to this archive, or state that receipts
   are deliberately a separate surface — today "Invoices, receipts, and generated
   report history" (`Sidebar.tsx:128`) promises all three and delivers one.
