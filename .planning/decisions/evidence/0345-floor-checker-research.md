# Floor Checker research record — evidence for ADRs 0345–0347

Two research workflows run on 2026-10-30 (session ca58311b), copied here verbatim from their
judged outputs because the session scratchpad does not survive a reboot. **This is the
research, not the decision**: what the founder ruled is in [ADR 0345](../0345-floor-checker-is-ported-into-mudavym.md);
where a ruling differs from a recommendation below, the ruling wins.

**Citations below are as the research agents recorded them and were not re-verified for
this file.** The agents did not all read the same tree (the local checkout was 161 commits
behind `origin/main` when the first one started), so a `path:line` here can be stale. The ADRs
re-check every citation they rely on at `origin/main` 9914f5cbf.

## 1. Architecture — workflow wf_c6c2a59b-b8b (3 advocates, 3 adversaries, 1 judge)

### Winner

Option 1, PORT INTO MUDAVYM. Floor Checker becomes a native in-SPA Mudavym software: /floor manager board, /floor/builder, a chrome-free waiter screen at /floor/me, a NestJS floor module and new migrations on Mudavym's Supabase. The plan must be re-derived against origin/main (eb6ddc2a9), not the stale checkout at 059169a59. Grafted from the losers: a framework-free floor-core package that both the gateway and web import; a pos_server_links identity table; role-gated realtime; a single-runner, idempotent nudge scheduler; and freezing the checker's uncommitted spec before porting. The floor.mudavym.com alias and an Expo waiter screen are kept as founder forks, not built by default.

### Rationale

Spot-checks I made at origin/main. The local main is 161 commits behind origin/main eb6ddc2a9 (`git rev-list --count HEAD..origin/main` = 161). Every citation in the three cases that points at the local tree is therefore stale.

Why the port wins:

(1) ADR 0001 names Floor Checker as a software inside the one entity (0001-mudavym-single-entity.md:31, keyword floor-checker at :15). The start-fresh ruling removes the only reason to keep the checker's second database.

(2) The analytics engine must consume floor data, which is only cheap in the same database. The insight generator already loads restaurant_tables with hidden_at (origin/main insight-generator.service.ts:903) and filters hidden tables (:1469). INSIGHT_GENERATOR_VERSION is 12 (:254), so new measures need a version bump.

(3) Role-gated realtime already exists. origin/main websocket.gateway.ts:39-43 says owner/manager-only content goes through emitToHouseRoles to memberRoom rooms (:50, :663-684), never to restaurant:<id>. That fixes Option 1's leak: per-name lateness and scores must not reach staff sockets.

Why Option 3 dies. The refutation's fatal flaw is real. The checker profile has one restaurant_id per auth user (checker 0001_init.sql:35-37, 144-152), while Mudavym is many-houses-per-person. Two-way table sync across two databases sits under every floor analytic. Its 'survives a gateway outage' benefit is undone by its own PRs.

Why Option 2 loses:
- Its distinctive benefits are partly false. notification_push_devices has only user_id, endpoint and subscription, with no app or origin column (origin/main 20260925160500:96-120). A second service worker therefore gets every back-office push and the main app gets every floor push, unless a schema change is made.
- localStorage sessions are per-origin, so a subdomain needs a second sign-in or a new token-handoff auth surface.
- WS CORS lacks the origin.
- The ADR 0149 design layer lives in apps/web/src/components/mudavym and would need a risky extraction.
- Blast-radius isolation is small, because the gateway carries all floor logic either way.
- An in-SPA route can still get its own install identity: a second manifest scoped to /floor/ on the same origin needs no new auth, no new service worker and no extraction.

Option 1 survives its refutation, but only once these are fixed:
- ADR 0303 (Proposed status, 0303:3). The founder's pick says 'No drawing' (0303:3, :24, :62). Tables are learned from the till with seats NULL (0303:16, :36). Hidden tables are 'out of every table figure and ranking, insights included' (0303:60). The checker's FloorBuilder hand-adds and positions tables, which collides with this. That is a genuine founder fork, not something to default.
- DASH-G6 (0257:79, :146). The founder already anticipated that 'floor coverage software' saves each waiter's stats and lets waiters see table invoices, and that the W22 staff-money line is redrawn then. The redraw is anticipated, but its exact shape is open.
- The service-floor charter's explicit non-goal, 'this team does not produce staff performance scores, rankings, or disciplinary evidence' (service-floor-charter.md, origin/main, the 'Staff performance management — nobody, deliberately' row and the paragraph after it). It must be superseded in writing per the EVERYTHING ruling, or the PR gate overturns on prose.
- ADR 0027 is still 'Status: Proposed' (0027:3), though the task treats it as locked. No push_subscriptions table is created either way.

Not verified by me: the checker-side line counts and file:line claims (I took them from the cases), Railway replica count, Vercel DNS ownership, and ADR 0294/0272 content beyond their titles in the ADR listing.

### Rejected

- **SUBDOMAIN SEPARATE APP: keep the checker's Next.js app and Supabase, add SSO and outbox-to-HMAC ingest** — Fatal on identity. The checker profile is one-house-per-auth-user (checker 0001_init.sql:35-37, 144-152), but Mudavym users belong to many houses and can switch, so 'checker user id = Mudavym user_id' cannot hold. It also needs a two-way table-layout sync across two Postgres projects under every floor analytic, and ADR 0303 makes Mudavym's till-learned restaurant_tables the record. Its own PRs undo its two benefits: auth, push, nudges and tables all route through the gateway, and reports, Food-up, reskin and auth all get rewritten anyway. The separation of storage and auth becomes permanent, against ADR 0001's 'then unified', and start-fresh removes the reason to keep the second DB.
- **SUBDOMAIN ON MUDAVYM BACKEND: a second Vite app at apps/floor on floor.mudavym.com** — It survives, but loses on cost against benefit. Its 'own push scope' is false: notification_push_devices has no app or origin discriminator (origin/main 20260925160500:96-120) and sendWebPush fans out per user, so alerts cross between both service workers. Sessions are per-origin localStorage, so it needs a second sign-in or a new token-handoff auth surface that would need its own security ADR. WS CORS does not allow the origin. ADR 0149 would force extracting the whole apps/web/src/components/mudavym design layer. Deploy isolation is small, since the floor still dies with a bad gateway deploy. That is roughly 3-4 extra PRs plus a security ADR for benefits an in-SPA route gets mostly for free: an install identity via a second manifest scoped to /floor/, and a light bundle via route-level code splitting.

### Ideas grafted from the losing options

- From Option 2: a framework-free packages/floor-core workspace package holding the checker's pure modules (freshness, attribution, response-time, waiter-score, meal-alert, floor-merge, merge-orientation, adjacency, heat, visit-leave). The gateway (nudges, reports, analytics) and the web board both import ONE implementation, so the score shown on screen and the score in insights cannot disagree. This is the 'two numbers for one waiter' risk from Option 3.
- From Option 2: a dedicated pos_server_links(restaurant_id, source, server_external_id, server_name_norm, member_id/user_id, confirmed_by, confirmed_at) table instead of a jsonb column on team_members. Links are proposed automatically (name match, plus the ≥50% seated-time attribution overlap) and a manager confirms them. Unlinked rows say 'unlinked' and never fabricate a person (ADR 0020). It must apply the same 'words that are not names' care that ADR 0303 applied to till table words.
- From Option 2's subdomain idea, kept but reduced: the waiter screen gets its own install identity through a second web manifest with scope '/floor/' and start_url '/floor/me' on the SAME origin, so there is no new auth, CORS or service worker. A real floor.mudavym.com alias (a host rewrite like the SimPOS precedent) stays a founder fork, because a different origin means a second sign-in.
- From the Option 1 refutation: every owner/manager-only floor event (per-name lateness, scores, rankings, other waiters' tables) goes through emitToHouseRoles/memberRoom (origin/main websocket.gateway.ts:39-43, :663-684). restaurant:<id> carries only staff-safe facts, such as table state and a table's own freshness.
- From the Option 2/3 refutations: the per-minute SLA nudge scanner gets a single-runner guard (a Postgres advisory lock or a lease row) and an idempotency key per (seating, threshold) in a nudge_events table. A second Railway replica must not double-push. The missing socket.io Redis adapter is stated as a known one-replica limit.
- From Option 3: harden and freeze the checker source FIRST. Snapshot or commit its untracked Food-up work (0018_meal_run_alerts.sql, meal-actions.ts, meal-alert.ts, MealRun*), because that is part of the spec. Also adopt its 'reconciliation check' instinct as an absent-not-zero spec plus a floor-vs-POS coverage figure on the board.
- From Option 3: map roles explicitly, owner/manager to checker manager and staff to checker waiter. No new role is added. A per-table assignment check is enforced server-side.

### Build plan as the judge proposed it (amended by the software note)

**PR0: re-baseline the integration study at origin/main** — Docs only. Rewrite the scratchpad study's file:line pointers against eb6ddc2a9 (insight-generator :254/:903/:1469, websocket :39-50/:663-684, 2026-12 shift/wage migrations, 20261222230000 tables_learned_from_the_pos, 20261223150000 check channel). Snapshot the checker repo's working tree, including untracked Food-up files, to a dated tag or tarball so the spec is frozen.

*Verification:* Each cited line is reproduced with `git show origin/main:<path> | sed -n`. The checker snapshot is a hash recorded in the doc. Nothing is merged.

**PR1: ADRs and register (no code)** — ADR 'Floor Checker is a Mudavym software, ported in-SPA', number taken from the guard. ADR 'Per-waiter score, rankings and CSV ship', which supersedes the service-floor charter's non-goal row and paragraph and the premortem's 'not by name' lines, with in-place bracketed pointers in those files. ADR 'Floor realtime is role-gated'. File OD rows for every fork in open_forks_for_founder. The README row goes in its own PR (memory: README row append is gate-released). CLAIMS rows: no push_subscriptions table exists in supabase/migrations, and floor emits of per-name data never target restaurant:.

*Verification:* check_decision_claims.sh passes, and each new claim exits non-zero on a mutated copy (memory: checks cannot see their own removal). The OD/ADR number guards are green.

**PR2: packages/floor-core (pure logic)** — Port freshness, attribution (≥50% seated rule), response-time, waiter-score, meal-alert, floor-merge, merge-orientation, adjacency, heat and visit-leave verbatim, with no React and no DB. Jest specs import the real code, replacing the checker's copied-logic test scripts. Turbo/workspace wiring.

*Verification:* Unit specs are green, and fixture parity runs against the checker's own scripts/test-*.mjs cases. tsc --noEmit across the package.

**PR3: migration 'a floor has seatings, visits and assignments'** — New tables floor_seatings, floor_visits (append-only, soft-delete), floor_table_assignments (table, member/user, valid_from/until), floor_settings (warn/late minutes, setup_complete). FKs go to public.users(user_id), never auth.users, and to restaurant_tables. Every row is restaurant_id-scoped, with RLS on and grants to service_role only. Hidden and retired tables are allowed but carry no new seats default (ADR 0303). The version is assigned at merge, past origin/main's newest (ADR 0212/0235).

*Verification:* supabase/tests SQL file run through the pgtest.sh harness (fix vs control db): RLS denies anon/authenticated, FKs reject auth.users ids. The migration-uniqueness guard is green.

**PR4: migration 'tables merge and split'** — floor_table_merges plus floor_table_merge_members. Port the checker's 0006 split/active trigger and the 0015 recursion fix, rewritten for service_role-only access (no is_manager()/current_restaurant_id()).

*Verification:* SQL tests for merge, split, re-merge and the recursion case, plus a spec in floor-core floor-merge.

**PR5: migration 'a shift is punched' plus 'food is up'** — shift_punches (actual in/out against shifts.id and team_members.id, nullable shift_id), fitted to origin/main's 2026-12 invariants: wage records, recorded_break_min, shifts surviving removal, split and reassign. meal_runs (ready, ack, served) ported from checker 0018. Punches are NOT read by wage or payroll code until a founder fork says so.

*Verification:* SQL tests covering one open punch per person per house, punches surviving a leaver, and split-shift behaviour. A grep claim that wage/payroll services do not read shift_punches.

**PR6: migration and gateway 'a POS name is a person'** — The pos_server_links table, a resolver used at POS import, and a manager confirm/unlink endpoint with @Roles('owner','manager'). It does not rewrite past checks' raw words, and it applies an ADR 0303-style 'not every word is a name' rule.

*Verification:* Gateway jest plus `tsc --noEmit -p tsconfig.spec.json`. SQL tests. An absent-not-zero spec: an unlinked server stays a string entity marked unlinked.

**PR7: gateway FloorModule, manager read model and settings** — GET floor board (tables incl. learned, hidden excluded, freshness, assignments, merges, punches), SLA settings, staff assignment and section assignment. JwtAuthGuard + TenantGuard + @Roles('owner','manager'). Every write goes to system_audit_log. Builder table-position endpoints wait on the ADR 0303 fork.

*Verification:* Jest specs for role refusals (staff gets 403), foreign house (404), and audit row written. scripts/check_route_exposure.py is green (ADR 0096). tsc against tsconfig.spec.json.

**PR8: gateway FloorModule, waiter acts and realtime** — Check-in tap, seat, leave, take over (handoff credit), claim/release and clock in/out, with @Roles('owner','manager','staff') plus a server-side assignment or caretaker check per table. Emits: staff-safe floor:table state to restaurant:<id>; per-name and late or score payloads via emitToHouseRoles; personal nudges to user:<id>. Clients refetch the read model on reconnect.

*Verification:* Jest: staff cannot act on a table they do not hold; spy on emitted rooms to prove no per-name payload reaches restaurant:. A two-socket integration spec (staff socket vs manager socket).

**PR9: nudges and Food-up push** — A @nestjs/schedule per-minute scanner behind an advisory-lock single runner, with nudge_events keyed on (seating, threshold) for idempotency. It sends NotificationsService.sendWebPush(userId) to the assigned waiter (ADR 0027 user-id recipients) and logs quiet-hours skips (founder 2026-10-11). POST meal-runs pushes the meal-alert brief to the covering waiter, with ack. sw.js push routing gets /floor deep links via safeActionPath.

*Verification:* Jest with fake timers: one push per threshold even when two scanner instances run, and stale endpoints are pruned. A claim that no push_subscriptions table exists. Manual web-push receipt is verified in the Browser pane on a sim house.

**PR10: web /floor manager board** — Mudavym design (ADR 0149), behind PageGate and a new feature-flag-registry key (dark). socket.io-client live updates. Loading, failed and empty states kept apart (ADR 0067). Hidden tables are absent, with a count of what was left out (ADR 0303 F2). vercel.json crawl rewrite list updated.

*Verification:* vitest component specs; Browser-pane screenshots at desktop and 375px on a sim house; prod bundle grep after merge (memory: prod deploy verification).

**PR11: web /floor/me waiter phone screen** — A full-screen route outside DashboardLayout on the door-route pattern (origin/main App.tsx door route). It shows my tables with idle/fresh/warn/late, one-tap check-in, seat/leave, merge sheet, Food-up inbox, clock in/out and push opt-in. A second manifest is scoped to /floor/ with start_url /floor/me, and the route is code-split so the waiter does not download the back office. **[2026-10-31: staff-invite gate. No waiter is invited to this screen until PR #701 and the follow-up after #617 that withholds the remaining figures have both merged (ADR 0345 pick 14).]**

*Verification:* Browser pane in the mobile preset: one-handed flows, the installed-manifest link present, and the push opt-in writing a notification_push_devices row. Vitest for the state chips, driven by floor-core.

**PR12: web /floor/builder (scope set by the ADR 0303 fork)** — Per the founder's answer: either position-only editing of till-learned tables (x_pos/y_pos, sections, merges) with no table creation, or hand-add allowed with the ADR 0303 twin-table guard (the name-uniqueness 409 and till_words/former_labels lookup). Sections use whichever store the sections fork picks.

*Verification:* Specs: no twin table is created when the till later sends the same word, and a hidden table never appears on the board. Browser-pane drag and position checks.

**PR13: reports, score, rankings and CSV** — Real per-waiter score, rankings, shift report, waiter detail and CSV, computed from floor rows via floor-core (replacing the checker's REPORTS_MOCK_ONLY). Reconciled with ADR 0294's team performance card (one figure, one unit, one owner). Rankings are printed only when the data can tell waiters apart (ADR 0272). Hidden tables are excluded. Owner/manager see everyone; staff visibility per the W22 fork.

*Verification:* Specs for ADR 0272 ties (no rank printed when indistinguishable), hidden-table exclusion, and the staff role seeing only what the W22 answer allows. CSV golden file.

**PR14: analytics consumes floor** — DataRequirement 'floor', with availability added only when rows exist. Measures visit_gap_min, late_visit_rate, warn_visit_rate, first_visit_response_min, coverage_pct, seatings_per_shift, dwell_min and food_up_wait_min, plus joined measures needing ['floor','checks'] (tip/revenue by visit band, table turn via seating×check overlap). Waiter entities are keyed by linked member, falling back to the string marked unlinked. Hidden tables are excluded. Keys are distinct from the existing checkin_density. INSIGHT_GENERATOR_VERSION goes 12→13 with insight-cache-version.spec.

*Verification:* insight-catalog/reach specs; an absent-not-zero spec (a house with no floor rows computes no floor candidate); a hidden-table exclusion spec; a cache-version spec.

**PR15: dark launch, then one house** — Flip the flag for ALDEMIR plus the sim houses, run a sim service through the scenario harness, then the one real house on the founder's keystroke (ADR 0131 as amended by 0149).

*Verification:* Prod deploy is FLOOR ⪯ running ⪯ tip(main). Browser-pane walk of the manager and waiter flows on prod. The founder flips the flag himself.

**PR16: retire the checker** — Tombstone doc listing the checker repo, Vercel project floor-coverage and its cron, and Supabase project aatljtckuqzvsttdoxjk, with recovery pointers. Each pause or removal is the founder's keystroke. No data migration.

*Verification:* The tombstone index lists each removed resource and its recovery path. No Mudavym code references the checker's hosts (grep claim).

### ADRs the judge said were needed

- NEW: 'Floor Checker is a Mudavym software, ported in-SPA'. It records the founder rulings (everything, start fresh, Food-up, analytics consumes floor), the role map, the reuse map, and why both subdomain options were rejected.
- NEW, superseding text: 'Per-waiter score, rankings and CSV ship'. It supersedes the service-floor charter's 'Staff performance management — nobody, deliberately' row and its non-goal paragraph (origin/main service-floor-charter.md), plus the premortem's per-name lines, with bracketed in-place pointers. It must state how ADR 0272 (ranking only when distinguishable) and ADR 0294 (team performance card units) bind the new surface.
- AMEND ADR 0257 W22 / DASH-G6 (0257:79, :146): the staff-money line is redrawn now that floor coverage runs. That covers what a waiter sees of their own stats, others' stats, and table invoices, per the founder's answer.
- AMEND or supersede ADR 0303 (tables learned from the POS, 'No drawing'), per the builder fork: whether the floor builder may position or group learned tables and whether it may hand-add any.
- NEW: 'Floor realtime is role-gated'. Per-name floor payloads go via emitToHouseRoles/memberRoom only. A single gateway replica is a stated limit until a socket.io adapter exists.
- NEW: 'A shift is punched'. shift_punches versus planned shifts, and whether punches feed wage or payroll records (2026-12 wage migrations).
- NEW: 'A POS name is a person'. pos_server_links, confirmation by a manager, and the not-every-word-is-a-name rule.
- NEW: 'Floor nudges run once per house per minute'. The single-runner lock, idempotency keys, quiet-hours logging (founder 2026-10-11), and Food-up recipients.
- NEW or amend ADR 0218: whether checker sections are house_areas kind 'floor' (coupling floor alerts to area leads) or a separate floor_sections grouping.
- LOCK ADR 0027 (still 'Status: Proposed' at 0027:3), or record that the plan relies only on its no-push_subscriptions consequence.

### Forks the judge left for the founder (rulings: ADR 0345)

- ADR 0303 vs the builder. Your 'No drawing' ruling (0303:3) and till-learned tables conflict with the checker's FloorBuilder. Paths: (a) the builder only positions, groups and merges tables the till taught, and adds none (cheapest, no twin-table risk); (b) also allow hand-adding tables with no number, like 'Bar' (ADR 0303 already owes an 'addtable' lane), guarded against twins; (c) full checker builder, which reopens the twin-table problem you closed. Recommend (a)+(b).
- W22 / DASH-G6 (0257:146). What a waiter sees: (a) their own score and their own tables' invoices only; (b) also the house ranking with names; (c) nothing until a later rollout. Recommend (a). Peer rankings visible to staff are the exact 'management stick' the charter warned about.
- Who sees rankings and CSV: owner+manager only (recommended), or also area leads under ADR 0218.
- Sections. (a) Reuse house_areas kind 'floor', so floor alerts follow area leads and away-dates; (b) a separate floor_sections table that only groups tables. Recommend (b) unless you want lateness to page the area lead.
- Waiter screen home. (a) Web /floor/me with its own /floor/ manifest (recommended: no new auth, one codebase); (b) a floor.mudavym.com alias (second sign-in, or a new handoff-token auth surface that needs a security ADR); (c) inside the Expo apps/mobile staff app (native push, a third build to keep in step).
- Do clock-in punches feed wage and payroll records (2026-12 wage migrations), or stay floor-only service data? Recommend floor-only first.
- Food-up trigger. Who may raise a meal run: manager only, any staff (the pass or a runner), or a later kitchen-ready POS event (not available in CanonicalCheck today).
- Whether to lock ADR 0027 (still Proposed) as part of this work.

### Not covered by the plan

- No data migration from the checker's Supabase (ruled out by the founder). Checker history is lost at retirement.
- The apps/mobile Expo app is not touched unless the waiter-screen fork picks it.
- A socket.io Redis adapter and multi-replica gateway scaling. The plan states the one-replica limit and guards only the nudge cron.
- Kitchen-ready POS events. Food-up stays a manual tap; vendor signals belong to Partnerships per the charter.
- HR, disciplinary or payroll use of floor data, and wage computation from punches.
- ADR 0260 W10f's Jev/outside-mail note tied to floor coverage. It is flagged here but not scoped.
- Insight-generator residuals outside floor measures, for example the ridge driver zero-fill. ADR 0303 says these were amended, and I did not re-verify them.
- The CI review key: it returned 401 on 2026-10-29 and worked again on 2026-10-31, when CI reviewed PR #701 and it merged as `e7ef31145`. No floor PR depends on a local review instead.
- Not verified by me in this pass: checker line counts and checker file:line claims (taken from the advocate cases), the content of ADR 0294/0272 beyond their titles, Railway replica count, mudavym.com DNS ownership, and iOS install/push behaviour of a second same-origin manifest.

## 2. Mudavym-only features — workflow wf_3808bfdb-c92 (4 finders, 4 adversaries, 1 ranker)

The founder picked all fourteen ranked items on 2026-10-30 (ADR 0345 §Rulings).

### 1. Lock the money figures away from waiters before they get accounts

Right now any staff login can read every waiter's sales and tips, and the live spend at each table, through three report links. Close these before waiters sign in to the floor phone, or the 'no figures for waiters' rule is broken on day one.

- *uses:* The analytics routes GET table-performance (analytics.controller.ts:684), GET waiters (:702) and GET hot-tables (:729), plus the unguarded POST tables (ADR 0303:104). It reuses the existing @Roles('owner','manager') pattern already on PATCH tables (analytics.controller.ts:645-651).
- *cost:* S
- *depends on:* Nothing. It must land before PR11 invites staff. I did not re-check that the only web caller of /analytics/waiters is the manager-side /reports register (rp-registers-house.tsx:511, per the adversary). **[2026-10-31, overtaken: the fix is its own PR, #701 (DRAFT, `ad8454425`, not merged), not part of PR7. The founder picked *"Your pick now, rest after #617 (Recommended)"*, so #701 gates only GET table-performance, waiters and hot-tables and POST tables, and the other staff-readable figures are withheld by a follow-up after #617 merges. No waiter is invited until both have merged (ADR 0345 pick 14).]**
- *attaches to:* PR7, alongside its staff-gets-403 specs. File an OD first.
- *evidence:* Verified at eb6ddc2a9: the class guard is only @UseGuards(JwtAuthGuard) (analytics.controller.ts:117). An awk over :680-:745 finds @Get at :684, :702, :719 and :729 with no @Roles. The global TenantGuard (app.module.ts:187-188) reads no role: grep 'role' in common/tenant/tenant.guard.ts returns nothing. Four adversaries raised this independently (pos #4, analytics #1 and #6, ops #6). This is a rescued residue, not a feature.

### 2. Paid: a guest who stays on after paying never counts against the waiter

The waiter taps 'Paid', or, where a till feed exists, the till's closed check does it. The table then stops nagging, and the manager sees 'paid 12 min ago' to spot slow turnovers.

- *uses:* The checker's own unbuilt design for this. A new paid state on floor_seatings. On the till side it uses pos_checks.closed_at and table_id from the pos-hub upsert (pos-hub.service.ts:1064-1093) and a new emit from pos-hub (it has none today). The word-only state goes to restaurant:<id>; the lag minutes go only through emitToHouseRoles (websocket.gateway.ts:663).
- *cost:* S for the tap; add M for the till hook
- *depends on:* The tap needs only PR3 and PR8. The till hook needs a feed that sends a closed check with a table word. Today only sim houses do, through the scenario harness: SimPOS is not loaded in production (app.module.ts:116) **[at 9914f5cbf the conditional is `app.module.ts:117`; `:114-116` is its comment]** and the real tills are not live (OD-64). The hook also needs: the builder to map UUID-labelled sim tables (item 5), a time-window guard so a CSV backfill cannot flip a live seating, voided checks left out, a one-tap undo for split bills, and auto-leave off by default.
- *attaches to:* PR3 (the state in the seating enum), PR8 (the tap), PR9 (the scanner skips paid seatings). The till hook is a follow-up PR after PR12.
- *evidence:* Verified: the checker designs 'Mark paid' (checker/EDGE_CASES.md:18), but its enum is only ('seated','left') (checker 0001_init.sql:12). pos-hub has no websocket or emit (grep over pos-hub/*.ts: no match). SimPOS is dev/demo only (app.module.ts:113-116) **[the conditional is `:117`]**. This merges pos #1 (survived) with the manual Paid residue that survived from ops #1.

### 3. Food-up and late-table alerts always reach someone working, then go up to a manager

If a table's waiter is off shift, on break or unassigned, the Food-up or late alert goes to whoever is covering, then to a manager who is working. It no longer fails or buzzes everyone, and the manager sees who it reached and why.

- *uses:* A floor-only fallback chain built on the ladder rules in area-routing.ts:10-33. It does not call AreaRoutingService.route, which is keyed to an area. It also uses awayUserIds (area-routing.service.ts:168-173), the Away and quiet-hours split in audienceFor (producer-ledger.service.ts:192-216), NotificationsService.sendWebPush, and emitToHouseRoles for the 'who was skipped' detail.
- *cost:* M
- *depends on:* PR5 (who is clocked in), PR8 (assignments) and PR9 (the scanner). Waiters must be invited and opted in to push; the adversary counted 0 notification_push_devices rows in prod, which I did not re-query. It must not use house_areas as sections, because the founder picked floor_sections; an area-lead step would be a fork to re-ask. The timing of the second step is a founder fork.
- *attaches to:* PR9
- *evidence:* Verified the ladder text at area-routing.ts:10-33. Step 0 sends to everyone when a house has no areas, which is why reusing route() would be louder than the checker. The checker's Food-up refuses when no waiter is assigned and is managers-only (checker app/meal-actions.ts:136, :182-186, per the adversary). This merges team #6 (survived) with the floor-only escalation salvaged from ops #4.

### 4. A no-show becomes a cover in one tap, and a forgotten clock-out is flagged

When someone's shift has started and they have not clocked in, the manager sees it with Call out and Offer cover buttons that run /team's existing flow. At close, 'still clocked in, no floor tap since 23:10' is flagged without guessing a time. Cover offers also reach the waiter's phone through web push, not only the app.

- *uses:* The pure plan windows in shift-window.ts:68, :79 and :126. The existing callout, offer-cover and assign routes (team.controller.ts:271, :281, :291). ScheduleService reportCallout (:885-966) and offerCover (:970-1008), plus NotificationsService.sendWebPush added beside Expo.
- *cost:* S to S/M
- *depends on:* PR5 (punches) and PR9 (the scanner). The no-show half needs a published plan; the adversary counted 2 shifts in prod, so it stays mostly idle until houses schedule in Mudavym. The forgotten-clock-out half needs no plan. Store a 'no-show' reason rather than reusing 'Call-out', since today's callout notice goes to the whole house. Wait a grace period before flagging, because punches are honour-system.
- *attaches to:* PR8 and PR9 for the floor side. The offerCover web-push fix goes in a small /team PR.
- *evidence:* Verified: offerCover pushes only through ExpoPushService (schedule.service.ts:59, :995-1007), and its reply counts user ids rather than deliveries. roster.ts:12-16 says there is no clock-in table. A grep of supabase/migrations for shift_punches or clock_in finds nothing. This merges ops #3 (survived), the web-push leg rescued from team #2, and the floor-only residue from pos #7.

### 5. The builder starts from what the till already knows

Tables the till taught Mudavym wait in a tray to be named, placed and sectioned. A word like 'Bar' or 'Window' can be made into a table once, and its old checks link to it. Placing the kitchen and the bar on the plan fills the distance figures the room analytics already read.

- *uses:* From restaurant_tables: x_pos, y_pos, zone, distance_to_kitchen_m and distance_to_bar_m (baseline:5169-5181). Also learned_at, hidden_at, till_words and former_labels, with the re-link triggers (20261222230000:126-151, :418-465). PATCH /analytics/tables is owner/manager with a 409 guard against twin tables (analytics.controller.ts:645-651). The distance correlations and ridge weights are in table-analytics.service.ts:428-431 and :490-528.
- *cost:* M to M/L
- *depends on:* Founder forks. (1) Amend ADR 0303's 'No drawing' (0303:24). (2) Where 'Add a table' lives: he chose Settings → Point of sale (0303:65), so build it in both places or ask. (3) Seats: he rejected a seats field (0303:67), but checker tables have seats and he ruled 'ship everything checker has'. Build work: a new write to map a till word to an existing table, a migration for 'not a table', and a replacement for the unguarded POST tables, which writes seats 2 (table-analytics.service.ts:59). Add a one-step scale so canvas units are not stored as metres. Distance insights need at least 4-5 tables with 3 or more linked checks each.
- *attaches to:* PR12, with its endpoints in PR7
- *evidence:* Verified: the columns at baseline:5169-5181; ADR 0303 is still Proposed (0303:3); 'No drawing' (:24); Add-a-table in Settings (:65); seats rejected (:67); POST tables unguarded (:104). Correction to the pos adversary: Tuzlu's CSV import already carries t1-t24 (0303:15), so its tray is not empty. I did not settle whether Tuzlu is the real house or the sim generator (0303:11). This merges pos #6 and ops #5.

### 6. Out tonight: what not to sell, on the waiter's phone

The waiter phone shows a short 'Out' list: anything a staff member marks out, plus drinks the cellar shows as run dry, with 'Back' when an item returns. Nobody promises a bottle that isn't there.

- *uses:* menu_items.inventory_item_id (baseline:3797), the current menu lines (active menus only), inventory_lots qty and open_bottle_ml, a new table for manual marks, and a floor event with no figures.
- *cost:* M, plus S for the lot rule and the column list
- *depends on:* A new ADR, and a founder fork on who may mark an item out (the Food-up ruling does not cover it). The automatic 'Out' must mean 'had a lot, now has none and no open bottle', not stock_live = 0. A menu import inserts inventory rows with no stock and stock_live defaults to 0, so every uncounted wine would read Out falsely. The existing stock:low event carries quantities, so the phone needs its own word-only event.
- *attaches to:* A new PR after PR11 (not in the verdict's plan)
- *evidence:* Verified: menus.service.ts:1936-1950 inserts restaurant_inventory with no stock; dashboard.service.ts:632 counts stock_live 0 as out; no 86 or out-tonight code exists in apps (grep: no match). Ops #2 survived with the narrowed definition of Out.

### 7. On break: tables pass to the cover and come back

The waiter taps 'On break', and their tables and alerts go to the cover until they tap 'Back'. The manager can record the break on the shift with one tap.

- *uses:* Floor assignments (new), item 3's routing, the shift's recorded break through a manager tap, tm-format's breakCounted and breakUnderMinimum, and WeekGrid's compliance lens.
- *cost:* M
- *depends on:* It must share item 3's routing rule, or the cost rises; it also needs PR8 assignments. The floor writes neither shift_breaks nor recorded_break_min, because both re-price labour cost (schedule.service.ts:805-830, and tm-format.ts:237-248 reads shift_breaks when no break is recorded; both per the adversary). The 'preset from the planned break cover' idea is dropped, since nothing writes shift_breaks.
- *attaches to:* PR8, with routing in PR9
- *evidence:* Verified: no gateway code inserts or upserts shift_breaks (grep: no match). The checker's handoff is a permanent take-over (checker lib/response-time.ts:7, per the adversary). Team #5 survived with its floor half.

### 8. Seating timeline: seated, first visit, paid, left

The manager's shift report splits each turn into time to greet, time to pay, and time from paying to leaving, by section. That shows where table time is lost.

- *uses:* floor-core, item 2's paid moment (from the tap, so it works without a till), and pos_checks.closed_at where a check is linked.
- *cost:* S
- *depends on:* Item 2. Drop 'check opened = time to order', because opened_at means different things on different feeds (SimPOS pre-creates a blank check). Unknown phases show a dash, never a zero (ADR 0051).
- *attaches to:* PR13 (report) and PR14 (measures), built as one floor-core function
- *evidence:* pos_checks has opened_at and closed_at (baseline:4192-4209, per the adversary). The checker reports only dwell and turns (checker lib/reports-types.ts:33-41). Pos #5 survived, narrowed.

### 9. Floor trends and to-dos in Recommendations

The manager gets items like 'Section B ran late on 6 of the last 9 Friday dinners: split it or add a runner' in Recommendations, with snooze, done and assign. They come from the floor's own taps, so no till is needed.

- *uses:* The insight catalog's DataRequirement union (insight-catalog.ts:32-39), the implementations guard (insight-implementations.ts:43-50), INSIGHT_GENERATOR_VERSION (insight-generator.service.ts:254), recommendation statuses and assignment, the existing 'floor' stake in rec-format.ts:163-173, the digest cron and the hourly sweep.
- *cost:* M
- *depends on:* PR14's floor rows, plus some weeks of data. Same-weekday comparisons stay silent at first and must say so. Per-section series are new work and need a correction across sections (ADR 0272). The 'on-time visit rate' goal metric is a founder fork: turning a self-reported tap into a target invites gaming (premortem M2).
- *attaches to:* PR14, with the rules in recommendations
- *evidence:* Analytics #4 survived without the goal metric. The adversary verified the catalog, version and status citations at eb6ddc2a9; I did not re-read them.

### 10. Reassignment proposal that the manager applies

When a waiter leaves mid-service, calls out or has several late tables, the board proposes who takes which tables (same section, lightest load). The manager taps Apply, and nothing moves without that tap.

- *uses:* A deterministic floor-core function, the shift plan windows (shift-window.ts:79), and floor assignments.
- *cost:* M
- *depends on:* PR2, PR5 and PR8. For now, load is measured by seated tables per waiter; weighting by till takings is blocked until a feed exists. It stays on the floor board: the House Counter would mean widening ask-ai's ACTION_FAMILIES (ask-ai-actions.ts:31-32), which is a recorded decision.
- *attaches to:* PR2 (the function), PR10 (the board card) and PR8 (the apply act)
- *evidence:* The checker only releases tables on clock-out (checker EDGE_CASES.md:43). Orchestrator agents are stubs (shrinkage_detective_agent.py:12-16, per the adversary). Ops #8 survived in its smaller form.

### 11. Goal notices name who was actually working

When a house goal is hit, the notice names the people clocked in at that moment, and keeps 'on the schedule' for anyone who forgot to punch.

- *uses:* rosterAt and ROSTER_SOURCE, plus GoalReachedProducer (goal-reached.producer.ts:151) and CeilingHeldProducer (ceiling-held.producer.ts:175). The audience does not change.
- *cost:* S
- *depends on:* PR5, and the founder's word, because this changes a sentence he asked for. The plan fallback must also pass through onTheRoster. Near-term value is small: the adversary counted 1 active goal.
- *attaches to:* Its own small PR after PR5
- *evidence:* Verified: roster.ts:12-16 ('no clock-in table') and :75-76 (ROSTER_SOURCE = the published schedule). Team #8 survived. This also absorbs the side benefit claimed by ops #3.

### 12. Till-against-floor mismatch check

After service the manager sees 'the till closed a check at T12 while the floor showed it empty' and 'a party left with no check linked', plus how many seatings the till backs up. It is a check on the honour system.

- *uses:* pos_checks table_id and closed_at, with the re-link triggers (20261222230000:418-465), and the channel column, so booth and event checks are left out (20261223150000:61-78).
- *cost:* M to L
- *depends on:* A till feed with table words, which today means sim houses only (OD-64), and item 5's mapping. Matching happens at close only. A seating added after the fact is left out of the score and the SLA. The grace period follows how fresh the feed is (imported_at). The floor must exclude booth checks itself. The wording is 'no linked check', never 'walk-out'. Report it by section or shift, not by waiter, until PR1's score ADR.
- *attaches to:* PR10 (the grafted coverage figure) and PR13 (shift report)
- *evidence:* The checker defers this to its Phase 2 (checker EDGE_CASES.md:20, :51). Pos #3 survived, narrowed; part (c) is already in the verdict.

### 13. Punched hours beside planned hours on /team

One Clock in button works the same from the floor phone and from My Shifts. Managers see the punched times next to the planned shift in the /team week.

- *uses:* shift_punches (PR5) keyed to shifts.id, WeekGrid lenses (WeekGrid.tsx:66, :163-190), the staff route to MyShiftsNext (TeamNext.tsx:287-290), and the /team history trail over system_audit_log.
- *cost:* L
- *depends on:* PR5, and an amendment to ADR 0215, whose labour-page plan describes an attendance sheet 'without a clock' (0215:1229-1243). Keep the 45-hour review on planned hours until fork #6 (do punches feed wages?) is answered. Also: the departure and purge rules must be extended, and text HH:MM plan times must be mapped with the house clock and daylight saving. A 'clocked in late' record by name needs PR1's superseding ADR. It is mostly idle today (the adversary counted 2 shifts).
- *attaches to:* PR5 (the shared punch row), PR11 (the control) and a /team follow-up PR
- *evidence:* Verified: shifts are a plan with no actual times (roster.ts:12-16; grep of supabase/migrations for shift_punches or clock_in: none). Team #1 survived; the adversary raised the cost from M to L.

### 14. Unread manager notes at clock-in

Right after clocking in, the phone shows any unread manager notes addressed to that waiter.

- *uses:* team_notes and team_note_recipients.opened_at, NotesService.markOpened, and the notes routes (team.controller.ts:776-806).
- *cost:* S+
- *depends on:* The phone needs a read shaped for staff, because GET notes returns recipients and receipts to a staff recipient (notes.service.ts:187-208, per the adversary). Sending needs an option without the WhatsApp/SMS crew text (notes.service.ts:255-261). A true per-night line-up would be a new record and a founder fork. Weekly notes would show a Monday '86 the lamb' all week.
- *attaches to:* PR11
- *evidence:* Verified: My Shifts already shows the week's notes and an open tap to staff (MyShiftsNext.tsx:88-99, :216-231), so the value is small; this only puts them at the moment of clock-in. Verified that note creation adds WhatsApp/SMS channels whenever a sender is connected (notes.service.ts:255-261). This merges ops #7 (survived) with team #7 (killed).

### Killed by the adversaries

- **Live till check and hot-table flag on the manager board (pos #2)** — No feed sends open checks: SimPOS is dev-only (app.module.ts:116) **[the conditional is `:117` at 9914f5cbf]** and posts only at close, and the harness posts only closed checks. The spend math also prints $0 for an unknown total. The route-guard leak it exposed is rescued as item 1.
- **A till name becomes a floor person, with per-waiter sales and tips and a /team bridge (pos #4)** — Per-server figures already ship. The /team card bridge would put figures in front of staff, and the tip split is payroll. The part worth keeping (key existing figures by the confirmed member) is S inside PR6/PR13.
- **Clock punch crossed with the till (pos #7)** — Its dependencies are unbuilt, and 'clock out at last activity' would under-record the worked hours that feed ADR 0215. The safe floor-only flag moved into item 4.
- **Does checking on a table pay? (analytics #1)** — No real POS feed and no settled table identity, and a long sit drives both visits and spend. Park it until a real feed exists.
- **Takings per table-hour by section (analytics #2)** — Mostly computable from the till alone, and the 'per cover' figure would print the checker's default party size of 2 as if it were measured.
- **A fast-spending table that goes unvisited gets nudged first (analytics #3)** — No live open checks exist on any feed, and the order of pushes on a phone means little.
- **Clock punches as a labour feed for prime cost (analytics #5)** — Today's prime cost is built on on-hand stock and sell value, so adding labour would print a meaningless ratio. The punch-to-shift link is already part of the port.
- **Server figures filled from the floor's attribution (analytics #6)** — There are no real checks to attribute, and it would double-count nights that also have manual rows. Its @Roles leak finding is rescued as item 1.
- **Covers forecast turned into waiters needed (analytics #7)** — There is no history (90 days are needed), the capacity method is circular, and it is a separate lane (ADR 0111 slice 9).
- **The floor tells analytics which days the house was open (analytics #8)** — The engine already treats a day with no checks as unobserved, not zero (insight-generator.service.ts:1027-1050). What remains is rare or blocked on a POS feed.
- **Who is missing right now: rule vs schedule vs punched (team #2)** — Coverage data is empty in prod, and the ranking conflicts with the busy rule (WeekGrid.tsx:252-259). Its web-push fix for offerCover is rescued into item 4.
- **Coverage rules learned from real services (team #3)** — The evidence would be two-Friday anecdotes, and coverage counts only scheduled shifts matched on exact role words.
- **Sales register and Performance card filled by the floor (team #4)** — There is no live till to join, it competes with the till's own server_name, and the card would expose figures to staff.
- **Clocking in opens the line-up from weekly notes (team #7)** — As pitched, a weekly note would show a stale 86 all week, and My Shifts already shows these notes. The reduced form is kept as item 14.
- **The till runs the table's clock: seat prompt and nothing-rung cue (ops #1)** — No feed sends live open checks, and Square maps cancelled orders to open. The manual Paid tap is rescued into item 2.
- **Late tables climb the house's floor ladder (ops #4)** — With no areas set up, house_areas routing sends to everyone, it has no lead-first step, and it reopens the sections fork the founder closed. The floor-only escalation moved into item 3.
- **Hot and late: the till's live pace on the board (ops #6)** — No live open checks exist, and a fast spend pace usually means someone is already serving the table. Its leak finding is rescued as item 1.

## 3. Founder answers, verbatim (2026-10-30 to 2026-10-31)

Appended 2026-10-31 (workflow floor-checker-docs-reconcile, session ca58311b). This section records every
AskUserQuestion the session asked about Floor Checker, in time order. Each entry gives the question, every
option's full text as it was offered, and his answer as the tool returned it. The source is the session's
`fork-answers-verbatim.md`, kept in its scratchpad, which does not survive a reboot; this copy is the durable one.
**Unlike §1 and §2, this section was re-checked**: it was generated from that file by a script and then compared
with it, and the timing facts under 3.10 were read from the session transcript on 2026-10-31.

How to read it:

- **A pick** is his chosen option label, in italics with quotation marks. The *(Recommended)* inside a label was
  written by the executor who drafted the question. It is not his word.
- **A typed answer** is text he wrote in place of choosing an option. It is quoted exactly, typos included.
- **The option texts are the executor's.** Quoting an option's text tells you what he was shown, not what he said.
- **The tool wrapped each result** in its own sentences ("The user answered: …", "Your questions have been
  answered: …", and a closing sentence). Those sentences are not his words and are left out here.
- **Duplicates were removed.** The source file logs five rounds twice, because transcript compaction logged them
  again: 3.1, 3.5, 3.6 and 3.7 a second time with no timestamp, and 3.10 a second time with the same timestamp.
  `diff` found each copy identical to its first, so each round appears once here: 10 rounds, 34 questions.
- **Times.** Each time is UTC as the tool logged it, then the time in the founder's machine zone
  (America/Detroit, EDT). By that zone, rounds 3.1 to 3.5 fall on 2026-10-30 and rounds 3.6 to 3.10 fall on
  2026-10-31.
- **Round numbers elsewhere.** ADR 0345 calls 3.1, 3.2, 3.3 with 3.4, and 3.5 its rounds 1 to 4
  (`0345-floor-checker-is-ported-into-mudavym.md:79`, `:86`, `:96`, `:145`). ADR 0346 calls 3.1, 3.2, 3.4 and
  3.5 its rounds 1 to 4 (`0346-waiter-scores-and-rankings-ship-to-managers.md:21-24`).

Two things in this record differ from how the ADRs have quoted it so far:

1. **The 3.1 architecture answer has a blank line in it.** ADR 0345 quotes it as one line
   (`0345-floor-checker-is-ported-into-mudavym.md:81`). [2026-10-31: `0345:81` and the software note's `:38` now mark the blank line with [¶].]
2. **The 3.4 result gives the fourteen picked labels in quotation marks**, for example *"Alerts always reach
   someone"* and *"Punches on /team"*. So those labels can be quoted as his picks. ADR 0345
   (`0345-floor-checker-is-ported-into-mudavym.md:104`), ADR 0346
   (`0346-waiter-scores-and-rankings-ship-to-managers.md:23`) and OD-236 (OPEN-DECISIONS.md:320) said the rulings
   record listed them without quotation marks. That was true of the rulings record, not of the tool result. [2026-10-31, repair round: ADR 0345 `:104` was corrected in the fold; ADR 0346 `:23` and ADR 0347 `:5` are corrected in this repair; OD-236 (OPEN-DECISIONS.md:320) carries its own correction bracket, citing `:480`.]

### 3.1 Asked 2026-10-31T02:52:37.844Z (22:52 EDT on 2026-10-30)

**Q1.** How should Floor Checker live inside Mudavym? (checker is Next.js + its own Supabase; Mudavym is Vite + NestJS + a different Supabase, and ADR 0001 says Floor Checker is a software inside Mudavym.)

- **Port into Mudavym (Recommended)**: Rebuild as Mudavym pages + a NestJS floor module on Mudavym's DB: reuse restaurant_tables, public.users roles, notification_push_devices, areas. One login, analytics reads the same tables. Biggest job (~8-10 PRs); retires the floor-coverage app afterwards.
- **Keep separate, sync data**: Checker stays its own app and DB; a sync job copies seatings/check-ins into Mudavym for analytics. Fast, but two logins, two user lists, and data drift.
- **Separate UI, shared DB**: Keep the Next.js UI but point it at Mudavym's Supabase and auth. Avoids a rewrite, but breaks Mudavym's gateway-enforced tenant rules and ADR 0149 (one design).

**His answer**, typed in place of an option (the blank line is his):

> maybe it could be another subdomain I'm not sure create workflow and research what it sright.
>
> port into mudavym might be best

**Q2.** The Mudavym charter forbids per-waiter scores and rankings ('by shift or section, not by name'), but on 2026-10-01 you said we'd save each waiter's stats. Checker has a waiter score (100, halves when late) and per-waiter reports. What should ship?

- **Own stats, no ranking (Recommended)**: Each waiter sees their own figures; managers see per-waiter figures but no score, leaderboard or rank. Drops checker's waiter-score. Supersedes the charter's ban in an ADR.
- **Full checker metrics**: Keep the waiter score, per-waiter reports and CSV exports as built in checker. Fully reverses the charter rule.
- **Shift/section only**: Keep the charter as it is: no figures by name, only by shift or section.

**His answer**, typed in place of an option: *"EVERYTHING"*.

**Q3.** What happens to the data already in checker's Supabase (aatljtckuqzvsttdoxjk)?

- **Start fresh (Recommended)**: Treat it as demo/test data. Set floors up again in Mudavym; leave the old project alone until you retire it.
- **Migrate it**: Copy tables, history and staff into the matching Mudavym house. Needs a mapping from checker staff to Mudavym users, plus your yes for production writes.

**His pick:** *"Start fresh (Recommended)"*.

**Q4.** Checker has an uncommitted 'Food up' meal-run alert feature (migration 0018 + 5 files). Include it?

- **Include it (Recommended)**: It is the charter's core job ('one alert to the one waiter when their food is up'). Ported along with the rest.
- **Leave it out for now**: Port only the committed features; the food-up alert waits for a kitchen-ready event from the POS.

**His pick:** *"Include it (Recommended)"*.

### 3.2 Asked 2026-10-31T03:03:50.149Z (23:03 EDT on 2026-10-30)

**Q1.** Research verdict: port Floor Checker into Mudavym (same login, same DB, analytics reads it directly). Both subdomain options lost. A separate-DB subdomain can't map checker's one-house-per-user model onto Mudavym's many-houses users. A shared-backend subdomain needs a second sign-in, and its push notifications would cross over between the two apps. Lock the port?

- **Port in-SPA (Recommended)**: /floor board, /floor/builder, /floor/me waiter screen inside mudavym.com plus a NestJS floor module. The waiter screen gets its own installable app identity (a manifest scoped to /floor/) on the same origin. About 16 PRs.
- **Port + floor.mudavym.com alias**: The same port, plus a floor.mudavym.com address for the waiter screen. A different origin means waiters sign in a second time, or we build a new token-handoff login that needs its own security ADR (+2-3 PRs).

**His pick:** *"Port in-SPA (Recommended)"*.

**Q2.** Your ADR 0303 ruling says 'No drawing': tables are learned from the till. Checker's FloorBuilder hand-adds and positions tables. What may the Mudavym builder do?

- **Position + hand-add guarded (Recommended)**: Drag, group and merge the till-learned tables, and also hand-add unnumbered spots like 'Bar' or 'Terrace 2' with the twin-table guard (ADR 0303 already owes an add-table lane). Amends 0303.
- **Position only**: The builder only arranges and merges tables the till taught; it never creates one. Cheapest, no duplicate-table risk, but a house without a POS has no tables.
- **Full checker builder**: Create, edit and delete tables freely like checker. Supersedes 0303 and reopens the twin-table problem.

**His answer**, typed in place of an option: *"I want to have all features but in mudavym's way oformat and design compatibility, and more features that actually provide with now the addition to the mudavym(IMPORTANT)"*.

**Q3.** 'Everything' ships. What does a WAITER see on their own phone? (Managers and owners see all scores, rankings and CSV either way.)

- **Own stats + own invoices (Recommended)**: A waiter sees their own score and on-time %, and the invoices for their own tables. No other waiter's name or figures. Redraws the W22 staff-money line (ADR 0257 DASH-G6).
- **Also the house ranking**: Waiters also see the ranked list of all waiters, with names.
- **Nothing for now**: Waiters only tap check-ins; all figures stay with managers for the first rollout.

**His pick:** *"Nothing for now"*.

**Q4.** Checker 'sections' (groups of tables): what should they be in Mudavym?

- **Separate floor sections (Recommended)**: A new floor_sections table that only groups tables, as checker does today. Alerts go to the table's waiter, then managers.
- **Reuse house areas**: Sections become house_areas of kind 'floor' (ADR 0218). Late-table alerts also page the area lead and respect away dates.

**His pick:** *"Separate floor sections (Recommended)"*.

### 3.3 Asked 2026-10-31T03:13:20.824Z (23:13 EDT on 2026-10-30)

**Q1.** Do waiter clock-in/out punches feed Mudavym's wage and payroll records?

- **Floor-only first (Recommended)**: Punches scope shift metrics and reports only, so a floor bug can't change pay. Linking them to wages is a later ADR.
- **Feed wages now**: Punches become the hours record used for wage cost (the 2026-12 wage tables).

**His answer**, typed in place of an option: *"maybe this could be interworkable with /team"*.

**Q2.** Who can raise a 'Food up' alert to a waiter?

- **Any staff (Recommended)**: The pass, a runner or a manager taps it, as in checker. A POS kitchen-ready event can replace the tap later.
- **Managers only**: Only owners and managers can send a run alert.

**His pick:** *"Any staff (Recommended)"*.

**Q3.** You asked for features beyond checker that only Mudavym makes possible. Should I run a second research workflow to propose them (for example: a table's live POS check and invoice on the board, till-taught tables appearing on the floor automatically, covers/spend per waiter from pos_checks, floor insights in the analytics feed, stock or 86'd items on the waiter screen), then bring you the list to pick from?

- **Yes, research then I pick (Recommended)**: A fan-out across POS, analytics, inventory, comms and team finds candidates; an adversary cuts weak ones; you choose what goes in.
- **You decide them**: I research them and include whichever survive the adversary, recorded as my call in the ADR.

**His pick:** *"Yes, research then I pick (Recommended)"*.

### 3.4 Asked 2026-10-31T03:41:53.490Z (23:41 EDT on 2026-10-30)

**Q1.** Service-flow features Floor Checker gains inside Mudavym. Pick any that should ship:

- **Paid tap**: Waiter taps 'Paid'; that table stops nagging, and managers see 'paid 12 min ago' to spot slow turnovers. A closed check from the till does it automatically later, once a real till feed exists (sim houses only today). S, plus M for the till hook.
- **Seating timeline**: The shift report splits each turn into greet, pay and leave times, by section, to show where table time is lost. Unknown phases show a dash, never a zero. S; needs Paid.
- **On-break handoff**: Waiter taps 'On break' and their tables and alerts pass to the cover until 'Back'. The manager can record the break on the shift in one tap. M.
- **Reassignment proposal**: When a waiter leaves, calls out or runs late, the board proposes who takes which tables (same section, lightest load). Nothing moves until the manager taps Apply. M.

**His picks** (several could be chosen), as the result lists them: *"Paid tap,Seating timeline,On-break handoff,Reassignment proposal"*. That is 4 of the 4 options: *"Paid tap"*, *"Seating timeline"*, *"On-break handoff"*, *"Reassignment proposal"*.

**Q2.** People and alert features. Pick any that should ship:

- **Alerts always reach someone**: If the table's waiter is off shift, on break or unassigned, Food-up and late alerts go to the cover, then to a working manager, who sees who got it and why. M.
- **No-show + forgotten clock-out**: A shift started with no clock-in shows Call out / Offer cover buttons (reusing /team's flow). At close, 'still clocked in, no tap since 23:10' gets flagged. Cover offers also reach phones by web push. S-S/M.
- **Manager notes at clock-in**: Right after clocking in, the phone shows unread manager notes addressed to that waiter. S+.
- **Goal notices name who worked**: When a house goal is hit, the notice names the people clocked in, not just those on the schedule. This changes a sentence you asked for earlier. S.

**His picks** (several could be chosen), as the result lists them: *"Alerts always reach someone,No-show + forgotten clock-out,Manager notes at clock-in,Goal notices name who worked"*. That is 4 of the 4 options: *"Alerts always reach someone"*, *"No-show + forgotten clock-out"*, *"Manager notes at clock-in"*, *"Goal notices name who worked"*.

**Q3.** Builder, till and /team features. Pick any that should ship:

- **Builder starts from the till**: Tables the till already taught wait in a tray to be named, placed and sectioned. 'Bar' or 'Window' can become a table once, with old checks linked. Placing the kitchen and bar fills the room-distance analytics. Amends ADR 0303. M-M/L.
- **Punches on /team**: One Clock-in button works the same from the floor phone and from My Shifts, and the /team week shows punched times beside planned ones. This is your 'interworkable with /team'. It amends ADR 0215; wages stay on planned hours. L.
- **'Out tonight' list on phone**: Waiters see what not to sell: items staff mark out, plus drinks the cellar shows run dry, and 'Back' when they return. No figures. M; needs a ruling on who may mark items out.
- **Till vs floor mismatch**: After service: 'the till closed a check at T12 while the floor showed it empty', 'a party left with no check'. A check on the honour system. M-L; needs a real till feed (sim only today).

**His picks** (several could be chosen), as the result lists them: *"Builder starts from the till,Punches on /team,'Out tonight' list on phone,Till vs floor mismatch"*. That is 4 of the 4 options: *"Builder starts from the till"*, *"Punches on /team"*, *"'Out tonight' list on phone"*, *"Till vs floor mismatch"*.

**Q4.** Two more decisions:

- **Floor trends in Recommendations**: Managers get items like 'Section B ran late on 6 of the last 9 Friday dinners: split it or add a runner', with snooze/done/assign. Comes from floor taps alone and needs weeks of data. M.
- **Fix staff money leak now**: Today any staff login can read every waiter's sales and tips and live table spend through 3 analytics routes (no role check). Fix it in its own small PR first, before any floor work. S, on a fix/ branch.

**His picks** (several could be chosen), as the result lists them: *"Floor trends in Recommendations,Fix staff money leak now"*. That is 2 of the 2 options: *"Floor trends in Recommendations"*, *"Fix staff money leak now"*.

### 3.5 Asked 2026-10-31T03:46:17.212Z (23:46 EDT on 2026-10-30)

**Q1.** Who may mark a menu item 'Out tonight' on the phone?

- **Any staff (Recommended)**: Same rule as Food-up: whoever learns it's gone (pass, bar, waiter) marks it. Each mark records who did it, and managers can undo.
- **Managers + kitchen/bar leads**: Only owners, managers and area leads can mark items out; waiters only see the list.

**His pick:** *"Managers + kitchen/bar leads"*.

**Q2.** Tables: checker tables have seat counts, but your ADR 0303 ruling rejected a seats field ('learned from the till, seats empty'). With 'everything ships', should floor tables carry seats?

- **Optional seats (Recommended)**: The builder can set seats; a table without them shows a dash, never a guessed 2 (fixes the old POST that writes seats=2). Amends 0303.
- **No seats**: Keep 0303 as ruled; party size comes from the seating, not the table.

**His pick:** *"Optional seats (Recommended)"*.

**Q3.** Where does 'Add a table' live? (0303 put it in Settings → Point of sale.)

- **Both, one shared form (Recommended)**: The builder and Settings → Point of sale use the same add-table form and the same twin-table guard.
- **Builder only**: Move it to the floor builder and remove it from the Settings plan.

**His pick:** *"Both, one shared form (Recommended)"*.

**Q4.** When a till feed closes a table's check, should the floor auto-mark it Paid / auto-leave the seating?

- **Auto-Paid, never auto-leave (Recommended)**: A closed check marks the table Paid (with one-tap undo for split bills); the waiter still taps Leave. Voided checks and backfills are ignored.
- **Auto-Paid and auto-leave**: A closed check also ends the seating after a grace period.
- **Neither, taps only**: The till never changes floor state; it only feeds the mismatch check.

**His pick:** *"Auto-Paid, never auto-leave (Recommended)"*.

### 3.6 Asked 2026-10-31T04:34:21.299Z (00:34 EDT on 2026-10-31)

**Q1.** How far should the 'Fix staff money leak now' PR go?

- **Your pick now, rest after #617 (Recommended)**: This PR closes exactly what you picked to staff: the three waiter/table reports (sales, tips, live spend) and adding a table. Staff still see the rest: cost, margin, vendor spend, the till total, and the waiter ranking inside insights and recommendations. A follow-up PR after #617 merges closes those the way #617 already does: staff keep the page but the figures are hidden. That PR must land before any waiter is invited to the floor phone.
- **Refuse all 12 to staff now**: The workflow's version. Every money report refuses staff outright. This contradicts #617's recorded choice to hide figures, not whole reports. It takes reorder points away from staff, who may read stock, and half of a staff member's /reports page becomes 'your role cannot read' lines. The ranking inside insights still leaks.
- **Hide everything in this PR**: One PR hides every money figure from staff across reports, insights, recommendations and goals. Most complete, but it edits the same methods #617 is changing, so the two PRs will collide. It is also much bigger than the S-sized fix you picked.

**His pick:** *"Your pick now, rest after #617 (Recommended)"*.

### 3.7 Asked 2026-10-31T06:00:41.410Z (02:00 EDT on 2026-10-31)

**Q1.** The checker's waiter score gives 100 to a waiter who never visits a seated table, and credits the greeting gap to whoever seated the party (often the manager). Fix both in the port?

- **Fix both (Recommended)**: Silence counts as one long gap, so a waiter who never taps scores low, not 100. The seated-to-first-visit gap goes to the table's waiter. Scores will differ from the old checker's.
- **Keep checker's formula**: Same numbers as the checker gives today. A waiter who never visits a table keeps a perfect score, and a manager who seats parties collects their greeting gaps.

**His pick:** *"Fix both (Recommended)"*.

**Q2.** Should the board label a waiter '#1' or 'bottom' before Mudavym can adjust for how busy each waiter's tables were?

- **No, sort only (Recommended)**: Lists stay sorted by score. No '#1', medal or 'bottom' label prints until a busy-table adjustment exists. This is ADR 0272's rule for the dashboard, applied to the floor.
- **Yes, when the test passes**: Print '#1' or 'bottom' when the statistical test says the gap is real, even though a waiter with harder tables can look worse than they are.

**His pick:** *"No, sort only (Recommended)"*.

**Q3.** Kitchen, bar and area leads hold the staff role. Should they see any waiter figure (scores, on-time %, rankings)?

- **No, owner/manager only (Recommended)**: A lead sees what any staff member sees: taps and the 'Out tonight' list, with no scores. No new gate is needed.
- **Their area's figures**: A lead sees the scores of waiters in their own area. This needs a new lead-level check on every figure route and on the socket.

**His pick:** *"No, owner/manager only (Recommended)"*.

**Q4.** When a manager hides a table, should its past seatings still count in each waiter's score and rank?

- **Keep them in (Recommended)**: This matches the till, where a hidden table's checks stay in the servers' figures. Hiding a table never rewrites a waiter's history.
- **Leave them out**: Hiding a table also removes its seatings from every waiter's score and rank, so a waiter's score can change after the fact.

**His pick:** *"Keep them in (Recommended)"*.

### 3.8 Asked 2026-10-31T16:54:31.747Z (12:54 EDT on 2026-10-31)

**Q1.** The checker puts a word beside each waiter's score: 'On pace' (90+), 'Watch' (80+), 'Needs review' (below 80). What should a manager read beside a name?

- **Describe the visits (Recommended)**: Same three bands, but the words describe the tables, not the person, e.g. 'Visits on time / Some late / Many late'. This matches your sort-only pick: no verdict on the waiter until busy tables are adjusted for.
- **Keep the checker's words**: 'On pace / Watch / Needs review' beside the name, exactly as the checker shows them today.
- **Number only**: Show the score with no word and no band colour.

**His pick:** *"Describe the visits (Recommended)"*.

**Q2.** When a waiter leaves the house, what happens to their floor figures (taps, scores, on-time %)?

- **Keep, owners/managers only (Recommended)**: Their history stays as it was, named, visible only to owners and managers, like their shifts on /team. Deleting or anonymising later waits on the retention answer ADR 0218 already sent to counsel.
- **Keep, name removed**: The figures stay in the house's totals, but the name is replaced by 'Former staff' once they leave.
- **Delete after a period**: Their floor figures are deleted a set time after they leave. Needs a period you pick and a scheduled job.

**His pick:** *"Keep, owners/managers only (Recommended)"*.

**Q3.** Should waiters be told that their floor taps are timed and scored?

- **Mudavym shows a notice (Recommended)**: A one-line notice on the floor phone the first time a waiter signs in, saying taps are timed and scored and who sees the scores. Turkey's KVKK and California's CPRA both expect employees to be told.
- **Leave it to each house**: Mudavym shows nothing. Each house decides whether and how to tell its staff.
- **Ask counsel first**: Add it to ADR 0218's list for the lawyer and build no notice until counsel answers.

**His pick:** *"Mudavym shows a notice (Recommended)"*.

**Q4.** The till learned 'T7' as a new table beside your drawn '7'. When the owner folds the twin into '7', what should happen?

- **Merge words, hide twin (Recommended)**: New checks that say 'T7' go to table 7 from now on, and the twin is hidden. Past checks stay where they were, so 'past checks never move' (ADR 0303) still holds.
- **Hide the twin only**: The twin is hidden, but the next check that says 'T7' would recreate it.
- **Merge and move past checks**: Everything moves to table 7, history included. This breaks ADR 0303's 'past checks never move'.

**His pick:** *"Merge words, hide twin (Recommended)"*.

### 3.9 Asked 2026-10-31T16:55:36.453Z (12:55 EDT on 2026-10-31)

**Q1.** The till sends words with no table number ('booth', a guest's first name). Can the owner dismiss one from the 'waiting to be placed' list?

- **Per-house 'not a table' list (Recommended)**: The owner taps 'Not a table' once and that word never comes back for this house. Needs one small migration.
- **No dismiss**: Such words stay in the waiting list until placed. No migration.

**His pick:** *"Per-house 'not a table' list (Recommended)"*.

**Q2.** Renaming a table today only checks that no other table has the same label. Should a rename also refuse a name that would be a twin (e.g. renaming to 'T7' when '7' exists)?

- **Yes, same twin rule (Recommended)**: Rename uses the same twin check as adding a table, ignoring the table being renamed. Closes the last way to make a twin by hand.
- **Labels only, as today**: Keep today's exact-label check. A rename can still create a twin.

**His pick:** *"Yes, same twin rule (Recommended)"*.

**Q3.** The floor builder can measure walking distance from the drawn plan. When may Mudavym use plan distances?

- **After a scale is set (Recommended)**: Once the owner sets the plan's scale (e.g. by marking one known length), distances come from the drawing. Until then, only typed distances.
- **Typed distances only**: Distances are always typed by hand; the drawing is never measured.

**His pick:** *"After a scale is set (Recommended)"*.

### 3.10 Asked 2026-10-31T16:57:03.069Z (12:57 EDT on 2026-10-31)

**Q1.** ADR 0215's day-end sheet has a manager mark each planned shift worked, changed or no-show. Your 'Punches on /team' pick shows punched times beside planned ones, with wages staying on planned hours. Should the punches also pre-fill that sheet?

- **Pre-fill, manager confirms (Recommended)**: When the sheet is built, each shift opens with its punched start and end filled in. The manager still confirms or corrects every shift, so a gamed tap never reaches payroll by itself.
- **Show beside only**: Punches only appear next to planned times. The manager types every change by hand, as ADR 0215 describes today.

**His answer:** none; see the result below.

**Q2.** A Food-up or late-table alert goes to the table's waiter, then whoever is covering. When should it climb to a working manager?

- **When the table turns late (Recommended)**: Uses the house's existing 'late' threshold (10 minutes by default). No new setting, and managers are buzzed only for tables that are already late.
- **Fixed delay if unacknowledged**: Climbs a set time (e.g. 3 minutes) after the first alert if nobody taps it. Needs an acknowledge tap on every alert.
- **Per-house setting**: A new floor setting with a default, which each house can change.

**His answer:** none; see the result below.

**Q3.** Floor alerts reuse today's push devices and add no push table, as ADR 0027 (still Proposed) says. Should ADR 0027 be locked?

- **Leave it Proposed (Recommended)**: ADR 0345 records 'no new push table' as its own rule, so the floor does not depend on 0027's status.
- **Lock it as written**: ADR 0027 becomes binding for every future push feature, not only the floor.

**His answer:** none; see the result below.

**Result, verbatim:** *"Tool permission request aborted"*. No option was picked for any of these 3 questions.

**What happened at 3.10.** The order of events is taken from the session transcript,
`~/.claude/projects/-Users-aldemirkonuk-Projects-restaurant-ai-automation/ca58311b-e2f1-4ce9-85d0-0fc71588c779.jsonl`:

| Time (UTC) | Event | Transcript line |
|---|---|---|
| 16:56:38.465Z | His `/goal` is queued while the session is still working, before the question was shown | `:1567` |
| 16:57:03.069Z | The question is asked | `:1585` |
| 16:57:08.871Z to 16:57:08.911Z | The queued `/goal` is taken from the queue and queued again | `:1586-1587` |
| 16:57:08.930Z | The question's result comes back: *"Tool permission request aborted"* | `:1588` |
| 16:57:09.029Z | The goal takes effect | `:1590` |

So the question was closed without an answer as his `/goal` arrived. The record does not say whether he dismissed
the question himself or the queued command closed it. The floor-checker-docs-reconcile workflow calls this round
"Round D". The source file logs it twice, so its two "aborted" results are one round.

**His goal, verbatim** (the goal's condition, `:1590`):

> complete the full integration with ful SOTA and robust connections with the current mudavym structure and foundation. Do not ask me anything just complete it fully.

Under this delegation the three forks that 3.10 asked about were decided as the **executor's call, not his picks**:
OD-235 (OPEN-DECISIONS.md:319), OD-236 (OPEN-DECISIONS.md:320) and OD-238 (OPEN-DECISIONS.md:322).
Each was decided after research and an adversary pass, and each is recorded in ADR 0345 D1–D3 (`0345-floor-checker-is-ported-into-mudavym.md:273-342`), which its register row points to. [Not re-verified 2026-10-31: the research and adversary outputs are not kept in the repo or the session scratchpad, so this sentence rests on the session's own account (`0345-floor-checker-is-ported-into-mudavym.md:255`).] [Corrected 2026-10-31, finish round: the first pass is workflow wkxd380a8, and its outputs are kept only in the session scratchpad, which a reboot deletes (`wkxd380a8-result.json`: `finalCalls` and `adversary.verdicts`; `0345-floor-checker-is-ported-into-mudavym.md:255`). Rounds 2 to 5 re-tested OD-235, OD-236 and OD-238: round 2 in workflow wf_469ff9fa-840, rounds 3 and later in this session's floor-docs-round3-and-finish run (wf_8682b40b-65c). Their transcripts are outside the repo.] [2026-10-31, OD-236 judge round 6: since the consolidation, each call's one statement is ADR 0345 D1–D3 (`0345-floor-checker-is-ported-into-mudavym.md:273-342`); the register rows point there.]
OD-237 (OPEN-DECISIONS.md:321) was not among them and stays open. It waits for measured install and push results.
