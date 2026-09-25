---
type: reference
title: Live Checklist
updated: 2026-09-25
---

# Live Checklist — every route in App.tsx, ticked against reality

> **Why this document exists, and why it breaks CLAUDE.md §4's retire-to-write rule
> without naming a document to retire.** The founder asked for it directly, in
> session, on 2026-09-17, as part of [ADR 0149](../decisions/0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once.md)
> row 36 (the "16 locked pages" go-live): a checklist of every route, so "live for
> every house" is something he can tick against, not something he has to trust a
> chat message about. This is the same exception `.planning/handoff/PROGRESS.md`
> already carries — a founder-requested tracking document, not a new corpus entry
> that needs a sibling retired.
>
> **What this is not:** [[PAGES-MAP]]'s "47 pages documented" is a census of
> *documented page notes* against [[PAGE-CONTRACT]]. This is a census of every
> `<Route>` `App.tsx` actually declares — **61**, matching the count measured in
> ADR 0149's own context section **[2026-09-25: 67 at `059169a59`; the six added since are `/authorize/complete`, `/deliveries/:id`, `/house`, `/house/menu`, `/menu` and `/orders/:id` — [web-rebuild census](../07-reference/deploy/WEB-REBUILD-CENSUS-2026-09-25.md) §1a]** — which is a different, larger unit: it includes
> redirects and internal-only tools that never earned a page note. The two lists
> disagree on purpose; do not "reconcile" them by editing one to match the other.
>
> **How to read the columns.** *design* is what the route renders today, not what
> is planned: `Mudavym` (the redesign, gated), `improved in place` (today's page,
> color-only switch, no redraw), `legacy` (untouched), `internal tool` (deliberately
> outside the redesign, ADR 0143 §5/§14), `redirect` (no page of its own). *design
> locked?* asks whether a founder decision fixes the target shape — a page can be
> `Mudavym`-built and still not locked (a sketch review is still owed). *built on
> main?* is a grep, not an intent. *live for every house?* is a tick — **only** a
> tick means every house sees it with no flag row; sixteen rows read **"live on
> merge of this PR"** because that is what this record ships, and the parent
> session ticks them for real after the merge is confirmed deployed (§9 needs a
> deploy proof, not a claim) [2026-09-22: all sixteen ticked against the live build,
> see "Deploy proof, 2026-09-22"]. *legacy deleted?* is always "No" or "N/A" in this
> revision — ADR 0149 deletes nothing before the founder approves a manifest,
> file group by file group.
>
> **Measured at:** `origin/main` `60ed83a7` (2026-09-17), the commit this lane's
> worktree (`wt-fin-live`, branch `feat/finish-live`) branched from. Ticks in the
> "live for every house?" column describe what merging **this PR** changes, not
> what `60ed83a7` itself does — `60ed83a7` still gates all twenty `MUDAVYM_PAGES`
> behind `restaurant_feature_flags`; some rows are set true for ALDEMIR (11 of
> 20 as last recorded 2026-09-12, `mudavym-ground-live-pr-356` memory — not
> re-measured here, and thirteen houses have none per ADR 0149's own context
> section). The `/login` `/register` rows' "switch OFF in production" is
> sourced to ADR 0149's context section, not independently measured by this
> document (live-review.md 2026-09-17, minor 7).

> **The bell poll goes wide with this merge, unmeasured (live-review.md
> 2026-09-17, major 4).** `PageGate` mounts `HouseHeader` above every `next`
> tree, and the bell polls `GET /notifications/unread/count` every 60s plus a
> focus refresh (`useBellBook.ts:81,226,281`) — so this PR takes that poll from
> whatever houses had a flag row set to every signed-in user on 15 of the 16
> rows below (the door, `NO_CHROME`, is the exception). `HouseHeader.tsx:40-47`
> records the founder's condition for the next cadence step (10s) as "once the
> unread-count query is measured under the real tenant fan-out rather than
> assumed cheap" — this merge multiplies that query's callers estate-wide
> without that measurement having happened. Recorded here because STATE.md,
> PROGRESS.md §0c and this document were all silent about it before; the next
> session should either measure the query under real fan-out or treat this as
> the standing, accepted cost of the go-live.

> **REBUILT 2026-09-25** from the [web-rebuild census](../07-reference/deploy/WEB-REBUILD-CENSUS-2026-09-25.md)
> §1a, measured at `origin/main` `059169a59` (what production serves, re-measured by curl the same
> day). Every route table below was rebuilt from `grep -n 'path="' apps/web/src/App.tsx` (67 lines)
> and `LIVE_PAGES` (`useMudavymDesign.ts:125-146`, 20 keys); flag states are a read-only production
> query of `restaurant_feature_flags` at 2026-09-25T21:11Z (14 rows, 14 houses). `App.tsx:NNN`
> cells are current line numbers. The "Measured at" paragraph above, the wave-5 sweep and the
> 2026-09-22 deploy proof below are kept as the records of their own dates. What the rebuild
> fixed: `settings`, `help`, `cellar` (8 routes) and `menu` are live in code, not held back or
> legacy; the seven public doors are live Mudavym pages (#426), not legacy; `/get-started`,
> `/authorize/:integrationId` and `/admin` are built and gated, not legacy or plain internal;
> `/onboarding` is a redirect; sketches 107–113 were reviewed (ADR 0160), so no row says a review
> is owed; the six routes no table tracked (`/orders/:id`, `/menu`, `/house`, `/house/menu`,
> `/authorize/complete`, `/deliveries/:id`) now have rows.

## Live for every house in code — 20 keys, 28 routes

*Rebuilt 2026-09-25.* The rows for the sixteen original keys (seventeen routes, counting `/orders/:id`) went live with #421 (merged 2026-09-21, deployed 2026-09-22); `settings`, `help`, `cellar` and `menu` joined in code with #419, #413 and #434 (2026-09-22/23 UTC). None reads a `restaurant_feature_flags` row.

| Route | Page | Design | Design locked? | Built on main? | Live for every house? | Deployed proof | Legacy deleted? | Notes |
|---|---|---|---|---|---|---|---|---|
| `/` | dashboard | Mudavym | Yes — ADR 0149 row 36 | Yes (`DashboardNext.tsx`) | ✓ `34c33a76a` (#421) | first served from `9cfc4e96d` at 2026-09-22T03:41:32Z UTC (see "Deploy proof, 2026-09-22") | No | `App.tsx:361` |
| `/inventory` | inventory | Mudavym | Yes — ADR 0149 row 36 | Yes (`InventoryCommandPage.tsx`, same component both branches) | ✓ `34c33a76a` (#421) | first served from `9cfc4e96d` at 2026-09-22T03:41:32Z UTC (see "Deploy proof, 2026-09-22") | No | Gate exists only to mount `HouseHeader` (`App.tsx:362-369`) |
| `/orders` | orders | Mudavym | Yes — ADR 0149 row 36 | Yes (`OrdersNext.tsx`) | ✓ `34c33a76a` (#421) | first served from `9cfc4e96d` at 2026-09-22T03:41:32Z UTC (see "Deploy proof, 2026-09-22") | No | `App.tsx:376`; the bare row click is OD-152 (OPEN-DECISIONS.md:84) |
| `/orders/:id` | orders | Mudavym | Yes — ADR 0149 row 36 | Yes (`OrdersNext.tsx`) | ✓ `34c33a76a` (#421) | first served from `9cfc4e96d` at 2026-09-22T03:41:32Z UTC (see "Deploy proof, 2026-09-22") | No | `App.tsx:383`; not tracked by this file before 2026-09-25 |
| `/receiving/:orderId/door` | receiving_door | Mudavym | Yes — ADR 0149 row 36 | Yes (`DoorNext.tsx`) | ✓ `34c33a76a` (#421) | first served from `9cfc4e96d` at 2026-09-22T03:41:32Z UTC (see "Deploy proof, 2026-09-22") | No | Outside `DashboardLayout` on purpose; `NO_CHROME`. `App.tsx:289-292` |
| `/providers` | providers | Mudavym | Yes — ADR 0149 row 36 | Yes (`ProvidersNext.tsx`) | ✓ `34c33a76a` (#421) | first served from `9cfc4e96d` at 2026-09-22T03:41:32Z UTC (see "Deploy proof, 2026-09-22") | No | `App.tsx:430`. **Not every surface rebuilt:** vendor sentiment renders through the legacy `ProviderIntelligencePanel` inside the sheet (`TwinSheet.tsx:33-35,155`), and distributor discovery exists only in legacy `Providers.tsx:152-246` — `ProvidersNext` reads no search params, so `/distributors` lands on the roster (ADR 0149 row 22) |
| `/communications` | communications | Mudavym | Yes — ADR 0149 row 36 | Yes (`CommunicationsNext.tsx`) | ✓ `34c33a76a` (#421) | first served from `9cfc4e96d` at 2026-09-22T03:41:32Z UTC (see "Deploy proof, 2026-09-22") | No | `App.tsx:461`; only page allowed a conversation list (ADR 0149 row 25). **Live defect:** every house sees an error for "the report schedules", because `public.scheduled_reports` is created by no migration (census F1) |
| `/team` | team | Mudavym | Yes — ADR 0149 row 36 | Yes (`TeamNext.tsx`) | ✓ `34c33a76a` (#421) | first served from `9cfc4e96d` at 2026-09-22T03:41:32Z UTC (see "Deploy proof, 2026-09-22") | No | `App.tsx:455`; pay/hours fix #440 open |
| `/reports` | reports | Mudavym | Yes — ADR 0149 row 36 | Yes (`ReportsNext.tsx`) | ✓ `34c33a76a` (#421) | first served from `9cfc4e96d` at 2026-09-22T03:41:32Z UTC (see "Deploy proof, 2026-09-22") | No | `App.tsx:418` |
| `/calendar` | calendar | Mudavym | Yes — ADR 0149 row 36 | Yes (`CalendarNext.tsx`) | ✓ `34c33a76a` (#421) | first served from `9cfc4e96d` at 2026-09-22T03:41:32Z UTC (see "Deploy proof, 2026-09-22") | No | `App.tsx:456`; personal iCal links #438 open |
| `/documents-reports` | documents_reports | Mudavym | Yes — ADR 0149 row 36 | Yes (`DocumentsReportsNext.tsx`) | ✓ `34c33a76a` (#421) | first served from `9cfc4e96d` at 2026-09-22T03:41:32Z UTC (see "Deploy proof, 2026-09-22") | No | `App.tsx:462` |
| `/receipts` | receipts | Mudavym | Yes — ADR 0149 row 36 | Yes (`ReceiptsNext.tsx`) | ✓ `34c33a76a` (#421) | first served from `9cfc4e96d` at 2026-09-22T03:41:32Z UTC (see "Deploy proof, 2026-09-22") | No | `App.tsx:463`. **Not every surface rebuilt:** `?tab=credits` (and `/credits`) renders the legacy `ReceiptsPage` inside the live page (`ReceiptsNext.tsx:75-79,1312-1315`; ADR 0149 row 22) |
| `/documents/:id` | document | Mudavym | Yes — ADR 0149 row 36 | Yes (`CanonicalDocumentPage.tsx`) | ✓ `34c33a76a` (#421) | first served from `9cfc4e96d` at 2026-09-22T03:41:32Z UTC (see "Deploy proof, 2026-09-22") | No | `App.tsx:472`; ADR 0104 D12 slice 2 |
| `/logs` | logs | Mudavym | Yes — ADR 0149 row 36 | Yes (`LogsNext.tsx`) | ✓ `34c33a76a` (#421) | first served from `9cfc4e96d` at 2026-09-22T03:41:32Z UTC (see "Deploy proof, 2026-09-22") | No | `App.tsx:481` |
| `/notifications` | notifications | Mudavym | Yes — ADR 0149 row 36 | Yes (`NotificationsNext.tsx`) | ✓ `34c33a76a` (#421) | first served from `9cfc4e96d` at 2026-09-22T03:41:32Z UTC (see "Deploy proof, 2026-09-22") | No | `App.tsx:482` |
| `/profile` | profile | Mudavym | Yes — ADR 0149 row 36 | Yes (`ProfileNext.tsx`) | ✓ `34c33a76a` (#421) | first served from `9cfc4e96d` at 2026-09-22T03:41:32Z UTC (see "Deploy proof, 2026-09-22") | No | `App.tsx:484`; passkey enrolment is an owed build item (ADR 0134 round 6r §7, census §3 L12) |
| `/connections` | connections | Mudavym | Yes — ADR 0149 row 36 | Yes (`ConnectionsNext.tsx`) | ✓ `34c33a76a` (#421) | first served from `9cfc4e96d` at 2026-09-22T03:41:32Z UTC (see "Deploy proof, 2026-09-22") | No | `App.tsx:491`; revoked-mail banner built (`ConnectionsNext.tsx:319`, ADR 0149 row 53); a Calendar grant is OD-151 (OPEN-DECISIONS.md:25) |
| `/settings` | settings | Mudavym | Yes — ADR 0160 §109 (A, the interview) | Yes (`SettingsNext.tsx`) | ✓ #419 (`24b7d5288`) | ✓ served bundle `index-DgyBtnzD.js` carries the 20-key `LIVE_PAGES` literal (curl, 2026-09-25) | No | `App.tsx:483` |
| `/help` | help | Mudavym | Yes — ADR 0160 §111 (delegated, two must-haves) | Yes (`HelpNext.tsx`) | ✓ #413 (`490e9962d`) | ✓ served bundle `index-DgyBtnzD.js` carries the 20-key `LIVE_PAGES` literal (curl, 2026-09-25) | No | `App.tsx:496` |
| `/wines` | cellar | Mudavym | Yes — ADR 0160 §110 (direction B) | Yes (`CellarNext.tsx`) | ✓ #434 (`92ea9cecc`) | ✓ served bundle `index-DgyBtnzD.js` carries the 20-key `LIVE_PAGES` literal (curl, 2026-09-25) | No | `App.tsx:401` |
| `/cellar` | cellar | Mudavym | Yes — ADR 0160 §110 (direction B) | Yes (`CellarNext.tsx`) | ✓ #434 (`92ea9cecc`) | ✓ served bundle `index-DgyBtnzD.js` carries the 20-key `LIVE_PAGES` literal (curl, 2026-09-25) | No | `App.tsx:406` |
| `/beer` | cellar | Mudavym | Yes — ADR 0160 §110 (direction B) | Yes (`CellarNext.tsx`) | ✓ #434 (`92ea9cecc`) | ✓ served bundle `index-DgyBtnzD.js` carries the 20-key `LIVE_PAGES` literal (curl, 2026-09-25) | No | `App.tsx:407` |
| `/whiskey` | cellar | Mudavym | Yes — ADR 0160 §110 (direction B) | Yes (`CellarNext.tsx`) | ✓ #434 (`92ea9cecc`) | ✓ served bundle `index-DgyBtnzD.js` carries the 20-key `LIVE_PAGES` literal (curl, 2026-09-25) | No | `App.tsx:408` |
| `/cocktails` | cellar | Mudavym | Yes — ADR 0160 §110 (direction B) | Yes (`CellarNext.tsx`) | ✓ #434 (`92ea9cecc`) | ✓ served bundle `index-DgyBtnzD.js` carries the 20-key `LIVE_PAGES` literal (curl, 2026-09-25) | No | `App.tsx:409` |
| `/spirits` | cellar | Mudavym | Yes — ADR 0160 §110 (direction B) | Yes (`CellarNext.tsx`) | ✓ #434 (`92ea9cecc`) | ✓ served bundle `index-DgyBtnzD.js` carries the 20-key `LIVE_PAGES` literal (curl, 2026-09-25) | No | `App.tsx:410` |
| `/non-alcoholic` | cellar | Mudavym | Yes — ADR 0160 §110 (direction B) | Yes (`CellarNext.tsx`) | ✓ #434 (`92ea9cecc`) | ✓ served bundle `index-DgyBtnzD.js` carries the 20-key `LIVE_PAGES` literal (curl, 2026-09-25) | No | `App.tsx:411` |
| `/soft-drinks` | cellar | Mudavym | Yes — ADR 0160 §110 (direction B) | Yes (`CellarNext.tsx`) | ✓ #434 (`92ea9cecc`) | ✓ served bundle `index-DgyBtnzD.js` carries the 20-key `LIVE_PAGES` literal (curl, 2026-09-25) | No | `App.tsx:412` |
| `/menu` | menu | Mudavym | Yes — ADR 0160 §110 item 7 | Yes (`MenuNext.tsx`) | ✓ #434 (`92ea9cecc`) | ✓ served bundle `index-DgyBtnzD.js` carries the 20-key `LIVE_PAGES` literal (curl, 2026-09-25) | No | `App.tsx:417`; a new route, no legacy predecessor |

## Isolated-mount sweep — wave 5 (2026-09-18), the row-36 soak question

The founder ruled (2026-09-18, recorded as ADR 0149 row 40) that the isolated-page
sweep already run twice on this lane (wave4/live-fix.md, live-confirm.md) **counts**
as the soak this section's rows owe, on the condition that its fidelity is stated
plainly rather than implied. So, plainly:

> **What this measures, and what it does not.** Every page below was mounted alone
> — real hooks, real page components, the shared `apiClient` singleton patched so
> every read it sends rejects — at 1440px and 390px, with `localStorage`'s
> `accessToken` cleared before each load (`stores/authStore.ts:304` otherwise
> fires a real `ERR_CONNECTION_REFUSED` at module-evaluation time and hard-redirects
> to `/login` before the harness's own mock ever runs). This proves what each page
> shows when **every** read fails: whether the failure is stated (a `role="alert"`
> or equivalent honest prose) or silently rendered as a healthy zero, whether the
> text carrying that failure is legible, and whether the layout survives it at
> phone width. **It does not exercise a working day** — no query returns real data,
> no happy path is drawn, no chrome (`HouseHeader`, sidebar, bell) is mounted
> because the harness renders each page outside `DashboardLayout`, and no
> multi-restaurant, multi-role or concurrent-user behaviour is touched. A page
> passing every row below is proven honest about failure, not proven correct
> about success.
>
> **Three more limits, added 2026-09-19 (wave5/live-confirm.md §6 — this
> statement understated its own reach, found when the same pass caught the
> `/providers` `TwinSheet` regression, B1 below, that an on-mount-only sweep
> cannot see):**
> - **Overlays and sheets are never opened.** Each page mounts closed. A
>   defect that only shows inside an opened sheet (exactly what B1 was) is
>   invisible to every row below, pass or fail.
> - **The contrast column is 1440-only.** No row here re-checks contrast at
>   390; only overflow is checked at that width.
> - **Timer and `ResizeObserver` behaviour differs in a hidden pane.** A
>   page's queries can fail to settle, and `WidthProvider`-style layout can
>   report a pre-layout width, purely because the harness tab was not the
>   foreground/visible one — the `/reports` row below was corrected for
>   exactly this.

Method: `document.querySelector('h1')`'s computed color (legible = inherits ink-1,
not the invisible slate-900 globals.css leak, ADR 0042 §h1); `[role="alert"]`
count plus a phrase scan (`could not be reached`, `unreachable`, …) for pages that
state failure as prose instead; a WCAG contrast scan over every leaf text node
against its nearest ancestor's actual background (flags anything under 4.5:1, or
3:1 at ≥24px/≥18.66px-bold); `document.documentElement.scrollWidth` vs `clientWidth`
for horizontal overflow.

**CORRECTED 2026-09-19** (wave5/live-confirm.md §6, CLAUDE.md §5b — struck
rather than silently deleted): this used to say "Full script and per-page
JSON in this PR's session transcript; not re-pasted here per CLAUDE.md §2."
A session transcript is not a re-checkable location — nobody re-reading this
file later can open it, and the sweep harness itself
(`apps/web/sweep.html`, `apps/web/src/__sweep__/`) was deleted after use
(§ below), so the granular per-element measurements behind each cell (the
individual contrast ratios, the raw `scrollWidth`/`clientWidth` pairs) are
**not recoverable** and this correction does not restore them. What IS
re-checkable now: the summary table below — the same one this claim was
attached to — is additionally mirrored at
[`live-checklist-wave5-sweep.json`](./live-checklist-wave5-sweep.json), one
record per route; regenerate with `scripts/extract_wave5_sweep.py`, never
hand-edit the JSON, so the two cannot drift silently the way the prose claim
above did.

| Route | h1 legible | Failure stated | Low-contrast text (1440) | 390 overflow | Notes |
|---|---|---|---|---|---|
| `/` | Yes | Yes — honest prose, every tile em dash | 0 | No | |
| `/inventory` | Yes (legacy light page, correctly dark-on-white) | Yes — banner now names all three failed reads (inventory/summary/low-stock), was inventory-only | 0 (15 pre-existing legacy slate-400 labels at 2.87:1, unrelated to this PR, not touched) | No | **2 more zero-figure sites found and fixed this pass**: the page-header subtitle ("N wines, N bottles on hand") and the table footer ("Showing N of N wines") both read raw `stats`/`rows` and printed literal zeros under a failed read; both now route through the same `fig()` em-dash helper as the KPI strip. Covered by `InventoryCommandPage.test.tsx` (new, 6 cases). |
| `/orders` | Yes | Yes — `role="alert"` | 0 | **Yes, 24px** (`scrollW` 414 vs `clientW` 390) — a tab-strip button ("Recurring") and a toast/`sonner` container both sit past the viewport edge. Pre-existing, not touched by this PR; not fixed this pass. | |
| `/receiving/:orderId/door` | Yes | N/A by design — camera-first, no read on mount | 0 | No | |
| `/providers` | Yes | Yes — `role="alert"` | **0, was 1 at 2.68:1** (the `--alarm` token fix, below) | No | |
| `/communications` | Yes | Yes — `role="alert"` | **0, was 9 at 2.19–2.31:1** (the `--alarm-deep` token fix, below) | No | |
| `/team` | Yes | Yes — 6 alerts | 0 | No | |
| `/reports` | Yes | **Yes — 21 failure phrases at both widths, see correction below** | 0 (not separately re-broken-out this pass; live-confirm.md §6's "every page's h1 4.5:1 or better" covers it) | **No** (the row-40 pass's "1296" was a `.rp-skel` skeleton read before layout, not overflow — see correction) | **CORRECTED 2026-09-19** (wave5/live-confirm.md §6, re-measured, not carried forward per CLAUDE.md §5b — the two cells and the finding above are struck, not deleted): both symptoms were harness artefacts, not product defects, and the founder question they raised is **withdrawn**. (1) The "stuck on Reading the registers…" state happens only with **no active restaurant set** — `useReportsNextData.ts:253` has `enabled: !!rid` on every query, so a harness that never set an active restaurant (this page's data hook is the one of the 16 that needs one to enable its reads at all) leaves every query permanently disabled, which is indistinguishable from "never settles" by symptom alone. With `rid` set and every read rejecting, `/reports` states failure exactly like its siblings: "The insight register could not be read … Nothing below is claimed." (2) The 1296px width at 390 came from `react-grid-layout`'s `WidthProvider`, which needs one rendered frame for its `ResizeObserver` to fire — reading `scrollWidth` before that frame catches the skeleton's pre-layout width, not the settled one; one frame later the items are 358px and the overflow is 0. Both are exactly the class of gap the fidelity statement's three limits above now name (hidden-pane timing). |
| `/calendar` | Yes | Yes — `role="alert"` | 0 | No | |
| `/documents-reports` | Yes | Yes — `role="alert"` | 0 | No | |
| `/documents/:id` | Yes (CSS rule + a belt-and-suspenders inline style, wave4) | Yes — `role="alert"`, the h1 itself states the failure | **0, was 2 at 2.35:1** (the `.mudavym p` rule fix, below) | No | |
| `/logs` | Yes | Yes — `role="alert"` | **0, was 4 at 2.35–2.47:1** (the `.mudavym p` rule fix, below) | No | |
| `/notifications` | Yes | Yes — `role="alert"` | 0 | No | |
| `/profile` | Yes | Yes — honest prose (18 could-not/unknown statements, wave4 count, reconfirmed present) | 0 | No | |
| `/connections` | Yes | Yes — honest prose | **0, was 2 at 2.47:1** (the `.mudavym p` rule fix, below) | No | |
| `/receipts` | Yes | Yes — `role="alert"` | 0 | No | |

**The two CSS fixes this pass made, each closing a live-confirm.md §4a/§6 finding:**
`apps/web/src/styles/mudavym.css` gained `.mudavym p, h2, h3, h4 { color: inherit }`
(extending wave4's `h1`-only rule to the other bare tags `globals.css` colours —
fixes `/connections`, `/documents/:id`, `/logs`) and `--alarm`/`--alarm-deep`
custom-property declarations (22 call sites across communications/providers/orders
were reading an undeclared variable's CSS fallback, which measured under 4.5:1 on
this ground — fixes `/providers`, `/communications`). Both re-measured above, not
carried forward from the prior pass's numbers (CLAUDE.md §5b).

Sweep harness (`apps/web/sweep.html`, `apps/web/src/__sweep__/`) deleted after use,
per its own header's promise; the three leftover dev/storybook processes wave4
left running are stopped.
## Gated — built on main, still behind a per-house flag

| Route | Page | Design | Design locked? | Built on main? | Live for every house? | Flag in production (2026-09-25T21:11Z) | Legacy deleted? | Notes |
|---|---|---|---|---|---|---|---|---|
| *(the shell — every signed-in route's layout)* | shell | Mudavym (the counter, sketch 119 D) | Yes — ADR 0160, 2026-09-21 rows | Yes (#437 `7022434f7`) | No — ON for 14 of 14 houses in the database, default OFF in code (`feature-flag-registry.ts:103`), so a new house gets the legacy Sidebar. **Going live in code via the L4 PR (`feat/live-shell-admin-authorize`)** | ON 14/14 | No | Read by `DashboardLayout`, not a `PageGate`. Who set the 14 rows is recorded nowhere |
| `/admin`, `/admin/health` | admin | Mudavym (`AdminDesk.tsx`) | Not stated as locked; ADR 0149 row 10 covers its five local-only knobs | Yes (#415 `cc73f9f66`) | No — ON 14/14 in the database, default OFF in code (`feature-flag-registry.ts:130`). **Going live in code via the L4 PR (`feat/live-shell-admin-authorize`)** | ON 14/14 | No | `App.tsx:499-500`; owner-only; `/admin/health`'s next branch redirects to `/admin` |
| `/authorize/:integrationId` | authorize_integration | Mudavym (`AuthorizeIntegrationNext.tsx` + `AuthorizeShell.tsx`) | Yes — ADR 0144, ADR 0149 row 16 | Yes (#430 `e2abd7844`) | No. **Going live in code via the L4 PR (`feat/live-shell-admin-authorize`)** | OFF 14/14 | No | `App.tsx:345-351`; `/authorize/complete` (341) is its OAuth landing |
| `/receiving` | receiving | Mudavym (`ReceivingNext.tsx`, the pre-Approach-1 desk) | Direction yes — ADR 0160 §107 (B+); the too-many-operations answer (Q7, Approach 1) collides with the 2026-09-21 verdict-ledger strip (census F7) | Desk yes; Approach 1 no | No | ON 1/14 | No | `App.tsx:385`. The desk, not the door. Build base is `origin/wip/2026-09-21/receiving` (`30a8c7ce7`), not `wt-pg-receiving` (census §3 L6) |
| `/recommendations`, `/recommendations/catalog` | recommendations | Mudavym (`RecommendationsNext.tsx`, `CatalogView.tsx`, #420 `3579fa0c7`) | Direction yes — ADR 0160 §108; one more round owed: sketch 122 round 6 on `origin/wip/2026-09-21/recs-sketch` (`d6120adaa`); no founder review of it is recorded | Yes (four of sketch 120's six items) | No | OFF 14/14 | No | `App.tsx:419,421` |
| `/get-started` | arrival | Both slots built: the `legacy` slot **is** ADR 0213's plan of record (#455); the `next` slot is #414's Arrival book (1413 lines), dormant | Yes — ADR 0213 (the legacy slot) | Yes | Every house gets ADR 0213's flow, because the flag is off | OFF 14/14 | N/A — do not delete the `legacy` slot at cutover (census R14, F5) | `App.tsx:215-219` |

## Public doors — live Mudavym pages for every visitor since #426

`isPublicDesignOn()` resolves `true` unconditionally since #426 (`410534a21`; `publicDesign.ts:16,24`); `VITE_MUDAVYM_PUBLIC` is no longer read. All nine pages import the public design (`git grep -l publicDesign -- apps/web/src/pages/*.tsx`).

| Route | Design | Design locked? | Live for every visitor? | Legacy deleted? | Notes |
|---|---|---|---|---|---|
| `/login` | improved in place (Mudavym) | Yes — ADR 0133 §1, ADR 0143 §1; flyleaf redraw ADR 0149 row 35 | ✓ #426 | No — the public switch's off branch | `App.tsx:202` |
| `/register` | improved in place (Mudavym) | Yes — as `/login`; account-only per ADR 0213 | ✓ #426, #455 | No | `App.tsx:203` |
| `/forgot-password` | Mudavym public door | Yes — ADR 0149 row 7 | ✓ #426 | No | `App.tsx:204` |
| `/reset-password` | Mudavym public door | Yes — ADR 0149 row 7 | ✓ #426 | No | `App.tsx:205` |
| `/verify-email` | Mudavym public door | Yes — ADR 0149 row 7 | ✓ #426 | No | `App.tsx:206` |
| `/invite/:code` | Mudavym public door | Yes — ADR 0149 row 7 | ✓ #426 | No | `App.tsx:207` |
| `/no-access` | Mudavym public door | Yes — ADR 0149 row 7 | ✓ #426 | No | `App.tsx:208` |
| `/privacy` | Mudavym public door | Page yes; legal-facts text deferred — OD-132 (OPEN-DECISIONS.md:26) | ✓ #426 | No | `App.tsx:211`; carries round 6y's "Questions you ask Mudavym" section via #430 (`Privacy.tsx:21-31`) |
| `/v/:slug` | Mudavym public door | Yes — ADR 0149 row 7 | ✓ #426 | No | `App.tsx:214`; public vendor board |

## House pages — always on, ungated

| Route | Design | Built on main? | Notes |
|---|---|---|---|
| `/house` | Mudavym (`HouseContents.tsx`) | Yes (#455 `ddc5e094b`) | `App.tsx:223`; ADR 0213; no `PageGate`, no page note yet |
| `/house/menu` | Mudavym (`HouseMenu.tsx`), the first proof | Yes (#455) | `App.tsx:231`; ADR 0213. Shows no read/placed/not-placed counts (sketch 121 §7.3, census F5) |

## Legacy — no Mudavym build on main

| Route | Page | Design | Design locked? | Built on main? | Live for every house? | Legacy deleted? | Notes |
|---|---|---|---|---|---|---|---|
| `/vendor-prices` | — | legacy (`VendorPriceCompare.tsx`) | Yes — ADR 0160 §112 (reviewed 2026-09-17) | No — build on `origin/wip/2026-09-21/vprices` (`41e9060c8`) | No | N/A | `App.tsx:434`; census §3 L9 |
| `/promotions` | — | legacy (`Promotions.tsx`) | Yes — ADR 0160 §113 (reviewed 2026-09-17); two drawings owed | No — build on `origin/wip/2026-09-21/promos` (`872baff9d`) | No | N/A | `App.tsx:447`; census §3 L8 |
| `/sommelier` | — | legacy (`SommelierAI.tsx`) | Superseded by `/ask` (ADR 0149 row 33, ADR 0145) | N/A | No | N/A | `App.tsx:508`; redirect to `/ask` once it exists |
| `/ask` | — | **no route** | Yes — ADR 0145 (all five forks answered, `0145…:264`); layout decided 2026-09-21, not yet recorded on main | Backend only (#430) | No | N/A | census §3 L11 |
| `/terms` | — | **no route** | Presupposed by ADR 0145:1040-1042 and `Privacy.tsx:21-27` | No | No | N/A | census §3 L11 |

## Internal tools — deliberately outside the redesign

| Route | Design | Design locked? | Notes |
|---|---|---|---|
| `/studio` | internal tool | N/A — ADR 0143 §5 | `App.tsx:242` |
| `/studio/queue` | internal tool | N/A | `App.tsx:252` |
| `/studio/certify` | internal tool | N/A | `App.tsx:260` |
| `/studio/invite/:token` | internal tool | N/A | `App.tsx:274`; deliberately not studio-role gated (the invite grants the role) |
| `/simpos/:restaurantId` | internal tool | N/A — ADR 0149 row 4 | `App.tsx:304`; redirects to `/` in production |
| `/simpos/:restaurantId/orders` | internal tool | N/A | `App.tsx:312`; same production redirect |
| `/simpos/:restaurantId/scenarios` | internal tool | N/A | `App.tsx:326`; ADR 0093 scenario harness |
| `/dev/truth` | internal tool | N/A — ADR 0143 §14 | `App.tsx:440` |
| `/dev-sandbox` | internal tool | N/A — ADR 0143 §14 | `App.tsx:512`; owner-only |

## Redirects and utility routes — no page of their own

| Route | Design | Notes |
|---|---|---|
| `/onboarding` | redirect → `/get-started` | `App.tsx:238` (was a real page until the ADR 0149 row 11 redirect landed) |
| `/inventory-legacy` | redirect → `/inventory` | `App.tsx:375`; ADR 0019 §B |
| `/distributors` | redirect → `/providers?tab=discover` | `App.tsx:443-446`; the live page ignores `?tab=discover` (see `/providers`) |
| `/calendar-classic` | redirect → `/calendar` | `App.tsx:460` |
| `/credits` | redirect → `/receipts?tab=credits` | `App.tsx:464`; lands on the legacy credits page (see `/receipts`) |
| `/services` | redirect → `/settings?tab=services` | `App.tsx:509` |
| `/authorize/complete` | utility — the OAuth landing (`CompleteIntegrationConsent.tsx`) | `App.tsx:341`; #430 |
| `/deliveries/:id` | utility — a delivery id to its order (`DeliveryRedirect.tsx`) | `App.tsx:400`; #424 |
| `*` (catch-all) | utility — `ShellCatchAll.tsx`: the in-app 404 under the shell, else redirect → `/` | `App.tsx:524`; with the shell ON for every house today, every house sees the 404 page |

## Total

**67 routes** at `059169a59` = 28 live in code + 7 gated (`/admin`, `/admin/health`, `/authorize/:integrationId`, `/receiving`, `/recommendations`, `/recommendations/catalog`, `/get-started`; the shell is a layout, not a route) + 9 public doors + 2 house pages + 3 legacy + 9 internal tools + 9 redirects and utility routes. `/ask` and `/terms` have no route and are not counted.

## Deploy proof, 2026-09-22

Ticked by session effa5204 after it confirmed production is running a commit that contains
#421 (`34c33a76a`, the commit that added `LIVE_PAGES`), per this file's own instructions below.
The proof is not a liveness 200.

- **Which build is live:** GitHub's `Production – restaurant-ai-automation-web` deployment for
  `9cfc4e96d` (#424, then main's tip, a descendant of `34c33a76a`) was created at
  2026-09-22T03:41:32Z UTC. At the time of this check, mudavym.com served
  `assets/index-D5K27GuW.js`, replacing `index-d9AwRgRS.js`, #418's build. #428 (`f80754129`)
  deployed at 2026-09-22T04:02:06Z UTC, and the same bundle was still being served afterwards.
- **The grep:** the served `index-D5K27GuW.js` (2,137,835 bytes) contains the `LIVE_PAGES` key
  list as one contiguous literal. Only #421 added it: `"dashboard","orders","receiving_door",
  "providers","communications","team","inventory","receipts","documents_reports","document",
  "reports","calendar","profile","connections","notifications","logs"`.
- **Why it was late:** #421 merged 2026-09-21 UTC but never deployed. Vercel's status on
  `34c33a76a` reads "Deployment rate limited — retry in 24 hours.", because the team was then on
  the free plan. Production stayed on #418 until the deployment of main created at 03:41:32Z UTC.
  That came after the founder upgraded the team to Pro, by his own report on 2026-09-22; we did
  not see the billing change ourselves. The hosting decision is a draft ADR, not yet filed.
- **Route smoke check (curl, 2026-09-22 UTC):** HTTP 200 on the sixteen routes' paths
  (`/`, `/inventory`, `/orders`, `/receiving/<id>/door`, `/providers`, `/communications`,
  `/team`, `/reports`, `/calendar`, `/documents-reports`, `/receipts`, `/documents/<id>`,
  `/logs`, `/notifications`, `/profile`, `/connections`) and on `/login`; a real 404 on an
  unknown path. A 200 proves only that the host serves the app for that path, not what the page
  renders. `/login` renders "Sign in · Mudavym" in a browser.
- **Not verified here:** what a signed-in house sees on each page. This session does not sign
  in, and entering credentials is not an agent's job. The `HouseHeader.test.tsx:407` spec is the
  in-code proof that a `LIVE_PAGES` page needs no flag row.
- **Owed:** ADR 0149 row 51's production walk against all sixteen pages ("Ship, then sweep
  production immediately"). The last Production E2E run before this deploy, 2026-09-21T07:31:26Z
  UTC on `79dfea023`, predates the deploy and failed. A run against `f80754129` was dispatched
  at 2026-09-22T04:20:07Z UTC (run 35686487962); its result is recorded where it lands, not here.
- "Legacy deleted?" stays `No` (ADR 0149: nothing is deleted before the founder approves the
  manifest, file group by file group).

## What "live for every house" ticks after this PR merges

**[DONE 2026-09-22 for the sixteen — see "Deploy proof, 2026-09-22" above; the four keys that joined later are proved by the 2026-09-25 bundle grep in the live table. Kept as the instruction that was followed.]**

The parent session (or whoever verifies the deploy) should, after confirming
production is running this PR's commit (see `production-deploy-verification`
memory — a liveness 200 proves *a* process up, not *which build*; grep
production's served bundle for a string only this PR's commit added):

1. Replace every "**live on merge of this PR**" cell above with a literal tick
   and the verifying commit hash.
2. Fill "Deployed proof" with how it was verified (commit + the grep, or a
   screenshot).
3. Leave "Legacy deleted?" as `No` — ADR 0149 deletes nothing until the founder
   approves a manifest, file group by file group.
