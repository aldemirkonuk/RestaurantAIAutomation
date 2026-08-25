# Sketch 044 · WineOps Signature Motions

Three motion moments that give **weight** to real manager and procurement decisions. Each is spatially anchored, fires rarely, and maps to an irreversible ops action.

**Production:** React Native Skia + Reanimated (sketch 042). HTML prototype simulates timing and haptic cues.

## View
```
open .planning/sketches/044-wineops-signature-motions/index.html
```

---

## Moment 1: Sediment Settle

**Why it's signature:** A decision doesn't just "save" — it visibly settles like sediment falling still in a rested bottle, giving weight to a manager's judgment.

**When it triggers:** On confirming a consequential decision at the manager desk (approving a 86'd item, locking a par change, committing a shift plan) — not on trivial toggles.

**Motion + haptic (~450ms):** Skia renders a thin column of fine dark particles suspended over the just-committed card; on release they drift downward and compact into a single crisp 2px bottom border line (the "lees" line), while the card's tint desaturates from "pending amber" to "settled ink." One soft medium-impact haptic fires exactly when the particles touch the line — the felt "clunk" of a decision landing.

**Why not a gimmick:** Spatially anchored to the decision that caused it, reads as finality/commitment (a real ops need), and the particle count is tiny and monochrome so it never becomes decorative noise.

**Demo:** Tap "Confirm decision" on the 86 card.

---

## Moment 2: Cellar Breath

**Why it's signature:** The cellar map "breathes" once when you enter a low-stock zone, so scarcity is felt in the body before it's read in a number.

**When it triggers:** First time a cellar/inventory zone view loads (or you scroll a zone into focus) where a bin has crossed below par — once per zone per session, not on every render.

**Motion + haptic (~300ms):** Reanimated drives a single subtle contraction-then-release of the affected bin cells (scale 1.0 → 0.97 → 1.0 with spring), while a Skia radial "cool draft" gradient (deep slate-blue, low alpha) sweeps inward from the zone edge and dissipates. Below-par bins hold a faint 1px breathing outline for ~1s after. A light selection haptic taps once at the contraction's trough.

**Why not a gimmick:** Replaces a jarring red badge with a somatic cue that draws the eye to exactly the bins that matter, fires rarely (once per zone), and stays in the wine-cellar sensory world (cool air, stillness) rather than generic UI flair.

**Demo:** Tap "Enter zone (first time)" — session lock prevents repeat until reset.

---

## Moment 3: Cork Commit

**Why it's signature:** Sending a purchase order to a vendor ends with the tactile finality of seating a cork — the order is sealed, not merely submitted.

**When it triggers:** On the final "Send order" action in procurement/receiving handoff, after review — the single highest-stakes button in that flow.

**Motion + haptic (~500ms):** The Send button's label recedes as a Skia cork cylinder (warm tan with grain texture) descends into the button's neck and seats with a quick overshoot-then-settle (Reanimated spring), a thin ring of "pressure" glow pulses outward once, and the button locks to a sealed state. Haptic is a two-stage cue: a soft press as the cork enters, then a firm medium-impact "seat" at the bottom — the physical double-beat of corking a bottle.

**Why not a gimmick:** Maps 1:1 to an irreversible, money-moving action (sending real POs), gives honest confirmation that prevents double-sends, and the cork metaphor is intrinsic to wine rather than bolted on.

**Demo:** Tap "Send order".

---

## Relationship to sketch 043

| Sketch | Focus |
|--------|--------|
| **043** | Feed zero, wax seal, liquid receiving fill, Skia pour PTR |
| **044** | Sediment settle, cellar breath, cork commit (decision-weight motions) |

Both are motion spec galleries for RN Skia + Reanimated handoff.
