# v3.0-TECH-DEBT.md triage — lines 1–1601

Worktree: `/Users/aldemirkonuk/Projects/wt-review` @ `804a1bdb5` (train/finish-2 = main `cb756083e` + PR #391's train), read-only.
Method: every row below was checked against the code/DB at that commit with a command I ran (grep, git log, a Supabase SELECT, or `scripts/check_decision_claims.sh`) — not copied from the document's own prose. Commands are named per row so they're re-checkable (CLAUDE.md §5b).

Baseline check: `bash scripts/check_decision_claims.sh` → **372 checked, 372 holding** (all CLAIMS.jsonl rows currently pass).

Legend — Rec: REMOVE (done, delete the entry) · WORK (live defect, fix it) · DECIDE (founder call) · MOVE (convention/decided-deferral/unbuilt-scope → its proper home).

---

## Track A — 44.1 Auth and data-integrity defects

| ID | Lines | State | Evidence (command run) | Rec | Sev | Size |
|---|---|---|---|---|---|---|
| 44.1a | 69, 1278 | FIXED | `grep -n "UseGuards\|@Controller" one-tap-actions.controller.ts` → class-level `JwtAuthGuard` present; doc's own "Closed since compiled" log (line 1278) also confirms `fd7b8af`. | REMOVE | — | — |
| 44.1b | 78–106 | FIXED (file deleted) | `find apps/web/src/data -iname inventoryData.ts` → no match. Zero importers. | REMOVE | — | — |
| 44.1c | 108–116 | FIXED (undocumented — doc is stale) | `grep -n "EmailIntelAgent\|EmailParsingAgent" core/orchestrator.py` → both registered in `_register_agent_classes` (lines 210–211). `grep -n "email.inbound" agents/email_intel_agent.py` → subscribes to `email.inbound.received`, not `.raw`. Doc never marks this closed; it is. | REMOVE | — | — |
| 44.1d | 117–153 | RESOLVED (per doc) | `find services/agent-orchestrator/core -iname notifications.py` → exists. Not independently re-verified against a live insert (would need a write, out of scope for SELECT-only rules). | REMOVE | — | — |
| **44.1e (dup id — InvoiceScannerModal)** | 86–99 | FIXED (closed twice over, then file deleted — see also the 44.5 correction at line 1338) | `find apps/web/src -iname InvoiceScannerModal*` → no match. | REMOVE | — | — |
| **44.1e (dup id — sommelier conversations)** | 154–178 | **OPEN, live** | `grep -n "supabase\." apps/web/src/hooks/queries/useSommelierQueries.ts` → still queries `sommelier_conversations` directly with the anon-key client (line 22, 33, 56), not routed through the gateway. Cross-checked OD-72 in `OPEN-DECISIONS.md`: OD-72's 2026-08-26 RLS revoke explicitly **excepts** `sommelier_conversations` ("the single live browser consumer") — so this table's `auth.uid()`-based policy is still permanently unsatisfiable and OD-72's closure does not touch it. Feature is still fully broken (save throws, load silently returns `[]`). | WORK | medium | M |
| **ID-COLLISION finding** | 86, 154 | n/a | The register assigns **`44.1e` to two unrelated defects** (InvoiceScannerModal 404, closed; sommelier RLS, open). A `grep -c "^\*\*44\.1e"` on the file returns 2. Not mechanically caught by anything — worth its own guard if this document's ids are kept. | note only | — | — |
| 44.1f (primary) | 179–204 | FIXED 2026-09-03 | Doc cites `47f971de` + a spec (`create-location-grants-access.spec.ts`); not independently re-run (would need the local gateway + heavy.sh jest, skipped given time budget — flagged as unchecked). | REMOVE | — | — |
| 44.1f (second finding — switchRestaurant org fallback) | 205–216 | OPEN, deliberately unfixed | `grep -n "switchRestaurant" -A5 auth.service.ts:446` region — org-level fallback still present per 44.1i's cross-reference (`auth.service.ts:472-511`, confirmed live in that file during 44.1i's check). Founder decision pending (backfill URA rows for legacy org members). | DECIDE | medium | M |
| 44.1g | 218–263 | FIXED | `sed -n '119,126p' auth.controller.ts` → `register()` now `throw new GoneException(...)` (410), `AuthService.register` deleted (`grep "async register" auth.service.ts` → only `registerRestaurant` remains). `find … register-is-closed.spec.ts` → exists. | REMOVE | — | — |
| 44.1h | 264–362 | FIXED for the invitation door | `find … role-grant.ts` → `grantRefusal` exported (line 58). `find … invite-role-ceiling.spec.ts` → exists, 19 `it(`/`test(`. What it leaves open is tracked separately as 44.1i/44.1k/44.1l/44.1q below (44.1j, 44.1n, 44.1p closed — see those rows). | REMOVE | — | — |
| 44.1i | 364–441 | OPEN, theoretical (0 production instances), decided-but-not-yet-retirable | `find … 20260918153000_a_setup_era_manager_holds_their_house_by_a_row.sql` → migration exists (writes the one YAREN manager's access row). Fallback itself (in `assertMembership`, `resolveRestaurantRole`, `assertAccess`) is still present by design — it cannot retire until the migration is applied in **production**, which is outside this read-only worktree's ability to confirm from code alone. | WORK | low | S |
| 44.1j | 442–483 | FIXED | `grep -n "restaurant_id: null" auth.service.ts` → line 2597, filtered `.eq("user_id",…).eq("restaurant_id",…)` per the doc. `grep -n clearUsersRowHouse members.service.ts` → private helper at line 430, called from 382/405. `find … removal-only-that-house.spec.ts` → exists. | REMOVE | — | — |
| 44.1k | 485–500 | OPEN | `grep -rn "CHECK.*users_role\|users_role_known" supabase/migrations/` → no hit for `users.role`; `grep -rl user_restaurant_access_role_known supabase/migrations/` → exists only for the access-row column, confirming `users.role` still has no CHECK. | WORK | low-medium | S |
| 44.1l | 502–513 | OPEN | `sed -n '1160,1195p' auth.service.ts` → both reads (`restaurant`, `existing` code-collision) bind only `data`, no `error` variable, exactly as described. | WORK | low | S |
| 44.1m | 515–535 | OPEN | `sed -n '845,860p' auth.service.ts` → all three post-insert writes (`organizations.owner_id`, `organization_members` insert, `user_restaurant_access` insert) are unawaited-for-errors `await …` with no `{ error }` destructure. | WORK | medium | S |
| 44.1n | 537–601 | PARTLY (most bullets closed) | Team-page remove guard: `sed -n '519,544p' team.service.ts` shows the owner-count/`is_active` guard now present (matches "closed sixth round" claim). Co-owner-demotion and the 4 ownerless houses are founder-answered (ADR 0162) and left as-is by design. **Still genuinely open:** the hand-over race (check-then-write, no lock) and a `users`-row-only owner demoting the only access-row owner — both theoretical, not re-tested here. | WORK | low | S |
| 44.1o | 603–611 | OPEN, not live | `sed -n '525,536p' members.service.ts` → `organization_members` upsert still unconditional on `(organization_id,user_id)` with no error check, exactly as described. `grep -rn "addMember(" apps/web/src apps/mobile/src` → no client call sites (confirms "not live"). | WORK | low | S |
| 44.1p | 613–650 | FIXED | `sed -n '204-268' members.service.ts` region → target-membership read before write, `users` UPDATE filtered `.eq("user_id",…)` and scoped to the named house, matching the "answer A" fix. | REMOVE | — | — |
| 44.1q | 657–742 | FIXED | `grep -n role apps/api-gateway/src/auth/strategies/jwt.strategy.ts` → `const role = house ? (user.house_role ?? null) : (user.role ?? payload.role)` (lines 62–64), matches the fix exactly. `roleInHouse` in `auth/house-role.ts:41-53` matches its described logic verbatim. | REMOVE | — | — |
| 44.1r | 744–754 | OPEN, decided ("Membership only") | Not independently re-verified beyond the doc's own citation (`auth.service.ts` ~:393/~:471-511 region, consistent with what 44.1i/44.1f already showed live in that file). Owed: a follow-up PR. | WORK | medium | M |
| 44.1s | 756–762 | OPEN, decided ("Keep managers in") | `sed -n '1,40p' auth/guards/roles.guard.ts` → confirmed live: "If owner/manager required, accept both as well as admin" (lines 27-37) — an `@Roles('owner')`-only route still passes a manager. Relabel + guard-agreement test still owed. | WORK | low | S |
| 44.1t | 764–768 | OPEN | Not independently re-verified (would need a live login trace); consistent with 44.1j's confirmed clear-on-leave behavior (role itself isn't reset, matches the claim). | WORK | low-medium | S |

## Track A — 44.2 Hollow features that report success

| ID | Lines | State | Evidence | Rec | Sev | Size |
|---|---|---|---|---|---|---|
| 44.2z | 772–823 | **FIXED/OBSOLETE — superseded by OD-57** | `grep -n "OD-57" .planning/decisions/OPEN-DECISIONS.md` → "✅ Swept 2026-08-24 … moved out of the Open table 2026-08-26" — re-verified 2026-08-26: only 3 `gemini-pro` occurrences survive, all inert (2 comments + 1 historical price row). The doc's "27 further references remain" figure is stale; OD-57 replaced and closed that count. OD-63 also closed (separate row, "Fixed structurally"); OD-68 (the `provider_important_dates` table) is a distinct, still-open finding, already tracked as its own OD — not duplicated here. Also ran a live check on the api_spend pollution named in this section (see the separate "Data integrity — api_spend" row below): 0 wine-UUID rows remain today. | REMOVE (superseded by OD-57/OD-63; OD-68 stays where it is) | — | — |
| 44.2a | 824–859 | FIXED | `grep -n IS_STUB agents/*.py` → all 5 named stubs declare it; `core/orchestrator.py:258` refuses to start a stub even when its flag is on. `test_agent_registry_gating.py`: 9 `def test_` (2 parametrized: 9 cases + 5 cases) ≈ 21 collected tests, close to the doc's claimed "20" (off by one, immaterial). | REMOVE | — | — |
| 44.2b | 861–867 | OPEN | `grep -n get_subscribed_routing_keys -A5 agents/reporting_agent.py` → still only `reporting.events`, not `stock.events`. Contradiction with the ROADMAP criterion is unresolved either direction. | DECIDE (subscribe it, or fix the doc — founder's call per the entry's own text) | low | S |
| 44.2c | 869–909 | FIXED | `find scripts -iname resolve_watched_commit.py` → exists with `--first-parent` per the doc's second-pass fix. | REMOVE | — | — |
| 44.2d | 910–1033 | **OPEN, confirmed live** | `grep -qE 'is[-_]ancestor' scripts/check_deployed_sha.py scripts/resolve_watched_commit.py` → **no match**. Cross-checked `CLAIMS.jsonl` row `DEBT-44.2d` (status `open`, same verify command) — this is the one entry in my range with its own CLAIMS.jsonl row, and it is still failing (i.e., correctly still open). The `FLOOR ⪯ running ⪯ tip(main)` fix is not landed. | WORK | high (false-positive deploy failures erode trust in the audit; connects to memory notes on "Main wedges" / "Production deploy verification") | M |

## Track B — Foundations

| ID | Lines | State | Evidence | Rec | Sev | Size |
|---|---|---|---|---|---|---|
| 44.3a | 1040–1049 | **FIXED/OBSOLETE** | All 13 named tables now have a `CREATE TABLE` in `supabase/migrations/20260805000000_baseline_from_production.sql` (`grep -rl "CREATE TABLE.*<table>\b" supabase/migrations/` for each of the 13 → 1 hit each, all the same baseline file). `supabase/SCHEMA_DRIFT.md:3,61` — "RESOLVED 2026-08-05 by a production baseline" / "13 ghost tables — CAPTURED 2026-07-28 ✅", and states the real count was 27, not 13 (this entry undercounted, but the fix supersedes both). | REMOVE | — | — |
| 44.3b | 1051–1055 | PARTLY | The **double-send** shape (two concurrent approves both reaching the vendor) is fixed: `sed -n '5745,5960p' procurement.service.ts` shows an atomic claim (`PENDING_APPROVAL → SENDING`) before the send, plus `approve-draft-concurrency.spec.ts`. But the **cross-entity atomicity** this entry actually names (order status + shadow-stock reservation + calendar event in one transaction) is still absent — the calendar-event write happens in a separate try/catch after the status update, not in a shared transaction. | WORK | low-medium (mitigated by the claim pattern; the calendar/shadow-stock gap is now best-effort recorded, not silent) | M |
| 44.3c | 1057–1059 | **OBSOLETE** | `pos_webhook_logs`: `grep -rl pos_webhook_logs supabase/migrations/*.sql` → zero hits in the live tree (only in `migrations_archive`); confirmed by `CLAIMS.jsonl` row `ADR-0137-b` (status resolved, verify: no `CREATE TABLE` for `pos_webhook_logs`/`inventory_stock` in `supabase/migrations/`) — the table itself was retired via ADR 0137/0026/0028, not just its missing column. `scheduled_reminders`: no `CREATE TABLE` for it in the baseline either, and `grep -rl scheduled_reminders services/agent-orchestrator/` → no hits — table and writer both absent, so there's no live gap to close. | REMOVE (cite ADR 0137 / ADR 0026 / ADR 0028) | — | — |
| 44.3d | 1061–1066 | **FIXED → now a standing convention** | `ls scripts/check_schema_parity.sh` exists; `.github/workflows/schema-parity.yml` runs it in CI. The rule ("read the live schema, not migrations") is now mechanically enforced, not just advised. | MOVE (into CLAUDE.md or an ADR as a standing convention; it's no longer a defect) | — | — |

## 44.4 Verification and tracking reconciliation

| ID | Lines | State | Evidence | Rec | Sev | Size |
|---|---|---|---|---|---|---|
| 44.4 (whole section, incl. Phase 33 table) | 1068–1109 | **OBSOLETE** | `.planning/PROJECT.md` (checked in this worktree): "Current Milestone: P3 — Grade, then scale", "P2 — Web complete + deploy closed 2026-08-26". The v2.0-era phases (18–36) this section audits are multiple milestones behind current work (which is now well past P3 into the ADR-0149 Mudavym cutover, per PR #391–393 dated 2026-09-18 elsewhere in this same document). Phase 33's own reconciliation is already marked RESOLVED in the text. One item I could not re-confirm either way: the Phase 30 iCal "no external client has confirmed the feed subscribes" gap — found no current reference to iCal/calendar-feed verification anywhere in `.planning/decisions/*.md`, so it's neither confirmed fixed nor confirmed still relevant. | REMOVE (with the iCal caveat flagged for the founder if that capability still ships) | — | — |

## 44.5 Dead code and stale docs

| Item | State | Evidence | Rec | Sev | Size |
|---|---|---|---|---|---|
| `InvoiceScannerModal` | FIXED (deleted) | Covered above (44.1e dup + the 44.5-correction section at line 1338, which itself documents the deletion). | REMOVE | — | — |
| `apps/mobile/src/lib/invoiceMatch.ts` | **STILL OPEN** | `grep -rn invoiceMatch apps/mobile/src \| grep -v lib/invoiceMatch.ts` → zero other hits. File still exists, still zero importers, still a live drift risk from `apps/api-gateway/src/procurement/invoice-match.ts`. | WORK (delete it) | low | S |
| `apps/web/src/pages/Reports.v1.backup.tsx` | FIXED (deleted) | `find apps/web/src/pages -iname "Reports.v1.backup.tsx"` → no match. | REMOVE | — | — |
| `apps/web/src/data/inventoryData.ts` | FIXED (deleted) | Same check as 44.1b above. | REMOVE | — | — |
| `REPORT.md` (root) | **STILL OPEN** | `head -5 REPORT.md` → still the stale "Phase 2 E2E Crawl Report", **Generated 2026-04-06**, still sitting at repo root, never archived. `git log -1 --format=%ai REPORT.md` → last touched 2026-04-13. | WORK (delete/tombstone per §4) | low | S |

## 44.6 Auth-context placeholders

| Item | State | Evidence | Rec | Sev | Size |
|---|---|---|---|---|---|
| `ManualOverrideModal.tsx` hardcoded `MGR_001` | **OBSOLETE (file deleted)** | Confirmed by the entry's own later text (line 1163: "Done 2026-08-26 … `components/inventory/ManualOverrideModal.tsx` (356 ln) deleted") — cross-checked `find apps/web/src -iname ManualOverrideModal.tsx` → no match. | REMOVE | — | — |
| `one-tap-actions.service.ts` three unimplemented action bodies | **PARTLY — the "hollow success" defect is fixed, the workflows are still unbuilt** | `sed -n '1,90p' one-tap-actions.service.ts` → ADR 0083 (2026-09-05) rewrote this: an action's disposition (`workflow`/`record`/`unbuilt`) is decided before anything is written, and an `unbuilt` action (reorder, price update) is now **refused with a full sentence and stays `pending`**, rather than silently marked done. So the specific defect named (claims success for work that never happened) no longer reproduces. Reorder/price-update workflows themselves remain genuinely unbuilt — that's Track C/ROADMAP scope now, not a hollow-success bug. | REMOVE the hollow-success defect; MOVE "build reorder/price-update workflows" to ROADMAP as unbuilt scope | — | — |
| 44.6b | 1131–1169 | FIXED / ALREADY BUILT | `grep -n reconcileItem RowExpansion.tsx` region and the entry's own later addendum ("Done 2026-08-26 … `/inventory-legacy` retired") — cross-checked `find apps/web/src/pages -iname Inventory.tsx` → no match (confirms the retirement). | REMOVE | — | — |

## Track C — Unbuilt v2.0 scope (44.7–44.13)

| ID | Lines | State | Evidence | Rec |
|---|---|---|---|---|
| 44.7 | 1176–1181 | UNBUILT-SCOPE, partly delivered | `find scripts -iname simulate` → `scripts/simulate` exists; `find scripts -iname "test_simulate*"` → 3 test files. Panel's verification half and the accelerated simulator exist per ADR 0093 (matches memory note "Scenario harness ADR 0093 — live day passed"). Remainder (fire-orders-by-click, missed-webhook detector, Railway deploy) not independently verified as still absent — trusted the doc's own 2026-09-02 update as current, since nothing in git history contradicts it. | MOVE to ROADMAP as carried scope |
| 44.8 | 1183–1185 | UNBUILT-SCOPE | Depends on 44.7; not independently checked further. | MOVE |
| 44.9 | 1187–1189 | UNBUILT-SCOPE | Same. | MOVE |
| 44.10 | 1191–1193 | UNBUILT-SCOPE | Same. | MOVE |
| 44.11 | 1195–1198 | UNBUILT-SCOPE | Can run in parallel, not gated on 44.7. | MOVE |
| 44.12 | 1200–1203 | UNBUILT-SCOPE | Gated on 44.8–44.11. | MOVE |
| 44.13 | 1205–1207 | UNBUILT-SCOPE | Lowest-risk carry-forward per the doc. | MOVE |

## Track D — Unbuilt plans found in the wider sweep

| ID | Lines | State | Evidence | Rec |
|---|---|---|---|---|
| 44.14 | 1215–1253 | Self-triaged 2026-08-04, itself now 6 weeks stale relative to 2026-09-18 | Not independently re-verified per-plan (each of the 5 plan files is a grep-and-excerpt target per CLAUDE.md §2 and re-auditing all 5 exceeded this pass's budget). Memory notes ("Inbound email intelligence plan — Phase 0 shipped; provider_promotions is live", "Inventory SOTA rebuild plan — 13 locked decisions") suggest further phases have moved since 2026-08-04, so this table's "genuinely outstanding" list is itself a candidate for staleness the same way 44.14's own opening paragraph describes. **Explicitly not verified — flagging rather than guessing.** | DECIDE / re-run a dedicated 44.14 reconciliation before using this list as a backlog |
| 44.15 (both headings, 1255–1269 and 1357–1383) | Catalog still stale, situation now compounded | `ls -la .planning/07-reference/UX_PATHS_CATALOG.md` → still 158,311 bytes; `grep -n "AUDITED 2026-07-31" UX_PATHS_CATALOG.md` → the same stale-audit banner from 7 weeks ago is still the newest one in the file. Separately, ADR 0149 (locked 2026-09-16, confirmed present at `.planning/decisions/0149-*.md`) is now rebuilding every page as Mudavym and deleting legacy once — which supersedes much of what this catalog is tracking (dead buttons on pages being wholesale replaced, not patched). | MOVE — fold any still-relevant entries into ADR 0149's page-finish tracking rather than maintaining a second, separately-stale catalog; founder call on whether to retire `UX_PATHS_CATALOG.md` outright |

## Closed-since-compiled log (1273–1310)

| Item | Lines | State | Evidence | Rec |
|---|---|---|---|---|
| 44.1a closure log | 1278–1280 | Duplicate citation of the 44.1a row above | Same evidence as 44.1a. | REMOVE (merge with 44.1a) |
| Inventory add/remove build list | 1282–1308 | PARTLY — items 1–6 fixed, item 7 open | `grep -n "item 7" .planning/07-reference/INVENTORY_ADD_REMOVE_SCENARIOS.md:149` → "Items 1–6 of §5 are complete. Item 7 (removal hardening) is the only one still open." Also still true: `master_wine_library.retail_price_avg` is null on all rows so the Market Price column still renders "—" (not re-queried live; doc says 442/442, unverified today). | WORK item 7 (removal hardening); DECIDE/WORK the price-enrichment gap separately |

## Deferred by design (1311–1322) — table of 6 rows

| Item | State | Rec |
|---|---|---|
| Cost-drift/straight-through-rate/days-to-close metrics | DECIDED deferral | MOVE — already pointed at `YC_WEDGE_PLAN.md`, drop from this doc |
| Line-match suggestions, no UI | DECIDED deferral | MOVE — same, already pointed at `YC_WEDGE_PLAN.md` |
| Track C POS adapters cut | DECIDED | MOVE — already pointed at `YC_WEDGE_PLAN.md` REVISION 2 |
| Agent-native UI — DO NOT BUILD | CONVENTION/DECIDED | MOVE — already pointed at its own decision doc |
| Per-tenant RLS on authed clients | DECIDED deferral, but now sharper | DECIDE — OD-72 (closed 2026-08-26, corrected 2026-09-17 per my read of `OPEN-DECISIONS.md`) shows 52/73 policies still anchor on `auth.uid()`, permanently unsatisfiable without a Supabase Auth migration; this is the same root cause as 44.1e-sommelier above. Worth the founder re-weighing "defence in depth only" now that a live user-facing feature (sommelier history) is broken by it, not just a theoretical gap. |
| CI ruff/black/eslint-config debt + Security-Scan permission bug | Unowned, small | WORK (S each) — not independently re-verified this pass |
| Phase 23 Gmail OAuth2 — DROPPED | DECIDED, final | REMOVE — fully resolved, no action needed |

## Meta sections (1325–1601)

| Section | Lines | State | Rec |
|---|---|---|---|
| "Suggested ordering" | 1325–1337 | Meta / advice, not a defect | REMOVE (moot once the register itself is retired) |
| "44.5 correction — InvoiceScannerModal was orphaned after all" | 1338–1354 | Historical correction, already folded into 44.5's InvoiceScannerModal row above | REMOVE (superseded, file deleted) |
| "44.15 — UX catalogue audited 2026-07-31" | 1357–1383 | See 44.15 row above (Track D) | MOVE (merged with 44.15) |
| Data integrity — `api_spend.restaurant_id` holds wine UUIDs | 1385–1395 | **FIXED, measured live today** | Ran (Supabase MCP, SELECT-only, project `exzueerziesmczwlhomd`): `SELECT count(*) FROM api_spend s WHERE EXISTS (SELECT 1 FROM master_wine_library w WHERE w.id = s.restaurant_id)` → **0 rows**. Also: 183 total `api_spend` rows, 18 with a valid restaurant, **165 with `restaurant_id IS NULL`** (all 12 `serper` rows are among the NULLs, not wine UUIDs), latest row 2026-08-24 (nothing written since — table may no longer be the active ledger, consistent with the P1 Neural-Footprint architecture superseding it). The specific pollution named here does not exist today, whether by remediation or by the ledger's own evolution. | REMOVE |
| CI — Lint TypeScript red for two errors | 1398–1435 | FIXED | `grep -n eslint-disable apps/web/src/lib/devAuthBypass.ts` → no match (directive removed). `grep -rn DIACRITICS apps/api-gateway/src/wines/` → the fixed, `\u`-escaped, alternated single-range regex now lives in `wine-signature.ts:74-84` (moved from `wine-submissions.service.ts` in an unrelated refactor, content matches the described fix exactly). Did **not** re-run a full `pnpm lint` (would need `heavy.sh`; skipped given time budget) — flagging that the "0 errors, 198 warnings" headline number is unverified today, only the two named fixes are. | REMOVE (with the lint-count caveat noted) |
| Tooling blind spot — `.gitignore` hides " 2" duplicates | 1437–1486 | PARTLY | `find . … -regex '.* [0-9]+\.[A-Za-z0-9]+$'` (excluding node_modules/.git/venv/__pycache__) → **zero stray files found today**, confirming the two named Python strays are still gone. But `grep -n "Accidental duplicate\|\* 2\.py\|\* 2\.md" .gitignore` → the ignore rule is still exactly as narrow as described (only `.py`/`.md`), so the systemic gap (a `* 2.ts`/`.tsx`/`.json`/`.sql` would still slip in unflagged) is unaddressed. | REMOVE the two fixed instances; DECIDE the ignore-rule policy (the entry's own two options still stand) |
| Security — Google sign-in self-provisioned a manager | 1488–1561 | FIXED, and its own follow-on gap also closed | `grep -n "insert\|throw" ` on `findOrCreateOAuthUser` (`auth.service.ts:1769-1893`) → no INSERT/create branch remains, only `UnauthorizedException` refusals — matches PR #179's fix. The struck-through "resolve by email without writing a link row" gap: `find … identity-first-signin.spec.ts` exists; `grep -n user_oauth_accounts auth.service.ts:1880` shows the lookup now requires a bound row, matching ADR 0139 (PR #357)'s described fix. | REMOVE the fixed defects; DECIDE the one genuinely still-open product question the entry names verbatim: "whether gated Google self-signup should exist at all" |
| Convention — `toLocaleDateString` needs explicit UTC | 1563–1600 | FIXED (both named instances) + stands as a convention | `grep -n timeZone studio-invite.controller.ts` → `"UTC"` present at line 102. `find … template-config.ts` exists with the described type-branching fix (string vs `Date`). | REMOVE the two fixed defects; MOVE the convention itself ("a wire timestamp formatted with `toLocaleDateString` needs an explicit `timeZone: "UTC"`, and a UTC-only CI TZ makes its absence untestable") into CLAUDE.md or an engineering-conventions doc — it's exactly the CONVENTION category the founder asked to separate out from defects |

---

## What I could not check (stated plainly, per CLAUDE.md §0.5)

- Did not re-run `pnpm run lint`, `pnpm run test`, or any jest/pytest suite (would require `heavy.sh`; time budget for this pass went to breadth across 1,601 lines instead). Every "tests exist / N tests" claim above was verified by counting `it(`/`test(`/`def test_` in the file, not by running them.
- 44.14's five underlying plan files (`ANALYTICS_FEATURE_CATALOG.md`, `INBOUND_EMAIL_INTELLIGENCE_PLAN.md`, `INVENTORY_SOTA_PLAN.md`, `PROSPECTS_ATTRIBUTION_ARCHITECTURE.md`, `SYNTHETIC_DATA_AND_DOCS_PLAN.md`) were not individually re-audited — each is large enough to be its own grep-and-excerpt pass, and this document's own 44.14 section already flags itself as likely stale again.
- 44.1f's `create-location-grants-access.spec.ts` and 44.1r/44.1t were taken on the doc's own file:line citations plus consistent evidence found while checking neighboring entries (44.1i, 44.1j, 44.1q touch the same files) — not independently re-derived from scratch.
- Phase 30's iCal external-calendar-client verification gap (44.4): could not find any newer reference either confirming or retiring it.
