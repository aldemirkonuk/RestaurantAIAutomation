## Time-off requests: past days, reversed ranges and the form's first days — CLOSED — 2026-10-10

F-923 (sim ledger). `fix/sim-w65-staff-day` (238b84528) built the behaviour and left one fork open: whether a past-dated request needs the manager first. **Coordinator call, 2026-10-10** (founder delegated forks, /goal 2026-10-07): it does not.

- A past first day is allowed, staff filing for themselves included, with no manager step before it is sent. Sick leave is often filed after the day. The manager still reviews it as any other request (`reviewTimeOff`).
- A last day before the first is refused by the gateway in plain words: "The last day off comes before the first. Nothing was sent." (`apps/api-gateway/src/team/team.service.ts`, `createTimeOff`). The page already refused it.
- The form opens on today's house day, one day, not Monday to Sunday of the week on screen (`apps/web/src/pages/team/next/MyShiftsNext.tsx`).

Pinned by `team-pay.spec.ts` ("F-923 — a time-off request runs forward", three tests, one added on `fix/sim-w66-timeoff-rule` for a range that began in the past and runs on) and claim `F-923-TIMEOFF-RULE` in `decisions/claims.d/fix-sim-w66-timeoff-rule.jsonl`.

Still OPEN: the baseline `time_off_requests` table has no `start_date <= end_date` check, so a direct write past the gateway can still store a reversed range. A CHECK needs a migration, which this branch was not allowed.
