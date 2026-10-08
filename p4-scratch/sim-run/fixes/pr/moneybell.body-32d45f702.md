> **[2026-10-07 23:05Z, coordinator] Head `32d45f702`.** `origin/main` `214779a76` merged in (no conflict; the fix commit is still `13f3da079`). Re-run at this head: gateway `npx jest src/dashboard` **5 suites, 68 passed**; gateway `tsc --noEmit` only the 2 known `@simplewebauthn/server` errors; `lanecheck.sh` six guards rc=0, files=5, ownership `[]`; decision claims **938/938** (the full `scripts/check_decision_claims.sh`, which the evidence below says was not run at `13f3da079`). A verifier pass on the branch came back clean. **No ADR 0090 audit has run yet.** The rest of this body was written at `13f3da079` against `a323cc80b`; its line citations into main still hold at `214779a76` for the files this PR touches, which #612 did not change.

<!-- Drafted 2026-10-07 ~21:47Z for branch fix/bell-reads-only-your-notices at 13f3da079, base origin/main a323cc80b. Lane moneybell, money-policy M1 item 1. -->

## What was wrong for a real house (checked at origin/main a323cc80b)

`GET /dashboard/summary/:id` builds `notifications.recent` in `getNotificationsSummary` (`apps/api-gateway/src/dashboard/dashboard.service.ts:524-533` on main). It ran `select("*")` on `notifications` filtered by `restaurant_id` only, with no `user_id` filter. Any member of the house, a waiter included, got the house's five notices with every column, whoever they were addressed to:

- **The owners' own-wage notice, with both figures.** When a manager who has pay access changes their own wage, every active owner gets an in-app notice "from ₺X to ₺Y". ADR 0215 addresses it to owners only (`.planning/decisions/0215-money-on-team-is-the-owners-and-hours-are-worked-hours.md:551-564`, round 5 item 32). Its `metadata` also carries `hourly_wage: {from, to}`.
- **Other people's notices:** a manager's own limit, owner-only notices such as the price-index review, and notices the area routing had kept to one area or held for someone who is Away (ADR 0218, `.planning/decisions/0218-an-alert-finds-its-area-first-a-lead-acts-on-cards-only-and-away-is-dates.md:66-69`).
- **Rows with no addressee (`user_id` NULL).** These appear in nobody's bell, but this leg returned them too.

The bell itself has scoped its list to the person since 2026-09-12 (`notifications.service.ts:886-889`: `.eq("user_id", userId)`, with the house taken from the token at `notifications.controller.ts:120-131`). The dashboard leg never was. The audit's own comment said: "In production, this would be scoped to the restaurant's managers".

Who may see what is already decided. This PR adds no rule:

- Money, sales and price are owner/manager only (ADR 0145, `.planning/decisions/0145-mudavym-answers-out-of-a-reading.md:370`).
- A role is the role in the token's house (ADR 0162).
- Other people's events go to the bell, and the bell is per person (ADR 0262, `.planning/decisions/0262-a-toast-is-for-your-own-act-newest-on-top-on-the-house-settle.md:68`).
- The founder's money rule, ADR 0253 rounds 9-11, F5/F12, sits unmerged on PR #566, so it is cited by number only. The coordinator's audit (`p4-scratch/sim-run/fixes/audits/money-policy-2026-10-07.md`) lists this leak as M1 item 1.

## What changed and why

- **`dashboard.service.ts`, `getNotificationsSummary`.** Scoped exactly as the bell scopes its list:
  - `user_id` is the caller's `userId`. That is the JWT's `public.users.user_id`, which `jwt.strategy.ts:71` puts on `request.user`.
  - `restaurant_id` is the house. JwtAuthGuard's tenant assertion already holds the route param to the token's house.
  - The newest `created_at` first, five rows.

  A NULL-`user_id` row reaches no summary, because `eq` never matches NULL, just as it reaches no bell. If no user is on the call, the leg reads nothing and returns `{recent: [], unreadCount: 0}`. It never returns the house's notices.
- **Columns.** The leg selects `RECENT_NOTICE_COLUMNS` (id, type, title, message, priority, status, action_url, action_label, read_at, created_at) instead of `*`. It no longer carries `metadata`, where producers file figures, or the addressee and delivery columns. Every column it keeps is one the bell's `mapNotificationRow` already returns to the same person, so the summary never carries more than the bell. `getDashboardSummary(restaurantId, userId?)` passes the id through. The parameter is optional, so a caller that does not pass it gets no notices.
- **Order.** The leg now orders by `created_at` instead of `sent_at`. No gateway writer sets `sent_at` (`notifications.service.ts:544-561`, `:728-745`), and under DESC its NULLs sort first, so the old leg picked an arbitrary five. The bell orders by `created_at`.
- **`dashboard.controller.ts`.** The summary handler takes `@CurrentUser() user?: Caller` and passes `user?.userId ?? null`. `Caller` gains `userId`.
- **The response shape stays the same.** It is `{ recent: row[], unreadCount }` with snake_case row keys, and only the dropped columns are gone. **Web consumer:** no web or mobile code calls this route. `getDashboardSummary` (`apps/web/src/services/api/dashboard.ts:53-63`) has no caller. DashboardNext reads stats, activity, alerts and the calendar (`apps/web/src/pages/dashboard/next/useDashboardNextData.ts:227-231,297`). Its vitest suite still passes (below).
- **Register fragment `.planning/tech-debt.d/2026-10-07-fix-bell-reads-only-your-notices.md`.** It records three small implementation calls as the **coordinator's call under the founder's 2026-10-07T20:04:10Z delegation**: the column set, created_at ordering, and empty-not-401 for a missing user. It also files two OPEN entries for leaks this branch found and does not own (see "Not covered"). No new ADR.

## Evidence

- New spec `apps/api-gateway/src/dashboard/dashboard.notices-are-the-callers.spec.ts`, 5 tests.
  - One fixture: an owner, a manager and a staff member in one house, plus a NULL-addressee promo row, the staff member's row in another house, and a staff row whose `metadata` carries a figure.
  - Each token is built by the real `JwtStrategy.validate` and handed to the handler through its real `@CurrentUser()` factory.
  - The PostgREST stand-in applies `select` columns, `eq` (NULL never matches), `order` (DESC puts NULLs first) and `limit`.
  - Each person's summary ids must equal the first five of the bell's own `NotificationsService.getNotifications` list on the same fixture. Staff get only their own newest five, and no own-wage text, "₺320", manager row, "Deal:" or other-house row. The owner gets only the owner's two, the manager only the manager's one. Keys equal `RECENT_NOTICE_COLUMNS` exactly. No user means no notifications read at all.
- **Mutations.** Each gate was reverted in turn, the spec turned red, and the file was restored byte-identical from a `cp -p` snapshot (`cmp` checked):

  | Mutation | Spec result |
  |---|---|
  | drop `.eq("user_id", own)` | 4 of 5 red |
  | drop `.eq("restaurant_id", …)` | 2 red |
  | `select("*")` | 1 red |
  | order by `sent_at` | 2 red |
  | controller passes `null` instead of `user?.userId` | 4 red |
  | no-user floor disabled | 1 red |

  Against main's own copy of both files, the suite fails: `RECENT_NOTICE_COLUMNS` does not exist there.
- `cd apps/api-gateway && env LC_ALL=C npx jest src/dashboard`: **5 suites, 68 tests passed**.
- `cd apps/web && npx vitest run src/pages/dashboard/next`: **7 files, 114 tests passed** (not touched; run to confirm DashboardNext).
- `npx tsc --noEmit -p apps/api-gateway/tsconfig.json`: only the 2 known `@simplewebauthn/server` errors (`passkeys.service.ts:16,22`).
- eslint on the three files: 0 errors. Prettier: clean. One pre-existing warning (`dashboard.service.ts` `consumption` unused) is not from this change.
- **Claims** in `.planning/decisions/claims.d/fix-bell-reads-only-your-notices.jsonl`, both `resolved`, static python over the source:
  - `:1` `DASH-2026-10-07-SUMMARY-NOTICES-ARE-THE-CALLERS`
  - `:2` `DASH-2026-10-07-SUMMARY-NOTICES-CARRY-NO-METADATA`

  Both exit 0 on this branch and exit 1 on main's copy. Eight targeted mutations were each caught by the claim that owns them: no user eq, no house eq, sent_at order, no floor, leg not handed the user, `@CurrentUser()` dropped, `select("*")`, and `metadata` added to the columns. `scripts/check_decision_claims.sh` was not run (the coordinator runs it).
- `lanecheck.sh wt-fix-moneybell`: all six guards rc=0, files=5, ownership `[]`, exit 0.

## Overlap with open PRs

The open-PR list was read on 2026-10-07: 69 open PRs.

- **#579 `fix/review-dashboard`** (paused by the founder on 2026-10-03) touches `dashboard.service.ts`, `dashboard.controller.ts` and `dashboard.controller.spec.ts`. It keeps this same notices query unchanged at its `dashboard.service.ts:319`, and it adds `@CurrentUser() user?: Caller` plus `assertSeesHouseAmounts` to this same handler. Expect a small textual conflict in `getNotificationsSummary` and in the summary handler when #579 resumes. Resolve it by keeping both: #579's role gate, and this branch's user scoping and column list. The edits here were kept to those two spots, and #579's spec files are untouched.
- **#582 `fix/phone-feed-no-money-for-staff`** touches `notifications.service.ts`. This branch only reads that file and does not edit it.

## Not covered

- **The rest of the summary still leaks.** `procurementSpend` and the whole pending/in-transit `procurement_orders` rows go to any member, staff included. That is house money under ADR 0145:370. #579's `assertSeesHouseAmounts` closes it. This branch leaves #579's gate to #579 and files the leak as OPEN in the fragment. Only a direct API call reaches it today, since no page calls the route.
- **Neutral titles for non-holders (F5) and redact-at-read (F12) are not done.** This branch makes the summary show a person only their own notices. It does not rewrite figures inside a staff member's own notice titles. That belongs to the emitter-copy census and the shared `holdsHouseMoney` helper (money-policy M2).
- **The Python promo insert.** `services/agent-orchestrator/agents/email_intel_agent.py:902-915` (`_notify`) omits `recipient_id`, `notification_type`, `channels` and `user_id`. `v3.0-TECH-DEBT.md:117` (44.1d) proved that shape fails with 23502 on the live table, so this row most likely never lands. That was **not verified against production**, because this lane makes no production reads. It is filed as OPEN in the fragment for M2. Either way, the summary now drops a NULL-addressee row.
- `DatabaseService.getRecentNotifications` (`database.service.ts:147-157`) filters on a `manager_id` column the table does not have. It has no callers and is not touched.
- `unreadCount` still counts `read_at` NULL among the five returned rows, as before. It is not the bell's whole-inbox count, and nothing reads it.
- No browser pass. No page renders this route.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
