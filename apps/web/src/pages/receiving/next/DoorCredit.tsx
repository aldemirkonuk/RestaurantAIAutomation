/**
 * DoorCredit — the credit request, already drafted, explicitly unsent
 * (spec point 4, in --calm).
 *
 * Appears only when the outcome is short-shipped or refused. The receiver
 * never writes an email — the draft is composed from what the door already
 * knows (the count, the delta, the reason, the photo, who signed) and rides
 * to the desk in the receipt's notes; a manager approves and sends it later.
 * The card says "unsent" in plain words because a receiver who believes an
 * email just went to the vendor will start arguing with the driver about it.
 *
 * The card expands on `settle` (grid-rows 0fr→1fr — the house expansion);
 * reduced motion collapses to an instant swap via the CSS override in
 * DoorNext's stylesheet block.
 */

import { useEffect, useRef, useState } from 'react';
import { SERIF } from './DoorModel';

export interface DoorCreditProps {
  /** The drafted sentence — null hides the card. */
  draft: string | null;
  driverName: string;
  onDriverName: (v: string) => void;
}

export function DoorCredit({ draft, driverName, onDriverName }: DoorCreditProps) {
  const open = draft !== null;
  // Keep the last non-null draft while collapsing, so the text doesn't vanish
  // before the row has finished closing.
  const [held, setHeld] = useState(draft);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (draft !== null) {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      setHeld(draft);
    } else {
      closeTimer.current = setTimeout(() => setHeld(null), 360);
    }
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [draft]);

  return (
    <div
      className="door-settle-rows grid"
      style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      aria-hidden={!open}
    >
      <div className="overflow-hidden">
        <div className="mt-5 rounded-2xl border border-seal-ring bg-paper-1 p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-inkm-3">
            Credit request — drafted, unsent
          </p>
          <p
            className="mt-2 text-[14.5px] leading-relaxed text-inkm-2"
            style={{ fontFamily: SERIF }}
            data-ux-key="door:credit-draft"
          >
            {held}
          </p>
          <label className="mt-3 block">
            <span className="text-xs font-semibold text-inkm-3">
              Driver's name — if they gave one
            </span>
            <input
              type="text"
              value={driverName}
              onChange={(e) => onDriverName(e.target.value)}
              placeholder="Optional"
              autoComplete="off"
              enterKeyHint="done"
              // door-input: overrides the global white-input !important rule
              // from styles/globals.css — see DOOR_CSS in DoorNext.tsx.
              className="door-input mt-1 w-full min-h-[48px] rounded-xl border border-white/10 px-3 text-[16px] focus:border-seal-ring focus:outline-none"
              data-ux-key="door:driver-name"
            />
          </label>
          <p className="mt-3 text-xs text-inkm-3">
            Nothing goes to the vendor from the door. A manager reviews and sends this.
          </p>
        </div>
      </div>
    </div>
  );
}

export default DoorCredit;
