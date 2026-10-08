## Why

PR #654 (lane houseswitch) makes "who takes this" on `/recommendations` refuse a person who is not on this house's roster (OPS-03). As built at `505a03400` it also refused every roster status except `active`, both at the gateway and on the page. The ADR 0090 audit at `505a03400` BLOCKed for two reasons. First, the choice was not recorded as a decision. Second, its CLAIMS row cited ADR 0218 round 4 answer 3, which rules only on who a crew message to everyone reaches (`0218-an-alert-finds-its-area-first-a-lead-acts-on-cards-only-and-away-is-dates.md:558-562`).

This PR records the rule. The coordinator decided it under the founder's 2026-10-07T20:04:10Z delegation, so it is not the founder's pick.

## What changes

- New `.planning/decisions/0306-who-takes-an-entry-is-anyone-on-this-houses-roster.md`. The rule: an assignee id must be a row of the path house's roster, and the row's status is not read.
  - Rejected, each with its reason: active only (as built), `{active, trial}`, a three-value fail-closed list, and a page-only active filter.
  - It replaces #654's appeal to ADR 0218 r4a3.
- One new row in `.planning/decisions/README.md`. No existing row was edited.

Two files. No code. The build is PR #654 at `c18c94a5f`, which cites this ADR by number and slug, so **this PR must merge before #654**.

## Evidence

- **F4, the founder, 2026-09-06:** *"the roster it reads is the team's"* (`.planning/06-pages/recommendations.md:821`).
- **ADR 0215 item 19:** *"Only removal counts"* (`0215-…:451-456`); a person marked inactive "is still on the roster" (`:380`).
- **Other named roster picks at the gateway ignore status:**
  - `assertMemberInRestaurant` (`team.service.ts:455-467`)
  - `rosterRow` (`house-areas.service.ts:774-786`)
  - the crew message to named people (`team.controller.ts:534`)
  - The only status gate is the crew message to everyone (`:535`).
- **Assignment is a note, not an act** (ADR 0191:484-488). The popover says assigning "sends nothing and commits nothing" (`WhoTakesThisPopover.tsx:132`).
- **Guards on this branch at `606004296`:**
  - `check_adr_numbers_unique`: OK, 0306 introduced, checked against 1760 refs.
  - `check_citation_pairing`: PASS.
  - `check_decision_claims`: 942 checked, 942 holding.
  - `check_flag_readby_anchors`: PASS.
  - `check_od_ids_exist`: PASS.
  - lanecheck: all rc=0, files=2.
- **ADR number.** 0306 is the houseswitch slot of the 0306-0310 reservation (`fixes/README.md`, 2026-10-07 20:33Z; houseswitch is first of the five worktrees named there, and firstmenu, fourth, took 0309, so the order matches; the README does not state the mapping in words). The guard's max+1 is 0310, the fifth slot (capreads by that order), so taking 0306 avoids a collision there. No ref and no `wt-*` worktree uses 0306.

## Not done

- Production `team_members.status` values were not read. "Only active, trial and inactive exist" rests on the code's writers.
- The status tag in the popover is owed and not built.
- These residuals are disclosed in the ADR and not closed:
  - a name sent alone is still unchecked
  - an assignment outlives a later status change or removal
  - invite placeholders are assignable
  - staff see "roster could not be read"
- No ADR 0090 audit has run on this PR. No browser was driven, since this PR is docs only.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
