# Software walk — queue (founder /goal 2026-11-07)

Rule: one software at a time, full research (audit → SOTA → adversarial verify → proposal), then build in small DRAFT PRs.
No questions to the founder; every fork is recorded as the session's call. Merges/prod writes/flag flips/real mail = listed for his word.
Per-software folder: `~/Projects/p4-scratch/sw-walk/<slug>/` (audit.md, proposal.md, lanes.md).

| # | Software | 08-softwares note(s) | State |
|---|---|---|---|
| 1 | Menu upload + updates | (menus; wine-library-sommelier) | Phase 1A BUILT (all DRAFT): docs #763 #764, csv #761, dataurl #762, selfheal #770, orphan #773, read_warnings col #776 → partial #777 (776 first), evidence #779, uncounted #781 + register #782. Wave-2 follow-ups in round-3 section |
| 2 | Invoice scanning → costs math (new-goods side + table side from Floor Checker) | receipts-invoice-match, receiving, pos-bridge | proposals: receipts + `cost-math/proposal.md` (21 lanes); wave 1 building wf_42ca573c-d43 — shipped so far: #774 OCR retire, #775 stamp collision, #778 HEIC, #780 landed-cost rule |
| 3 | New-customer onboarding (effortless) | auth-onboarding | `onboarding/proposal.md` (18 lanes); wave 1 building |
| 4 | Reports: every graph, bar + combos, full-screen, no bugs when switched | reports-analytics, dashboard-home | `reports/proposal.md` (13 lanes); wave 1 building |
| 5 | Email: Mail tab in /communications, which address, arrival, portal | communications-hub, settings-integrations | `mail/proposal.md` (12 lanes); wave 1 building |
| 6 | Drink/cocktail recipes ↔ goods | wine-studio, wine-library-sommelier, inventory-command | `recipes/proposal.md`; wave 1 building |
| 7 | Inventory UI: all goods incl. foods, used-in, KPI cards, nutrition card | inventory-command | `inventory/proposal.md`; wave 1 building (+ CV count w/ manual fallback, founder ask 2026-11-07) |
| 8+ | Rest of `.planning/08-softwares/`: orders, recurring-orders, vendor-directory, vendor-portal, vendor-price-compare, global-vendor-search, notifications, calendar, promotions, recommendations, team-command, simpos, admin-health, app-shell-support, mudavym-mcp | each note | queued |
| ∞ | Cross-cutting: fast loading (bundle, route split, API latency) | app-shell-support | per software |

Disk: 13G free at start (keep ≥30G) — remove clean merged worktrees first (census `../sw-menu-receipts/wt-removable.txt`).

## QA intake — peer session "Midavim.com integration audit", round 1 (reports: `qa-report/round1-*.md`)
Code-read, not browser-verified; verify at origin/main before acting.
| QA item | Routed to |
|---|---|
| B1 verifyReceipt applies pack size twice (matched verdict can remove 660 bottles) | #2 cost-math. NOTE: the debt entry QA cites (TECH-DEBT:2293) is CLOSED 2026-09-21 by ADR 0192; QA repro is a pure computeMatch call with stocked=60 in counted uom "case" — check whether any real caller passes that before fixing |
| B2 CSV decimal-comma prices | #1 menu lane `csv` (in build) |
| B3 no Mail tab / which-address view | #5 mail |
| B4 no full-screen / combo charts | #4 reports |
| semicolon/.xls/.tsv/rich-text cells; zero-item upload marks menu uploaded | #1 lanes `csv`, `partial` |
| Turkish dotless-i not folded in wine-name normaliser | #1/#6 — new lane |
| re-verify duplicates vendor credit claims | #2 cost-math |
| unknown URLs → sign-in, not 404 | cross-cutting app-shell |
| HARM: Terms "placeholder"; privacy says AI provider "outside Turkey" | legal copy — truthful rewrite lane; final wording listed for founder |

Disk 2026-11-07: worktrees are not the lever (2 merged+clean removed; 11 merged ones are dirty → kept, never --force). Docker holds 60G (images 36.6G reclaimable, volumes 6G). NOT pruned — destroys local DB stacks; founder's call (`docker image prune -a` / `docker container prune`). Lanes run on symlinked node_modules (~200MB each) so 15G is enough for wave 1.

## QA round 2 (peer, vs origin/main 4e4399c05; reports `qa-report/round2-onboarding.md`, `round2-inventory-recipes.md`) → wave 2 inputs
- onboarding BLOCKER: "Finish setup" for an owner WITH a house → /get-started restarts at Welcome, dead-ends "already has a house" → route by progress, resume at the open step.
- onboarding BLOCKER: /house has no link to dashboard; logo not a link.
- onboarding: 15 bugs; no tests cover GetStarted/VerifyEmail/House → add specs with each lane.
- inventory BUG: list caps at 1,000 goods while footer says "All N of N"; GET /wines?ids= URL overflow ~420 ids (→ POST or chunk); par 0 saved as 6.
- inventory/recipes BLOCKER (known): used-in, non-wine goods, KPI cards, nutrition, recipe cost/depletion → proposals already cover.
- HARM: 2 are in the proposals themselves → read round2 report before wave 2 builds.
- #761 CodeQL: FIXED 0ca4817d4.

## QA round 3 — PR re-test (`qa-report/round3-pr-retest.md`): no regressions
- FIXED: #773 orphan version, #774 OCR retire, #776 read_warnings column — **#776 must merge BEFORE #777**.
- PARTIAL → wave-2 follow-ups on the same branches:
  - #761: XLSX rich-text + error-formula cells still "[object Object]"; "price left blank" notes never shown to the user.
  - #775: upload ignores the new duplicate verdict; insert-time number-index collision still 200 + null id (= receipts 1.1, wait on #688 overlap).
  - #777: warnings stored, no UI shows them; pages past 120-page cap not recorded.
  - #778: HEIC stored unread; menu scan still labels HEIC as JPEG (shared helper not used by scan path?).
- Still open from round 1: verifyReceipt pack size (check ADR 0192 first), repeat-verify duplicate credit claims (H-1), Turkish dotless-ı fold (B-1).

## QA round 3b — orders/vendors (`qa-report/round3-orders-vendors.md`) → software #8 (orders, vendor-portal) inputs
- HARM (worst, repro'd): re-ordering same wine from same vendor rewrites an APPROVED order's qty and zeroes its price, no re-approval → top priority lane when #8 starts (approved orders immutable; re-order = new draft).
- BLOCKER: vendor portal — nothing creates/edits a catalogue page.
- BUG: Orders page shows newest 50 only; older open orders drop off.
- Also: merge, soft-deleted vendor, negative price, monthly drift, mixed-currency items. Counts 1/6/9/6/8.

## Wave 2 — menu/receipt follow-ups (workflow wf_360bc58b-1cf, task wv2pwu5k8, launched 2026-11-07 ~02:35)
Lanes: csv-761, partial-777 (+ zero-item refusal B-5), heic-778 (+ scan path, iOS accept), stamp-775 (check #688 overlap), dotless-i (new branch fix/wine-name-folds-turkish-i), receipt-h1 (new branch fix/receipt-verify-counts-once; BL-1 verify vs ADR 0192).
ADR 0358 D1–D9 LOCKED on #763 (8bf9d9139) under the /goal; claim ADR-0358-DELEGATED-CALLS-LOCKED. Disk 12G free at launch.

## QA round 4a — notifications/calendar/promotions/recommendations (`qa-report/round4-notif-cal-promo.md`) → software #8+ inputs; 0 BLOCKER / 11 BUG / 4 HARM / 8 IMPROVE
- HARM (promotions): vendor mail — alcohol % parsed as discount; promo ended yesterday stored valid +1 year; "$15 off per case" subtracted from per-bottle price (repro'd) → first lane when promotions starts.
- HARM (notifications): "Delete all read" wipes read alerts across EVERY venue the user belongs to → scope by restaurant_id; phone pushes ignore quiet hours + push opt-outs.
- BUG (recommendations): dismissed cards return same evening for US houses — dismissal key rolls on UTC day (same class as reports UTC-day bug → share one house-local-day helper).
- Web client not read by QA; verify at origin/main before acting.

## QA round 4b — team/admin/shell speed (`qa-report/round4-team-admin-shell.md`, origin/main c93d6115c) → team-command, app-shell, fast-loading; 0 BLOCKER / 11 BUG / 3 HARM / 5 SMOOTH / 8 IMPROVE
- Good: pay, certificates, time off are scoped correctly by role and house; no cross-tenant hole found.
- HARM (team-command): fail-open reads — waiter week shows "Off" on a failed read; acknowledge reports success when not saved; certificate/time-off lists return empty on error → errors must say so (ADR 0020 / absence-reported-as-health).
- HARM: staff see the manager's unpublished draft week as final → filter to published for staff.
- SPEED (cross-cutting ∞, do FIRST of the cross-cutting work): ~820 KB gzip JS on first paint for any visitor; recharts/tremor chunk + Register + Inventory pages sit in the eager bundle → lazy-load them (route-level React.lazy + manualChunks check).

## QA round 4c — PR re-test #770 #779-#783 (`qa-report/round4-pr-retest.md`; 300 migrations built in PGlite) — no regressions
- FIXED: #779, #782, #783.
- PARTIAL → wave-3 follow-ups on same branches:
  - #781: wine received + sold but never counted can never raise low-stock (confirmed in built DB); /inventory still shows it "Out".
  - #770: zero-line read then hand-typed lines still reads "not uploaded" for a later invitee.
  - #780: "Not cost: tax" line false under KDV-inclusive prices (ties to cost-math 3-4 tax-basis lane).
- NOT FIXED anywhere: par 0 saved as 6 (inventory.service.ts:1054-1055) → inventory lane.

## QA round 5a — re-test #784-#787 (`qa-report/round5-pr-retest.md`) — no regressions
- FIXED: #784, #786.
- PARTIAL → wave-3 (after wave 2's own audit/fix lands on these branches):
  - #785 Turkish ı: stored rows keep old hash, no backfill → new "KAVAKLIDERE" misses stored "kavakl dere"; vendor-intel + beverage_normalize_text still split Turkish names → one shared fold + idempotent backfill.
  - #787 repeat verify: concurrent verify still writes duplicate events + price history (only claim guarded) → lock per document; correction leaves first claim at old amount; currency-only change swallowed as repeat (include currency in the sameness key); cancelled order can still be verified → refuse in words.

## QA round 5b — vendor search / MCP / wine studio (`qa-report/round5-search-mcp-wine.md`; SQL findings static) — 1 BLOCKER / 14 BUG / 5 HARM / 4 SMOOTH / 8 IMPROVE
- BLOCKER (#6 recipes/wine-studio): Wine Studio promotion inserts ~15 columns no migration defines; auto path tells contributor "promoted" while the wine never enters the library → verify column list vs baseline, fix insert or add migration, never say "promoted" on failure. Top of wave 3.
- HARM (mudavym-mcp, security first): MCP resources have no tenant scope; MCP rate limit bypassed by batched request (count each call in a batch).
- HARM (vendor-price-compare/global-vendor-search): mixed-currency price consensus → never average across currencies; group per currency.

## QA round 5c — receiving / POS bridge / dashboard (`qa-report/round5-receiving-pos-dash.md`; no live POS / real RPCs) — 2 BLOCKER / 14 BUG / 6 HARM / 9 IMPROVE / 10 SMOOTH
- BLOCKER (#2 cost-math, table side): voids/refunds invisible to Toast, Square, Clover adapters (only generic reads them) → sales + stock overstate. Cost math is wrong until fixed → top of wave 3 with the Wine Studio blocker.
- BLOCKER (#2): unresolved-line queue never replayed → mapping an item later never heals stock → replay on mapping create, idempotent per line.
- Unverified: websocket on a food-only sale (DASH-6).
- Peer note: every queued software has had one audit pass; peer next re-tests merges, then goes deeper on reports/mail.

## QA round 6a — reports + mail deep, executed (`qa-report/round6-reports-mail-deep.md`, repros in `round6-tests/`, origin/main 7221901d6) — 3 BLOCKER / 16 BUG / 4 HARM / 6 SMOOTH / 4 IMPROVE; of 34 round-1 findings 24 CONFIRMED, 3 REFUTED (R-3, M-16, UTC half of R-14), 10 need a browser
- SECURITY N-1 (#5 mail, fix FIRST): spoofed From: "Sales <sales@bigdist.com>" <attacker@evil.example> filed as the real vendor's reply on an open order → match parsed address only, never display name. Lane started immediately (see below).
- Round-1 list stands: no Mail tab; no full-screen / combo chart.

## Wave 2 DONE (wf_360bc58b-1cf) — every lane audited + fixed, all DRAFT
- #761 csv 52f13075c (notes on reply + web list; Invalid Date fix) — over 30K diff budget (~46K) → split at merge.
- #777 4337afead + split-outs #793 (empty read refused) and #794 (warnings web) — #793 CI red until #776 on main; order #776 → #777 → #793; #773 conflicts in importMenu.
- #778 4f0b0a21d (scan path sniff, iOS accept) — 17 files / ~57K → split at merge.
- #775 44d32690c (reply says duplicate; insert collision) — ~57K; storage object left on insert collision OPEN.
- #785 fb2657833 dotless-ı (signature_hash backfill deferred) ; #787 3af82c199 verify-once.
- Env gap: web eslint can't resolve eslint-plugin-jsx-a11y in symlinked worktrees (main checkout link points into a deleted worktree).
- N-1 mail spoof lane running as a single agent → branch fix/mail-sender-parsed-address-only.

## Wave 3 launched (wf_e3d33ca2-db8, task w1b43qguz) — 14 lanes, build→audit→fix
New branches: pos-voids, pos-replay, wine-studio-promote (3 BLOCKERs); notif-harm (+reco UTC day), promo-parse-harm, mcp-harm (+currency consensus if same files), team-failopen, bundle-lazy (perf), par-zero (+1000 cap, ids URL overflow).
Follow-ups on branches: #781, #770, #780 (KDV-inclusive), #785 (shared fold + safe backfill), #787 (concurrency/correction/currency/cancelled).
Still queued after wave 3: Mail tab + full-screen/combo charts (proposals), onboarding blockers (Finish setup loop, /house dashboard link), orders HARM (approved order rewrite), vendor-portal catalogue, Orders 50 cap, CV inventory count, legal copy, unknown URL → 404.

## QA round 6b — re-test #788-#790 (`qa-report/round6-pr-retest.md`) — no regressions; running total 16 re-tested: 8 fixed, 8 partial, 0 regressions
- FIXED: #788, #790.
- PARTIAL #789 (onboarding verify mail): resendVerification (auth.service.ts) still returns {sent:true} when the mail provider is down (repro'd) → follow-up lane.
- #789 follow-up DONE 6855173fb: resend reports real send outcome (`verificationMail`), web shows failure in words; B-4 expired-link resend. Still open: Register.tsx ignores verificationMail (OB-6); registerRestaurant/invite join fire-and-forget; sign-up awaits mailer with no timeout (tech-debt fragment).
- N-1 mail spoof → DRAFT #797 (cabfaeb9b): one RFC 5322 parser (nodemailer addressparser) at all 4 sites; comma lists (M-10); RFC 2047 subjects (N-2). Call: no senderVerified gate (attacker can forge Authentication-Results under last-wins headers; DKIM lacks domain match). Open: N-3 Cc/Bcc, N-4 Reply-To, M-9 ilike `_` wildcard, transport-signal gating. Claims guard failure was real (stale flag readBy anchor house-inbox.service.ts:339→340, caused by this diff); fixed on the branch, guard 1064/1064.

## QA round 7a — re-test #793 #794 (`qa-report/round7-pr-retest-menu.md`) — no regressions
- FIXED #793 (zero-item upload → 422 before anything saved / onboarding marked).
- PARTIAL #794: onboarding wizard's 3 upload screens (MenuScanUpload, MenuCsvUpload, MenuManualEntry) still don't show missed pages → wave-4 follow-up.
- MERGE ORDER (menu): #776 → #777 → #793 → #794.
- LOW: one null entry in stored warnings crashes the kept-menu panel on /menu (server never writes one) → defensive filter in the same follow-up.

## QA round 7b — re-test #791 #792 #795 #796 (`qa-report/round7-pr-retest-mail-mcp.md`) — no regressions
- N-1 "still open": QA ran before #797 existed → #797 covers it (re-test owed).
- PARTIAL #791: DB-failure 503 can never fire (resolveRestaurantId swallows errors → outage answers 200, letter to triage); duplicate delivery M-5 unfixed.
- #792 caveats: backlog past 100 pages re-reads forever (30K messages.get over 3 pushes); cursor moves before bridge stores the mail.
- #795 caveat: can pick a grant the manager cut off (ADR 0114) or one Google no longer honours.
- #796 FIXED.

## QA round 7c — END-TO-END seams (`qa-report/round7-end-to-end-seams.md`, probes `round7-probes/`) — 3 BLOCKER / 9 BUG / 5 HARM / 8 promised seams with no code. VERDICT: story cannot run end to end.
- BLOCKER 1 (cost-math, FIX FIRST): invoice price reaches lot cost as printed price, not per bottle (case 264 / 12 → 264 per bottle). → single agent launched (branch fix/lot-cost-is-per-bottle).
- BLOCKER 2: no food/recipe seams; POS depletes only wine lines → #6 recipes + #7 inventory "all goods incl. foods" (wave 4 core).
- BLOCKER 3: Toast runs a second POS path that never writes pos_checks → after wave-3 pos-voids lands (same adapter files).

## QA round 8a — cost + pour size re-test #780 #809 #812 (`qa-report/round8-pr-retest-cost.md`) — no regressions, none FIXED
- Per-bottle BLOCKER still open on every PR → the fix/lot-cost-is-per-bottle agent got the extra cases (pack_size never read; :747-751; landed-cost.ts never imported, incl. #812). Freight → tax stamp null on every paper = follow-up.
- PARTIAL #809: restaurant_inventory.pour_size_ml still DEFAULT 150, so new items ignore the house's confirmed pour; the SQL test hides it by inserting an explicit NULL → follow-up on #809 (drop default / fill from house pour, test without explicit NULL).
- PARTIAL #812, #780: see report. (#787 stays PARTIAL per round 5; ignore "NOT FIXED".)

## QA round 8b — Wine Studio B-1 series #807 #808 #810 #811 (`qa-report/round8-pr-retest-studio.md`) — no regressions; round-5 BLOCKER CLOSED (299 migrations in PGlite, real inserts pass, 1741 tests)
- FIXED #807 #810 #811. PARTIAL #808: manual Promote's name pre-check sits in front of the unique index → NV and producer-less wines get a false 409 (NV Krug vs a 2016 Krug). Fix: drop the pre-check, let the unique index (which knows vintage NULL) decide, map 23505 to 409.
- ALSO: wine already in library → second contributor's submission never linked/approved; a name-only submission becomes a shared row. → follow-up after wave-3 audit:wine-studio-promote finishes (same files).
- Not run: real PostgREST error shape (PRs assume it).

## QA round 8c — POS + wines #803-#806 (`qa-report/round8-pr-retest-pos.md`, probes round8-tests/) — no regressions; refunds + real-PG replay not tested
- FIXED #803 #806.
- PARTIAL #804 (replay): Toast queued rows still skipped → its unresolved queue never replays; 500 older unreplayable rows hide every newer one (needs a cursor/skip-marked rows); 500-id .in() on a 5,000-sale save overflows the URL (chunk like #803).
- PARTIAL #805 (void returns pour) — HARM: a 2nd void under a different key creates 300 ml phantom stock (void must be keyed on the sale line, at most once); bottle sale remapped to glass returns nothing silently (void must follow the sale's booked unit, not the item's current one).
- Toast/Square/Clover voids invisible → open PR #798.

## #816 fix/lot-cost-is-per-bottle (7c BLOCKER 1 + QA 8a) — DRAFT, head 46493a0fe, 6 files ~29.9K
- perBottleLotCost(unit_price ÷ bottles in price base) at agreedPrices; refuses (lot stays provisional, reason written) on ambiguous basis, never prints price or 0. 767 + 34 tests; claims 1064/1064 (M1-M6 caught).
- OPEN follow-ups: wire landed-cost.ts (#780/#812) + freight/fees/tax stamp; line_total cross-check for uom 'bottle' lines priced per case; cellar migration 20261223060000 `inv` CTE reads unit_price; delivery_proposals.unit_price_proposed has no unit; prod lots already finalised at printed price (needs founder's word for any prod query/backfill).
- Independent audit launched (sonnet-auditor).
- #816 audit PASS-WITH-NOTES: D1 unknown uom coerced to 'each' upstream (extractor :349) → printed price still booked; D2 claims check beaten by rewire; D3 costNote states wrong reason; D5 no ORDER BY, later line clears refusal; D4 + raw proposal price → OPEN notes. D1/D2/D3/D5 sent back to the fixer (stack D1 if >30K).

## QA round 9a — per-bottle #816 #815 (`qa-report/round9-pr-retest-perbottle.md`) — no regressions; 7c BLOCKER 1 CLOSED for lines that state their price unit
- #816 PARTIAL: bottle row with case price posts 264 even when line_total contradicts; accepted proposal posts raw; lots already final at printed price not repaired by re-verify (delivery.service.ts:907-916). All three sent to the #816 fixer; prod correction of existing lots = founder's word.
- #815 FIXED for its claim (printed tax check), but landed-cost still wired to nothing → wiring lane owed after #816.

## QA round 9b — team + ranking #817 #818 #819 #822 (`qa-report/round9-pr-retest-team-rank.md`) — no regressions; jest/vitest only, #822 web tsc unfinished, MyShifts RTL file lost
- FIXED #818 #819 #822. PARTIAL #817: getSettings (team.service.ts:2485) still fails open → follow-up agent launched.
- #805 follow-up DONE: head 8f57c6c6d, DRAFT. A sale gives back at most what it booked under any key (V10/V11); a void follows the booked unit (ml via pour_events, else bottles via the sale ledger row), raises P0002 when no booking exists. SQL PASS on PG17, jest 388/388, claims 1064/1064, revert-proof per fix. ~50K / 13 files → SPLIT AT MERGE. OPEN: old unkeyed sales now fail on void (count unknown, needs prod read = founder's word); no-live-lot void returns 0 quietly; wine_consumption_log not reversed.

## QA round 9c — stock + receiving #813 #814 #820 #821 (`qa-report/round9-pr-retest-stock-receiving.md`) — no regressions; race via 40 jittered PGlite interleavings, not 2 real connections
- FIXED #813 #820.
- PARTIAL #814: footer says "Nothing is out or below par" while alert fires; dashboard vs /inventory criticalCount disagree → follow-up agent launched (one shared rule).
- PARTIAL #821: correction to a clean count leaves old claim open; verdict change (damaged→short) opens a 2nd open claim → send after wave-3 fix:f787 finishes (same receiving files).
- #817 follow-up: getSettings fails closed (500 + sentence; no row → defaults configured:false); getWeek refuses the week. Head 4436787bf, team+calendar 723/723, read-error baseline 144→143. Agent now fixing getWeek's schedule_receipts + schedules swallowed reads. #818/#819 stacked on #817 → restack at merge. Web shows axios text, not the gateway's sentence (pre-existing, app-wide) → queue.
- #817 2nd follow-up: getWeek schedules + schedule_receipts reads refuse with a sentence; head 8f866fc57; 726/726, revert-proof 2 fail. DONE.
- NEW GUARD LANE (queued): check_read_errors_not_swallowed.py misses `{ data: x } = await …` destructure and `(await …).data ?? []` → widen detector, sweep the repo, baseline what exists (solve-it-once rule).
- #816 stack DONE (all DRAFT): #816 @850b45571 (D2/D3/D5, 768 tests) → #837 @193a4f3b6 fix/unknown-unit-is-refused (D1 + 9a(1) line_total cross-check, 772) → #838 @ce0d3f780 fix/reverify-repairs-printed-cost (9a(2) re-verify repairs lots whose cost == printed price; refusals flagged in costNote, 775). Claims mutation-tested (10/8/10 mutants). MERGE ORDER #816→#837→#838.
- OPEN: accepted-proposal price (no unit on proposals); prod lots already wrong (founder's word); manual lines carry no printed unit; cellar `inv` CTE + vendor-comparison.service.ts:902-913 read printed price → small audit lane queued; web renders costNote as one sentence.
- #814 follow-up DONE: head d633eedd8 (~32.8K → split/trim claims at merge). One shared summarizeStock/bandOfRow (gateway) + standingFor (web); dashboard == /inventory criticalCount; read sentence names uncounted; "Not counted yet" order group. 2602 gateway + 731 web tests, revert-proof. Stacked fix/low-stock-one-voice requested for: dashboard list severity, stale inbox wording after count, ?filter=low-stock unread.

## Wave 3 DONE (wf_e3d33ca2-db8, 41 agents, 0 errors) — all DRAFT, each built → audited → fixed
- pos-voids #798 @85a5f20c7 (Clover refund phantom + cross-send double return fixed). OPEN: POS-4 (void of a never-seen sale adds stock), Toast refunds unmapped, per-line sales still count returns (POS-10).
- promo-parse-harm #799/#800 @4a7cf0871 (trimmed to <30K). mcp-harm #796 audit APPROVE. bundle-lazy #802 @d1cafa2bb (no signed-in browser measure).
- par-zero #801 @57b0… + #803. wine-studio-promote #807-#811 @aebb45270 (claim text only). team-failopen #817-#819 @3e2d0f2ea (then my 9b follow-ups → 8f866fc57).
- f770 body-only fix. f780 → #828 (fixes #812's false sentences; merge #828 with #812; #815 base retarget refused by auto-mode → do at merge).
- f781 #814 @ee63dc9f5 (then my 9c follow-up). f785 doc-only @1293c4501. f787 → #820/#821 @385b2bfa1 (set-aside shows 'Written off'; 'withdrawn' label = follow-up).
- pos-replay #804 @2ffb… (Toast door NOT replayed per an ADR 0011 amendment — my #804 agent must respect/revisit it). notif-harm #824/#826 (3 ungated senders notes/schedule/team; agent quiet hours on server clock).

## QA 10a (cost residuals) — 2026-11-07
Report qa-report/round10-pr-retest-cost.md. #828 FIXED. #837 PARTIAL (refuses pcs/btl., credit notes skip check). #838 PARTIAL (repair only on API re-verify, edited lines never repaired, web hides verify message). #816 open: accepted proposal raw price; case price on bottle row books 264.
Fix agent dispatched on the stack (items 1-7; repair job dry-run only — running it on prod = founder's word).

## QA 10b (notif/settings/inventory reads) — 2026-11-07
Report qa-report/round10-pr-retest-notif.md. FIXED #823 #824 #825. PARTIAL #826 (generator suppression key still UTC week), #827 (cost/value/margin blank unnamed; 1000-row cap; legacy+command pages), #833 ("confident count" note, appended twice). Fix agent dispatched on all three.

## #821 follow-up (QA 9c) — 2026-11-07
Head 7479cbb55. Both 9c breaks were already fixed at 385b2bfa1. Added: migration a_delivery_holds_one_open_claim (one open order-level claim per order; warns and skips the index if duplicates exist), plus a retry-on-23505 re-read in openCreditClaim. Jest 2473 pass.
FOUNDER/PROD: count orders with two or more open order-level claims before merge (if any exist, the index won't build).
SIZE: about 42K, over the 30K wall, so split before the gate.

## Wave 1 DONE — 2026-11-07 (wf_42ca573c-d43, 64 agents, 0 errors)
Last lane: inventory-lot-cost-keeps-small-units → #839 @6b45d68c0 (migration a_lot_cost_keeps_small_units, unit_cost numeric(10,2)→(14,6); pgtest pass, fails on main). 4 files, 380 lines.
MERGE ORDER: if fix/lots-are-never-deleted (#783) merges after #839 it must keep the 6-place rounding, or claim G24 fails. Also check #816's per-bottle helper against the 6-place precision at merge.
Not verified: production grants (Schema parity job); per-kg→per-gram callers of apply_stock_movement.

## QA 10c (Turkish ı fold #829-#832) — 2026-11-07
Report qa-report/round10-pr-retest-fold.md. FIXED #829 #831. PARTIAL #830 (ASCII/caps re-assert after ı makes a second bottle), #832 (Kavaklıdere/KAVAKLIDERE Yakut stays 2 rows; review table unread; grep-only spec, 6/8 mutants survive). Fix agent dispatched. N-1: covered by DRAFT #797; QA re-test owed.

## #804 replay gaps (QA 8c) — 2026-11-07
Fixed in a new stack on #806: #840 (code, 5d3a861ff) → #841 (ADR 0011 calls 4/6, claim POS-2-REPLAY-REACHES-EVERY-ROW, 06d4f9c6e).
- Toast-door rows now replay under toast_sale keys.
- Cursor pages of 500 replace the fixed window.
- .in() reads go 100 ids at a time.
513 pos tests pass; each fix's revert fails its spec.
MERGE ORDER: #834 → … → #806 → #840 → #841 (stack not refreshed onto main).
Open: no index on events payload->>toast_order_guid (measure on a real DB); archived events stay waiting; a save runs serially (~1,500 queries).

## #814 follow-up (QA 9c) → #842 — 2026-11-07
fix/low-stock-one-voice @459910066, stacked on #814. One severity rule (alertBandOf) on the dashboard and in alerts; the edge sweep restates stored "not counted yet" alerts after a count; ?filter=low-stock now becomes a chip on /inventory. 2607 gateway + 733 web tests pass.
SIZE: about 44K, so split before the gate.
Not done: browser check of /inventory, eslint, restate query on a real DB.
MERGE ORDER: #814 → #842.

## QA 11a (auth + integrations, origin/main) — 2026-11-07
Report qa-report/round11-auth-integrations.md: 1 BLOCKER, 5 BUG, 4 HARM, 2 SMOOTH, 13 IMPROVE.
BLOCKER R11-01: registerRestaurant keeps the email's case, so a Chef@Bistro.com owner cannot reset, get a code or use Google.
HOLDS: #179, session_version, role checks, #479, code limits, PKCE.
Fix agent dispatched: R11-01 in its own PR (fix/register-lowercases-email, with a migration that refuses on collisions), then BUGs/HARMs including the X-Forwarded-For rate limit.
FOUNDER/PROD: count case-collisions; run the lowercase migration; confirm whether Railway appends or replaces X-Forwarded-For.
ENV: @simplewebauthn/server missing from the shared node_modules, so 4 suites don't load.

## QA 11b (#839 #840 #841) — 2026-11-07
Report qa-report/round11-pr-retest-pos-precision.md. All three FIXED for their own scope.
Residuals, fix agent dispatched:
- #839: merging #783 after it rounds the lot view back to 2 places; web shows 0.035 as 0.04; the table rewrite cost.
- #840: stuck rows still hide newer ones; a void after the mapping adds phantom stock (the #805 family).
- #841: an ADR sentence contradicts the code.
FOUNDER/PROD: time the #839 ledger rewrite on production before merging.

## QA 12a (#842 low-stock) — 2026-11-07
PARTIAL. The #814 symptoms are FIXED.
Still open, dormant: database.service.ts:42-53 filters only is_active while the view also drops IN_TRANSIT and deleted rows, so the card shows 10/8 against the inbox's 8/6.
Pre-existing:
- HARM: a failed view read resets alert states to ok, so every alert re-fires.
- The 1000-row cap cuts the list and summaries short.
- The tr sort uses no locale.
Fix agent → new stacked branch fix/low-stock-reads-agree on #842.
- 2026-11-07 disk hit 1.5G free mid-wave-4; removed 32 clean, fully-pushed worktrees of open DRAFT PRs (re-add with git worktree add when a PR needs work) → 15G free.

## QA 12b (#844 #845 #846) — 2026-11-07
#846 FIXED. #844 PARTIAL (proposals only partly per-bottle), relayed to the running per-bottle agent. #845 PARTIAL: only whole-bottle sales carry cost.
NEXT LANE after wave-4 finishes #845's audit/fix (so two agents don't edit at once): stamp the ml cost on glass pours; reverse the stamp on void/refund (coordinate with #805 returns_sale_key); re-stamp or flag sales made before invoice verification.
Not run: concurrent sales on one lot (needs two-session Postgres). A stamp adds ~6% per sale.

## QA 12c (#847 #848 #843) — 2026-11-07
All three onboarding/full-screen BLOCKERs CLOSED.
Residuals:
- #847: a manager's "Upload Now"/HouseMenu goes to /get-started and is bounced to the desk.
- #848: the vendor_added PATCH was dropped, so completed_at isn't set when the supplier is the last task.
- #843: Cmd-K opens a palette hidden under full screen, and one Esc closes both.
Open outside any PR: the combo (bar + line) chart was never planned in wave 4; R-7 swap sizing at ReportsNext.tsx:257 (wave-4 lane reports-sheet-keeps-its-places is still building and may cover it, so check its PR).

## WAVE 5 (launch when wave 4 ends, so no two agents edit the same branch)
1. reports combo chart (bar + line), stacked after the sheet-keeps-its-places PR
2. QA residuals for #843, #847 and #848 (above)
3. sale-cost follow-up (QA 12b): glass-pour ml, void/refund reversal, sales made before verification
4. whatever wave 4's audits leave

## Model routing (ADR 0361) — 2026-11-07
- DRAFT #859 docs/model-routing-three-tiers; agents haiku-runner/sonnet-builder/opus-head at ~/.claude/agents; wave scripts paste TIER from ROUTING.md (wave 5 onward).

## QA 13a reports (#850 #851 #852) — 2026-11-07
- #850 FIXED (caveat: 768 = sheet width, not viewport). #851 FIXED + edge (refetch fail mislabels/locks Arrange). #852 PARTIAL (place mid-save dropped; two-tab LWW = known gap).
- Dispatched sonnet-builder (ADR 0361 fix round 1) → wt/r13-851, wt/r13-852.
- Still open → wave 5: R-7 swap sizing ReportsNext.tsx:317; combo chart.

## QA 13b auth+reads (#853 #849 #854) — 2026-11-07, all PARTIAL
- #853 HIGH: validateUser raw-email lookup (auth.service.ts:393); stranded twins/non-ASCII; tr_TR SQL test → sent to running Opus auth fixer.
- #849: VerifyEmail.tsx:155 says sent on sent:false → sonnet-builder wt/r13-849.
- #854: CSV blank for unread cost; database.service.ts:42 unpaged → sonnet-builder wt/r13-854.
- Founder word: stranded duplicate-email owner rows (no merge/delete without him).

## QA 10b DONE — 2026-11-07
- #826 @1e49907e8; #827 @98c8ade0f (29992B); #854 NEW stacked on #827 @e7a94486f; #833 @28d476786 (30000B); #865 NEW stacked on #833 @58f32000a.
- Wave 5 residuals: #865 "Turkey" country string not recognised as Türkiye; page sentences stay English (mixed language); live-model prompt untried; no browser check.

## QA 14a recipes (#863 WORKS, #864 PARTIAL) — 2026-11-07
- wave-4 build:recipes-engine-server still running (feat/recipe-engine-gateway pushed, no PR yet; no audit started) — do not touch until it lands.
- WAVE 5 (opus-head, money math): recipe cost precision 6dp not 2; zero/partial WAC must not count as complete; case-item gin @264 gets no cost (ADR 0360 by design — revisit: per-bottle from case); reconcile ADR 0360 average-WAC vs #845 per-sale lot cost (one truth for margin); save-lock concurrency test; route + sale link + margin; depletion on sale for drinks AND food (missing entirely).

## QA 14b (#855-#858) — 2026-11-07
- #857 FIXED. #858 FIXED + legacy page 0.04 → 11b agent. #856 FIXED + contradicting msgs / not-sent lost on reload → #849 sonnet-builder after #849.
- #855 PARTIAL (shared Vercel bucket, IPv6 /64, hops too high) → auth Opus agent: email+IP keys. #853 sign-in break still first.
- Unverifiable here: Railway real XFF behaviour, Vercel egress count (founder-word list).

## QA 14c inventory features (#860 #861 #862) — 2026-11-07, all PARTIAL
- wave-4 build/fix:inventory-item-drawer-web still in its fix phase → UI (used-in, KPI) lands there; re-QA after.
- WAVE 5 opus-head (tenant/money/migration): #860 recipe editor never writes the used-in link + soft-deleted good returned live; #861 shadow lots leak into trend/count gap, waste >1000 cut, per-gram money waits #839; #862 Turkish-case unique index (Rakı/RAKI, IRMIK/ırmık) + 409 missing existing id + list cap 1000 + flour sent as 750ml bottle + foods absent from dashboard/MCP low-stock; tenant-scoping tests on menu lines/counts/lots (9 surviving mutants).
- WAVE 5 new lanes: nutrition card (KPI → nutrition), add/receive-a-food screen, house-wide KPI cards, dish links in used-in.

## QA 10c DONE — 2026-11-07
- #830 @f4ae42b5c; #831 @aa79444c9; #832 @15ae5ea02; #869 NEW (refold-review reader, admin-only) @5caa30670 stacked on #832.
- Not done → wave 5: F2 roster row on old hash (review table only, nothing resolves); review screen + resolve action; suggest() spec; size-equality mutant survives (#830).
- Founder word: production refold row count; Kavaklıdere/KAVAKLIDERE pair held for manual merge (ADR 0124 no auto-merge).

## QA 12a DONE — 2026-11-07
- #873 NEW fix/low-stock-reads-agree @2c782165a (29,946B) on fix/low-stock-one-voice: card/summary = inbox/alerts, failed read keeps alert states, readWholeWindow paging, Turkish collator sort.
- Open: dashboard.service.spec "inventory summary" failing — haiku-runner checking base vs head; dashboard.service.ts ~1180/~1388 stats/alert reads unpaged → wave 5.

## QA 13b #854 follow-up — 2026-11-07
- #874 NEW fix/inventory-csv-and-base-list-page @a55eb5521 on #854: CSV "could not be read" marker, getRestaurantInventory paged, unread cost sorts last. #854 unchanged @e7a94486f.
- web tsc 84 errs = missing packages/ui node_modules link in wt/r13-854 → haiku-runner re-check.
- Wave 5: value-on-hand sum uses wac??price for unread rows; unread zones blank in CSV; fetchAnalytics (inventory.service.ts ~265) unpaged.
- #873: dashboard.service.spec "inventory summary" fails identically on base fix/low-stock-one-voice (1 failed, 9 passed) → pre-existing, not #873. Wave 5: fix stale mock (no threshold_min).

## QA 13a fix round 1 DONE — 2026-11-07 (sonnet-builder)
- #851 @b1bfb9e13 (stale refetch keeps sheet+Arrange, quiet note); #852 @b844e16a9 (Put-it-on-the-sheet held during save; Known gap two-tab LWW in body).
- FORK (correct escalation): apps/web has NO i18n framework (sc-copy.ts:7) → all "Turkish+English" briefs are English-only. WAVE 5 opus-head decision: web i18n / house-language mechanism. Briefs must stop asking for TR strings until then.
- ROUTING lesson 2026-11-07: haiku-runner reported web tsc "0 errors" from a grep count without the exit code (heavy.sh busy prints nothing) → haiku-runner.md rules 5-6 added (exit code beside every count; no self-added steps). Re-running tsc874 inline.
- #874 web tsc VERIFIED rc=0, 0 errors (apps/web/node_modules/.bin/tsc) after linking the missing ROOT node_modules in wt/r13-854. Builder 84 errs + haiku "0" were both env artefacts (no root link → npx fake tsc).

## QA 11b DONE (a3e25d659fb9bff15, verified 2026-11-07 via gh)
- #783 @5ab1d86c2 (revert) → change moved to #857 `fix/lots-are-never-deleted-r11b` @0cbb2a4ae (base fix/lots-are-never-deleted).
- #839 @f689a91a2 (revert) → change moved to #858 `fix/lot-cost-keeps-small-units-r11b` @af6c7813b; QA 14b legacy-page residual done there.
- POS stack: #840 @5d3a861ff → #866 `fix/pos-replay-qa11b` @793ffd729 → #841 @bd4ceae08 (base now fix/pos-replay-qa11b). All DRAFT.
- Items a,b,c,d,f done; (e) BLOCKED on #805.
- Leftover: pgtest scratch databases not cleaned (local only).
- Founder's word: #839 rewrite lock timing on production.

## #849 + #856 verify-mail DONE (a88a04f867e540ba3)
- #849 @53e8b059c: `unconfirmed` no longer says "sent"; revert proof 1 failed|3 passed; tsc rc=0.
- #856 @75100d9ab (merged #849 in at 2628f7a1d): one mailState, newer answer replaces older; note survives reload via existing sessionStorage key; revert proof 5 failed|7 passed; 15/15; tsc rc=0.
- Wave 5: session key not tied to account (stale note if another account signs in same tab); registerRestaurant + invite join drop mail result (OB-6 2/3); no browser check yet; Turkish copy waits on i18n decision.

## QA 15a landed cost (#870 @695a8eb36 → #871 @239153406 → #872 @97a622748) — DISPATCH AFTER a92dc returns
Report: ~/Projects/p4-scratch/sw-walk/qa-report/round15-test-landed-cost.md (+ round15-probes-landed/). Wait reason: a92dc owns #838/#844 heads; merging them now would race it.
Tier: opus-head (money math, round 2). Worktree w4-cost-math-landed-cost-reaches-the-lot.
1. Merge current #838 and #844 heads into #870 (merge commits; never rebase despite QA's wording); fix #871's regression vs #838 (lot must stay repaired at 50/bottle, not 600); case-of-12 proposal posts per bottle.
2. Landed cost must reach lot cost, #845 sale stamp and #864 recipe cost consistently: bottles sold before VERIFIED get re-priced (or explicitly marked provisional), accepted-proposal lots read as known in recipe cost.
3. Largest-remainder cent allocation (sum exact); freight must not vanish on large low-price lines.
4. #872: real retry/repost path after partial failure, or drop the "idempotent retry" claim; spec proving it.
5. Currency guard: an invoice in a non-house currency never becomes a final house-currency cost (fork: refuse vs convert — session's call, record it).
6. Strengthen #871 (5/33 fail without code) and #872 (1/94) so revert proves the change.

## QA 15b (#873 #874 #865) — report round15-pr-retest-stock.md
- #873 + #874 round-2 residuals DISPATCHED to opus-head a00deca09d8ac0a47: beer-without-library-row count 9/7 vs 8/6; getStats/getAlerts 1000-row cap; dashboard spec mock; keyset paging dup; fetchAnalytics unpaged; #873↔#874 conflict on getRestaurantInventory.
- #865 residual → wave 5 i18n lane (opus): model note can still say "Low confidence"; Turkish note inside English page; country "Turkey" not resolved (normalize country names/codes).

## QA 15c (#866 #867 #868 #869) — report round15-test-recipes-auth-misc.md
- #868 WORKS (403 on cross-user link; no takeover/login-CSRF).
- #866 PARTIAL: 2,100 failing lines starve a fresh one → DISPATCHED opus-head af3f73c27544ca270 (per-line cap / park-and-skip; then merge into #841).
- #869 WORKS, 2 mutants survive → DISPATCHED sonnet-builder a0d26239a81ceabda (tests only).
- #867 (recipe gateway, wt w4-recipes-engine-server): out-of-range numbers → 500; 9/17 tenant-filter mutants survive → add negative-tenant tests (opus, tenancy). HELD until wave 4 ends — wave 4 is still running its own audit/fix in that worktree. Same hold for QA 15a landed cost (wave 4 still active in w4-cost-math-landed-cost-reaches-the-lot).
- Not run by QA: decision-claims guard; real concurrent sessions (PGlite single connection).
- #869 DONE @4f127ba7b: 3 specs kill both mutants (no_order_id, dto_no_max); 17/17 rc=0. Gateway tsc rc=1 only from passkeys.service.ts TS2307 '@simplewebauthn/server' — package declared in apps/api-gateway/package.json but absent from the shared main-checkout node_modules (environment, not the PR).

## Per-bottle residuals DONE (a92dc22772863d5ee, verified via gh)
Stack #816 @850b45571 ← #844 @c5fcd8860 ← #837 @f575bc027 ← #838 @927e4046f ← #890 NEW @1eb727fb6 (web cost notice + "Check the cost again") ← #893 NEW @0fed73612 (repair-printed-cost job, dry run unless --apply). All DRAFT, all <30K.
QA 10a items 1-7 + QA 12b D1/C done. Open: D2 fork (20/bottle typed on a case line books 1.67), K (case row stored as "bottle" w/ agreeing total books 264), "eachs" wording, CI not observed, #890 not browser-checked.
FOUNDER'S WORD: run repair-printed-cost --apply on production (tech-debt entry stays OPEN until run/declined).
- QA 15a landed cost DISPATCHED opus-head a87d8136a686153d7 (wave 4 meanwhile added #886 allowance @c14736b9e on #872).
- Wave 4 also opened recipe-sheet stack #887 #888 #889 #891 #892 on #867 → #867 tenant tests stay HELD till wave 4 ends.

## QA 11a/13b/14b auth DONE (a7db365661736f553, heads verified)
- #853 @fb9d56349: one sign-in lookup for every door (typed → normalizeEmail → indexed ASCII fold email_folded); ambiguous = nobody; read error ≠ "no account"; twins/non-ASCII held in sign_in_addresses_held (nothing merged/deleted); tr_TR proved on throwaway PG; 656/656; revert 11 failed. ~84K → split owed.
- #855 @2bbff6971: limits per normalised email (10/min) + peer bucket ×100, IPv6 /64, ::ffff→v4, proxy hops clamped to 1, fail closed; 601/601; revert 12 failed. ~39K → split owed.
- Open lanes (uncommitted in wt/auth-sign-in-doors, pos-hub-roles, integrations-house, auth-invites) + splits + R11-09 (ADR 0229 forks 7 vs 13) → DISPATCHED opus-head adc23405b1070e61a.
FOUNDER'S WORD: run #853 migration on prod + collision/non-ASCII counts; decide each held row; unique index on fold after; measure Railway XFF shape + Vercel egress count; shared limiter store later.

## QA 16 Mail stack #875-#885 (round16-test-mail-{backend,ui,wiring-verify}.md) — HELD until wave 4 ends (wave 4 still fixing mail lanes)
WORKS #877 #879 #880 #884; FIXED #875. Tenant isolation/roles/10k paging held.
Wave 5 mail lane (opus — N-1 is security):
- HARM #885: vendor with only unsent rows (queued/refused/failed first letter) vanishes → pull-back unreachable; 4 gateway messages still say "check the conversation book".
- BLOCKER N-1 sender spoofing: extractEmailAddress at stack head returns forged sales@bigdist.com; fix only in DRAFT #797 → bring #797's extractor into the mail stack (merge #797 into stack base).
- #878: /thread merges two vendors sharing a thread key; order by received time not created_at; M-5 duplicate delivery + bounces count as letters.
- #881-#883: jargon/raw errors ("inbound mail domain", "doors", invalid_grant); failed thread read / failed copy ("Copied") / invented "Letters leave from your mailbox" fallback untested (3/13 mutants survive); "Not connected" shows as "cannot tell yet"; Back leaves /communications; mailbox status stale.
- Founder ask gaps: all conversations present (vendor only; no attachments/HTML); which address — read-only, no "use this one"; how mail arrives — partial; PORTAL (the path that leads a house to set up its mail) MISSING → build.
- QA's "#853 breaks password sign-in" is round-13 stale: fixed at #853 @fb9d56349 (validateUser uses findUserBySignInAddress) — QA to re-test.

## QA 15b #873/#874 round 2 DONE (a00deca09d8ac0a47)
- #873 @7287380f3 (29,989B): counts agree 8/6 on every surface (revert → [9,7]); owns getRestaurantInventory (keyset). #894 NEW @9b0ad4759 on #873: getStats/getAlerts read whole, 503 on failed page; dashboard spec mock fixed. #874 @a67bcbcd9 (29,802B): adopts #873 keyset byte-for-byte, fetchAnalytics paged on inventory_id. Merge order #873 → #894 → #874 (textually clean both orders; suites not run on merged trees).
- WAVE 5 (opus, migration — founder goal "all goods including foods"): v_low_stock_items INNER JOINs master_wine_library, so a house beer/food below par alerts NOWHERE. Widen the view to every good with a non-wine name on inbox/dashboard/MCP. Also: getAlerts "Out of stock" own rule vs inbox; lot rollup + location breakdown still offset-paged (QA-R10B-827); "Below par" chip counts IN_TRANSIT/house-declared.

## QA 17 (#886-#894) — round17-test-recipe-sheet.md, round17-pr-retest-cost-auth.md
- FIXED #886 #894 #855; WORKS #887 #888.
- #853 PARTIAL: joinViaInvite (auth.service.ts ~2903) + members.service.ts ~601 bypass the shared lookup → SENT to auth agent adc23405b1070e61a.
- Recipes: HARM #892 no key={c.id} (draft A saves into B); #889 #891 #892 PARTIAL, 4/25 mutants incl. Turkish-comma save; + #867 (500 on out-of-range, tenant mutants) → DISPATCHED opus-head a03e99b0aeb7a1a4e (wave 4 idle in those worktrees since 08:22).
- #890 #893 PARTIAL: dry-run write-nothing not proven on a real DB; #890 no browser pass → wave 5 cost lane.
- Founder gaps still MISSING: recipe line → good, KPI cards, nutrition/allergens → wave 5 lane.

## QA 15c #866 DONE (af3f73c27544ca270) + split by me
- Fork: failing lines take turns via replay_tried_at stamp (migration 20270501120000, nullable col, no index); 2,100 failing + fresh → fresh books on save 2. Revert 3 failed; pos-hub+toast 411 pass; pgtest PASS/ctl FAIL; claims hold.
- Split for 30K: #866 @8b736b0bb (revert of 529f68ddf, 19.2K) → #904 NEW fix/pos-replay-takes-turns @bfd27bfa7 (re-apply, tree == 529f68ddf, 24.6K) → #841 @bae9649f2 (merge, tree unchanged, 29,979B). Merge order #840 → #866 → #904 → #841.
- DEPLOY ORDER (founder): migration before gateway. Not measured: real queue sizes / index need. Web still doesn't show past_sales.message.

## USAGE RULE (founder 2026-11-07 ~09:40): STOP all work at 70% weekly (all models). Was 56% at the ask. No new launches ≥66%. Check get_usage every wake.

## QA 18 (#895-#903) — round18-test-inventory-drawer.md, round18-pr-retest-auth-mail-hub.md (usage 57%)
- FIXED #897 #903; WORKS #896 #898.
- #901 (concurrent finish moves grant; removed person dead end) + #902 (mobile sign-out no refresh token; reset timing) → SENT to auth agent adc23405b1070e61a.
- Inventory drawer (wave 4 still active in w4-inventory-item-drawer-web → wave 5 inventory lane, opus): #899 "Used in" says unused for EVERY food (recipes not read) → read recipes or say unknown; #900 grams summed into "bottles" breaks top line; foods never reach dashboard/low-stock emails (v_low_stock_items wine join — same as #873 note); 13/28 mutants survive (Close untested); nutrition card inert "Not recorded"; KPI→nutrition missing.
- #895 default thread route still merges two vendors; created_at order; N-1 → wave 5 mail lane.
- Not browser-checked: 375px/RTL/5k timing.

## WAVE 4 DONE (w3q8wizl6, 40 agents, 0 errors) — usage 57%
- reports: #850/#851/#852 sheet stack (fix 02945b16d LOCAL ONLY: wt/w4-reports-sheet-keeps-its-places ahead 1/behind 2, refetch spec untracked, red run never done) · #843 full screen @88079bbd3 (OD-112 guard + Escape stack fixed). Skipped: combo chart, U3 currency, U4 truthful charts, U5/U7, S1-S3 (owned by #722/#725/#730).
- mail: #879 @d4ac8e5ce + #895 @b0302379a (with=vendor) · #884 @96209ddad; #885 not rebased onto it; web doesn't send `with` yet. Skipped L1-L12 (bridge owned by #797/#681).
- inventory: #860 f0ea782f4 / #861 43d501cc0 / #862 db892761c (cost trend now points:null) · drawer #896/#898/#899/#900 (QA 18). Skipped: nutrition I18-I21, I4, I5 (lot-cost-keeps-small-units never opened!), list unit "12.4 kg", RowDropdown retire.
- recipes: #863 dc8363c8b / #864 0aac051b0 / #867 c190bcc22 · sheet 5-stack tip 8a9516880 (#887-#892). Skipped B3 depletion (pos-hub owned by #805/#804), F8 pour-cost (ADR 0359).
- onboarding: #847/#848 APPROVED · #875 @5d4b285e1.
- cost-math: #870→#871→#872→#886 @c14736b9e · #845/#846 APPROVED. Skipped order-path wiring (#787→#821), finalise RPC, tax stamp, glass-pour draws (#809).

## WAVE 5 LAUNCHED w9obhnmoq (wf_25499fe4-0f2) — usage 57% at launch; STOP all at 70%
Lanes (worktrees wt/w5-*): inv-foods-alert-everywhere (opus, migration v_low_stock_items) · inv-drawer-residuals (opus, in place on #899/#900 stack) · inv-nutrition-card (opus, server on main + web on feat/inventory-carry-this) · mail-trust (opus: N-1 via #797, #895 default route, #885, M-5) → then mail-portal (opus, stacked on #885) · reports-combo (sonnet, on #843) · reports-sheet-reconcile (sonnet solo, w4-reports-sheet worktree).
Still queued after wave 5: i18n mechanism decision; recipes B3 depletion on sale (blocked by #805/#804); #865 residuals; reports U3/U4/U5/U7; I5 lot-cost-keeps-small-units (never opened); list unit "12.4 kg"; #874 leftovers.

## Recipes round 17 DONE (a03e99b0aeb7a1a4e) — heads verified by gh, all DRAFT — usage 58%
Stack: #867 @a8f7c671d ← #905 NEW @3a3bf6c08 (400s with words, caps 100k/1k serves, house filter, 28/28 mutants) ← #887 @3304038f4 ← #888 @884dbf323 ← #889 @b20684b0f (revert; #907 tree-equal) ← #907 NEW @52fd0e358 (HARM fixed: key={cocktailId}; set-aside + "Put my lines back") ← #891 @7f5b18972 (revert) ← #910 NEW @a0a9535ec (paste parser, 40-line cap) ← #892 @c8ca7595a.
- #867 own diff 80K (52K is one CLAIMS.jsonl line) — split/shrink owed before merge.
- Open → next recipes lane: D6 unit-mismatch reason, D7 staff warning they can't act on, D8 past-version route + restore, D9 archived goods flag, D10 30px touch targets, D11 WAC vs lot cost (one truth), NBSP label, "30 mll", duplicate lines merge, leave-page unsaved warning; line→good reverse lookup (item → recipe lines) once #863 lands; yield/batches. No browser run.

## QA 19 (#904-#914) — round19-pr-retest-landed.md, round19-pr-retest-recipes-hub.md — usage 60%
- FIXED #905 #907(A→B) #909 #911 #912. 61/80 mutants caught (#904 7/14).
- SENT a87d81: #913 foreign-currency invoice costed as own when house currency unnamed; #845-on-#909 re-rounds to 2dp (one-bottle sale loses freight) → merged-tree spec + order; #908 red spec (cut from old #913) → merge #913 in.
- SENT adc234: HARM #906 per-account bucket = lockout DoS; spoofed XFF ~1000/min. Railway XFF shape = founder's-word.
- SENT a03e99 (resumed): #907 A's typed values lost on switch-back + leave-page warning; #910 "30 mll" guessed.
- QUEUED (no owner): #904 poison lines no retry cap / no visible dead-letter (7/14 mutants); #914 verify note shows for another account / already-verified user (onboarding).

## QA 15a landed cost round 2 + QA 19 (1)(2)(3) DONE (a87d81) — heads verified, all DRAFT — usage 61%
Landed stack: #870 @ae3de1488 → #871 @2b770c5b3 → #872 @d86b8576a → #886 @181767add → #909 @c337c21c9 → #911 @6cb4f2f44 → #912 @7e5d66d53 → #913 @93fc60c48 → #908 @b5368b39f → #933 NEW @0601529c6 (unnamed house currency holds every paper).
Sale stack: #845 → #919 NEW @dd4072f2b (settlement rows for sales before VERIFIED) → #920 NEW @508f3b883 (dry-run backfill) ; #932 NEW @c215dedc9 on #919 (lots/sales keep 6dp — MUST land with #845 whenever #909 is on main, else 200 one-bottle sales 2000.00 vs 2000.98).
Recipe: #917 NEW @34f0bee78 on #864 (agreed lot cost view + agreed_lot_wac basis).
- FOUNDER'S WORD: merge-note comments on #845/#909 — gh pr comment was DENIED to the subagent by the permission classifier; not routed around. Text at scratchpad/note.md (also in #932 body). #920 backfill = founder runs (dry run, then -v apply=1).
- RISK → next cost lane: invoices writing "TL"/"₺" are HELD (not aliased) until intake writes TRY — most Turkish invoices say TL, so intake must normalise TL/₺→TRY at extraction or every TR delivery waits uncosted. Verify extractor output before calling it a bug.
- Open: #917 not wired into analytics.service.ts:150 / advanced-analytics.service.ts:79 / margin-advice; finishProvisional skips all-sold-out items until #919; duplicate verify can overwrite manual revaluation (pre-existing); mock DB ignores .eq; leftover settle_* DBs in fixlane-pg.

## QA 20 (#915-#928) — round20-test-nutrition-combo.md, round20-pr-retest-auth-cost.md — usage 62%
- FIXED #915 #925 (closes reset timing). WORKS #922 #926 (gaps).
- SENT adc234: #916 3/5 new specs red at head.
- SENT a87d81: #919 glass pours + voids don't settle; #920 no test / no lock / dry run burns identity seq; #917 nothing reads the view.
- WAVE 5 in flight (nutrition #922-#927, combo #928) — dispatch fixes AFTER w9obhnmoq ends (same branches): HARM #924 save without `figures` DELETES figures; removed "contains" leaves no trace; every save re-stamps all allergen authors. #927 lookup with no allergen data reads as allergen-free (must warn); no payload cap / rate limit / data date. #923 macros >100 g and kcal≠macros accepted. KPI→nutrition card has NO web code. 6/36 mutants survive. #928 combo chart not reachable from any report → wire + click-path test.

## Recipes QA 19 DONE (a03e99, 2nd pass) — usage at log time below
Stack #907 @b259de34a (revert; tree=52fd0e358) → #937 NEW @7ff480739 (per-person/house/drink in-memory drafts restored + beforeunload + "Throw them away"; 16/16 mutants) → #891 @dd85590b8 → #910 @c46b243b5 (typo units flagged not guessed; "1,000" refused naming both readings; 12/13, 1 equivalent) → #892 @e941995c3.
- Open: unused paste-box text not kept; deleted drink's draft lingers in memory; staff restore untested; duplicate lines not merged; refused paste hides box; 45-line legacy recipe unusable; D6-D11; NBSP; #867 80K; no browser run; CI not watched.

## QA 20 round-2 builders launched (from a87d81 briefs) — 2026-11-07
- a87d81 hand-back: built nothing; wrote briefs A/B/C to the session scratchpad `r20-briefs.md`; its `gh pr comment` was denied (left for the founder, not routed around).
- weekly 62% at launch (cap: 66% for new launches, 70% to stop).
- B (opus-head, a5d3dbf): void negative draws + stamp_lot_draws, new DRAFT stacked on #932. Does NOT re-create record_glass_pour/return_glass_pour. Founder order stays B → #805 → #809.
- A+C (sonnet-builder, a4954ac): #920 locks + SELECT-only dry run + test, in place; C = new DRAFT on #917 wiring inventory_lot_agreed_cost into analytics/advanced-analytics/margin-advice.
- Risks to check on hand-back: the analytics loaders' read-failure path; TL/₺ invoice normalisation stays a separate queued item.
- Still running: wave 5 (w9obhnmoq), auth adc234.

### A+C hand-back (a4954ac) — verified with gh
- #920 @605a994d1 DRAFT (ff from 508f3b883): advisory + SHARE ROW EXCLUSIVE locks, dry run SELECT-only, `scripts/jobs/settle-provisional-draws.test.sh` ALL PASS on fixlane-pg clone; each change reverted → red. NOT in CI (no SQL-test CI job); timing-based lock checks; final-run rc not captured.
- #945 @a5675a2d1 DRAFT on #917, +244/-6: agreed lot cost wired into analytics loadInventory, advanced-analytics loadInventoryWithCost, margin-advice adviseHouse + accept; failures reported (log / logQueryFailure / 500 with no write). jest 4 suites 91/91 rc=0; reverted → 10 failed; tsc only env TS2307; read-errors guard PASS.
- Still unwired (named in PR): inventory.service.ts:185, price-locks.service.ts:234; recipeCost has no non-spec caller.
- check_decision_claims.sh not completed by the agent → I'm running it on wt/r2-recipe-agreed (bb2c9q8ne).
- claims guard on #945 @a5675a2d1: rc=0, 1066 checked, 1066 holding (clean tree).

### B hand-back (a5d3dbf) — #949 verified with gh
- #949 @758e1dce1 DRAFT on #932 (fix/a-sale-keeps-six-places), +485/-0, 29,945 B. Migration 20270520100000_a_void_gives_back_its_cost.
- Call: a matched void's negative draw copies the sale draw's settled cost (not lot-current); stamp_lot_draws stays lot-current for pours/folds. Does NOT redefine record/return_glass_pour → owner contract in tech-debt.d; merge order B(#949) → #809/#805.
- pgtest FIX pass / CONTROL fail; 6 claim mutations red; guards rc=0 except definer guard CANNOT CHECK locally (CI parity decides).
- NOT fixed: glass pours/folds cost on main (needs #809/#805), POS bottle voids (no sale_key until #805), revalue-between-sale-and-void inventory gap, over-draw bottles become new lot.
- CI at check time: 1 SUCCESS, 1 SKIPPED, 2 pending.
- Weekly 64%.

## QA 21 (peer tick, #929-#944) — 2026-11-07, weekly 64%
- Reports: qa-report/round21-pr-retest-inv-cost-chart.md, round21-pr-retest-auth-mail-nutrition.md
- DISPATCHED: #937 REGRESSION (stored 3-decimal qty blocks Save) + draft-key/unmounted-save gaps + survivors u2/u4/d3/d4/d7 → sonnet-builder a6a5113.
- FORWARDED to auth agent adc234 (in scope): #943 new-device lockout + untrusted-peer bucket DoS + m5/m16/m17; #944/#902 mobile+web sign-out sends no refresh token.
- QUEUED (launch after wave 5 ends, only if <66%):
  - #938 macros >100 g / kcal mismatch unchecked (also QA 20 #923); #940 sumRecipe wired nowhere; NutritionForm.tsx:241 draft.notes crash if omitted.
  - #932 residual: settled total drifts sub-cent (123.509997 vs 123.50 over 13 sales); one-bottle sales before verification lose the settled diff (pre-existing too) → opus, on #949's stack.
  - #929 copy: alert/email/dashboard text still says "bottles"/"wines"; never-counted rows with par read low (OD-161).
  - #942 test gaps: 8/14 mutants survive.
  - Mail M-5 duplicate delivery, bounce counted as letter, N-1 sender spoofing (#797 open) still NOT FIXED.
- FIXED per QA: #930 #931 #933 #934 #935 #936 (combo reachable) #941 #944(own claim); WORKS #939 #940.
- Not run by QA: real browser, 375px, mail claims script.

### #937 regression hand-back (a6a5113) — verified
- #937 @54be284e6 DRAFT: stored 3-decimal qty untouched → saves (rowQty/storedQty); typed "1,000" etc still refused; draft cleared on save success even unmounted; endSession forgets drafts. vitest 63/63 rc=0, tsc rc=0; reverted → 6 failed; mutants u2 u4 d3 d4 d7 all killed.
- Side effect: stored 3.3333 now saves as 3.3333 (no longer rounded to 3.333).
- #891 now CONFLICTS (RecipeSheet.tsx) with the new #937 → same agent resumed to merge-commit resolve #891, then cascade #910, #892.
- Weekly 65% → after this resume, no further launches until reset unless the founder says otherwise.
- Cascade done (a6a5113): #891 @818e6e16c (import-block conflict resolved; pasted rows count as typed), #910 @e4410a927, #892 @a6e844838 — vitest 75/91/91 rc=0, tsc rc=0 each. All DRAFT.
- QUEUED: a pasted "1.125 oz" is refused as ambiguous (consistent with rule, but a pasted spec with 3 decimals blocks) — consider treating "N.NNN <unit>" from paste as decimal.

## QA 22 (peer tick, #945-#950) — weekly 65%
- Report: qa-report/round22-pr-retest-mail-settle.md
- DISPATCHED (last launch before 66%): BLOCKER N-1 remainder → opus-head, new DRAFT stacked on #948 (Python _extract_email, prospects.service.ts:73, sender-reputation.service.ts:26, parser fail-closed gaps, SPF/DKIM trust statement).
- QUEUED:
  - #949 primitive not wired to any POS caller (needs #805/#809 per owner contract).
  - #945: two analytics readers still on old cost (see report).
  - #946 vendor-with-only-unsent; #947 conversation-book leftovers.
  - #950 invite acceptance bypasses the fold lookup; one test file does not compile.
- Peer QA loop stops at 70% weekly too.

### Auth hand-back (adc234, DONE) — heads verified with gh
- #953 @e5d23e1b2 DRAFT on #944: new device gets in by emailed code; code sign-in issues device token; 429 copy points to code. m5/m16/m17 specs; gateway jest 1380/1380 rc=0; reverted → red. Web tsc: 2× TS6133 in #944's own AuthContext.signInDevice.test.tsx (unfixed).
- #952 @4a81f17e4 DRAFT on #950: invite doors use the shared lookup (closes QA22 #950 invite bypass). Stack order #853 → #915 → #916 → #931 → #950 → #952.
- #902 @d48d5d2e6 carries mobile sign-out refresh token.
- NOT done: mobile has no emailed-code door; code door's per-address limits spendable by a stranger; refused unknown-device tries spend the general network bucket; #855 split; R11-09/ADR 0362 unbuilt.
- Merge note: #902 with #916 needs R11-04 claim updated to the `user.email` form.
- DISK: Data volume 99% (5.3Gi free after jest --clearCache); sw-walk/wt = 17G across 83 worktrees. Not pruned — running lanes use them.

## QA 23 (peer tick, #951-#953) — weekly 65%
- Report: qa-report/round23-pr-retest-signin-mailtab.md
- RESUMED adc234: (1) claimTeamMemberFromInvite ilike → `_` wildcard lets john_smith claim john.smith's team row → `=` on folded address; (2) HARM #953: code door lockable for the day per address → also budget per device/session + email-fold mutant.
- QUEUED: #951 Mail cache key missing `with` passes all tests (would show one vendor another's thread) → add test; Browser Back leaving /communications; round-16 jargon.
- FIXED per QA: #952 own claim (7/7 mutants); #951 person naming/unsent wording/bounce label.

### adc234 QA-23 hand-back — verified
- #952 @521752c6b: team-row claim exact (`.in` folded+typed spellings, no ilike); stub ilike now real-LIKE; jest 4431/4431 rc=0; reverted → 2 failed.
- #953 @cf9135151: email-fold mutant killed (8/8; mutant → 1 failed). Full gateway jest NOT re-run after this commit.
- NOT built (stopped at 66%): code-door day-lock fix. Call recorded in #953 body: single-use 128-bit sign-in link in each code mail (fragment token, click-to-post, CAS consume, outside the 20/day guess lock). Brief: sw-walk/brief-r23-code-door-link.md → sonnet-builder, stacked DRAFT on #953, AFTER reset or founder word.

### N-1 tail hand-back (abcad03) — verified
- #955 @632d8841d DRAFT on #948 (gateway, 29.2K) + #956 @4b4dcbfbc DRAFT on #955 (Python agent, 17.5K).
- Fail-closed: display-name/comment/group/second mailbox/second From/CRLF/NUL → attributed to nobody, in TS + Python; 60k-header differential fuzz 0 disagreements. Red: jest 15 failed, pytest 34 failed; green jest 1598/1598, pytest 1782 passed; claims 1073/1075 holding.
- Call: NO auth gate yet (A-R header forgeable as read: last header wins, authserv-id ignored, no ARC). Trust statement: attribution trusts From syntax only; plain forged From still files under vendor. Open claim MAIL-ATTRIBUTION-IGNORES-AUTHENTICATION + 5-step fix in tech-debt.d.
- Cost: unquoted `Smith, John <j@x>` no longer attributed.
- NOT done: auth gate; Python thread-id match before sender check (code-read only); real Postmark payload; own-mail skip `from.includes(senderEmail)` in communications.controller; CI not watched.

## QA 24 (peer tick, #954-#956) — weekly 66%
- Report: qa-report/round24-pr-retest-n1-tail.md
- EXCEPTION to the 66% no-launch line (session's call): cross-tenant BLOCKER `From: %@%` read as LIKE → letter stored against another tenant's vendor (gateway + Python). Resumed abcad03 for this ONE item, told to stop at 69%. Reason: cross-tenant leak outranks the 4-point buffer; 70% founder stop still binds.
- QUEUED for after reset (2026-11-13T15:00Z):
  - HARM: dmarc=fail forged From still lands on vendor → record auth result + "unverified sender" in Mail (needs correct A-R handling: receiving-server authserv-id, first header).
  - BUG: From naming nobody drops the letter silently → keep visible as unattributed in Mail.
  - BUG #954: X-Autoreply / X-Autorespond / Precedence: auto_reply not treated as out-of-office (4/29 header cases).
  - Code-door day-lock build (brief-r23-code-door-link.md); #951 Mail cache-key test; #938 macros; #932 sub-cent drift; #929 copy; #942 mutants; #945 two readers; #946/#947 leftovers; #949 POS wiring after #805/#809.
- Hand-back (abcad03): #957 @8aed182e8 DRAFT on #956 — every sender lookup is escaped ilike (`likeExactly`/`like_exactly`: \ % _ *), parsers refuse % and * in the domain. Call: escaped ilike over `=`/.in because providers.contact_email keeps the typed case (unique on lower()). Red jest 15 failed / pytest 13 failed; green jest 1613/1613, pytest 1795 passed; claims 1076 holding; QA-R24-SENDER-LOOKUP-NOT-A-PATTERN mutation-checked. Weekly stayed 66%.
- TOP PRIORITY AFTER RESET: Python `_find_provider_by_email` is NOT house-scoped → two houses with the same vendor address resolve to the first row (cross-tenant). Also: #954's duplicate helper `ilikeExactly`/claim MAIL-SENDER-LOOKUP-IS-EXACT must be unified with #957's when stacks meet.

## QA 25 (peer tick, #957) — weekly 67%, NOT dispatched
- BLOCKER cross-tenant still open: shared sender address files house A's letter under house B (Python lookup unscoped; gateway shared-Gmail publishes no restaurant_id at communications.controller.ts:1291/:1431). Likely already on main → production exposure unverified (never queried).
- Not launched: the fix is a gateway→Python contract change; at 67% with wave 5 still burning it would likely be cut at 70% half-built. Brief ready: sw-walk/brief-r25-sender-house-scope.md → FIRST launch after reset or on founder word.
- Also queued: members.service.ts:601 global ilike; escaped-* comment; 4 untested call sites.

## Check-in 18:05Z
- Stopped stale shells b7kjs0661/b1ko2kawv (0 bytes since 08:17/08:20).
- a92dc22 notification = duplicate of the hand-back logged at line 361; nothing new.
- Wave 5 (w9obhnmoq): only mail-portal lane active (mutation loop bijn3y2ca, 6 dirty files); others idle-clean.
- Weekly 67%: launch nothing new; STOP procedure at 70%.

## QA 26 mail portal #973-#981 (NOT dispatched: weekly 67%, no launches at 66% or above)
- Source: qa-report/round26-test-mail-portal.md
- HARM #977: "Connected" shown on a Mudavym address alone, even when the read failed or reading is off. Fix: show "cannot tell" on a failed read.
- BUG #973: the mailbox is chosen at send time, not at queue time. Fix: pin it when the letter is queued, or say so on screen.
- BUG #974: a second copy of a test letter enters the vendor pipeline, and an out-of-order older test shows "not arrived". Fix: keep tests out of the pipeline and match by test id.
- PARTIAL #979 #980; WORKS #975 #976 #978 #981; 6 of 40 mutants survive.
- Not run: SQL trigger test, real-browser 375px, live data.
- Still absent: a vendor-facing portal, and a line on which address a vendor should use.
- Peer QA loop STOPPED early by choice at 67% (peer correction: 70% was NOT reached).
- Post-reset order: insert after r25 (#977 HARM first), then #973, then #974.

## Wave 5 COMPLETE (w9obhnmoq, 18 agents, 0 errors), verified with gh at 18:2xZ, weekly 68%
- foods-alert: #929 + #930. The audit DEFECT (mixed-unit sort) is fixed by byHowLow, #930 @1726a23ad.
- drawer: #934 @abf2d8299. Audit approved; notes on unpinned wiring mutants.
- nutrition: #927 @3bd3fa64e. ADR-0224 host-guard DEFECT fixed (subprocessor rows).
- mail-trust: #951 @384ab4b06, #954 @9ba621839.
- mail-portal: #973-#981 unchanged; audit fixes in NEW #982 @9b41b9350 (base feat/mail-setup-entry, 21.3K).
- reports-combo: #928 @ea68ae6ec, #935 @496970778, #936 @e98228e4f.
- All are DRAFT. All w5-* worktrees are clean; the mutation loop bijn3y2ca is gone. No agent or workflow is running now.
- QA 26 items (#977 HARM, #973, #974) stand on top of #982 for after the reset.

## PAUSED (holding)
- Weekly use has read 68% on every check. The /goal stop hook keeps repeating "goal not met"; that is not founder input.
- Stay paused: no launches until the founder says so or the 2026-11-13T15:00Z reset. First up after that: r25 cross-tenant fix, then QA 26 #977.

## RESUMED (weekly 68%)
- The 66% no-launch buffer was my own invention; the founder's line is 70%. Memory corrected.
- Launched: r25 cross-tenant house-scope fix (opus-head, background). It stacks DRAFT PRs on #957.
- Next, while under 70%: QA 26 #977, then #973, then #974. Check get_usage on every wake; at 70%, run the STOP procedure.
- r25 DONE (DRAFT): #983 6404a2a00, #984 f2fc02b06 on #983, #985 bed3a9562 on #984 (63.5K, mostly claim JSON), #986 f8da38e85, #987 2c2ed6d22 on #986. Bases checked with gh.
  - Merge order: #984 must land before or with #985/#987.
  - Found, not fixed:
    - EmailParsingAgent uses self.db, which is never set (dead in prod).
    - EmailIntelAgent unknown-sender check never fires.
    - MAIL-ATTRIBUTION gateway claim lost its end anchor.
  - Not run: real PostgREST/Gmail. Pre-merge: check provider_email_cross_tenant.
  - Item 7 (unify with #954 ilikeExactly) deferred.
- Launched QA 26 fixes (opus-head, weekly 68%): #977 status line, #973 pinning plus colleague grant, #974 test-letter repeats/older/spoof/M5/whitespace, then the #976/#980 minors if there is room. Stacked on #982.
- QA 26 DONE (DRAFT, verified with gh): a stacked chain on #982.
  - #988 9a8a404d1 (#977 status line on evidence)
  - #989 8cff8274c (#973 queued letter keeps its mailbox)
  - #990 f1ae9a850 (#973 only the connector may choose)
  - #991 0a074ceb3 (#974, all 5 items)
  - #992 723935c61 (#976 empty body refused, #980 own failure words)
  - Not done: browser checks; real Postgres; #980 defects 1, 2, 4; M11 warning when the choice read fails; letters queued before #989 are not pinned.
- Weekly 69%. Next is a small sonnet lane: #980 defects 1, 2, 4 + M11.
- #993 ec17e5e9d DRAFT on #992 (#980 1/2/4 + M11). Not run: a browser check. Weekly 69%.
- Launched the QA 24 leftovers (opus-head, weekly 69%): letters naming no vendor must not be dropped, the DMARC-fail marker, X-Autoreply, and the postmaster regex on the parsed address.
- QA 24 leftovers DONE (all DRAFT, verified with gh):
  - #994 0e1578962 on #985: held-letter row.
  - #995 69ba60ed2 on #994: a letter naming nobody is held, not dropped.
  - #996 4be3b63e6 on #995: gateway holds an unconfirmed sender (topmost mx.google.com Authentication-Results).
  - #997 98451e99b on #987: same hold in Python.
  - #998 25e450084 on #954: X-Autoreply now counts as automatic; mailer-daemon/postmaster read from the parsed address (migration 20270610100100).
  - Owed at merge: whoever merges the second of #996/#997 rewrites the MAIL-ATTRIBUTION-IGNORES-AUTHENTICATION verify and resolves it.
  - Not verified: real Gmail headers, check_migration_ledger (no DB URL).
  - Left over: pgtest DBs qa24n954* in the fixlane-pg container.

## STOPPED: weekly 70% (founder rule)
- Nothing running: every agent has finished and no workflow is live. All worktrees are clean and pushed.
- New this stretch, all DRAFT: #983-#987 (r25 cross-tenant), #988-#993 (QA 26 + #980), #994-#998 (QA 24).
- No work until the 2026-11-13T15:00Z reset or the founder's word.
- First up after that:
  1. r23 code-door build;
  2. Below par IN_TRANSIT chip + gateway readers;
  3. browser checks of the mail stacks;
  4. #951/#938/#932 and the rest of the queue.

## RESUMED 2026-11-11 (weekly 74%): founder override, "Resume now"
- The 70% stop is lifted for this week (the founder's pick in answer to a question). No cap was set.
- Launching: (1) r23 code-door link (opus-head, brief-r23); (2) Below par IN_TRANSIT chip + gateway readers (opus-head).
- (3) owed mail-agent fixes (EmailParsingAgent self.db, EmailIntelAgent unknown-sender, MAIL-ATTRIBUTION anchor) on #997 (opus-head).
- r23 DONE: #999 e1a92fa36 DRAFT on #953 (29.1K). Not run: real browser/mail; web tsc has 2 TS6133 from #944 (untouched file); mobile has no code door.
- Launched: nutrition #938/#940/NutritionForm (sonnet-builder, wt/nutrition-macros-check); #932 sub-cent settle drift (opus-head, wt/settle-exact-cents).
- Below par DONE: #1000 5971464fb DRAFT on #894 (29.7K); deletes TS canRunLow copy, view is the one answer. Open: ask-readings/reading-runner.ts:79-80 + cellar useCellarNextData.ts:1395 still count stock<=min. Not run: browser, real PG.
- Owed mail fixes DONE: #1001 a22271e79 DRAFT on #997 (29.9K). EmailParsingAgent made a no-op (bridge files letters); unknown-sender notice fixed (From, house-scoped); MAIL-ATTRIBUTION = owed-at-merge claim, stays open. Filed not fixed: re-publish double filing, promo dedupe. Black already fails #997 email_parsing_agent.py. Agent rm -rf scratch dirs were in this session scratchpad only (not worktrees) — harmless.
- Launched: #945 two cost readers (opus-head, wt/cost-readers-agree); #929 copy + OD-161 never-counted (sonnet-builder, wt/goods-say-their-name).
- Nutrition DONE: #1002 c683494d6 DRAFT on #940 (feat/goods-know-what-is-in-them-recipe-sum). Macros>100g refused, kcal 4/4/9 warning, sumRecipe wired, notes crash fixed. FORK→ cocktail lines are free text, no link to stocked goods → every line 'unknown'. Gateway #923 doesn't enforce rules.
- Launched: cocktail lines ↔ stocked goods (opus-head research+build, wt/drink-lines-*): line picker, 'used in drinks', gateway nutrition read + macro rule enforcement.
- Below par last readers DONE: #1005 ed0837256 DRAFT on #1000 (28K). /ask reading + cellar tile/filter read the view; tile relabelled 'Below their own par'. Leftover: MCP empty-list note wording; lib/supabase.ts:311 (likely dead) at-or-under.
- Settle drift DONE: #1004 3a9f6d0d3 DRAFT on #949 (26.9K), migration 20270615100000: settlement numeric(16,6), no carry (root: round(qty*cost,2) vs 6-place cost). Edited #949's claim regex (CREATE VIEW only). Open: #920 job still rounds to cents; CI runs no SQL tests.
- #929 copy DONE: #1003 7ae54b5c7 DRAFT on #930 (~30.2K). OD-161 decided (null last_counted_at → 'not counted yet') — no ADR yet. Left: summary totalBottles + 'N bottles on hand' Lately line; par-0 uncounted silent.
- #945 readers DONE: #1007 e689e1aed DRAFT on #945 (27.4K). Inventory list shows no cost for provisional. Left: client '?? 0' cost readers (web, mobile), per-location wac, >1000-row paging.
- #942 mutants DONE: #1006 5ce167800 DRAFT on #942 (test-only, 19 re-derived mutants killed). Claims guard re-run by me on committed tree rc=0 (1070).
- #947 leftovers DONE: #1009 9e52b3ac0 DRAFT on #947; /communications section h2 "Conversation book"→"Mail" (COMMS-W36 updated). Claims re-run rc=0 (1073).
- OD-161 ADR DONE: #1010 37496e6b1 DRAFT on #1003 — ADR 0362, OD-161 struck; totalBottles/Lately say own unit. 35.5K (over 30K wall; ~22K is 2 single-line register/CLAIMS rewrites) → gate may need split.
- Weekly 90% (reset 2026-11-13T15:00Z). No cap set by founder, but a new lane now would likely be cut half-built at 100%: holding new launches until cocktail lane + '?? 0' readers finish. Next if room: #946 dedupe edges, #920 cents job, mail-stack browser checks.
- '?? 0' readers DONE: #1011 30303e1a4 DRAFT on #1007 (29.7K) web+mobile unknown cost reads unknown. Not run: browser/simulator; mobile spec source-only.
- Cocktail↔goods DONE (no migration; recipe_lines.inventory_id exists since #863):
  - #1013 98b8d07e3 on #927: gateway enforces macro rules (>100 g refuse, 4/4/9+7 warn).
  - #1012 d5289be7b on #892: per-serve drink nutrition summed on gateway beside recipe-cost.ts. Needs #922 at merge.
  - #1008 5ee4ffa9e on #1002: drawer "used in these drinks" (current version). Needs #863.
  - FINDING: #1002's sumRecipe hunk is dead (attaches to free-text box #892 deletes) → drop at stack meet.
  - Not run: real DB/pgtest, browser; web form doesn't show gateway warnings yet.
- Weekly 92%: launched #946 dedupe edges (opus-head, wt/mail-dedupe-edges), one lane at a time from here.
- #946 edges DONE: #1014 7000f9d46 DRAFT on #998 (23.4K), migration 20270620100000. Brackets merged, DISCARDED copy can't win, postmaster@ vendor kept, X-Failed-Recipients bounce. 20270421143700 never on main. Not run: full gateway jest, write-side message_id normalisation/backfill.

## HOLD: weekly 96% (2026-11-11), reset 2026-11-13T15:00Z
- No new lanes: any lane now would be cut half-built at 100%. All this stretch's PRs are DRAFT and verified with gh: #999-#1014.
- Next after reset:
  1. #920 job still rounds to cents (#1004 follow-up);
  2. browser checks of mail stacks #973-#1014;
  3. web form shows the gateway nutrition warnings (#1013);
  4. drop #1002's dead sumRecipe hunk when stacks meet;
  5. #949 POS wiring after #805/#809;
  6. "1.125 oz" paste;
  7. MCP empty-list note wording, lib/supabase.ts:311;
  8. write-side message_id normalisation.
- 96%: no cap was set, so self-hold lifted; launched small sonnet lane: web form shows gateway nutrition warnings (on #1013, wt/nutrition-form-says-server).
- Nutrition form DONE: #1015 1f83eb703 DRAFT on #1002 (7.5K), shows gateway refusal/warnings; mocks #1013 contract (98b8d07e3). Revert rc lost to a pipe (2/11 failure lines seen).
- Weekly 98% (2026-11-11): quota effectively exhausted; nothing running, all lanes pushed. Resume at 2026-11-13T15:00Z reset from the HOLD list above (#1015 done = item 3).
- RESUMED 2026-11-11 on founder 'continue'; weekly now 6% (plan Ultra). Working the HOLD list.
- #1016 b42beb6f2 DRAFT on #920: settle job prices from revaluation's exact cost at the column's scale; new 11/11 on #920+#1004 bases, old 5 FAIL each. HOLD item 1 DONE.
- #1017 DRAFT on #1005: MCP note/catalogue say below par (spec pins, revert 2 fail); dead lib/supabase helpers deleted + stale guard allowlist entry. HOLD item 7 DONE.
- Lanes running (2026-11-11 resume): opus local-stack.sh (separate local Supabase stack + gateway + web, never prod) for browser checks; opus mail message_id one shape (on #1014); sonnet recipe amount reads by unit ("1.125 oz", on #1012).
- #949 POS wiring still blocked: #805, #809 OPEN draft. #1002 dead hunk waits for stacks to meet.
- #1018 baca686b3 DRAFT on #1012: recipe amount reads by unit (1.125 oz decimal; ml/g/each refused); vitest 86/86, revert 3 FAIL, tsc 0. HOLD item 6 DONE. No browser.
- 2026-11-11 founder rule: build whole software, then batch review. Workflow wmgdahmii (run wf_84811888-1a0): 8 lanes (menu, receipts, cost-math, onboarding, reports, mail, recipes, inventory) build → batch review → fix. Reports: sw-walk/<sw>/BUILD-2026-11-11.md.
- local-stack.sh DONE (p4-scratch/local-stack.sh + .md): separate Supabase CLI stack mudavym-localcheck, gw :4410 web :3410, egress fenced, seeded Local Check House; proven on main + #993. Browser checks run in batch after the workflow lanes finish.
- 2026-11-11 mail message_id one shape: #1031 (gw, base fix/mail-dedupe-edges) + #1032 (orchestrator + migration 20270625100000, stacked on #1031), both DRAFT. <id> bracketed shape; revert proofs 18/18. Left open: Python _send_message invents <wineops-ts> ids (provider_conversation_agent.py:3615), bridge threads only on gmail_thread_id, References lacks parent id, stale bare in_reply_to drafts, parser lookups not restaurant-scoped. Post-deploy: SELECT * FROM public.mail_message_ids_canonicalise(); once.

## 2026-11-11 whole-software workflow wf_84811888-1a0 (build → batch review → fix)
- inventory: #1021-#1024 (stack on #1008); review 7 findings, fix round done. Left: dish recipes/foods "used in dishes" (recipe_versions.owner_kind cocktail-only), menu line deep links, count-a-shelf port, #1002 dead sumRecipe hunk.
- recipes: #1026-#1028+ (on #1018); review 2 findings, fixed. Left: agreed cost via #917 stack, B3 depletion (#805/#804), ABV per serve.
- cost-math: #1025 #1034 #1035 #1036; review 4 findings; FIX FAILED (ENOTFOUND) → rerun in wf_3c55d120-4fd.
- receipts: #1039-#1044 (e-Fatura UBL/XML readers, no silent drop, attachment once); 7 findings, 7 fixed. Left: golden corpus (paid run), self-issued e-invoice direction, XAdES, intake gate 2.1/2.5-2.7.
- mail: #1045-#1050 (G2 intake record first, Gmail push reader, webhook secret header/basic auth); review incl. 1 BLOCKER, fixed. Left: G4 house_mail store for strangers, G6 retention, IntakeHealthSheet UI, thread paging.
- reports: #1019 #1020 #1033 #1037 #1038 #1051 #1052; 3 findings (1 BLOCKER export spec), fixed. Left: G19 period comparison, G16 tooltip clip, Wine360 UTC days, recommendations '$'.
- menu + onboarding builds FAILED (ENOTFOUND) → rerun in wf_3c55d120-4fd (menu resumes unpushed 4f9772d6f / bf874286a).
- Nothing browser-checked yet; batch browser checks on local-stack next.
- 2026-11-11 browser check /reports on local-stack (tip cabd44eb4, empty seed house): 9/9 cuttings open full screen and close on Esc; 19 swap/draw-as selects cycled with 0 console errors; no idle polling (0 req/15s); keyboard arrange works at 1440px. BUG: at ≤800px (4-col grid) a 7-wide cutting can't be moved by keyboard ("did not move"). Env fix: tailwindcss-animate linked at wt/node_modules. Agent dispatched: seed-reports.sql + full chart matrix at 3 widths + fix narrow arrange → reports/BROWSER-2026-11-11.md.
- reports browser agent: #1057 narrow ruling (e9ac1e006) / #1058 narrow order (4efe1d7c4) / #1059 chart labels (66bc760dd), stacked on fix/reports-till-a-year, DRAFT. Fixed 7 (narrow keyboard arrange, phone drag shrinking desktop, Up/Down never moved, phone column order, tablet order save/Esc, identical clipped labels, week chart dropping days). Open: goals insight '0% of the way' ignores direction (gateway computeGoalsFamily), 'Show the working' prints internal names, forecast '9.599 bottles', sidebar not folding on live shrink. Seed: local-stack/seed-reports.sql. Report reports/BROWSER-2026-11-11.md.
- browser walk inventory+recipes (local integration wt/inv-browser, unpushed): #1070 drawer reads right / #1071 totals by measure / #1072 cellar bottles are bottles (3,456→149) / #1073 small grams 2dp; all DRAFT. MERGE ORDER: #1013 stack + recipe stack before #1008; #934 #858 needed. Mail + receipts NOT browser-checked (agent stopped at 65% thinking the 70% stop applied — it is lifted this week).
- 2026-11-11 rerun wf_3c55d120-4fd DONE:
  - cost-math fix round: #1025 e9dbcf9db (window-scoped settlements; settled_on_earlier_sales reported apart), #1034 5a4798fd5 (costOfCostedItems N of M, feeds no ratio), #1035 38591cbbe (goal refusal names missing input), #1036 3a66f1a10 (cellar note scoped). cogs stays withheld for houses with voids/glass until #805/#809.
  - menu: #1053 #1054 #1060-#1069 (background read, one upload = one version, scan buttons reach the reader, old scanner + scanMenuImage removed, dessert-wine). Review 10 findings, 8 fixed, #1064/#1065 refuted. Over 30K: #1061 35.7K, #1067/#1068 deletion-only. Left: re-upload plan 2d, N+1 make-current 2e, retire act, gold set.
  - onboarding: #1055 (OB-7 place fills the house, zoneForPlace; on #847), #1056 (verify note per account; on #875). Review 2 defects fixed. Left: OB-1 activated = current menu (menus.service.ts:2201), OB-11 Register.tsx 429/check-email/confirm field, OB-4 attribution table, OB-9.
  - Not browser-checked: menu, onboarding, cost-math page. Mail + receipts browser walk running.
- 2026-11-11 browser walk mail+receipts (integration worktrees mail-walk-integ, receipts-walk-integ, unpushed): mail #1074 (arrival sheet words, bounce-only thread, intake health shown; on #1050) #1075 (houseHealth exact counts, no 1000-row cut; on #1049). receipts #1076 (VKN resolves vendor) #1077 (line ItemChooser — first pairing was impossible) #1078 (reader warnings + e-invoice provenance shown) #1079 (case line pack size), all on #1044, DRAFT. Open: D6 Letters vs Mail reply counts, D7 house with no zone counts Today in UTC, R7 lot cost ignores pack (delivery-stock.service.ts ~746 unitCost = line.unit_price, verified on origin/main) → fix agent, R8 KGM uom, R10 unverified-deliveries strip not seeded. Merge-order notes in mail/ and receipts/BROWSER-2026-11-11.md.
- R7 (case price as bottle cost) LIVE on main = QUEUE BLOCKER 1, fixed by open stack #816→#844→#837→#838 / #870…#933 (perBottleLotCost). New: #1081 (on #933) six places on every line→lot path, keeps toCentsAsBooked repair; #1080 (on #1079) sheet says 'per case of 6', UBL unmapped unit kept so #837 refuses KGM. Both DRAFT. MERGE: #933 stack before receipts #1079/#1080 for case lines to cost right.

## 2026-11-11 late — browser walk: menu, onboarding, cost-math on /reports (agent a630ed87)
All DRAFT, verified with gh. Stack down (no containers, 4410/3410 free).
- #1082 fix/onboarding-maps-off-has-no-search-box @759b85df1 <- #1055
- #1083 fix/onboarding-verified-account-gets-no-new-code @0eee844a8 <- #1056
- #1084 fix/onboarding-first-proof-keeps-its-places @fdeaa66d3 <- #848
- #1085 fix/menu-kitchen-line-is-not-carried @f0bca3b3d <- #1069
- #1086 fix/menu-versions-say-it-in-house-words @c408042c3 <- #1068
- #1087 fix/a-verified-invoice-settles-sold-bottles @69d6000b3 <- #1004 (migration 20270725100000; /orders verify now settles sold bottles at six places; prod backfill count UNMEASURED — read-only query in PR body)
- #1088 fix/days-of-stock-stays-with-sales @15d5de17b <- #1036 (staff no longer read till-derived goal values; ledger rounding)
Cost math on /reports matched hand math (sold/cost/kept, N-of-M, late-price note, turns/days/GMROI).
Merge order: #1087 vs #1025-#1036 conflicts only in scripts/sql_outside_migrations.txt (keep both); re-check migration version at merge. #1088 before #722, then rebase #722. #776 before menu chain.
Not checked: /orders verify button in browser (SQL V1-V7 + jest only); real POS; export download; mobile widths on /reports (emulation unreliable).
OPEN (new): days-of-stock compares whole-cellar value vs only till-mapped cost (unmapped wine inflates it) — needs a call; owners see stale stored goal value when live read refused; "cost cost" in #1036 note; /reports 1528px in 1440 window (unconfirmed); CLAIMS row ADR-0298-GATEWAY-READS-THE-TILL stale on #1036.
Still open from earlier walks: 429 on /auth/me → /login; invited members 404 on /onboarding/progress; "set ANTHROPIC_API_KEY" copy; kitchen line creates library row; "Wine List" heading lists Tiramisu; goals insight "0% of the way" (#722 lane).

## 2026-11-12 — open-items round r2 (workflow wf_e9612ae1-d14): build → batch review → fix, all DRAFT
- reports: #1113-#1117 stack on #1088, #1118 (sheet width) on #1088, #1119 (goal scorer + read-stamp migration 20270728100000, merged into #1113). Goals feed direction-aware ("0% of the way" gone); days of stock on till-reached stock; refused readings show no stale value; "cost cost" fixed; CLAIMS 1069/1069 PASS. #722 can be closed by founder. BLOCKED: `gh pr edit 1113 --base fix/reports-goal-scorer-and-read-stamp` denied by permission classifier → founder runs it. Left: loadInventory no paging >1000 rows (analytics.service.ts:139); goal reads last-writer-wins.
- onboarding: #1089-#1091 (progress is the house's, invited staff land cleanly), #1111 (merge with #1089), #1092 (429 keeps the session, on main), #1095 (no page names the model key), #1104/#1106/#1107 (register). OB-4 not built (OD-251 open); OB-9 waits on #656/#847/#848/#1055. Stale branch fix/onboarding-progress-reads-the-house superseded.
- menu: #1098-#1102 (kitchen line makes no library row, current menu sets kitchen apart, 2d plan says what's not on file, 2e one-go write-back RPC migration 20270727140000, batched make-current), #1103/#1105 (unique read labels, cellar asks about no dish). MU-12 retire act not built; prod dish rows in wine library not cleaned (needs reviewed pass).
- mail+receipts: #1093/#1094 (D6 one count source, D7 zone), #1096/#1097 (R10 strip shows door deliveries), #1108-#1110 (R8 KGM books by weight, on #933 stack), #1112 (verify says sold bottles settled, on #1087). Left: UBL KGM→kg map on #1080 stack; no l→ml conversion; no kg picker in web.
- NOT browser-checked this round (one local stack, held by reports lane): onboarding, menu, D6/D7/R8/R10. Next: sequential browser walk.

## 2026-11-12 — r2 browser walk (local stack only), stack down after
- Onboarding: #1089 #1090 #1091 #1092 #1095 #1106 #1107 #1111 PASS; #1104 fixed (d5a9edddf, ea7bd0d32, 34cfbe972).
- Menu: #1099-#1103 PASS (2e RPC proven on real PostgREST); #1098 fixed 548b236ae (merged up #1099-#1102), #1105 fixed 100d7eeb4; NEW #1120 fix/menu-chosen-menu-says-it-is-current (base #1105).
- Mail+receipts: #1093 #1094 #1108-#1110 PASS; #1096/#1097 vendor named (ab9bb8f1a/c79d612ea); #1112 billed-vs-agreed toast fixed 858025c5c; NEW #1121 fix/door-same-item-lines-add-up (base #1110) — two lines of one item in one door count replaced each other since #333 (bottles too); bottlesMoved no longer adds grams.
- Found, not fixed: /inventory bottles total counts grams (covered by #934/#1022/inventory-totals PR); landed-cost text calls grams bottles; legacy verify prints $ for TRY; "Waiting on you" means two things (Letters vs Mail, from #587); House Red/White unattributed on /wines; register wordmark clipped at 375px; Settings shows ANALYTICS.CONTROLLER.TS label.
- Not checked: photo/PDF menu read (no model key), real e-Fatura KGM, #1121 retry paths in browser, staff/manager views beyond onboarding, real mail.
- STILL FOUNDER ACTION: gh pr edit 1113 --base fix/reports-goal-scorer-and-read-stamp; close #722.

## 2026-11-12 — r3 round (wf_33c478c8-e6f), all DRAFT, stack down
- reports: #1131/#1132 (every analytics reader reads past 1,000 rows, whole-or-refuse; live 1510 SKUs), #1133 (newest goal reading wins, compare-and-set), #1134/#1135 (no page prints file names / ADR numbers / readBy; guard test no-page-names-a-source-file). Left: #945 should adopt readByIds on rebase; #1135 conflicts with mail stack #955-#1075; purchase_spend counts uncosted order as $0; dev-truth pos_checks still 1,000-capped.
- receipts: #1126 (landed cost says the item's unit), #1127 (verify money in invoice currency), #1128 (house counter counts door deliveries), #1129 (UBL KGM/GRM by weight; merge after #1080+#1110, then retarget), #1130 (no raw model-key text). Left: mobile invoiceMatch.ts still '$'; old notes rows keep raw text; vendor-intel/inbound responder model-key text.
- polish: #1122 (one meaning for "Waiting on you"), #1123 (house wine is the house's), #1124 (register wordmark fits 375), #1125 (menu sentences sit with their read). getWineById not house-scoped (noted).
- SUSPECTED BUG (untraced): on local stack the dashboard fired thousands of requests in seconds → /auth/me 429 → /settings full load landed on /login.
- Not browser-checked: r3 Settings words, #1125, receipts items.

## 2026-11-12 — storm trace + r3 browser check (agent a85e0282)
- Storm root cause: RateLimitGuard puts every /auth/ path in the 10/min bucket keyed IP+route; each load read /auth/me 3× (dev) → 4th load in a minute 429 → /login. **#1136** DRAFT fix/session-reads-are-not-sign-in-attempts@1e6777245 <- main (session reads to default bucket; meAtBoot.ts shares one read). Report: storm/REPORT-2026-11-12.md.
- r3 browser: PASS #1122 #1123 #1124 #1128 #1125(+#776 local) ; #1134/#1135 pass after debfeb85f ; #1130 failed (5xx sentence masked "not switched on") → fixed 4f51f3042, pass.
- New DRAFT: #1137 fix/cellar-stock-in-house-words@53b3b0245, #1138 fix/recommendations-unfiled-in-house-words@28d3cb63e (both <- #1135).
- NOT seen on screen: #1126, #1127 (need order→count→invoice→verify seed), non-wine cellar cards, mobile, prod-bundle counts.
- Left: refresh/switch-restaurant still 10/min; /receiving "≥$0" for TRY house; seal row "12 bottle"; /reports Show-the-working table names; Currency settings reason "system_audit_log is unreachable"; seed-mail/receipts/inventory reference columns not on main.
- Local unpushed branches: local/pol-integ, local/rc3-integ, local/menu-integ, local/r3-words-verify. Stack down (verified).

## 2026-11-12 — r4 round (wf_ba4490ed-395), all DRAFT
- recipes: #1139 alcohol per serve, #1140 drink nutrition card, #1141 drink opens on its KPI cards, #1142 "2 dashes", #1143 cocktail list ≠ menu (<- main), #1160 ?open= link reopens (fix round). Merge #1141 with #1160. Report recipes/BUILD-2026-11-12-r4.md.
- readers: #1144 uncosted order not $0, #1145 till checks read whole, #1146/#1147 cost readers readByIds, #1148 refresh not a sign-in attempt (<- #1136).
- inventory: #1149 getWineById house-scoped, #1150 kg/litre goods, #1151/#1152 days-of-stock from real use + drawer.
- words: #1153/#1154 receiving money in house currency, #1155 counter plural, #1156 reports working in house words, #1157 settings trail wording, #1158 mobile invoice currency, #1159 model-off wording.
- No browser check this round (one local stack, held by inventory lane). Each lane report's "left" list holds what is still open.
- STOP 2026-11-12: founder said stop this project until told otherwise. Everything pushed; notes on branch docs/sw-walk-notes-2026-11-12.
