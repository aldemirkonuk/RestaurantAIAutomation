# Sketch 041 · Cellar Command Surface

**Design question:** What is the most SOTA reimagining of the "Inventory Insights & Organization" panel? Discard the three-column list entirely and make storage *spatial* — a cellar you can read in one glance.

**Mode:** Redesign - overhaul of the module on `apps/web/src/pages/Inventory.tsx`. Content preserved (zones, capacity, health, QR), visual language rebuilt.

## Taste-skill read
> Reading this as: a product intelligence module for restaurant/wine operators, with a dark glass command-surface language, leaning toward native CSS + Motion-style transitions + a locked wine accent.

- **Dials:** `DESIGN_VARIANCE 7` (asymmetric bento), `MOTION_INTENSITY 5` (fluid, motivated), `VISUAL_DENSITY 6` (real ops data).
- **Locks:** one theme (dark), one accent (wine `#CD2D5B` / `#E0578A` on dark), one radius scale (16 / 13 / 10 / pill).
- **Icons:** Phosphor via CDN (no hand-rolled icon SVGs; data-viz SVGs only for gauge/sparkline).
- **Anti-slop:** zero em-dashes, no three-equal-cards, no decorative dots (the one status dot is a live semantic beat), no scroll cues, no version labels.

## The big idea — spatial treemap
Storage is no longer a list of four rows. It is a **capacity treemap**: each zone's tile is sized by its capacity (Main Cellar dominates, VIP is small) and **fills with liquid from the bottom to its live stock level**. A manager sees at a glance which zones are full, which are empty, and where to move wine. Bar Stock at 92% glows amber ("near limit"); Overflow at 20% reads as headroom.

## Bento (asymmetric, exact cell count = 4)
```
+------------------+----------+
|                  |  HEALTH  |
|   CELLAR ZONES   +----------+
|   (treemap)      |   QR     |
+------------------+----------+
|      NEXT BEST ACTION       |
+-----------------------------+
```
1. **Cellar zones** - the treemap signature visual.
2. **Inventory health** - radial gauge + six-count sparkline + healthy/attention/pending metrics.
3. **Floor QR access** - scanning-sweep QR tile, honest "coming soon".
4. **Next best action** - turns the old passive "recommendation" into an actionable insight (rotate Bar Stock to Overflow) with Manage zones + Auto-locate CTAs.

## Header = live command bar
Wine glyph with a live status beat, title, and a readout that survives collapse: `4 zones · 56% filled · 1 near limit · health ring 84`. Click to collapse (`grid-template-rows: 1fr → 0fr`).

## Motion (all motivated)
- Zones fill on expand / drain on collapse (state reveal — communicates stock level).
- Health ring + gauge draw on expand (state).
- QR sweep loop (live-feel affordance).
- All collapse to static under `prefers-reduced-motion`; glass falls back to solid under `prefers-reduced-transparency`.

## Notes
- Throwaway HTML. All numbers are mock data.
- Dark theme is a deliberate "command center" choice for the sketch; a light-theme port is straightforward (swap tokens) if we integrate into the current light `/inventory`.
- Supersedes sketch 040 as the bolder direction for the same module.
