# Floor Checker research and the founder's answers (2026-10-30 to 2026-10-31)

The decision record this file supports lands later in this series; its number is the one this file's name begins with.
**This is the research, not the decision.** The founder's answers are added to this file
verbatim later in the series; where a ruling differs from a recommendation below, the ruling wins.

Two research workflows ran on 2026-10-30 (session ca58311b). Their judged outputs were copied
into the repo because the session scratchpad does not survive a reboot, and they are trimmed
here. The untrimmed text is the full record: commit `88c30917a` on branch
`docs/floor-checker-full-record-2026-10-31` (outside main's history),
`.planning/decisions/evidence/0345-floor-checker-research.md`.

The agents did not all read the same tree: some cited `origin/main` at eb6ddc2a9, and the
local checkout was 161 commits behind `origin/main` when the first one started. Every Mudavym
`path:line` in the research sections of this file was re-measured at `origin/main` `037452ebe`
when the file was written. Citations into the checker repo and counts of production rows are
as the agents recorded them and were not re-measured.

## 1. Architecture (wf_c6c2a59b-b8b)

Workflow wf_c6c2a59b-b8b: 3 advocates, 3 adversaries, 1 judge. The text is the judge's.

### Winner

Option 1, PORT INTO MUDAVYM. Floor Checker becomes a native in-SPA Mudavym software: /floor manager board, /floor/builder, a chrome-free waiter screen at /floor/me, a NestJS floor module and new migrations on Mudavym's Supabase. The plan must be re-derived against origin/main (eb6ddc2a9), not the stale checkout at 059169a59. Grafted from the losers: a framework-free floor-core package that both the gateway and web import; a pos_server_links identity table; role-gated realtime; a single-runner, idempotent nudge scheduler; and freezing the checker's uncommitted spec before porting. The floor.mudavym.com alias and an Expo waiter screen are kept as founder forks, not built by default.

### Rationale

The judge's spot-checks were made at origin/main eb6ddc2a9; the local main was 161 commits behind it, so every citation in the three cases that pointed at the local tree was stale.

Why the port wins:

(1) ADR 0001 names Floor Checker as a software inside the one entity (0001-mudavym-single-entity.md:31, keyword floor-checker at :15). The founder's start-fresh ruling removes the only reason to keep the checker's second database.

(2) The analytics engine must consume floor data, which is only cheap in the same database. The insight generator already loads restaurant_tables with hidden_at (insight-generator.service.ts:903) and filters hidden tables (:1469). INSIGHT_GENERATOR_VERSION is 12 (:254), so new floor measures need a version bump.

(3) Role-gated realtime already exists. websocket.gateway.ts:38-43 says owner/manager-only content goes through emitToHouseRoles to memberRoom rooms (:50, :663-684), never to restaurant:<id>. That fixes Option 1's leak: per-name lateness and scores must not reach staff sockets.

Why Option 3 dies. The checker profile has one restaurant_id per auth user (checker 0001_init.sql:35-37, 144-152), while Mudavym is many-houses-per-person. Two-way table sync across two databases sits under every floor analytic. Its 'survives a gateway outage' benefit is undone by its own PRs.

Why Option 2 loses:
- Its distinctive benefits are partly false. notification_push_devices has only user_id, endpoint and subscription, with no app or origin column (migration 20260925160500:96-120). A second service worker therefore gets every back-office push and the main app gets every floor push, unless a schema change is made.
- localStorage sessions are per-origin, so a subdomain needs a second sign-in or a new token-handoff auth surface.
- WS CORS lacks the origin.
- The ADR 0149 design layer lives in apps/web/src/components/mudavym and would need a risky extraction.
- Blast-radius isolation is small, because the gateway carries all floor logic either way.
- An in-SPA route can still get its own install identity: a second manifest scoped to /floor/ on the same origin needs no new auth, no new service worker and no extraction.

Option 1 survives its refutation, but only once these four are settled:
- ADR 0303, still Proposed (0303:3). The founder's pick says "No drawing" (0303:3, :24), and :62 says nothing is drawn. Tables are learned from the till with seats NULL (0303:16, :36). Hidden tables are "out of every table figure and ranking, insights included" (0303:60). The checker's FloorBuilder hand-adds and positions tables, which collides with this. That is a genuine founder fork, not something to default.
- DASH-G6 (0257:79, :146). The founder already anticipated that "floor coverage software" (0257:79) saves each waiter's stats and lets waiters see table invoices, and that the W22 staff-money line is redrawn then. The redraw was anticipated; its exact shape was open.
- The service-floor charter's explicit non-goal, "this team does not produce staff performance scores, rankings, or disciplinary evidence" (service-floor-charter.md:71-72, the paragraph after the 'Staff performance management — nobody, deliberately' row at :69). It must be superseded in writing per the everything ruling, or review overturns the work on prose.
- ADR 0027 is still 'Status: Proposed' (0027:3), though the task treated it as locked. No push_subscriptions table is created either way.

Not verified by the judge: the checker-side line counts and file:line claims (taken from the cases), Railway replica count, Vercel DNS ownership, and ADR 0294/0272 content beyond their titles.

### Rejected

- **SUBDOMAIN SEPARATE APP: keep the checker's Next.js app and Supabase, add SSO and outbox-to-HMAC ingest.** Fatal on identity. The checker profile is one-house-per-auth-user (checker 0001_init.sql:35-37, 144-152), but Mudavym users belong to many houses and can switch, so 'checker user id = Mudavym user_id' cannot hold. It also needs a two-way table-layout sync across two Postgres projects under every floor analytic, and ADR 0303 makes Mudavym's till-learned restaurant_tables the record. Its own PRs undo its two benefits: auth, push, nudges and tables all route through the gateway, and reports, Food-up, reskin and auth all get rewritten anyway. The separation of storage and auth becomes permanent, against ADR 0001's 'then unified', and start-fresh removes the reason to keep the second DB.
- **SUBDOMAIN ON MUDAVYM BACKEND: a second Vite app at apps/floor on floor.mudavym.com.** It survives, but loses on cost against benefit. Its 'own push scope' is false: notification_push_devices has no app or origin discriminator (migration 20260925160500:96-120) and sendWebPush fans out per user, so alerts cross between both service workers. Sessions are per-origin localStorage, so it needs a second sign-in or a new token-handoff auth surface that would need its own security ADR. WS CORS does not accept the origin. ADR 0149 would force extracting the whole apps/web/src/components/mudavym design layer. Deploy isolation is small, since the floor still dies with a bad gateway deploy. That is roughly 3-4 extra PRs plus a security ADR, for benefits an in-SPA route gets mostly for free: an install identity via a second manifest scoped to /floor/, and a light bundle via route-level code splitting.

### Ideas grafted from the losing options

- From Option 2: a framework-free packages/floor-core workspace package holding the checker's pure modules (freshness, attribution, response-time, waiter-score, meal-alert, floor-merge, merge-orientation, adjacency, heat, visit-leave). The gateway (nudges, reports, analytics) and the web board both import ONE implementation, so the score on screen and the score in insights cannot disagree.
- From Option 2: a dedicated pos_server_links(restaurant_id, source, server_external_id, server_name_norm, member_id/user_id, confirmed_by, confirmed_at) table instead of a jsonb column on team_members. Links are proposed automatically (name match, plus the ≥50% seated-time attribution overlap) and a manager confirms them. Unlinked rows say 'unlinked' and never fabricate a person (ADR 0020). It must apply the same 'words that are not names' care that ADR 0303 applied to till table words.
- From Option 2's subdomain idea, reduced: the waiter screen gets its own install identity through a second web manifest with scope '/floor/' and start_url '/floor/me' on the SAME origin, so there is no new auth, CORS or service worker. A real floor.mudavym.com alias (a host rewrite like the SimPOS precedent) stays a founder fork, because a different origin means a second sign-in.
- From the Option 1 refutation: every owner/manager-only floor event (per-name lateness, scores, rankings, other waiters' tables) goes through emitToHouseRoles/memberRoom (websocket.gateway.ts:38-43, :663-684). restaurant:<id> carries only staff-safe facts, such as table state and a table's own freshness.
- From the Option 2/3 refutations: the per-minute SLA nudge scanner gets a single-runner guard (a Postgres advisory lock or a lease row) and an idempotency key per (seating, threshold) in a nudge_events table. A second Railway replica must not double-push. The missing socket.io Redis adapter is stated as a known one-replica limit.
- From Option 3: freeze the checker source first, including its untracked Food-up work, because that is part of the spec. Also adopt its 'reconciliation check' instinct as an absent-not-zero spec plus a floor-vs-POS coverage figure on the board.
- From Option 3: map roles explicitly, owner/manager to checker manager and staff to checker waiter. No new role is added. A per-table assignment check is enforced server-side.

The judge's own build plan (PR0 to PR16, as the software note later amended it) is in the full record. Its items move to the Floor Checker build plan and the obligations file, which land later in this series; the PRn numbers in this file refer to that plan.

### ADRs the judge said were needed

- NEW: 'Floor Checker is a Mudavym software, ported in-SPA'. It records the founder rulings (everything, start fresh, Food-up, analytics consumes floor), the role map, the reuse map, and why both subdomain options were rejected.
- NEW, superseding text: 'Per-waiter score, rankings and CSV ship'. It supersedes the service-floor charter's 'Staff performance management — nobody, deliberately' row and its non-goal paragraph, plus the premortem's per-name lines, with bracketed in-place pointers. It must state how ADR 0272 (ranking only when distinguishable) and ADR 0294 (team performance card units) bind the new surface.
- AMEND ADR 0257 W22 / DASH-G6 (0257:79, :146): the staff-money line is redrawn now that floor coverage runs. That covers what a waiter sees of their own stats, others' stats, and table invoices, per the founder's answer.
- AMEND or supersede ADR 0303 (tables learned from the POS, "No drawing"), per the builder fork: whether the floor builder may position or group learned tables and whether it may hand-add any.
- NEW: 'Floor realtime is role-gated'. Per-name floor payloads go via emitToHouseRoles/memberRoom only. A single gateway replica is a stated limit until a socket.io adapter exists.
- NEW: 'A shift is punched'. shift_punches versus planned shifts, and whether punches feed wage or payroll records (2026-12 wage migrations).
- NEW: 'A POS name is a person'. pos_server_links, confirmation by a manager, and the not-every-word-is-a-name rule.
- NEW: 'Floor nudges run once per house per minute'. The single-runner lock, idempotency keys, quiet-hours logging (founder 2026-10-11), and Food-up recipients.
- NEW or amend ADR 0218: whether checker sections are house_areas kind 'floor' (coupling floor alerts to area leads) or a separate floor_sections grouping.
- LOCK ADR 0027 (still 'Status: Proposed' at 0027:3), or record that the plan relies only on its no-push_subscriptions consequence.

### Forks the judge left for the founder

The founder's answers to these forks are added verbatim later in this series.

- ADR 0303 vs the builder. Your "No drawing" ruling (0303:3) and till-learned tables conflict with the checker's FloorBuilder. Paths: (a) the builder only positions, groups and merges tables the till taught, and adds none (cheapest, no twin-table risk); (b) also hand-add tables with no number, like 'Bar' (ADR 0303 already owes an 'addtable' lane), guarded against twins; (c) full checker builder, which reopens the twin-table problem you closed. Recommend (a)+(b).
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
- Insight-generator residuals outside floor measures, for example the ridge driver zero-fill. ADR 0303 says these were amended; the judge did not re-verify them.
- The CI review key returned 401 on 2026-10-29 and worked again on 2026-10-31, when CI reviewed PR #701, which merged as `e7ef31145` (on main; the 401 itself was not re-measured). No floor PR depends on a local review instead.
- Not verified by the judge: checker line counts and checker file:line claims (taken from the advocate cases), the content of ADR 0294/0272 beyond their titles, Railway replica count, mudavym.com DNS ownership, and iOS install/push behaviour of a second same-origin manifest.
