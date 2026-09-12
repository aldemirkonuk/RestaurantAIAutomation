# Sketch 076 · Decision Office agenda canvas

**Design question:** How do you draw the agenda of a function whose only authority is to
**not** decide — so the picture shows routing, ageing and refusal, and never once shows an
answer?

**Context:** One canvas per department under [[0039-activation-plan-of-record]] Track B
(GENERATION_BRIEF §8.2 item 5). Source of truth is
`.planning/02-advisory/decision-office/decision-office-agenda-full.md` (2026-08-28) —
15 tasks, 5 programs, 6 close-times. This file renders that agenda; it never adds to it.
Open `canvas.html` directly in a browser; no assets, no build, no script.

## Direction

| | |
|--|--|
| **Domain** | The ADR log · the open-decision register · loop close-times and dated triggers |
| **Color world** | Audit ledger: paper `#F6F5F2`, ink `#14181D`, slate `#46566A`, with exactly three signal colours — amber `#B0741C` = open and ageing, green `#2E6A4E` = clean or the founder's, seal-red `#8B2E2E` = a guard that failed or a door that is closed. Deliberately not the product's burgundy, and deliberately not Legal's docket paper: this is a control panel, not a document |
| **Signature** | **The ageing track — an axis with almost nothing on it.** 39 open rows, and only 2 can be plotted, because only 2 have a knowable filed date. The rest sit inside a dashed fog band labelled *no filed date, therefore no position*. The emptiness *is* the finding |
| **Rejects** | A kanban (nothing has been done) · a burn-down curve (there is no history to curve) · any rendering of a fork's outcome |

## Why the empty axis is the spine

The obvious canvas for a decision office is a queue: 39 rows, sorted, colour-coded by
severity. It was drawn and discarded, because it renders a lie — a sorted list implies the
rows have an order, and they have none. **39 of 39 carry no owner and no filed date**, so
there is no age, no median, no drain rate, and ADR 0002's own revisit condition ("the
register's founder-queue grows faster than it drains") has never been computable.

Drawing the axis and leaving it empty says that in one glance, and it makes task DO-1 —
three columns, pure bookkeeping, nobody's permission needed — read as the load-bearing
task it actually is rather than as metadata housekeeping.

The two pins are the two forks this agenda was commissioned to carry: OD-25 and TECH-F3,
both filed 2026-08-24, both **day 4**, both never once re-raised across six ADRs.

## What the instrument panel shows (measured 2026-08-28, cited in the agenda)

| Guard | Exit | Why the row exists |
|---|---|---|
| `check_decision_claims.sh` | **0** | 111 executable claims, 111 holding — the one green arm |
| `check_citation_pairing.py` | **1** | 125 citations vs 107 rows · 12 unanchored · 1 disagreeing. **Every flagged site is a wave-3 agenda written this week** |
| `check_od_ids_exist.py` | **1** | Two register ids name nothing; 7 references, all inside one audit document |
| `build_agent_card_index.py --check` | **0** | 100 units · 102 cards |

Two of four are red. CI runs all four; the `claim-auditor` card runs three — the missing
one is a finding routed to its owning unit, not a fix made here.

## Layout notes

- **Programs as lanes, close-times as columns.** Two columns are deliberately sparse:
  *2026-09-28 (monthly)* holds two chips and *Oct → Nov (dated)* holds one. An office
  whose calendar is thin in the middle and heavy at the edges is the honest render — the
  weekly cadence carries the work and the dated cliffs carry the risk.
- **Chip tint carries grade, not priority.** Slate = department work · amber = a reach
  item that may close as `BLOCKED` with a named holder · green = the founder decides ·
  red = a finding routed to another unit and never fixed here.
- **Doneability lives in `title=`, not on the face.** Fifteen doneability statements
  rendered inline would bury the shape. Hover keeps the picture readable and loses nothing.
- **Node T gets its own band.** The directive draws the forbidden branch as a graph; the
  canvas draws it as a door with the traffic that reaches it — *"one side is obviously
  right"*, *"a team is blocked"*, *"the founder is busy"*, and the newest one:
  *"a locked ADR already drew this exact line, one seam over."* That fourth arrow is
  TECH-F3's live state today, which is why it is on the page rather than in a footnote.
- **The calendar band carries its own failure.** Four cards are dates; the fifth is the
  instrument admitting that this unit's *catalogue* of other units' triggers reads, to the
  watcher, as this unit *having* them.

## Found while drawing it

Writing this canvas and its agenda **manufactured two false retirement triggers** in
`scripts/watch_loops.py` — one for this office and one for Architecture Review — purely by
describing the detector's word list next to a date. Both were reworded out before shipping
and the watcher was re-run to confirm they were gone. That reproduction is now evidence
under task DO-13: a rule you cannot write about without triggering is not a rule.

Both agenda documents were also run against all three register guards before shipping and
contribute **0** flagged sites. An office reporting a citation defect while committing it
would have no standing to report anything.

## Not built, deliberately

No outcome is rendered for OD-25 or TECH-F3 — a resolution drawn here would be a decision
made outside `.planning/decisions/`. No progress colours, because there is no progress
yet. No identifier is renumbered anywhere on the page. No standing rule of this office's
own authorship. Throwaway-grade per the sketch conventions — a thinking surface, retired
whenever the agenda's shape changes.

**Manifest row (added by the orchestrating session, not here):**

`| 076 | decision-office-agenda-canvas | How do you draw the agenda of a function whose only authority is to NOT decide — routing, ageing and refusal, never an answer? | — | decision-office, agenda, wave3, advisory, findings-only, open-decisions, register-guards, ageing-track, node-t, dated-triggers, staleness-cliffs, close-times |`
