# Sketch 040 · Inventory Insights Panel

**Design question:** Can the "Inventory Insights & Organization" toggle earn its space by becoming a live command bar — surfacing zone count, average fill, and a health ring even when collapsed — while each expanded card gets a signature visual?

**Context:** Improves the collapsible section on the real `/inventory` page (`apps/web/src/pages/Inventory.tsx`). Targets the header button + the 3-column grid (Storage Locations, QR Quick Access, Inventory Health).

## What's explored

### Header as a command bar (not a plain toggle)
- Gradient wine icon badge with a live "ping" status dot
- Title + one-line context
- **Live summary strip** (visible even when collapsed): zones chip, average-fill chip, and a small animated health ring — so the row is useful before you expand it
- Pointer-follow glow; circular rotating chevron affordance
- Smooth `grid-template-rows: 1fr → 0fr` expand/collapse

### Three signature cards
1. **Storage Locations** — spatial zone tiles with capacity, headroom, and pressure insights. **Manage** opens a dedicated cellar-topology workbench: selectable/reorderable location rail, 80-cell rack aperture, direct-manipulation capacity control, contextual relocation guidance, safe deletion, and model-driven save.
2. **QR Quick Access** — animated scan-point: a CSS-drawn QR (with real finder squares), a scanning sweep, a phone mock, and a 3-step floor workflow. Honest "coming soon" state.
3. **Inventory Health** — conic-ish gauge (SVG) with gradient stroke, metric rows (healthy / needs attention / pending reconciliation), and a contextual recommendation.

## Interactions
- Click the header to collapse/expand.
- Bars, header ring, and health gauge animate on expand; reset on collapse.
- Click **Manage Locations** or any zone tile to open the centered storage workbench.
- Select or drag locations in the rail; tune physical capacity by range, stepper, or exact input.
- The rack aperture, pressure threshold, headroom, and operational recommendation respond immediately.
- Locations containing stock cannot be removed until their bottles are relocated.

## Notes
- Throwaway HTML. Mock data only; not wired to the app.
- Brand system: wine `#CD2D5B`, Plus Jakarta Sans, restrained motion, glass accents — per `ui-skill-consultant`.
- A lighter, already-shipped version of this direction is live in `Inventory.tsx`; this sketch pushes the header into "live command bar" territory and adds the animated QR scan-point.
