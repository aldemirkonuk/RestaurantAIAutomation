---
type: reference
title: Live Checklist
updated: 2026-09-22
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
> ADR 0149's own context section — which is a different, larger unit: it includes
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

## The 16, live since 2026-09-22 (#421 merged 2026-09-21, deployed 2026-09-22)

| Route | Page | Design | Design locked? | Built on main? | Live for every house? | Deployed proof | Legacy deleted? | Notes |
|---|---|---|---|---|---|---|---|---|
| `/` | dashboard | Mudavym | Yes — ADR 0149 row 36 | Yes (`DashboardNext.tsx`) | ✓ `34c33a76a` (#421) | `9cfc4e96d` served 2026-09-22 (see "Deploy proof, 2026-09-22") | No | `PageGate page="dashboard"`, `App.tsx:304` |
| `/inventory` | inventory | Mudavym | Yes — ADR 0149 row 36 | Yes (`InventoryCommandPage.tsx`, same component both branches) | ✓ `34c33a76a` (#421) | `9cfc4e96d` served 2026-09-22 (see "Deploy proof, 2026-09-22") | No | Gate exists only to mount `HouseHeader`; legacy and next are the same component (`App.tsx:312`) |
| `/orders` | orders | Mudavym | Yes — ADR 0149 row 36 | Yes (`OrdersNext.tsx`) | ✓ `34c33a76a` (#421) | `9cfc4e96d` served 2026-09-22 (see "Deploy proof, 2026-09-22") | No | `App.tsx:319` |
| `/receiving/:orderId/door` | receiving_door | Mudavym | Yes — ADR 0149 row 36 | Yes (`DoorNext.tsx`) | ✓ `34c33a76a` (#421) | `9cfc4e96d` served 2026-09-22 (see "Deploy proof, 2026-09-22") | No | Outside `DashboardLayout` on purpose (loading-dock, one-handed); `NO_CHROME` — no header even when live. `App.tsx:235-242` |
| `/providers` | providers | Mudavym | Yes — ADR 0149 row 36 | Yes (`ProvidersNext.tsx`) | ✓ `34c33a76a` (#421) | `9cfc4e96d` served 2026-09-22 (see "Deploy proof, 2026-09-22") | No | `App.tsx:337` |
| `/communications` | communications | Mudavym | Yes — ADR 0149 row 36 | Yes (`CommunicationsNext.tsx`) | ✓ `34c33a76a` (#421) | `9cfc4e96d` served 2026-09-22 (see "Deploy proof, 2026-09-22") | No | `App.tsx:368`; only page allowed a conversation list (ADR 0149 row 25) |
| `/team` | team | Mudavym | Yes — ADR 0149 row 36 | Yes (`TeamNext.tsx`) | ✓ `34c33a76a` (#421) | `9cfc4e96d` served 2026-09-22 (see "Deploy proof, 2026-09-22") | No | `App.tsx:362` |
| `/reports` | reports | Mudavym | Yes — ADR 0149 row 36 | Yes (`ReportsNext.tsx`) | ✓ `34c33a76a` (#421) | `9cfc4e96d` served 2026-09-22 (see "Deploy proof, 2026-09-22") | No | `App.tsx:334`; OD-81 export (CSV + print page) is a separate open item, not blocking this go-live |
| `/calendar` | calendar | Mudavym | Yes — ADR 0149 row 36 | Yes (`CalendarNext.tsx`) | ✓ `34c33a76a` (#421) | `9cfc4e96d` served 2026-09-22 (see "Deploy proof, 2026-09-22") | No | `App.tsx:363` |
| `/documents-reports` | documents_reports | Mudavym | Yes — ADR 0149 row 36 | Yes (`DocumentsReportsNext.tsx`) | ✓ `34c33a76a` (#421) | `9cfc4e96d` served 2026-09-22 (see "Deploy proof, 2026-09-22") | No | `App.tsx:369` |
| `/receipts` | receipts | Mudavym | Yes — ADR 0149 row 36 | Yes (`ReceiptsNext.tsx`) | ✓ `34c33a76a` (#421) | `9cfc4e96d` served 2026-09-22 (see "Deploy proof, 2026-09-22") | No | `App.tsx:370`; `?tab=credits` still lazy-loads legacy `ReceiptsPage` internally (ADR 0149 context, item 22) — unaffected by this gate change |
| `/documents/:id` | document | Mudavym | Yes — ADR 0149 row 36 | Yes (`CanonicalDocumentPage.tsx`) | ✓ `34c33a76a` (#421) | `9cfc4e96d` served 2026-09-22 (see "Deploy proof, 2026-09-22") | No | `App.tsx:378-387`; ADR 0104 D12 slice 2 |
| `/logs` | logs | Mudavym | Yes — ADR 0149 row 36 | Yes (`LogsNext.tsx`) | ✓ `34c33a76a` (#421) | `9cfc4e96d` served 2026-09-22 (see "Deploy proof, 2026-09-22") | No | `App.tsx:388`; the only page already carrying a `check_windowed_figures.py` guard (CLAIMS `ADR-0086`) |
| `/notifications` | notifications | Mudavym | Yes — ADR 0149 row 36 | Yes (`NotificationsNext.tsx`) | ✓ `34c33a76a` (#421) | `9cfc4e96d` served 2026-09-22 (see "Deploy proof, 2026-09-22") | No | `App.tsx:389` |
| `/profile` | profile | Mudavym | Yes — ADR 0149 row 36 | Yes (`ProfileNext.tsx`) | ✓ `34c33a76a` (#421) | `9cfc4e96d` served 2026-09-22 (see "Deploy proof, 2026-09-22") | No | `App.tsx:391`. **Consequence of `connections` going live in the same merge:** Registers IV/V/VI (including the card-adding path, `StripeCardPanel.tsx`) leave `/profile` and move to `/connections` (`ProfileNext.tsx:344`; live-review.md minor 5) |
| `/connections` | connections | Mudavym | Yes — ADR 0149 row 36 | Yes (`ConnectionsNext.tsx`) | ✓ `34c33a76a` (#421) | `9cfc4e96d` served 2026-09-22 (see "Deploy proof, 2026-09-22") | No | `App.tsx:398`; a NEW surface (ADR 0114), not a redesign — legacy branch is a redirect to `/profile`, not a second design. **Consequence:** the sidebar now shows this entry to every role (`Sidebar.tsx:765`), but the route itself refuses anyone who is not a manager or owner (`ConnectionsNext.tsx:274-288`) — a member who taps it lands on a refusal page (live-review.md minor 5) |

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

## Held back — still flag-gated, per ADR 0149 row 36

| Route | Page | Design | Design locked? | Built on main? | Live for every house? | Deployed proof | Legacy deleted? | Notes |
|---|---|---|---|---|---|---|---|---|
| `/receiving` | receiving | Mudavym | No — sketch 107 review owed (ADR 0149 gated stops; row 23 P14) | Yes (`ReceivingNext.tsx`) | No | — | No | The receiving **desk**, not the door — do not confuse with `/receiving/:orderId/door` (live). `App.tsx:321` |
| `/wines` | cellar | Mudavym | No — sketch 110 review owed (ADR 0149 gated stops; row 21) | Yes (`CellarNext.tsx`) | No | — | No | `App.tsx:322` |
| `/cellar` | cellar | Mudavym | No — sketch 110 review owed | Yes (`CellarNext.tsx`) | No | — | No | Parent surface; legacy branch redirects to `/wines`. `App.tsx:327` |
| `/beer` | cellar | Mudavym | No — sketch 110 review owed | Yes (`CellarNext.tsx`) | No | — | No | `App.tsx:328` |
| `/whiskey` | cellar | Mudavym | No — sketch 110 review owed | Yes (`CellarNext.tsx`) | No | — | No | `App.tsx:329` |
| `/cocktails` | cellar | Mudavym | No — sketch 110 review owed | Yes (`CellarNext.tsx`) | No | — | No | `App.tsx:330` |
| `/spirits` | cellar | Mudavym | No — sketch 110 review owed | Yes (`CellarNext.tsx`) | No | — | No | `App.tsx:331` |
| `/non-alcoholic` | cellar | Mudavym | No — sketch 110 review owed | Yes (`CellarNext.tsx`) | No | — | No | May print as "Soft drinks" in an alcohol-free house (ADR 0149 row 24). `App.tsx:332` |
| `/soft-drinks` | cellar | Mudavym | No — sketch 110 review owed | Yes (`CellarNext.tsx`) | No | — | No | `App.tsx:333` |
| `/recommendations` | recommendations | Mudavym | No — 2-3 new directions owed (ADR 0149 row 21) | Yes (`RecommendationsNext.tsx`) | No | — | No | `App.tsx:335` |
| `/settings` | settings | Mudavym | No — sketch 109 review owed (ADR 0149 gated stops; row 21) | Yes (`SettingsNext.tsx`) | No | — | No | `App.tsx:390`; consent panel already deleted per row 14 |

## Improved in place — color-only switch, no redraw

| Route | Page | Design | Design locked? | Built on main? | Live for every house? | Deployed proof | Legacy deleted? | Notes |
|---|---|---|---|---|---|---|---|---|
| `/login` | — | improved in place | Yes — "improve in place, no redraw" (ADR 0133 §Decision 1, ADR 0143 §1) | Partial — `usePublicDesign()` wired (`Login.tsx`), switch OFF in production (`VITE_MUDAVYM_PUBLIC` unset, ADR 0149 context) | No | — | N/A — no separate legacy tree to delete | Flyleaf redraw asked 2026-09-17 (ADR 0149 row 35, sketch 118 first) — that supersedes "no redraw" and is not yet built |
| `/register` | — | improved in place | Yes — same switch as `/login` | Partial — `usePublicDesign()` wired (`Register.tsx`), switch OFF in production | No | — | N/A | `pages/__tests__/authPages.publicDesign.test.tsx` pins byte-for-byte parity when OFF |

## Legacy — no Mudavym work on main yet

| Route | Page | Design | Design locked? | Built on main? | Live for every house? | Deployed proof | Legacy deleted? | Notes |
|---|---|---|---|---|---|---|---|---|
| `/forgot-password` | — | legacy | No | No | No | — | N/A | One of ADR 0149's "seven public doors" with no build |
| `/reset-password` | — | legacy | No | No | No | — | N/A | ” |
| `/verify-email` | — | legacy | No | No | No | — | N/A | ” |
| `/invite/:code` | — | legacy | No — today's invite preview fields ratified (ADR 0149 row 7) but not landed | No | No | — | N/A | Codex work rescued to `codex-rescue-2026-09-16/`, outside the repo, not adopted |
| `/no-access` | — | legacy | No | No | No | — | N/A | ” |
| `/privacy` | — | legacy | No — readable-privacy treatment ratified (ADR 0149 row 7) but not landed | No | No | — | N/A | Same Codex-rescue gap as `/invite/:code` |
| `/v/:slug` | — | legacy | No — vendor board treatment ratified (ADR 0149 row 7) but not landed | No | No | — | N/A | ” |
| `/get-started` | — | legacy | No — tutorial-action-box improvement decided (ADR 0149 row 11) but not built | No | No | — | N/A | |
| `/onboarding` | — | legacy | No — permanent redirect to `/get-started` decided (ADR 0149 row 11) but not built; still a real page on main today | No | No | — | N/A | |
| `/authorize/:integrationId` | — | legacy | No — gateway-sealed disclosure decided (ADR 0149 row 16, ADR 0144) but not built | No | No | — | N/A | |
| `/vendor-prices` | — | legacy | No — sketch 112 review owed (ADR 0149 gated stops) | No | No | — | N/A | |
| `/promotions` | — | legacy | No — sketch 113 review owed (ADR 0149 gated stops) | No | No | — | N/A | |
| `/help` | — | legacy | No — sketch 111 review owed (ADR 0149 gated stops) | No | No | — | N/A | |
| `/recommendations/catalog` | — | legacy | No | No | No | — | N/A | Not in `MUDAVYM_PAGES` at all — ungated |
| `/sommelier` | — | legacy | No — superseded by `/ask` (ADR 0149 row 33, ADR 0145) | No | No | — | N/A | `/ask` itself has no route on main yet |

## Internal tools — deliberately outside the redesign

| Route | Page | Design | Design locked? | Built on main? | Live for every house? | Deployed proof | Legacy deleted? | Notes |
|---|---|---|---|---|---|---|---|---|
| `/studio` | — | internal tool | N/A — ADR 0143 §5 (waiting on the Codex-conversation check) | N/A | N/A | — | N/A | |
| `/studio/queue` | — | internal tool | N/A | N/A | N/A | — | N/A | |
| `/studio/certify` | — | internal tool | N/A | N/A | N/A | — | N/A | |
| `/studio/invite/:token` | — | internal tool | N/A | N/A | N/A | — | N/A | Deliberately not studio-role gated (invite grants the role) |
| `/simpos/:restaurantId` | — | internal tool | N/A — ADR 0149 row 4 ("SimPOS keep as-is") | N/A | N/A | — | N/A | `import.meta.env.PROD` redirects to `/` in production |
| `/simpos/:restaurantId/orders` | — | internal tool | N/A | N/A | N/A | — | N/A | Same PROD gate |
| `/simpos/:restaurantId/scenarios` | — | internal tool | N/A | N/A | N/A | — | N/A | Same PROD gate; ADR 0093 scenario harness |
| `/dev/truth` | — | internal tool | N/A — ADR 0143 §14 (stays as-is, deliberately) | N/A | N/A | — | N/A | Delete only when its own header comment's condition is met |
| `/admin` | — | internal tool | N/A — ADR 0149 row 10 (five local-only knobs to be removed, not yet done) | N/A | N/A | — | N/A | Owner-only, both sidebar and route (`requiredRole="owner"`) |
| `/admin/health` | — | internal tool | N/A | N/A | N/A | — | N/A | Owner-only |
| `/dev-sandbox` | — | internal tool | N/A — ADR 0143 §14 (stays as-is, deliberately) | N/A | N/A | — | N/A | Owner-only; zero network calls |

## Redirects — no page of their own

| Route | Design | Notes |
|---|---|---|
| `/inventory-legacy` | redirect → `/inventory` | ADR 0019 §B |
| `/distributors` | redirect → `/providers?tab=discover` | Discovery moved into Providers as a tab |
| `/calendar-classic` | redirect → `/calendar` | ADR 0019 §B |
| `/credits` | redirect → `/receipts?tab=credits` | |
| `/services` | redirect → `/settings?tab=services` | |
| `*` (catch-all) | redirect → `/` | |

## Total

61 routes = 16 live-on-merge + 11 held-back (4 page keys: `receiving`, `cellar` ×8, `recommendations`, `settings`) + 2 improved-in-place + 15 legacy + 11 internal tools + 6 redirects. Matches the route count ADR 0149 measured at `60ed83a7`.

## Deploy proof, 2026-09-22

Ticked by session effa5204 after it confirmed production is running a commit that contains
#421 (`34c33a76a`, the commit that added `LIVE_PAGES`), per this file's own instructions below.
The proof is not a liveness 200.

- **Which build is live:** GitHub's `Production – restaurant-ai-automation-web` deployment for
  `9cfc4e96d` (#424, main's tip, a descendant of `34c33a76a`) was created at
  2026-09-22T03:41:32Z. At the time of this check, mudavym.com served `assets/index-D5K27GuW.js`,
  replacing `index-d9AwRgRS.js`, #418's build.
- **The grep:** the served `index-D5K27GuW.js` (2,137,835 bytes) contains the `LIVE_PAGES` key
  list as one literal string. Only #421 added it: `"dashboard","orders","receiving_door",
  "providers","communications","team","inventory","receipts","documents_reports","document",
  "reports","calendar","profile","connections","notifications","logs"`.
- **Why it was late:** #421 merged 2026-09-21 but never deployed. The Vercel team was then on
  the free plan and hit its 100-a-day deployment cap, so production stayed on #418 until a deployment of main was created at 03:41:32Z. That came
  after the founder upgraded the team to Pro, by his own report on 2026-09-22; we did not see the
  billing change ourselves (ADR 0219, in review).
- **Route smoke check (curl, 2026-09-22):** HTTP 200 on `/`, `/orders`, `/receiving`,
  `/providers`, `/communications`, `/team`, `/inventory`, `/receipts`, `/documents`,
  `/reports`, `/calendar`, `/profile`, `/connections`, `/notifications`, `/logs`, `/login`;
  a real 404 on an unknown path. `/login` renders "Sign in · Mudavym" in a browser.
- **Not verified here:** what a signed-in house sees on each page. This session does not sign
  in, and entering credentials is not an agent's job. The `HouseHeader.test.tsx:407` spec is the
  in-code proof that a `LIVE_PAGES` page needs no flag row. "Legacy deleted?" stays `No`
  (ADR 0149: nothing is deleted before the founder approves the manifest, file group by file
  group).

## What "live for every house" ticks after this PR merges

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
