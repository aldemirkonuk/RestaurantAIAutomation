---
type: agenda-full
division: research-math
department: research-math
team: backtests
status: new
updated: 2026-08-24
links: ["[[backtests-charter]]"]
---

# Backtests — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What
Build a harness that replays scenarios against injected data and scores real behaviour.

## How
Start with the one scenario whose signals exist end-to-end today (S02 vendor delivery),
prove the replay loop, then widen by scenario class rather than by ease.

## Why now
`outcome` ships as `call_level_v0` — an honest first base that is explicitly a placeholder.
Without re-grading, that placeholder silently becomes the definition.

## Next steps
1. Wait for the entry trigger: first `neural_footprint_event` rows.
2. Replay S02 against synthetic deliveries; compare call-level outcome to scenario truth.
3. Publish the first `bt.outcome_regrade_delta`.

## Questions for the founder
- Should Backtests be able to **block a release** on a falsified claim, or file findings only?
  (Charter currently says report-only, matching advisory posture.)
