## The response-time port's caller owes three things before its figures go to managers — OPEN — 2026-11-07

Found by the ADR 0090 session audit of PR #768 (`packages/floor-core/src/response-time.ts`). `responseSamples` has no caller yet; these fall to the floor gateway that builds `SeatingFacts`, and to the report that ranks waiters (ADR 0346).

1. **Pass null, never `""`.** `caretakerAtSeatId ?? curr.actorId` keeps `""`, and a falsy id is dropped from every waiter's figure without a trace. The uuid columns cannot produce `""`; a caller that builds facts from anything else must normalise. The package keys on `seatingId` alone, so the caller also scopes events and facts to one house.
2. **A table with no caretaker at seat time** (none assigned, cleared as absent under ADR 0351 `:23`, or `caretaker_at_seat_id` set null by `ON DELETE SET NULL` in the floor's record migration) leaves its open greeting gap out of every waiter's figure; it counts for the table only. The board and report should show such seatings as uncovered rather than let the silence vanish.
3. **Credit follows the visit.** A colleague's or manager's check-in carries the open gap after it (the handoff rule), bounded by the caretaker's last tap; and with no caretaker, the first visitor, a manager who seated included, takes the greeting gap. The report decides whether manager ids appear in waiter rankings.

These are executor's readings under OD-242 (the header's readings paragraph); ADR 0346 `:64` names only who must not get the greeting gap.
