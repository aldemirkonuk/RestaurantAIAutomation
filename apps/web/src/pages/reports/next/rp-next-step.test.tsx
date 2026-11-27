/**
 * r36 reports audit, gap 5: day 1 was a wall of true sentences with no next
 * step. Each empty register now ends with where its figures come from, as a
 * link to the act; a register with figures carries none.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { CATALOGUE } from './rp-catalogue';
import type { AnalysisId } from './rp-sheet';

function say(id: AnalysisId, raw: unknown) {
  const spec = CATALOGUE[id];
  const view = spec.view(spec.select(raw), { days: 30 });
  render(<MemoryRouter>{view.say as ReactNode}</MemoryRouter>);
  return view;
}
const href = (name: RegExp) => screen.getByRole('link', { name }).getAttribute('href');
const links = () => screen.queryAllByRole('link').map((a) => a.getAttribute('href'));

describe('an empty register says where its figures come from (r36 gap 5)', () => {
  it('[REVERT-FAILS] spend pacing with no delivered order sends the reader to Orders', () => {
    say('pacing', { spendLast30d: 0, spendPrev30d: 0 });
    expect(screen.getByText(/No delivered purchase order falls in either 30-day window/)).toBeInTheDocument();
    expect(href(/Record a delivery on Orders/)).toBe('/orders');
  });

  it('the week with no consumption names both sources: the till and the match to goods', () => {
    say('week', { weekdayProfile: [] });
    expect(href(/Connect the till in Settings/)).toBe('/settings?tab=pos');
    expect(href(/match its items to goods on Inventory/)).toBe('/inventory');
  });

  it('the week that reads zero on every weekday says the same', () => {
    say('week', {
      weekdayProfile: ['Monday', 'Tuesday'].map((day) => ({ day, mean: 0, stdev: null, n: 3 })),
      tie: false,
    });
    expect(links()).toEqual(['/settings?tab=pos', '/inventory']);
  });

  it('nothing projected from an empty history names the consumption step', () => {
    say('ahead', { modelFitted: false, forecast: [], history: { dates: ['2026-11-01'], values: [0] } });
    expect(links()).toEqual(['/settings?tab=pos', '/inventory']);
  });

  it('nothing projected from a history WITH movement adds no step: the feed is not what is missing', () => {
    const v = say('ahead', { modelFitted: false, forecast: [], history: { dates: ['2026-11-01'], values: [2] } });
    expect(typeof v.say).toBe('string');
    expect(links()).toEqual([]);
  });

  it('the reading with no sentence points at Get started', () => {
    say('reading', []);
    expect(href(/Start with Get started/)).toBe('/get-started');
  });

  it('a register with figures carries no step', () => {
    const v = CATALOGUE.pacing.view(CATALOGUE.pacing.select({ spendLast30d: 120, spendPrev30d: 80 }), { days: 30 });
    expect(v.say).toBeUndefined();
  });
});
