/**
 * HeldBand — the held low-stock queue on the Mudavym day-book (founder,
 * 2026-09-26, round 8: built into the new page before the cutover).
 *
 * What this pins, against the legacy strip it replaces
 * (`pages/Notifications.tsx:925-983`):
 *  - three states, never two — a failed read is not an empty queue, and a
 *    refusal is told apart from a breakage;
 *  - the reason is WRITTEN on every line (legacy hid it in a hover `title`);
 *  - every held wine can be listed (legacy stopped at eight and "+N more");
 *  - it says when the wines will be told, or that they will not be;
 *  - each wine opens in inventory, and the settings that cause the hold are
 *    one link away — both reachable by keyboard, with labels a screen reader
 *    can read.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { HeldLowStockCrossing } from '@/services/api/notifications';
import { HELD_FIRST, HeldBand } from './HeldBand';
import { reasonWords, whenTold } from './nt-held';

const DAILY = { low_stock_enabled: true, frequency: 'daily' as const, hour: 12, timezone: 'America/New_York' };

function crossing(i: number, over: Partial<HeldLowStockCrossing> = {}): HeldLowStockCrossing {
  return {
    inventory_id: `inv-${i}`,
    wine_name: `Wine ${i}`,
    level: 'low',
    held_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    reason: 'prefs',
    ...over,
  };
}

function ready(held: HeldLowStockCrossing[], digest: unknown = DAILY) {
  return {
    state: 'ready' as const,
    view: {
      restaurant_id: 'r1',
      held,
      summary: {
        count: held.length,
        critical: held.filter((h) => h.level === 'critical').length,
        oldest_held_at: null,
      },
      digest: digest as never,
    },
    refresh: vi.fn(),
  };
}

function draw(held: Parameters<typeof HeldBand>[0]['held']) {
  return render(
    <MemoryRouter>
      <HeldBand held={held} />
    </MemoryRouter>,
  );
}

describe('HeldBand — states', () => {
  it('loading is busy and says what it is reading, without claiming anything', () => {
    draw({ state: 'loading', refresh: vi.fn() });
    const section = screen.getByRole('region', { name: /Held for the digest/ });
    expect(section).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText(/Reading the low-stock wines held/)).toBeInTheDocument();
    expect(screen.queryByText(/No wine is waiting/)).not.toBeInTheDocument();
  });

  it('a broken read is an alert with a retry — never an empty queue', () => {
    const refresh = vi.fn();
    draw({
      state: 'unreadable',
      failure: { status: 500, message: 'Request failed with status code 500', forbidden: false },
      refresh,
    });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/could not be read/);
    expect(alert).toHaveTextContent(/not a claim that none are waiting/);
    expect(screen.queryByText(/No wine is waiting/)).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole('button', { name: /Try again/ }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a refusal says so and offers no retry that cannot change it', () => {
    draw({
      state: 'unreadable',
      failure: { status: 403, message: 'Forbidden', forbidden: true },
      refresh: vi.fn(),
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/not allowed to read/);
    expect(screen.queryByRole('button', { name: /Try again/ })).not.toBeInTheDocument();
  });

  it('an empty queue is a stated fact, not a missing strip', () => {
    draw(ready([]));
    expect(screen.getByRole('heading', { name: /Held for the digest/ })).toBeInTheDocument();
    expect(screen.getByText(/No wine is waiting to be told about/)).toBeInTheDocument();
  });
});

describe('HeldBand — the held wines', () => {
  it('writes the count, the critical count and when they will be told', () => {
    draw(ready([crossing(1, { level: 'critical' }), crossing(2)]));
    expect(screen.getByText(/2 wines are below par and nobody has been told yet/)).toBeInTheDocument();
    expect(screen.getByText(/· 1 critical/)).toBeInTheDocument();
    expect(screen.getByText(/daily digest at 12 PM, New York time/)).toBeInTheDocument();
  });

  it('writes the reason on every line, in words (not only in a hover title)', () => {
    draw(
      ready([
        crossing(1, { reason: 'instant_cooldown' }),
        crossing(2, { reason: 'prefs' }),
        crossing(3, { reason: null }),
      ]),
    );
    expect(screen.getByText(/another alert went out in the last 15 minutes/)).toBeInTheDocument();
    expect(screen.getByText(/settings save low stock for the digest/)).toBeInTheDocument();
    expect(screen.getByText(/The reason was not recorded/)).toBeInTheDocument();
  });

  it(`shows the first ${HELD_FIRST}, and "Show all" lists every held wine`, () => {
    const rows = Array.from({ length: 9 }, (_, i) => crossing(i + 1));
    draw(ready(rows));
    const list = screen.getByRole('list', { name: /Wines held for the digest/ });
    expect(within(list).getAllByRole('listitem')).toHaveLength(HELD_FIRST);
    const toggle = screen.getByRole('button', { name: 'Show all 9' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', list.id);
    fireEvent.click(toggle);
    expect(within(list).getAllByRole('listitem')).toHaveLength(9);
    expect(screen.getByRole('button', { name: `Show the first ${HELD_FIRST}` })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('draws no toggle when every wine already fits', () => {
    draw(ready([crossing(1), crossing(2)]));
    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument();
  });

  it('each wine opens in inventory by the deep link the inventory page honours', () => {
    draw(ready([crossing(1, { wine_name: 'Château Musar 2017' })]));
    const link = screen.getByRole('link', { name: 'Find Château Musar 2017 in inventory' });
    expect(link).toHaveAttribute('href', `/inventory?wine=${encodeURIComponent('Château Musar 2017')}`);
  });

  it('an unnamed wine is named as such and offers no search it cannot aim', () => {
    draw(ready([crossing(1, { wine_name: null })]));
    expect(screen.getByText('Unnamed wine')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /in inventory/ })).not.toBeInTheDocument();
  });

  it('the settings that cause the hold are one link away', () => {
    draw(ready([crossing(1)]));
    expect(screen.getByRole('link', { name: /Change when low stock tells you/ })).toHaveAttribute(
      'href',
      '/settings?tab=notifications',
    );
  });

  it('a held line carries a machine-readable time', () => {
    const at = '2026-09-26T09:00:00.000Z';
    draw(ready([crossing(1, { held_at: at })]));
    expect(document.querySelector(`time[datetime="${at}"]`)).not.toBeNull();
  });
});

describe('whenTold / reasonWords', () => {
  it('never promises a digest it cannot read, or one that is off', () => {
    expect(whenTold(null)).toMatch(/could not be read/);
    expect(whenTold(undefined)).toMatch(/could not be read/);
    expect(whenTold({ ...DAILY, frequency: 'off' })).toMatch(/will not be sent on their own/);
    expect(whenTold({ ...DAILY, low_stock_enabled: false })).toMatch(/turned off for everyone/);
    expect(whenTold({ ...DAILY, hour: 17 })).toMatch(/5 PM/);
  });

  it('names an unknown reason as unrecorded', () => {
    expect(reasonWords(null)).toMatch(/not recorded/);
  });
});
