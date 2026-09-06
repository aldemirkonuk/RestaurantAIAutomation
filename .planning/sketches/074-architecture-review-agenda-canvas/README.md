# Sketch 074 · Architecture Review — Agenda Canvas

**Design question:** Can one page show a review function whose entire founding backlog
closed *without it* — so the re-grade reads as an argument about the function's own
survival rather than a victory lap — while pre-registering, in public and on a date, the
five axes of an adversarial pass on a protocol it has not yet been allowed to read?

**Context:** Wave 3 canvas for
[`architecture-review-agenda-full.md`](../../02-advisory/architecture-review/architecture-review-agenda-full.md),
authored under [ADR 0039](../../decisions/0039-activation-plan-of-record.md) Track B and
`foundation/GENERATION_BRIEF.md` §8.5. Throwaway-grade thinking surface, not a product
surface.

## The constraint that shaped it

This unit is **advisory — findings-only, outside the line** (OD-16, ADR 0007). It owns no
line work and its only output is a written finding. That makes one visual failure mode
dominant: **a page of green rows would be a lie about what happened.** Six of the seven
founding findings closed between 2026-08-24 and 2026-08-28, and none of them closed
because a finding was written.

| Pressure | What the canvas does |
|---|---|
| The re-grade reading as a win | Every green row in the ledger carries a **"Closed by"** column, and the column never says *a finding from this function* |
| A roll-up number hiding the ratio | No aggregate anywhere. The `0 / 0` slab sits directly beside the five improved metrics |
| The zero being invisible | The "what closed the six" bar chart draws the third bar at **literal zero width** — a legend entry with nothing behind it |
| A review tuned to what it read | The pass is stamped **SEALED 2026-08-28**; an axis added after reading the protocol must be labelled as such |
| Reach items reading as commitments | One `REACH · needs a decision` badge, in alarm colour, on the severity-ladder amendment |
| The unit quietly re-scoping itself | The scope disagreement is drawn as **two differently-sized surfaces** (9 of 21 vs 21 of 21), filed and not resolved |
| A census that flatters itself | The guard grid shows 9 lit / 12 unlit, with the sentence "12 unlit is not 12 defects" next to it |

## Layout

1. **Masthead** — thesis plus the two stamps: the date, and the ratio that did not move
2. **§0 ledger** — the seven founding findings re-measured, with a "Closed by" column
3. **§0.1 zero-numerator panel** — `0 / 0` beside the attribution of the six closes
4. **§2 the pass** — the seal, then five axis cards + a sixth card saying what the pass
   is *not* (no pick, no score, no gate)
5. **§3.1 guard census** — 21 guard tiles, 9 lit, with the NEVER VACUOUS rule quoted
6. **Close-time lanes** — six date columns, cards coloured by program, each carrying its
   `done:` line
7. **§4.1 scope** — the two readings as two block surfaces
8. **Seams + findings nothing can carry**, then a provenance footer

## Colour

| | |
|--|--|
| **Amber** | Track A1 — the adversarial pass |
| **Blue** | the standing findings program (census, seam watch, layer map) |
| **Violet** | this function's own two questions (scope, merge trigger) |
| **Green** | leaves the unit — a finding addressed to another unit's questions file |
| **Alarm red** | reserved for exactly three things: the `0 / 0` ratio, the one REACH badge, and open founding findings |

Deliberately an instrument panel, not the burgundy/glass direction the sketch conventions
set for customer surfaces. This page is read by one person deciding whether a review
function should continue to exist.

## Data provenance

Every figure is measured on 2026-08-28 against the working tree; none is illustrative.
Listed in the canvas footer as well:

- `.planning/00-index/cards.json` — 102 cards / 100 units; **58** with `quality_bar`
  containing `NONE (gap)`; routing mix 36·36·30
- `scripts/agents/run_card.py:333-342` — **8 of 102** cards execute
- `ls scripts/check_*` — **21** guards; **9** contain an `exit 2` / `sys.exit(2)` path
- `scripts/check_model_calls_logged.sh:20-35` — the `NEVER VACUOUS` rule, quoted
- `.github/workflows/ci.yml:87-103` (`commitment-guardrail-sync`) and `:120`
  (`model-call-ledger`) — the two ratchets that closed AR-2 and AR-3
- `apps/web/src/hooks/queries/useSommelierQueries.ts:25-26, 42-43, 56` — the 3 live L6→L0
  statements (was 2 files / 5)
- `apps/api-gateway/src/common/model-client/model-client.service.ts:7` — the one remaining
  provider endpoint constant (was 7)
- `apps/api-gateway/src/common/tenant/tenant.guard.ts:34-58` — AR-5's moved enforcement;
  no endpoint count asserted, OD-19 owns the recount
- `find .planning -name "*-questions.md"` — **100**, which is AR-0 closed (OD-41)
- `OPEN-DECISIONS.md:29` (OD-03) and `:40` (OD-52's reframe); ADRs 0035, 0036, 0039

## View

```
open .planning/sketches/074-architecture-review-agenda-canvas/canvas.html
```

## Manifest row

```
| 074 | architecture-review-agenda-canvas | Can one page show a review function whose founding backlog closed without it — the re-grade as an argument about its own survival, not a victory lap — while pre-registering the five axes of an adversarial pass on a protocol it has not been allowed to read? | — | advisory, agenda, wave-3, architecture-review, bake-off, od-03, pre-registration, guard-census, invariant-census, layer-map, merge-trigger, instrument-panel |
```

*Not added to `MANIFEST.md` by this agent — the orchestrating session owns that file.*
