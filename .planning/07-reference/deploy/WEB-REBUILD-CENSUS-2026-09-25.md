# Web rebuild census, 2026-09-25 — the corrected record

**Measured against** `origin/main` = `059169a59` (#462, merged 2026-09-23T05:46Z). Production
serves that commit: the gateway's `/api/v1/health/live` answers
`"commit":"059169a592f6…","bootedAt":"2026-09-23T05:47:28.905Z"`, and mudavym.com serves
`assets/index-DgyBtnzD.js` (2,212,309 bytes), which carries the 20-key `LIVE_PAGES` literal
`"dashboard",…,"logs","settings","help","cellar","menu"` (both re-measured by curl on
2026-09-25 by the records lane).

**Where this comes from.** A read-only census of the web rebuild (session 6c6d8b93,
2026-09-25) wrote a synthesis (the lane plan), a completeness critic and an adversarial
pass into a session scratchpad, which is not durable. This file is their merge. Where the
critic or the adversary overturned the synthesis, their correction is applied; where they
disagreed with each other, or a claim carried a number, the records lane re-measured it
(§0). Nothing here is a new decision; every fork is in §4.

**Retire-to-write (CLAUDE.md §4).** This file retires
`07-reference/deploy/PAGE-WAVE-BLOCKERS-2026-09-22.md` (tombstone in §10): every PR it
tracked has merged or is re-planned in §3, and every founder question in its §5 is answered
(§8.1).

---

## 0. What the census got wrong, and what holds

| # | The synthesis said | What is true | Evidence |
|---|---|---|---|
| J1 | Shell and admin are ON in the database for every house but default OFF in code, so a new house gets legacy | **Holds.** Who set the rows to ON, and when, cannot be read from the table | Production read-only `SELECT … FROM restaurant_feature_flags` at 2026-09-25T21:11:10Z: 14 rows, 14 houses, shell 14, admin 14, arrival 0, authorize_integration 0, recommendations 0, receiving 1; `restaurants` 14. The table has `created_at` and no updated-at or updated-by column. Registry `defaultValue: false` at `feature-flag-registry.ts:103` (shell) and `:130` (admin) |
| J2 | All nine public pages are live Mudavym doors; `VITE_MUDAVYM_PUBLIC` is no longer read | **Holds** | `publicDesign.ts:16,24`; `git grep -l publicDesign -- apps/web/src/pages/*.tsx` lists all nine; #426 = `410534a21` |
| J3 | Sketches 107–113 were reviewed; builds are owed, not reviews | **Holds** | ADR 0160 §106–§113 |
| J4 | Sketch 122 (recommendations) is `origin/wip/2026-09-19/recs-sketch` | **Wrong ref.** That ref is `2a1d36a23`, "round-4 state, NOT READY". Round 6 is `origin/wip/2026-09-21/recs-sketch` = `d6120adaa` (`.planning/sketches/122-recommendations-round-5/`) | `git log -1 2a1d36a23`; `git ls-tree d6120adaa .planning/sketches/` |
| J6, R7 | ADRs 0164, 0165 and 0191 and the page lanes exist only as uncommitted files | **Refuted.** All three ADRs are pushed. The dirty `wt-pg-*` and `wt-sessions` trees are byte-identical to `origin/wip/2026-09-19/<lane>`, which is an ancestor of the newer `origin/wip/2026-09-21/<lane>` | 0164: `origin/wip/2026-09-21/sessions` `900266b7c`; 0165: `…/promos` `872baff9d`; 0191: `…/fin-recs-catalogue` `c7db79871`. Hash comparison per dirty file (critic G1, adversary §5) |
| L6(b) | Finish `wt-pg-receiving`, Approach 1, with `RcVerdictLedger` and the append-only verdict migration | **Refuted.** The founder ruled the verdict ledger stripped on 2026-09-21; `wt-pg-receiving` is the pre-strip 2026-09-19 snapshot and predates Q7 (2026-09-22). Nothing in it is Approach 1 | Strip commit `8ea44f527` on `r5/receiving`, pushed as `origin/wip/2026-09-21/receiving` = `30a8c7ce7` |
| J7 | #440 has no open founder forks ("Take all five") | **Refuted by the PR, then answered.** #440's body, Round 3, returns three questions. Round 6z answered all three (§8.2): "Manager: on only", "Past shown, future open", "Delete those". #440's head `93c1d257b` (2026-09-22T13:10Z) does not build them | `gh pr view 440` body lines 88-91 |
| R9 | Only `wt-scorecard`'s `20260922024000` needs renumbering | **Understated.** 31 migrations across seven open PRs sort below main's newest `20260922231300`, and `supabase/migration-order-exceptions.txt` holds no entries: #436 15, #440 4, #435 3, #422 3, #438 2, #441 2, #429 2 | `git diff --no-renames --diff-filter=A --name-only $(git merge-base origin/main <head>) <head> -- supabase/migrations/`. The critic's "#436: 8" is wrong |
| R11 | Merging #429 before #410 keeps three web send flows alive | **Refuted.** #429 (47 files) touches none of them. All three still POST `/notifications/send-email`, so #410 breaks them in any order | `QuickGmailModal.tsx:207`, `email-scheduler.ts:85`, `RecurringOrders.tsx:137` |
| §1b | Why `provider_conversation_agent` is down is unverified | **A lead exists.** Railway logs for the running orchestrator show `Failed to start agent provider_conversation_agent: Invalid value for queue` (critic G13.1, not re-read by this lane). The first red `Deploy to Production` run is #415's merge | Runs: last success `35795292735` at `3579fa0c7`; first failure `35800299062` at `cc73f9f66` (#415), 2026-09-23T00:03Z; all 11 since have failed (`gh run list`, re-measured) |
| R4 | CLAIMS shows 5 REGRESSED rows | **A local-venv artefact.** 484 of 484 hold on a clean clone (critic) and on this lane's fresh worktree | `scripts/check_decision_claims.sh` |
| L15 | Jev is only the coding-agent prompt hook | **False for #435.** Its branch POSTs masked vendor mail to TypeSafe | `origin/feat/vendor-scorecard:apps/api-gateway/src/vendor-tone/jev-tone.client.ts` (critic G7) |
| G8 | Credits, discovery and sentiment live only in legacy | **Refined.** Credits and sentiment *render legacy inside live pages*; discovery is reachable by no house | Credits: `ReceiptsNext.tsx:75-79,1312-1315` renders `ReceiptsPage` for `?tab=credits`. Sentiment: `TwinSheet.tsx:33-35,155` lazy-loads the legacy `ProviderIntelligencePanel`, whose Sentiment tab renders `ProviderSentimentChart` (`ProviderIntelligencePanel.tsx:6,116`). Discovery: only legacy `Providers.tsx:152-246`; `ProvidersNext` reads no search params, so `/distributors` → `/providers?tab=discover` lands on the roster |
| counts | ~16,730 legacy lines; 8 Dependabot PRs; 1007 remote branches | 19,144 lines across 17 files; 52 open PRs, 17 of them Dependabot; 539 heads on `origin` | `wc -l` over the 15 files of the route census plus `WineLibrary.tsx` (1,911) and `useWineLibraryPage.ts` (353); `gh pr list --state open`; `git ls-remote --heads origin` |

---

## 1. Where we are

### 1a. Every route on main (67 `path=` entries, `apps/web/src/App.tsx` at `059169a59`)

"Code" means the key is in `LIVE_PAGES` (`useMudavymDesign.ts:125-146`) and resolves with no
database read. Flag states are the 2026-09-25T21:11Z production read above.

| Route (App.tsx line) | Key | State | Mudavym component | Legacy still mounted | Note |
|---|---|---|---|---|---|
| `/` (361) | dashboard | Live, code | DashboardNext | Dashboard.tsx 1861 | |
| `/inventory` (369) | inventory | Live, code | InventoryCommandPage in both slots | none | The gate only mounts the header |
| `/orders` (376), `/orders/:id` (383) | orders | Live, code | OrdersNext | Orders.tsx 3479 | F2 (OD-152) |
| `/receiving/:orderId/door` (289) | receiving_door | Live, code | DoorNext | receiving/DoorReceipt.tsx 543 | No chrome |
| `/providers` (430) | providers | Live, code | ProvidersNext | Providers.tsx 1599 | Sentiment renders legacy; discovery unreachable (G8) |
| `/communications` (461) | communications | Live, code | CommunicationsNext | Communications.tsx 607 | Live error banner (F1) |
| `/team` (455) | team | Live, code | TeamNext | team/command/TeamCommandPage.tsx 40 | #440 open |
| `/receipts` (463) | receipts | Live, code | ReceiptsNext | ReceiptsPage.tsx 511 | `?tab=credits` renders legacy (G8) |
| `/documents-reports` (462) | documents_reports | Live, code | DocumentsReportsNext | DocumentsPage.tsx 1107 | |
| `/documents/:id` (472) | document | Live, code | CanonicalDocumentPage | none (redirect) | |
| `/reports` (418) | reports | Live, code | ReportsNext | Reports.tsx 1530 | |
| `/calendar` (456) | calendar | Live, code | CalendarNext | CalendarModular.tsx 26 | #438 open |
| `/profile` (484) | profile | Live, code | ProfileNext | Profile.tsx 907 | Passkey enrolment owed (§3 L12) |
| `/connections` (491) | connections | Live, code | ConnectionsNext | none (redirect) | Revoked-mail banner built, `ConnectionsNext.tsx:319` |
| `/notifications` (482) | notifications | Live, code | NotificationsNext | Notifications.tsx 2478 | |
| `/logs` (481) | logs | Live, code | LogsNext | LogsTimelinePage.tsx 390 | |
| `/settings` (483) | settings | Live, code (#419 `24b7d5288`) | SettingsNext | Settings.tsx 1604 | |
| `/help` (496) | help | Live, code (#413 `490e9962d`) | HelpNext | Help.tsx 198 | |
| `/wines` `/cellar` `/beer` `/whiskey` `/cocktails` `/spirits` `/non-alcoholic` `/soft-drinks` (401-412) | cellar | Live, code (#434 `92ea9cecc`) | CellarNext | WineLibrary.tsx 1911 + useWineLibraryPage.ts 353 | |
| `/menu` (417) | menu | Live, code (#434) | MenuNext | none (redirect) | |
| *(layout)* | shell | ON 14/14 in DB; code default off | the counter shell (#437) | legacy Sidebar layout | L4 moves it to code |
| `/admin` (499), `/admin/health` (500) | admin | ON 14/14 in DB; code default off | AdminDesk (#415) | legacy admin pages | L4 moves it to code |
| `/authorize/:integrationId` (345) | authorize_integration | Gated, OFF 14/14 | AuthorizeIntegrationNext + AuthorizeShell (#430) | legacy authorize page | L4 moves it to code |
| `/receiving` (385) | receiving | Gated, ON for 1 of 14 | ReceivingNext (pre-Approach-1 desk) | legacy desk | L6; F7 |
| `/recommendations` (419), `/recommendations/catalog` (421) | recommendations | Gated, OFF 14/14 | RecommendationsNext, CatalogView (#420) | legacy | Dark until sketch 122 is reviewed |
| `/get-started` (217) | arrival | Flag OFF 14/14, so every house gets the ADR 0213 flow, which sits in the `legacy` slot | #414's Arrival (1413 lines) is dormant in the `next` slot | n/a | Slots inverted (R14, F5) |
| `/house` (223), `/house/menu` (231) | none | Always on, ungated | HouseContents, HouseMenu | none | ADR 0213 first proof (#455); no page note |
| `/login` (202), `/register` (203) | public | Live, improved in place | the pages themselves | the public switch's off branch | |
| `/forgot-password` (204), `/reset-password` (205), `/verify-email` (206), `/invite/:code` (207), `/no-access` (208), `/privacy` (211), `/v/:slug` (214) | public | Live Mudavym public doors (#426) | PublicShell | the public switch's off branch | `/privacy` legal facts deferred (OD-132) |
| `/vendor-prices` (434) | none | Legacy only | none on main | VendorPriceCompare.tsx | L9 |
| `/promotions` (447) | none | Legacy only | none on main | Promotions.tsx | L8 |
| `/sommelier` (508) | none | Legacy only, superseded by `/ask` | none | SommelierAI.tsx | L11 |
| `/ask`, `/terms` | none | **No route** | `/ask`: backend only (#430) | n/a | `/terms` is presupposed by ADR 0145:1040-1042 and `Privacy.tsx:21-27` |
| `/studio` (242), `/studio/queue` (252), `/studio/certify` (260), `/studio/invite/:token` (274) | none | Internal | none | stays | ADR 0149 row 32 |
| `/simpos/:restaurantId` (304), `…/orders` (312), `…/scenarios` (326) | none | Internal; redirects to `/` in production | none | stays | ADR 0149 row 4 |
| `/dev/truth` (440), `/dev-sandbox` (512) | none | Internal | none | stays | ADR 0143 §14 |
| `/onboarding` (238), `/inventory-legacy` (375), `/distributors` (444), `/calendar-classic` (460), `/credits` (464), `/services` (509) | none | Redirects | n/a | the redirect lines | |
| `/authorize/complete` (341), `/deliveries/:id` (400), `*` (524) | none | Utility (OAuth landing, delivery→order, ShellCatchAll) | n/a | n/a | |

**Totals:** 28 live in code · 7 gated (plus the shell layout) · 9 live public · 2 always-on
house · 3 legacy only · 9 internal · 9 redirect or utility = **67**. The route census's
residual is `/orders/:id`: the six routes added since ADR 0149's `60ed83a7` baseline of 61
are `/authorize/complete`, `/deliveries/:id`, `/house`, `/house/menu`, `/menu` and
`/orders/:id` (critic G15).

### 1b. Production, 2026-09-25

- Web and gateway serve `059169a59` (header of this file). The orchestrator's and mobile's
  running commits were not checked.
- `Deploy to Production` has failed on all 11 runs since `cc73f9f66` (#415's merge,
  2026-09-23T00:03Z). The failure is `provider_conversation_agent` reporting `status: error`
  (R2). It does not stop Vercel or Railway from deploying; it does leave the deploy audit
  unproven.
- Production E2E reports CANNOT-CHECK daily on four missing secrets (founder-owed item 4).
- The Railway `@wineops/web` service answers 502 with `x-railway-fallback: true` while
  reporting Online (critic G16; not re-measured). The web is served by Vercel.

### 1c. What other accounts left inconsistent

1. **The merge race.** STATE.md:8 and ADR 0213:17-19 (at `059169a59`) said "do not merge #414/#454" and
   "#415/#430/#434 stay with their owner". All five had merged before #455, which carried
   those lines, merged: #415 `cc73f9f66` 23:53Z, #430 `e2abd7844` 00:43Z, #434 `92ea9cecc`
   01:29Z, #454 `162f25ade` 01:42Z, #414 `8ec925aa7` 01:59Z, then #455 `ddc5e094b` 02:33Z
   (2026-09-22/23 UTC, `gh pr view <n> --json mergedAt`). Both records are bracketed in this
   PR. The practical intent survived: the arrival flag is off and every house gets ADR
   0213's flow.
2. **Report files that never reached a ref.** `PAGE-GAP-QUESTIONS-2026-09-22.md`,
   `PAGE-GAP-REPORT-2026-09-22.md`, `RECEIVING-DESK-PROPOSAL-2026-09-22.md` and
   `PREVIEW-NOTES-2026-09-22.md` exist in no ref (`git log --all -- <path>` is empty). Sketch
   121 (`.planning/sketches/121-*`) is in no ref and no worktree either. The founder's
   answers they held are copied into §8.
3. **Cursor PRs never audited.** #412 and #410 are open security fixes with no audit verdict (no comment on either mentions `pr-audit-gate` or a `verdict=`, `gh pr view --json comments`).
4. **#457 is BLOCKed** on locked ADR 0083 (F1); its useful half moved to #458.
5. **Codex #374** dropped the OD-123 filing; it was re-filed (`OPEN-DECISIONS.md:77`) and is
   now answered in place (Q10).

---

## 2. What "done" means

His goal, 2026-09-16 (ADR 0149:11-14): *"complete every page there is … and remove legacy
pages and actually full delete them … So finish the mudavim.com and deploy it."* The
decision (ADR 0149:58-64): every remaining page to the full-purpose bar, then **one**
cutover merge that deletes only the file groups he approves. Never deleted: any table,
column, row, house, user or migration (:75-77). Gated stops (:146-148): every sketch he
asked to review, and the deletion manifest, group by group. Web only this deploy (Q12).

**DONE =** every route in §1a on a Mudavym design at the full-purpose bar, *every surface on
it* rebuilt (G8: a live route is not the same as a rebuilt route), live for every house
including houses created later, captions at AA (OD-112 (OPEN-DECISIONS.md:70): 322
`var(--ink-3)` uses against 183 `var(--ink-4)` in `apps/web/src` today), the manifest
approved group by group, one cutover PR merged and deployed, production verified at that
commit.

---

## 3. The lanes, corrected

**Rules every lane keeps.** One worktree and one branch; commit explicit paths; merge
`origin/main` in, never rebase or force-push; `/pr-audit-gate` at the head SHA (the CI gate
audits nothing while it is out of credit, R1); every new migration takes a version newer
than main's newest, renumbered at merge time by the merge-train owner (R9). Shared ledger
files (`CLAIMS.jsonl`, `OPEN-DECISIONS.md`, `decisions/README.md`, `DELIVERY-AUDIT.md`,
`v3.0-TECH-DEBT.md`, `scripts/read_error_baseline.json`, `07-reference/INDEX.md`) are
resolved by L2 at merge time. Flag files (`useMudavymDesign.ts` + test,
`feature-flag-registry.ts`) belong to L4. Spine docs belong to L1.

| Lane | Scope | Base and ordering | Corrections applied |
|---|---|---|---|
| **L1** Records | This PR: this census, STATE.md, LIVE-CHECKLIST.md, OPEN-DECISIONS.md brackets, ADR 0213/0160/0149 brackets, PROGRESS.md | Merges first or second | Also owed: the reviewed sketch directories (106–117, 120 on `origin/wip/2026-09-21/fin-sketches` `9c8d181d3`; 122 on `…/recs-sketch`) are not on main, and ADR 0160 cites them (critic G14); page notes for `/menu`, `/house`, `/ask`, `/terms` (G9) |
| **L2** Merge train | Serial merges: #449 first (CLAIMS parser), then #451, #450, #425, #394, #405, #445, #433, #443, #431, #409. Closes on the founder's yes: #457, #456, #404, #390, #389, #368, and #374 after L13 | Needs L1 | #405's PASS marker equals head `29fe6dfac`, but the PR is CONFLICTING, so resolving it needs a fresh audit. #368 is superseded by #391 (critic G4). Dependabot: fast-track #344 (react-router patch, closes a medium alert) and #379; take #345 (nodemailer, closes five alerts) with a send-path test; decide #346 vs #382 on the two critical vitest alerts; triage pip #339–#343; hold #383, #382, #378, #381, #380, #377 until after cutover; close or hold #375 (G5) |
| **L3** Security | #427 (Sentry token leak, re-audit at `ef4206bed`), #416, #412, #446, #395, #423, then ADR 0185 step 2 (CSP report-only) | L2's CLAIMS-first order | Add: the conversations cross-house read (`conversations.controller.ts:260-310`; fix preserved on `origin/wip/2026-09-19/others/admiring-stonebraker-*`); the Python twin of #405's double-send vector (`provider_conversation_agent.py:2646-2665` classifies send refusals with `re.search` over free text; no `v3.0-TECH-DEBT` row yet); #362 (`ci.yml:1484` runs `trivy-action@master` with no `exit-code`, and `CI Complete` needs `security`) |
| **L4** Flags to code | Move `shell`, `admin` and `authorize_integration` into `LIVE_PAGES` and `LIVE_IN_CODE_FLAGS` (branch `feat/live-shell-admin-authorize`); later each page lane's promotion | None for these three | A house created today gets the legacy shell and admin (J1): nothing seeds a flag row at house creation |
| **L5** Settings cluster | Serial: #440, #441, #448, #435, #438 | After #449 | #440: build round 6z's three answers (J7). #435: rebuild to 6z's "Every owner, next sign-in" (its pushed head `a113e00dd` builds the opposite; the correction sits only in `wt-scorecard`'s dirty tree) and add sentiment (scorecard3, rounds 6e/6m/6n). All five PRs renumber migrations (§0 R9) |
| **L6** Action integrity, then receiving | (a) Reconcile #436 (283 files; carries "Staff ask, manager sends" and "Shelf count from ledger") plus `wt-r5-E`'s 29 unpreserved files. (b) The receiving desk | **Base (b) on `origin/wip/2026-09-21/receiving` `30a8c7ce7`**, not `wt-pg-receiving`. Merge after #435 and #395 | Build Approach 1 new; land no `RcVerdictLedger*` and no `20260919170000` verdict migration; ask F7 before building history paging; carry the branch's register edits (it narrows a desk-binding fork, number 125 on that ref only, not on main) |
| **L7** Communications | Serial: jolly-lovelace's ADR 0161 + guard + letters half, then #429, then rewire or retire the three `send-email` callers, then #410, then Senders (`origin/wip/2026-09-19/others/reverent-lamarr-4a8be2` `5b575e403`), then the F1 fix, then #422, then ADR 0173's catalogue and ADR 0174's email look | Senders before L8's `/promotions` cut | #429's relay code cites ADR 0161, which exists on no ref's tracked tree (critic G13.4). CodeQL: #422's one high is the `gmail.service.ts` `js/xss` already open on main; #429 adds two spec-file alerts (critic G13.5) |
| **L8** Promotions | ADR 0160 §113 (B with C's density), ADR 0165; draw the bundle shape and the sized boxes first | **Base `origin/wip/2026-09-21/promos` `872baff9d`**; after #416 and L7's Senders | |
| **L9** Vendor prices | ADR 0160 §112 | **Base `origin/wip/2026-09-21/vprices` `41e9060c8`**; after #416, #412 | |
| **L10** Recommendations | (a) Commit `wt-recs-cat`'s staged round-6 delta on top of `c7db79871` and open the PR. (b) Show him sketch 122 round 6. (c) Build his round on #420. (d) Flag to L4 | (c)–(d) wait for his review | Point him at `origin/wip/2026-09-21/recs-sketch`, not the wip-19 ref (J4) |
| **L11** `/ask`, `/terms`, retire `/sommelier` | Record the 2026-09-21 `/ask` layout in ADR 0145 first (§8.2), then build the page, the non-modal quick ask and the `/admin` requests list; add a `/terms` route | **Unblocked**: ADR 0145:264 "all five forks this record named are answered"; sketch 114 is on `…/fin-sketches` | The layout decision is not on main (no "Reading Room" or "requests list" in ADR 0145) |
| **L12** Sessions | ADR 0164 | **Base `origin/wip/2026-09-21/sessions` `900266b7c`** (contains `wt-sessions`) | Add passkey enrolment on `/profile` (ProfileNext says "Not built", round 6r §7) and the real-switch consent panel (round 6r fork 14; supersedes ADR 0149 row 14); "reset/change revokes sessions" (ADR 0173 lane) |
| **L13** Audit of unlanded work | Classify each tree as landed, unique or abandoned, with a diff | Feeds L2, L16 | Add the 15 trees no census file classified (critic G4), `origin/test/nightly-e2e-modernised` `d84e86ba9` (likely superseded, one diff settles it) |
| **L14** Pipeline | (a) `provider_conversation_agent` from the log line and #415's diff; (b) CLAIMS walkers scan tracked files only; (c) unshallow the shared clone; (d) Production E2E exits on named missing secrets; (e) CodeQL with L7; (f) #432 | | Push `wt-r5-gate`'s local `c59d8f71b` ("close the four remaining gate8c residuals") into #432 before its last call; `wt-gate-rule` is superseded (its 46 files equal `origin/wip/2026-09-19/gate`, an ancestor of #432's head `d45147f42`). Add OD-122 (OPEN-DECISIONS.md:76) |
| **L15** Jev | (a) Keep `check_jev_never_blocks.py` green; (b) measure subagent egress without contacting TypeSafe; (c) land #431 via L2; (d) #435's product egress fails open, with a never-blocks spec for `jev-tone.client`; (e) masking covers names and sensitive topics (round 6y) | F4 | Partial measurement: an Agent-SDK subagent context carried no Jev annotation (critic G7); Task-tool subagents unmeasured |
| **L16** Worktree hygiene | Step 1 preserves only what no ref holds (next table); step 2 removes, on the founder's word | After L13 | The old preservation list protected trees already on origin (J6) |
| **L17** Cutover | The manifest as file groups, each with an import-graph proof (a trial delete plus tsc/vitest), special-casing `/get-started` (R14) and `/inventory` | Last; his approval per group | `ReceiptsPage.tsx`, `Providers.tsx` and the provider intelligence/sentiment components stay off the manifest until G8's three surfaces are rebuilt |

**Genuinely unpreserved work (L16 step 1).** Newer than every snapshot and absent from every
ref (critic G3, mtimes and hashes; not re-measured by this lane): `wt-recs-cat` staged (7
files: ADR 0191 edit, round-6 spec, `20260922021000` migration + pgTAP); `wt-r5-E` (29
files, round 6j–6z build); `wt-r5-gate` commit `c59d8f71b` (confirmed not an ancestor of
#432's head); `wt-r5-settings` (5 local-only commits, probably moot); `aa0779eed` (#423's
local merge); `wt-scorecard` (24), `wt-areas` (7), `wt-labor` (6); `wt-fin-KL` (19),
`wt-r5-KL` (9); unclassified: `wt-fin-live`, `wt-fin-links`, `wt-arrival-first-proof`,
`wt-pr430-prep`, `pr-415-prep-wt`, `wt-e2e`.

---

## 4. Open founder forks

Checked against ADR 0149, ADR 0160, `OPEN-DECISIONS.md` and §8. Each is asked when its lane
has something to show, except F1, which is live.

| # | Fork | Options and cost | Recommendation |
|---|---|---|---|
| F1 | `/communications` shows an error to every house because `public.scheduled_reports` is created by no migration (ADR 0083:58-68; production `to_regclass` is null). #457 removed the source and was BLOCKed on ADR 0083 | (a) Amend ADR 0083: the page names the three sources it owns; schedules leave until a table exists; the Gmail-watch line moves to `/admin`. (b) Build the table and feature. (c) Render the missing table as "not set up" | (a), matching his 2026-09-22 ruling to strip technical detail from the restaurant UI (§8.1, preview ruling 2). OD-91 (OPEN-DECISIONS.md:61) and OD-92 (OPEN-DECISIONS.md:62) bear on (b) **[ANSWERED 2026-09-25: (a), amend ADR 0083 (§11 item 1). The amendment is the comms lane's (W1 comms-a), not written here.]** |
| F2 | OD-152 (OPEN-DECISIONS.md:84): what a bare click on an `/orders` row does | (A) opens the receipt sheet as ruled; (B) keep the expansion; (C) receipt when one exists, expansion while pending | (C) **[ANSWERED 2026-09-25: (C) (§11 item 3). OD-152 moved to Resolved.]** |
| F3 | OD-140 (OPEN-DECISIONS.md:24): return the not-placed lines, not only their count | Yes: a gateway field plus the control sketch 121 draws. No: a count with no follow-through | Yes **[ANSWERED 2026-09-25: yes, as a separate list endpoint (OD-140's option (a); §11 item 5). OD-140 bracketed ANSWERED in place; it stays in the Open table until lane W1-orders-cellar's build merges.]** |
| F4 | OD-133 (OPEN-DECISIONS.md:85): **only the retention and DPA terms** remain. Egress is decided (ADR 0182) and the register was widened to add TypeSafe as a subprocessor (round 6y, §8.2) | (a) DPA; (b) accept retention as-is, in writing; (c) scope the gate | (a) **[ANSWERED 2026-09-25: (a), by his word "TypeSafe is already done" (§11 item 8). OD-133 moved to Resolved. The DPA document itself was not seen by this lane.]** |
| F5 | #414's dormant Arrival book (1413 lines) | (A) its own manifest group; (B) revert now; (C) keep as an alternative | (A), after confirming sketch 121 §7.3's binding three counts are carried by `/house/menu` or superseded by ADR 0213: `HouseMenu.tsx` shows no read/placed/not-placed counts today (critic G16) **[ANSWERED 2026-09-25: (A) (§11 item 4). Recorded as ADR 0149's deletion-manifest note. The sketch 121 §7.3 three-count check in this row's recommendation is still unmeasured.]** |
| F6 | OD-151 (OPEN-DECISIONS.md:25): a Google Calendar grant | Build (new scope, consent copy, sync) or defer | Defer until L13 reports on the two calendar-push trees |
| F7 | **Receiving history paging vs the verdict-ledger strip.** Q7's Approach 1 (2026-09-22) includes "a line's full verdict history … paged 10-at-a-time"; on 2026-09-21 he ruled the verdict ledger stripped because it was not bulletproof | (a) Approach 1 without per-line verdict history until a ledger passes his bar; (b) rebuild a bulletproof ledger first; (c) history from existing receipt rows only | Ask with L6's first draft **[ANSWERED 2026-09-25: (c), history from the door receipts already recorded; the ledger strip stands (§11 item 2). Recorded in ADR 0160 §107 / Open item 4.]** |
| F8 | **The receiving desk's binding** (ADR 0104 D13: re-key on `deliveries`, or stay on `procurement_orders`; is the queue finished as B+). Filed on `origin/wip/2026-09-21/receiving` only | as filed there | Carry the row to main with L6 |
| F9 | **#405's Gmail classification**: 5xx/429 kept ambiguous, 403/404 made definite — "a choice flagged to the founder in the PR, not locked" (memory `send-refusal-typed-classification-pr-405.md:12`) | as the PR states | Ask at #405's re-audit **[ANSWERED 2026-09-25: keep the split (§11 item 6). Recorded by #405's lane, not here.]** |
| F10 | **ADR 0173 decision 3** stays proposed (`0173…:3`) | as the ADR states | Ask with L7's catalogue |

**Answered, not forks** (each was listed open by the synthesis): #441 / ADR 0218's items
(answered per its branch, `origin/feat/house-areas`, critic G6; only lawyer items remain); #435 Q19–Q20 (round 6z, §8.2; the pushed head
diverges, L5); #435 sentiment (6e/6m/6n); #433 / ADR 0134 §4, §5, §7, §8, §9 and fork 14 (6r;
only fork 14's *store* question was never asked); #436's no-master delivery (6j, 6u); ADR
0145's five forks (0145:264) and the `/ask` layout (2026-09-21); #432's merge word (6b,
conditional on round 8, then 6t and 6z); #440's Round 3 (6z); the Vercel plan (6v); sketch
115 (closed without a winner, sketch 121 chosen); the `VITE_MUDAVYM_PUBLIC` keystroke (J2);
flipping shell and admin (J1).

**Lane-owned, still open:** ADR 0160 §112's three unlisted questions and §113's fork-6
coupling plus two drawings; ADR 0165's three open items; sketch 122's five recommendations
questions; ADR 0149 row 53's residual (expired or self-revoked vs revoked for cause);
#433's fork-14 store question.

---

## 5. Founder-owed actions

1. Answer F1–F10 as each lane reaches them (F1 now). **[2026-09-25: F1, F2, F3, F4, F5, F7 and F9 answered (§11); F6, F8 and F10 remain.]**
2. Review sketch 122 round 6 (`origin/wip/2026-09-21/recs-sketch`), which unlocks L10(c).
3. Look at the two §113 drawings when L8 draws them.
4. Set the four GitHub secrets Production E2E names as missing (`SUPABASE_SERVICE_ROLE_KEY`,
   `RABBITMQ_URL`, `SENTRY_DSN`, `E2E_LEGACY_RESTAURANT_ID`, run `36105466598`), or rule which
   checks to drop. **[2026-09-25, his words (§11 item 8): "skip production e2e secret, and CI audit gate claude api. I'll add them" — later, his action; still owed.]**
5. Anthropic credit for the CI PR Audit Gate, or knowingly keep #442's bypass. **[2026-09-25: he will add it (item 4's quote); still owed.]**
6. A Railway `JEV_API_KEY` for the gateway if #435's Jev path is to run (critic G7). **[DONE by his word 2026-09-25: "Jev api key added, redeploying" (§11 item 8); the variable was not read by this lane.]**
7. A yes to close #389, #390, #404, #456, #457 and #368 now, and #374 after L13; a yes to
   remove the safe worktrees after L16 step 1. **[2026-09-25: granted for #456, #457, #389, #390 and #404 (§11 item 7), all five closed 21:21:22Z–21:21:30Z (`gh pr view --json closedAt`). #368 and #374 were not in the grant and are still open; the worktree removal is still owed.]**
8. The TypeSafe DPA if F4 is (a). **[DONE by his word 2026-09-25: "TypeSafe is already done" (§11 item 8); OD-133 resolved.]**
9. Who set shell and admin ON in the database, for the record (optional; the table cannot say).
10. The deletion manifest, group by group, last.

Struck from the synthesis's list: #432's merge word (given, §8.2), the Vercel plan (Pro is
active by his word, §8.2 round 6v; billing not seen by us), and `authorize_integration`'s
go-live, which L4 now carries under Q2/Q4.

---

## 6. Contradictions between records

| # | Record A | Record B | Winner | Status |
|---|---|---|---|---|
| C1 | STATE.md:8, ADR 0213:17-19: do not merge #414/#454 | Merge history (§1c.1) | Git | Bracketed in this PR |
| C2 | STATE.md, LIVE-CHECKLIST: 16 live; settings, cellar held; help legacy | `useMudavymDesign.ts:125-146`: 20 live | Code | Fixed in this PR |
| C3 | Registry defaults: shell/admin OFF | Production: ON 14/14 | Production for today's houses, code for tomorrow's | L4 |
| C4 | LIVE-CHECKLIST: seven public pages legacy; `/login` switch off | `publicDesign.ts:16,24` (#426) | Code | Fixed in this PR |
| C5 | LIVE-CHECKLIST: sketch reviews owed | ADR 0160 | ADR 0160 | Fixed in this PR |
| C6 | ADR 0160 §108: sketch 122 is recommendations | `research-122-squad/`, ADR 0213:11,72: sketch 122 is get-started | Number collision; the recommendations use (2026-09-19) came first | Bracketed in ADR 0160 §108 |
| C7 | "ADR 0134 does not exist" | #433's body: locked 2026-09-21 | Both: it is on #433's branch only | Lands with #433 |
| C8 | A reader: #433 merged | `gh pr list`: #433 open | Open | None needed |
| C9 | Memory `ci-audit-gate-out-of-credit`: the gate goes red | #442: no-credit bypasses to success | #442 | Memory not edited by this PR |
| C10 | Memory `four-fixes…`: #448 green | Live CI on #448: the swallowed-read guard and CI Complete fail | Live CI | L5; memory not edited |
| C11 | Memory cites four report files | No ref holds them | The memory's content | Copied into §8 |
| C12 | #440 body: three questions open | Round 6z: answered | 6z | L5 builds |
| C13 | PAGE-WAVE-BLOCKERS §3 | All its blocked PRs merged or re-planned | Git | Retired in this PR |
| C14 | ADR 0160 open item 3: the promotions cut waits for communications on everywhere | `communications` in `LIVE_PAGES` (`useMudavymDesign.ts:130`) since #421 | Code | Bracketed |
| C15 | OD-123 open; OD-132 unchanged; OD-124 separate | Q10, Q11 | The founder | Bracketed in place |
| C16 | A reader: the receiving desk flag is false | Production: ON for 1 of 14 houses | Production | LIVE-CHECKLIST row |
| C17 | #445's body: Vercel Pro rests on his word; preview checks hit the free-tier cap | Round 6v: Pro active by his word | His word; billing unseen | None needed |
| C18 | A reader: "49 worktrees fully redundant" | Only 13 are literal ancestors | Not a conflict: 13 ancestors + 30 merged-clean + 6 superseded-clean | L16 |
| C19 | #457: "no Mudavym inventory page exists" | ADR 0149 row 36: inventory is a locked live page | ADR 0149 | None needed |
| C20 | OD-140's Open row (:24) | OD-140's Resolved row (:92): the id "never reached `main`'s Open table" | :24; #414 brought it to main | :92 bracketed |
| C21 | ADR 0149 row 14: delete the consent panel | Round 6r fork 14: "Bring back, real switches" | 6r | Bracketed |
| C22 | Memory Q11: the /ask-terms additions to `/privacy` stay pending | `Privacy.tsx:21-31` carries round 6y's "Add to /privacy now" section via #430 (`e2abd7844`) | Code, built on a ruling the page-gap note did not mention | Noted in OD-132's bracket |

---

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | No PR is audited in CI (the gate bypasses on no credit) | `/pr-audit-gate` at head in every lane |
| R2 | The one production check is already red, so the next deploy fault hides behind it | L14(a) |
| R3 | Production E2E red every day as CANNOT-CHECK | Founder item 4; L14(d) |
| R4 | CLAIMS trips on untracked local files | L14(b) |
| R5 | Shared ledger files plus `strict: true` thrash parallel merges | One merge-train owner, #449 first |
| R6 | A shallow shared clone misreports merge bases | L14(c) |
| R7 | The work no ref holds (§3's table) is one `git clean` or worktree removal from gone; `git worktree list` shows 191 worktrees (2026-09-25) | L16 step 1 first |
| R8 | Six open PRs never ran the required contexts (#433, #435, #436, #438, #440, #441) | Fresh push before any verdict |
| R9 | 31 migrations in seven PRs sort below main's newest; each auto-applies on merge | L2 renumbers serially; `check_migration_order.py` per merge |
| R10 | Live security defects under pages being shipped (#427, #416, #412, #446, #410, #422, the conversations read, the Python send twin) | L3 first |
| R11 | #410 breaks three web send flows in any order; the promotions cut before Senders fails CI | L7 rewires the callers; Senders first |
| R12 | Jev: every prompt leaves verbatim for TypeSafe on unknown retention, and #435 adds product vendor mail | F4, L15 |
| R13 | Jev's reply is injected into every session's context | Treat it as data; `check_jev_never_blocks.py` green |
| R14 | A mechanical "delete every legacy slot" deletes ADR 0213's `/get-started` | L17 special-case; F5 |
| R15 | Parallel sessions write contradictory records (C1, C11) | L2 owns merges; L1 owns spine docs |
| R16 | Dependabot majors mid-rebuild; 8 critical, 152 high Dependabot alerts on main (critic G5) | Hold majors; take the patch and security minors (L2) |
| R17 | New houses fall back to the legacy shell and admin | L4 **[CLOSED 2026-09-25 by #463, `f7630c08b`]** |
| R18 | G8's three surfaces would be deleted by a folder-list manifest | L17 import-graph proof |

---

## 8. Founder answers that lived only in memory

These are copied **verbatim** from two project-memory files as they stood on 2026-09-25.
Quoted words inside are his; the surrounding text is the recording session's note, not his.
Paths in them that name the four uncommitted report files (§1c.2) or sketch 121 point at
nothing. One edit is marked: a private artifact link is elided.

### 8.1 Page-gap answers, 2026-09-22 (memory `founder-answers-2026-09-22-page-gap.md`, lines 14-163)

```text
**Answered (write into each PR/ADR as a bracket, verbatim):**
- Q1 audit gate: **bypass** — merge #442, then merge the rest on its green with no
  Claude-API audit. Refined by Q5 below: for PRs of real consequence, do the audit
  work ourselves (Cursor session, separate quota) rather than merge blind.
- Q2 public door: founder sets `VITE_MUDAVYM_PUBLIC=1` on Vercel himself and redeploys
  — "I want all locked pages to be live (production)". Read together with Q4: every
  currently-dark per-house design flag goes live everywhere once its PR merges, not
  staged per-house.
- Q3 white ground (ADR 0169, `feat/theme-white-default` @ `a89e954dc`): land FIRST,
  before the page-iteration PRs.
- Q4 counter switches (`mudavym_design_shell`/`_arrival`/`_admin`): turn on for every
  house the instant each PR merges — no staged single-house rollout. Same answer folds
  into Q2's "all locked pages live" instruction.
- Q5 arrival BLOCK (#414, gate verdict BLOCK at `sha=2466fc7`): *"you audit it and do
  the job what meant for claude api"* — do a real audit ourselves standing in for the
  rate-limited CI gate, not a blind override and not a hold. Generalizes Q1: for
  anything nontrivial, perform the actual pr-audit-gate methodology (3 angles +
  adversarial pass) using this session's own capacity.
- Q6 action boxes (sketch 115, arrival tutorial guidance): NOT decided — *"open it via
  terminal all 3 and I'll tell you or tell you to do what otherwise"*. All three
  directions (A "the note in the margin", B "one slip, one act", C "the docket")
  extracted from backup commit `9c8d181d3` (not on any live branch;
  `.planning/sketches/115-arrival-action-boxes/` does not exist on `main` or in any
  worktree) and shown to him inline. His pick is still open — ask again once he answers.
- Q7 receiving (too-many-operations list): NOT decided — delegated as a build task:
  *"whats the best approach if it was something new we're building, create from
  surface beginning and tell me about it, I'll answer back"*. Treat as a fresh UX
  design pass on the receiving desk's operations list, not just paged-vs-grouped;
  report back before building.
- Q8 help alert (revoked mail access, web banner): NOT decided — *"actually maybe we
  should not alert in mobile as well, but I disagree with myself in some sense, I need
  you to analyze find study cases or industry solutions to answer that"*. Delegated as
  an industry-research task (revoked-access / deauthorization notification patterns,
  web and mobile) before #413 ships this corner.
- Q9 heat map (non-alcoholic register, cellar #434): **now** — wire live sales data
  into the heat map before #434 merges. This is the opposite of the report's
  recommendation and adds scope/delay to #434.
- Q10 sheet click (OD-123): Reading A — background stays visible but inert; outside
  click closes the sheet, decided per page later. Matches the built default; resolve
  OD-123.
- Q11 privacy text (OD-132): keep the placeholder text for now. Resolve OD-132 as
  "still deferred", not closed with real text — the two pending /ask-terms additions
  from round5 stay pending too.
- Q12 phone look (OD-106 mobile-redesign extension): conditional — *"a redesign must
  already be in the artifacts and in the notes, so apply them, if not not in this
  deploy"*. Verified: **nothing exists** beyond OD-106's documentation-only archetype
  map (no mobile sketches, tokens, or builds — OD-106's own row says so explicitly).
  Per his own condition, this resolves to NOT in this deploy. Confirm this finding with
  him explicitly since it answers his conditional rather than picking one of the three
  offered options outright.
- Q13 phone build (OD-109): iOS Simulator here, screenshots/recording sent to him —
  not on his phone, no account needed from him. Closes OD-109's "never rendered" gap
  once run.
- Q14 app identity (mobile slug/bundle `wineops-ai`/`ai.wineops.mobile`): rename to
  Mudavym now, before any real build goes on a phone.
- Q15 E2E account: founder fixes/re-enables the existing E2E test account himself and
  re-saves its password as the GitHub secret — not a new seed-script user. His action,
  not ours; we do not create/choose/enter the credential.

**Not yet re-asked:** nothing. Q6 and Q12 were both closed later the same day — see the
follow-up block below.

**Follow-up answers, same session, after research came back:**
- Q7 receiving desk: **Approach 1** — one row per line grouped by vendor (capped,
  "show more"), a line's full verdict history opened on demand and paged 10-at-a-time.
  Thresholds (5 rows/vendor box, 10/page) stand as proposed in
  [`RECEIVING-DESK-PROPOSAL-2026-09-22.md`](../../../../../Projects/restaurant-ai-automation/.planning/07-reference/deploy/RECEIVING-DESK-PROPOSAL-2026-09-22.md).
  Build target: finish `feat/page-receiving` (uncommitted, no PR yet).
- Q8 help alert: **persistent web banner on `/connections`, routine tone** (not a
  security-style alarm), alongside the already-decided phone push. Stays up until
  reconnected via the existing `/authorize/:integrationId` flow. See
  [`HELP-ALERT-INDUSTRY-RESEARCH-2026-09-22.md`](../../../../../Projects/restaurant-ai-automation/.planning/07-reference/deploy/HELP-ALERT-INDUSTRY-RESEARCH-2026-09-22.md).
  Open gap the research surfaced, not yet decided: whether the revocation event can
  distinguish "expired/self-revoked" from "revoked for cause" (e.g. a terminated
  manager) — parked, not blocking #413.
- Q6 action boxes (sketch 115) — **answered, and the answer is "none of them."** After
  seeing A/B/C he ruled them out as drawn: *"adapt to the skyleaf, help me find and
  assemble the best one, use study cases, use industry moment, use claude opus 5 for
  research. then use opus 5 to sketch one. rest is your job."* So sketch 115 is
  **closed without a winner**; the deliverable is ONE researched, Skyleaf-adapted
  direction, not a pick among three. Standing constraints he restated with it: the
  **menu upload is the one mandatory act**; do **not** drown the user before the
  upload; after the upload, show what the house pours as a **product reveal, not a
  chore**; **"whom we buy from" stays skippable**. Delivered as
  [`.planning/sketches/121-skyleaf-next-act/`](../../../../../Projects/restaurant-ai-automation/.planning/sketches/121-skyleaf-next-act/README.md)
  ("The book opens already written" — upload moves to the flyleaf; the reveal is a
  read/placed/not-placed count carrying the service's own `basis` sentences, with no
  checkboxes; the contents page itself is the guidance, exactly one line asking at a
  time). Two forks it deliberately did NOT default: whether the flyleaf upload is a
  hard gate or a strong default with a secondary skip, and how loud un-evidenced
  registers should be (the tone fork already open as
  `PAGE-WAVE-BLOCKERS-2026-09-22.md` §5 Q2).
- Q12 mobile (was conditional): **confirmed — web only this deploy.** He accepted the
  finding that no mobile artifact exists beyond OD-106's doc-only map, so his own
  condition resolves to not-in-this-deploy. No longer an open conditional; do not
  re-ask, and do not build a phone pass for the page wave.

**Sketch 121's two open forks — ANSWERED 2026-09-22, both binding:**
- **§7.1 gate vs strong default: STRONG DEFAULT, not a hard gate.** Verbatim intent:
  "Menu upload on /get-started is a STRONG DEFAULT, not a hard gate. Upload is the
  obvious first act. A small skip is visible but secondary, so a stuck upload does not
  trap them." So the flyleaf holds the upload and nothing stands in front of it, but the
  escape must be present, working, and secondary — a read that will not finish can never
  trap a house on that leaf. This closes the fork the sketch refused to default
  (README §7.1) and the adversarial pass's attack #3. Built this way in
  `Inscription` (`apps/web/src/pages/arrival/Arrival.tsx`, branch
  `feat/skyleaf-next-act`): the escape is "Open the book without it", it records
  nothing, and the flyleaf is never drawn over a book that already holds menu lines.
- **§7.3 does `placed / not placed` earn its build: YES — KEEP ALL THREE COUNTS.**
  Verbatim intent: "KEEP the three counts: lines read, lines placed, lines not placed.
  'Not placed' is NOT returned by any API today. Build it." So the reveal does not
  degrade to `itemsExtracted` plus the register list. Built as `MenuLineTally`
  (`apps/api-gateway/src/cellar/cellar-registers.ts`) — derived from the register
  reader's OWN menu pass via the extracted `placeMenuLine` rule, so `placed` means
  exactly "the register reader placed this line" and the headline cannot disagree with
  the registers under it. `null`, never three zeroes, when the menu is unreadable.

**Still NOT asked, still open after these two:** sketch 121 README §7.2 — how loud the
un-evidenced registers should be (the same tone fork as
`PAGE-WAVE-BLOCKERS-2026-09-22.md` §5 Q2). Built to the sketch's position (the
service's own "unasked, not absent" sentence, visible, with one "We pour this" act) but
the founder has not ruled on it. Also newly open: whether the API should return the
not-placed LINES and not just their number — filed as OD-140, and the reason no
"show me the 17 it could not place" control was shipped.

**Preview-review rulings — CONFIRMED 2026-09-22 (after `PREVIEW-NOTES-2026-09-22.md`), all binding.**
Built on branch `fix/preview-notes-2026-09-22` (not merged).
1. **Calendar "— no reading" mark: REMOVE, leave the cell BLANK.** He chose blank knowing
   the written rule (SkyMark.tsx header, ADR 0111 slice 2, `06-pages/calendar.md`) that a
   blank sky cell reads as fair weather. Blank means empty — not a different sentence.
   The page-level sky line still carries the reason. The rule is bracketed OVERRULED in
   place in SkyMark.tsx, calendar-next.css, ADR 0111 and calendar.md.
2. **Profile/Connections Google grants: ONE "Google" heading, SEPARATE Connect per
   service (Gmail, Drive, Calendar). Do NOT fold into one OAuth grant** — his earlier
   "send permission and nothing else" ruling stands; this is grouping only. **No Google
   Calendar grant exists** in `integrations-oauth.constants.ts` (only google_drive,
   gmail_send, gmail_read, excel), so none was drawn — building one is new scope, unasked.
   **Connections page: strip deep technical detail from the restaurant UI** — webhook
   URLs, house ids in URLs, Stripe/Anthropic key names, table names, raw permission
   scopes, and the "set once for every house" operator register (Register IV). Keep the
   page simple. The webhooks/keys themselves stay. This reverses the page's own stated
   principle ("a page that shows only what a house controls is not a list of what acts on
   its behalf") — bracketed OVERRULED in ConnectionsNext.tsx and `06-pages/connections.md`.
3. **Logo: do NOT shrink. 24px stays.** No change.
4. **Orders: clicking an order line opens that order's receipt in a RIGHT SHEET, using the
   canonical Mudavym document (ADR 0104 D13, sketch 089 C, `/documents/:id`) — no new
   layout.** No receipt ⇒ one sentence. Built via deliveries.order_id → the delivery's
   documents. Built as an "Open the receipt" control in the expanded row, not on the row
   click itself (the approve hold lives in the expansion) — whether the bare row click
   should open it is still his call.
```

**State of each today** (records lane, 2026-09-25): Q1 `#442` merged `b57380288`; Q2 moot,
#426 made the public design unconditional (J2); Q3 `#452` merged `b962dc146`; Q4 applied to
shell and admin in the database only (J1), `arrival` is overridden by ADR 0213; Q7 not built
(F7); Q8 built (`ConnectionsNext.tsx:319`, ADR 0149 row 53); Q9 built on #434; Q10 recorded
on OD-123 in this PR; Q11 recorded on OD-132 in this PR (see C22); §7.2 superseded by ADR
0213 F7 (OD-141 (OPEN-DECISIONS.md:93)); preview rulings 1–3 merged via #458–#462, ruling 4
is F2.

### 8.2 Round-5/6 rulings the corrections above rely on (memory `founder-answers-2026-09-21-round5.md`)

Only the lines this file cites, each prefixed with its memory line number; the artifact link
on line 234 is elided.

```text
29-30: main path now, the other two stay open alternatives. Pool terms: notice + opt-out + our own ToS
       first, lawyer later. Menu upload: read right away (under the per-house ceiling).
145-153: **/ask shape DECIDED 2026-09-21 (after the 14-case study, q921/ask-layout-judge.md):** ONE right-hand slot
  with two faces - summoning Ask (Cmd-Shift-K, header, rail door, "keep asking" on the quick popover) swaps
  the counter's column to an Ask face beside a LIVE non-modal page; the counter folds to its counted strip;
  wide answers and old folios open on /ask (A's Reading Room look + B's trail). The Cmd-Shift-K bar
  (AskAiBar.tsx:290-310, today a modal) must become a non-modal popover; quick-ask context must see an open
  act sheet (page-context.ts:47 reads only the route). "Draft the change" requests land in a REQUESTS LIST
  the founder reviews (accept/merge/decline; asker sees status; at /admin). Ask NEVER writes without the
  seal: it reads and proposes; proposals become "Mudavym proposes" rows sealed in their own sheet.
  BUILD ORDER: after the shell (wt-shell) and KL backend land -> an /ask UI lane (page + Ask face +
  non-modal quick ask + requests list).
166: - Round 6b: #432 = "Merge after round 8" (his word to merge the gate PR once r8 passes last call);
186-193: - Round 6e scorecard (#435, ADR 0207): overdue = "count it as late, because that will help us feed to
  the analytics"; card fact = percent with count ("86% on time · 12 of 14"); staff = "depends on the
  territory of staff. if it's out its jurisdiction then doesn't see it, but otherwise all (that can be
  adjusted while showing the formatted invoice and details)" -> tie to the AREAS model (research
  running); deadline = house's local midnight; min sample = 5 everywhere (credits too); legacy panel:
  "sentiments are a must in our new page but not as in this design, the feature must stay, the current
  design can go" -> redesign sentiment INTO the new page, old panel design retired; language = "english
  +TR formats and other languages possible for others like japanese, italian, chinese" (i18n-ready).
218-224: - Round 6j E (#436): no-master delivery = "book the stock anyway, and if it's not on the master wine that
  means that wine needs research treatment with fully in depth analysis to add to the master wine. If its
  found that it s nowhere to be found, like wine 1 and wine 2 and such, then we skip it and flag it. (then
  we create a little flag in users UI saying if you were to specify this wine, we could help you build
  better menus or such marketing move. Users also have features that they can edit their part of the menu
  and wine names. When making a search in the db tho, ... not the name but the UUID or the deeper id is
  being searched (both better for lookup times)". Letter requests = "Decline/withdraw; undo re-waits".
234-249: - Round 6m SENTIMENT (sketch [artifact link elided]; source <scratch>/land/sc2/sketch):
  direction = "A, Plus C's lines"; ALSO "the on time numbers ... 12 of 14 deliveries, 9 of 13 lines ... The
  font size are a little big" (shrink ledger figures); "this data will only be available to us, only to the
  developers, and this data will only be used for our automatic AI responses in the future ... we can only
  present the owners, managers ... maybe show everything in the analytics, the documents part ... Or when
  we look at the vendors" (owner/manager only; placement asked). Tone words: "talk with JEV, put that onto
  point scale, very detailed, super intelligent ML data needed. this feature can also be disabled. other
  than that use warm/plain/terse" -> Jev-scored detailed point scale stored as internal ML data
  (developer-only), a disable switch, display words warm/plain/terse. Builds in wt-scorecard AFTER
  scorecard2 finishes (scorecard3). Jev egress of vendor mail = privacy note (subprocessor, OD-133).
  - Round 6n: sentiment placement = "Vendor sheet only" (owners/managers); Jev egress = "Only with names
  removed" (mask emails/phones/person names before Jev; scores keyed to our message id; house switch-off);
  /ask staff order lookup = "all orders depending on staff area task, if its the warehouse or storage staff
  then yes, if waiter or other no" (AREA-gated: receiving/storage areas get all orders' contents, others
  not -> needs the areas model); wine library non-English rule covers ANY non-English source incl.
  producer pages ("Yes, any non-English source").
282: - MOTIONS (ADR 0134 leftovers): §4/§5/§8/§9 "Lock all four (Recommended)"; §7 SC 3.3.8 "Passkey + paste (Recommended)" (passkey peer path, enrolment on /profile = build item; passcode field accepts paste); fork 14 consent panel "Bring back, real switches (Recommended)" = opens from rebuilt Settings, holds ONLY switches the product reads (ask-training opt-out, Jev scoring, any wired legacy consent), owner-only, audited; ResponsesSheet "Stays 640, it's letters (Recommended)".
284: - Gate r8: "check claude cli, 0dc07485-0b74-4712-aa1f-c43ab67f6dbc, make sure it din't do anything different. if not finish in this PR" -> checked: 0dc07485 = -39 merge train; no gate-file edits, no push to main, no --admin (its 2 failed `vercel deploy --prod` at 17:50/19:12 were founder-approved in its session) -> FINISH gate-r8 IN #432.
288: ROUND 6u (2026-09-22 ~02:55Z, lane E after E3 288b2897c): research queue consumer "Existing enrich chain (Recommended)" (haiku_enrich_task -> web_verify_task by id, row flips matched on matched_master_id); no-item/zero-bottle delivery "Deliver, flag to name it (Recommended)"; released letter whose send fails "Back to waiting (Recommended)" (reason shown to manager + staffer); receiving-door booking of a library-less wine "Yes, same rule (Recommended)" (every booking path queues once, by id). STILL TO ASK: should a waiting DEAL request also get decline/withdraw like letter requests?
291: - Hosting, verbatim: "I upgraded for this month to vercel pro its active right now tho, I'll move every config to railway after all UI deployment is over". So Vercel Pro is ACTIVE now (his action; billing not verified by us), and the web moves to Railway only AFTER all UI deployment is over, as a separate job (not started). Research: scratchpad/host/judge.md.
308: - Scorecard #435: Jev tone "Off until switched on (Recommended)"; switch, VERBATIM: "owner only, but also we're going to use this as complete data and privacy usage, they have to accept that, and when they do they'd accept the jev too with their names and sensitive topics redacted" = owner-only; ONE owner acceptance of the complete data & privacy usage terms covers Jev; names AND sensitive topics redacted (new requirement). Masker "Keep, measure misses (Recommended)"; thresholds "Keep, re-set on sample (Recommended)"; OD-133 "Widen, add TypeSafe (Recommended)" (subprocessor register); never-arrived order, VERBATIM: "if. cancelde make sure the all analytcis be configured toward that, canel is enough or not?" = research every analytic's handling of a cancelled never-arrived order, fix, and ANSWER him whether Cancel is enough; Incomplete orders "Owners and managers (Recommended)"; vendor mail "Open in place (Recommended)".
310: - KL #430: opt-out gap "Never (Recommended)" (choice recorded per question at asking; export excludes); export "Text-free until lawyer (Recommended)"; /privacy: "Add to /privacy now" (NOT the recommended lawyer route).
311: - Motions #433: legacy "Leave legacy alone (Recommended)"; sidebar "Reduced motion wins (Recommended)". Fork-14 store question NOT asked (fact: #430 builds the ask opt-out, #435 the Jev acceptance; the consent panel lane reads both).
317: - Gate #432: 4 more pushes (${x/../git push}, ${!G}, ${G:=git push}, builtin eval) "Close all four" (NOT the recommended 2+2); eval naming push "Keep refused (Recommended)".
320: - Scorecard #435: "Every owner, next sign-in" (NOT recommended) = every owner must accept the complete data & privacy terms at next sign-in (a sheet), and acceptance includes Jev (names + sensitive topics redacted) => Jev on for every house whose owner accepts; prepaid never-arrived "Add the box (Recommended)" (refund credit claim with vendor+currency).
321: - Team #440: labour switch "Manager: on only (Recommended)" (OFF stays owner-only); removed person "Past shown, future open (Recommended)"; availability+credentials "Delete those (Recommended)".
```

The verdict-ledger strip ruling cited in §0 (L6(b)) is in memory
`session-d3d347a1-finish-lanes-2026-09-21.md:49`, verbatim: *"Verdict ledger = his condition
('if it's bulletproof') was NOT met → strip it."* Its code record is commit `8ea44f527`.

---

## 9. Still unverified

- The orchestrator's `Invalid value for queue` at code level, and whether #415 caused or only
  surfaced it (this lane did not read Railway logs). **[Answered by Wave 0's L14a, 2026-09-25 (§12): the cause is the AMQP queue name of the wildcard subscription `("system.control", "system.provider_conversation.*")` (`services/agent-orchestrator/agents/provider_conversation_agent.py:364` at `059169a59`), fixed in #464 (open). #415 **surfaced** it: before #415, `start_all_agents` logged a failed start and never added the agent to `self.agents` (`git show cc73f9f66^1:services/agent-orchestrator/core/orchestrator.py:444-446`, re-read by this lane). That the running orchestrator still logs the failure on 2026-09-25 is L14a's Railway read, not re-read here.]**
- The orchestrator's and mobile's running commits.
- Whether Task-tool subagents trigger Jev's `UserPromptSubmit` hook.
- Whether #443's claimed BLOCK fixes hold; whether `claims_merge3.py` resolves #435's conflict.
- Whether `wt-r5-settings`' five commits, `port/text`'s 25 differing files (#368), and the
  trees in §3's unpreserved list hold anything their merged PRs lack.
- The critic's worktree hashes and mtimes (G1, G3, G4) were not re-run by this lane; the refs
  and ancestry they rest on were spot-checked (`c59d8f71b`, the wip-21 shas, #432's head).
- Who flipped shell and admin in the database, and when.
- Vercel billing (his word only).

---

## 10. Tombstone

| Retired | Recover with | Why |
|---|---|---|
| `.planning/07-reference/deploy/PAGE-WAVE-BLOCKERS-2026-09-22.md` (245 lines) | `git show ddc5e094b:.planning/07-reference/deploy/PAGE-WAVE-BLOCKERS-2026-09-22.md` (its last change, #455; unchanged at `059169a59`) | Every PR in its §2–§3 has merged (#413, #414, #415, #419, #420, #426, #430, #434, #437, #439, #452, #454, #455; `gh pr view --json mergedAt`) or is re-planned in §3 here; its §5 questions are answered (Q1 → sketch 121, §8.1; Q2 → ADR 0213 F7; Q3 → Q12 confirmed). Prose mentions of its §5 Q2 in ADR 0213:48, OD-141 (OPEN-DECISIONS.md:93), `SKYLEAF-NEXT-ACT-BUILD-2026-09-22.md:168` and `research-122-squad/` resolve through the recovery command |

---

## 11. Founder answers, 2026-09-25

Copied **verbatim** from project memory `founder-answers-2026-09-25-web-rebuild.md`, lines
11-28, as it stood at 2026-09-25T21:16Z (its `modified` stamp). As in §8, quoted words inside
are his; the surrounding text is the recording session's note. Item 13 was added to the memory
after this lane's brief listed twelve; it is copied too.

Asked via AskUserQuestion 2026-09-25 in session 6c6d8b93 (census forks F1, receiving, F2, F5). All four took the recommended option:

1. **/communications error banner (F1): amend ADR 0083.** The house page names only its own three sources (book, threads, drafts). The schedules card leaves `/communications` until a real `scheduled_reports` table exists (tech-debt row for the dead feature). The Gmail-watch line moves to `/admin`. Supersedes #457's blocked attempt.
2. **Receiving desk history: built from the door receipts already recorded — no separate verdict ledger table.** The 2026-09-21 strip (commit `8ea44f527`) stands. Approach 1 otherwise unchanged: one row per line grouped by vendor, 5 rows per vendor box, history 10 per page.
3. **OD-152 /orders row click: depends on state.** Opens the receipt sheet when a receipt exists; expands the row while the order is pending (approve + Mark delivered live there).
4. **#414 Skyleaf Arrival book: delete at cutover** — its own group on the ADR 0149 deletion manifest. Nothing changes now; `/get-started`'s `legacy` slot (ADR 0213 flow) is the plan of record.

5. **OD-140 unplaced menu lines: separate list endpoint** (`GET /cellar/:id/registers/unplaced` shape) — "Show me the N" control; a test pins it to the same `placeMenuLine` rule so count and list cannot drift.
6. **#405 Gmail send failures: keep the split** — 5xx/429 ambiguous (draft held, never auto-released), 403/404 definite refusal (draft reopens).
7. **Close superseded PRs #456 #457 #389 #390 #404** with a pointer comment — granted.
8. **Founder-owed pipeline items (his words):** "skip production e2e secret, and CI audit gate claude api. I'll add them" — later, his action. "TypeSafe is already done" (the DPA, OD-133) and "Jev api key added, redeploying" (JEV_API_KEY on Railway). So OD-133's retention/DPA fork is closed by his word 2026-09-25 — record it.

**Round 3 (same day, after Wave 0):**
9. **#464 production agent: gate, clear, then merge.** The urgency auto-send must obey the house's `enable_ai_autonomous_send`; the 14 queued backlogs are dealt with before it starts (implemented as a code guard: stale approved sends are not sent, they return to the manager to re-approve — no manual broker purge); then merge.
10. **#427 Sentry: stop sending Python frame locals** (`include_local_variables=False` at both init sites).
11. **Vendors — his words:** "Shared vendors exist. However … some people might just have different vendors, different distributions, names and numbers, even though it's the same vendor. So … we're gonna let each house decide on its own distribution and way of handling communication … when we have enough data, we're going to … start to gather enough information from vendors and make them shared vendors exist. And that's where we're gonna see those shared vendors appear on the world map in the /providers page. And if you can change it, change providers to vendors." Reading: NOW each house owns its own vendor rows (house-scoped reads, #416's `.eq` is right; houseless rows are orphans); LATER a shared/canonical vendor layer built from gathered data appears on the /providers world map; RENAME the user-facing word providers/distributors → **vendors** (route `/vendors`, old routes redirect).
12. **#463 live in code for every house: yes, all three** (shell, admin desk, /authorize), no per-house switch, rollback = revert + redeploy.
13. **#449 (touches gate-owned ci.yml): "Yes, merge after audit"** — founder word given 2026-09-25; still needs a real three-role PASS.

### 11.1 Where each answer is recorded

| # | Answer | Recorded in | By |
|---|---|---|---|
| 1 | Comms banner (F1): amend ADR 0083 | ADR 0083 amendment | Lane W1 comms-a (not this PR) |
| 2 | Receiving history from door receipts; strip stands (F7) | ADR 0160 §107 and Open item 4, 2026-09-25 brackets | This PR |
| 3 | OD-152: depends on state (F2) | `OPEN-DECISIONS.md` OD-152 → Resolved | This PR; build is lane W1-orders-cellar |
| 4 | #414 Arrival book deleted at cutover (F5) | ADR 0149 deletion-manifest note | This PR |
| 5 | OD-140: separate list endpoint (F3) | OD-140 bracketed ANSWERED in place (moves to Resolved when built) | This PR; build is lane W1-orders-cellar |
| 6 | #405: keep the split (F9) | #405's ADR / PR body | #405's lane (not this PR) |
| 7 | Close #456 #457 #389 #390 #404 | Done 2026-09-25T21:21Z (§5 item 7) | Orchestrating session |
| 8 | TypeSafe DPA done; `JEV_API_KEY` set; e2e secrets and CI audit credit are his later action | OD-133 → Resolved; §5 items 4-6, 8 | This PR |
| 9 | #464: gate the urgency auto-send on `enable_ai_autonomous_send`, handle the stale backlog, then merge | ADR 0172 / #464's body | #464's lane (not this PR; ADR 0172 not edited here) |
| 10 | #427: stop sending Python frame locals | ADR 0040 / #427's body | #427's lane (not this PR; ADR 0040 not edited here) |
| 11 | Vendors: house-scoped now, shared layer later, the word is "vendors" | [ADR 0221](../../decisions/0221-each-house-owns-its-vendors-now-a-shared-vendor-layer-comes-later-the-word-is-vendors.md) | This PR |
| 12 | #463: all three live in code for every house | #463 (ADR 0149 row 36 bracket on its branch) | #463's lane |
| 13 | #449: "Yes, merge after audit" | #449's merge record | Merge train (still needs a three-role PASS) |

---

## 12. Wave 0 outcome, 2026-09-25

**PRs opened:** #463 (shell, admin and `/authorize` live in code; head `09c111cb3`), #464
(the conversation agent's queue name; `7c1824454`; gated by §11 item 9), #465 (CLAIMS walkers
read tracked files only, ADR 0220; `34386a476`), #466 (this records PR), #467 (recommendations
catalogue round 6, ADR 0191; `85283ad0f`). **PRs brought up to date:** #427, #423, #395, #412,
#416, #446, #449, #451, #450, #425, #394. **Merge train 1** is running over #463 #416 #412 #446
#423 #395 #465 #451 #450 #425 #394 #467, in that order; at this section's last update #463 had
merged (`f7630c08b`, 22:57Z) and the other eleven were OPEN (`gh pr view --json state`). Heads are from Wave 0's result file; a train
merge moves them.

### 12.1 Wave 0's notes for the records lane, verified

Each Wave 0 lane returned notes for L1. Those still true are below, each re-checked by this
lane on 2026-09-25 unless the Evidence cell says otherwise. Dropped as no longer true or
already done: L4's "record authorize_integration as acted-on-pending-confirmation" (§11 item
12 confirms it); L14b's "next free ADR is 0221" (0221 is this PR's).

| From | Note | Evidence |
|---|---|---|
| L4 (#463) | `LIVE_PAGES` went from 20 keys to 23 (shell, admin, authorize_integration) when #463 merged; still flag-gated: recommendations, receiving desk, arrival; R17 closed. **Done in this PR** (STATE.md, LIVE-CHECKLIST.md and ADR 0149 row 36 bracketed) | #463 merged `f7630c08b` 22:57Z; 23 keys counted in `useMudavymDesign.ts` on `main`; mudavym.com `assets/index-2txKbWJ0.js` carries the 23-key literal (22:59Z) |
| L4 | Pre-existing defect #463 fixes: `scripts/flip_mudavym_design_flags.py`'s `LIVE_IN_CODE` lacks `settings` (live since #419), so a flip of settings writes an unread column and reports success | `scripts/flip_mudavym_design_flags.py:123-147` on `main`: sixteen row-36 names plus `cellar`, no `settings` |
| L4 | With the shell live, an unmatched signed-in path renders the shell's in-app 404 at the same URL instead of redirecting to `/`; an e2e expecting the legacy redirect must set `localStorage['mudavym.design.shell']='0'` | L4's report; not re-run here |
| L4 | CLAIMS rows `ADR-0149-LIVE-PAGES-16` and `SHELL-GATE-IS-OFF-BY-DEFAULT-AND-THREE-LAYERED` are amended in place in #463; compare by (id, verify) if another branch edits them | L4's report |
| L14a (#464) | The failure is the wildcard subscription's AMQP queue name; #415 surfaced it, did not cause it. Unrelated to the dead HTTP dispatch at `v3.0-TECH-DEBT.md:778` | §9's bracket (both code reads re-done here); the Railway log read is L14a's |
| L14a | OD-68's daily ERROR comes from a second site: the read in `_check_upcoming_events` (`calendar_agent.py:395-403`), not only the upsert at `:155-156`; PGRST205 on `provider_important_dates`, 00:05 UTC, seen 2026-09-24 and 2026-09-25 | Code sites re-read on `main`; the log dates are L14a's |
| L14a | New memory `orchestrator-pytest-scratch-venv.md` (baseline 1423 passed / 55 skipped at `059169a59`) | File exists in project memory; the counts are L14a's |
| L14b (#465) | L14(b) is done when #465 merges (ADR 0220) | #465 OPEN |
| L3a | Three audit records exist **only** as untracked files in `.claude/worktrees/musing-sutherland-0d8f92`: `.planning/07-reference/pr-audits/417-17a5a3ca.md`, `417-7df8a336.md`, `423-07a67bdd.md`. A worktree clean loses them | Each file present and untracked; `git log --remotes -- <path>` empty for all three |
| L3a | Stale local heads nobody should push from: `wt-sentry-url` (#427 at `6a31cf240`), `wt-promo-scope` (#416 at `9654df516`), `wt-menufix` (#446 at `b87f9d38b`) | `git -C <wt> rev-parse --short HEAD` |
| L3a | #427's round 3 closed a breadcrumb / free-text / frame-locals leak the round-2 audit rated non-blocking; #423 also covers the repo-root `vercel.json` (#418 gave it the same trailing-slash gap) | L3a's report; §11 item 10 extends #427 |
| L3a | #395 must precede the receiving lane | L3a's report |
| L3b | `TD-2026-09-17-TEXT-SENDERS-USER-ID` (open) goes STALE when the second of #412 / #416 merges; that PR must flip it to resolved | `CLAIMS.jsonl:406`, status open on `main` |
| L3b | Census correction: #446's overlap in `menus.service.ts` was with #434 (ADR 0193), not #453 | L3b's merge report |
| L3b | The conversations by-order / by-provider read is unscoped on `main`: `getByOrder` takes no user or house (`conversations.controller.ts:289-295`). The uncommitted fix in `.claude/worktrees/admiring-stonebraker-c367d1` is incomplete (500 not 403 for a houseless session; `getStats` fails open; its CLAIMS and TECH-DEBT hunks do not apply; its new tripwire would be STALE) | Controller re-read on `main`; the patch analysis is L3b's |
| L3b | #412 records "167 as of 2026-09-25" in `DELIVERY-AUDIT.md` §6; any other PR retiring `read_error_baseline.json` rows conflicts on that line | L3b's report |
| L10a (#467) | When #467 lands, bracket `PROGRESS.md:518` ("Recommendations catalog: is it actionable?") as answered 2026-09-21 by ADR 0191; #467's seven migrations are renumbered into `20260925120000`-`120600`; the flag stays OFF until an L4/founder keystroke | `PROGRESS.md:518` unbracketed on `main`; the rest is L10a's |
| L2-prep | `gh pr checks --watch --required` can exit before a required context that has not started yet (CI Complete) posts; name the required contexts and poll for them | L2-prep saw it on 5 of 5 PRs |
| L13 | `wt-r5-gate`'s commit `c59d8f71b` (the gate8c / gate-r8 CI chain) is on no remote ref; push it into #432 before its last call | `git branch -r --contains c59d8f71b` empty |
| L13 | CRITIC's "wt-e2e has no snapshot" is wrong: `origin/wip/2026-09-19/others/wt-e2e` exists | `git rev-parse` → `13df8e6b3` |
| L13 | #368 is CONFLICTING and its WhatsApp-sender content shipped via #391; a close-as-superseded candidate (not in §11 item 7's grant) | `gh pr view 368 --json mergeable` |
| L1 | Memory corrections owed (not edited by this PR): `founder-answers-2026-09-22-page-gap` (four report paths never existed; Q11 vs `Privacy.tsx:21-31`), `ci-audit-gate-out-of-credit` (#442 bypasses to success), `four-fixes-session-2026-09-22` (#448 CI red), `gate-r4-code-only-in-wt-gate-rule` (superseded by `origin/wip/2026-09-19/gate`, an ancestor of #432), `web-rebuild-goal-2026-09-25` (31 migrations across 7 PRs, not 26 across 5) | L1's report; the memory files exist |

