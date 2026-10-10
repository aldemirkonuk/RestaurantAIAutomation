## Time-off requests: past days, reversed ranges and the form's first days — CLOSED — 2026-10-10

F-923 (sim ledger). `fix/sim-w65-staff-day` (238b84528) built the behaviour and left one fork open: whether a past-dated request needs the manager first. **Coordinator call, 2026-10-10** (founder delegated forks, /goal 2026-10-07): it does not.

- A past first day is allowed, staff filing for themselves included, with no manager step before it is sent. Sick leave is often filed after the day. The manager still reviews it as any other request (`reviewTimeOff`).
- A last day before the first is refused by the gateway in plain words: "The last day off comes before the first. Nothing was sent." (`apps/api-gateway/src/team/team.service.ts`, `createTimeOff`). The page already refused it.
- The form opens on today's house day, one day, not Monday to Sunday of the week on screen (`apps/web/src/pages/team/next/MyShiftsNext.tsx`).

Pinned by `team-pay.spec.ts` ("F-923 — a time-off request runs forward", three tests, one added on `fix/sim-w66-timeoff-rule` for a range that began in the past and runs on) and claim `F-923-TIMEOFF-RULE` in `decisions/claims.d/fix-sim-w66-timeoff-rule.jsonl`.

Database half CLOSED on `fix/sim-w67-timeoff-check`: migration `a_day_off_ends_on_or_after_it_starts` (20270104600000) adds `time_off_requests_ends_on_or_after_start` CHECK (start_date <= end_date), so a direct write past the gateway is refused too; a past first day and a one-day request stay allowed. Added NOT VALID, then VALIDATEd only when no reversed row exists, because reversed rows may already be stored (the gateway took any range until w66) and production was not counted. If some exist the migration keeps them as they are, with a NOTICE giving the count, and the check stays NOT VALID while still refusing every new write; putting those rows right and running VALIDATE is the house's call, not a guess (swapping dates would guess which one was mistyped). Pinned by `supabase/tests/20270104600000_a_day_off_ends_on_or_after_it_starts_test.sql` (PGlite: fix PASS, control FAIL T1, legacy-row leg PASS) and claim `F-923-TIMEOFF-CHECK`.

Still OPEN: whether production holds reversed rows (one read-only count, `select count(*) from time_off_requests where end_date < start_date`, before or after merge).
