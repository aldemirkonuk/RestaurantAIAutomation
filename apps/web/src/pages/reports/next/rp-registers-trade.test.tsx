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
 *
 * The second block is ADR 0296's other web case, a goal's pace in a house
 * with no zone, on the goals desk and the recommendations margin. It sits in
 * this file so the PR stays within its 15 files.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { till, type TillWindow } from './rp-registers-trade';
import { goals, paceCaption, type GoalsRegister } from './rp-registers-goals';
import type { GoalsDesk } from './useGoalsDesk';
import { paceOf, toProgressRow } from '@/pages/recommendations/next/rec-masthead';

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

/** The gateway's sentence (`house-day.ts` HOUSE_ZONE_UNSET_PACE), as it arrives. */
const NO_ZONE_PACE =
  "This house's time zone isn't set, so the deadline has no midnight on the house's clock and the pace is not judged. An owner or manager can set it in Settings, under Time zone.";

/** A days-of-stock goal with a deadline, scored in a house with no zone. */
const STOCK = {
  goal: {
    id: 'g-stock',
    name: 'Days of stock',
    metric_key: 'days_of_inventory',
    direction: 'at_most',
    deadline: '2026-09-30',
    period: 'custom',
  },
  metricLabel: 'Days of stock',
  unit: 'days',
  current: 42,
  target: 30,
  progressPct: 1.4,
  expectedByNow: null,
  onTrack: null,
  daysLeft: null,
  paceUnread: NO_ZONE_PACE,
  projectedAtDeadline: null,
  projectionHitsTarget: null,
};
const NO_DEADLINE = { ...STOCK, goal: { ...STOCK.goal, deadline: null }, paceUnread: null };

const book = (...rows: unknown[]) =>
  goals.select({ status: 'active', goals: rows, total: rows.length }) as GoalsRegister;

/** A read-only desk: the card's sentences are what is under test. */
const desk = {
  canWrite: false,
  readOnlyReason: null,
  busy: null,
  error: null,
  asking: null,
  proposal: null,
} as unknown as GoalsDesk;

describe("a goal's pace in a house with no time zone (ADR 0296)", () => {
  it('reads the reason off the payload, and a payload without one as none', () => {
    expect(book(STOCK).goals[0].paceUnread).toBe(NO_ZONE_PACE);
    const old: Record<string, unknown> = { ...STOCK };
    delete old.paceUnread;
    expect(book(old).goals[0].paceUnread).toBeNull();
  });

  it('says why a goal with a deadline has no pace, and never "No deadline" or "not enough history"', () => {
    const view = goals.view(book(STOCK), { days: 30, goals: desk });
    render(<MemoryRouter>{view.node}</MemoryRouter>);
    expect(screen.getByText(/· by 2026-09-30/)).toBeInTheDocument();
    expect(screen.getByText(NO_ZONE_PACE)).toBeInTheDocument();
    expect(screen.queryByText(/No deadline/)).toBeNull();
    expect(screen.queryByText(/not enough history/)).toBeNull();
  });

  it('says the pace was not computed when a deadline has no pace and no reason came with it', () => {
    expect(paceCaption(book({ ...STOCK, paceUnread: null }).goals[0])).toBe(
      'The pace against this deadline was not computed.',
    );
  });

  it('still says "No deadline" for a goal with none, and reads a paced goal as before', () => {
    expect(paceCaption(book(NO_DEADLINE).goals[0])).toBe(
      'No deadline, so there is no schedule to be ahead or behind of.',
    );
    expect(paceCaption(book({ ...STOCK, onTrack: true, daysLeft: 29, paceUnread: null }).goals[0])).toBe(
      'On the pace this goal needs, 29 days left. There is not enough history to project the deadline, so none is drawn.',
    );
  });

  it('keeps the summary tile from saying no goal carries a deadline when one does', () => {
    const note = (reg: GoalsRegister) => goals.view(reg, { days: 30 }).figures?.find((f) => f.label === 'On pace')?.note;
    expect(note(book(STOCK))).toBe('no goal’s pace was judged; each goal says why');
    expect(note(book(NO_DEADLINE))).toBe('no goal carries a deadline, so none has a pace');
  });

  it('calls it "Pace unknown" in the recommendations margin, and keeps "No deadline" for a goal with none', () => {
    expect(paceOf(toProgressRow(STOCK))).toBe('Pace unknown');
    expect(paceOf(toProgressRow(NO_DEADLINE))).toBe('No deadline');
  });
});
