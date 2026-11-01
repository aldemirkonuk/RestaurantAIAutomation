## The goal producers tell no one about a days-of-stock goal — OPEN — 2026-11-01

Filed when PR #617 was split. A days-of-stock goal is a sales holder's figure (ADR 0298 decision 9), and `ceiling-held.producer.ts` and `goal-reached.producer.ts` carry no sales gate. They skip such a goal and count it. Every run logs the count; a run that sends nothing also names it in `withheld_reason`, which by its table's comment carries only a no-op's sentence. Claim `A-GOAL-PRODUCERS-SKIP-SALES-GATED-GOALS` pins the skip. **Closes with** `fix/goal-producers-tell-only-sales-holders`, which hands them the gate for sales holders and retires that claim.

## The insight feed carries no days-of-stock goal's pace, for any role — OPEN — 2026-11-01

Every role reads `analytics_insights` (ADR 0348, GET `insights`), so `computeGoalsFamily` writes no pace for a sales-gated goal. An owner reads that pace on the goal itself, through the gated goal routes. The rejected alternative is to write the pace and filter it per viewer at read. That is the mechanism ADR 0348 defers to its post-#617 follow-up for the insight feed's other sales figures; this entry closes with that PR. Claim `A-INSIGHT-FEED-SKIPS-SALES-GATED-GOALS` pins the skip, and that PR retires it.

Rows written before this deploy are not re-gated. A read-only query at 2026-11-01T17:45:09Z (`select count(*) from analytics_goals where metric_key='days_of_inventory'`, and the same over `analytics_insights` where `category='goals'` and the evidence names `days_of_inventory`) returned 0 and 0, out of 1 goal (`checks`) and 1 goal insight. The closing PR re-runs it rather than trusting this count, since a row written between now and the deploy would stay readable.
