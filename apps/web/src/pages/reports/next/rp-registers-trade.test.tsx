/**
 * The till on the house's day (ADR 0296, F-086).
 *
 * The gateway now files each check on the date its house's clock read when it
 * closed, else when it opened, and answers `timezone` (the zone it filed in)
 * and `zoneUnset` (a house with no zone, whose figures are not stated). These
 * cases pin how the till register reads both: a house with no zone says so,
 * points to Settings and draws nothing; a house with one names it in the
 * basis; and a payload from before ADR 0296, with neither key, reads exactly
 * as it did.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { till, type TillWindow } from './rp-registers-trade';

const ctx = { days: 30 };

const OLD_PAYLOAD = {
  restaurantId: 'r1',
  from: '2026-08-03',
  to: '2026-09-01',
  days: 30,
  posConnected: true,
  revenue: 15146.2,
  checkCount: 98,
  dailySeries: [
    { date: '2026-07-01', revenue: 10945 },
    { date: '2026-08-22', revenue: 4201.2 },
  ],
};

const read = (raw: unknown) => till.select(raw) as TillWindow;

describe('the till — a sale belongs to the house day (ADR 0296)', () => {
  it('reads the zone and the zone-unset flag off the payload', () => {
    expect(read({ ...OLD_PAYLOAD, timezone: 'America/Los_Angeles', zoneUnset: false })).toMatchObject({
      timezone: 'America/Los_Angeles',
      zoneUnset: false,
    });
    expect(read({ ...OLD_PAYLOAD, from: null, to: null, timezone: null, zoneUnset: true })).toMatchObject({
      timezone: null,
      zoneUnset: true,
    });
  });

  it('says a house with no zone has no days to file, links to the time-zone setting, and draws no figure', () => {
    const view = till.view(
      read({
        restaurantId: 'r1',
        from: null,
        to: null,
        days: 30,
        timezone: null,
        zoneUnset: true,
        posConnected: true,
        revenue: null,
        checkCount: null,
        dailySeries: [],
      }),
      ctx,
    );
    expect(view.figures).toEqual([]);
    expect(view.basis).toEqual([]);
    expect(view.cats).toBeUndefined();
    expect(view.matrix).toBeUndefined();
    expect(view.table).toBeUndefined();

    render(<MemoryRouter>{view.say}</MemoryRouter>);
    expect(
      screen.getByText(/This house’s time zone isn’t set, so no sale can be filed on the house’s day yet/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set the time zone in Settings' })).toHaveAttribute(
      'href',
      '/settings?tab=time-zone',
    );
  });

  it('still says "no POS" first for a house with neither a till nor a zone', () => {
    const view = till.view(
      read({ ...OLD_PAYLOAD, posConnected: false, revenue: null, checkCount: null, dailySeries: [], timezone: null, zoneUnset: true }),
      ctx,
    );
    render(<MemoryRouter>{view.say}</MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Connect a till in Settings' })).toHaveAttribute(
      'href',
      '/settings?tab=pos',
    );
  });

  it("names the house's zone in the basis", () => {
    const view = till.view(read({ ...OLD_PAYLOAD, timezone: 'America/Los_Angeles', zoneUnset: false }), ctx);
    expect(view.basis[0]).toBe(
      "Non-voided pos_checks.total between 2026-08-03 and 2026-09-01, each check filed on the house's day in America/Los_Angeles by when it closed, else when it opened.",
    );
    expect(view.figures.map((f) => f.label)).toEqual(['Taken', 'Checks', 'Average check']);
  });

  it('reads a payload from before ADR 0296 as it always did', () => {
    const w = read(OLD_PAYLOAD);
    expect(w).toMatchObject({ timezone: null, zoneUnset: false });
    const view = till.view(w, ctx);
    expect(view.basis[0]).toBe('Non-voided pos_checks.total between 2026-08-03 and 2026-09-01.');
    expect(view.figures.map((f) => f.label)).toEqual(['Taken', 'Checks', 'Average check']);
    expect(view.table?.rows.map((r) => r.key)).toEqual(['2026-07-01', '2026-08-22']);
  });
});
