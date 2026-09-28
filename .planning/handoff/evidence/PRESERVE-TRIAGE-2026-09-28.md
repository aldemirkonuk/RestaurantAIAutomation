# Preserve triage — stamp 20260928T1629Z

Record of how the founder's local worktree snapshots were sorted against
`origin/main` **46c3fdb5d** (the remote tip when this was written,
`git ls-remote origin refs/heads/main`). Snapshots are WIP-preserve commits made
by `.planning/handoff/preserve-local-work.sh` on branches
`wip/preserve-20260928T1629Z/<dir>--<tree>-<id>`. The script leaves the source
trees alone. Nothing here has been cherry-picked, pushed or merged. The snapshot
branches are still the way to recover anything.

## 1. Method and the mechanical numbers

**Stamp report (from the Mac):** 235 worktrees listed: 35 saved, 0 already
saved, 165 clean, 0 slow, 24 refused/failed, 11 missing. The reasons for the 24
refusals/failures have not arrived yet. One snapshot saved earlier brings this
pass to **36 snapshots**.

**Origin holds more than that.** It has 56 branches under this stamp: 35
`Projects--` and 21 `worktrees--`. By committer time, 36 were pushed between
12:29 and 13:13 -04:00. These match the 36 above. The other 20 were pushed
between 13:53 and 13:54 -04:00: `Projects--restaurant-ai-automation-cx-plain-9d7fa80`
plus 19 `worktrees--*` trees, which are `.claude/worktrees/*` of the main
checkout. They are outside every number in this record (see §5).

**The pipeline, over the 36:**

| Step | Files |
|---|---|
| Snapshot files not byte-identical to origin/main | 1,664 |
| Generated coverage output: `apps/api-gateway/coverage/` in `Projects--wt-review-39ddc2a` | 794 |
| Same blob already on another origin branch | 494 |
| Landed, older or renamed (derived: 1,664 − 794 − 494 − 120; not counted separately here) | 256 |
| **Judged here: 18 snapshots, listed in `needs-judgement.json`** | **120 files + 1 local-only commit (c59d8f71b)** |

Nothing on main ignores `coverage/`. The only related rule is
`services/agent-orchestrator/.gitignore:44` (`.coverage`), and no path under
`/coverage/` is tracked on main. So a coverage run on the Mac leaves ~800
untracked files in the tree.

**How the judging worked.** A judge pass classified every file and commit in
`needs-judgement.json`. A separate skeptic pass then re-verified each verdict
against origin/main 46c3fdb5d, the in-flight PR branches (#490, #491 (merged),
#492, #493, `feat/cutover-manifest-trial`) and every fetched origin ref. Where
the skeptic ran tests, this record says so.

The skeptic also checked 58 files beyond the list:
- 57 anchor-only files in the register snapshot. The list itemized 41 of its 98 files.
- `CLAIMS.jsonl` in wt-w8-flags. The list had 5 of its 6 files.

**Verdicts:**

| Verdict | Of the 120 listed | Including the 58 extra |
|---|---|---|
| STILL_WANTED | 82 | 139 |
| SUPERSEDED | 17 | 17 |
| LANDED_DIFFERENTLY | 19 | 20 |
| UNSURE | 2 | 2 |
| ABANDONED | 0 | 0 |
| Local-only commit c59d8f71b | STILL_WANTED | — |

Some STILL_WANTED files are **partial carries**; §3 says what to take from each:
- `procurement.service.ts`: hunks 3–7 only.
- KL `CLAIMS.jsonl`: drop one row.
- labor ADR 0215: only the item-21 fact.
- `Privacy.tsx`: extend to both copies.

## 2. Per-snapshot tables

Every snapshot below is on `origin/wip/preserve-20260928T1629Z/Projects--<name>`.
"snap" is the WIP-preserve commit and "base" is its parent.

### wt-register-85-621edf8: snap b21a9bdfc, base c8bbf95de (#480, on main), branch docs/register-od-133-140-152, 98 files, 195+/196−

| File | Verdict | Evidence | Destination |
|---|---|---|---|
| `.planning/decisions/OPEN-DECISIONS.md` | STILL_WANTED | Resolves three rows. **OD-133**: base :90 → snap :94, "Accept their retention", item 84. **OD-140**: base :25 plus stale :111 → snap :95, built by #469 (341c99b7c, `cellar.controller.ts:71`). **OD-152**: base :26 → snap :96, built by #468 (ed921cf26, `LedgerRow.tsx:140`), item 85. Row count goes 153 → 152. `git log --all -S"Accept their retention"` finds only this snapshot. | Register-only PR (§3.1) |
| `.github/workflows/ci.yml` | STILL_WANTED | Only OD-88's anchor changes, at :687 (`OPEN-DECISIONS.md:60` → `:58`). Main still reads `:60` at :687 (re-checked). The file is gate-owned. | Same PR; regenerate with `--fix`; cite item 85 in the PR body |
| `.planning/07-reference/deploy/WEB-REBUILD-CENSUS-2026-09-25.md` | STILL_WANTED | Anchor-only. Conflict risk: #492 edits this file, and its census goes up to item 78 plus a new item 86, with no 84/85. `feat/cutover-manifest-trial` adds 2 lines before OD-133 (OD-177/178), which shifts anchors by 2. | Same PR, rebased last; regenerate |
| `.planning/decisions/0025-citations-must-disagree-loudly.md` | STILL_WANTED | OD-88 anchors: :60 → :58 and :73 → :71. The 2 quoted examples are correctly skipped. | Same PR; regenerate |
| `.planning/decisions/0175-one-tap-from-the-notification-is-staged.md` | STILL_WANTED | :130 → :129, in two places | Same PR; regenerate |
| `.planning/decisions/0215-money-on-team-is-the-owners-and-hours-are-worked-hours.md` | STILL_WANTED | OD-88: :60 → :58 | Same PR; regenerate |
| `.planning/foundation/teams/corporate.md` | STILL_WANTED | OD-01: :118 → :117; OD-08: :182 → :181 | Same PR; regenerate |
| 37 further `.planning/01-org`, `02-advisory`, `04-specs`, `06-pages` files (itemized by the judge) | STILL_WANTED | Anchor re-points only | Same PR; regenerate |
| 57 files not in the list (e.g. `01-org/applied-ai/ai-orchestration/*`, `01-org/product/partnerships-integrations/**`, `01-org/intelligence/security/**`, `02-advisory/*`, `03-scenarios/S15-*`, `04-specs/P1-PYTHON-EMITTER.md`, `sketches/{062,073,074}-*`, `scripts/bakeoff/README.md`) | STILL_WANTED | Anchor re-points only. Two were checked by hand: sketch 074 README (OD-03 :33 → :31) and P1-PYTHON-EMITTER (OD-52 :47 → :45). | Same PR; regenerate |

**Reproduction.** The skeptic applied only this snapshot's `OPEN-DECISIONS.md`
to a clean 46c3fdb5d and ran `scripts/check_citation_pairing.py --fix`. It
rewrote exactly 98 files (195+/196−), all byte-identical to b21a9bdfc.
Afterwards both `check_citation_pairing.py` and `check_od_ids_exist.py` pass.

### wt-arrival-first-proof-51c197a: snap d0f0b88f8, base e72edf9b2 (tip of origin/feat/arrival-first-proof, not on main), 20 files, +1033/−0

This is the drawing for Sketch 123 "The first proof" (ADR 0213, Locked). Main's
README for the sketch (from squash ddc5e094b, #455) and `MANIFEST.md:116` tell
the reader to open `index.html` and look in `shots/`. Neither exists on main.
`WEB-REBUILD-CENSUS-2026-09-25.md:187` lists `wt-arrival-first-proof` as
unpreserved and unclassified.

| File | Verdict | Evidence | Destination |
|---|---|---|---|
| `.planning/sketches/123-first-proof/index.html` | STILL_WANTED | `<title>Sketch 123 · The first proof</title>`, 8 frame captions, `--graphite`. `git log --all` on the path finds only d0f0b88f8. | New `docs/sketch-123-drawing` |
| `.planning/sketches/123-first-proof/shoot.mjs` | STILL_WANTED | Regenerates the shots exactly as the README describes. Line 2 imports playwright from an absolute path on the founder's machine. | Same branch; change line 2 to `import … from 'playwright'` |
| `shots/` 18 PNGs: f0–f7 at -1440 and -390, `f5-charcoal-1440`, `f5-original-1440` | STILL_WANTED | Sizes match the `--stat` byte counts. IHDR decoded for f0-1440 (1360×931), f0-390 (366×1020), f5-1440 (1360×3365), f5-charcoal-1440 (1360×3365), f5-original-1440 (1360×4695) and f7-390 (366×2054). Main's README names the f5 variants. All are absent from every ref. | Same branch, `shots/` |

### wt-r5-KL-f13dae6: snap 2f9a1e0d3, base a2648d8a5 (2026-09-22, not on main), branch r5/KL, 9 files

This is KL round 6z of ADR 0145 (/ask). The founder's picks were: "Ask waits for
new Settings", "Leave it out", and "Add a plain line now". Main has since built
and shipped /ask for every house (#475, 347f9879b; ADR 0145:3). Settings is live
for every house (#419, 24b7d5288; `useMudavymDesign.ts:213`). No tests were run
for this snapshot.

| File | Verdict | Evidence | Destination |
|---|---|---|---|
| `.planning/decisions/0145-mudavym-answers-out-of-a-reading.md` | STILL_WANTED | Main has no round-6z amendment. The three picks appear only in 2f9a1e0d3. The draft's premises "no web-reachable /ask" and "settings not in LIVE_PAGES" are now stale. It cites migration 20260922014000, which is 20260922220600 on main (comment-only diff). The person-label gap is still "recorded, not decided" at main :1356. | `fix/ask-round-6z` (§3.3) |
| `.planning/decisions/CLAIMS.jsonl` | STILL_WANTED (partial) | Adds `ADR-0145-ASK-FEEDBACK-LABEL-OPT-OUT-SNAPSHOT` and `ADR-0145-ASK-WAITS-FOR-NEW-SETTINGS`, and re-points two rows. None of the four ids is on main. The WAITS row's premise ("/ask has no page…") is false since #475. | Keep FEEDBACK-LABEL plus the two re-points, rewritten to 20260922220600 and the renumbered migration; drop WAITS |
| `apps/api-gateway/src/ask-ai/bound-ask.service.ts` | SUPERSEDED | Adds a 503 gate on `mudavym_design_settings`. That column defaults false (`20260902230000_mudavym_design_flags_p4.sql:20`), so the gate would 503 /ask for those houses. #419 already met answer 1 (`SettingsNext.tsx:438`). | Do not port |
| `apps/api-gateway/src/ask-ai/bound-ask.service.spec.ts` | SUPERSEDED | The base blob 0e5ab78fc is identical to main's. The only additions test the gate. | Do not port |
| `apps/api-gateway/src/ask-ai/ask-staff-own-work.spec.ts` | SUPERSEDED | Only adds a 6th constructor arg (`settingsOn`), which exists for the gate | Do not port |
| `apps/api-gateway/src/ask-ai/ask-ai.module.ts` | SUPERSEDED | Imports `SettingsModule` only for the gate | Do not port |
| `apps/web/src/pages/Privacy.tsx` | STILL_WANTED (extend) | Adds the model-provider-outside-Turkey sentence, only on `git log --all -S` of 2f9a1e0d3. It edits only the legacy `<Section>` copy (main :233), not the plate copy (main :108). Both line numbers re-checked. | `fix/ask-round-6z`; put the sentence in both copies |
| `apps/web/src/pages/Privacy.test.tsx` | STILL_WANTED (extend) | One new assertion; main has none | Same branch; assert both copies |
| `supabase/migrations/20260922023000_ask_feedback_label_opt_out_snapshot.sql` | STILL_WANTED | Builds "Leave it out": `ask_folio_labels.given_while_opted_out`, a BEFORE INSERT trigger, and a recreated `ask_folio_training_export`. The label store is insert-only (`ask-readings/reading-folio.store.ts:194`). Its version is below main's ceiling 20261201120000. Its header says no production row can exist, which is false now that /ask is live. | Same branch; renumber past 20261201120000, rewrite the header, re-run the PGlite probe `KL6-label-opt-out-snapshot.mjs` |

### wt-r5-E-d731d15: snap caff89caa, base ed7999ce7 (not on main), branch r5/E; 2 of 27 files needed judgement

| File | Verdict | Evidence | Destination |
|---|---|---|---|
| `apps/api-gateway/src/procurement/canonical/delivery-stock.service.ts` | LANDED_DIFFERENTLY | Main has the same `closeDeliveryItemToNameBookedElsewhere` call plus a `bookedOrderId` null guard that the snapshot lacks | None |
| `apps/api-gateway/src/wines/wine-submissions.service.ts` | LANDED_DIFFERENTLY | `@Cron('*/5 * * * *')` and `scheduledProcessPendingSubmissions` are on main verbatim. The only differences are the migration renumbering (20260921170520 → 20261116101200) and a reworded comment. Main has also added `menuCategory` since. | None |

### wt-r5-gate-fdf4281: snap 7c94187ed, local-only commit c59d8f71b on top of d45147f42 (tip of origin/feat/gate-owned-by-diff, PR #432, not on main)

The snapshot's 6 dirty files were placed mechanically. Only the commit was judged.

| Commit | Verdict | Evidence | Destination |
|---|---|---|---|
| c59d8f71b "close the four remaining gate8c residuals…" | STILL_WANTED | Adds `_PARAM_PATTERN_SUB_RE`, `_INDIRECT_PARAM_RE` and `_PARAM_ASSIGN_RE`, and puts `'builtin'` in `_PUSH_WRAPPER_PROGRAMS`. It also carries ADR 0090 prose, extends the existing CLAIMS row ADR-0090-GATE-R8-… in place, and adds 128 test lines. `git branch -r --contains` finds only the snapshot. Main's `require_pr_audit.py` (last changed in 60ed83a7e, #373) has none of the four; the hook is live via `.claude/settings.json`. #442 (b57380288) touches a different script. **Ran** `pytest scripts/test_require_pr_audit.py` at c59d8f71b: 670 passed. | Push to `feat/gate-owned-by-diff` (PR #432) as a fast-forward. The judge named no destination; this is inferred from parent = branch tip. |

### wt-sec-procurement-e5ee461: snap a34b28aee, base c8bbf95de (on main), branch fix/procurement-tenant-scope, 8 files

Tests were run on a clean 46c3fdb5d.

| File | Verdict | Evidence | Destination |
|---|---|---|---|
| `apps/api-gateway/src/common/tenant/assert-provider-belongs-to-restaurant.ts` | LANDED_DIFFERENTLY | Main has a count-based fence at `procurement.service.ts:914-935` (the ADR 0147 shape). The helper is unreferenced. CLAIMS.jsonl:557 is resolved, and its verify exits 0 on main. | Do not port |
| `apps/api-gateway/src/procurement/procurement.service.ts` | STILL_WANTED (hunks 3–7) | `resolveLatestDealProposal` (main :8953) is not house-scoped, while `dealMessageFor` (:2831) is. The hunks add the `restaurantId` filter and `.eq("restaurant_id")` on the manual-reply and confirmDeal DISCARDED updates. **Ran**: 1841/1844 across the procurement suite (93 files; 3 were already skipped); no other open PR has the fix. | New `fix/deal-proposal-house-scope` |
| `apps/api-gateway/src/procurement/vendor-doors-are-sealed.spec.ts` | STILL_WANTED | **Ran**: 3 fail and 27 pass on main alone; 30/30 with the hunks | Same branch |
| `apps/api-gateway/src/procurement/order-capture.spec.ts` | SUPERSEDED | **Ran**: its 4 new cases fail on main. The mock shape (select+maybeSingle) never triggers main's count fence. | Do not port |
| `apps/api-gateway/src/procurement/agreed-price-states-its-unit.spec.ts` | SUPERSEDED | **Ran**: 100/100 with or without the mock tweak, so the tweak does nothing on main | Do not port |
| `apps/api-gateway/src/procurement/recurring-calendar-writes.spec.ts` | SUPERSEDED | Same run | Do not port |
| `apps/api-gateway/src/procurement/recurring-orders.spec.ts` | SUPERSEDED | Same run | Do not port |
| `apps/api-gateway/src/providers/retroactive-order.spec.ts` | SUPERSEDED | Same run | Do not port |

### wt-sec-roles-e8079a5: snap bb5501c24, base c8bbf95de (on main), local branch fix/gateway-roles-and-timezone (never pushed), 5 files

| File | Verdict | Evidence | Destination |
|---|---|---|---|
| `apps/api-gateway/src/organizations/organizations.service.ts` | STILL_WANTED | Main :783 still writes `timezone: dto.timezone ?? null`. Main already has `resolveSignUpTimezone` (`auth/sign-up-timezone.ts:45`); createLocation does not use it. No open PR fixes this. | New `fix/create-location-timezone` |
| `apps/api-gateway/src/organizations/create-location-grants-access.spec.ts` | STILL_WANTED | **Ran**: 9/9 (7 new) | Same branch |
| `apps/web/src/components/locations/AddLocationDialog.tsx` | STILL_WANTED | Main :137 still calls bare `Intl.DateTimeFormat().resolvedOptions().timeZone`. The snapshot switches it to `getBrowserTimezone()` (`web/lib/browserTimezone.ts:23`). | Same branch |
| `apps/web/src/components/locations/locationDialogFailures.test.tsx` | STILL_WANTED | **Ran** vitest: 6/6 | Same branch |
| `.planning/decisions/CLAIMS.jsonl` | STILL_WANTED (fix) | Flips main :699 (TD-2026-09-27-CREATE-LOCATION-TIMEZONE-UNVALIDATED) to resolved. The bracket cites the unpushed branch name, and it does not strike `v3.0-TECH-DEBT.md:6620` (still "OPEN — 2026-09-27", re-checked). | Same branch; correct the branch name and strike TD :6620 in the same PR |

### wt-cutover-trial-b51c870: snap c69fafec1, base c8bbf95de (on main), branch feat/web-cutover-trial, 7 files, +28/−367

This is a hand-started G-shell removal under ADR 0149. Every edit is stamped
"[ADR 0149 cutover trial, 2026-09-28: the `shell` gate is gone]", and that marker
appears on no other branch. `CUTOVER-MANIFEST-2026-09-28.md` §7 (on
`feat/cutover-manifest-trial`) lists G-shell as "in-file, not trialled", pending
OD-178, which is not on main. ADR 0149 requires founder approval per file group.
All 7 blobs are unique across every fetched object.

| File | Verdict | Evidence | Destination |
|---|---|---|---|
| `apps/web/src/components/layout/DashboardLayout.tsx` | STILL_WANTED (gated) | Removes ShellByGate/LegacyDashboardLayout (main :53-59) and the dead `Sidebar`/`Header` re-exports. It is imported only from `App.tsx:62` and two tests. | G-shell commit after OD-178 (§3.7) |
| `apps/web/src/components/mudavym/AppOfflineBanner.tsx` | STILL_WANTED (gated) | Manifest cites :32; `AppOfflineBanner.test.tsx:29` shell-off block | Same |
| `apps/web/src/components/mudavym/AppToaster.tsx` | STILL_WANTED (gated) | Manifest cites :22; `AppToaster.test.tsx:30-33` shell-off block | Same |
| `apps/web/src/components/mudavym/DayLine.tsx` | STILL_WANTED (gated) | Manifest cites :155; `DayLine.test.tsx:~100` shell-off case | Same |
| `apps/web/src/components/mudavym/HousePageLoader.tsx` | STILL_WANTED (gated) | Manifest cites :67; `HousePageLoader.test.tsx:24-28` | Same |
| `apps/web/src/components/mudavym/ShellCatchAll.tsx` | STILL_WANTED (gated) | Manifest cites :22-25; `ShellCatchAll.test.tsx:61-63` | Same |
| `apps/web/src/contexts/ToastContext.tsx` | STILL_WANTED (gated) | Removes `useLegacyToastApi` and the Radix wrap (205 lines). `ToastItem` stays in use (`toasts: ToastItem[]`). Test: `ToastContext.test.tsx:59-66`. | Same |

### wt-labor-5725e80: snap 4d299b231, base 93c1d257b (#440's head, not on main; #440 = 0c16f8434), branch fix/team-pay-defects, 6 files

The founder's round-6z picks are in census :531 (re-checked; the line carries a
stray `321:` prefix). They were: "Manager: on only (Recommended)", "Past shown,
future open (Recommended)" and "Delete those (Recommended)". Main's round-4
answers, dated 2026-09-25, are at ADR 0215:599-637. Two of them answer the
removed-person questions differently: "Owner-only history", and credentials
kept (migration `20261201110210_…` drops `team_certifications_member_id_fkey`).

| File | Verdict | Evidence | Destination |
|---|---|---|---|
| `.planning/decisions/0215-money-on-team-is-the-owners-and-hours-are-worked-hours.md` | STILL_WANTED (item 21 only) | Main still calls the literal "and off" of item 16 open, at :21, :30, :433, :1033 and :1122 (re-checked). Round 6z answers it ("on only"). Code already matches: `labourSettingsRefusal` at `pay-rules.ts:342`. The snapshot's items 22/23 collide with, and contradict, main's items 22/23. | Records lane (§3.9); dated bracket only; new item numbers |
| `.planning/decisions/CLAIMS.jsonl` | SUPERSEDED | Of 239 added rows, 232 match main (parsed JSON, compared per id) and 7 differ, all with main's version newer. The new PAST-SHOWN row relies on `onRosterOrPastShift`, which is not on main. The new CASCADE row's verify fails on main because of `20261201110210`. Main :536 keeps the un-narrowed row. | Do not port |
| `apps/api-gateway/src/team/pay-rules.ts` | SUPERSEDED | The body of `onRosterOrPastShift` never reads its `today` parameter, so it behaves exactly like `onTheRoster`. Main has neither it nor `todayDateString`. | Do not port |
| `apps/api-gateway/src/team/schedule.service.ts` | SUPERSEDED | Main's `getWeek` (:143-155) keeps `onTheRoster`. The owner reads removed staff through `GET …/team/former-staff` (`team.controller.ts:129`). | Do not port |
| `apps/api-gateway/src/team/team-pay.spec.ts` | UNSURE (split) | K1 is superseded: main :1079 asserts the opposite. K2 (`deleteMember` opens future shifts) exists nowhere else (`git log --all -S shiftsOpened`). | Founder fork (§3, UNSURE) |
| `apps/api-gateway/src/team/team.service.ts` | UNSURE | Main's `deleteMember` (:1022-1160) writes no shifts. Main ADR 0215:520-522 says unworked future shifts stay kept and shown. That sentence is the lane's own reading, not a founder quote. Round 6z's pick says they reopen. The two readings have never been reconciled. | Founder fork (§3, UNSURE) |

### wt-pr430-prep-b9a8ca9: snap ff5edbed9, base a2648d8a5 (not on main), branch prep/pr430-onto-main; 7 of 373 files needed judgement

PR #430 merged as e2abd7844. The snapshot tree is 67 files away from that merge.

| File | Verdict | Evidence | Destination |
|---|---|---|---|
| `.planning/decisions/CLAIMS.jsonl` | SUPERSEDED | Of 239 added rows, 232 match main and 7 differ; main's version is newer in every case (e.g. `ADR-0149-LIVE-PAGES-16` on main is widened to settings/help/cellar/menu) | Do not port |
| `apps/api-gateway/src/settings/feature-flag-registry.ts` | SUPERSEDED | Puts an object literal inside `REMOVED_FEATURE_FLAGS: readonly string[]`, which is a type error. On main the flags are settled in `LIVE_IN_CODE_FLAGS`. | Do not port |
| `apps/web/src/lib/mudavym/pageNames.ts` | LANDED_DIFFERENTLY | Main `NO_CHROME` = `['receiving_door','arrival','authorize_integration']`. The snapshot drops `authorize_integration`, a mid-merge slip. | None |
| `apps/web/src/lib/mudavym/useMudavymDesign.ts` | LANDED_DIFFERENTLY | Main has `shell`, `help`, and `LIVE_PAGES` with 28 entries | None |
| `apps/web/src/lib/mudavym/useMudavymDesign.test.tsx` | SUPERSEDED | Main :134 `HELD_BACK=['arrival']`, :147 `toBe(28)`, and :231/:288/:296 settings cases | Do not port |
| `apps/web/src/pages/Privacy.tsx` | LANDED_DIFFERENTLY | The snapshot cites 20260922014000, which is not on main (main has 20260922220600). Two sections are in swapped order. Main also has a Terms of Service link at :181 that the snapshot lacks. | None |
| `apps/web/src/pages/settings/next/st-format.ts` | LANDED_DIFFERENTLY | Main is further along: it has `time-zone`/`mail-reading` (ADR 0207) and `icalToken`/`icalRegen`. Main renders ask-training outside `SECTIONS` (`SettingsNext.tsx:431-433`). | None |

### wt-w8-flags-190920f: snap 349c69845, base 3d8edc82d (ancestor of feat/flags-to-code-… head d3bfacb82, whose tree equals #487's squash dcdb6d5e9); 6 files, +21/−29

This is a sweep that rewrites citations of already-merged migrations from
version numbers to slugs, under founder item 79. Item 79 applies the slug rule
only to versions "assigned at merge", i.e. migrations not yet merged, so it
does not ask for a retroactive sweep. The sweep also misses
`scripts/flip_mudavym_design_flags.py:116`.

| File | Verdict | Evidence | Destination |
|---|---|---|---|
| `.planning/decisions/0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once.md` | LANDED_DIFFERENTLY | Main row 54's CORRECTED bracket cites exact versions 20261015000000, 20261022000000 and 20260831090000, and all three files exist. The snapshot would overwrite a dated bracket in place. | None |
| `.planning/decisions/0160-the-founders-sketch-review-what-he-valued-and-what-each-page-becomes.md` | LANDED_DIFFERENTLY | Same swap; main's §112/§113 are correct | None |
| `apps/api-gateway/src/settings/feature-flag-registry.ts` | LANDED_DIFFERENTLY | The snapshot's `readBy …:254` anchor is right only against its own shortened file. On main the call is at `useMudavymDesign.ts:263`. | None |
| `apps/web/src/lib/mudavym/useMudavymDesign.ts` | LANDED_DIFFERENTLY | Comment-only condensing | None |
| `scripts/flip_mudavym_design_flags.py` | LANDED_DIFFERENTLY | One line swapped; the parallel :116 is left alone | None |
| `.planning/decisions/CLAIMS.jsonl` (not in the list) | LANDED_DIFFERENTLY | Only the PROMOTIONS-DARK-BEHIND-FLAG prose changes; its verify is unchanged | None |

### wt-recs-cat-9709d3c: snap 4324d2edf, base c7db79871 (= head of origin/wip/2026-09-21/fin-recs-catalogue), 3 of 7 files needed judgement

| File | Verdict | Evidence | Destination |
|---|---|---|---|
| `.planning/decisions/0191-the-recommendations-catalogue-is-actionable-not-a-read-only-leaf.md` | LANDED_DIFFERENTLY | Main carries the RENUMBERED bracket (L10a, ADR 0212), the Round 6 text and the L10a row. The snapshot's 11 unique lines are all pre-renumber citations. | None |
| `.planning/decisions/CLAIMS.jsonl` | LANDED_DIFFERENTLY | `ADR-0191-R6-NOTE-AUTHORS-KEPT-TWO-YEARS` is resolved on main (T12 check), and the R5 row is bracketed SUPERSEDED. The snapshot's rows point at dead migration paths. | None |
| `apps/api-gateway/src/analytics/recommendation-round6.spec.ts` | LANDED_DIFFERENTLY | Comment-only changes: 20260922021000/T1–T11 versus main's 20260925120600/T1–T12 (#467, 0ca4414fb) | None |

### wt-scorecard-35c9f19: snap 30475157a, base a113e00dd (ancestor of feat/vendor-scorecard 82660e310; #435 = ef8ecdf30 on main); 2 of 24 files needed judgement

| File | Verdict | Evidence | Destination |
|---|---|---|---|
| `.planning/decisions/CLAIMS.jsonl` | LANDED_DIFFERENTLY | The snapshot's `ADR-0207-NEVER-ARRIVED-CREDIT-CLAIM` cites 20260922024000, which is absent from main; main cites 20261021150000. Main's DATA-TERMS row is hardened to per-owner acceptance. | None |
| `apps/web/src/components/layout/DashboardLayout.tsx` | LANDED_DIFFERENTLY | Main mounts `<DataTermsSignInGate />` outside both shells (:17, :44-48). The snapshot puts it inside the legacy body beside `WineAgentFab`, which main no longer imports. | None |

For the other 22 files: `SealedRejectDie.tsx` has a 0-line diff at ef8ecdf30,
and all 228 lines `procurement.service.ts` adds are present on main.

### wt-adr-mig-merge-31b0c4b: snap 446b05aa2, base c8bbf95de (on main), branch docs/adr-migrations-numbered-at-merge (not on origin), 1 file

| File | Verdict | Evidence | Destination |
|---|---|---|---|
| `.planning/decisions/0231-a-migration-is-numbered-at-merge-and-cited-by-its-slug.md` | STILL_WANTED | No decision record for this rule exists. It is only used, at ADR 0227:138, ADR 0229:723 and CLAIMS.jsonl:670. **Number collision** with `origin/docs/model-dispatch-adr-0231` (#490); 0232 is free on every ref. Three citation errors: the 0212 slug is `…-its-base-holds`; ADR 0085 is the ADR-number precedent, not where the migration guard came from; the only slug glob in CLAIMS belongs to ADR-0221. | New `docs/adr-migrations-numbered-at-merge` (§3.8) |

### wt-cx-plain-terms-a5679e7: snap 8fa8397df, base 06c64fadc (#460 head; squash 97806caf6 on main), 1 file

| File | Verdict | Evidence | Destination |
|---|---|---|---|
| `.planning/07-reference/pr-audits/460-06c64fad.md` | SUPERSEDED | Main has a fuller, retroactive record at the same path (b3f40d26d, #461). Of the snapshot's two extra lines, one is trivial (129 passed). Main's text answers the other (the #454 ruling already covers the copy change). | None |

### wt-pg-help-08cd7f0: snap 007fcaa9a, base 7ceb61475 (feat/page-help, not on main), 1 file

| File | Verdict | Evidence | Destination |
|---|---|---|---|
| `.planning/07-reference/pr-audits/413-7ceb614.md` | LANDED_DIFFERENTLY | PR #413 comment 5784651290 carries the same marker and verdicts word for word. ADR 0090:214 and :615 say the local copy is only a convenience. Remaining gap: `07-reference/INDEX.md` has no row for `deploy/HELP-ALERT-INDUSTRY-RESEARCH-2026-09-22.md`. | Records lane: add the INDEX row (§3.9) |

### wt-pg-settings-7b9a45f: snap 5c62c7998, base 04dbdd8d7 (#419 = 24b7d5288), 1 file

| File | Verdict | Evidence | Destination |
|---|---|---|---|
| `.planning/07-reference/pr-audits/419-bfe59f5a4.md` | SUPERSEDED (LANDED_DIFFERENTLY is equally apt) | The BLOCK is preserved verbatim in PR comment 5783263118, and comment 5783588701 records the PASS. The fix is on main (`useSettingsNextData.staff-gate.test.tsx`; `calendar.controller.ts:751/:867`). The line "Models: grok-4.7-high-fast" is unrecorded anywhere on main. | None. The model-deviation note is optional, for the records lane. |

### wt-sidebar-receipt-95943aa: snap 0c0beb559, base 910c6355a (detached; #458 head; base ddc5e094b on main), 1 file

| File | Verdict | Evidence | Destination |
|---|---|---|---|
| `.planning/07-reference/pr-audits/458-910c635.md` | LANDED_DIFFERENTLY | PR #458 comment 5788433640 has the same content verbatim. The only difference is that the marker and heading are in swapped order. | None |

## 3. STILL_WANTED and UNSURE: action list by destination

One branch per operation, off `origin/main` unless stated otherwise. Each item
names the snapshot commit to take from.

1. **`docs/register-od-133-140-152`**: new register-only PR, from b21a9bdfc.
   - Take the three row edits in `OPEN-DECISIONS.md` (OD-133, OD-140, OD-152). Do not take the other 97 files; regenerate them with `scripts/check_citation_pairing.py --fix` and commit that output.
   - Rebase **last**, after #492, #490 and `feat/cutover-manifest-trial`.
   - Before merging, confirm founder items 84/85 against memory `founder-answers-2026-09-25-web-rebuild.md`. They cannot be verified in this container.
   - Cite item 85 in the PR body, because `ci.yml` is gate-owned.
2. **`docs/sketch-123-drawing`**: new, from d0f0b88f8.
   - Take all 20 files under `.planning/sketches/123-first-proof/`.
   - Fix `shoot.mjs:2` to import bare `playwright`.
   - No MANIFEST change.
3. **`fix/ask-round-6z`**: new, from 2f9a1e0d3. Carry:
   - The Privacy sentence in **both** copies (`Privacy.tsx:108` plate and `:233` Section), with tests asserting both.
   - The migration, renumbered past 20261201120000. Rewrite its header, since /ask is live, and re-run `KL6-label-opt-out-snapshot.mjs`.
   - A round-6z amendment to ADR 0145. Record the three picks verbatim, record answer 1 as met by #419, and rewrite Built/Not built against main.
   - Three CLAIMS rows: FEEDBACK-LABEL plus the two re-points, rewritten to 20260922220600 and the new version. Drop ASK-WAITS.
   - The person-label gap, filed in `OPEN-DECISIONS.md` as **OD-179** (lowest free; see §4).
   - Do not carry `bound-ask.service.ts`, its spec, `ask-staff-own-work.spec.ts` or `ask-ai.module.ts`.
4. **`fix/deal-proposal-house-scope`**: new, from a34b28aee.
   - Take hunks 3–7 of `procurement.service.ts` only, plus `vendor-doors-are-sealed.spec.ts`.
   - Do not take the helper file, the createOrder fence hunks or the 5 spec mock tweaks.
5. **`fix/create-location-timezone`**: new, from bb5501c24.
   - Take all 5 files.
   - Correct the CLAIMS bracket's branch name, and strike `v3.0-TECH-DEBT.md:6620` in the same PR.
6. **PR #432 `feat/gate-owned-by-diff`**: fast-forward to c59d8f71b.
   - Its parent d45147f42 is the branch tip. The destination is inferred, not stated by the judge.
   - Re-run the mutation count before quoting "161 killed".
7. **G-shell cutover**: from c69fafec1, **blocked on OD-178**, with three options:
   - (A) Commit on `feat/cutover-manifest-trial`.
   - (B) Open a small follow-up cutover PR.
   - (C) Drop it.

   Work the group needs before it can land:
   - Delete `Sidebar.tsx`, `Sidebar.stories.tsx`, `Sidebar.account.test.tsx` and `Sidebar.receiving.test.tsx`. Keep `Header.tsx`, which `DevSandbox.tsx:14` still uses.
   - Rewrite `DashboardLayout.shellGate.test.tsx`, which mocks `./Sidebar` at :42 and asserts on it at :93.
   - Delete the shell-off cases in `AppToaster.test.tsx:30-33`, `ToastContext.test.tsx:59-66`, `ShellCatchAll.test.tsx:61-63`, `HousePageLoader.test.tsx:24-28`, `AppOfflineBanner.test.tsx:29` and `DayLine.test.tsx:~100`.
   - Run prettier on `AppToaster.tsx`.
   - Check for other importers of `ui/SyncStatus` OfflineBanner, `ui/page-loader` PageLoader and `@wineops/ui`'s Radix Toast.
   - Run tsc and vitest.
8. **`docs/adr-migrations-numbered-at-merge`**: new, from 446b05aa2.
   - Renumber the draft to **0232**.
   - Add its CLAIMS row and the `decisions/README.md` index entry.
   - Fix the three citations (0212 slug, ADR 0085's role, the glob claim).
   - The founder confirms its status. The draft claims Locked via a memory note.
9. **Next `docs/records-*` lane**, after #492:
   - In ADR 0215, add a dated bracket closing the literal "and off" at :21, :30, :433, :1033 and :1122, citing census :531 and `pay-rules.ts:342`. Use new item numbers, not 21–23.
   - Add founder items 79–85 to census §17.
   - Add the INDEX.md row for `HELP-ALERT-INDUSTRY-RESEARCH-2026-09-22.md`.
   - Optionally, add the #419 grok model-deviation note.
10. **UNSURE, for the founder** (wt-labor 4d299b231: `team.service.ts` `deleteMember` and `team-pay.spec.ts` K2). File it as **OD-180**, or the next free number after item 3. The fork: when a person is removed, what happens to their unworked **future** shifts?
    - (a) They go back to the open pool. This is his round-6z pick "future open" (census :531), and it is built only in this snapshot.
    - (b) They stay assigned, and only the owner sees them, in former-staff history. This is main's built behavior. It rests on the lane's own prose at ADR 0215:520-522, not a founder quote. Round 4 never asked about reassignment.

    If (a): port the `shiftsOpened` logic and the K2 tests onto main's `deleteMember` (:1022-1160). If (b): carry nothing and record the answer.

Outside this triage: add `coverage/` to a `.gitignore`. It caused 794 of the
1,664 files, and nothing ignores it today.

Nothing to carry from wt-r5-E, wt-w8-flags, wt-recs-cat, wt-scorecard,
wt-pr430-prep, wt-cx-plain-terms, wt-pg-help (except its INDEX row),
wt-pg-settings or wt-sidebar-receipt. The same goes for the SUPERSEDED parts of
wt-r5-KL, wt-sec-procurement and wt-labor. Whether to keep in-tree copies of
pr-audit files is still open (`pr-audit-gate` SKILL.md:177). If they are kept,
413, 419 and 458 can be recovered from their snapshots without loss.

## 4. Id collisions found

- **ADR 0231, two different ADRs.**
  - `origin/docs/model-dispatch-adr-0231` (#490) has `0231-opus-as-much-as-the-work-needs-sonnet-where-it-is-fast-and-direct.md`.
  - The wt-adr-mig-merge draft is also `0231-…`.
  - No `023[1-3]-*` file is on main, and these are the only two 0231 files on any origin ref, so 0232 is free.
  - #490 is **not merged**: its branch is not an ancestor of 46c3fdb5d. The wt-w8-flags judgement's "#490's merged ADR 0231" is wrong on that point.
  - Move the draft, which has no citations and was never pushed except as the snapshot.
- **ADR 0215 item numbers 21/22/23.** The wt-labor snapshot's items 21–23 reuse the numbers of main's round-4 items (ADR 0215:599-637). Items 22 and 23 give opposite answers to the same questions. The records bracket in §3.9 must take new numbers.
- **OD numbers.** The highest on main is OD-175.
  - OD-176 is on `origin/fix/promotions-room-manager-only` (#493).
  - OD-177 and OD-178 are on `origin/feat/cutover-manifest-trial`.
  - No ref uses OD-179 to OD-189 (grepped `OPEN-DECISIONS.md` on every origin ref). New ODs from this triage start at **OD-179**. Branches that have not been pushed could still take numbers.
- **Founder item numbers: a gap, not yet a collision.**
  - The register row cites items 84 and 85.
  - Census §17 on main has neither, and #492's census adds item 86 while 79–85 are missing.
  - There is a risk if another lane assigns 84 or 85 before the records lane fills §17.
- **Migration versions: no live collision.** No origin ref has a version above ceiling 20261201120000, and 20260922023000 and 20260922024000 exist only on their own snapshot branches. Stale versions would break guards or CLAIMS verifies if landed as-is:

  | Snapshot | Version it carries | Status on main |
  |---|---|---|
  | wt-r5-KL | 20260922023000 | Below the ceiling; must be renumbered |
  | wt-r5-KL, wt-pr430-prep | 20260922014000 | Now 20260922220600 |
  | wt-scorecard | 20260922024000 | Now 20261021150000 |
  | wt-recs-cat | 20260922021000, 20260922010001 | Now 20260925120600 and siblings |
  | wt-r5-E | 20260921170520 | Now 20261116101200 |

- **CLAIMS.jsonl ids.** Main has 738 rows but only 501 unique ids; 57 ids repeat (e.g. `ADR-0104` ×33). Repeating ids is the file's convention for several claims per ADR, not an OD-style collision. It does mean id-only comparison is unsafe, which is why the judges compared parsed rows per id. None of the new ids in wt-r5-KL collides with main. c59d8f71b extends an existing row in place.

## 5. What was not checked

**Not judged at all**
- The **24 refused/failed** worktrees: their reasons have not arrived and they are not fixed. There were 0 SLOW lines, so there are no SLOW commands to run.
- The **11 missing** worktrees.
- The **20 branches pushed 13:53–13:54 -04:00**. `needs-judgement-2.json` flags 5 of them, holding 21 files and 1 local-only commit, none judged:

  | Branch | Needs judgement |
  |---|---|
  | `restaurant-ai-automation-cx-plain-9d7fa80` | 1 file, `pr-audits/462-fa11d94a.md` |
  | `worktrees--brave-swartz-2d70fc-22b2a60` | 7 files |
  | `worktrees--kind-goldberg-a688b2-8be980b` | 5 files |
  | `worktrees--musing-sutherland-0d8f92-36ebfa7` | 7 files, plus aa0779eed, a merge of origin/main into fix/token-routes-trailing-slash |
  | `worktrees--suspicious-panini-f56a5f-d8bf8e9` | 1 file |

  Whether those 20 are some of the 24 refused/failed is unverified.

**Mechanical buckets that were not re-examined**
- The 494 "same blob on another branch" files are safe only while those branches exist and land. That was not judged.
- The 256 landed/older/renamed files come from subtraction here, not a count.
- The 794 coverage files were only classified.

**Checks not run**
- wt-r5-KL: no tests, and no PGlite probe against main's chain.
- c59d8f71b: the mutation count (161) was not re-run.
- G-shell: no tsc or vitest run, and other importers not traced.
- wt-labor, wt-pr430-prep, wt-w8-flags, wt-recs-cat, wt-scorecard, wt-r5-E: no test runs. Those verdicts rest on diffs and greps.
- Sketch 123: only 6 of 18 PNGs had their IHDR decoded, and none was viewed.
- Founder items 84/85: the memory file lives on the Mac.
- The round-6z founder quotes are taken from census :531 on main, not from session transcripts.

**Limits of what was checked**
- The register `--fix` reproduction holds only at 46c3fdb5d. Anchors will move once #492, #490 or the cutover lands.
- Only #490, #491, #492, #493, `feat/cutover-manifest-trial` and the named feature branches were checked for overlap. `fix/websocket-role-gate` did not exist on origin. Other open PRs were not checked.

**Known inconsistencies in the pass prose (verdicts unaffected)**
- The wt-r5-KL note says main "has since advanced". `ls-remote` still shows 46c3fdb5d.
- The register judge says it itemized 41 files, but its named rows add up to 44. `needs-judgement.json` has 41. All 98 were checked against the reproduction anyway.
- For wt-pg-settings, SUPERSEDED and LANDED_DIFFERENTLY are equally apt, and the action is the same either way.

**Re-derived by this record**
These were re-run for this record, not taken from the passes:
- `ls-remote` of main.
- Scans over every ref: ADR numbers, OD numbers, migration ceiling.
- The CLAIMS id count and the `.gitignore` scan.
- Line spot-checks: `ci.yml:687`, `OPEN-DECISIONS.md:60`, `v3.0-TECH-DEBT.md:6620`, ADR 0215 :21/:30/:433/:1033/:1122, `Privacy.tsx:108/:233`, census :186-187 and :531.
- Snapshot shas, parents and file counts (`git log`, `git diff --name-only`).

Everything else is carried over from the judge and skeptic passes, not re-derived.
