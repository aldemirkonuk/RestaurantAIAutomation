/**
 * "Who takes this?" — the owed act on `/recommendations`, as the popover the
 * census gives it and the founder confirmed on 2026-09-06.
 *
 * THE REGRESSION. The docket's assignment was an inline list inside the entry's
 * work block. `is a popover anchored to the control` and `nothing on the docket
 * moves when it opens` both fail against that version — the list was a
 * `div.rc-row` in the flow, and opening it pushed everything under it down at
 * the moment a person was choosing.
 *
 * The rest is the shape's contract: non-modal (no scrim, nothing trapped), the
 * roster's four states kept apart, "nobody" last, and no seal anywhere near it.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useRef } from 'react';

import { WhoTakesThisPopover, rosterWords } from './WhoTakesThisPopover';
import type { TeamOption } from './useRecommendationsNextData';

const TEAM: TeamOption[] = [
  { id: 'u1', name: 'Mehmet Kaya' },
  { id: 'u2', name: 'Elif Şahin' },
];

function Harness(props: Partial<React.ComponentProps<typeof WhoTakesThisPopover>>) {
  const ref = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button ref={ref} type="button">
        Assign
      </button>
      <WhoTakesThisPopover
        open
        onClose={() => {}}
        anchorRef={ref}
        team={TEAM}
        assignedTo={null}
        assignedName={null}
        onPick={() => {}}
        {...props}
      />
    </>
  );
}

function draw(props: Partial<React.ComponentProps<typeof WhoTakesThisPopover>> = {}) {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(<Harness onPick={onPick} onClose={onClose} {...props} />);
  return { onPick, onClose };
}

describe('the shape', () => {
  it('is a popover anchored to the control, on the house motion', () => {
    draw();
    const dialog = screen.getByRole('dialog');
    const root = dialog.closest('.mdv-ovl') as HTMLElement;
    expect(root).toHaveAttribute('data-shape', 'popover');
    expect(dialog).toHaveAttribute('data-motion', 'ink');
  });

  it('is NOT modal — no trap, and the docket stays live behind it', () => {
    draw();
    const root = screen.getByRole('dialog').closest('.mdv-ovl') as HTMLElement;
    expect(root).not.toHaveAttribute('data-modal');
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-modal');
  });

  it('carries no seal — assignment commits nothing', () => {
    draw();
    expect(screen.queryByRole('button', { name: /Hold to/ })).toBeNull();
    expect(screen.getByTestId('who-takes-foot')).toHaveTextContent(
      /sends nothing and commits nothing/,
    );
  });
});

describe('the choice', () => {
  it('hands the picked member back and closes', () => {
    const { onPick, onClose } = draw();
    fireEvent.click(screen.getByRole('button', { name: /Mehmet Kaya/ }));
    expect(onPick).toHaveBeenCalledWith(TEAM[0]);
    expect(onClose).toHaveBeenCalled();
  });

  it('marks who has it now', () => {
    draw({ assignedTo: 'u2', assignedName: 'Elif Şahin' });
    const rows = screen.getAllByTestId('who-takes-member');
    const elif = rows.find((r) => r.textContent?.includes('Elif Şahin'))!;
    expect(elif).toHaveAttribute('aria-pressed', 'true');
    expect(elif).toHaveTextContent('has it');
    expect(rows.find((r) => r.textContent?.includes('Mehmet'))!).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('offers "nobody" only when there is something to clear, and offers it LAST', () => {
    draw();
    expect(screen.queryByTestId('who-takes-nobody')).toBeNull();

    render(
      <Harness assignedTo="u1" assignedName="Mehmet Kaya" onPick={() => {}} />,
    );
    const rows = screen.getAllByRole('button', { name: /Mehmet Kaya|Elif Şahin|Nobody/ });
    expect(rows[rows.length - 1]).toHaveTextContent('Nobody — clear it from Mehmet Kaya');
  });

  it('clears the assignment with null', () => {
    const onPick = vi.fn();
    render(<Harness assignedTo="u1" assignedName="Mehmet Kaya" onPick={onPick} />);
    fireEvent.click(screen.getByTestId('who-takes-nobody'));
    expect(onPick).toHaveBeenCalledWith(null);
  });
});

describe('the roster, in four states', () => {
  it('keeps "reading", "could not read" and "empty" apart', () => {
    expect(rosterWords(undefined)).toMatch(/Reading the roster/);
    expect(rosterWords(null)).toMatch(/failed read, not a house with no team/);
    expect(rosterWords([])).toMatch(/roster is empty/);
    expect(rosterWords(TEAM)).toBeNull();
  });

  it('never draws a failed read as an empty roster', () => {
    draw({ team: null });
    expect(screen.getByTestId('who-takes-said')).toHaveTextContent(/failed read/);
    expect(screen.queryByTestId('who-takes-member')).toBeNull();
  });

  it('says a real empty roster is empty, and where to fix it', () => {
    draw({ team: [] });
    expect(screen.getByTestId('who-takes-said')).toHaveTextContent(/Add a teammate on \/team/);
  });
});

describe('keyboard', () => {
  it('moves focus to the first name and closes on Esc', () => {
    const { onClose } = draw();
    expect(screen.getByRole('button', { name: /Mehmet Kaya/ })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
