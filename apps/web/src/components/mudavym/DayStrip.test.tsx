/**
 * The house day strip's contract.
 *
 * The load-bearing tests are the ones that refuse to draw something. A day the
 * source was read for and that held nothing is HATCHED (`data-records="none"`);
 * a day nobody could read is plain; a day that has not happened is EMPTY, and
 * no page may override that — the two strips this component replaced disagreed
 * on exactly this, and only one of them had the rule at all.
 *
 * The keyboard block is the second half: `/notifications` had no keyboard map
 * whatsoever before this component, so every assertion below is a behaviour
 * that page gained by the merge.
 */

import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DayStrip, type DayStripDay } from './DayStrip';
import { monthDays, monthLabel, monthOf, recordWords, shiftMonth } from './dayStripDates';

const TODAY = '2026-09-03';

function Harness(props: {
  days?: Record<string, DayStripDay>;
  today?: string;
  onSelect?: (d: string | null) => void;
  startMonth?: string;
}) {
  const [month, setMonth] = useState(props.startMonth ?? '2026-09');
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <DayStrip
      month={month}
      onMonth={setMonth}
      today={props.today ?? TODAY}
      days={props.days ?? {}}
      selected={selected}
      onSelect={(d) => {
        setSelected(d);
        props.onSelect?.(d);
      }}
      label="Select a day"
    />
  );
}

const cells = () => screen.getAllByTestId('mdv-ds-day');
const cellFor = (date: string) =>
  cells()[monthDays('2026-09').indexOf(date)];

describe('the month is the window', () => {
  it('draws one whole calendar month, the 1st to the last', () => {
    render(<Harness />);
    expect(cells()).toHaveLength(30);
    expect(screen.getByTestId('mdv-ds-month')).toHaveTextContent('September 2026');
  });

  it('knows each month’s own length, leap year included', () => {
    expect(monthDays('2026-02')).toHaveLength(28);
    expect(monthDays('2028-02')).toHaveLength(29);
    expect(monthDays('2026-09')).toHaveLength(30);
    expect(monthDays('2026-12')).toHaveLength(31);
    expect(monthDays('not-a-month')).toEqual([]);
  });

  it('walks months, and wraps the year rather than minting month 13', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(monthLabel('2027-01')).toBe('January 2027');
  });

  it('offers a way back only once you have left this month', () => {
    render(<Harness />);
    expect(screen.queryByRole('button', { name: 'Back to this month' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show August 2026' }));
    expect(screen.getByTestId('mdv-ds-month')).toHaveTextContent('August 2026');
    expect(cells()).toHaveLength(31);
    fireEvent.click(screen.getByRole('button', { name: 'Back to this month' }));
    expect(screen.getByTestId('mdv-ds-month')).toHaveTextContent('September 2026');
  });
});

describe('what a blank day is allowed to mean', () => {
  it('hatches a day the source was READ for and that held nothing', () => {
    render(<Harness days={{ '2026-09-02': { records: 'none' } }} />);
    expect(cellFor('2026-09-02')).toHaveAttribute('data-records', 'none');
  });

  it('draws a day nobody could read as plain, not hatched', () => {
    render(<Harness days={{ '2026-09-02': { records: 'unknown' } }} />);
    expect(cellFor('2026-09-02')).toHaveAttribute('data-records', 'unknown');
  });

  it('says nothing about a day no page described', () => {
    render(<Harness />);
    expect(cellFor('2026-09-01')).toHaveAttribute('data-records', 'unknown');
  });

  it('REFUSES a page’s claim that a future day held nothing', () => {
    // This is the one rule a page cannot override. A day that has not happened
    // is neither a record nor an absence; hatching it would say the house
    // wrote nothing on a day it has not reached.
    render(<Harness days={{ '2026-09-20': { records: 'none' } }} />);
    const ahead = cellFor('2026-09-20');
    expect(ahead).toHaveAttribute('data-records', 'future');
    expect(ahead).toHaveAccessibleName(/neither a record nor an absence/);
  });

  it('puts the reason in the cell’s own title, in words', () => {
    render(
      <Harness
        days={{
          '2026-09-02': { records: 'none', says: '0 lines', struck: true },
          '2026-09-01': { records: 'yes' },
        }}
      />,
    );
    expect(cellFor('2026-09-02')).toHaveAccessibleName(
      'Wednesday 2 September — 0 lines — no record at all on this day — not a zero, nothing was written — out of the analysis',
    );
    expect(cellFor('2026-09-02')).toHaveAttribute('data-struck', 'true');
    expect(cellFor('2026-09-01')).toHaveAccessibleName(/a record landed on this day/);
  });

  it('marks today, and only today', () => {
    render(<Harness />);
    expect(cells().filter((c) => c.getAttribute('data-today') === 'true')).toHaveLength(1);
    expect(cellFor(TODAY)).toHaveAttribute('data-today', 'true');
  });

  it('recordWords never says zero, and never claims a future day is empty', () => {
    expect(recordWords('none', false)).toContain('not a zero');
    expect(recordWords('unknown', false)).toContain('not known');
    expect(recordWords('none', true)).toContain('neither a record nor an absence');
  });
});

describe('the page’s own slot', () => {
  it('draws whatever mark the page hands it, and nothing when it hands none', () => {
    render(
      <Harness days={{ '2026-09-02': { mark: <i data-testid="a-mark" /> } }} />,
    );
    expect(within(cellFor('2026-09-02')).getByTestId('a-mark')).toBeInTheDocument();
    expect(within(cellFor('2026-09-01')).queryByTestId('a-mark')).toBeNull();
  });

  it('renders the page’s aside and children around the strip', () => {
    render(
      <DayStrip
        month="2026-09"
        onMonth={() => {}}
        today={TODAY}
        days={{}}
        selected={null}
        onSelect={() => {}}
        label="Select a day"
        aside={<span>an aside</span>}
      >
        <p>a note under the strip</p>
      </DayStrip>,
    );
    expect(screen.getByText('an aside')).toBeInTheDocument();
    expect(screen.getByText('a note under the strip')).toBeInTheDocument();
  });
});

describe('selection is a controlled prop', () => {
  it('selects on click, and a second click clears it', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    fireEvent.click(cellFor('2026-09-02'));
    expect(onSelect).toHaveBeenLastCalledWith('2026-09-02');
    expect(cellFor('2026-09-02')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(cellFor('2026-09-02'));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('is one stop on the page’s tab order — a roving tabindex, not thirty stops', () => {
    render(<Harness />);
    expect(cells().filter((c) => c.getAttribute('tabindex') === '0')).toHaveLength(1);
    // and it starts on today, so the keyboard never begins somewhere the eye is not
    expect(cellFor(TODAY)).toHaveAttribute('tabindex', '0');
  });
});

describe('the keyboard map, in one place for both pages', () => {
  const strip = () => screen.getByRole('group', { name: 'Select a day' });

  it('moves a day with ← →, a week with ↑ ↓, and the ends with Home/End', () => {
    render(<Harness />);
    fireEvent.keyDown(strip(), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(cellFor('2026-09-04'));
    fireEvent.keyDown(strip(), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(cellFor('2026-09-03'));
    fireEvent.keyDown(strip(), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(cellFor('2026-09-10'));
    fireEvent.keyDown(strip(), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(cellFor('2026-09-03'));
    fireEvent.keyDown(strip(), { key: 'Home' });
    expect(document.activeElement).toBe(cellFor('2026-09-01'));
    fireEvent.keyDown(strip(), { key: 'End' });
    expect(document.activeElement).toBe(cellFor('2026-09-30'));
  });

  it('clamps inside the month rather than silently changing what the page reads', () => {
    render(<Harness />);
    fireEvent.keyDown(strip(), { key: 'Home' });
    fireEvent.keyDown(strip(), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(cellFor('2026-09-01'));
    fireEvent.keyDown(strip(), { key: 'End' });
    fireEvent.keyDown(strip(), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(cellFor('2026-09-30'));
  });

  it('selects with Enter and with Space, and toggles off on a second press', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    fireEvent.keyDown(strip(), { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith(TODAY);
    fireEvent.keyDown(strip(), { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith(null);
    fireEvent.keyDown(strip(), { key: ' ' });
    expect(onSelect).toHaveBeenLastCalledWith(TODAY);
  });

  it('clears the selection with Escape, and does nothing when nothing is selected', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    fireEvent.keyDown(strip(), { key: 'Escape' });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(strip(), { key: 'Enter' });
    onSelect.mockClear();
    fireEvent.keyDown(strip(), { key: 'Escape' });
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});

describe('the strip’s own arithmetic', () => {
  it('reads a month off a date without a timezone anywhere near it', () => {
    expect(monthOf('2026-09-01')).toBe('2026-09');
  });

  it('starts the roving focus on the 1st when today is in another month', () => {
    render(<Harness startMonth="2026-08" />);
    expect(screen.getAllByTestId('mdv-ds-day')[0]).toHaveAttribute('tabindex', '0');
  });
});
