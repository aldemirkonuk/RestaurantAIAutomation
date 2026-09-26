/**
 * "Show me the N it could not place" — the menu lines the register reader
 * could not put in any register, on the /cellar registers view.
 *
 * OD-140, founder 2026-09-25: "Separate list endpoint"; round 4 item 18: the
 * control lives on /cellar, next to the registers — not on /house/menu, whose
 * three locked counts (ADR 0213 row 14) are a different rule and stay as they
 * are.
 *
 * The COUNT comes with the registers readout (`menuLines`, the same pass that
 * decided the registers above it). The LIST is a second read,
 * `GET /cellar/:rid/registers/unplaced`, made only when asked for. The gateway
 * builds both from one query and one filter, and a spec pins them equal; the
 * page still says so when they disagree, because the menu can change between
 * the two reads.
 *
 * States, kept apart (ADR 0020 / 0051):
 *   no field        — a readout that does not carry the tally: nothing claimed.
 *   menu unread     — `menuLines: null`: said as unknown, never as zero.
 *   empty menu      — 0 lines read: said as an empty menu, not "all placed".
 *   all placed      — a sentence, no control.
 *   some not placed — the count, the control, and on open: reading / a failed
 *                     read said as a failure / the lines / a mismatch note.
 */

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { count } from './cellar-format';
import {
  useUnplacedMenuLines,
  type MenuLineTallyVM,
  type SourceStatusVM,
} from './useCellarNextData';

function lines(n: number): string {
  return n === 1 ? 'line' : 'lines';
}

export default function UnplacedMenuLines({
  menuLines,
  menuSource,
}: {
  menuLines: MenuLineTallyVM | null | undefined;
  menuSource: SourceStatusVM | undefined;
}) {
  const [open, setOpen] = useState(false);
  const regionId = 'cl-unplaced-lines';

  if (menuLines === undefined) return null;

  if (menuLines === null) {
    return (
      <p className="cl-note" role="status" data-testid="menu-lines-unread">
        <AlertTriangle size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 5 }} />
        This house’s menu could not be read
        {menuSource?.reason ? ` (${menuSource.reason})` : ''}, so how many of its lines the
        reader placed in a register is unknown — not zero.
      </p>
    );
  }

  if (menuLines.read === 0) {
    return (
      <p className="cl-note" data-testid="menu-lines-empty">
        This house’s menu has no lines yet, so the reader had nothing to place in a register.
      </p>
    );
  }

  if (menuLines.notPlaced === 0) {
    return (
      <p className="cl-note" data-testid="menu-lines-all-placed">
        The reader placed every one of the {count(menuLines.read)} menu{' '}
        {lines(menuLines.read)} in a register.
      </p>
    );
  }

  const n = menuLines.notPlaced;
  return (
    <div className="cl-unplaced" data-testid="menu-lines-not-placed">
      <p className="cl-said">
        {count(n)} of the {count(menuLines.read)} menu {lines(menuLines.read)} could not be placed
        in any register. They stay on the menu as they are; nothing is placed for you.
      </p>
      <button
        type="button"
        className="cl-btn cl-focus"
        style={{ marginTop: 8 }}
        aria-expanded={open}
        aria-controls={regionId}
        data-on={open ? 'true' : 'false'}
        onClick={() => setOpen((was) => !was)}
      >
        {open ? `Hide the ${lines(n)} it could not place` : `Show me the ${count(n)} it could not place`}
      </button>
      {open ? <UnplacedList id={regionId} count={n} /> : null}
    </div>
  );
}

/**
 * The list itself, mounted only while the disclosure is open — so the read
 * happens when asked for, and a closed control costs no request.
 */
function UnplacedList({ id, count: n }: { id: string; count: number }) {
  const list = useUnplacedMenuLines();
  return (
    <div id={id} data-testid="unplaced-lines" style={{ marginTop: 8 }}>
      {list.loading ? (
        <p className="cl-said" role="status">
          Reading the {lines(n)} it could not place…
        </p>
      ) : list.error !== null ? (
        <p className="cl-said" role="alert" data-testid="unplaced-lines-error">
          <AlertTriangle size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 5 }} />
          The {lines(n)} could not be read ({list.error}), so this does not say which they are.
          The count above still stands.
        </p>
      ) : list.data ? (
        <>
          {list.data.lines.length !== n ? (
            <p className="cl-note" role="status" data-testid="unplaced-lines-changed">
              The menu changed since the count above: this read finds{' '}
              {count(list.data.lines.length)} of {count(list.data.read)} {lines(list.data.read)} it
              could not place.
            </p>
          ) : null}
          {list.data.lines.length > 0 ? (
            <ol className="cl-unplaced-list">
              {list.data.lines.map((line) => (
                <li key={line.id}>
                  <span>{line.name?.trim() || 'A line with no name'}</span>
                  <span className="cl-dim">
                    {line.category?.trim() ? `under “${line.category.trim()}”` : 'no section'}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="cl-note">The reader now places every line on this house’s menu.</p>
          )}
        </>
      ) : null}
    </div>
  );
}
