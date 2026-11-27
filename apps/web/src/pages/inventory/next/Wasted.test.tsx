/**
 * r110 inventory g3: the Waste card's evidence lists what was written off,
 * totals by reason first, give-aways kept apart, money for a manager only,
 * and an unread read never reads as nothing.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { WastedEvidence, type WastedLoad } from './Wasted';
import type { HouseCurrency } from './useInventoryNextData';

const EUR: HouseCurrency = { state: 'recorded', code: 'EUR' };
afterEach(cleanup);

const waste = (over: Partial<Extract<WastedLoad, object>> = {}): WastedLoad => ({
  readable: true,
  qty30d: 1600,
  given30d: 300,
  value30d: 16,
  source: 's',
  total: 47,
  byReason: [
    { reason: 'Spoiled', type: 'waste', qty: 1200 },
    { reason: 'Broken', type: 'waste', qty: 400 },
    { reason: 'Staff meal', type: 'comp', qty: 300 },
  ],
  entries: [
    { at: '2026-11-03T12:00:00Z', type: 'waste', qty: 400, reason: 'Spoiled', by: 'Ayşe', value: 4 },
    { at: '2026-11-02T12:00:00Z', type: 'comp', qty: 300, reason: 'Staff meal', by: null, value: 3 },
    { at: '2026-11-01T12:00:00Z', type: 'waste', qty: 5, reason: null, by: 'Mert', value: null },
  ],
  ...over,
});

const draw = (load: WastedLoad, canManage = true) =>
  render(<WastedEvidence load={load} uom="g" canManage={canManage} currency={EUR} />);

describe('WastedEvidence (r110 g3)', () => {
  it('says the totals by reason first, give-aways apart, then the newest lines and how many there are', () => {
    draw(waste());
    expect(screen.getByTestId('ivd-wasted-by').textContent).toBe('Spoiled 1.2 kg · Broken 400 g');
    expect(screen.getByTestId('ivd-given-by').textContent).toBe('Given away, not counted as waste: Staff meal 300 g');
    const lines = [...screen.getByTestId('ivd-wasted-list').querySelectorAll('li')].map((li) => li.textContent);
    expect(lines[0]).toMatch(/^3 Nov · 400 g · Spoiled · Ayşe · .*4/);
    expect(lines[1]).toMatch(/^2 Nov · 300 g · given away · Staff meal · /);
    expect(lines[2]).toBe('1 Nov · 5 g · No reason given · Mert');
    expect(screen.getByTestId('ivd-wasted-count').textContent).toBe('3 newest of 47');
  });

  it('a staff member sees no money on any line', () => {
    draw(waste(), false);
    const text = screen.getByTestId('ivd-wasted').textContent ?? '';
    expect(text).not.toMatch(/€|EUR/);
    expect(screen.getByTestId('ivd-wasted-list').querySelector('li')!.textContent).toBe('3 Nov · 400 g · Spoiled · Ayşe');
  });

  it('a failed or absent read says it could not be read, and never 0 or nothing', () => {
    for (const load of ['failed', undefined, waste({ readable: false, entries: null, byReason: null, total: null }), waste({ entries: undefined })] as WastedLoad[]) {
      draw(load);
      const text = screen.getByTestId('ivd-wasted').textContent ?? '';
      expect(text).toContain('could not be read');
      expect(text).not.toMatch(/Nothing written off|\b0\b/);
      cleanup();
    }
  });

  it('an empty 30 days says so, and a whole list says all of it', () => {
    draw(waste({ total: 0, entries: [], byReason: [] }));
    expect(screen.getByTestId('ivd-wasted').textContent).toContain('Nothing written off or given away in the last 30 days.');
    cleanup();
    draw(waste({ total: 3 }));
    expect(screen.getByTestId('ivd-wasted-count').textContent).toBe('All 3 in the last 30 days');
  });
});
