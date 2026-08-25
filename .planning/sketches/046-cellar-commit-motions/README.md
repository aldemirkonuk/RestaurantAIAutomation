# Sketch 046 · Cellar Commit Motions

Three tactile moments for **irreversible commits, identity locks, and stock placement** — pressure, authenticity, and place, not UI bounce.

**Production:** React Native Skia + Reanimated (sketch 042). HTML prototype simulates timing and haptic cues.

## View
```
open .planning/sketches/046-cellar-commit-motions/index.html
```

---

## Moment 1: Cork Seat

**Why it's signature:** Committing a decision should feel like seating a cork — pressure, then lock — not a UI bounce.

**When it triggers:** Only on irreversible manager commits: approve/send PO, lock a desk decision, confirm a variance write-off.

**Motion + haptic (~280ms):** Reanimated compresses the control ~8% on Y (cork into neck); Skia draws a thin burgundy contact ring that flashes once at the seat point; ImpactMedium at contact (spring settle).

**Why not a gimmick:** Cork = sealed ops decision; reserved for rare commits so everyday taps stay silent.

**Demo:** Tap "Lock write-off" on the variance commit control.

---

## Moment 2: Capsule Sweep

**Why it's signature:** Confirming bottle identity should feel like the foil capsule locking authenticity — one wrap, done.

**When it triggers:** Receiving/scan match success (label ↔ SKU), or cellar lookup "this is the bottle" confirm.

**Motion + haptic (~220–320ms):** Skia foil band wraps once around the product row (burgundy → brief metallic sheen); light Success haptic at wrap complete; no particles, no linger.

**Why not a gimmick:** Capsules mean authenticity in wine; motion maps to identity lock, not decoration or progress chrome.

**Demo:** Tap "Confirm bottle identity" after scan match.

---

## Moment 3: Bin Breath

**Why it's signature:** Placing stock should feel like the cellar light finding the right slot — spatial, then still.

**When it triggers:** Assigning stock to a bin, confirming a cellar-map pin, or finishing a relocate.

**Motion + haptic (~350–450ms):** Skia soft radial glow on the target bin expands once then settles; Reanimated springs the list/map selection into place; soft tick haptic at settle.

**Why not a gimmick:** Cellar work is place-memory; one breath on place, never ambient glow on idle map.

**Demo:** Tap "Confirm placement" with B2 selected.

---

## Relationship to sketches 044–045

| Sketch | Focus |
|--------|--------|
| **044** | Sediment settle, cellar breath, cork commit (decision-weight / sensory) |
| **045** | Ledger fold, route lock, provenance stitch (accountability / routing) |
| **046** | Cork seat, capsule sweep, bin breath (commit / identity / placement) |

All are motion spec galleries for RN Skia + Reanimated handoff.
