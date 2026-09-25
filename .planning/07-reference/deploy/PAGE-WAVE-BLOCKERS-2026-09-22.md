# Page-wave blockers — why non-green design PRs cannot merge

Initial read-only census at **2026-09-22 ~16:00Z / ~12:00 ET**. The current
refresh below supersedes its PR-state claims; the longer blocker analysis remains
as provenance.

**Measured main tip (refresh 2026-09-23):**
GitHub `main` = `e2abd7844` (squash merge of #430). #415 is already on main as
`cc73f9f66`. #434 remains open (do not start its 3-angle audit from this lane).

## Current continuation status

| PR | Current head / state | Current blocker and next action |
|---|---|---|
| **#414 get-started** | held — do not merge | Sketch/get-started lane. Founder hold remains. Do not touch. |
| **#415 admin** | `9af065bf3`; **merged** 2026-09-22 23:53Z as `cc73f9f66` | Done. Audit: `pr-audits/415-9af065bf3.md`. |
| **#430 ask + authorize** | `77117a109`; **merged** 2026-09-23 00:43Z as `e2abd7844` | Done. Audit: `pr-audits/430-77117a1.md`. |
| **#434 cellar** | open; required CI not re-audited by this lane | Another lane. Do not merge from here. |
| **#454 preview** | held — do not merge | Explicit PR-body hold. Do not touch. |
| **#455 arrival / first proof** | `feat/arrival-first-proof`; open; **do not merge**; flag `mudavym_design_arrival` stays off | Third-pass BUILD. Merged `origin/main` (`e2abd7844`) cleanly. Wired: Places `locationBias` (Use my location) against existing `VITE_GOOGLE_MAPS_API_KEY`; Google sign-in already on `/register` via `VITE_GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_ID` (Register chrome left untouched — publicDesign snapshots). `/house` last-invoice line accepts an optional later drop (filename kept, not extracted, not required). Cellar registers is one later house line (`Open later` → Settings cellar), not a first-run step. R4: crop only if extractor already returned a box; otherwise honest empty. Still stubbed: live per-line extractor boxes (menu scan still returns none); `mudavym_design_arrival` remains off. Do not flip the flag. Do not touch #414 / #454. |

**Quick task:** `.planning/quick/260922-qfq-prepare-prs-415-430-434-without-merging/`
exists only in worktree branch `quick/260922-qfq-pr-415-430-434-prep`
(`e3db1dd7c`+), not this shared checkout. PLAN status is `planned`; SUMMARY marks
#434 Q9 prep complete @ `320d06736` (readTillLines ← pos_checks.items; 3/3 pins).
#415 prep pushed @ `9af065bf3` (`415-prep.md`); #430 prep @ `7d734e3f5`.
Founder authorized the serial merge. #415 is complete; #430 must now be updated
onto `cc73f9f66`, rechecked, audited, and merged before #434 is updated.

**Get-started post-122:** founder approved all 17 Opus recs as A on 2026-09-22. Locked in [ADR 0213](../../decisions/0213-get-started-is-account-then-house-then-first-proof.md) (OD-134–139, OD-141). Build is PR **#455** `feat/arrival-first-proof` — do **not** merge #414 or #454; do **not** flip `mudavym_design_arrival`. §5 Q2 is superseded by F7=A (one footer line). Third-pass residuals: menu-scan still returns no per-line boxes; flag stays off.

**Three-gate sketch:** `THREE-GATE-OWNED-SKETCH-2026-09-22.md` still gives the
right authorization boundary and serial order (#415 → rebase/re-audit #430 →
rebase/re-audit #434). Q9 on #434 is now built on head `320d06736`; remaining
hold is founder empty-until-sales confirmation + CI/audit, not the heat-map
wire itself. Preparation may continue in parallel; no gate-owned audit or merge
is authorized.

**Shell / live site:** #437 shell and #439 migration guard are on `main`, and
`3579fa0c7` has a successful Vercel web deployment. The shell migration defaults
`mudavym_design_shell` to false, and no production flag-value read was performed,
so the counter shell is deployed but cannot be claimed live for any house.
`mudavym.com` currently serves bundle `index-CMPTmOrP.js`; it contains legacy
`GetStarted` and no `Arrival` marker, consistent with #414 remaining unmerged.

**This refresh's writes/actions (Q9 lane):** finished and pushed Q9 on
`wt-pr434-q9-heatmap` → `origin/feat/page-cellar` @ `320d06736`; updated this
file + the three-gate sketch note. Did **not** merge #434, run the audit gate,
flip a flag, or deploy.

**Founder answers already locked** (do not re-ask): memory
`founder-answers-2026-09-22-page-gap.md` — Q1–Q5, Q7 Approach 1, Q8 persistent
`/connections` banner, Q9 heat map **now**, Q10–Q15. Only **Q6** (sketch 115)
was still open there; one extra get-started tone fork from the redesign spec is
listed under Founder questions below because it was never asked.

Conflict lists from `git merge-tree --write-tree --name-only origin/main
refs/pr/<n>` (no trial merge, no worktree write). Check status from `gh pr view
--json mergeable,mergeStateStatus,statusCheckRollup` and `gh pr checks`.

---

## 1. Live surfaces on mudavym.com right now

| Surface | Live as the new Mudavym design? | Why (evidence) |
|---|---|---|
| `/login` (Skyleaf / endpaper) | **No — legacy AuthShell** | Code is on `main` (`Login.tsx` → `EndpaperShell` when on). Live bundle `index-D5K27GuW.js` compiles `readEnv()` to bare `return` → `isPublicDesignOn()` is false (`mudavym.design.public` path measured). Title `Sign in · Mudavym` is the SEO head, not proof of endpaper. Founder still owes `VITE_MUDAVYM_PUBLIC=1` + redeploy (Q2), or merge #426 which hard-ons public design. |
| `/` (dashboard) | **Yes body / No counter shell** | `DashboardNext` strings in live bundle; `LIVE_PAGES` includes `dashboard` on `main`. `DashboardLayout.tsx` still old Sidebar + `bg-gray-50`. Counter shell is #437 (unmerged; worker in flight). Ground still charcoal (ADR 0169 is #452, unmerged). |
| `/calendar` | **Yes body / No counter shell** | `CalendarNext` in live bundle; in `LIVE_PAGES`. Same old chrome. Personal iCal rework is #438 (dirty). |
| `/reports` | **Yes body / No counter shell** | `ReportsNext` in live bundle; in `LIVE_PAGES`. |
| `/orders` | **Yes body / No counter shell** | `OrdersNext` in live bundle; in `LIVE_PAGES`. |
| `/team` | **Yes body / No counter shell** | `TeamNext` in live bundle; in `LIVE_PAGES`. Pay defects #440 still open. |
| `/get-started` | **No — legacy wizard** | `main` routes bare `<GetStarted />` (no `PageGate`). Live bundle has `GetStarted`, **no** `Arrival`. Skyleaf book is only on #414 (`PageGate page="arrival"`). |

SPA HTML for non-login routes returns `<title>Mudavym</title>` for every path
(client router); design claims above are from `origin/main` + live JS bundle
markers, not from HTML titles alone.

---

## 2. Ready-to-merge (green, clean, no founder fork)

Leave these to the deploy worker — **do not touch**:

| PR | Title | Evidence |
|---|---|---|
| **#452** | white ground / ADR 0169 | `MERGEABLE` / `CLEAN`, 41/41 checks green. Founder Q3: land **first**. |
| **#437** | counter shell (sketch 119 D) | `MERGEABLE` / `CLEAN`, 41/41 green. Audits were running ~11:47 ET; now fully green. |
| **#439** | migration order guard (ADR 0212) | `MERGEABLE` / `CLEAN`, 41/41 green. |

No other open page/design PR is both merge-clean and check-green at measurement
time.

---

## 3. Per-PR blockers (required set + other page PRs)

Class: **(a)** mechanical — rebase/CI/build of a locked answer, no founder fork;
**(b)** needs a founder answer; **(c)** not built / no PR.

### Required set

| PR | Class | Real blocker (with evidence) |
|---|---|---|
| **#426** public doors | **(a)** | `CONFLICTING`/`DIRTY`. Conflicts: `.planning/decisions/CLAIMS.jsonl`, `.planning/handoff/PROGRESS.md`. Checks: PR Audit Gate, Decision register, Test E2E, CI Complete, both Vercel (rate-limited). Rebase + re-run; Vercel fail is account rate-limit noise. After merge (or founder’s env keystroke) endpaper goes live. |
| **#419** settings | **(a)** | `CONFLICTING`. Conflicts: `useMudavymDesign.ts`, `useMudavymDesign.test.tsx`. Checks: Audit Gate, Test TypeScript (`RecommendationActionsService.getDigestPref` 1 fail — likely main-drift), CI Complete. Moves settings to always-on; founder already said all locked pages live (Q2/Q4). |
| **#413** help | **(a)** + locked-build gap | `CONFLICTING`. Conflicts: ADR 0149, `feature-flag-registry.ts`, `useMudavymDesign.ts`. Checks: Audit Gate + Vercel rate-limit. Q8 is decided (persistent routine banner on `/connections`); grep of `refs/pr/413` connections/help shows revoke UX but **not** the new persistent revoked-mail banner from the research doc — add that decided piece, rebase, audit. |
| **#434** cellar | **(a)** + locked-build gap | *Census row superseded by Current continuation status above.* Head now `320d06736`, mergeable/`BLOCKED`. Q9 live non-wine heat-map wire is on the branch (see claim `ADR-0160-Q9-NON-ALCOHOLIC-HEATMAP-LIVE-SALES`). Remaining before merge: founder empty-until-sales confirmation + CI green + fresh audit at that SHA. Goes live on merge per prior cellar ruling. |
| **#420** recommendations | **(a)** | `CONFLICTING`. Conflict: `useMudavymDesign.test.tsx`. Same TS digest-pref fail + Audit Gate. Stays dark by prior ruling — rebase/fix CI only. |
| **#415** admin desk | **(a)** | `CONFLICTING`. Conflicts: `CLAIMS.jsonl`, `feature-flag-registry.ts`, `scripts/flip_mudavym_design_flags.py`, modify/delete `apps/web/e2e/prod-smoke.spec.ts` (deleted on main). Checks: Audit Gate. New `mudavym_design_admin` — Q4 says on for every house on merge. |
| **#430** ask + authorize | **(a)** | Prep pushed (`7d734e3f5`): main merge clean, migrations `200000`–`200600`. Still **BLOCKED** on checks/reviews; Audit Gate must pass on that SHA. Do not merge without founder word. `/ask` still **absent** on `main`. |
| **#414** get-started / arrival | **(b)** + heavy (a) | See §4. `CONFLICTING` on `feature-flag-registry.ts`. Head still `2466fc7`. Audit marker **BLOCK** (stale premise, needs fresh fan-out). CodeQL red (not required). Not the redesign in `GET-STARTED-REDESIGN-2026-09-22.md`. Q6 open. |
| **#432** gate-r7/r8 | **(a)** | `CONFLICTING`. Conflicts: ADR 0090, `CLAIMS.jsonl`, `scripts/pr_audit_gate.py`. Overlaps what #442 already landed on main — rebase carefully or close if fully subsumed; do not let it fight the worker’s gate work. |
| **#440** team pay | **(a)** | `CONFLICTING`. Conflict: `CLAIMS.jsonl`. Audit Gate. |
| **#441** house areas | **(a)** | `CONFLICTING`. Conflict: `CLAIMS.jsonl`. Audit Gate. |
| **#448** team broadcast | **(a)** | `MERGEABLE`/`BEHIND` but **not green**: “A failed read is never reported as an empty one” fails — 2 new swallowed reads not in baseline (+ Audit Gate). Fix reads or shrink baseline, rebase onto `b57380288`, re-run. |
| **#449** claims multiline | **(a)** | `MERGEABLE`/`BEHIND`; only Audit Gate red (pre-#442 style). Rebase + re-run; #442 makes no-credit non-blocking. |
| **#450** vercelignore claim | **(a)** | Same as #449. |
| **#451** schema-drift multi-column | **(a)** | Same as #449. |

### Other open page-shaped PRs

| PR | Class | Note |
|---|---|---|
| **#438** calendar iCal links | **(a)** | `CONFLICTING` on `CLAIMS.jsonl`. |
| **#435** vendor scorecard | **(a)** | `CONFLICTING` on `CLAIMS.jsonl`. |
| **#436** seals / action integrity | **(a)** | Conflicts: `receiving.md`, `CLAIMS.jsonl`, `OrdersNext.tsx`. |
| **#433** motion rules | **(a)** | `CONFLICTING` on `CLAIMS.jsonl`. |
| **#429** relay | **(a)** | `MERGEABLE`/`BEHIND`; Audit Gate + CodeQL. Clean merge-tree vs main. |
| **#422** notify | **(a)** | `CONFLICTING` on `CLAIMS.jsonl`; CodeQL + Vercel rate-limit. |
| **Receiving desk** | **(c)** | No open PR. Work on local/remote `feat/page-receiving`. Q7 Approach 1 locked — build + open PR. |
| **Labor / hours page** | **(c)** | No open PR (`feat/page-labor` local only). Wait for #440 per prior ruling. |
| **Login endpaper** | env or #426 | Design on main, switch off — founder keystroke (Q2) **or** #426. |

---

## 4. What is still missing to ship #414 `/get-started`

Do **not** implement here. Gaps vs founder “ship get-started” +
`GET-STARTED-REDESIGN-2026-09-22.md`:

1. **Rebase** — conflict in `apps/api-gateway/src/settings/feature-flag-registry.ts`.
2. **Fresh pr-audit-gate** — marker at `sha=2466fc7` is BLOCK; correction post says
   the “migrations never run” premise was wrong, so the verdict is not
   trustworthy either way. Re-run 3 angles + adversarial on current head
   (founder Q5). Remaining real hazards from the correction: rename four
   migrations past today’s ceiling (still
   `20260913190500`, `20260913190600`, `20260919040000`, `20260919050000` on
   the PR; main ceiling at least `20260919120000` and newer since), bound the
   `ACTIVE_FEATURE_FLAGS` → Settings 500 deploy window, replace ~25 citations to
   nonexistent `codex-audit/C2-adopt.md`.
3. **Redesign not in the PR** — #414 is Arrival C2 (folios/book). Spec wants
   menu-upload-first, derived “what we pour” as **reveal** not checkbox chore,
   louder skippable vendors. Spec is design-only; none of that invert is on
   `feat/finish-arrival` head.
4. **Q6 sketch 115** — A/B/C action-box guidance still unanswered (see §5).
5. **Optional tone fork** — how loudly to show low-confidence non-wine registers
   in the reveal (spec §6.2); never asked (see §5).
6. **Flag** — `mudavym_design_arrival` defaults OFF; Q4 says on for every house
   on merge (no separate flip question).

---

## 5. Founder questions ONLY (unanswered)

Skip everything already locked in
`founder-answers-2026-09-22-page-gap.md`.

### Q1 — Sketch 115 action boxes on Arrival folios (was page-gap Q6)

Inside the Arrival book, how should “what do I do next” look on each folio?

- **(Recommended) B — one slip, one act** — One ranked next action in one fixed
  place per folio. Cost: matches “keep it simple”; sketch’s own winner; small
  UI build on #414.
- **A — the note in the margin** — Guidance scattered per line. Cost: least
  tiring to read; weakest single call-to-action.
- **C — the docket** — Full act list on the folio. Cost: most complete; most
  “too much at once.”

(Images were shown from backup commit `9c8d181d3`; sketch tree not on `main`.)

### Q2 — Low-confidence registers in the get-started “pour” reveal

**Superseded 2026-09-22 by [ADR 0213](../../decisions/0213-get-started-is-account-then-house-then-first-proof.md) F7=A:** one footer line on the first proof (*"Not on this menu: …"*). The three options below are historical.

After menu upload, when beer/spirits/etc. infer as `unknown`/`none`, how loud?

- **(Recommended) Keep honest `unknown`/`none` language visible** — Cost: less
  “magic,” more truthful; matches existing service basis strings.
- **Flatten into a single confident-looking reveal** — Cost: prettier first
  moment; risks overclaiming on non-wine.
- **Hide unknown registers until evidence exists** — Cost: cleanest screen;
  user may think the house only pours wine.

### Q3 — Confirm mobile is out of this deploy (was Q12 conditional)

Verified: no mobile sketches/tokens/builds beyond OD-106’s doc-only map. Per
your own condition that resolves to **not in this deploy**. Confirm?

- **(Recommended) Yes — web page-wave only** — Cost: zero mobile work this wave.
- **No — pause web until a mobile artifact exists** — Cost: blocks the wave.
- **No — invent a minimal phone pass anyway** — Cost: contradicts your
  “must already be in the artifacts” rule; large unscoped build.

---

## 6. Purely mechanical — fix without asking

- Rebase all `DIRTY` PRs (almost every page PR conflicts on `CLAIMS.jsonl`
  and/or `useMudavymDesign` / `feature-flag-registry` / `App.tsx`).
- Re-run CI after #442 so Audit Gate no-credit no longer falsely blocks.
- #448: bind/fix the 2 new swallowed-read sites (or honestly shrink baseline).
- #419/#420: fix or inherit the `getDigestPref` absence-is-not-failure test.
- #414: rename four migrations past current main ceiling; drop/fix dead
  `C2-adopt.md` citations; fresh audit; then implement redesign + Q6 pick.
- #434: Q9 heat-map wire landed on `320d06736` — hold for founder empty-until-sales
  confirmation, then CI + audit (do not merge without gate PASS).
- #413: add persistent routine revoked-access banner on `/connections` (Q8
  already decided).
- #415: resolve modify/delete on deleted `prod-smoke.spec.ts`.
- #449/#450/#451: rebase onto `b57380288` and re-check (likely green).
- Receiving: open PR from `feat/page-receiving` implementing Approach 1
  (thresholds already proposed).
- Founder-only keystroke (not a question): `VITE_MUDAVYM_PUBLIC=1` on Vercel
  web + redeploy — unless waiting for #426.

**Merge order reminder (from locked answers):** #452 white ground → #437 shell
→ page PRs; #439 migration guard before migration-carrying PRs (#414/#415/#437
family); do not race the deploy worker on #437/#439/#452.

---

## Disclosures

- Did not signed-in browse production (E2E account still founder-owned per Q15).
- LIVE_PAGES body claims use bundle string presence + `main` source, not a
  pixel walk of every page.
- #413 banner gap inferred from path grep, not a full connections UX audit.
- #434 heat-map wire is on head `320d06736` (`readTillLines` ← `pos_checks.items`
  for non-wine; claim `ADR-0160-Q9-NON-ALCOHOLIC-HEATMAP-LIVE-SALES`). Remaining
  merge gate is founder empty-until-sales acceptance + CI/audit, not missing code.
- Vercel “Deployment rate limited” on several PRs is an account limit, not a
  code defect.
- Did not update `.planning/07-reference/INDEX.md` (single-file write allowance).
