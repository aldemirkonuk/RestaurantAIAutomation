import type { CSSProperties } from 'react';
import { defaultIdsFor } from './rp-readable';
import type { Slot } from './rp-sheet';

/**
 * The plain paper drawn while the reader's own arrangement is read.
 *
 * It is laid on the house sheet's own slots (the same columns and rows the
 * sheet is ruled on), so the sheet that replaces it lands where the outlines
 * were and the exports shelf and footer do not drop by the difference between
 * four boxes and the whole sheet (r41 gap 7). Still, on purpose: nothing here
 * is loading in a way the reader can act on.
 */

/** Where one outline sits on the ruling: grid lines are 1-based. */
export function outlinePlace(slot: Slot): CSSProperties {
  return {
    gridColumn: `${slot.x + 1} / span ${slot.w}`,
    gridRow: `${slot.y + 1} / span ${slot.h}`,
    // Narrow rulings stack the cuttings, each keeping its own height.
    ['--rp-rows' as string]: slot.h,
  };
}

export function SheetOutlines() {
  const { ids, slots } = defaultIdsFor(null);
  return (
    <div className="rp-outlines-frame">
      <div className="rp-outlines" role="status">
        <span className="rp-sr-only">Reading how you arranged this sheet…</span>
        {ids.map((id) => (
          <div key={id} className="rp-outline" style={outlinePlace(slots[id])} aria-hidden />
        ))}
      </div>
    </div>
  );
}
