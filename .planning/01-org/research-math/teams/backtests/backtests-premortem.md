---
type: premortem
division: research-math
department: research-math
team: backtests
status: new
updated: 2026-08-24
links: ["[[backtests-charter]]", "[[performance-doneability-charter]]"]
---

# Backtests — Premortem

> It is 2027-08. The team exists and has changed nothing. What happened?

## M1 — It backtested only what was easy to replay
**Mechanism:** wine enrichment replays cleanly (static corpus, deterministic-ish scoring).
Vendor negotiation, Floor Checker timing, and guest taste do not. The team drifts to the
tractable corner and reports high coverage on the 15% that was always easy.
**Earliest signal (day 60):** `bt.scenario_coverage_pct` climbing while every covered
scenario shares one owning division.
**Counter-pressure:** coverage is reported *by scenario class* (guest / vendor / POS /
restaurant / food), never as one number. A class at 0% is visible on the board.

## M2 — Re-grading became a second opinion nobody acted on
**Mechanism:** `bt.outcome_regrade_delta` shows call-level grading is 40% optimistic.
People & Agent Ops notes it. Nothing changes, because nobody owns acting on it.
**Earliest signal (day 90):** a regrade delta published twice with no `questions.md` row
filed against the unit whose claim it falsified.
**Counter-pressure:** every falsification files a finding at the owning unit, with the
42-day age-out the advisory contract already uses. A delta with no filing is the team
failing, not the org ignoring it.

## M3 — It became the place claims go to be validated rather than challenged
**Mechanism:** units start asking Backtests to *confirm* numbers before publishing. The
team optimises for green, and its falsification rate trends to zero — which reads as
success and is the opposite.
**Earliest signal:** `bt.claim_falsification_rate` at 0% across a quarter with >10 claims
replayed. A backtest suite that never falsifies anything is not testing.
**Counter-pressure:** falsification rate is reported as a *health* metric with a floor,
not a defect count. Red Team reviews any quarter that reports zero.

## M4 — Injected data flattered the system
**Mechanism:** synthetic scenarios are authored by people who know how the system works,
so they encode its assumptions. The backtest passes because the data was shaped to pass.
**Earliest signal:** backtests pass while the first real restaurant produces failures no
backtest predicted.
**Counter-pressure:** Data owns generation, Backtests owns replay — author ≠ auditor, the
same split used for Substrate Quality. Adversarial cases come from Red Team, not from us.

## M5 — It never started, because nothing emitted
**Mechanism:** the entry trigger is the first `outcome_basis: call_level_v0` rows. If P1
stalls, this team is chartered against nothing, and its 7 documents age into fiction on
the 60-day rule like everything else.
**Earliest signal:** 2026-10-23, the staleness cliff, with `neural_footprint_event` empty.
**Counter-pressure:** `watch_loops.py` already watches that date. If it fires with the
table empty, this team should be explicitly parked, not quietly maintained.
