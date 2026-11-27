/**
 * /recommendations reads the same pos-revenue route the till does. For staff
 * the gateway sends the withheld body (#2096): posConnected true, from/to null,
 * dailySeries null. The ribbon must not say no day carries a record (ADR 0020):
 * the records exist and are kept to the owner and managers.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import Ribbon from './Ribbon';
import { buildDays, type PosVM } from './rec-days';

const NOW = new Date('2026-09-03T18:00:00.000Z');
// The exact withheld body #2096 sends, as useRecommendationsNextData builds the VM from it.
const WITHHELD: PosVM = { connected: true, from: '', to: '', byDay: {}, withheld: true };

const ribbon = (pos: PosVM) =>
  render(
    <Ribbon
      days={buildDays({ month: '2026-09', now: NOW, entries: [], goals: [], pos } as never)}
      month="2026-09"
      onMonth={vi.fn()}
      today="2026-09-03"
      selected={null}
      onSelect={vi.fn()}
      pos={pos}
      posProblem={null}
      exclusionsReadable
      exclusionsProblem={null}
      onExclude={vi.fn()}
      onInclude={vi.fn()}
      canRuleOut={false}
      undated={0}
      matching={0}
    />,
  );

describe('ribbon on a withheld till', () => {
  it('[REVERT-FAILS] says which days carry records is kept, not that none do', () => {
    ribbon(WITHHELD);
    expect(screen.getByText(/Which days carry records is kept to the owner and managers/)).toBeTruthy();
    expect(screen.queryByText(/Not one day in this window carries a record/)).toBeNull();
  });

  it('[REVERT-FAILS] marks every past day unknown, never none, on a withheld read with a real window', () => {
    const days = buildDays({ month: '2026-09', now: NOW, entries: [], goals: [], pos: { ...WITHHELD, from: '2026-08-13', to: '2026-09-03' } } as never);
    expect(days.filter((d) => !d.isFuture).every((d) => d.records === 'unknown')).toBe(true);
  });
});
