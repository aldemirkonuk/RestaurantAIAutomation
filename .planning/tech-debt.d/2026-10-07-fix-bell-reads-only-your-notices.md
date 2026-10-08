## The dashboard summary read every notice in the house — CLOSED on `fix/bell-reads-only-your-notices` — 2026-10-07

`GET /dashboard/summary/:id` built `notifications.recent` from `select("*")` on
`notifications` by `restaurant_id` alone (main `a323cc80b`,
`apps/api-gateway/src/dashboard/dashboard.service.ts:524-533`). Any member, a
waiter included, therefore read notices addressed to someone else. That
included the owners' own-wage notice with both figures (ADR 0215, round 5 item
32), a manager's own limit, notices the area routing had kept to one area
(ADR 0218), and rows filed with no addressee. Money-policy M1 item 1
(`p4-scratch/sim-run/fixes/audits/money-policy-2026-10-07.md`).

**Fixed.** The leg is now scoped the way the bell scopes its list
(`NotificationsService.getNotifications`): `user_id` is the token's `userId`,
`restaurant_id` is the house, newest `created_at` first, and it returns five
rows. A row with a NULL `user_id` reaches no summary, just as it reaches no
bell. The proof is `dashboard.notices-are-the-callers.spec.ts`, which runs
owner, manager and staff tokens on one fixture and checks each against the
bell's own list. Claims: `claims.d/fix-bell-reads-only-your-notices.jsonl:1-2`.

**Coordinator's call under the founder's 2026-10-07T20:04:10Z delegation**
(three small implementation forks; who sees what was already decided):

1. *Which columns.* The brief said to select "the columns the dashboard draws",
   but no web or mobile code reads this route. `getDashboardSummary` in
   `apps/web/src/services/api/dashboard.ts:53` has no caller, and DashboardNext
   reads stats, activity, alerts and the calendar
   (`useDashboardNextData.ts:227-231,297`). So the leg carries what a bell row
   draws (`RECENT_NOTICE_COLUMNS`: id, type, title, message, priority, status,
   action_url, action_label, read_at, created_at), and every one of those
   columns is one the bell already returns to the same person. Two options
   were rejected:
   - `select *`: it carries `metadata`, where producers file figures, plus the
     addressee and delivery columns.
   - The bell's camelCase mapped shape: it would change the response's key
     style for any API reader with nothing gained.
2. *Order by `created_at`, not `sent_at`.* No gateway writer sets `sent_at`.
   Under DESC its NULLs sort first, so the old order picked an arbitrary five.
   The bell orders by `created_at`.
3. *No user on the call returns nothing, not a 401.* JwtAuthGuard always puts
   a `userId` on the request. A refusal from one leg would also sink the other
   five legs of the summary, and a missing user must never fall back to the
   house's notices.
   [2026-10-08, PR #579 merging main: overtaken at the route. DASH-W22 now
   refuses the whole summary, in words, to staff and to an unknown or missing
   role before any leg runs, so no leg's refusal can sink the others. The
   service's no-user branch stays as defence in depth.]

## GET /dashboard/summary still hands every member vendor spend and whole order rows — CLOSED on `fix/review-dashboard` — 2026-10-07

Found while fixing the notices leg above, and not fixed on that branch. The
same route returns `procurementSpend` and `orders.pending` / `orders.inTransit`
(whole `procurement_orders` rows from `getOrdersSummary`) to any member. That
is house money under ADR 0145's owner/manager rule
(`.planning/decisions/0145-mudavym-answers-out-of-a-reading.md:370`). PR #579
(`fix/review-dashboard`, DASH-W22, paused by the founder on 2026-10-03) gates
the whole handler with `assertSeesHouseAmounts`, and it owns that handler's
gate, so this branch leaves it alone. No page calls the route today (see
above), so only a direct API call reaches it. When #579 resumes it will
conflict with this branch's two-line change to the same handler and the same
leg (its copy of the query is at `dashboard.service.ts:319`). Resolve that
conflict by keeping both changes.

**[2026-10-08, PR #579 merging main 87dafc064] CLOSED by #579.** Both changes are kept: the handler now refuses any role that does not see amounts with `assertSeesHouseAmounts` before it reads anything (DASH-W22), and an owner's or manager's notices leg still reads only their own rows. The merge left no textual conflict. The semantic one sat in `dashboard.notices-are-the-callers.spec.ts`: its waiter case and its no-user case now expect the refusal, with no read, and the columns case runs as the owner.

## email_intel_agent.py's `_notify` still inserts without the legacy NOT NULL columns — OPEN — 2026-10-07

`services/agent-orchestrator/agents/email_intel_agent.py:902-915` (`_notify`,
called at `:240` and `:597`, the "Deal: {product} at {pct}% off from
{provider}" promo notice) writes no `recipient_id`, `notification_type`,
`channels` or `user_id`. That is the shape `v3.0-TECH-DEBT.md:117`
("44.1d — `notifications` writes") proved fails with 23502 on the live table,
and the failure is logged as "non-critical". The money-policy refute
(`refute:money.missed_surfaces`) read this row as reaching staff through the
dashboard leg. More likely it never lands at all. This was not checked against
production, because this lane makes no production reads. The summary now drops
a NULL-addressee row either way. When the insert is repaired, it must address
the holders by role (promotions are owner/manager by role, money-policy F7)
rather than fan out to the whole house. That repair is money-policy M2's
"Python promo insert copy".
