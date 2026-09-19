/**
 * "Who takes this?" — the owed act on `/recommendations`, and the fifth F4 act
 * the founder confirmed on 2026-09-06.
 *
 * THE SHAPE, AND WHY IT IS NOT AN EXPANSION. The docket already had an
 * assignment: an inline list of names inside the entry's opened work block. The
 * census gives the act a POPOVER, and the reason holds — ADR 0112's test is what
 * the overlay is FOR, and a short list hanging off a control belongs to that
 * control. The practical difference is not cosmetic: the inline list pushed the
 * rest of the work block down every time it opened, so the fact a reader was
 * comparing moved under their eyes at the moment they were choosing. Anchored,
 * nothing on the docket moves.
 *
 * IT IS NOT MODAL, AND IT MUST NOT BE. `Popover` is non-modal by default: no
 * scrim, no trap, tab off it and it goes. ADR 0112's one exception
 * (`InviteTeamDialog`) is a FORM that commits; this is a picker, which is the
 * shape's own case. The seal is nowhere near it — assignment commits no money
 * and sends no letter.
 *
 * THE ROSTER IS THE TEAM'S, AND ITS FOUR STATES ARE FOUR (the founder,
 * 2026-09-06). `undefined` is still reading, `null` is a read that FAILED, an
 * empty array is a real empty roster, and rows are rows. The three that are not
 * rows say different things, because "we could not read the roster" drawn as
 * "there is nobody to assign to" sends somebody to /team to add a teammate they
 * already have.
 *
 * WHAT IT WRITES. Nothing of its own: `onPick` hands the choice back to the
 * docket, which persists it through the same
 * `POST /analytics/recommendations/:restaurantId/action` the legacy page used
 * (`RecommendationsNext.tsx` — `assign`). One write path, so the popover and the
 * row can never disagree about who owns an entry.
 */

import { useRef, type RefObject } from 'react';
import { Popover } from '@/components/mudavym';
import type { TeamOption } from './useRecommendationsNextData';

export interface WhoTakesThisPopoverProps {
  open: boolean;
  onClose: () => void;
  /** The control it hangs off. */
  anchorRef: RefObject<HTMLElement | null>;
  /** undefined = still reading · null = the read FAILED · [] = a real empty roster. */
  team: TeamOption[] | null | undefined;
  /** Who has it now, so the list can mark them. */
  assignedTo: string | null;
  assignedName: string | null;
  /** `null` clears the assignment. */
  onPick: (member: TeamOption | null) => void;
}

/** What the roster says when it has no rows to show. Never a shrug. */
export function rosterWords(team: TeamOption[] | null | undefined): string | null {
  if (team === undefined) return 'Reading the roster…';
  if (team === null)
    return 'The roster could not be read, so nobody can be picked. That is a failed read, not a house with no team.';
  if (team.length === 0) return 'The roster is empty. Add a teammate on /team first.';
  return null;
}

export function WhoTakesThisPopover({
  open,
  onClose,
  anchorRef,
  team,
  assignedTo,
  assignedName,
  onPick,
}: WhoTakesThisPopoverProps) {
  const firstRef = useRef<HTMLButtonElement | null>(null);
  const said = rosterWords(team);

  return (
    <Popover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      /* The contract, as the accessible name. */
      label="This asks who takes this entry. Choosing a name records them as its owner on this house's docket. Leaving records nothing."
      eyebrow="Assign"
      title="Who takes this?"
      width={280}
      initialFocusRef={firstRef}
    >
      {said && (
        <p className="rc-said" data-testid="who-takes-said">
          {said}
        </p>
      )}

      {Array.isArray(team) &&
        team.map((m, i) => {
          const mine = assignedTo === m.id;
          return (
            <button
              key={m.id}
              ref={i === 0 ? firstRef : undefined}
              type="button"
              className="rc-quiet"
              data-testid="who-takes-member"
              aria-pressed={mine}
              onClick={() => {
                onPick(m);
                onClose();
              }}
              style={{ display: 'block', width: '100%', textAlign: 'left' }}
            >
              {m.name}
              {mine ? <span className="rc-micro"> · has it</span> : null}
            </button>
          );
        })}

      {/* "Nobody" is a real answer, and it is the LAST one — a list whose first
          row clears the assignment is a list you clear by mistake. */}
      {assignedTo && (
        <button
          type="button"
          className="rc-quiet"
          data-testid="who-takes-nobody"
          onClick={() => {
            onPick(null);
            onClose();
          }}
          style={{ display: 'block', width: '100%', textAlign: 'left' }}
        >
          Nobody — clear it{assignedName ? ` from ${assignedName}` : ''}
        </button>
      )}

      <p className="rc-said" data-testid="who-takes-foot">
        Assigning records an owner on the docket. It sends nothing and commits nothing.
      </p>
    </Popover>
  );
}

export default WhoTakesThisPopover;
