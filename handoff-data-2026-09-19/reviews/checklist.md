# Founder checklist — v3.0-TECH-DEBT.md successor triage

Generated 2026-09-18/19 from 198 register entries + 47 review findings, merged and spot-checked.

| Group | Count |
|---|---|
| Remove - already done or gone | 89 |
| Remove - legacy being deleted | 9 |
| Fix - security and money | 18 |
| Fix - broken features | 41 |
| Fix - quality and tests | 9 |
| Decide | 43 |
| Move - rules and decided deferrals | 14 |
| Move - future scope | 8 |
| **Total** | **231** |

## Open-branch check (step 3)

`git -C restaurant-ai-automation fetch -q`, then compared each branch's copy of `v3.0-TECH-DEBT.md` against wt-review's (804a1bdb5) with `git diff --stat`:

| Branch | Exists on origin? | Result |
|---|---|---|
| `feat/gate-owned-by-diff` | **No** — `git rev-parse origin/feat/gate-owned-by-diff` fails | Nothing to add. (A similarly-named `fix/gate-owned-paths-deploy-yml` exists but is an unrelated, ancient branch from 2026-09-06/PR #325 — not this one.) |
| `fix/sessions-follow-membership` | **No** — does not exist yet, as the task itself flagged | Nothing to add. |
| `docs/wine-ml-foundations` | Yes (`a9907848`) | Its copy of the file is **stale, not ahead**: `git diff --stat 804a1bdb5 a9907848 -- .planning/v3.0-TECH-DEBT.md` → `2 insertions(+), 724 deletions(-)`. The branch forked before PR #393's rounds landed 44.1g/h/j/p/q's closures and never rebased; it holds *fewer* register entries than wt-review, not new ones. **0 new entries to add.** (Its separate wine-intelligence findings are already folded into this checklist as `models-F4`, sourced from the same branch's `wine-intelligence-foundations.md`.) |
| `feat/finish-leaks` | Yes (`08116dad0`) | **Already fully merged** into wt-review's HEAD: `git merge-base --is-ancestor origin/feat/finish-leaks 804a1bdb5` → true (it is 804a1bdb5's own second parent — see `git log --oneline` above). The task's note about "ADR 0159 round 7 closing the A3/A9 reach-through entry" is already reflected in wt-review; no separate entries needed. |

**Net: no register entries exist on an open branch that isn't already in wt-review.**

## REMOVE spot-check log (step 1)

16 REMOVE-recommended register items independently re-verified against the live wt-review tree (commands run, not copied from the register's own evidence text). **Zero flips** — every one still holds:

- **`44.1a`** — grep JwtAuthGuard/UseGuards in one-tap-actions.controller.ts → `@UseGuards(JwtAuthGuard)` present at class level.
- **`44.1g`** — grep the register() handler in auth.controller.ts → `register(): never { throw new GoneException(...) }` — confirmed 410.
- **`44.1p`** — grep .eq("restaurant_id"...) scoping in members.service.ts → 5 house-scoped filters present on the role-write paths.
- **`44.1q`** — test -f + grep roleInHouse in auth/house-role.ts → `export function roleInHouse(...)` present, matches the described per-house read.
- **`44.2a`** — grep IS_STUB gating in core/orchestrator.py + count agent files → 5 agent files declare `IS_STUB = True`; orchestrator.py:258 gates on it.
- **`44.3a`** — test -f the baseline migration → 20260805000000_baseline_from_production.sql exists.
- **`2028`** — grep 'NOT MOUNTED' in useUxOverrides.ts → Docstring now reads 'NOT MOUNTED ANYWHERE' as claimed.
- **`2064.2`** — read globals.css around the cited line range → `.dark input/select/textarea` counterparts present with dark colors.
- **`2099.1`** — grep ServiceUnavailableException in providers.service.ts + spec file → Both present; fail-open guard confirmed.
- **`1743`** — grep conflict-marker lines in decisions/0032; check CI wiring → 0 conflict markers; `check_no_conflict_markers.py` wired into ci.yml.
- **`codeql-two-highs`** — read stripJsonFence in document-extractor.service.ts → String slicing, no regex — ReDoS surface gone.
- **`ci-migration-version-guard`** — test -f the guard script + grep the CI job name → Script exists; CI job 'A migration version names one migration' present.
- **`library-identity-main-fix`** — test -f the migration + grep wine_identity_is_specific → Migration exists and is the only one naming that column.
- **`google-signin-self-provision`** — read findOrCreateOAuthUser end-to-end in auth.service.ts → No insert/create branch anywhere in the function — refusal-only, confirmed line-by-line.
- **`2825.A4`** — read runwayDays() in bits.tsx → Returns `null` when velocity is not > 0, matching the fix description.
- **`2717.F9`** — grep current_volume_ml across apps/api-gateway/src excluding specs → 0 hits — column fully abandoned as claimed.

## Remove - already done or gone (89)

### `vendor-lens-d15-vendor-resolution` — Documents never resolved a vendor from the seller's own name — closed by tax-id identity matching
- **Plain:** The fix is built and deployed; it just hasn't had a real document to prove itself on yet, confirmed by a live database check today.
- **State:** FIXED · **Severity:** low · **Size:** - · **Source:** register:vendor-lens-d15-vendor-resolution
- **Do:** delete, but note the live-proof gap is a natural follow-on to watch, not a code defect
- **Evidence:** Closed by ADR 0104 D15 (PR #351). Live check via Supabase MCP: SELECT count(*) FROM document_vendor_resolutions -> 0 rows total — table exists and is migrated, but has never actually matched or created a vendor live yet

### `44.1a` — one-tap-actions had no auth guard (logged twice in the register)
- **Plain:** This security hole was already fixed and verified; the register just wrote it down twice.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:44.1a+closed-44.1a-log
- **Do:** delete both rows from the successor register
- **Evidence:** 44.1a: one-tap-actions.controller.ts now carries a class-level JwtAuthGuard; grep confirms no more URL-supplied restaurantId/hardcoded userId. Doc's own closure log at 1278 agrees (fd7b8af). | closed-44.1a-log: Identical defect and evidence as the 44.1a row above; the document logs it a second time in its own closure section.

### `vendor-lens-accept-as-billed-cluster` — Vendor/delivery reconciliation: 3 real fixes, restated 5 times in the register
- **Plain:** The delivery-reconciliation bugs (accept-as-billed lying, door count showing as Billed, a raw database error leaking) are fixed and confirmed; the register just repeats them under several ids.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:vendor-lens-v5-accept-as-billed+vendor-lens-1-3-4-closed+vendor-lens-slice3stop3-finding1-dup+vendor-lens-slice3stop3-finding3-dup+vendor-lens-slice3stop3-finding4-dup
- **Do:** delete all 5 rows from the successor register, one line each in the closure log is enough
- **Evidence:** vendor-lens-v5-accept-as-billed: CLAIMS row ADR-0103-A11-ACCEPTANCE-ANSWERS-A-REAL-DIFFERENCE status resolved and holds; delivery.service.ts has recordedDifferences()/unansweredDifferences() | vendor-lens-1-3-4-closed: CLAIMS ADR-0103 (unansweredDifferences), TD-2026-09-06-DOOR-COUNT-RENDERS-AS-BILLED, TD-2026-09-06-DOOR-COUNT-DUPLICATE-CONSTRAINT all resolved and hold | vendor-lens-slice3stop3-finding1-dup: Same underlying fix (A11) as vendor-lens-1-3-4-closed, filed twice in the document | ven...

### `item-activity-blind-to-deliveries` — Item activity door blind to delivery bookings (restated once)
- **Plain:** Fixed — the activity page now shows deliveries coming in, not just sales going out; the register said this twice.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:vendor-lens-v6-item-activity+itemactivity-blind-dup
- **Do:** delete both rows
- **Evidence:** vendor-lens-v6-item-activity: CLAIMS V6 resolved, holds; inventory.service.ts has totalIn28d and raises on failed reads instead of returning zeros | itemactivity-blind-dup: Same fix as vendor-lens-v6-item-activity

### `44.1c` — Inbound email agents never registered
- **Plain:** This was fixed even though the tracking document never says so.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:44.1c
- **Do:** delete from register
- **Evidence:** core/orchestrator.py registers both EmailIntelAgent and EmailParsingAgent; EmailIntelAgent now subscribes to email.inbound.received, not the dead .raw key. Doc never marks this closed, but code shows it is.

### `44.1d` — notifications writes rejected on NOT NULL columns
- **Plain:** Already fixed per the record; a live write test wasn't re-run but nothing contradicts it.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:44.1d
- **Do:** delete from register
- **Evidence:** Doc states RESOLVED; core/notifications.py exists as described. Not independently re-tested with a live insert (would need a write).

### `44.1g` — Public sign-up could self-assign a house and a role
- **Plain:** This sign-up hole is closed and verified directly in the code.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:44.1g
- **Do:** delete from register
- **Evidence:** auth.controller.ts's register() now throws GoneException (410 Gone); AuthService.register is deleted from auth.service.ts (only registerRestaurant remains); register-is-closed.spec.ts exists.

### `44.1h` — A manager could mint an owner's invite
- **Plain:** Fixed: a manager can no longer create an invite that makes someone an owner.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:44.1h
- **Do:** delete from register
- **Evidence:** role-grant.ts exports grantRefusal per ADR 0162; invite-role-ceiling.spec.ts exists with 19 tests, matching the doc's claim.

### `44.1j` — Leaving or being removed left a stale house pointer
- **Plain:** Fixed: leaving a restaurant no longer leaves a dangling pointer back to it.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:44.1j
- **Do:** delete from register
- **Evidence:** auth.service.ts:2597 and members.service.ts's clearUsersRowHouse both clear users.restaurant_id filtered to the specific house being left, not unconditionally; removal-only-that-house.spec.ts exists.

### `44.1p` — A role change in one house rewrote it everywhere
- **Plain:** Fixed: changing someone's role in one restaurant no longer silently changes it everywhere else they work.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:44.1p
- **Do:** delete from register
- **Evidence:** members.service.ts's updateMemberRole now scopes the users.role write to the one house being changed, confirmed live; 9 dedicated tests pin the behavior.

### `44.1q` — A role change in another house never reached the permission guard
- **Plain:** Fixed: your permission level in one restaurant now correctly stays separate from another restaurant you also work at.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:44.1q
- **Do:** delete from register
- **Evidence:** jwt.strategy.ts now reads a per-house role when the token names a house, instead of the global users.role, exactly matching the described fix; house-role.ts's roleInHouse function matches verbatim.

### `44.2z` — Retired Gemini model ids across the orchestrator
- **Plain:** This was already fixed and is tracked elsewhere under a different name; this copy of it is stale and can go.
- **State:** OBSOLETE · **Severity:** none · **Size:** - · **Source:** register:44.2z
- **Do:** superseded by OD-57 and OD-63 (OD-68 remains open on its own, untouched by this)
- **Evidence:** OPEN-DECISIONS.md's OD-57 row shows this was swept and closed 2026-08-24/26 — only 3 inert gemini-pro references remain (2 comments, 1 historical price row); OD-63 also closed separately. This entry's "27 further references remain" figure is stale and superseded.

### `44.2a` — Five empty agents silently counted as live
- **Plain:** Fixed: these unfinished background workers can no longer masquerade as running.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:44.2a
- **Do:** delete from register
- **Evidence:** All 5 named agents declare IS_STUB = True; core/orchestrator.py:258 refuses to start any agent so marked; test_agent_registry_gating.py has 9 test functions (2 parametrized, ~21 cases total), matching the doc's claimed 20 test count closely.

### `44.2c` — Deploy check reported a correct no-op deploy as a failure
- **Plain:** Fixed: the deploy checker no longer flags a correct, intentional no-op deploy as broken.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:44.2c
- **Do:** delete from register
- **Evidence:** scripts/resolve_watched_commit.py exists with the described --first-parent fix for the watched-path resolution.

### `44.3a` — 13 ghost tables existed in production but no migration
- **Plain:** Fixed: a freshly built database now matches production's tables exactly.
- **State:** OBSOLETE · **Severity:** none · **Size:** - · **Source:** register:44.3a
- **Do:** delete from register
- **Evidence:** All 13 named tables now have a CREATE TABLE in supabase/migrations/20260805000000_baseline_from_production.sql (checked each individually); supabase/SCHEMA_DRIFT.md itself is headed "RESOLVED 2026-08-05 by a production baseline."

### `44.3c` — pos_webhook_logs / scheduled_reminders schema gaps
- **Plain:** Both underlying tables are gone or were never wired up, so there's no live gap left to close.
- **State:** OBSOLETE · **Severity:** none · **Size:** - · **Source:** register:44.3c
- **Do:** delete from register, cite ADR 0137/0026/0028
- **Evidence:** pos_webhook_logs has no CREATE TABLE anywhere in the live migration tree (confirmed by a currently-passing CLAIMS.jsonl row, ADR-0137-b) — the table itself was retired, not just missing a column. scheduled_reminders also has no CREATE TABLE in the current schema, and nothing in the orchestrator writes it.

### `44.4` — Verification/tracking reconciliation for v2.0 phases 18-36
- **Plain:** This whole section is old bookkeeping from a milestone that finished a long time ago.
- **State:** OBSOLETE · **Severity:** none · **Size:** - · **Source:** register:44.4
- **Do:** delete from register; flag the Phase 30 iCal item to the founder only if that capability still ships and matters
- **Evidence:** PROJECT.md states the current milestone is P3 (P2 closed 2026-08-26); the v2.0-era phases (18-36) this section audits are multiple milestones behind current work. Phase 33's own reconciliation is already marked resolved in the text. Could not confirm either way whether Phase 30's iCal external-client verification gap was ever closed — no newer reference found.

### `deferred-gmail-oauth2-dropped` — Deferred: Phase 23 Gmail OAuth2 — DROPPED
- **Plain:** A final, already-acted-on decision with nothing left to do.
- **State:** DECIDED · **Severity:** none · **Size:** - · **Source:** register:deferred-gmail-oauth2-dropped
- **Do:** delete from register
- **Evidence:** Stated as final at the top of the document itself (line 42) and repeated here; no further action implied.

### `suggested-ordering-meta` — "Suggested ordering" section
- **Plain:** Just advice about the order to read this file in; not needed once the file is gone.
- **State:** OBSOLETE · **Severity:** none · **Size:** - · **Source:** register:suggested-ordering-meta
- **Do:** delete — moot once this register is retired
- **Evidence:** Meta-advice about how to work through this very document, not a defect itself.

### `api-spend-restaurant-id` — api_spend.restaurant_id held wine UUIDs in historical rows
- **Plain:** Checked the live database directly: this particular data problem no longer exists.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:api-spend-restaurant-id
- **Do:** delete from register
- **Evidence:** Ran a live SELECT (Supabase MCP, project exzueerziesmczwlhomd, read-only): 0 rows where api_spend.restaurant_id matches any master_wine_library id. Of 183 total api_spend rows, 18 match a real restaurant and the other 165 (including all 12 serper rows) have restaurant_id = NULL, not a wine UUID. The specific pollution this entry names does not exist today.

### `ci-lint-typescript` — CI Lint TypeScript was red for two errors, turbo hid the second
- **Plain:** Both specific lint errors were fixed; I confirmed the fixes are still in the code but didn't re-run the whole lint suite.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:ci-lint-typescript
- **Do:** delete from register (note: the "0 errors, 198 warnings" headline count itself was not re-verified)
- **Evidence:** Both named fixes confirmed live: devAuthBypass.ts's eslint-disable directive is gone; the DIACRITICS regex fix (adjacent-range character-class bug) is present, now living in wine-signature.ts after an unrelated refactor moved it out of wine-submissions.service.ts. Did not re-run the full pnpm lint suite (would need heavy.sh; skipped for time).

### `google-signin-self-provision` — Google sign-in could self-provision a manager of a real restaurant
- **Plain:** This serious security hole and its smaller follow-on gap are both closed and verified in the current code.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:google-signin-self-provision
- **Do:** delete from register
- **Evidence:** findOrCreateOAuthUser (auth.service.ts, checked live) has no create/INSERT branch left, only refusals; identity-first-signin.spec.ts exists. The follow-on gap (signing in on an email match without a linked account row) is also confirmed closed — the lookup now requires a bound user_oauth_accounts row, matching ADR 0139 / PR #357.

### `1682` — Analytics four-defect banner (parent, 'partly superseded')
- **Plain:** This banner just points to other entries; once those are cleaned up it can go too.
- **State:** OBSOLETE · **Severity:** none · **Size:** - · **Source:** register:1682
- **Do:** n/a
- **Evidence:** Superseded by its own three CLOSED sub-sections (1761, 1796, 1823) plus the still-open defect 4 tracked as its own row below.

### `1743` — Corpus — decisions/0032 has 36 conflict-marker lines
- **Plain:** The corrupted decision file was repaired and a guard now catches this class of corruption.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:1743
- **Do:** n/a
- **Evidence:** grep -c conflict markers in 0032-vault-cleanup-cut-line.md → 0; scripts/check_no_conflict_markers.py exists and is wired into ci.yml.

### `1761` — Analytics — procurement_orders.provider_name never existed — CLOSED
- **Plain:** Confirmed fixed — vendor and cashflow numbers read real data now.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:1761
- **Do:** n/a
- **Evidence:** advanced-analytics.service.ts reads vendor label via providers(name) FK embed; order-schema-drift.spec.ts present.

### `1796` — Analytics — deadStockCapital measured depth not movement — CLOSED
- **Plain:** Confirmed fixed — the 'dead stock' dollar figure now reflects sales movement.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:1796
- **Do:** n/a
- **Evidence:** dead-stock.spec.ts present (5 cases); code joins consumption per the entry's description.

### `1823` — Analytics — forecast backtest was in-sample fit — CLOSED
- **Plain:** Confirmed fixed — forecast accuracy numbers are no longer inflated.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:1823
- **Do:** n/a
- **Evidence:** engine/forecasting.ts:33-173 every model reports its own warmup; forecasting.spec.ts (7) and forecast-accuracy-honesty.spec.ts (4) exist.

### `1889` — Analytics — delivered filters wrong case — CLOSED
- **Plain:** Confirmed fixed — the cashflow panel's zero-orders bug and its sibling are gone.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:1889
- **Do:** n/a
- **Evidence:** order-status.ts + hasStatus() present; advanced-analytics.service.ts uses hasStatus for committedOpenOrders/openOrderCount; providers.service.ts:985-1027 createRetroactiveOrder rewritten.

### `1946` — Motion-canvas sweep — four defects, banner 'ALL FOUR CLOSED'
- **Plain:** All four confirmed fixed.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:1946
- **Do:** n/a
- **Evidence:** All four grep-anchors from the closure note verified live at HEAD.

### `1969` — (#1) stock:updated rewrote whole query trees
- **Plain:** Confirmed fixed — one bottle moving no longer refreshes the whole app.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:1969
- **Do:** n/a
- **Evidence:** apps/web/src/lib/websocket.tsx:570 predicate: isQueryAffectedByStockUpdate, exported and used elsewhere.

### `2028` — (#3) docstring asserts wiring that doesn't exist
- **Plain:** Confirmed fixed — the comment now tells the truth.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:2028
- **Do:** n/a
- **Evidence:** useUxOverrides.ts:12 now reads 'NOT MOUNTED ANYWHERE'.

### `2044` — (#4) Notifications.tsx discards foldedById
- **Plain:** Confirmed fixed — the 'N duplicates grouped' count now shows in the inbox.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:2044
- **Do:** n/a
- **Evidence:** Notifications.tsx:316,1317 destructures and renders foldedById.

### `2064` — Two defects, P2 door build (parent)
- **Plain:** Both confirmed fixed.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:2064
- **Do:** n/a
- **Evidence:** Both sub-items confirmed fixed below.

### `2064.1` — SyncManager silently deleted queued door receipts
- **Plain:** Confirmed fixed — queued receipts no longer vanish silently.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:2064.1
- **Do:** n/a
- **Evidence:** sync-manager.ts:234-246 skips unknown mutation types before the dead-mutation discard.

### `2064.2` — globals.css forces white inputs !important
- **Plain:** Confirmed fixed — dark pages no longer get glaring white input boxes.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:2064.2
- **Do:** n/a
- **Evidence:** globals.css:441-472 .dark input/select/textarea counterparts present, inherited from feat/mudavym-brand.

### `2099` — Absence-as-health — three acting instances — CLOSED (parent)
- **Plain:** All three confirmed fixed.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:2099
- **Do:** n/a
- **Evidence:** All three sub-items confirmed below.

### `2099.1` — providers dedup guard failed OPEN
- **Plain:** Confirmed fixed — a failed duplicate-check now blocks the write instead of allowing it.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:2099.1
- **Do:** n/a
- **Evidence:** providers.service.ts throws ServiceUnavailableException on failed maybeSingle() lookup; providers.fail-open.spec.ts exists.

### `2099.2` — pos-hub loadTables wrote wrong row, reported success
- **Plain:** Confirmed fixed.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:2099.2
- **Do:** n/a
- **Evidence:** pos-hub.service.ts:1227-1245 returns {tables, error} and logs on failure.

### `2099.3` — pos-hub recordConsumption silent omission
- **Plain:** Confirmed fixed — a failed sale write is now logged instead of vanishing.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:2099.3
- **Do:** n/a
- **Evidence:** pos-hub.service.ts:1083-1094 logs logger.error with PostgREST code; pos-hub.fail-open.spec.ts exists.

### `2251` — CI — nightly production E2E reported failure for 'not configured'
- **Plain:** The nightly test now says clearly when it can't check production instead of crying wolf.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:2251
- **Do:** n/a
- **Evidence:** e2e-prod.yml:130-144 'Required secrets are present' step present; pnpm/action-setup@v6.

### `2381` — Dev tooling — dev bypass minted unusable session — FIXED
- **Plain:** Confirmed fixed — local dev login now actually reaches a working page.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:2381
- **Do:** n/a
- **Evidence:** auth.service.ts, auth.controller.ts, dev-bypass.util.ts, strategies/jwt.strategy.ts all carry devBypass handling; dev-bypass-verified.spec.ts exists.

### `2433.3` — covers: null stored as 0
- **Plain:** Confirmed fixed — a comped check with no covers no longer reads as zero covers.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:2433.3
- **Do:** n/a
- **Evidence:** pos-adapters.ts:32-36 num() explicit-null-checks before Number().

### `2499.D1-12` — Nine of twelve numbered defects (mapping surface, threshold framing, $45 seed, no money/covers, wine-by-default, unknown-cost modal, below-par definitions, disabled Add-item, hours/timezone rendering)
- **Plain:** All nine of these are confirmed already fixed.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:2499.D1-12
- **Do:** n/a
- **Evidence:** Each carries its own FIXED (#307/#310/#312/#313) closure note in the doc; spot-checked and consistent with code at HEAD.

### `2499.D9` — Reports blames a missing POS while the POS is connected (never struck through in doc)
- **Plain:** This one was already fixed too, but the checklist never got updated to say so.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:2499.D9
- **Do:** n/a
- **Evidence:** apps/web/src/lib/reportsDataGap.ts describeReportsGap() distinguishes no_pos_connected/pos_sends_no_money/pos_status_unknown; wired into Reports.tsx:539. Never marked fixed in the register despite being fixed.

### `2666.A1-4` — Fabricated revenue / comparison period / busy hours / reconciliation variance
- **Plain:** All four fake-data widgets are confirmed fixed.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:2666.A1-4
- **Do:** n/a
- **Evidence:** useDashboardData.ts, PeriodCompareBar.tsx, BusyHoursHeatmap.tsx, MonthlyReconciliation.tsx each carry a comment confirming the Math.random() fabrication was removed.

### `2666.A7` — Stale claim: pos-mapping-review said unanswered unit resolves to 'bottle'
- **Plain:** Confirmed fixed.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:2666.A7
- **Do:** n/a
- **Evidence:** pos-mapping-review.dto.ts uses effect_if_unanswered/queue_on_next_sale vocabulary now.

### `2666.A8` — Alert ledger records alerts nobody received
- **Plain:** Confirmed fixed.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:2666.A8
- **Do:** n/a
- **Evidence:** low-stock-alerts.service.ts writes last_alerted_at/alert_count only after persistForRestaurant confirms a row; held-case columns present.

### `2666.A9` — Rate limit reported as a logout
- **Plain:** Confirmed fixed — a busy moment no longer logs everyone out.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:2666.A9
- **Do:** n/a
- **Evidence:** AuthContext.tsx:308-330 only a 401 clears tokens now; comment documents the fix.

### `2717.F1` — Notifications scoped to USER not tenant
- **Plain:** Confirmed fixed — one restaurant no longer sees another's alerts.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:2717.F1
- **Do:** n/a
- **Evidence:** Restaurant-scoped reads keyed off the verified JWT now, per the doc's own #318 closure text.

### `2717.F2` — Unrecognised wine asserted RED
- **Plain:** Confirmed fixed.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:2717.F2
- **Do:** n/a
- **Evidence:** useInventoryPage.ts/wineData.ts — 'unknown' is now a type-union member per the doc's fix description.

### `2717.F3` — Library writes fabricated producer/'Unknown' country
- **Plain:** Confirmed fixed.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:2717.F3
- **Do:** n/a
- **Evidence:** wine-submissions.service.ts writes NULL now (same file confirmed for the 2958 duplicate).

### `2717.F4` — Generic menu name binds cross-tenant wine (HOUSE WHITE)
- **Plain:** Confirmed fixed — a venue's own house wine no longer gets mistaken for another tenant's.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:2717.F4
- **Do:** n/a
- **Evidence:** git log shows fc6b9a77e fix(library): a generic name stays the venue's own wine (ADR 0130) (#319) on HEAD's ancestry; wine-submissions.service.ts:576-840 has provisional_for_restaurant_id.

### `2717.F5` — Unpriced menu row → HTTP 500
- **Plain:** Confirmed fixed.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:2717.F5
- **Do:** n/a
- **Evidence:** simpos_catalog.price NOT NULL dropped in migration 20260905174500.

### `2717.F9` — Open bottle volume tracked in two places, the read one empty
- **Plain:** Fixed by abandoning the unused column rather than reconciling it — the leftover column itself is harmless.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:2717.F9
- **Do:** n/a
- **Evidence:** grep current_volume_ml apps/api-gateway/src (excl. spec) → 0 hits; open_bottle_ml is now the sole live source.

### `2825.A2` — Low Stock widget says 'Unknown wine' over real names
- **Plain:** Confirmed fixed.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:2825.A2
- **Do:** n/a
- **Evidence:** Duplicate of §2866 item 1, confirmed fixed there.

### `2825.A4` — Velocity of zero produces a finite runway ('630d')
- **Plain:** Fixed by the inventory page rebuild — a zero-sales item no longer shows a made-up 'days left' number.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:2825.A4
- **Do:** n/a
- **Evidence:** bits.tsx:16-21 runwayDays() now returns null when velocity is not >0, rendered as '-'.

### `2866.D1` — Dashboard can't read own low-stock payload (camelCase vs snake_case)
- **Plain:** Confirmed fixed — the low-stock card now shows real wine names and counts.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:2866.D1
- **Do:** n/a
- **Evidence:** services/api/inventory.ts normalizeInventoryItem exported and used by useInventoryQueries.ts; inventory.lowstock.test.ts exists (6 tests); doc records a browser-verified check.

### `2866.D2` — '30 orders' is actually thirty days
- **Plain:** Confirmed fixed.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:2866.D2
- **Do:** n/a
- **Evidence:** Reports.tsx:503-510 totalOrders now sums orderCount per day; comment documents the old bug.

### `2866.D4` — Sommelier offline fallback is dead code (hardcoded liveStock: null)
- **Plain:** Confirmed fixed.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:2866.D4
- **Do:** n/a
- **Evidence:** Doc's #317 closure describes the fallback rewritten to read real inventory.

### `2866.D5` — ADR 0020 fabrication still served (candidateTypesAvailable: 268 of 573)
- **Plain:** The inflated insight-count number is now clearly labeled as an upper bound, not a promise.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:2866.D5
- **Do:** n/a
- **Evidence:** insight-generator.service.ts:230-245 field now explicitly commented as an 'UPPER BOUND', paired with candidateTypesTotal; only remaining consumer is a dev/scenario debug page.

### `3044` — Canonical document slice 1 — four gaps (parent)
- **Plain:** All confirmed fixed.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:3044
- **Do:** n/a
- **Evidence:** All four items and the one nested residual confirmed fixed below.

### `3044.1` — coerceDocType still filed 5 new doc types as unknown
- **Plain:** Confirmed fixed.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:3044.1
- **Do:** n/a
- **Evidence:** document-extractor.service.ts:339,491-505 coerceDocType now derives from the DOC_TYPES array, single source of truth.

### `3044.2` — BT-149 (price base qty) couldn't round-trip through ParsedDocument
- **Plain:** Confirmed fixed, including the follow-up gap the entry itself flagged.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:3044.2
- **Do:** n/a
- **Evidence:** migration 20260904120000 adds price_base_qty/price_base_uom to procurement_document_lines; canonical-document.service.ts reads them back. The entry's own 'still open: no columns' residual is resolved by the same migration.

### `3044.3` — No per-field confidence, no as_printed on numbers
- **Plain:** Confirmed fixed per the register's own detailed closure note.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:3044.3
- **Do:** n/a
- **Evidence:** Trusted from the doc's detailed #298 closure text; consistent pattern confirmed elsewhere in the same file family.

### `3044.4` — Invariants have never seen a real vendor document
- **Plain:** Real vendor documents have now flowed through the system, unlike when this was written.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:3044.4
- **Do:** n/a
- **Evidence:** datasets/canonical/CORPUS-RUN-2026-09-05-after-306.md: procurement_documents holds 5 rows against production, no longer zero.

### `3107` — ADR 0104 slice 2 — six findings (parent)
- **Plain:** All six are done.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:3107
- **Do:** n/a
- **Evidence:** 5 of 6 closed in prose and confirmed; the 6th is fixed but mislabeled 'STANDING'.

### `3107.1-5` — Extractor-throw discards doc / clean-verdict-on-unread / $0.00 fabrication / filename 42703 / corpus headline hides untestability
- **Plain:** All five confirmed fixed per their own detailed closure notes.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:3107.1-5
- **Do:** n/a
- **Evidence:** Each carries FIXED in its own detailed prose already; not independently re-run beyond spot checks.

### `3107.6` — STANDING — unreadable() defaults currency to USD
- **Plain:** Already fixed — the checklist label just never got updated to say so.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:3107.6
- **Do:** n/a
- **Evidence:** document-intake.service.ts:952-956 currency: '', comment states 'This was the literal USD until 2026-09-06.' Entry's own 'STANDING' label is stale.

### `codeql-two-highs` — CodeQL two highs (stripJsonFence ReDoS, spreadPrinted proto injection)
- **Plain:** This security bug was already fixed and confirmed in the code.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:codeql-two-highs
- **Do:** delete
- **Evidence:** document-extractor.service.ts:151-156 stripJsonFence is startsWith/slice/trim, no regex; :553-614 PRINTED_KEYS allowlist + Object.create(null)

### `canonical-first-render-9-findings` — Canonical doc first render, 9 findings
- **Plain:** All nine document-reading issues from this review were fixed.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:canonical-first-render-9-findings
- **Do:** delete
- **Evidence:** VerdictBlock.tsx:34,211 hasComparisonSource + 'Not compared' text present; from-parsed-document.ts:703,707 deliveredDate; taxBreakdown present; closed by PR #304

### `canonical-second-render-2-findings` — Second render: deposit double-count + mapper drift (self-corrected)
- **Plain:** This was a mid-investigation note that got corrected and folded into the fix below it.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:canonical-second-render-2-findings
- **Do:** delete
- **Evidence:** Entry corrects itself in place; superseded by the FIXED entry immediately below

### `canonical-deposit-readback-fixed` — Deposit read-back and mapper drift fixed
- **Plain:** Fixed and confirmed present in the code today.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:canonical-deposit-readback-fixed
- **Do:** delete
- **Evidence:** from-parsed-document.ts:318 linesNetTotal() exists, called at :611; both mapping paths go through from-document-rows.ts:159

### `ci-migration-version-guard` — Two parallel PRs claimed one migration version — guard built
- **Plain:** This is a working safety check now, not an open problem.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:ci-migration-version-guard
- **Do:** delete
- **Evidence:** scripts/check_migration_versions_unique.py exists; CI job 'A migration version names one migration' present in .github/workflows/ci.yml:336

### `library-identity-main-fix` — Generic wine name auto-linked across venues — main fix
- **Plain:** Fixed: one venue's house wine can no longer silently attach to another venue's stock.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:library-identity-main-fix
- **Do:** delete
- **Evidence:** Migration 20260906010000_a_generic_name_stays_the_venues_own_wine.sql present and is the only one naming wine_identity_is_specific

### `library-identity-item1-repair` — 77 mislinked wine rows repaired in production
- **Plain:** Already done and verified in production.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:library-identity-item1-repair
- **Do:** delete
- **Evidence:** Entry records a founder-authorised production repair with measured before/after counts

### `library-identity-item2-shared-path-error` — Second countryless-wine import raised a raw error
- **Plain:** Fixed.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:library-identity-item2-shared-path-error
- **Do:** delete
- **Evidence:** Closed by #318 per entry; signature key now written NULL to match the stored row

### `library-identity-item4-widened-hole` — Removing the fabrication temporarily widened the false-match hole
- **Plain:** The temporary gap between two fixes is closed.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:library-identity-item4-widened-hole
- **Do:** delete
- **Evidence:** Entry records re-measurement post-merge: 0 candidates, two venues hold two distinct hashes

### `orders-wire-item1-vendor-name` — No vendor name on any order route
- **Plain:** Fixed — order screens now show the vendor's name.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:orders-wire-item1-vendor-name
- **Do:** delete
- **Evidence:** Founder-decided and built 2026-09-05; providerName on OrderResponseDto, vendor.ts central mapping

### `orders-wire-item2-recurrence` — Rebuilt orders page's Recurring station was structurally empty
- **Plain:** Recurring orders now actually work on the new page.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:orders-wire-item2-recurrence
- **Do:** delete
- **Evidence:** 9-column migration, DTO keys, and a cron generator all present per the entry's own build record

### `orders-wire-item3-quantity-received` — quantity_received column the DTO didn't map
- **Plain:** Fixed as the founder specified, with the remaining ambiguity stated honestly rather than hidden.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:orders-wire-item3-quantity-received
- **Do:** delete
- **Evidence:** Founder-decided; quantity-received-unit.ts pure reader built; DTO reports the unit ambiguity rather than resolving it, deliberately

### `orders-wire-guard-blindspot-widening-cast` — Widening cast in useOrdersNextData.ts invisible to the DTO guard
- **Plain:** The specific example cited here has already been cleaned up.
- **State:** OBSOLETE · **Severity:** none · **Size:** - · **Source:** register:orders-wire-guard-blindspot-widening-cast
- **Do:** delete
- **Evidence:** grep for 'as Order' in useOrdersNextData.ts finds no hit — the specific cast named in the entry is gone

### `orders-wire-guard-blindspot-status-type` — Guard compared key existence not type; Order.status case mismatch
- **Plain:** Fixed — the status field now matches what the server actually sends.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:orders-wire-guard-blindspot-status-type
- **Do:** delete
- **Evidence:** types.ts:259,310 OrderWireStatus type now used for Order.status, as the entry describes being fixed

### `dev-tooling-conflict-marker-guard` — Conflict-marker guard scanned only .planning/, not the whole repo
- **Plain:** Fixed — the guard now checks the whole repository, not just planning docs.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:dev-tooling-conflict-marker-guard
- **Do:** delete
- **Evidence:** scripts/check_no_conflict_markers.py has git ls-files + def scan_tracked; CLAIMS row CONFLICT-GUARD-2026-09-05 resolved and holds

### `canonical-slice3-stop1-finding2-kasa-koli` — Turkish unit words kasa/koli wrongly asserted unreadable in a test
- **Plain:** Fixed test, no further action.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:canonical-slice3-stop1-finding2-kasa-koli
- **Do:** delete
- **Evidence:** Entry states the test was corrected to use a genuinely unreadable word

### `canonical-slice3-stop1-finding3-revision-number` — Next revision number computed in two places, disagreeing by one
- **Plain:** Fixed.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:canonical-slice3-stop1-finding3-revision-number
- **Do:** delete
- **Evidence:** Entry states CanonicalDocumentService.nextRevision() is now the one method both callers use

### `canonical-slice3-stop2-findings-bundle` — Six findings closed same-PR: missing columns, migration-version collision, unitless qty, proposed_by collision, null-timer crash, order-only headline
- **Plain:** All six issues found while building the delivery doors were fixed in the same change.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:canonical-slice3-stop2-findings-bundle
- **Do:** delete
- **Evidence:** Each closed per the entry: real columns named, versions renumbered off 20260905232000, qtyProposedBottles field, allowlisted proposed_by, named-failure return, dual-basis comparison

### `vendor-lens-slice3stop3-finding2-cost-state` — inventory_lots.cost_state DEFAULT 'final' with no writer
- **Plain:** Fixed — stock cost is no longer marked settled by default before anyone verified it.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:vendor-lens-slice3stop3-finding2-cost-state
- **Do:** delete
- **Evidence:** CLAIMS TD-2026-09-06-COST-STATE-DEFAULT-FINAL resolved, holds; migration 20260906233000 sets default provisional with two real writers

### `vendor-lens-linkitem-door` — Invoice line with no inventory_id blocked price attach — closed via link-item door
- **Plain:** Fixed — a person can link a line to a shelf item and the system remembers it.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:vendor-lens-linkitem-door
- **Do:** delete
- **Evidence:** documents.controller.ts:1372 @Post(':id/lines/:lineId/link-item') exists and is live

### `slice4-live-redrive-closed` — 3 read-shape defects: unnamed 'someone here', 500 on missing provider, 500 on malformed lineId
- **Plain:** Fixed and confirmed live.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:slice4-live-redrive-closed
- **Do:** delete
- **Evidence:** Entry records a live read-back after #350 merged: 404/400 with proper sentences, proposal names the real person

## Remove - legacy being deleted (9)

### `atlas-backbone-F2` — ContactsModule never registered in app.module.ts `[legacy]`
- **Plain:** A whole contacts feature (6 endpoints) has been unreachable since it was written.
- **State:** OBSOLETE · **Severity:** low · **Size:** S · **Source:** finding:atlas-backbone-F2
- **Do:** delete apps/api-gateway/src/contacts or register ContactsModule in app.module.ts — founder call on which
- **Evidence:** apps/api-gateway/src/contacts/{contacts.controller.ts,contacts.service.ts} (461 lines) define ContactsModule; `grep -rl ContactsModule apps/api-gateway/src` returns only contacts.module.ts itself, not app.module.ts. Jest coverage for src/contacts is 0%.

### `atlas-backbone-F3` — Orphaned pre-NestJS relic file with zero references `[legacy]`
- **Plain:** A leftover file from before the current backend was built sits unused in the tree.
- **State:** OBSOLETE · **Severity:** low · **Size:** S · **Source:** finding:atlas-backbone-F3
- **Do:** delete services/api-gateway/routes/advanced_features.ts
- **Evidence:** services/api-gateway/routes/advanced_features.ts (423 lines); repo-wide grep for the path or an import of it returns nothing.

### `modules-F7` — contacts module has 0% test coverage and 8 public REST endpoints with no frontend caller `[legacy]`
- **Plain:** A set of API endpoints for managing contacts has no automated tests and the app's own screens never call it directly.
- **State:** OBSOLETE · **Severity:** low · **Size:** S · **Source:** finding:modules-F7
- **Do:** delete apps/api-gateway/src/contacts — unregistered in app.module.ts, unreachable, 0% coverage, its cited 'server-side callers' actually hit a different table (provider_contacts)
- **Evidence:** apps/api-gateway/src/contacts: 474 LOC, 8 endpoints (@Get/@Post/@Patch/@Delete), 0 spec files, coverage-summary.json shows 0.0% stmt/0.0% branch (heavy.sh jest run, apps/api-gateway/coverage/coverage-summary.json, 2026-09-18); grep of apps/web/src for '/contacts' or "'/contacts" returns 0 hits; server-side callers exist at apps/api-gateway/src/providers/providers.controller.ts and apps/api-gateway/src/communications/letters/house-letters.service.ts. [VERIFIER CORRECTION: The 'not fully dead — ca...

### `44.1b` — Silent stock loss on duplicate-add `[legacy]`
- **Plain:** The broken file behind this bug was deleted long ago.
- **State:** OBSOLETE · **Severity:** none · **Size:** - · **Source:** register:44.1b
- **Do:** delete from register
- **Evidence:** apps/web/src/data/inventoryData.ts no longer exists (file search returns nothing); zero importers anywhere.

### `44.1e-invoicescanner` — InvoiceScannerModal posts to a dead endpoint (id collision #1 of 2) `[legacy]`
- **Plain:** The broken modal was deleted; nothing to fix.
- **State:** OBSOLETE · **Severity:** none · **Size:** - · **Source:** register:44.1e-invoicescanner
- **Do:** delete from register
- **Evidence:** InvoiceScannerModal.tsx no longer exists anywhere in the repo (deleted per the 44.5 correction note too).

### `44.6b` — Persist the override audit trail `[legacy]`
- **Plain:** Already built and verified; nothing to do here.
- **State:** FIXED · **Severity:** none · **Size:** - · **Source:** register:44.6b
- **Do:** delete from register
- **Evidence:** The live /inventory page's manual-adjust flow already records who/what/why/when through the sanctioned write path; the legacy page and modal this entry worried about were deleted 2026-08-26, confirmed gone.

### `44.5-correction-note` — 44.5 correction — InvoiceScannerModal was orphaned after all `[legacy]`
- **Plain:** A note about a mistake that's already been corrected; no longer needed.
- **State:** OBSOLETE · **Severity:** none · **Size:** - · **Source:** register:44.5-correction-note
- **Do:** delete — folded into the 44.1e-invoicescanner / 44.5 rows
- **Evidence:** Historical correction note about a mistake already fixed; the file it discusses is confirmed deleted (see 44.1e-invoicescanner).

### `2666.A5` — Loading rendered as empty (~2.5s zero state) `[legacy]`
- **Plain:** The page this was found on has since been rebuilt.
- **State:** OBSOLETE · **Severity:** none · **Size:** - · **Source:** register:2666.A5
- **Do:** n/a
- **Evidence:** Measured against the pre-rebuild /inventory page; live page is now InventoryCommandPage.tsx, a different component with no equivalent found.

### `orders-wire-item2b-legacy-not-migrated` — Legacy Orders.tsx never mirrors recurrence `[legacy]`
- **Plain:** This old page is scheduled for deletion, not a fix — no separate task needed.
- **State:** OBSOLETE · **Severity:** none · **Size:** - · **Source:** register:orders-wire-item2b-legacy-not-migrated
- **Do:** covered by ADR 0149's legacy deletion plan
- **Evidence:** Orders.tsx:93 mapApiOrderToUi still doesn't set recurrence, but ADR 0149 puts /orders on the Mudavym rebuild list and deletes legacy code at cutover instead of patching it

## Fix - security and money (18)

### `offline-storage-swallow` — Offline storage's localStorage fallback can neither report a failed write nor tell an empty queue from an unreadable one
- **Plain:** When a phone's storage is full or broken, the app can think it saved a delivery record when it did not, and cannot tell the difference between 'nothing queued' and 'cannot read what is queued' — two prior fix attempts were withdrawn as themselves unsafe.
- **State:** OPEN · **Severity:** high · **Size:** M · **Source:** register:offline-queue-write-swallowed+offline-queue-read-swallowed
- **Do:** offline-storage.ts: have addPendingMutation/updatePendingMutation read back and reject on failure; same fix track for both directions
- **Evidence:** offline-queue-write-swallowed: offline-storage.ts:208-210 localStoragePut catches QuotaExceededError, logs, and returns normally with no rethrow; also used by sync-manager.ts and spotCountOutbox.ts | offline-queue-read-swallowed: idbGetAll/localStorageGetAll both catch and return an empty array; two prior fix attempts were withdrawn as themselves unsafe

### `expired-session-drops-door-receipts` — doorOutbox.ts deletes a queued delivery receipt on an expired login (401/403)
- **Plain:** If a phone's login expires mid-shift, a counted delivery can vanish from the queue instead of just waiting to retry after sign-in.
- **State:** OPEN · **Severity:** high · **Size:** S · **Source:** register:expired-session-drops-door-receipts
- **Do:** treat 401/403 as retryable, same as 408/429
- **Evidence:** doorOutbox.ts:415,584-585 still classifies 401/403 as a permanent drop alongside other 4xx errors; the proposed fix (treat as retryable) is stated but not applied

### `provider-intelligence-12-cross-tenant` — 12 ProviderIntelligenceService methods read across every restaurant tenant on live routes
- **Plain:** Any signed-in staff member at any restaurant can currently read another restaurant's vendor deals, negotiation notes, and conversation history — this is real and unfixed today.
- **State:** OPEN · **Severity:** high · **Size:** M · **Source:** register:provider-intelligence-12-cross-tenant
- **Do:** same fix pattern already shipped for compareProviders: thread restaurantId from the token into each method's query
- **Evidence:** Confirmed live: getAllActivePromotions/getExpiringPromotions/getPromoSavings/comparePromotions (provider-intelligence.service.ts:165-235) have no restaurant filter; controller passes no restaurantId to any of the 12 routes; no ADR/OD/CLAIMS row exists for this anywhere

### `models-F2` — api_spend logging went silent 25 days ago and Node-side LLM calls never write to it
- **Plain:** The system that tracks how much we spend on AI calls stopped recording three and a half weeks ago, and the web app's own AI features never fed it in the first place.
- **State:** OPEN · **Severity:** high · **Size:** M · **Source:** finding:models-F2
- **Do:** see evidence for the file to fix
- **Evidence:** select count(*), min(timestamp), max(timestamp) from api_spend -> 183 rows total, 2026-04-07 to 2026-08-24 (today is 2026-09-18, 25-day gap). grep -rl api_spend apps/api-gateway/src -> zero matches; only services/agent-orchestrator and supabase/migrations reference the table.

### `increment-trust-counter-definer-rpc-live` — A SECURITY DEFINER RPC any anonymous caller can invoke is still live in production; the fix exists but hasn't shipped
- **Plain:** A database function that lets any logged-in or even anonymous caller bump a trust counter for any user is still turned on live; the fix is already written and waiting in a queued PR, it just hasn't been merged and deployed yet.
- **State:** OPEN · **Severity:** medium · **Size:** S · **Source:** finding:atlas-surfaces-missed-M1+finding:modules-missed-M2
- **Do:** merge/deploy migration 20260917010400_a_security_definer_rpc_answers_only_to_the_server.sql from the PR #391 train to main/production
- **Evidence:** RE-VERIFIED LIVE 2026-09-18 (this session, Supabase MCP, project exzueerziesmczwlhomd): `select version from supabase_migrations.schema_migrations where version >= '20260917000000'` returns only 20260917010000, 20260917020000 and 20260918153000 — 20260917010400 (the fix) is still absent from production. get_advisors(security) currently shows public.increment_trust_counter(uuid) still WARN-listed as anon/authenticated-executable. || finding:atlas-surfaces-missed-M1: mcp Supabase get_advisors(proj...

### `44.1r` — Leaving doesn't end the session; org membership can open any house
- **Plain:** Someone removed from a restaurant can, in some cases, keep acting like they still belong there until they log out — already decided to fix, just not built yet.
- **State:** OPEN · **Severity:** medium · **Size:** M · **Source:** register:44.1r
- **Do:** a follow-up PR per ADR 0162's fourth addendum
- **Evidence:** Founder already decided "Membership only"; a follow-up PR enforcing it is still owed per the document; not independently re-verified live this pass beyond what 44.1f/44.1i already showed of the same file region.

### `2825.A3` — A 31-minute-old tenant told its stock is dead
- **Plain:** A brand-new cellar with no sales yet is still incorrectly flagged as having 'dead stock.'
- **State:** OPEN · **Severity:** medium · **Size:** S · **Source:** register:2825.A3
- **Do:** a dead_stock view migration
- **Evidence:** supabase/migrations/20260805000000_baseline_from_production.sql:3389 dead_stock view still (last_sold_at IS NULL OR <90d) AND on_hand>0, no created_at check; never touched since.

### `canonical-slice3-stop2-tr-vendor-terms-unseeded` — Turkish response_window/invoice_issuance rows in vendor_terms are unseeded
- **Plain:** Turkish deliveries still don't get a real legal countdown clock because nobody has entered the underlying rules.
- **State:** OPEN · **Severity:** medium · **Size:** S · **Source:** register:canonical-slice3-stop2-tr-vendor-terms-unseeded
- **Do:** a data-seeding migration for Turkish vendor terms
- **Evidence:** No migration inserts into vendor_terms for these clocks; every TR delivery still gets a blocked_unknown timer instead of a real deadline

### `seal-migrations-character-class` — 3 seal migrations parse the kind list with a character class that can silently drop a kind
- **Plain:** A database rule-list parser has a hidden bug that would silently drop any future category name with a capital letter or digit in it — nothing has broken yet, but the trap is still there.
- **State:** OPEN · **Severity:** medium · **Size:** S · **Source:** register:seal-migrations-character-class
- **Do:** a new migration that rewrites the constraint from a full-literal parse
- **Evidence:** Confirmed both sites present today: 20260905225000...:338,469, 20260905233000...:440, 20260906070000...:188 all still use the vulnerable regexp_matches pattern; already applied to production so the fix must be a NEW migration

### `44.1k` — users.role has no CHECK constraint
- **Plain:** A basic database safeguard against bad role values is still missing, though nothing bad is happening from it today.
- **State:** OPEN · **Severity:** low · **Size:** S · **Source:** register:44.1k
- **Do:** a migration adding a CHECK on users.role and NOT NULL on the access-row role
- **Evidence:** No CHECK constraint on users.role found anywhere in supabase/migrations/; the access-row role column does have one (user_restaurant_access_role_known) but users.role does not.

### `44.1l` — generateInvite swallows two error reads
- **Plain:** A failed database lookup here can show someone the wrong error message when inviting a teammate.
- **State:** OPEN · **Severity:** low · **Size:** S · **Source:** register:44.1l
- **Do:** auth.service.ts generateInvite
- **Evidence:** Both cited reads (restaurant/organization lookup, invite-code collision check) in auth.service.ts's generateInvite still bind only `data`, with no error handling, confirmed live.

### `44.1n` — Owner-protection rule inconsistent; 4 houses have no owner
- **Plain:** Most of this owner-protection rule is fixed or already decided; two rare edge cases around removing the very last owner are still open.
- **State:** PARTLY · **Severity:** low · **Size:** S · **Source:** register:44.1n
- **Do:** members.service.ts updateMemberRole
- **Evidence:** Team-page removal guard and the co-owner-demotion question are both closed and confirmed live in team.service.ts. The 4 ownerless houses were a deliberate founder decision (left as empty shells, re-measured 2026-09-18). Still open, both theoretical: a same-moment hand-over race with no lock, and a users-row-only owner demoting the only real access-row owner.

### `44.1o` — addMember overwrites a person's org-wide role
- **Plain:** Not causing harm today because nothing in the app uses this code path yet, but the code itself is still wrong.
- **State:** OPEN · **Severity:** low · **Size:** S · **Source:** register:44.1o
- **Do:** members.service.ts addMember
- **Evidence:** organization_members upsert in members.service.ts is still unconditional and its error unread, confirmed live; also confirmed no web or mobile client calls addMember today, so it's dormant.

### `44.1s` — "Owner only" routes actually admit managers too
- **Plain:** The founder already said this behavior is fine, but the route labels lie about what they actually allow, and just need correcting to match.
- **State:** OPEN · **Severity:** low · **Size:** S · **Source:** register:44.1s
- **Do:** roles.guard.ts + relabel the 11 named owner-only routes
- **Evidence:** roles.guard.ts confirmed live: any owner-or-manager-gated route also passes a manager and an "admin" role string, even when the route is decorated as owner-only.

### `44.1t` — A leaver's next login keeps their old role
- **Plain:** Someone who left a restaurant might still show the role they used to have there the next time they log in.
- **State:** OPEN · **Severity:** low · **Size:** S · **Source:** register:44.1t
- **Do:** auth.service.ts / the login flow
- **Evidence:** Not independently re-verified with a live login trace; consistent with the confirmed 44.1j behavior (the house pointer is cleared but the role value itself is left untouched).

### `44.3b` — approveDraft isn't atomic across status, stock and calendar
- **Plain:** The costly bug (sending the same purchase order twice) is fixed. A smaller gap remains where the calendar reminder isn't guaranteed to be created together with the order.
- **State:** PARTLY · **Severity:** low · **Size:** M · **Source:** register:44.3b
- **Do:** procurement.service.ts approveDraft — wrap the calendar/shadow-stock writes with the order status update, or accept the current best-effort recovery as sufficient
- **Evidence:** The dangerous double-send race (two people approving the same order at once) is now fixed with an atomic claim step and a dedicated spec, confirmed live in procurement.service.ts. The calendar-event write remains a separate, non-transactional step after the status update, also confirmed live.

### `deferred-ci-tooling-debt` — Deferred: CI ruff/black/eslint-config debt + Security-Scan permission bug
- **Plain:** Small, unowned tooling cleanup items — nobody has picked them up yet.
- **State:** OPEN · **Severity:** low · **Size:** S · **Source:** register:deferred-ci-tooling-debt
- **Do:** STATE.md's tech-debt tracking
- **Evidence:** Not independently re-verified this pass; doc marks it unowned and small.

### `2666.A6` — Unknown cost rendered as $0 `[legacy]`
- **Plain:** A fresh, smaller version of this issue exists on the new inventory page's total-value number.
- **State:** PARTLY · **Severity:** low · **Size:** S · **Source:** register:2666.A6
- **Do:** InventoryCommandPage.tsx
- **Evidence:** Old page superseded by InventoryCommandPage.tsx. New page's per-lot handling is honest, but its aggregate 'Value on hand' KPI still does (wac ?? price ?? 0), silently treating unknown cost as zero with no flag.

## Fix - broken features (41)

### `44.2d` — Deploy check still misreports correct production states as failures
- **Plain:** The automatic deploy checker still falsely flags good deploys as broken sometimes, which trains people to ignore it — including on real failures.
- **State:** OPEN · **Severity:** high · **Size:** M · **Source:** register:44.2d
- **Do:** scripts/check_deployed_sha.py + resolve_watched_commit.py, implementing the FLOOR <= running <= tip(main) invariant this entry already designed
- **Evidence:** grep for an ancestry check (is-ancestor) in scripts/check_deployed_sha.py and resolve_watched_commit.py finds none, confirmed live. Cross-checked CLAIMS.jsonl's own row "DEBT-44.2d", whose verify command is the exact same grep and whose status is currently open (i.e., correctly still failing).

### `atlas-surfaces-F1` — Atlas generator is blind to the ADR 0149 PageGate rollout pattern
- **Plain:** The tool we use to map the app's pages cannot see the new legacy-vs-Mudavym switch, so its 'broken page' list is mostly false alarms.
- **State:** OPEN · **Severity:** high · **Size:** M · **Source:** finding:F1
- **Do:** regenerate scripts/generate_design_atlas.py's route resolver to follow index.ts directories and PageGate's legacy/next branches
- **Evidence:** apps/web/src/App.tsx:239-396 wires 24 routes as <PageGate page="x" legacy={<Old/>} next={<New/>}/>; scripts/generate_system_atlas.py's regex only resolves a route to a file via a single lazy-imported component name, so route-file resolution is 20/61 (33%) and page-graph edges are only 26, almost all on public/auth pages. [VERIFIER CORRECTION: Core numbers reproduce exactly: repointed a copy of scripts/generate_system_atlas.py's hardcoded ROOT (it defaults to the main checkout, not wt-review — a ...

### `dashboard-top-wines-wrong-table` — 'Top Performing Wines' says no data over real sales (stated 3x in the register, incl. once more at #2866)
- **Plain:** The dashboard still says 'no sales data' over real sales because it reads the wrong table; one code fix closes all three copies of this bug.
- **State:** OPEN · **Severity:** medium · **Size:** S · **Source:** register:2825.A1+3007.10
- **Do:** apps/web/src/pages/Dashboard.tsx — read wine_consumption_log, not procurement orders + calendar
- **Evidence:** 2825.A1: Dashboard.tsx:327-345 still aggregates procurement orders + calendar, never wine_consumption_log. Dashboard.tsx is still the default page (mudavym_design_dashboard flag defaults false). | 3007.10: Same as 2825.A1 — stated at 2825, 2866, and here.

### `44.1m` — Opening a house swallows three setup writes
- **Plain:** If one of three setup steps for a brand-new restaurant fails silently, the owner could end up locked out of their own restaurant with no warning to anyone.
- **State:** OPEN · **Severity:** medium · **Size:** S · **Source:** register:44.1m
- **Do:** auth.service.ts registerRestaurant
- **Evidence:** All three post-registration writes in registerRestaurant (organization owner, organization member row, access row) still have no error check, confirmed live in auth.service.ts.

### `1662` — A11y — em dash silent to AT; sheets lack focus traps
- **Plain:** Screen readers can't tell when a value is 'unknown,' and pop-up panels don't trap keyboard focus.
- **State:** OPEN · **Severity:** medium · **Size:** M · **Source:** register:1662
- **Do:** lib/mudavym foundation work
- **Evidence:** grep -rn 'aria-label="unknown"' apps/web/src → 0 hits; no focus-trap library wired into TwinSheet/TemplateSheet.

### `1994` — (#2) dropped door receipt indistinguishable from delivered
- **Plain:** Door receipts are fixed, but a lost inventory spot-count still looks the same as a successful one.
- **State:** PARTLY · **Severity:** medium · **Size:** S · **Source:** register:1994
- **Do:** lib/spotCountOutbox.ts
- **Evidence:** doorOutbox.ts:135,155,690 DROPS_KEY_PREFIX/onChange(result) confirmed fixed. Residual: apps/web/src/lib/spotCountOutbox.ts:112 still has the identical shape with no lost-count record.

### `2433` — POS bridge — four defects the Square day measured (parent)
- **Plain:** Most of these logging gaps in the POS bridge are still there.
- **State:** PARTLY · **Severity:** medium · **Size:** M · **Source:** register:2433
- **Do:** n/a
- **Evidence:** 1 of 4 fixed; three still open, see sub-rows.

### `2433.1` — Discard-all path logs nothing
- **Plain:** When the POS bridge can't recognize a payload at all, nothing gets logged — it looks like the POS never called.
- **State:** OPEN · **Severity:** medium · **Size:** S · **Source:** register:2433.1
- **Do:** pos-hub.service.ts
- **Evidence:** pos-hub.service.ts:459-466 empty-checks branch still returns with no logger.warn call.

### `2433.2` — 243 rejections produced one success-shaped log line
- **Plain:** A wave of rejected POS webhooks still leaves almost no trace in the logs.
- **State:** OPEN · **Severity:** medium · **Size:** S · **Source:** register:2433.2
- **Do:** pos-hub.service.ts / controller.ts
- **Evidence:** pos-hub.controller.ts:102-112, pos-hub.service.ts:411 still no log naming the missing header on a signature rejection.

### `2478` — Procurement — split shipment dropped / contradicting reply vanishes (parent)
- **Plain:** One half is now mostly covered by a newer system; the other half is still open.
- **State:** PARTLY · **Severity:** medium · **Size:** M · **Source:** register:2478
- **Do:** n/a
- **Evidence:** See two sub-items.

### `2478.2` — syncOrderState drops a contradicting vendor reply to free text
- **Plain:** When a vendor's reply disagrees on price or quantity, the system still just quietly waits instead of recording why.
- **State:** OPEN · **Severity:** medium · **Size:** M · **Source:** register:2478.2
- **Do:** common/orchestrator/inbound-responder.service.ts
- **Evidence:** inbound-responder.service.ts:1183-1258 a mismatched vendor confirmation still just leaves the order APPROVED with no structured record; delivery_proposals is used by a different (delivery-verification) flow only.

### `2717` — POS→inventory→alerts lens, Sim Vanilla Kaleiçi — 10 findings (parent)
- **Plain:** About half of these ten are already fixed; the rest need work.
- **State:** PARTLY · **Severity:** medium · **Size:** M · **Source:** register:2717
- **Do:** n/a
- **Evidence:** See ten sub-rows; 1-4 duplicate the 'Antalya night' Fixed(#318) items verbatim.

### `2717.F7` — POS catalog defaults unsized buttons to 750ml
- **Plain:** Drinks with no stated size (cocktails, coffee) are still silently treated as full 750ml bottles.
- **State:** OPEN · **Severity:** medium · **Size:** S · **Source:** register:2717.F7
- **Do:** simpos.service.ts
- **Evidence:** simpos.service.ts:182,283 still `|| 750` / `?? 750`.

### `2717.F8` — pos_checks cannot express a currency
- **Plain:** A lira restaurant's sales still show up with a dollar sign everywhere.
- **State:** OPEN · **Severity:** medium · **Size:** M · **Source:** register:2717.F8
- **Do:** supabase/migrations + pos_checks readers
- **Evidence:** No 'alter table pos_checks add column currency' found in any migration; the currency columns added since are on unrelated tables.

### `library-identity-item3-check-constraint-missing` — CHECK preventing an unowned generic wine row was never added
- **Plain:** A database safety rule that would stop a repeat of this bug still isn't in place.
- **State:** OPEN · **Severity:** medium · **Size:** S · **Source:** register:library-identity-item3-check-constraint-missing
- **Do:** a small migration + wiring an owner on the submission-promotion path
- **Evidence:** grep for wine_identity_is_specific in supabase/migrations finds only the CHECK-less migration; wine-submissions.service.ts:187-220 still upserts with no venue owner

### `retire-doorreceipt-markdelivered` — Retire recordDoorReceipt/markDelivered once their 3 clients move
- **Plain:** Two old stock-writing shortcuts are still in use by three screens and haven't been retired yet, as planned.
- **State:** OPEN · **Severity:** medium · **Size:** M · **Source:** register:retire-doorreceipt-markdelivered
- **Do:** migrate the 3 remaining callers onto the one booking path, then delete both functions
- **Evidence:** Both functions still exist (receiving.service.ts:179, procurement.service.ts:4077) and are still called from doorOutbox.ts, useOrdersData.ts, OneTapPanel.tsx, and mobile supply/[id].tsx

### `atlas-backbone-F1` — Committed atlas-graph.json is stale by weeks, no guard catches drift
- **Plain:** The build-map file hasn't been regenerated in three weeks and is already off by a large margin, and nothing automatic notices when it drifts.
- **State:** OPEN · **Severity:** medium · **Size:** S · **Source:** finding:atlas-backbone-F1
- **Do:** regenerate atlas-graph.json and wire a CI staleness guard so it can't silently drift again
- **Evidence:** Regenerating scripts/generate_design_atlas.py against main (feat/p1-readout working tree) gives 507 endpoints/233 features vs the committed 468/186 (2026-09-16); against wt-review (main+PR#391) it's 689/581. Scripts diff byte-identical across trees, so this is real growth, not a measurement change.

### `dashboard-greeting-wrong-role-clock` — Dashboard greets an owner as 'Manager', on the viewer's own clock (stated twice)
- **Plain:** The dashboard still greets every owner as 'Manager' and uses the viewer's own phone clock instead of the restaurant's.
- **State:** OPEN · **Severity:** low · **Size:** S · **Source:** register:2825.A5+3007.9
- **Do:** apps/web/src/pages/Dashboard.tsx (DashboardNext.tsx already fixed the role half)
- **Evidence:** 2825.A5: Dashboard.tsx:405 still hardcodes '${greeting}, Manager'; greeting from local browser time. The rebuilt DashboardNext.tsx fixed the role half (uses first name) but still uses viewer's clock at line 80. | 3007.9: Same as 2825.A5 — third statement of the same fact in this register.

### `44.1e-collision-meta` — The register reuses id 44.1e for two unrelated defects
- **Plain:** The bug list itself mixed up two different problems under the same reference number — a small paperwork fix.
- **State:** OPEN · **Severity:** low · **Size:** S · **Source:** register:44.1e-collision-meta
- **Do:** renumber one of the two before any successor register is built
- **Evidence:** grep '^\*\*44\.1e' on the file returns two separate defects (InvoiceScannerModal, sommelier RLS) sharing one id.

### `44.1i` — Stale users-row fallback can admit a stale or legacy member
- **Plain:** A rare, currently-theoretical loophole about who counts as a house member is decided but not fully closed out.
- **State:** OPEN · **Severity:** low · **Size:** S · **Source:** register:44.1i
- **Do:** a follow-up PR that retires the fallback once the migration is confirmed live in production
- **Evidence:** Migration 20260918153000 exists and writes the one affected manager's real access row (founder's decided answer B), but the fallback code itself is still present by design until that migration is confirmed applied in production — which this read-only pass cannot confirm from code alone.

### `44.5` — Dead code and stale docs list (5 items) `[legacy]`
- **Plain:** Most of this old cleanup is already done; two small leftover files still just need deleting.
- **State:** PARTLY · **Severity:** low · **Size:** S · **Source:** register:44.5
- **Do:** delete the 2 remaining files (invoiceMatch.ts, REPORT.md)
- **Evidence:** 3 of 5 already deleted and confirmed gone (InvoiceScannerModal, Reports.v1.backup.tsx, apps/web/src/data/inventoryData.ts). 2 still exist, confirmed live: apps/mobile/src/lib/invoiceMatch.ts (still zero importers) and root REPORT.md (still the stale April 2026 crawl report, last touched 2026-04-13).

### `inventory-add-remove-item7` — Inventory add/remove build list — item 7 (removal hardening) still open
- **Plain:** Most of this inventory feature shipped; one safety task around removing items is still outstanding.
- **State:** PARTLY · **Severity:** low · **Size:** M · **Source:** register:inventory-add-remove-item7
- **Do:** item 7, removal hardening; separately decide on price-enrichment priority
- **Evidence:** INVENTORY_ADD_REMOVE_SCENARIOS.md itself (checked live) states "Items 1-6 of §5 are complete. Item 7 (removal hardening) is the only one still open." The Market Price column placeholder issue (retail_price_avg null on all rows) was not re-queried live this pass.

### `1642` — HoursHeatmap ramp inverts salience on dark ground
- **Plain:** On the dark theme, the busiest hours still show as the dimmest color instead of the brightest.
- **State:** OPEN · **Severity:** low · **Size:** S · **Source:** register:1642
- **Do:** inventory re-skin backlog
- **Evidence:** apps/web/src/pages/inventory/command/bits.tsx:112 — HEAT_SHADES still opens on #F1F7F8 (near-white for quiet hours), unchanged.

### `1653` — TwinSheet hosts a legacy-skinned intelligence panel `[legacy]`
- **Plain:** The provider detail panel still looks like the old design inside the new page.
- **State:** OPEN · **Severity:** low · **Size:** M · **Source:** register:1653
- **Do:** providers.md §9 backlog
- **Evidence:** apps/web/src/pages/providers/next/TwinSheet.tsx:33-35,155 still renders the shared legacy ProviderIntelligencePanel unchanged.

### `1682.4` — maxDrawdown identically zero by construction
- **Plain:** The 'biggest demand drop' risk number always reads zero and isn't shown to anyone yet.
- **State:** OPEN · **Severity:** low · **Size:** S · **Source:** register:1682.4
- **Do:** analytics backlog
- **Evidence:** analytics.service.ts:742-747 levels is still a cumulative non-negative sum; engine/risk.ts:149-173 unchanged. grep maxDrawdown apps/web apps/mobile → 0 hits.

### `2478.1` — markDelivered keys idempotency per ORDER not per delivery
- **Plain:** The real door flow no longer drops a second truck's delivery, but the old buggy shortcut is still there for other callers.
- **State:** PARTLY · **Severity:** low · **Size:** S · **Source:** register:2478.1
- **Do:** procurement.service.ts
- **Evidence:** procurement.service.ts:4349-4371 the new ADR 0103 delivery model checks deliveryHasBookedOrder first and yields to it; old order-keyed path is now a bounded fallback, per the code's own comment.

### `2499` — POS→inventory→alerts lens, Sim Meyhouse — 12 defects, 9 absence instances (parent)
- **Plain:** Nearly everything from this test run has already been fixed.
- **State:** PARTLY · **Severity:** low · **Size:** S · **Source:** register:2499
- **Do:** n/a
- **Evidence:** Mostly fixed; see sub-rows for the two residuals.

### `2717.F6` — sale_unit has no word for a carafe
- **Plain:** The system can now record a carafe internally, but the screen that asks staff to answer this still won't accept the word.
- **State:** PARTLY · **Severity:** low · **Size:** S · **Source:** register:2717.F6
- **Do:** dto/pos-mapping-review.dto.ts
- **Evidence:** pos-hub.service.ts:1098-1126 writer now accepts open labels including carafe, but dto/pos-mapping-review.dto.ts:29 SALE_UNITS=['glass','bottle'] with @IsIn still 400s the one validated review endpoint.

### `2717.F10` — Turkish venue name mangled in slug (ç dropped)
- **Plain:** Turkish characters in a venue name still get dropped from its internal URL slug; harmless today, per the doc's own note.
- **State:** OPEN · **Severity:** low · **Size:** S · **Source:** register:2717.F10
- **Do:** organizations.service.ts
- **Evidence:** organizations.service.ts:606-609 .replace(/[^a-z0-9]+/g,'-') still has no transliteration table.

### `2866` — Customer + intelligence lens, Sim Meyhouse — 5 defects (parent)
- **Plain:** Nearly all of this section is already fixed.
- **State:** PARTLY · **Severity:** low · **Size:** S · **Source:** register:2866
- **Do:** n/a
- **Evidence:** 4 of 5 fixed; one duplicate-elsewhere item still open, see sub-rows.

### `2866.D3` — Real unread high-priority notification folded away
- **Plain:** Mostly fixed, but the unread counter can still show one more than the visible alerts.
- **State:** PARTLY · **Severity:** low · **Size:** S · **Source:** register:2866.D3
- **Do:** Notifications.tsx / notification count logic
- **Evidence:** notificationStack.ts now keys by sorted wine set per the #313 closure. Doc's own note: the 'Unread 3' tile over 2 rows is still unresolved — third source never identified.

### `3144` — 'A temporary shape to delete' — PGRST204/42703 schema-lag retry `[legacy]`
- **Plain:** Some leftover 'just in case the database is behind' code should be deleted now — the database caught up two weeks ago.
- **State:** OPEN · **Severity:** low · **Size:** S · **Source:** register:3144
- **Do:** document-intake.service.ts / canonical-document.service.ts
- **Evidence:** document-intake.service.ts and canonical-document.service.ts still carry the full schemaLagNote/retry path. Migration 20260904120000 has been on main since 2026-09-04, two weeks before this review — the entry's own 'once merged, remove both' instruction was never carried out.

### `3165` — 'Extraction supplied from outside the gateway' — ANTHROPIC_API_KEY has no credit
- **Plain:** There's still a manual workaround for reading invoices because the AI billing account ran out of credit — delete it once that's paid.
- **State:** OPEN · **Severity:** low · **Size:** S · **Source:** register:3165
- **Do:** delete once ANTHROPIC_API_KEY is funded
- **Evidence:** document-intake.service.ts:1415 applyExternalExtraction and documents.controller.ts:1318-1321 — the door still exists. Whether the Anthropic account now has credit was not checked (no .env reads permitted; not a Supabase-queryable fact).

### `canonical-amount-due-tautology` — amount_due (BR-CO-16) is a tautology
- **Plain:** A totals check can never fail because it's built from its own answer; needs a real 'amount paid separately' field.
- **State:** OPEN · **Severity:** low · **Size:** S · **Source:** register:canonical-amount-due-tautology
- **Do:** v3.0-TECH-DEBT successor list or a small ADR
- **Evidence:** from-parsed-document.ts:747 amountDue still derives from parsed.total; paidAmount/roundingAmount still hardcoded

### `orders-wire-item4-createorderrequest-mismatch` — CreateOrderRequest/UpdateOrderRequest declare fields the create DTO doesn't have
- **Plain:** A leftover type mismatch on an unused code path — cheap to fix, low risk today.
- **State:** OPEN · **Severity:** low · **Size:** S · **Source:** register:orders-wire-item4-createorderrequest-mismatch
- **Do:** add a mapping-table row to check_web_reads_gateway_dto_keys.py
- **Evidence:** types.ts:390-403 still declares wineId/unitPrice; CreateOrderDto (procurement.dto.ts:82-94) has inventoryId, no unitPrice; guard's mapping table has no row for these request types

### `vendor-lens-memory-no-reconciler` — Shelf-link memory write can fail silently with no reconciler to replay it
- **Plain:** A rare edge case: if the memory write fails, the link still works but the system doesn't 'remember' it for next time. Not yet seen in practice.
- **State:** OPEN · **Severity:** low · **Size:** M · **Source:** register:vendor-lens-memory-no-reconciler
- **Do:** add a reconciler job, only if the failure is ever actually observed
- **Evidence:** line-mapping.service.ts exports no reconcile/replay function — only the mapping key and service class

### `slice4-uuid-guard-gap` — GET /documents/:id and POST :id/verify (and :id/match) still 500 on a malformed id
- **Plain:** A malformed link still crashes with a raw database error instead of a clean 'bad request' message on a couple of routes.
- **State:** OPEN · **Severity:** low · **Size:** S · **Source:** register:slice4-uuid-guard-gap
- **Do:** add the same requireUuid guard to these 2-3 routes
- **Evidence:** requireUuid calls in documents.controller.ts sit near other lines but not near @Get(':id') (:1249), @Post(':id/match') (:1355), or @Post(':id/verify') (:1984)

### `atlas-surfaces-F9` — 4 files carry an unresolved TODO / not-implemented marker
- **Plain:** A handful of backend files still have unfinished-work notes in them.
- **State:** OPEN · **Severity:** low · **Size:** S · **Source:** finding:F9
- **Do:** clean up the 2 false-positive TODOs (one-tap-actions.service.ts:64, weather-prefetch.service.ts:40); the 2 real ones (receiving.controller.ts:274, catalog-matcher.service.ts:189) are deliberate and already ADR-tracked
- **Evidence:** grep -rl 'TODO|not.?implemented' on apps/api-gateway/src: procurement/receiving.controller.ts, one-tap-actions/one-tap-actions.service.ts, pos-hub/catalog-matcher.service.ts, weather/weather-prefetch.service.ts. [VERIFIER CORRECTION: A plain rerun of the stated pattern — `grep -rlE 'TODO|not.?implemented' apps/api-gateway/src` — returns 11 files, not 4: the report's 4 (receiving.controller.ts, one-tap-actions.service.ts, catalog-matcher.service.ts, weather-prefetch.service.ts) plus one-tap-actio...

### `modules-F9` — Software note lists a page (/distributors) that no longer exists — it's now a redirect
- **Plain:** The product catalog still lists a page as if it exists, but visiting that link now just bounces you to a different page.
- **State:** OPEN · **Severity:** low · **Size:** S · **Source:** finding:modules-F9
- **Do:** update global-vendor-search.md to drop the /distributors page reference
- **Evidence:** apps/web/src/App.tsx:350-353: <Route path="/distributors" element={<Navigate to="/providers?tab=discover" replace />} />; .planning/08-softwares/global-vendor-search.md frontmatter still lists pages: [providers, distributors] and routes including "/distributors" as if it renders a page.

### `modules-missed-M3` — The report undercounts open ownership gaps: it cites 6, the register lists 8
- **Plain:** The audit says 6 product areas have no clear owner, but the actual list in the catalog has 8.
- **State:** OPEN · **Severity:** low · **Size:** S · **Source:** finding:modules-missed-M3
- **Do:** correct the 6→8 ownership-gap count in modules.md
- **Evidence:** grep -c 'unowned — gap' .planning/08-softwares/SOFTWARE-MAP.md = 8 rows (Dashboard Home, Promotions, Vendor Portal, Wine Library & Sommelier, Wine Studio, Reports & Analytics, App Shell & Support, Mudavym MCP Server); modules.md's 'not_checked' section and the JSON summary's not_checked list both say '6 open ownership gaps' and name only the first six, silently dropping App Shell & Support and Mudavym MCP Server (the latter is F1's own subject) from the count.

### `models-missed-M2` — ux-optimizer.service.ts still hardcodes the dated model pin the founder decided against on 2026-09-04
- **Plain:** One AI feature still points at an old, dated version tag for the Claude model even though the founder already decided the whole app should use the current, undated name, and this was missed.
- **State:** OPEN · **Severity:** low · **Size:** S · **Source:** finding:models-missed-M2
- **Do:** apps/api-gateway/src/ux-optimizer/ux-optimizer.service.ts:272 — drop the claude-haiku-4-5-20251001 fallback to match the 2026-09-04 model-pin decision
- **Evidence:** apps/api-gateway/src/common/model-client/model-routing.ts:115-128 docstring: founder decided 2026-09-04 to standardize on the undated `claude-haiku-4-5`, naming `GOAL_CUTTING_MODEL` as the site that used to default to the dated pin `claude-haiku-4-5-20251001` and was fixed (goals.service.ts and ask-ai.service.ts no longer contain that literal string). But apps/api-gateway/src/ux-optimizer/ux-optimizer.service.ts:272 still has `this.configService.get<string>("UX_OPTIMIZER_MODEL") || "claude-haiku...

## Fix - quality and tests (9)

### `no-eval-harness-9-llm-call-sites` — None of the 9 production LLM call sites have an eval/golden-set harness (review found only 5 of the 9)
- **Plain:** None of our AI features — including 4 the first pass of this review missed (UX suggestions, vendor-page scraping, Ask-AI chat, goal-cutting) — have an automated way to check the AI's answers are actually correct.
- **State:** OPEN · **Severity:** medium · **Size:** L · **Source:** finding:models-F8+finding:models-missed-M1
- **Do:** build a shared eval/golden-set harness pattern, then apply it to all 9 call sites
- **Evidence:** finding:models-F8: Searched for eval/golden/golden_set near model-client.service.ts, document-extractor.service.ts, photo-count.service.ts, scan-parser.service.ts, consultants.service.ts, inbound-responder.service.ts — none found; correctness is asserted only via unit specs with mocked LLM responses. [VERIFIER CORRECTION: The claim itself (no eval/golden harness for the named 5 call sites) holds on re-check. But it undercounts scope: grep -rl "modelClient.call" apps/api-gateway/src (excluding sp...

### `1672` — Tests — editLine / targeted-notification opts have no service-level specs
- **Plain:** Some risky document-editing and notification code paths still have no automated tests.
- **State:** OPEN · **Severity:** medium · **Size:** M · **Source:** register:1672
- **Do:** test backlog
- **Evidence:** edit-line-tieout.spec.ts only covers the pure applyTieOut cast (3 tests); low-stock-alerts.service.spec.ts mocks the caller, not a service-level onlyUserIds test.

### `orders-wire-item5-menu-import-unclassified` — Every menu_import wine row is unclassified; guard not wired into CI
- **Plain:** 78 wines still have no type on them because the bulk-import path never asks the classifier — confirmed still true today by a live database check.
- **State:** OPEN · **Severity:** medium · **Size:** M · **Source:** register:orders-wire-item5-menu-import-unclassified
- **Do:** fix the bulk-add writer to call the classifier
- **Evidence:** Live production query 2026-09-18: SELECT classification_status, count(*) FROM master_wine_library WHERE source='menu_import' GROUP BY 1 -> {unclassified: 78}, identical to the entry's own count

### `2433.4` — Green adapter test is not vendor evidence
- **Plain:** The Square/Clover POS test fixtures still aren't proven against a real vendor payload.
- **State:** OPEN · **Severity:** low · **Size:** M · **Source:** register:2433.4
- **Do:** pos-adapters.spec.ts
- **Evidence:** pos-adapters.spec.ts has no 'captured'/'spec-cited' fixture citations.

### `canonical-slice3-stop1-finding1-mock-drift` — Shared currentTable in two spec harnesses can answer the wrong table under Promise.all
- **Plain:** Two test files could silently pass for the wrong reason — a known fix pattern exists, just not applied here yet.
- **State:** OPEN · **Severity:** low · **Size:** S · **Source:** register:canonical-slice3-stop1-finding1-mock-drift
- **Do:** apply the makeChain(table) pattern to the two older spec files
- **Evidence:** canonical-document.service.spec.ts:106 and price-base-round-trip.spec.ts:39,248 still declare one shared currentTable; only the newer document-correction.service.spec.ts uses the safe makeChain(table) pattern

### `canonical-slice3-stop2-d9-deputy-not-wired` — D9's 80% escalation reads the deputy but doesn't specifically address them
- **Plain:** At the final warning stage, the deputy manager gets the alert only because everyone does, not because they were specifically named.
- **State:** OPEN · **Severity:** low · **Size:** S · **Source:** register:canonical-slice3-stop2-d9-deputy-not-wired
- **Do:** target the deputy explicitly at the 80% rung
- **Evidence:** delivery-clock.service.ts:500-506 restricts to the owner only at 50%; at 80% it just broadcasts rather than targeting owners.deputy specifically

### `arm-b-grant-option-credit-bug` — A security guard script wrongly credits a partial revoke as a full one
- **Plain:** A safety-check script has a blind spot, but nothing has actually walked into it yet — worth a quick mechanical fix.
- **State:** OPEN · **Severity:** low · **Size:** S · **Source:** register:arm-b-grant-option-credit-bug
- **Do:** fix the guard's regex + add a self-test, same as the sibling fix already done
- **Evidence:** Confirmed by the entry's own reproduction; grep for the vulnerable SQL pattern across all migrations finds zero uses today, so nothing on main is actually affected yet

### `atlas-backbone-F8` — Correctness-sensitive gateway folders under 40% statement coverage
- **Plain:** A handful of folders — repeat-order handling, background job dedup, and the bridge to the AI agents — are lightly tested, which is where the next regression is most likely to hide.
- **State:** OPEN · **Severity:** low · **Size:** M · **Source:** finding:atlas-backbone-F8
- **Do:** raise test coverage on src/common/idempotency, src/common/orchestrator, src/conversations, src/database
- **Evidence:** heavy.sh npx jest --coverage on apps/api-gateway (atlas-b/jest-coverage.log): src/common/idempotency 34.21%/18.51% branch, src/common/orchestrator 44.72%/34.49% branch, src/conversations 23.54%/8.67% branch, src/database 37.25%. Overall suite: 432/434 suites, 6677/6691 tests passed, 0 failing.

### `atlas-backbone-missed-M2` — apps/mobile fails `tsc --noEmit` today — 482 errors, all confined to 11 *.test.ts files, from a missing @types/jest
- **Plain:** The mobile app's own type-checker fails right now because a testing library it depends on isn't actually installed, even though the project's config says it should be — this only affects test files, not the app users run.
- **State:** OPEN · **Severity:** low · **Size:** S · **Source:** finding:atlas-backbone-missed-M2
- **Do:** see evidence for the file to fix
- **Evidence:** cd apps/mobile && heavy.sh npx tsc --noEmit → exit 2, 482 'error TS...' lines, all in 11 files under __tests__/ (e.g. src/lib/__tests__/socketEvents.test.ts: 'Cannot find name expect/describe/it'). apps/mobile/package.json:53 declares "@types/jest": "^29.5.11" as a devDependency, but `ls node_modules/@types/jest` (both in wt-review's linked node_modules and in the main restaurant-ai-automation checkout it symlinks to) returns 'No such file or directory' — `npm ls @types/jest` in the main checkou...

## Decide (43)

### `procurement-pipeline-dark-lifetime-2-orders` — Procurement/spend pipeline has processed only 2 orders in its entire lifetime and has been dark 25-33 days
- **Plain:** The automated ordering and spend-tracking side of the system isn't just quiet lately — across its entire existence it has only ever completed two real purchase orders, while the rest of the app is actively used today.
- **State:** OPEN · **Severity:** critical · **Size:** M · **Source:** finding:atlas-backbone-F5+finding:atlas-backbone-missed-M1
- **Do:** founder call: is this a deliberate pause (no real restaurant ordering through it yet) or a broken write path — the app and DB are otherwise live (notifications: 76 rows in 7 days)
- **Evidence:** finding:atlas-backbone-F5: Supabase (exzueerziesmczwlhomd) SELECT: api_spend max(timestamp)=2026-08-24, 0 rows in last 7 days; procurement_conversations and procurement_orders max(created_at)=2026-08-16, 0 rows in last 7 days; control table notifications has 76 rows in the last 7 days and a row from today, proving the app and DB are live. | finding:atlas-backbone-missed-M1: Supabase SELECT (exzueerziesmczwlhomd, this session): select count(*) from procurement_orders → 2 (first 2026-07-16, last 2...

### `models-F1` — agent_activity_logs is empty at all time — no evidence the 25 agents run in production
- **Plain:** The table built to record every AI agent's work has zero rows ever, so we cannot prove the 25 agents actually run against the live database.
- **State:** OPEN · **Severity:** critical · **Size:** M · **Source:** finding:models-F1
- **Do:** founder call — see evidence
- **Evidence:** select count(*) from agent_activity_logs -> 0 rows, all time (Supabase exzueerziesmczwlhomd, run 2026-09-18). Table columns include agent_name, status, llm_model, tokens_used, llm_cost_usd, duration_ms — purpose-built for exactly this and never written.

### `twilio-stripe-unconfigured-plus-8-inboxes` — Twilio/Stripe fully built but unconfigured for the real tenant; 8 restaurants (not 1) got bulk-provisioned inbound email addresses
- **Plain:** Texting and card payments are ready in the code but never turned on for the one restaurant using the product; separately, a batch of 8 restaurant inboxes was set up in one go back in July, worth checking whether the other 7 are meant to exist.
- **State:** OPEN · **Severity:** high · **Size:** S · **Source:** finding:atlas-backbone-F6+finding:atlas-backbone-missed-M3
- **Do:** founder call on Twilio/Stripe go-live timing, and whether to clean up or explain the 7 extra inbound addresses
- **Evidence:** finding:atlas-backbone-F6: Supabase SELECT: house_text_senders=0 rows, house_text_sender_credentials=0 rows, payment_methods=0 rows, integration_oauth_connections=0 rows; code has a well-documented Twilio adapter (apps/api-gateway/src/communications/text/providers/twilio.adapter.ts) and a payment-methods module, both wired into app.module.ts but with nothing configured downstream. [VERIFIER CORRECTION: Twilio/Stripe/OAuth zero-row claims all reproduced exactly (house_text_senders=0, house_text_s...

### `2159` — quantity_received has two units, verifyReceipt assumes one
- **Plain:** A real column can be misread by 12x on the first real door-to-desk delivery, and only you can pick the fix.
- **State:** OPEN · **Severity:** high · **Size:** M · **Source:** register:2159
- **Do:** OPEN-DECISIONS.md (new OD) + ADR 0070/0119
- **Evidence:** procurement.service.ts:4917-5222 same four-writer/two-unit shape present. ADR 0119 explicitly says this entry still stands. No OD row filed in OPEN-DECISIONS.md.

### `orders-wire-item3b-recurring-auto-approve-no-seal` — recurring_orders auto_approve spends money with no seal
- **Plain:** An automatic reorder can still commit spend without anyone actually approving it — needs your call on which of two fixes to take.
- **State:** OPEN · **Severity:** high · **Size:** M · **Source:** register:orders-wire-item3b-recurring-auto-approve-no-seal
- **Do:** OPEN-DECISIONS.md — two non-equivalent fixes named, one retires a shipped column
- **Evidence:** recurring-orders.service.ts:887-888 still calls approveOrder(...) with no challenge argument when auto_approve is true

### `atlas-surfaces-F3` — Only 1 of 14 production restaurants has any Mudavym design flag row
- **Plain:** Only one restaurant account is actually seeing the new design anywhere — the other 13 see 100% of the old app.
- **State:** OPEN · **Severity:** high · **Size:** S · **Source:** finding:F3
- **Do:** founder call on rollout pace for the other 13 restaurants
- **Evidence:** Supabase (exzueerziesmczwlhomd) restaurant_feature_flags: count(*)=1 row against 14 rows in restaurants. Registry fail-safe means no row = all pages legacy for those 13.

### `modules-F1` — Roster says mudavym-mcp is "planned, not built" — it's built, tested, and ADR-verified
- **Plain:** The AI-assistant connector is fully coded and tested but the master software list still says it doesn't exist yet — and no restaurant has ever turned it on.
- **State:** OPEN · **Severity:** high · **Size:** S · **Source:** finding:modules-F1
- **Do:** founder call — see evidence
- **Evidence:** apps/api-gateway/src/mcp-server (2279 LOC/5 endpoints/3 specs), mcp-runtime (1844 LOC/5 specs), mcp-connections (2578 LOC/13 endpoints/6 specs); 5 CLAIMS.jsonl rows for ADR-0132 status:resolved verified 2026-09-06; mudavym-mcp.md frontmatter already says status: partial (updated 2026-09-06) but SOFTWARE-MAP.md roster (updated 2026-09-03) still shows planned/"documented, not built"; production: mcp_server_credentials, mcp_server_call_log, restaurant_mcp_connections, mcp_tool_calls, mcp_connection...

### `modules-F2` — A whole live product — Cellar (beer/whiskey/cocktails/spirits/non-alcoholic/soft-drinks) — has no software note
- **Plain:** There's a working, deployed feature for tracking drinks other than wine that isn't listed anywhere in the product catalog.
- **State:** OPEN · **Severity:** high · **Size:** M · **Source:** finding:modules-F2
- **Do:** founder call — see evidence
- **Evidence:** apps/web/src/App.tsx:328-333 wires 6 live routes (/beer /whiskey /cocktails /spirits /non-alcoholic /soft-drinks) to CellarNext; backing gateway modules beverages (2337 LOC/9 endpoints) and cellar (1624 LOC/4 endpoints) exist; grep of .planning/08-softwares/*.md shows no note references these routes or modules (wine-library-sommelier.md only claims /wines,/sommelier).

### `modules-missed-M1` — A 108,000-line Python agent service (CLAUDE.md's own orientation entry) is entirely absent from a 'software modules' audit
- **Plain:** There's a whole second codebase of AI agent logic — bigger than the entire web gateway — that this review never looked at.
- **State:** OPEN · **Severity:** high · **Size:** M · **Source:** finding:modules-missed-M1
- **Do:** give services/agent-orchestrator a module/coverage pass in the next audit
- **Evidence:** find services/agent-orchestrator -name '*.py' | xargs wc -l = 107,963 total lines; services/agent-orchestrator/core/base_agent.py = 1058 lines; 116 files match test_*.py under services/agent-orchestrator/tests; CLAUDE.md §1 lists `services/agent-orchestrator` as a top-level orientation entry alongside apps/api-gateway. modules.md's 'what this pass could not check' section never names agent-orchestrator, only 'web/mobile Jest coverage' — the whole directory is missing from both the 26-software ca...

### `models-F4` — Wine enrichment pipeline is broken — no real restaurant has an enriched wine, and embeddings are computed but never read
- **Plain:** The wine library looks rich on paper, but no real restaurant's actual wines have flavor profiles, and the AI embeddings we compute for wine matching are never used anywhere.
- **State:** OPEN · **Severity:** high · **Size:** L · **Source:** finding:models-F4
- **Do:** founder call — see evidence
- **Evidence:** Cited from .planning/07-reference/wine-intelligence-foundations.md (docs/wine-ml-foundations branch, dated 2026-09-18, measured against production exzueerziesmczwlhomd): 173 stocked wines total, 0 belong to a real restaurant; only 13 of 173 have a structure profile and 7 of those 13 are a copied placeholder template; embedding vector(384) populated on 3,430 rows but 'nothing reads it'; doc's own verdict: 'Broken. No running process enriches a library row after the row is created.'

### `postgis-definer-functions-informal` — 3 PostGIS SECURITY DEFINER functions are anon/authenticated-executable, accepted informally with no ADR/OD row
- **Plain:** Three built-in map-related database functions are more open than intended; this needs your call on whether to formally accept that or lock them down further.
- **State:** OPEN · **Severity:** medium · **Size:** S · **Source:** register:postgis-security-definer-undocumented
- **Do:** OPEN-DECISIONS.md / an amendment to ADR 0159
- **Evidence:** register:postgis-security-definer-undocumented: ADR 0159 already names this under its Consequences section, but no formal ADR/OD row records the acceptance itself (only a migration comment), and that comment under-states scope (names anon only, not authenticated/PUBLIC too)

### `sommelier-history-broken-by-od72` — Saved sommelier conversations can never load or save, because of OD-72's RLS policy (deferred-per-tenant-rls escalated)
- **Plain:** Saved wine-chat history silently fails to load or save for every user. This was filed as a low-urgency future decision (OD-72), but it is now the actual cause of a real broken feature, so it needs a fresh look rather than staying deferred.
- **State:** OPEN · **Severity:** medium · **Size:** M · **Source:** register:44.1e-sommelier+deferred-per-tenant-rls
- **Do:** OPEN-DECISIONS.md OD-72 — re-weigh now that a live feature is broken, not just a theoretical gap; code fix is routing sommelier reads/writes through the api-gateway the way ADR 0012 did for reports
- **Evidence:** 44.1e-sommelier: useSommelierQueries.ts (checked live) still queries sommelier_conversations directly with the anon Supabase client. OD-72's 2026-08-26 RLS fix explicitly excepts this exact table ("the single live browser consumer"), so its auth.uid()-based policy stays permanently unsatisfiable — confirmed by reading OPEN-DECISIONS.md's OD-72 row. | deferred-per-tenant-rls: OD-72 (closed 2026-08-26, corrected 2026-09-17, checked live in OPEN-DECISIONS.md) shows 52 of 73 policies still anchor on...

### `44.1f` — Adding a location locked the owner out (+ unresolved switchRestaurant disagreement)
- **Plain:** The original lockout is fixed, but the platform still has two different, disagreeing answers to "is this person a member of this location" — that needs your call.
- **State:** PARTLY · **Severity:** medium · **Size:** M · **Source:** register:44.1f
- **Do:** OPEN-DECISIONS.md / ADR 0162 family
- **Evidence:** Primary lockout bug: doc cites a fix verified 2026-09-03 (47f971de) with a passing spec, not independently re-run this pass. Second finding — switchRestaurant's organisation-level fallback disagreeing with the row-level membership check used everywhere else — confirmed still present in auth.service.ts while checking a neighboring entry (44.1i).

### `adr0141-fk-no-tenant-tie` — Order/document/POS-mapping foreign keys don't tie the referenced item's tenant to the referencing row
- **Plain:** The database still allows linking a record to another restaurant's item by mistake at the schema level; nobody has decided how to close that.
- **State:** OPEN · **Severity:** medium · **Size:** L · **Source:** register:adr0141-fk-no-tenant-tie
- **Do:** OPEN-DECISIONS.md — needs a decision on a composite-key or trigger approach
- **Evidence:** No CLAIMS or ADR row found covering this specific composite-key/trigger question

### `security-definer-trigger-aggregate-bypass` — A closed-off privileged database function can still run for a client via a trigger or aggregate
- **Plain:** There's a theoretical back door in how we check for risky database functions; it's not open today, but closing the checker itself needs your sign-off since it would flag some existing functions as risky.
- **State:** OPEN · **Severity:** medium · **Size:** M · **Source:** register:security-definer-trigger-aggregate-bypass
- **Do:** OPEN-DECISIONS.md / an amendment to ADR 0159
- **Evidence:** Confirmed not currently reachable (no client role has insert/update/delete on the 3 trigger-owning tables; no aggregates exist in the database at all), but the security-check script's blind spot is real and named explicitly as a founder decision

### `atlas-surfaces-F2` — Regenerated atlas's '39 orphan pages' are a tooling artifact, not dead pages
- **Plain:** The report of 39 unreachable pages is wrong — it's the same blind spot as F1, most of those are the app's normal sidebar pages.
- **State:** OPEN · **Severity:** medium · **Size:** S · **Source:** finding:F2
- **Do:** no action — re-read as 'reachable via sidebar', drop from any orphan-page list
- **Evidence:** review-0919/out/PAGE_MAP.md 'Entry points' list includes /orders, /providers, /receiving, /reports, /team, /wines, /communications, /notifications — all reachable from HouseHeader's sidebar nav, which the script never scans because it can't resolve PageGate routes to files.

### `atlas-surfaces-F4` — 9 of 20 flagged pages are still off even on the one enabled restaurant
- **Plain:** Even the one house that has the new design turned on doesn't have it everywhere yet — 9 pages are still the old design there.
- **State:** OPEN · **Severity:** medium · **Size:** S · **Source:** finding:F4
- **Do:** no action needed now — the flags are working as configured; revisit alongside F3
- **Evidence:** Same query: mudavym_design_{reports,notifications,recommendations,calendar,settings,profile,cellar,connections,logs} = 0 (off); {dashboard,orders,receiving,receiving_door,providers,communications,team,inventory,receipts,documents_reports,document} = 1 (on). Cross-checked against lane-status-2026-09-18.md showing settings/cellar/recommendations still ready=False on feature branches.

### `atlas-surfaces-F6` — Endpoint surface grew ~47% (468→689) since the last published atlas with no re-audit of stub vs real data
- **Plain:** The app grew a lot of new backend endpoints in the last few weeks, and nobody has re-checked which of them actually return real data versus placeholders.
- **State:** OPEN · **Severity:** medium · **Size:** M · **Source:** finding:F6
- **Do:** founder call on whether the endpoint growth needs a fresh stub-vs-real audit before the next milestone
- **Evidence:** Published Mudavym Atlas artifact / atlas-graph.json (dated 2026-08-24, same controller-scan logic per generate_design_atlas.py's own comment): 468 endpoints. Fresh regeneration today on wt-review HEAD: 689 endpoints (681 unique method+path) across 76 controller files.

### `atlas-surfaces-F8` — Neither atlas script nor this review's test budget covers the mobile app
- **Plain:** The mobile app (26 screens) isn't tracked by either mapping tool and its tests weren't run in this review.
- **State:** OPEN · **Severity:** medium · **Size:** L · **Source:** finding:F8
- **Do:** add mobile routes to the atlas script; run apps/mobile's test suite in a future review
- **Evidence:** generate_system_atlas.py only scans apps/mobile for hosts/SDKs/env vars, never routes; 26 screen files found by hand under apps/mobile/app/. Mobile vitest/jest was not run (out of this pass's explicit web-vitest scope). [VERIFIER CORRECTION: The '26 screens' figure doesn't reproduce exactly: `find apps/mobile/app -type f \( -iname '*.tsx' -o -iname '*.ts' \)` excluding *.test.* returns 27 files total, or 23 if the 4 route-wrapper _layout.tsx files are excluded as not being distinct 'screens' — n...

### `atlas-backbone-F4` — Retroactive-order endpoint fixed but never wired to any UI action
- **Plain:** The app tells a manager they can 'create a retroactive order' but tapping through doesn't call the (now-fixed) endpoint that would do it.
- **State:** OPEN · **Severity:** medium · **Size:** M · **Source:** finding:atlas-backbone-F4
- **Do:** wire the notifications 'create a retroactive order' copy to an actual call, or remove the copy
- **Evidence:** apps/api-gateway/src/providers/retroactive-order.spec.ts documents a fixed production defect for POST /providers/:id/retroactive-order (verified 2026-09-01); static grep across apps/web/src, apps/mobile, services finds zero callers of this path; apps/web/src/pages/Notifications.tsx:607 only has descriptive copy mentioning 'create a retroactive order', not a call site.

### `atlas-backbone-F7` — ~28 authenticated gateway endpoints have no static caller in web/mobile/services
- **Plain:** About 28 backend actions out of 689 have no button or screen anywhere that calls them.
- **State:** OPEN · **Severity:** medium · **Size:** M · **Source:** finding:atlas-backbone-F7
- **Do:** founder call on which of the 30 uncalled endpoints are dead vs. planned
- **Evidence:** atlas-b/caller_check.py: 30/689 endpoints have zero static path-segment references in apps/web/src, apps/mobile, services/**/*.py; 3 of those 30 had exactly one hit that turned out to be a false positive (own spec file or unrelated string) on manual check. Full list in atlas-b/no_caller_report.txt (e.g. identity-curation/*, price-index/uploads/*, mcp-server-keys/*, analytics/hot-tables).

### `modules-F3` — Team Command is marked status: live but its entire scheduling subsystem has zero production data
- **Plain:** The team page is marked as fully working, but shift scheduling, time-off requests, and certifications have never actually been used.
- **State:** OPEN · **Severity:** medium · **Size:** S · **Source:** finding:modules-F3
- **Do:** founder call on whether scheduling is launch-ready messaging, or should read partial
- **Evidence:** .planning/08-softwares/team-command.md frontmatter status: live; team module 4227 LOC/35 endpoints/6 specs (67.4% stmt/51.1% branch, heavy.sh jest run 2026-09-18); production row counts (Supabase, project exzueerziesmczwlhomd): team_certifications=0, schedules=0, shifts=0, shift_breaks=0, time_off_requests=0, swap_requests=0, coverage_templates=0, team_availability=0; only team_members=11 and users=8 are populated.

### `modules-F4` — Message-credit/plan-metering tables are fully built and completely empty in production
- **Plain:** The messaging plan and credit system exists in the database but has never recorded a single real transaction.
- **State:** OPEN · **Severity:** medium · **Size:** S · **Source:** finding:modules-F4
- **Do:** note the credit-metering layer specifically as hollow in communications-hub.md
- **Evidence:** Production row counts: house_message_meter=0, house_message_credits=0, house_message_allowances=0, plan_message_allowances=0, house_text_sender_credentials=0, house_message_purchase_intents=0 (Supabase, project exzueerziesmczwlhomd, 2026-09-18); communications module itself is 24,846 LOC/47 endpoints/13 crons/37 specs and communications-hub.md is correctly marked status: hollow, but does not call out the credit-metering layer specifically.

### `modules-F5` — Daily promotions cron writes to a table that currently holds zero rows, contradicting the catalog's own claim
- **Plain:** A scheduled job that's supposed to save vendor promotions every morning appears not to be producing any saved promotions right now.
- **State:** OPEN · **Severity:** medium · **Size:** S · **Source:** finding:modules-F5
- **Do:** check why promotion-extractor.service.ts's cron and inbound-match path aren't writing provider_promotions
- **Evidence:** apps/api-gateway/src/common/orchestrator/promotion-extractor.service.ts runs @Cron(CronExpression.EVERY_DAY_AT_9AM); SOFTWARE-MAP.md finding #4 states provider_promotions "is written on every provider-matched inbound plus a 09:00 cron"; measured production row count via Supabase (project exzueerziesmczwlhomd, 2026-09-18): provider_promotions=0, vendor_promotions=0, promotion_audit=3.

### `modules-F6` — Recommendations are shown but never acted on — one_tap_actions table is empty despite 75 recorded impressions
- **Plain:** The system shows suggestions to the restaurant but nobody has ever tapped one, even though the feature to act on them is built.
- **State:** OPEN · **Severity:** medium · **Size:** S · **Source:** finding:modules-F6
- **Do:** founder call on why recommendations aren't converting to taps — UX or trust issue
- **Evidence:** Production row counts (Supabase, project exzueerziesmczwlhomd): recommendation_impressions=75, recommendation_actions=0, one_tap_actions=0; backing module one-tap-actions is 1633 LOC/9 endpoints/3 specs, 68.3% stmt coverage (heavy.sh jest run 2026-09-18); recommendations.md frontmatter status: partial.

### `models-F3` — Insight catalogue: 573 candidate types, 24 implemented (4.2%), only 5 seen live in 30 days
- **Plain:** The insight engine could theoretically produce 573 kinds of finding, but only 24 are actually coded, and in the last month only 5 of those 24 ever fired for a real account.
- **State:** OPEN · **Severity:** medium · **Size:** S · **Source:** finding:models-F3
- **Do:** no action — insight coverage is intentionally staged; revisit if the 24→573 gap should be prioritized
- **Evidence:** insight-catalog.ts INSIGHT_CANDIDATES.length = 573 (confirmed by the file's own gate test insight-catalog.reach.spec.ts BASELINE.total=573). insight-implementations.ts IMPLEMENTED_INSIGHT_TYPES array counted directly = 24. select candidate_key, count(*) from analytics_insights where computed_at > now()-interval '30 days' group by 1 -> 5 distinct keys, 11 rows, 4 restaurants.

### `models-F5` — self-evolution service appears fully inert — learning loop disabled, output table empty, not wired into any other service `[legacy]`
- **Plain:** The service meant to let our AI learn from its own mistakes has never actually recorded a learning event, and nothing else in the codebase calls it.
- **State:** OPEN · **Severity:** medium · **Size:** M · **Source:** finding:models-F5
- **Do:** founder call: fund/build the self-evolution loop, or retire the service
- **Evidence:** services/self-evolution/main.py:1-13 docstring: learning engine, A/B testing, and meta-agent are 'Disabled by default'. select count(*) from agent_evolution_log -> 0 rows, ever. grep -rl 'self.evolution|self_evolution' across repo returns nothing outside services/self-evolution/ itself.

### `44.2b` — ReportingAgent doesn't subscribe to the topic the roadmap claims
- **Plain:** A small mismatch between what an old roadmap claims and what the code actually does; just needs a decision on which one is right.
- **State:** OPEN · **Severity:** low · **Size:** S · **Source:** register:44.2b
- **Do:** either wire the subscription, or correct the ROADMAP criterion — the entry itself asks for one or the other
- **Evidence:** reporting_agent.py's get_subscribed_routing_keys still only lists reporting.events, not stock.events, confirmed live.

### `gitignore-duplicate-files` — '.gitignore' hides macOS " 2" duplicate files from every git status sweep
- **Plain:** The specific stray files are cleaned up, but the tool that let them hide from every check still only watches two file types — you get to pick how to close that gap.
- **State:** PARTLY · **Severity:** low · **Size:** S · **Source:** register:gitignore-duplicate-files
- **Do:** OPEN-DECISIONS.md — widen the ignore globs (keeps hiding future ones) vs. drop the rule entirely (lets git status catch them), the same two options the entry already names
- **Evidence:** A live filesystem sweep for stray " 2.*" files (excluding node_modules/.git/venv/__pycache__) found zero today, confirming the two named Python strays are still gone. The .gitignore rule itself is unchanged — still only ignores "* 2.py" and "* 2.md", confirmed live — so a " 2.ts"/".tsx"/".json"/".sql" duplicate would still slip in unflagged today.

### `google-signin-open-question` — Whether gated Google self-signup should exist at all
- **Plain:** A product question about whether to ever allow Google sign-up again in some limited form — still needs your answer, if it matters to you at all.
- **State:** OPEN · **Severity:** low · **Size:** - · **Source:** register:google-signin-open-question
- **Do:** OPEN-DECISIONS.md
- **Evidence:** Explicitly named by the entry itself as a product decision, not a repair; today's answer is "no self-signup." Not something code can resolve.

### `1602` — Formatting — apps/web outside Prettier
- **Plain:** The web app's code was never auto-formatted; we chose to wait, and still need to pick how to finally fix it.
- **State:** DECIDED · **Severity:** low · **Size:** L · **Source:** register:1602
- **Do:** OPEN-DECISIONS.md
- **Evidence:** .eslintrc.cjs:37-40 apps/web override still lacks prettier extends/plugin; no format script in apps/web/package.json. Deferral (2026-08-24) holds; two remediation paths still unpicked, not filed in OPEN-DECISIONS.md.

### `2335` — 2026-09-12 addendum — waves D/E/G retired (ADR 0137) `[legacy]`
- **Plain:** The dead test files are already deleted; the decision just needs your formal sign-off to close the loop.
- **State:** PARTLY · **Severity:** low · **Size:** S · **Source:** register:2335
- **Do:** decisions/0137-legacy-e2e-waves-d-e-g-are-retired-not-repointed.md
- **Evidence:** Wave files confirmed deleted (only A/B/C remain); secrets removed from workflow. But decisions/0137-*.md:3 still reads Status: Proposed, and README.md:150 says 'founder review pending.'

### `3007.5` — 251 of 328 country='Unknown' rows still not backfilled
- **Plain:** 251 old wine records still say 'Unknown' country and nobody can prove where that came from — you need to decide what evidence would justify fixing them.
- **State:** OPEN · **Severity:** low · **Size:** M · **Source:** register:3007.5
- **Do:** a new library-repair ADR
- **Evidence:** datasets/library/REPAIR-2026-09-05.md confirms 77 of 328 repaired; no later repair doc found for the remaining 251 menu_corpus rows; doc itself says this needs a founder call on evidence standard.

### `atlas-surfaces-F5` — /inventory's PageGate passes the same component for legacy and next
- **Plain:** One page's 'old vs new' switch is wired to show the identical screen either way, so the switch does nothing there.
- **State:** OPEN · **Severity:** low · **Size:** S · **Source:** finding:F5
- **Do:** apps/web/src/App.tsx:312 — give /inventory real legacy and next components, or drop the gate
- **Evidence:** apps/web/src/App.tsx:312: <PageGate page="inventory" legacy={<InventoryCommandPage/>} next={<InventoryCommandPage/>} />.

### `atlas-surfaces-F7` — studio and simpos page areas have zero test files
- **Plain:** Two whole sections of the app (an internal tooling page and the simulated-POS page) have no automated tests at all.
- **State:** OPEN · **Severity:** low · **Size:** M · **Source:** finding:F7
- **Do:** add test files for apps/web/src/pages/studio and apps/web/src/pages/simpos
- **Evidence:** find apps/web/src/pages/studio -iname '*.test.tsx' -> 0 (17 non-test source files); apps/web/src/pages/simpos -> 0 test files (3 source files).

### `atlas-surfaces-missed-M2` — TypeScript compile health for apps/web was never checked — only vitest was run
- **Plain:** Nobody checked if the app's code actually compiles without errors; it turns out it does, but that check was simply skipped in the review.
- **State:** OPEN · **Severity:** low · **Size:** S · **Source:** finding:atlas-surfaces-missed-M2
- **Do:** no action — keep tsc --noEmit in the review's own checked-list going forward
- **Evidence:** Ran `npx tsc --noEmit` in wt-review/apps/web via heavy.sh (the required heavy-command wrapper): exit code 0, zero output — a clean compile on today's HEAD. Not a defect, but a real method gap: the report's own §0 lists vitest as the only thing run against wt-review's web app, with typecheck/lint absent from both what was run and what was listed as not_checked.

### `atlas-backbone-F9` — services/self-evolution has no deployment path at all
- **Plain:** A 561-line 'self-improving AI' service exists in the code but was never given a way to actually run anywhere.
- **State:** OPEN · **Severity:** low · **Size:** S · **Source:** finding:atlas-backbone-F9
- **Do:** founder call: give services/self-evolution a Dockerfile + railway.toml, or retire it
- **Evidence:** services/self-evolution/ contains only main.py + requirements.txt — no Dockerfile, no railway.toml (unlike services/agent-orchestrator, which has both). Repo-wide grep for references to it or its port (8090) outside its own file finds only unrelated feature-flag/feedback code.

### `modules-F8` — Public unauthenticated vendor-portal endpoint has 7.9% branch coverage — the lowest in the gateway
- **Plain:** The page vendors see when a restaurant shares a link with them is barely tested, and it's the one page anyone on the internet can open without logging in.
- **State:** OPEN · **Severity:** low · **Size:** S · **Source:** finding:modules-F8
- **Do:** add spec files for apps/api-gateway/src/vendor-portal before it takes real vendor traffic
- **Evidence:** apps/web/src/App.tsx:181-183 mounts /v/:slug with no auth; apps/api-gateway/src/vendor-portal: 245 LOC, 2 endpoints, 0 spec files; coverage-summary.json: 61.0% stmt / 7.9% branch (heavy.sh jest run, 2026-09-18); production: vendor_portal_pages=0, vendor_portal_listings=0 rows (Supabase, project exzueerziesmczwlhomd).

### `modules-F10` — Two daily cron jobs run against a recurring_orders table that has zero rows
- **Plain:** Automated jobs run every day to process recurring orders, but no restaurant has ever set one up.
- **State:** OPEN · **Severity:** low · **Size:** S · **Source:** finding:modules-F10
- **Do:** founder call on whether the 2 recurring-order crons should stay running against an empty table
- **Evidence:** apps/api-gateway/src/procurement/order-recurrence.service.ts @Cron("15 8 * * *") and recurring-orders.service.ts @Cron("0 8 * * *") + @Cron("0 6 * * *"); production row count: recurring_orders=0 (Supabase, project exzueerziesmczwlhomd, 2026-09-18); recurring-orders.md correctly marks status: backend-only but doesn't note the crons are running against an empty table.

### `modules-missed-M4` — The mobile app (6,954 LOC) is not profiled as a software surface at all, only flagged as a coverage gap
- **Plain:** The mobile app was skipped almost entirely — the report only noted it didn't run its tests, not what's actually in it or whether it's used.
- **State:** OPEN · **Severity:** low · **Size:** S · **Source:** finding:modules-missed-M4
- **Do:** give apps/mobile a real route/module/production-usage census in the next audit
- **Evidence:** find apps/mobile/src -name '*.ts*' | xargs wc -l = 6,954 total lines; modules.md's not-checked list has one line ('did not run web/mobile Jest coverage') and no route/module/production-usage treatment anywhere in the 26-software body, unlike apps/web which gets a full App.tsx-based route census.

### `models-F6` — Only 5 of 24 agent modules actually call an LLM; the other 19 are rule-based logic, not AI
- **Plain:** Of the 25 things we call 'AI agents,' only 5 actually talk to Claude — the rest are ordinary business-logic code labeled as agents.
- **State:** OPEN · **Severity:** low · **Size:** S · **Source:** finding:models-F6
- **Do:** no action — rule-based 'agents' are working as designed; consider renaming for clarity only if it causes confusion
- **Evidence:** grep -rl anthropic services/agent-orchestrator/agents/*.py -> 5 files: provider_communication_agent.py, rfq_agent.py, visual_verification_agent.py, email_intel_agent.py, provider_conversation_agent.py. Remaining 19 of 24 non-init agent files have no LLM client reference.

### `models-F7` — 15 of 24 agent modules have no matching test file by name
- **Plain:** Most of the AI agent code has no test file with a matching name, though broader integration tests may still cover some of it.
- **State:** OPEN · **Severity:** low · **Size:** M · **Source:** finding:models-F7
- **Do:** add named test files for the 15 untested agent modules, or confirm integration coverage suffices
- **Evidence:** Name-substring match of each services/agent-orchestrator/agents/*.py basename against services/agent-orchestrator/tests/*.py (107 test files) found no match for: auto_pilot_agent, buffer_manager, calendar_agent, compliance_agent, email_parsing_agent, ghost_inventory_agent, inequality_detector, menu_analyzer_agent, negotiation_playbook_agent, pos_integration_agent, provider_conversation_agent, shrinkage_detective_agent, sommelier_agent, state_invariant_enforcer, visual_verification_agent.

### `44.14` — Unbuilt plan backlog (self-triaged 2026-08-04)
- **Plain:** This is a list of bigger unbuilt features, but the list itself is old enough that it needs a fresh check before anyone plans against it.
- **State:** UNBUILT-SCOPE · **Severity:** none · **Size:** - · **Source:** register:44.14
- **Do:** a dedicated reconciliation pass before this list is used as a work backlog
- **Evidence:** Not independently re-verified per underlying plan this pass — each of the 5 plan files is a grep-and-excerpt target too large for this pass's budget. Memory notes ("Inbound email intelligence — Phase 0 shipped", "Inventory SOTA — 13 locked decisions") suggest further phases have moved since 2026-08-04, so this table itself may already be stale again, the same failure mode its own opening paragraph describes.

## Move - rules and decided deferrals (14)

### `adr0141-null-restaurant-id-deferred` — apply_stock_movement's restaurant-id argument still defaults to NULL, pending an agent-orchestrator fix
- **Plain:** This gap is already being tracked properly elsewhere — the tech-debt file's copy is redundant, not a new task.
- **State:** DECIDED · **Severity:** high · **Size:** M · **Source:** register:adr0141-null-restaurant-id-deferred
- **Do:** already tracked by ADR 0141 + its CLAIMS.jsonl row; this prose is a duplicate
- **Evidence:** CLAIMS row ADR-0141 (status open) already tracks this precisely, and the full check-claims run confirms it correctly still does not hold true yet

### `44.15` — UX dead-path burn-down (catalog audit, both headings) `[legacy]`
- **Plain:** This list of broken buttons on old pages is itself out of date, and those pages are being rebuilt anyway — better to track it inside the current rebuild than keep a second, stale list.
- **State:** OPEN · **Severity:** low · **Size:** - · **Source:** register:44.15
- **Do:** fold any still-relevant entries into ADR 0149's page-finish tracking; founder call on retiring the catalog file itself
- **Evidence:** UX_PATHS_CATALOG.md is unchanged at 158,311 bytes and still carries the same 2026-07-31 "4 of 6 sampled entries were stale" banner as its newest audit, confirmed live. ADR 0149 (locked 2026-09-16, confirmed present) is now rebuilding every page as Mudavym and deleting legacy once, which supersedes much of what this catalog tracks.

### `orders-wire-guard-blindspot-test-fixture-cast` — A test fixture cast defeats the DTO-key guard
- **Plain:** This is a documented limitation of a safety check, not a bug to fix.
- **State:** CONVENTION · **Severity:** low · **Size:** - · **Source:** register:orders-wire-guard-blindspot-test-fixture-cast
- **Do:** the guard script's own docstring / CLAUDE.md
- **Evidence:** General, permanent limitation of a key-existence guard against TypeScript casts, not a discrete bug

### `two-typechecks-agreeing` — tsc and jest both miss a spec's constructor arity mismatch
- **Plain:** CI already catches this class of bug; it's a reminder for local development, not an open defect.
- **State:** CONVENTION · **Severity:** low · **Size:** - · **Source:** register:two-typechecks-agreeing
- **Do:** CLAUDE.md as a local-dev habit note
- **Evidence:** CI's own Lint TypeScript job already runs the spec tsconfig per the entry — this is a documented local-workflow habit, not a live CI gap; no separate guard was ever built

### `44.3d` — Adopt the rule: read the live schema, not migrations
- **Plain:** This rule is now an automatic safety check, not just advice, so it belongs in the rulebook rather than the bug list.
- **State:** CONVENTION · **Severity:** none · **Size:** - · **Source:** register:44.3d
- **Do:** CLAUDE.md or an ADR, as a standing engineering convention
- **Evidence:** scripts/check_schema_parity.sh exists and runs in .github/workflows/schema-parity.yml, mechanically enforcing this rule on every push and nightly.

### `44.6` — Auth-context placeholders (ManualOverrideModal hardcode + one-tap-actions unbuilt bodies) `[legacy]`
- **Plain:** The dangerous part — pretending unfinished actions had succeeded — is fixed. The actual missing features are just not built yet, which belongs on the roadmap, not the bug list.
- **State:** PARTLY · **Severity:** none · **Size:** - · **Source:** register:44.6
- **Do:** the hollow-success defect is fixed (remove); move "build the reorder/price-update workflows" to ROADMAP as unbuilt scope, not a bug
- **Evidence:** ManualOverrideModal.tsx (the hardcoded-manager file) was deleted 2026-08-26 along with the legacy Inventory page it lived on, confirmed gone. one-tap-actions.service.ts's three action bodies no longer falsely report success — ADR 0083 (confirmed live) now makes an unbuilt action refuse honestly and stay pending instead of lying — but the actual reorder and price-update workflows themselves are still not built.

### `deferred-cost-metrics` — Deferred: cost-drift/straight-through-rate/days-to-close metrics
- **Plain:** Already decided to defer and already tracked elsewhere; this copy can go.
- **State:** DECIDED · **Severity:** none · **Size:** - · **Source:** register:deferred-cost-metrics
- **Do:** already lives in YC_WEDGE_PLAN.md; drop the pointer row from this doc
- **Evidence:** Already pointed at YC_WEDGE_PLAN.md as its single source of truth; not duplicated content here.

### `deferred-line-match-suggestions` — Deferred: line-match suggestions with no UI
- **Plain:** Already decided and tracked elsewhere; this copy can go.
- **State:** DECIDED · **Severity:** none · **Size:** - · **Source:** register:deferred-line-match-suggestions
- **Do:** already lives in YC_WEDGE_PLAN.md
- **Evidence:** Already pointed at YC_WEDGE_PLAN.md.

### `deferred-pos-adapters-cut` — Deferred: Track C POS adapters cut
- **Plain:** Already decided and tracked elsewhere; this copy can go.
- **State:** DECIDED · **Severity:** none · **Size:** - · **Source:** register:deferred-pos-adapters-cut
- **Do:** already lives in YC_WEDGE_PLAN.md
- **Evidence:** Already pointed at YC_WEDGE_PLAN.md REVISION 2.

### `deferred-agent-native-ui` — Deferred: Agent-native UI — explicit DO NOT BUILD
- **Plain:** A final "don't build this" decision, already recorded elsewhere.
- **State:** DECIDED · **Severity:** none · **Size:** - · **Source:** register:deferred-agent-native-ui
- **Do:** already lives in its own decision doc
- **Evidence:** Already pointed at AGENT_NATIVE_UI_DECISION.md.

### `toLocaleDateString-convention` — toLocaleDateString on wire timestamps needs explicit UTC
- **Plain:** Both known examples of this date-formatting bug are fixed; the underlying rule of thumb belongs in the style guide, not the bug list.
- **State:** CONVENTION · **Severity:** none · **Size:** - · **Source:** register:toLocaleDateString-convention
- **Do:** CLAUDE.md or an engineering-conventions doc, as a standing rule for new code
- **Evidence:** Both named instances confirmed fixed live: studio-invite.controller.ts has timeZone: "UTC" at line 102; template-config.ts's formatDate/formatShortDate now branch on string-vs-Date input type, matching the described fix.

### `2842` — 'Not verified this run, and why' — five methodology notes
- **Plain:** These are just notes about what the test run couldn't check, not bugs.
- **State:** CONVENTION · **Severity:** none · **Size:** - · **Source:** register:2842
- **Do:** 03-scenarios/ methodology docs
- **Evidence:** These are the lens session's own caveats about what wasn't measured, not product claims.

### `3153` — 'Not verified, and named' — four scope notes
- **Plain:** These are notes about what wasn't tested, not bugs to fix.
- **State:** CONVENTION · **Severity:** none · **Size:** - · **Source:** register:3153
- **Do:** scenario/build methodology notes
- **Evidence:** Caveats about what the slice-2 build didn't exercise, not product defects; not re-checked (out of scope for heavy.sh, which covers jest/tsc/vitest, not lint).

### `canonical-slice3-stop1-deviation-verified-by` — Deliberate deviation: verified_by/verified_at cleared rather than preserved on a changed correction
- **Plain:** A deliberate design choice, documented — not a bug, just needs to live with its ADR instead of in this file.
- **State:** DECIDED · **Severity:** none · **Size:** - · **Source:** register:canonical-slice3-stop1-deviation-verified-by
- **Do:** a note on ADR 0104 D5
- **Evidence:** A stated, reasoned deviation under CLAUDE.md §0.5, not a defect

## Move - future scope (8)

### `canonical-vat-category-scope-gap` — BR-S-08 needs per-line VAT category the contract lacks
- **Plain:** A future feature gap, not a bug — the checker honestly says 'can't tell' instead of lying.
- **State:** UNBUILT-SCOPE · **Severity:** low · **Size:** M · **Source:** register:canonical-vat-category-scope-gap
- **Do:** ROADMAP.md / FUTURES.md as a contract-extension item
- **Evidence:** Extraction contract has no per-line VAT category field; rule deliberately reports UNTESTABLE, not failing

### `44.7` — SimPOS Provider & Operations Simulator
- **Plain:** This is a bigger planned feature, partly built, not a bug — it belongs on the roadmap.
- **State:** UNBUILT-SCOPE · **Severity:** none · **Size:** - · **Source:** register:44.7
- **Do:** ROADMAP.md as carried-forward scope
- **Evidence:** scripts/simulate exists with test files (test_simulate.py, test_simulate_hours.py, test_simulate_scenarios.py), confirming the doc's own 2026-09-02 update that the accelerated simulator and the panel's verification half exist. Remaining pieces (fire-orders-by-click, missed-webhook detector, Railway deploy) not independently re-checked as still absent.

### `44.8` — Breadth Pass A — Core Operations
- **Plain:** Planned scoring work, not built yet — belongs on the roadmap.
- **State:** UNBUILT-SCOPE · **Severity:** none · **Size:** - · **Source:** register:44.8
- **Do:** ROADMAP.md
- **Evidence:** Depends on 44.7; not independently re-checked this pass.

### `44.9` — Breadth Pass B — Business Loops
- **Plain:** Planned scoring work, not built yet — belongs on the roadmap.
- **State:** UNBUILT-SCOPE · **Severity:** none · **Size:** - · **Source:** register:44.9
- **Do:** ROADMAP.md
- **Evidence:** Depends on 44.7; not independently re-checked this pass.

### `44.10` — Analytics & Insights Truth Suite
- **Plain:** Planned verification work, not built yet — belongs on the roadmap.
- **State:** UNBUILT-SCOPE · **Severity:** none · **Size:** - · **Source:** register:44.10
- **Do:** ROADMAP.md
- **Evidence:** Depends on 44.7; not independently re-checked this pass.

### `44.11` — AI Eval Suites
- **Plain:** Planned evaluation work, not built yet — belongs on the roadmap.
- **State:** UNBUILT-SCOPE · **Severity:** none · **Size:** - · **Source:** register:44.11
- **Do:** ROADMAP.md
- **Evidence:** Doc states this can run in parallel, not gated on 44.7; not independently re-checked this pass.

### `44.12` — E2E Journeys, Manual Pathways & Final Scorecard
- **Plain:** Planned final testing pass, not built yet — belongs on the roadmap.
- **State:** UNBUILT-SCOPE · **Severity:** none · **Size:** - · **Source:** register:44.12
- **Do:** ROADMAP.md
- **Evidence:** Gated on 44.8-44.11; not independently re-checked this pass.

### `44.13` — Autonomous Vendor Discovery + Event-Driven Procurement Signals
- **Plain:** Planned future feature, not built yet — belongs on the roadmap.
- **State:** UNBUILT-SCOPE · **Severity:** none · **Size:** - · **Source:** register:44.13
- **Do:** ROADMAP.md
- **Evidence:** Doc states both unstarted with clean boundaries confirmed; not independently re-checked this pass.
