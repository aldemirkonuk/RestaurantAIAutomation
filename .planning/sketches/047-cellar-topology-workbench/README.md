# Sketch 047 · Cellar Topology Workbench

**Design question:** Can "Manage Storage" stop being a settings list and become a dedicated physical-space command surface — floor plan, rack aperture, capacity, and relocation guidance in one flow?

**Context:** Elevates the Manage Storage concept from sketch 040 into a standalone full-page workbench (not a modal inside Insights). Spec for shipping as `/inventory` storage command or a dedicated cellar topology route.

## Direction

A cellar manager rebalancing physical space before service — not an admin editing records.

| | |
|--|--|
| **Domain** | Bays, racks, bottle slots, headroom, pressure, receiving buffer |
| **Color world** | Chalk, limestone, burgundy, oxidized brass, cool slate |
| **Signature** | Live rack aperture (96 cells) + floor-plan bay map |
| **Rejects** | Settings rows → location command rail; number-only capacity → direct manipulation; % vanity → operational read |

## Wine style classification

Rack cells are not a single zone tint — each occupied cell is a **wine style silhouette**:

| Style | Visual |
|-------|--------|
| **Red** | Deep burgundy capsule block |
| **White** | Straw-gold with thin amber rim |
| **Sparkling** | Cool silver-blue, pointed neck (clip-path) |
| **Rosé** | Soft pink, rounded top |
| **Fortified** | Amber with grain texture |

- Floor plan + rail show a **style mix bar** per bay
- Inspector lists per-style counts + % with tracks
- Tap a style chip (or inspector row) to **isolate** that style on the rack and open the **wine roster** with producer, vintage, region, bin, format, ABV, and service notes
- Tap again (or Clear) to dismiss details
- Dominant style drives bay accent and rail meter color

## Style wine roster

Selecting a style reveals every SKU of that type in the selected bay:

| Field | Example |
|-------|---------|
| Name / producer | Barolo Cannubi · Paolo Scavino |
| Vintage · region | 2019 · Piedmont, IT |
| Bin · format · ABV | A-12 · 750ml · 14.5% |
| Qty | 48 bottles |
| Note | Decant 2h · pairing cue |

## Stored wines · assign + auto locate

Inspector **Stored Wines** block (pattern from inventory location assign UI):

- Capacity readout `placed / cap` + fill meter for the selected bay
- Assigned roster with **Remove** (returns wine to the pool)
- Search pool + **Assign** into the current bay (disabled if over capacity)
- **Auto locate** picks the best bay by style affinity + headroom (VIP bias for rare bottles)
- **Auto locate all** drains the pool into best-fit bays

## Layout

1. **Top vitals** — placed bottles, open slots, pressure zones + Apply
2. **Left rail** — selectable / drag-reorderable locations with fill meters + state pills
3. **Center** — floor-plan topology (all bays) + rack aperture for the selected bay
4. **Right inspector** — rename, recolor, capacity slider/stepper, operational insight, breakdown, safe delete
5. **Footer** — dirty state, Discard, Apply

## Interactions

- Click bay (floor) or rail row to select
- Drag rail to reorder
- Capacity: range, ±10, or exact input → rack cells animate
- Insight CTA jumps to best overflow target when under pressure
- Cannot delete locations that still hold bottles
- Apply blocked if any location is over capacity
- Reset restores seed layout

## View
```
open .planning/sketches/047-cellar-topology-workbench/index.html
```

## Relation to 040

| Sketch | Role |
|--------|------|
| **040** | Insights panel + Manage opens workbench as modal |
| **047** | Same concept as its own full-page product surface |
