---
type: page
route: /documents-reports
slug: documents-reports
softwares: [receipts-invoice-match]
component: apps/web/src/pages/DocumentsPage.tsx # legacy default; flag-gated next: pages/documents-reports/next/DocumentsReportsNext.tsx
audience: owner
tier: core
archetype: list+detail # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 0
maturity: hollow
status: documented
updated: 2026-09-02
links: ["[[PAGE-CONTRACT]]", "[[receipts]]", "[[communications]]", "[[logs]]"]
---

# /documents-reports — Documents & Reports

> **Part of** [[08-softwares/receipts-invoice-match|Receipts & Invoice Match]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

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
- **Waiting on you** drawer: vendor paper needing review + AI drafts awaiting approval + deliveries counted by the case and never counted by bottle, one queue, oldest debt first (never by arrival); opens only when every register behind it has answered. That third source is **not** "no paperwork" — the endpoint behind it knows nothing about invoices (`receiving.service.ts:43-44`, *"a delivery with a case count and no bottle count is unverified"*); the debt is somebody breaking the cases and counting bottles, and the page said the wrong one until ADR 0086
- **No composite page figure.** "In the registers" summed the four drawers and was deleted in ADR 0086 — `procurement_documents` is one of the timeline's six sources so vendor paper was counted twice (thrice after a re-file), and even de-duplicated the addends share no unit. The header keeps only **Needs a human**, which counts one kind of thing.
- **Four countable registers**: House reports (inline list → reading pane) · Vendor paper (→ `/receipts`) · Conversations (→ `/communications`) · System log (→ `/logs`); a filled window renders its count as a floor (`≥`), never a total
- **Filed itself today**: the routine noise roll — today's timeline entries counted by source, filed, never deleted, never in the way; the count carries the floor mark on a **different** test from the four drawers' (ADR 0086): `windowFull && the oldest event still in the window is itself from today`, because a full window whose oldest event predates midnight already contains all of today
- **Reading pane** (Direction C, kept): serif title, metadata line, paragraph summary at reading width; copy-share-link; OD-81 file truth (no file → says so, disabled, with the reason)
- **File to…** (sketch affordance, founder-ordered 2026-08-31): re-file the open report under another type; the change writes a `system_audit_log` row the System-log drawer itself renders — the re-file files itself
- **Cross-filed under** (sketch affordance): the pane's footer counts the report's period in the other registers — vendor paper by `doc_date`, conversation threads via the production `list_conversation_threads` window total — linked to `/receipts` and `/communications`; either register answering `null` renders `—`, never a zero. The "report with no period" branch was **removed** in ADR 0086: `report_period_start`/`report_period_end` are `date NOT NULL`, so it could never render, and the test pinning it went with it
- `?doc=` share links preselect in the pane, same as legacy

## 1b. Redesign state — Direction D chosen, built 2026-08-31

> **Chrome (2026-09-04).** With the flag on, this page is framed by the house
> header — `apps/web/src/components/mudavym/HouseHeader.tsx`, mounted by
> `PageGate` above every `next` tree: the A+M mark, this page's name, the ⌘K
> "Search or act" trigger, the house (or the branch switcher when there is more
> than one), the bell, the theme menu and the account menu. Chrome is excluded
> from §Surface by PAGE-CONTRACT, so it is named here and nowhere else in this
> note; its motions live in `components/mudavym/MOTIONS.md`, not the table
> below.

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
  **Completed 2026-09-02 (merge-check on #262).** Bounding that query in ADR
  0086 turned two inherited fallbacks into the fault it was closing, on both
  halves of this route:
  - `total: count ?? reports.length` (`reports.service.ts:122-131`) was harmless
    while the read was unbounded — the array *was* the table — and became "the
    page size is the total" the moment a cap existed. `total` is
    `number | null` end to end now (DTO, `listReportsWithTotal`, `reportsQ`),
    and `reportsTotal` already rendered `null` as `—`.
  - The **legacy** half (`DocumentsPage.tsx`) was not measured in that pass and
    silently inherited the server's default page, so its archive read as
    complete. The cap is declared as `REPORTS_PAGE_LIMIT`
    (`services/api/reports.ts:89-99`), sent explicitly, and a list arriving at
    it says it is a floor. Held by `services/api/reports.window.test.ts` and one
    gateway case; 3 + 1 fail against `origin/main`.
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

**Seam + honesty pass, 2026-09-02 (ADR 0086) — six defects fixed, one reported
defect measured as not reproducible:**
- *The gateway seam* (the one that mattered): `/logs/timeline` caught each of
  its six sources to `[]` and returned 200, so a source that 500s rendered as a
  **smaller number with no banner** on a page whose subject is counts. The
  response now carries `failedSources` and `sourcesQueried`; the page raises its
  existing branch-aware banner, names the sources, and marks every count off
  that window as a floor. The merge's `localeCompare` sat outside all six
  try/catches over two nullable timestamp columns — one NULL 500ed the whole
  feed; now null-safe with undated rows last.
- *The routine strip* gained the `≥` it was missing, on a condition the four
  drawers do not share (§1a).
- *"In the registers"* deleted (§1a) — double-counted and unitless.
- *Money* now prints `procurement_documents.currency` instead of a hardcoded
  `$`; a row with no currency says the unit is missing rather than borrowing
  one (ADR 0062).
- *`GET /reports`* was unbounded and shipped the whole table to render twenty
  rows → default 100, max 200, `offset` supported, `count: "exact"` keeping the
  drawer's figure exact.
- *Two unreachable branches* and the test pinning them removed (§1a,
  Cross-filed under); `conversations?.count ?? 0` no longer renders an unknown
  as a zero; the pane's failure sentence now shares the page's `settledError`.
- **Not reproducible, recorded as such:** the reported mid-retry flash of "The
  cross-file could not be checked". On `@tanstack/react-query` 5.90.16 a
  refetch after an error resets `status` to `pending`, so `isError &&
  isFetching` does not arise — measured with a probe. The change stands as a
  consistency fix, not a bug fix.
- Held by `scripts/check_windowed_figures.py`, which gains this page as its
  **third** `PAGES` entry (`SO_SERVER_WINDOWS` citing `documents.controller.ts`,
  `logs-timeline.service.ts` and `reports.service.ts`; eight `| null` fields; a
  named `GE`). Proven to exit 1 four ways and 2 once against the real files —
  and its limit is recorded in the ADR: it would **not** have caught the missing
  `≥` that motivated adding it.
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

### Overlays, 2026-09-05 (sketch 102 · ADR 0112)

<!-- sketch-102-overlays -->
Generated by `.planning/sketches/102-modal-census/build.py --docs` from `census.py` — edit the census, not this table.
The rule: an object gets a sheet, a question a panel, a choice a popover; the seal never sits in a popover.

**`/documents/:id`** — No overlays. CanonicalSheet is a page section, not a portal.

**`/documents-reports`** — No overlay on the rebuilt page: the Sorting Office's reading pane is the detail surface (Direction D). One legacy preview retires.

| Page | Overlay | Shape | Status | Where the act lives or went | Source |
|---|---|---|---|---|---|
| `/documents-reports` | Document preview | — | Retires | The reading pane. | `pages/DocumentsPage.tsx:985` |

Drawn in sketch 102 (`.planning/sketches/102-modal-census/index.html`); the policy is [[0112-one-modal-policy-three-shapes-one-primitive]].

### Overlays decided (2026-09-06)

> **This note carries two routes.** The generated block above covers `/documents-reports` **and**
> `/documents/:id` (the canonical document), because `census.py` files `/documents/:id` here.
> `PAGES-MAP.md` maps `/documents/:id` to `[[receipts]]` instead — the two disagree, and this note
> wins, because it is where the census's own generated subsection already lands. The
> correction is filed for the PAGES-MAP owner in
> [ADR 0134](../decisions/0134-one-motion-per-act-across-every-page.md). This also settles the
> "there is no page note for `/document`" finding: there is, and it is this one.

Neither route carries a live overlay. `/documents-reports` has one legacy preview that retires into
the reading pane; `/documents/:id` has none — `CanonicalSheet` is a page section, not a portal.

| Owed surface | Route | Shape | Contract sentence | Status |
|---|---|---|---|---|
| Permission-denied on a report a reader may not open | `/documents-reports` | the shared `Denied` block, in place in the reading pane | "You can see this drawer, but only an owner may open this report. Ask {name} to grant it." | primitive **built** (packet 0); wiring owed to **packet 4** |
| "Could not be read" separated from "holds nothing" | both | the reading pane's own empty and error states | the corpus's best empty state is on `/reports`, and its one gap is exactly this conflation | owed to a page pass |

## 1c. Motions decided (2026-09-06)

### `/documents-reports` — the Sorting Office

| Act | Today | Decided | Rejected, and why it loses | Status |
|---|---|---|---|---|
| A report is chosen and the reading pane fills | `settle` 320, keyed per report so switching **re-settles** | **first open `settle` 320; switching to a different report `turn` 420.** This is the house's open-versus-switch rule, and `/wines` is where it was first drawn correctly (`cl-stand-settle` to open, `cl-leaf-turn` when a different bottle is chosen while the stand is open) | (a) keep the re-settle — the same act answered two ways on two pages; (b) `turn` for both — opening a stand and turning a leaf are not the same act | owed to **packet 3** |
| Drawer row hover | `ink` 160 | keep | — | no change |
| Register link hover | `ink` 160, colour deepening toward the seal | keep | — | no change |
| Counts | never tally | keep — counts of record | — | no change |
| A waiting drawer answers | content swaps with no entrance | keep | — | no change |
| Error and retry | `ink` on the control, a sentence for the failure | keep | — | no change |
| Reduced motion | CSS media query at `DocumentsReportsNext.tsx:416` | keep | — | no change |

### `/documents/:id` — the canonical document

> Measured: `pages/documents/next/canonical-document.css` carries **no `transition`, no
> `@keyframes`, no `animation`** across its 114 lines, there is no `MOTIONS.md` for the directory,
> and there is **no reduced-motion handling of any kind**. It is the only rebuilt page with neither
> motion nor a motion record.

| Act | Today | Decided | Rejected, and why it loses | Status |
|---|---|---|---|---|
| **Reduced motion** | none | **add the guard first, before any motion lands.** This page is perfectly compliant today by being still; adding three motions without a guard would be a net accessibility regression, and both recommendations for this page omitted it | add the motions first and the guard later — the ordering is the whole point | owed to **packet 3**, and it gates the three rows below |
| Page load | nothing | `settle` 320 on the head block only, 6 px — the same one opening gesture every other rebuilt page has | (a) nothing — then this is the only rebuilt page whose masthead does not arrive; (b) `turn` on the whole document — a document you navigated to is not a page you turned | owed to **packet 3**, after the guard |
| Tab switch (`pages/documents/next/CanonicalDocumentPage.tsx:449-471`) | instant | `turn` 420 on the pane, opacity plus 5 px — a document's sections are leaves, and this is `/wines`' leaf and `/settings`' register | (a) `settle` 320 — a section of the same document is not a new row; (b) an indicator travel only — a good addition, not a replacement | owed to **packet 3**, after the guard |
| Line arithmetic and the tie-out | nothing | build `sig-09`: extensions written left to right on a clip over 190 ms, the em dash never moving, rules drawn right to left on `settle` 220 with the second stroke at +90 ms, and **no second stroke until the price is provable**; the provable total on `tally` | (a) a total plus a warning chip — this is the page whose whole job is provenance; (b) animate every figure — then the unknown looks like the known | owed to a page pass, after the guard |
| Print, back, refetch, the error banner | instant; a label change; `role="alert"` with no motion | keep all four. The refetch's label-only change is the house's anti-spinner rule, and the error banner is a fact, not an event | a spinner (waiting would look like progress); a shake; a slide-in | no change |
| A `MOTIONS.md` for `pages/documents/next/` | does not exist | **write one when the first motion lands** — every other rebuilt page has a motion record, or a file saying why it has none. Silence reads as absence-reported-as-health | leave it — the guard in ADR 0134 is written to go red on exactly this | owed to **packet 3** |

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
| Gateway (next only) | procurement documents list (≤100) · active conversations · unverified door counts · `GET /logs/timeline/:restaurantId` (≤100; returns `failedSources` + `sourcesQueried`, ADR 0086) · `GET /reports?limit=100` | `documents-reports/next/useSortingOfficeData.ts` |
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
- ~~**`/logs` reads the same endpoint and has not caught up (ADR 0086).**~~
  **Closed on `main`** (PR #262, `4d0f6c50`). `LogsTimelinePage.tsx` now reads `failedSources`
  and `sourcesQueried` and tolerates the nullable `occurredAt`, so both pages
  treat a lost register the same way. Its own remaining gap — a 100-row feed
  with no floor marker, and no `PAGES` entry in `check_windowed_figures.py` —
  is filed on `logs.md` §9 and as an executable `CLAIMS.jsonl` entry, not here.

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

### Motions and overlays — the rows this pass owes (2026-09-06)

From the decisions in §1c. Owner packets: **packet 3** the motion pass, **packet 4** the
states owed, **packet 5** the gestures; a *page pass* is this page's own next opening.
The reasoning is in §1c and in [ADR 0134](../decisions/0134-one-motion-per-act-across-every-page.md);
these are the rows.

1. `pages/documents-reports/next/DocumentsReportsNext.tsx` — first open `settle` 320, switching to a different report `turn` 420 (the open-versus-switch rule). **packet 3**
2. `pages/documents/next/canonical-document.css` — **the reduced-motion guard first**, before any motion lands on `/documents/:id`. The page has none of either today. **packet 3**
3. `pages/documents/next/CanonicalDocumentPage.tsx:449-471` — then the head's `settle` 320 and the tab switch's `turn` 420. **packet 3**
4. `pages/documents/next/MOTIONS.md` — write one. It is the only rebuilt page with neither motion nor a motion record, and silence reads as absence-reported-as-health. **packet 3**
5. `sig-09` — extensions on a 190 ms clip, rules on `settle` 220 with the second stroke at +90 ms, and no second stroke until the price is provable. *page pass*
6. `PAGES-MAP.md` routes `/documents/:id` to `[[receipts]]`; `census.py` files it here, which is where its generated overlay block already lands. One of the two must move. *PAGES-MAP owner*

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
