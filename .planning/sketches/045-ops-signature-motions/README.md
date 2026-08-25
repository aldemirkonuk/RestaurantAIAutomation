# Sketch 045 · Ops Signature Motions

Three motion moments for **accountability, routing, and chain-of-custody** — making operational transitions legible without decorative noise.

**Production:** React Native Skia + Reanimated (sketch 042). HTML prototype simulates timing and haptic cues.

## View
```
open .planning/sketches/045-ops-signature-motions/index.html
```

---

## Moment 1: Ledger Fold

**Why it's signature:** A manager's decision visibly becomes part of the permanent operational record.

**When it triggers:** A recommendation is committed with its reason and owner.

**Motion + haptic (~320ms):** Reanimated compresses the decision card into a burgundy ledger rule while Skia draws its timestamp; one restrained rigid tick lands as it joins the shift timeline.

**Why not a gimmick:** It clarifies the transition from pending work to recorded accountability.

**Demo:** Tap "Commit with reason & owner" on the par-bump recommendation.

---

## Moment 2: Cellar Route Lock

**Why it's signature:** It turns allocation into a brief, spatially legible cellar plan.

**When it triggers:** Stock for an order or pick wave is fully allocated.

**Motion + haptic (~420ms):** A Skia path trims through the selected bins toward dispatch over 420ms; bin markers settle inward by 2px and a medium haptic fires when the route locks.

**Why not a gimmick:** The motion previews the actual pick sequence and catches implausible routing.

**Demo:** Tap "Lock pick route" after allocation (A2 → C1 → B3 → Dispatch).

---

## Moment 3: Provenance Stitch

**Why it's signature:** It makes chain-of-custody completion tangible without celebrating routine data entry.

**When it triggers:** A receiving lot passes all checks and its cellar location is saved.

**Motion + haptic (~500ms):** A fine Skia thread connects supplier, lot, inspection, and bin nodes; Reanimated tightens the line at the final node with one soft success pulse.

**Why not a gimmick:** Every animated node represents stored provenance that staff can reopen.

**Demo:** Tap "Save cellar location" after QC checks pass.

---

## Relationship to sketch 044

| Sketch | Focus |
|--------|--------|
| **044** | Sediment settle, cellar breath, cork commit (decision-weight / sensory) |
| **045** | Ledger fold, cellar route lock, provenance stitch (accountability / routing / custody) |

Both are motion spec galleries for RN Skia + Reanimated handoff.
