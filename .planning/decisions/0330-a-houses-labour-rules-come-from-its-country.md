# 0330 — A house's labour rules come from its country

- **Status:** Locked
- **Date:** 2026-10-11
- **Decider:** founder (2026-10-11 chat)
- **Keywords:** F-155, F-1385, F-1367, F-1020, F-1399, labour law, per-country rules, WEEKLY_REVIEW_HOURS, art68MinimumBreak, assumed break, 4857, FLSA, California, Working Time Regulations, ArbZG, SGK, team, pay-rules
- **Links:** supersedes in part [ADR 0215](0215-money-on-team-is-the-owners-and-hours-are-worked-hours.md) (Decision items 8, 10, 17 and 18: the 45-hour review line and the Art. 68 break as every house's rule); [ADR 0305](0305-a-state-is-read-inside-its-house-country.md) (a state is read inside its house country); [ADR 0304](0304-a-house-zone-comes-from-its-address.md) (a house zone comes from its address); [ADR 0020](0020-no-fabricated-answers.md) (an unknown is said, not invented); sim ledger S195, `p4-scratch/sim-ledger.md` (outside the repo)

## Context

`/team` applies Turkish labour law to every house, wherever it is:

- `apps/api-gateway/src/team/pay-rules.ts:70` fixes `WEEKLY_REVIEW_HOURS = 45`, the Turkish week (4857 Art. 63).
- `art68MinimumBreak` (`pay-rules.ts:53`, used at `:406`) assumes the Art. 68 break (15 / 30 / 60 minutes) for every shift that has no break on record.
- `apps/web/src/pages/team/next/TeamNext.tsx:581` tells every house "not SGK, meals or bonuses". SGK is the Turkish social-security body.

A San Francisco house therefore reads "No one is scheduled over 45 worked hours". California pays overtime after 8 hours in a day and after 40 in a week, and it requires a meal period once a shift runs past 5 hours. So a Californian week of 9-hour shifts goes unflagged. The sims hit this five times: F-155, F-1020, F-1385, F-1399, and F-1367 (wall-clock hours on a DST night).

ADR 0215 chose these rules when every house was Turkish, and it has no country switch. Lanes w74 (F-1020) and S155 left the break alone because ADR 0215 is locked (its Decision item 10, the founder's "Take all five" option 1).

The founder, 2026-10-11, verbatim: *"Why does the US house get Turkish rules? Every house gets its rules based on its uh, location."*

## Options considered

1. **One rule for everyone (as built).** This is simple. It is wrong for every non-Turkish house, and it tells their owners that a schedule is legal when it may not be.
2. **No legal rules at all, only the owner's own targets.** Nothing is ever wrong because nothing is claimed. But the owner loses the one check that a scheduling tool is expected to give.
3. **Rules keyed on the house's country (and state, where the law is set by the state).** Deputy, 7shifts and Homebase all key compliance on the location. Each country gets a researched rule set. A country without one is told so in plain words. **Chosen.**

## Decision

**A house's labour rules come from its own country (and its state, where the law sits there). A country whose rules Mudavym has not researched gets no assumed break and no legal review line. The page says that country's rules are not in Mudavym yet, and it never applies Türkiye's rules in their place.**

1. **One rule table, keyed on country and state.** Each row names its legal source, its weekly review hours, any daily review hours, and its break rule (minimum break by worked span, or none). The first rows:
   - **TR:** 45-hour week (4857 Art. 63) and the Art. 68 break, exactly as ADR 0215 built it.
   - **US, federal:** 40-hour week (FLSA). No federal break rule, so no assumed break.
   - **US-CA:** adds a daily review past 8 hours, and a 30-minute meal period on a shift over 5 hours (Labor Code §512).
   - **GB:** a 20-minute rest break on a shift over 6 hours (Working Time Regulations 1998, reg. 12). The 48-hour average week is a review line, not overtime.
   - **DE:** 30 minutes over 6 hours and 45 minutes over 9 hours (ArbZG §4). A review past 10 hours in a day (ArbZG §3).
2. **The country comes from the house record** (`restaurants.country`), and the state is read inside that country (ADR 0305). A house with no country, or with a country that has no row, gets rule set "not researched": hours are counted as recorded, no break is assumed, and no "over N hours" line is shown. The page names the country.
3. **The words follow the rule set.** "Not SGK" and "4857" appear only for a Turkish house. Every other house sees its own source, or none.
4. **Hours are elapsed time on the house's clock** (F-1367). A shift that crosses a DST change is measured as instant minus instant in the house zone, not wall-clock minutes.
5. **What ADR 0215 keeps.** Money is the owner's. Worked hours exclude breaks. A wage record is kept five years. Every other 0215 item is unchanged. Only its Turkish numbers stop being every house's numbers.

## Consequences

- A US, UK or German house stops being told that its schedule is legal by Turkish law.
- Adding a country is one researched row with a cited source, not a code change in five files.
- The CLAIMS rows `ADR-0215-TEAM-HOURS-ARE-WORKED-HOURS` and `ADR-0215-TEAM-AN-UNRECORDED-BREAK-IS-ASSUMED` still hold on today's code. The build lane rewrites them to the per-country form in the same PR that moves the constants, and does not delete them.
- A house in an unresearched country gets fewer warnings than today. That is intended, because a wrong warning is worse than an honest "not covered".
- Revisit when a house opens in a country with no row. Its first week is the signal to research that row.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-11 | — | Created from the founder's chat ruling (sim S195) |
