# 0190 — Three Codex lanes dropped: receiving/auth (B), inventory-overlay port (D), calendar-push port (H)

- **Status:** Proposed (agent-executed under the founder's standing rule — see Decision;
  this is not a fresh open fork, but the founder can supersede)
- **Date:** 2026-09-19
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent.
  This record applies the founder's already-stated Codex-adoption rule (per `MEMORY.md`'s
  own index paraphrase, Codex work lands only after an audit; the founder's verbatim words
  are "adopt it only if the quality baseline is great and align with our needs") to three
  audited lanes. It does not ask the founder to weigh a new judgment call, except the open
  founder questions listed under Consequences.
- **Keywords:** codex, codex-lane-b, codex-lane-d, codex-lane-h, wt-fin-b, wt-fin-d,
  wt-fin-h, adoption-audit, receiving, procurement, auth-rewrite, inventory-overlays,
  calendar-push, drop-not-adopt
- **Links:** [[0020-no-fabricated-answers]] (absence-reported-as-health, violated by D
  and H), [[0022-scheduled-jobs-serve-opted-in-tenants]] (violated by H's reconcile cron),
  [[0070-a-quantity-states-its-own-unit]] (lane B's D4 fork — see also `v3.0-TECH-DEBT.md:2161`),
  [[0111-the-calendar-is-the-houses-day-book]] (Fork D, unresolved, lane H),
  [[0112-one-modal-policy-three-shapes-one-primitive]] (F12 seal ceremony, violated by D),
  [[0117-a-price-sighting-names-its-source-its-date-and-its-unit]] (Q25 currency, violated
  by D), [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]]
  (the finish-goal this work was meant to serve), [[0162-managers-grant-manager-or-staff-on-both-doors]]
  (fourth addendum, answers lane B's auth founder question),
  [[0143-the-arrival-the-desk-the-sommelier-and-the-two-rooms]] (2026-09-12 founder answer,
  governs lane D's spot-count voice fork), PR #374 (overlay foundation, lane A — D's
  undelivered prerequisite), PR #392 / PR #393 (auth work lane B's rewrite conflicts with)

**Index row:** not added to `decisions/README.md` here, following [[0162-managers-grant-manager-or-staff-on-both-doors]]'s
own note — that file is gate-owned and its row goes in a separate pass.

## Context

The founder's standing rule for this session's Codex-lane adoption audit: *"adopt it only
if the quality baseline is great and align with our needs"*, and Codex work lands only
after an audit (`mudavym-finish-goal-2026-09-16.md`). Three packets of that audit are
covered here — lanes **B**, **D** and **H** — each staged uncommitted in its own worktree
(`wt-fin-B`, `wt-fin-D`, `wt-fin-H`), each independently run through a dedicated
judge-then-adversarial-confirm audit workflow, then re-derived directly (not taken on the
audit's word alone) by an Opus last-call pass this session. That pass's three verdicts are
recorded verbatim in
`/private/tmp/claude-501/-Users-aldemirkonuk-Projects-restaurant-ai-automation/7d72f5cf-5e60-4e61-8521-469276f54e7f/scratchpad/r4-drops.json`
(keys `"B"`, `"D"`, `"H"`); this ADR is the durable record that json was always going to
become.

**One complication, specific to lane D.** Its own audit trail already produced a
full draft of this ADR, left uncommitted in `wt-fin-D`'s working tree at
`.planning/decisions/0168-codex-lane-d-inventory-overlay-port-dropped.md` (read directly
by this session; that file is untouched and stays exactly where it is — it was never
committed and this task does not commit it). The Opus verdict reviewed that draft against
the underlying audit artifacts and found its **decision sound** but its **text wrong in
six places** — a stale defect count, an overclaim about whose files the 47 staged paths
are, a stale numbering caveat, missing recovery-ref citations, an overstated
"no risk" consequence, and two of its eight open forks already answered elsewhere. This
record folds in the corrected version rather than lane D's own draft; the corrections are
listed under Lane D below and their sourcing is in Evidence trail.

## Options considered

1. **Adopt as-is.** Fastest, but ships the defects/violations below verbatim — a
   reproduced production-data-corruption bug in D, a house-wide `/calendar` 503 in H, and
   real-money/integer defects plus an auth rewrite that conflicts with landed PRs in B.
   Rejected for all three once the dedicated audits existed.
2. **Adopt after fixing in place.** Costed and rejected for each: B's fixes need a founder
   ruling on the `quantity_received` unit fork first (fixing around an unanswered fork gets
   rewritten once it's answered) and its auth rewrite would need a rebase onto #392/#393
   that hasn't been attempted; D depends on an unlanded prerequisite (lane A's async,
   server-challenged `HoldToApprove`) so it cannot be fixed alone even if every defect were
   patched; H's core read-path bug (B1, below) needs a real fix and a spec before anything
   built on top of it is trustworthy, and two policy violations (M1, M2) need founder
   rulings first. This is the option the founder's bar exists to prevent — patching a
   lane that scored badly to look green, instead of building to the bar directly.
3. **Drop; leave each worktree exactly as found; record why and where the work is kept.**
   Chosen for all three. Nothing is lost from this machine's clone — each lane's full diff
   is preserved byte-for-byte at a snapshot ref (below; local-only unless pushed — see the
   Decision table), and the requirements each lane surfaced are carried forward as open
   founder questions instead of being rediscovered later.
4. *(Saying nothing.)* Costs the most: a census/first-pass claim (D's ADOPT, H's green
   tests) would stand as the only recorded verdict, and a later session merging on that
   alone would ship the money-corruption bug in D or the `/calendar` outage in H.

## Decision

**Drop all three.** Nothing from `wt-fin-B`, `wt-fin-D` or `wt-fin-H` is merged, adopted,
or fixed in place. Each worktree is left exactly as found — nothing stashed (a shared
`refs/stash` stack sits across every worktree on this machine, so nothing was risked
there), nothing merged forward onto `origin/main`. Each lane's work is kept byte-for-byte
at its own snapshot ref, taken 2026-09-18 23:22:23 -0400 against the same parent
(`60ed83a7e`) across all three lanes, independently re-verified by this session via
`git show --stat` rather than copied from any prior report:

| Lane | Snapshot ref | Commit | Files | Diff | Remote |
|---|---|---|---|---|---|
| B | `refs/snapshots/wt-fin-B/20260919T0325` | `b266a70d` | 43 | +2089 / -561 | local-only |
| D | `refs/snapshots/wt-fin-D/20260919T0325` | `10094f59` | 47 | +9129 / -126 | local-only |
| H | `refs/snapshots/wt-fin-H/20260919T0325` | `7ace83c7` | 30 | +4816 / -24 | local-only |

**All three snapshot refs are local-only, and so are the `refs/lane-sync/*` copies named
per lane below** — confirmed this session: `git ls-remote origin 'refs/snapshots/*'
'refs/lane-sync/*' 'refs/heads/reserve/*'` returns nothing, while `git ls-remote origin
refs/heads/main` resolves. This work is safe only while this machine's clone exists,
unless the orchestrator pushes these refs to `origin`.

(B and D's file/diff counts match the prior audit reports' own re-measured figures; H's
insertion/deletion counts were not stated in the prior verdict and are newly measured here
by this session.)

### Lane B — receiving/procurement fixes + an `auth.service.ts` rewrite

**What it tried:** a set of fixes to the receiving/procurement flow in
`procurement.service.ts` (delivery marking, accepted-quantity handling, delivery
notification copy), plus an unrelated rewrite of `auth.service.ts`.

**Why dropped, with evidence:**
- **D4 — silently picked a side of an open founder fork.** `procurement_orders.quantity_received`
  is one `integer` column that different callers treat as either the order's own unit or
  as bottles; `.planning/v3.0-TECH-DEBT.md:2161` reads, verified directly by this session,
  *"LIVE DEFECT. Not repaired — the repair is a founder decision, stated below."* The
  lane's diff never touches that entry, i.e. it built receiving code without asking. This
  is why lane B's founder question below cannot be answered by this session either.
- **D1, D5, D6 — real-money and integer-column defects in `procurement.service.ts`**,
  confirmed by the audit's own direct reads (not independently re-derived line-by-line by
  this session, which instead confirmed the file's shape: `final_price`, `bottlesPerUnit`
  and `accepted_quantity` handling are all live in that file at the cited region). D1: the
  pre-read on `markDelivered` omits `final_price`, so a legacy order books a lot with a
  null unit cost. D5: when no accepted count is given, a non-integer
  (`bottles / bottlesPerUnit`) is written into the integer `accepted_quantity` /
  `quantity_received` columns. D6: the delivery notification names the order's own unit
  count where it should give the bottle count.
- **D2/D3 — the `auth.service.ts` rewrite conflicts with #392 and #393 on `main`**, which
  landed the invite-role-ceiling and owner-removal fixes recorded in
  [[0162-managers-grant-manager-or-staff-on-both-doors]] after this lane's worktree was cut.
- **A prior, independent audit already scored this lane REJECT at 6** for the same two
  root causes, named at `mudavym-finish-goal-2026-09-16.md:130-131`: it "silently decided
  the quantity_received fork + staff floor app-wide" — the quantity_received half is D4
  above; the staff-floor half is not among this ADR's own reasons.
- **`refs/lane-sync/wt-fin-E/20260919T041635Z` carries byte-identical copies of 11 of
  this lane's 13 new files**, confirmed by blob hash this session; two differ —
  `apps/mobile/src/api/__tests__/accountBoundary.test.ts` and
  `apps/mobile/src/state/__tests__/outbox.test.ts`. Lane E's own audit must reach the
  same D1/D4/D5/D6 conclusions before any of that content is adopted from lane E.
- **One correction to the underlying audit report, applied here:** its auth founder
  question is mostly already answered. [[0162-managers-grant-manager-or-staff-on-both-doors]]'s
  fourth addendum (2026-09-18, confirmed at that file's line 459) records the founder's
  *"Membership only"* answer for the adjacent sessions question; the specific
  503-vs-401-on-a-deleted-user and `/organizations/branches` scoping fixes this lane's
  question refers to still need building, but as the ADR 0162 follow-up to #393, not by
  reviving this lane.

**Snapshot ref:** `refs/snapshots/wt-fin-B/20260919T0325` (`b266a70d`, 43 files,
+2089/-561 — see table above; local-only, not on `origin`). Also present, same content:
`refs/lane-sync/wt-fin-B/20260919T041244Z` (also local-only).

### Lane D — inventory-overlay port (Codex's port of `wt-port-ov1`)

**What it tried:** Codex's port of Claude's `wt-port-ov1` source — "Overlay packet 1
(inventory overlays)" — 47 files touching the `/inventory` page's Add/Remove-wine
modals, the POS mapping panel, the storage-location manager, the receipt workspace, the
menu scanner, branch transfer and a consent dialog.

**Why dropped, with evidence:** a dedicated audit workflow (`wf_3cd8422b-f6b`, judge pass
`codex-audit/D-judge.md`, adversarial confirm pass `codex-audit/D-confirm.md`) scored the
lane **5, REJECT**, with **17 defects, 12 of them major** (`D-judge.md:11` — the lane's
own draft misstated this as "7 of 17"; corrected here). The confirm pass reproduced 3
defects with real-keystroke probes. This session re-derived two of the most load-bearing
ones directly against the snapshot ref rather than taking the audit's word:
- **Cost-field corruption, reproduced independently.** `AddWineToInventoryModal.tsx`'s
  Carry-sheet cost input binds `value={costPerBottle === null ? "" : String(costPerBottle)}`
  with `onChange={(e) => setCostPerBottle(... Number(e.target.value))}` (confirmed by this
  session at that exact code, `refs/snapshots/wt-fin-D/20260919T0325`). Because state holds
  a JS `number`, not the raw string, a trailing decimal point is dropped on every render
  (`Number("12.")` is `12`), so typing `12.50` keystroke-by-keystroke lands `1250` in
  `costPerBottle`, corrupting average cost.
- **Locked-ADR currency violation, reproduced independently.** `pages/inventory/command/bits.tsx:9-10`
  hard-codes `` `$${Math.round(n).toLocaleString()}` `` in `fmtMoney` (confirmed by this
  session, exact line, at the snapshot ref); `RemoveFromInventoryModal.tsx` uses this
  `fmtMoney` for the write-off's sealed dollar figure. [[0117-a-price-sighting-names-its-source-its-date-and-its-unit]]
  Q25 already answered this (use `lib/mudavym/format.ts`'s currency-aware `fmtMoney`,
  confirmed present at that ADR's line 1553); this lane doesn't call it.
- **False completion copy** (`RemoveFromInventoryModal.tsx:241-244`, per the judge/confirm
  pair, not independently re-derived by this session): claims "gone from the book" and
  "two ledger entries" unconditionally, even when retirement performs only an `is_active`
  update, not a ledger write.
- **Two further locked-ADR violations**, cited by the judge with file:line and not
  disputed by the confirmer, not independently re-derived here: no server-minted challenge
  on the write-off seal (ADR 0112 F12), and absence reported as health in
  `PosMappingPanel.tsx` (ADR 0020).
- **Blocks the goal this lane was meant to serve.** [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]]
  requires finishing a page fully before legacy can be deleted; `/inventory`'s Add path
  still runs through three legacy components after this lane, so legacy could not be
  retired regardless of code quality.
- **Depends on an unlanded prerequisite.** Lane A's async, server-challenged
  `HoldToApprove` (PR #374) is not on `origin/main`; this lane's seals are only honest once
  that lands underneath them.
- **Green gates were not evidence here** (web tsc/eslint, vitest 436/436, guards,
  `check_decision_claims.sh` 335/335 all passed on this lane) — per the judge, the house
  tests mock the label/menu readers down to bare divs and fire whole-value `change`
  events, which structurally cannot exercise the keystroke-level cost-field bug above.

**Corrections applied to the superseded draft in `wt-fin-D`, per the Opus review of it:**
1. Defect count corrected to 17 total / **12** major (was "7 of 17").
2. The 47 staged paths in that worktree are **lane A's 19 plus lane D's 28**
   (`D-confirm.md:4`); this ADR drops only lane D's 28 and does not decide lane A
   (that is PR #374's own question).
3. The draft's "0168 is provisional, renumber on collision" paragraph is stale; see
   Evidence trail below for what the numbering guard actually reported this session.
4. Every `wt-fin-D` file:line citation above is anchored to `refs/snapshots/wt-fin-D/20260919T0325`
   (`10094f59`, local-only, not pushed) as its recovery point, not to the ephemeral
   `/private/tmp` or `~/.claude` paths the draft cited.
5. **Two of the defects above are not risks avoided by dropping — they are already on
   `origin/main` today**, independently confirmed by this session in the current
   `wt-drops` checkout: `pages/inventory/command/bits.tsx:9-10`'s hard-coded `$`, imported by
   `RemoveFromInventoryModal.tsx:21` (both lines confirmed), and the non-UUID
   `` id: `WINE_${Date.now()}` `` fire-and-forget add at `AddWineToInventoryModal.tsx:210`
   (confirmed). These are pre-existing residuals, not this lane's introduction; they are
   not currently tracked as an open item anywhere, and `v3.0-TECH-DEBT.md` remains the
   live defect register (CLAUDE.md:130), not a retired one. They are named in full under
   Consequences below, as residual defects that survive the drop either way.
6. Of the draft's eight open forks, **four are already answered or governed elsewhere**
   and are not carried forward as open items below: F13/consent — *"consent panel = delete
   and say so on /settings"* (confirmed at `mudavym-finish-goal-2026-09-16.md:61`); the
   write-off/spot-count seal — already governed by locked [[0112-one-modal-policy-three-shapes-one-primitive]]
   F12 (confirmed Locked, ratified 2026-09-05; F12 "closed" per that file), which requires
   a server-minted challenge for exactly this kind of ceremony, so no new founder ruling is
   needed, only the build; receipt scope at full width — already settled by
   [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]]'s
   full-purpose bar, which does not allow a narrower partial port; and spot-count's
   floor-count voice input — already covered by [[0143-the-arrival-the-desk-the-sommelier-and-the-two-rooms]]'s
   founder answer of 2026-09-12 (that file's lines 236-244: recognition is "the browser's
   own speech recognition ... the same recognition `SpotCountPanel.tsx:84-86` already
   uses"), so spot-count already runs the rule's own on-device mechanism rather than
   departing from it — no new founder ruling needed there either. The four remaining
   forks are genuinely open and are listed under Consequences.

**Snapshot ref:** `refs/snapshots/wt-fin-D/20260919T0325` (`10094f59`, 47 files,
+9129/-126 — see table above; matches the draft's own figure, independently re-measured;
local-only, not on `origin`).

### Lane H — Google Calendar push port

**What it tried:** a port connecting recurring-order delivery dates and a house's
`/calendar` to a connected Google account, with a push-and-reconcile sync
(`calendar-push.service.ts`, `calendar-push-reconcile.service.ts`, migration
`20260913190200_calendar_push_delivery_book.sql`), gated by `CALENDAR_PUSH_ENABLED`.

**Why dropped, with evidence:**
- **B1 — a real, independently reproduced outage path.** `recurring-orders.service.ts`
  writes `calendar_events` rows with `is_recurring: true` and no recurrence rule
  (confirmed by this session at the snapshot ref, e.g. the row built around line 1018:
  `is_recurring: true` with no `recurrence_rule_id` set). This session traced
  `calendar-occurrences.ts`'s branching independently: the safe single-occurrence path
  only applies when `!parent.is_recurring`, so a row with `is_recurring: true` and zero
  owned rules instead falls to `ownedRules.length !== 1` → `return failure('missing_rule', ...)`.
  `calendar.service.ts:344` turns that failure into a 503 for the *whole* `/calendar`
  window — so one ordinary recurring-order delivery row, which `main` already writes
  today, takes down a house's entire calendar page regardless of whether the push flag is
  on. [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]] names
  `/calendar` a quality-bar page.
- **M1 — a policy violation.** `calendar-push-reconcile.service.ts` runs its own `@Cron`
  outside `ScheduledTenantsService.runPerTenant`. [[0022-scheduled-jobs-serve-opted-in-tenants]],
  confirmed directly by this session, states *"Nothing else is exempt"* immediately after
  naming the two NWS weather reads as the only exemption; a code comment arguing its own
  exemption is not the founder's amendment.
- **M2 — silently decides an open founder fork.** `calendar-push.service.ts:792` picks
  "the earliest connected Google grant of any house member" for the push target. This
  session confirmed [[0111-the-calendar-is-the-houses-day-book]] still lists this
  question as its one unresolved fork (**Fork D — "Whose calendar. A connection is per
  user ... but the day-book is per restaurant. When a manager leaves, whose Google
  calendar was the house's?"**, that ADR's own forks table, `Status` still reads
  "Proposed ... five of the six forks" answered, D is not among them).
- **No record kept.** No ADR 0111 slice update, no `CLAIMS.jsonl` rows for roughly 4,800
  lines — a build of this size left no durable trail per CLAUDE.md §0.2/§0.4.
- **Green tests are not evidence here either.** jest 124/124, vitest 72/72, both `tsc`
  clean — but per the judge, no test in the lane covers the exact recurring-order row
  shape `main` already writes, which is precisely what B1 needs and does not have.
- **M3–M8** (from `H-judge.md`, not independently re-derived by this session): dismissed
  entries reported to Google as confirmed; a transient network error marks a Google grant
  as needing reconnection; failure states wedge a house's push with no recovery path; the
  reconcile sweep can starve healthy entries behind an ever-growing append-only log; Google
  calls run synchronously inside the request; the migration blocks tenant deletion, carries
  a dead trigger and no-op `ALTER`s.

**Snapshot ref:** `refs/snapshots/wt-fin-H/20260919T0325` (`7ace83c7`, 30 files,
+4816/-24 — see table above; file count matches the prior verdict's "30 staged files",
the insertion/deletion counts are newly measured by this session; local-only, not on
`origin`).

## Consequences

- **Easier / safer:** nothing from B, D or H reaches `origin/main` this round. In
  particular, `/calendar` does not gain a whole-house 503 trigger (H), no seal ships
  without ADR 0112's server challenge (D), and no receiving code silently resolves the
  open `quantity_received` fork (B).
- **Residual defects already on origin/main (not lane D's, they survive the drop):**
  dropping lane D neither introduces nor removes these; they were true before this ADR
  and remain true after it.
  - (a) `apps/web/src/pages/inventory/command/bits.tsx:9-10`: `fmtMoney` hard-codes `$`,
    imported by `RemoveFromInventoryModal.tsx:21`. Against [[0117-a-price-sighting-names-its-source-its-date-and-its-unit]]
    Q25; already counted in `scripts/money_currency_baseline.json:37` (2 sites).
  - (b) `apps/web/src/components/inventory/AddWineToInventoryModal.tsx:210`: the
    non-UUID `` id: `WINE_${Date.now()}` `` fire-and-forget add, tracked nowhere else.
- **Harder / given up, per lane:**
  - **B:** the receiving/procurement fixes and the auth rewrite have to be rebuilt from
    current `main`. The auth half should build only as the [[0162-managers-grant-manager-or-staff-on-both-doors]]
    follow-up to #393. `refs/lane-sync/wt-fin-E/20260919T041635Z` should be checked first
    since it holds near-identical content and may already resolve the overlap.
  - **D:** the inventory-overlay UI has to be built again from a clean branch off current
    `main`, after lane A (PR #374) lands, re-deriving test coverage rather than reusing
    this lane's `*.house.test.tsx` files (which the audit's D16 finds "stop at the
    mocks").
  - **H:** a re-land should start from `origin/feat/connect-calendar-push`, fix
    `calendar-occurrences.ts`'s handling of an `is_recurring`-true / no-rule row (with a
    spec using that exact shape) before anything else, and route the reconcile job through
    `ScheduledTenantsService.runPerTenant` unless the founder amends ADR 0022 to name it.
- **What would trigger revisiting this record:** for each lane, a from-scratch rebuild
  (Claude branch, off current `main`, B after #392/#393-era auth work is accounted for, D
  after lane A lands) that fixes every defect named above, gets founder rulings on the
  open questions below, and clears a fresh audit with reproducible probes — not merely
  green `tsc`/`eslint`/`vitest`/guards, which two of these three lanes already had.

### Open founder questions (no `OPEN-DECISIONS.md` rows filed — per this task's numbering
reservation, OD rows for this session belong to other lanes; these are recorded here so
the next attempt at each lane starts from them)

**Lane B (2, neither previously answered):**
1. Which unit should `procurement_orders.quantity_received` hold — the order's own unit,
   always bottles, or a widened numeric column? *(`.planning/v3.0-TECH-DEBT.md:2161`,
   tied to ADR 0070.)* No lean recorded upstream: guessing this, not which side was
   guessed, is what made lane B's diff wrong. **Recommendation: do not default it here
   either — this needs the founder's word before anyone rebuilds receiving.**
2. Should any low-risk pieces of lane B (e.g. the logs cross-house filter, the web
   dashboard month-cache fix) be rescued as their own small PRs, or left dropped since
   lane E carries near-identical content? **Recommendation: leave dropped, let lane E's
   own audit decide the overlapping pieces, and rescue from B only what E does not carry**
   — rescuing from both would audit the same code twice.

**Lane D (4 of the original 8 forks; the other 4 are answered/governed — see Lane D
corrections above):**
1. May a menu scan write stock quantities, and if so at what default, and must the result
   be an editable proposal a person confirms rather than a direct write? (Lane D silently
   wrote a default of 6.) **Recommendation: proposal, not write** — no one has signed off
   on any default.
2. Should `/inventory`'s Carry sheet and `/cellar`'s menu-scan carry be one shared sheet or
   two? (Lane D built two.) **Recommendation: one sheet** — two evolving independently is
   the drift [[0112-one-modal-policy-three-shapes-one-primitive]]'s one-primitive policy
   exists to prevent.
3. What decides whether a storage zone is occupied — `wine_location_mappings`, lot
   locations, or both — and should the server refuse to delete an occupied zone?
   **Recommendation: both, checked server-side** — today's delete is an unconditional
   soft-delete and the lane's own client-side check ran even after its read had failed.
4. Should a write-off (reconcile to zero, retire the row, record the reason) be one atomic
   server transaction instead of separate client calls? **Recommendation: one atomic
   server endpoint** — two client calls produced the lane's false "gone from the book"
   readback.

**Lane H (3; the first two are `blocks_ready`, i.e. a re-land cannot proceed without an
answer):**
1. Should the Google Calendar push reconcile job get an [[0022-scheduled-jobs-serve-opted-in-tenants]]
   exemption alongside the two NWS reads, or route through `runPerTenant` like everything
   else that reaches outside the house? **Recommendation: no exemption — route through
   `runPerTenant`.** Not answered; ADR 0022's 2026-09-04 amendment names only the two NWS
   reads.
2. [[0111-the-calendar-is-the-houses-day-book]] Fork D: when several members of a house
   have connected Google, whose account receives the house's calendar push?
   **Recommendation: the owner's (or active-role member's) grant, named in the UI** — so a
   second member's consent is never silently unused and it stays clear whose calendar
   holds the copies if that person leaves. Not answered; ADR 0111's Status still lists
   Fork D as its one open fork.
3. While `CALENDAR_PUSH_ENABLED` is off, should `/connections` still offer "Connect a
   Google account" for calendar push? **Recommendation: hide it while the flag is off** —
   asking for consent to a feature that does nothing yet costs trust for no gain. Not
   answered; lower priority, only matters once calendar push is rebuilt.

## Evidence trail

- **Opus last-call verdicts (source of this record):**
  `/private/tmp/claude-501/-Users-aldemirkonuk-Projects-restaurant-ai-automation/7d72f5cf-5e60-4e61-8521-469276f54e7f/scratchpad/r4-drops.json`,
  keys `"B"`, `"D"`, `"H"` — each a DROP/REJECT verdict this session's Opus pass re-derived
  directly against the worktree and audit artifacts rather than taking a prior report on
  its word.
- **Lane D's superseded draft** (read-only, untouched, never committed):
  `/Users/aldemirkonuk/Projects/wt-fin-D/.planning/decisions/0168-codex-lane-d-inventory-overlay-port-dropped.md`.
  Its underlying audit: workflow `wf_3cd8422b-f6b`, `codex-audit/D-judge.md` (quality score
  5, REJECT, 17 defects / 12 major, 8 forks), `codex-audit/D-confirm.md` (reproduced 3
  defects, independently confirmed the rest), both under
  `/private/tmp/claude-501/-Users-aldemirkonuk-Projects-restaurant-ai-automation/effa5204-969b-42c5-a68e-f013d4f92d0d/scratchpad/codex-audit/`
  per that draft (session-local, not re-verified present by this session — flagged as
  ephemeral per the draft's own correction #4 above).
- **Snapshot refs, independently verified present and re-measured this session**
  (`git rev-parse --verify` + `git show --stat`, not copied from any prior report):
  `refs/snapshots/wt-fin-B/20260919T0325` = `b266a70d` (43 files, +2089/-561),
  `refs/snapshots/wt-fin-D/20260919T0325` = `10094f59` (47 files, +9129/-126),
  `refs/snapshots/wt-fin-H/20260919T0325` = `7ace83c7` (30 files, +4816/-24) — all three
  parented on `60ed83a7e`, timestamped 2026-09-18 23:22:23 -0400. **All are local-only:**
  `git ls-remote origin 'refs/snapshots/*' 'refs/lane-sync/*' 'refs/heads/reserve/*'`
  returns nothing, while `git ls-remote origin refs/heads/main` resolves — confirmed this
  session.
- **Code citations this session re-derived directly** (not taken only on an audit's word),
  each read from the cited ref, not from a working tree outside this lane:
  `bits.tsx:9-10` (`refs/snapshots/wt-fin-D/20260919T0325` and, identically, current
  `origin/main` in this `wt-drops` checkout); `RemoveFromInventoryModal.tsx:21` (current
  `origin/main`); `AddWineToInventoryModal.tsx:210` (current `origin/main`);
  `AddWineToInventoryModal.tsx`'s Carry-sheet cost input (`refs/snapshots/wt-fin-D/20260919T0325`);
  `calendar-occurrences.ts`'s branching and `recurring-orders.service.ts`'s
  `is_recurring: true` write (`refs/snapshots/wt-fin-H/20260919T0325`);
  `procurement.service.ts`'s `final_price`/`bottlesPerUnit`/`accepted_quantity` handling,
  shape only (`refs/snapshots/wt-fin-B/20260919T0325`); `.planning/v3.0-TECH-DEBT.md:2161`;
  `.planning/decisions/0022-scheduled-jobs-serve-opted-in-tenants.md` ("Nothing else is
  exempt"); `.planning/decisions/0111-the-calendar-is-the-houses-day-book.md` (Fork D,
  forks table and Status); `.planning/decisions/0112-one-modal-policy-three-shapes-one-primitive.md`
  (F12, Locked, closed); `.planning/decisions/0117-a-price-sighting-names-its-source-its-date-and-its-unit.md`
  (Q25, line 1553); `.planning/decisions/0162-managers-grant-manager-or-staff-on-both-doors.md`
  (fourth addendum, line 459); `/Users/aldemirkonuk/.claude/projects/-Users-aldemirkonuk-Projects-restaurant-ai-automation/memory/mudavym-finish-goal-2026-09-16.md:61`
  (F13 consent answer).
- **What this session did NOT independently re-derive**, stated plainly per CLAUDE.md
  §0.5: the full defect lists (D's remaining 14 of 17, H's M3–M8, B's D1/D5/D6's exact
  line-level mechanics) rest on the cited judge/confirm audit workflows for each lane; this
  session spot-checked the single most load-bearing claim per lane and the corrections
  applied to lane D's draft, not every citation in every verdict. No `tsc`/`jest`/`vitest`
  was re-run for any of the three lanes, because no code from any of them is being adopted.
  No production queries were re-run by this session for any of the three lanes; where a
  verdict cites a production measurement, it rests on that verdict's own prior work, not on
  a fresh query here.
- **ADR-numbering guard, run three times across this session as the file was edited.**
  The verdict ("nothing to check," "no collisions") held every time; the swept ref count
  and the reported next-free number moved between runs — 926/0170, then 926/0170 again,
  then **927/0171** on the final run below — because other lanes are pushing refs
  concurrently while this session works, exactly the race the guard's own docstring
  describes. The final, most-current run:
  ```
  $ python3 scripts/check_adr_numbers_unique.py
  No ADR numbers introduced by this ref. Nothing to check.
  Next free number, swept across 927 refs: 0171

  $ python3 scripts/check_citation_pairing.py
  == Citation pairing: 178 register citations checked against 119 rows
  PASS — every register citation names the row it points at.
  ```
  (`--audit` on the middle run reported: `AUDIT: no ADR number collisions across 926
  refs. Next free number: 0170` — also clean.)
  **Why this is not the collision this task's briefing anticipated, reported plainly
  rather than worked around:** the guard's default mode reads `git ls-files` for "what
  this ref has" — tracked/staged files only. This file is deliberately untracked (house
  rule: stage nothing; the orchestrator commits through a verified index), so the guard
  cannot see it yet and correctly has nothing to compare. Separately, `refs/heads/reserve/adr-0164-0167`
  (`1af3907a`) was inspected directly by this session before running the guard: contrary to
  this task's briefing (which described that reserve branch as still carrying lane D's slug
  for 0168), its current tip already carries this file's exact slug,
  `0168-three-codex-lanes-dropped.md`, alongside `0169-the-ground-is-white-by-default-and-each-person-chooses.md`
  — its own last commit message reads *"reserve: 0168 is the three-lane Codex drop record;
  0169 the theme decision."* That reservation was evidently updated by another session
  between when this task was written and when this session ran the check, which is also why
  `--audit` finds zero collisions across all 926 committed refs. Neither finding was
  produced by this session working around anything; both are the tool's own output, read
  straight. **What this session could not verify:** whether this exact file, once staged,
  will compare clean against that reservation — that comparison needs the file in the
  index, which is the orchestrator's step, not this lane's.

  **Round 5 update (2026-09-21): that comparison has now run, with this file committed at
  `HEAD` (`ab0f94030`) — and it is not clean.** `check_adr_numbers_unique.py` (re-run twice,
  stable both times) now reports:
  ```
  COLLISION: ADR 0168 names more than one decision.
    this ref:  .planning/decisions/0168-three-codex-lanes-dropped.md
    elsewhere: .planning/decisions/0168-codex-lane-d-inventory-overlay-port-dropped.md
               on origin/wip/2026-09-19/others/wt-fin-D
    Next free number, swept across every ref: 0183
  ```
  This is not this ADR's number colliding with a live rival decision. The reservation
  commit above (`1af3907a`, 2026-09-19 10:46:38 -0400 — earlier than either snapshot)
  already retired that exact filename in favor of this one: its diff removes
  `0168-codex-lane-d-inventory-overlay-port-dropped.md` and adds
  `0168-three-codex-lanes-dropped.md`, one line each, confirmed by this session via
  `git show --stat`. The `others/wt-fin-D` branch was created later that day
  (`fdb3cd368`, 2026-09-19 14:14:16 -0400, message *"uncommitted work of another session,
  snapshotted 2026-09-19, NOT for merge"*) by a broader snapshot sweep unrelated to this
  lane, which preserved `wt-fin-D`'s still-dirty working tree byte-for-byte — including a
  file the 10:46 reservation had already superseded 3.5 hours earlier, because nothing
  inside that worktree itself was ever edited to match the reservation. **Not fixed
  here:** renaming either file is outside this round's 5 must-fix items, and the
  colliding copy lives on a different worktree's snapshot branch — marked "NOT for
  merge," fetched and inspected read-only, never checked out or pushed to — which this
  lane has no authority to rewrite. Reported per CLAUDE.md §5b rather than worked around
  or silently left stale.

  **Round 6 update (2026-09-21): this file renamed to 0190, the stale snapshot left
  untouched.** Round 5 ruled correctly that path (a) — deleting or rewriting
  `origin/wip/2026-09-19/others/wt-fin-D` — needs authority over a branch no lane here
  owns, and this lane has no more push access than round 5 did. That leaves path (b),
  which is within this lane's own worktree: renumber this file, since a stale,
  explicitly "NOT for merge" snapshot is the weaker claimant on the evidence already
  gathered above (the 10:46:38 reservation commit predates the 14:14:16 snapshot by 3.5
  hours, and neither slug is cited anywhere outside this ADR — reconfirmed this round by
  `grep -rn "0168" .` across the full working tree, zero hits outside this file before
  the rename). Immediately before renaming, `scripts/check_adr_numbers_unique.py` was
  re-run fresh (`git fetch origin '+refs/heads/*:refs/remotes/origin/*'` first) to
  minimize the window a concurrent push could land in: still 0168 vs the same
  `wt-fin-D` snapshot, next-free still **0183**. Per this lane's brief, the tightest
  free number was deliberately not taken — round 6 is running alongside 11 sibling
  lanes and a separately-noted peer session also minting an ADR number concurrently, so
  0183 itself is contended air. A direct sweep of every visible ref
  (`git for-each-ref refs/remotes/origin refs/heads`, filtered to
  `.planning/decisions/01[7-9][0-9]-*.md`) found the claimed range stops at **0182**
  (`feat/jev-prompt-gate`) with 0178–0181 held by `docs/endpoint-universe-plan` and nothing
  at all between 0183 and 0199 on any ref — so **0190** was taken: a gap of 7 past the
  measured next-free, comfortably clear of the contended 0178–0182 cluster, still zero
  collision risk against anything currently visible. `git mv
  0168-three-codex-lanes-dropped.md 0190-three-codex-lanes-dropped.md` (history-preserving
  rename) plus this file's own H1. No other file in the tree cited the old number (the
  `grep` above), and `.planning/decisions/README.md` carries no index row for this ADR to
  move — confirmed absent, not overlooked. Re-run after the rename:
  ```
  $ python3 scripts/check_adr_numbers_unique.py
  OK -- introduced by this ref: 0190 (three-codex-lanes-dropped)
  Checked against 1051 refs. No number wears two slugs.
  ```
  Exit code 0, measured directly. The stale `wt-fin-D` snapshot still carries its own
  `0168-codex-lane-d-inventory-overlay-port-dropped.md` untouched — nothing on that
  branch was read from, checked out, or written to — so if a future session ever has
  authority to clean up that "NOT for merge" branch, the number it frees is simply
  available again; nothing here depends on that happening.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-19 | Opus, fan-out verdicts (`r4-drops.json`) | DROP/REJECT independently re-derived for B, D and H against each worktree and its audit artifacts; 6 corrections specified for lane D's own draft |
| 2026-09-19 | Claude (Sonnet 5), lane "drops" | Created this consolidated record; applied lane D's 6 corrections; independently re-verified snapshot refs, the reserve-branch state, and one load-bearing code citation per lane |
| 2026-09-21 | Claude (Sonnet 5), lane "drops", round 5 | Closed round 4's 5 must-fix text items: named the two residual on-`main` defects under Consequences instead of a false "listed elsewhere/retired" claim; folded the spot-count voice fork into correction 6 as ADR 0143-governed (fork counts 3→4 answered, 5→4 open); fixed `bits.tsx:9`→`9-10` (×3), `D-confirm.md:6`→`4`, named lane B's two root causes, and the exact 11-of-13 byte-identical file split with lane E; marked every snapshot/lane-sync ref local-only in the Decision table, each lane's Snapshot ref line, and Evidence trail, with the `git ls-remote` proof; unquoted "Codex work only after audit" as `MEMORY.md`'s paraphrase, not the founder's words. Found and correctly declined to fix (no authority over the colliding branch): the ADR-0168 number collision against `origin/wip/2026-09-19/others/wt-fin-D`. |
| 2026-09-21 | Claude (Sonnet 5), lane "drops", round 6 | Closed round 5's 1 must-fix item: renumbered this file 0168→0190 (`git mv`, H1, this row) rather than touching the colliding branch, which remains outside this lane's authority exactly as round 5 found; number chosen as a deliberate gap past the freshly re-measured next-free (0183), not the tightest free number, per this round's contested-numbers rule. `check_adr_numbers_unique.py` exit 0 after, quoted above. |
