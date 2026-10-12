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
 * with no zone, on the goals desk (its reason, with the till's time-zone
 * Settings link beside it) and the recommendations margin. It also holds the
 * same link beside a goal that could not be scored for want of a zone. It
 * sits in this file so the PR stays within its 15 files.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  TILL_REFUNDS_NOT_TAKEN_OFF,
  TILL_TOTALS_NOT_NET,
  pacing,
  till,
  tillUntotaledSaid,
  week,
  type TillWindow,
  type WeekRegister,
} from './rp-registers-trade';
import {
  AMOUNTS_WITHHELD,
  REGISTER_TIP_ON_NET,
  REGISTER_TOTALS_NOT_NET,
  ledger,
  quadrants,
  seats,
  service,
  zeroChecksSaid,
  type LedgerRegister,
  type SeatsRegister,
  type ServiceRegister,
} from './rp-registers-house';
import { bench } from './rp-registers-bench';
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

describe('the till says refunds are not taken off Taken (F-446)', () => {
  it('prints the refund note beside a Taken figure, in the export file’s words', () => {
    const view = till.view(read({ ...OLD_PAYLOAD, timezone: 'America/Los_Angeles', zoneUnset: false }), ctx);
    expect(view.notes).toEqual([TILL_TOTALS_NOT_NET, TILL_REFUNDS_NOT_TAKEN_OFF]);
    expect(TILL_REFUNDS_NOT_TAKEN_OFF).toBe(
      "Refunds are not taken off. Mudavym does not hear about refunds from your till yet, so Taken is what was rung up, before any money given back. Check your till's own refund report before you hand this on as net takings.",
    );
  });

  it('says it on a window with a total and no daily rows, too', () => {
    const view = till.view(read({ ...OLD_PAYLOAD, revenue: 0, dailySeries: [] }), ctx);
    expect(view.notes).toEqual([TILL_TOTALS_NOT_NET, TILL_REFUNDS_NOT_TAKEN_OFF]);
  });

  it('says nothing about refunds when there is no Taken figure to qualify', () => {
    expect(till.view(read({ ...OLD_PAYLOAD, revenue: null, dailySeries: [] }), ctx).notes).toEqual([]);
    expect(till.view(read({ ...OLD_PAYLOAD, posConnected: false, revenue: null }), ctx).notes).toEqual([]);
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

  it("draws the till's time-zone Settings link beside the no-zone pace reason, and beside no other caption", () => {
    /** The goal card's link to the time-zone setting, or null when it draws none. */
    const zoneLink = (row: unknown) => {
      const { unmount } = render(<MemoryRouter>{goals.view(book(row), { days: 30, goals: desk }).node}</MemoryRouter>);
      const link = screen.queryByRole('link', { name: 'Set the time zone in Settings' });
      const found = link && { href: link.getAttribute('href'), caption: link.closest('p')?.textContent };
      unmount();
      return found;
    };
    expect(zoneLink(STOCK)).toEqual({
      href: '/settings?tab=time-zone',
      caption: `${NO_ZONE_PACE} Set the time zone in Settings`,
    });
    // A house with a zone: the gateway judged the pace and sent no reason.
    expect(zoneLink({ ...STOCK, onTrack: true, daysLeft: 29, paceUnread: null })).toBeNull();
    // A deadline with no pace and no reason: the "not computed" caption.
    expect(zoneLink({ ...STOCK, paceUnread: null })).toBeNull();
    // A reason with no deadline: the caption is "No deadline", which needs no
    // zone, so no link — even if a reason rode along.
    expect(zoneLink({ ...NO_DEADLINE, paceUnread: NO_ZONE_PACE })).toBeNull();
    // A judged pace beside a stray reason: the caption is the judgement
    // ("Behind the pace…"), not the reason, so no link.
    expect(zoneLink({ ...STOCK, onTrack: false, daysLeft: 3 })).toBeNull();
  });

  it('draws the same link beside a goal that could not be scored for want of a zone, and beside no other reason', () => {
    /** The gateway's sentence (`house-day.ts` HOUSE_ZONE_UNSET), as it arrives. */
    const NO_ZONE =
      "This house's time zone isn't set, so no sale can be filed on the house's day yet. An owner or manager can set it in Settings, under Time zone.";
    const covers = { ...STOCK.goal, id: 'g-covers', name: 'Covers', metric_key: 'checks', direction: 'at_least' };
    /** The card's link to the time-zone setting, with its paragraph, or null. */
    const zoneLink = (row: unknown) => {
      const { unmount } = render(<MemoryRouter>{goals.view(book(row), { days: 30, goals: desk }).node}</MemoryRouter>);
      const link = screen.queryByRole('link', { name: 'Set the time zone in Settings' });
      const found = link && { href: link.getAttribute('href'), caption: link.closest('p')?.textContent };
      unmount();
      return found;
    };
    expect(zoneLink({ goal: covers, unreadable: true, reason: NO_ZONE, zoneUnset: true })).toEqual({
      href: '/settings?tab=time-zone',
      caption: `This goal could not be scored (${NO_ZONE}). Nothing below it is claimed. Set the time zone in Settings`,
    });
    // Another reason, such as a refused read: no link.
    expect(
      zoneLink({ goal: covers, unreadable: true, reason: 'The POS checks in this window could not be read whole.', zoneUnset: false }),
    ).toBeNull();
    // A gateway from before the flag sends the sentence without it: no link.
    expect(zoneLink({ goal: covers, unreadable: true, reason: NO_ZONE })).toBeNull();
    // The flag is read only off an entry that could not be scored.
    expect(book({ ...STOCK, zoneUnset: true }).goals[0].zoneUnset).toBe(false);
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

describe("the week's shape — a bottle belongs to the house day (F-185)", () => {
  const readWeek = (raw: unknown) => week.select(raw) as WeekRegister;

  it('says a house with no zone has no weekdays to file on, links to the setting, and never says nothing was sold', () => {
    const view = week.view(
      readWeek({
        weekdayProfile: [],
        bestDay: null,
        worstDay: null,
        tie: false,
        trendPerDayPct: null,
        timezone: null,
        zoneUnset: true,
        basis: { weekday: 'This house’s time zone isn’t set.' },
      }),
      ctx,
    );
    expect(view.figures).toEqual([]);
    expect(view.cats).toBeUndefined();
    render(<MemoryRouter>{view.say}</MemoryRouter>);
    expect(screen.getByText(/no bottle can be filed on a weekday yet/)).toBeInTheDocument();
    expect(screen.queryByText(/No consumption is recorded/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Set the time zone in Settings' })).toHaveAttribute(
      'href',
      '/settings?tab=time-zone',
    );
  });

  it('reads a payload without the flag as a house with a zone', () => {
    expect(readWeek({ weekdayProfile: [] }).zoneUnset).toBe(false);
  });
});

/*
 * F-203: the gateway sends a staff reader each money lens with its prices,
 * costs, margins and spend left out and `amountsWithheld: true`. These cases
 * pin that the registers then draw no money at all — no em-dashed money
 * figure, no bar of spend, no margin axis — and say plainly why. They sit in
 * this file so the lane stays within its 15 files.
 */
describe('a staff reader sees no house money on /reports (F-203)', () => {
  const said = (v: { say?: unknown; notes: unknown[] }) =>
    [String(v.say ?? ''), ...v.notes.map(String)].join(' ');

  it('spend pacing keeps the pace and open orders, and draws no spend', () => {
    const c = pacing.select({ paceDeltaPct: 12, openOrderCount: 3, amountsWithheld: true });
    const v = pacing.view(c, ctx);
    expect(v.figures.map((f) => f.label)).toEqual(['Pace', 'Open orders']);
    expect(v.cats).toBeUndefined();
    expect(v.table).toBeUndefined();
    expect(said(v)).toContain(AMOUNTS_WITHHELD);
    expect(said(v)).not.toMatch(/Projected|No delivered purchase order/);
  });

  it('margin against movement draws no margin axis and keeps the quadrant counts', () => {
    const q = quadrants.select({
      amountsWithheld: true,
      counts: { star: 2, dog: 1, unclassified: 0 },
      medians: { velocityPerDay: 0.4 },
      items: [{ id: 'i1', name: 'Barolo', velocityPerDay: 0.5, quadrant: 'star' }],
    });
    const v = quadrants.view(q, ctx);
    expect(v.points).toBeUndefined();
    expect(v.cats).toBeUndefined();
    expect(String(v.say)).toContain(AMOUNTS_WITHHELD);
    expect(String(v.say)).not.toMatch(/no margin axis|recorded cost/);
    expect(v.figures.find((f) => f.label === 'Stars')?.value).toBe('2');
  });

  it('the books keep turns and days, and print no money figure', () => {
    const f = ledger.select({ amountsWithheld: true, inventoryTurnover: 4.1, daysInventoryOutstanding: 89 });
    const v = ledger.view(f, ctx);
    expect(v.figures.map((x) => x.label)).toEqual(['Inventory turns', 'Days of inventory']);
    expect(v.notes).toEqual([AMOUNTS_WITHHELD]);
  });

  // F-701: a delivered order with no price is left out of Cost of goods and
  // the page says how many, the way it names the cellar's missing costs.
  it('says how many delivered orders Cost of goods leaves out for want of a price', () => {
    const base = { cogs: 1200, costCoverage: { total: 3, priced: 3, unpriced: 0, complete: true } };
    const two = ledger.view(ledger.select({ ...base, cogsUnpricedCount: 2 }), ctx);
    expect(two.notes).toEqual([
      '2 delivered orders carry no price, so Cost of goods leaves them out and is short by what they cost. Inventory turns and Days of inventory are not taken from it.',
    ]);
    const one = ledger.view(ledger.select({ ...base, cogsUnpricedCount: 1 }), ctx);
    expect(String(one.notes)).toContain('1 delivered order carries no price');
    // Every order priced, or a gateway that sends no count: no note.
    expect(ledger.view(ledger.select({ ...base, cogsUnpricedCount: 0 }), ctx).notes).toEqual([]);
    expect(ledger.view(ledger.select(base), ctx).notes).toEqual([]);
    // Staff read no money, so no note about it either.
    expect(
      ledger.view(ledger.select({ amountsWithheld: true, cogsUnpricedCount: 2 }), ctx).notes,
    ).toEqual([AMOUNTS_WITHHELD]);
  });

  it('against ourselves drops the buying figures, row and bars', () => {
    const b = bench.select({
      amountsWithheld: true,
      cashflow: { paceDeltaPct: 12, openOrderCount: 3, basis: {} },
      seasonality: { bestDay: 'Fri', worstDay: 'Mon', weekdayProfile: [], basis: {} },
      activeGoals: [],
    });
    const v = bench.view(b, ctx);
    expect(v.figures.map((x) => x.label)).not.toContain('Bought, last 30 days');
    expect(v.figures.map((x) => x.label)).not.toContain('Committed, not yet delivered');
    expect(v.cats).toBeUndefined();
    expect(v.table?.rows.map((r) => r.key)).not.toContain('buying');
    expect(said(v)).toContain(AMOUNTS_WITHHELD);
  });

  // F-701: the cashflow lens leaves an unpriced order out of its sums and
  // counts it; both cuttings of that lens say how many, in plain words.
  it('says how many orders the buying and committed figures leave out for want of a price', () => {
    const cf = { spendLast30d: 1200, spendPrev30d: 900, paceDeltaPct: 33, committedOpenOrders: 640, openOrderCount: 3 };
    const v = pacing.view(pacing.select({ ...cf, spendUnpricedCount: 2, committedUnpricedCount: 1 }), ctx);
    expect(said(v)).toContain(
      '2 delivered orders carry no price in these 180 days, so the 30-day buying figures leave them out and may be short by what they cost.',
    );
    expect(said(v)).toContain(
      '1 open order carries no price, so Committed, not yet delivered leaves it out.',
    );
    // All priced, or an older gateway with no count: no note.
    expect(said(pacing.view(pacing.select({ ...cf, spendUnpricedCount: 0 }), ctx))).not.toMatch(/no price/);
    expect(said(pacing.view(pacing.select(cf), ctx))).not.toMatch(/no price/);
    // Two empty windows with an unpriced delivery: the price is missing, not the order.
    const zero = pacing.view(pacing.select({ ...cf, spendLast30d: 0, spendPrev30d: 0, spendUnpricedCount: 1 }), ctx);
    expect(String(zero.say)).toContain('No delivered purchase order with a price falls');
    expect(said(zero)).toContain('1 delivered order carries no price');

    const owner = bench.view(
      bench.select({ cashflow: { ...cf, spendUnpricedCount: 3, committedUnpricedCount: 2 }, activeGoals: [] }),
      ctx,
    );
    expect(said(owner)).toContain('3 delivered orders carry no price');
    expect(said(owner)).toContain('2 open orders carry no price');
    // Staff read no money, so no note about it either.
    const staff = bench.view(
      bench.select({ amountsWithheld: true, cashflow: { openOrderCount: 3, spendUnpricedCount: 3 }, activeGoals: [] }),
      ctx,
    );
    expect(said(staff)).not.toMatch(/no price/);
  });

  // F-1042: a lira and a euro delivery have no one figure; the cutting says
  // why the windows are blank, never "no delivered order".
  it('says why the buying figures are blank when the orders were paid in two currencies', () => {
    const SPEND =
      'Paid in EUR and TRY: with no exchange rate on record they cannot be added into one figure, so the 30-day buying figures and the pace are left blank.';
    const COMMITTED = 'Ordered in EUR and TRY: with no exchange rate on record these cannot be added into one figure.';
    const cf = {
      spendLast30d: null,
      spendPrev30d: null,
      paceDeltaPct: null,
      committedOpenOrders: null,
      openOrderCount: 2,
      spendNote: SPEND,
      committedNote: COMMITTED,
      notCounted: { approved: 2, partlyReceived: 0, other: 0, orderValue: null, orderValueNote: COMMITTED, unpriced: 0 },
    };
    const v = pacing.view(pacing.select(cf), ctx);
    expect(String(v.say)).toBe(SPEND);
    expect(String(v.say)).not.toMatch(/No delivered purchase order/);
    expect(v.cats).toBeUndefined();
    expect(said(v)).toContain(COMMITTED);
    expect(said(v)).toContain(`Not in either figure: 2 approved orders. ${COMMITTED}`);

    const owner = bench.view(bench.select({ cashflow: cf, activeGoals: [] }), ctx);
    expect(said(owner)).toContain(SPEND);
    expect(said(owner)).toContain(COMMITTED);
  });

  it('an owner still reads every figure', () => {
    const c = pacing.select({ spendLast30d: 1200, spendPrev30d: 900, paceDeltaPct: 33, committedOpenOrders: 640, openOrderCount: 3 });
    const v = pacing.view(c, ctx);
    expect(v.figures.map((f) => f.label)).toEqual(['Pace', 'Committed, not yet delivered', 'Open orders']);
    expect(v.cats).toBeDefined();
  });
});

// F-1444: a check with no total is left out of Taken and of the Average
// check's count, and the page says how many. F-1443 sits here too, so the PR
// stays within its 15 files: turns and days are not drawn from a Cost of
// goods short of its deliveries with no price, and the page says why.
describe('figures a missing price or total would make short (F-1443, F-1444)', () => {
  const figureOf = (figs: Array<{ label: string; value: string; note?: string }> | undefined, label: string) =>
    figs?.find((x) => x.label === label);

  it('averages over the checks that carry a total and says the rest', () => {
    const v = till.view(read({ ...OLD_PAYLOAD, revenue: 200, checkCount: 4, checksWithoutTotal: 2 }), ctx as never);
    expect(figureOf(v.figures, 'Average check')?.value).toBe(figureOf(till.view(read({ ...OLD_PAYLOAD, revenue: 100, checkCount: 1 }), ctx as never).figures, 'Average check')?.value);
    expect(v.notes).toContain(tillUntotaledSaid(2));
    expect(tillUntotaledSaid(2)).toBe(
      '2 checks have no total from the till, so they are left out of Taken and of the Average check rather than counted as nothing paid.',
    );
  });

  it('an older payload with no count reads as before', () => {
    const v = till.view(read(OLD_PAYLOAD), ctx as never);
    expect(v.notes).toEqual([TILL_TOTALS_NOT_NET, TILL_REFUNDS_NOT_TAKEN_OFF]);
  });

  it('draws no turns or days of inventory from a short Cost of goods, and says why', () => {
    const v = ledger.view(
      ledger.select({
        inventoryValue: 2000,
        cogs: 480,
        cogsUnpricedCount: 1,
        inventoryTurnover: 4.1,
        daysInventoryOutstanding: 89,
      }) as LedgerRegister,
      ctx as never,
    );
    for (const label of ['Inventory turns', 'Days of inventory'])
      expect(figureOf(v.figures as never, label)).toMatchObject({
        value: '—',
        note: '1 delivered order has no price, so Cost of goods is short',
      });
    expect(v.notes?.join(' ')).toContain('Inventory turns and Days of inventory are not taken from it.');
  });
});

// F-1536: the till's Taken is the checks' totals (tax and tips inside on most
// tills) while the dashboard draws net sales, so the page says which it is.
// F-1534: a check rung at 0 (a comp, a staff meal) is counted and left out of
// the Average check. F-1532: the room and server registers say the same about
// their totals, and the server's Tip is over net sales.
describe('the registers say what Taken holds and leave a check rung at 0 out of the average (F-1532, F-1534, F-1536)', () => {
  const figureOf = (figs: Array<{ label: string; value: string }> | undefined, label: string) =>
    figs?.find((x) => x.label === label)?.value;

  it('the till says Taken holds tax and tips, unlike the dashboard’s net sales', () => {
    const v = till.view(read(OLD_PAYLOAD), ctx as never);
    expect(v.notes).toContain(TILL_TOTALS_NOT_NET);
    expect(TILL_TOTALS_NOT_NET).toBe(
      "Taken is the check totals as your till sends them. On most tills that includes tax and tips, so it reads higher than the dashboard's net sales, which are before tax and tips.",
    );
  });

  it('the till’s Average check leaves out a check rung at 0 and says how many', () => {
    // $300 over 4 checks, one of them a comp at 0: the average is $100, not $75.
    const v = till.view(read({ ...OLD_PAYLOAD, revenue: 300, checkCount: 4, checksTakingNoMoney: 1 }), ctx as never);
    const hundred = figureOf(till.view(read({ ...OLD_PAYLOAD, revenue: 100, checkCount: 1 }), ctx as never).figures, 'Average check');
    expect(figureOf(v.figures, 'Average check')).toBe(hundred);
    expect(v.notes).toContain(zeroChecksSaid(1));
    expect(zeroChecksSaid(2)).toBe(
      '2 checks were rung at 0, such as a comp or a staff meal: counted in Checks, left out of the average check.',
    );
  });

  it('the server register names its basis, the tip rate over net sales, and the checks rung at 0', () => {
    const reg = service.select({
      sinceDays: 90,
      dataStatus: 'live',
      tipBasis: 'net',
      checksTakingNoMoney: 2,
      checksInWindow: 9,
      waiters: [{ name: 'Maya', checks: 9, revenue: 882, avgCheck: 126, tipPct: 0.2 }],
    }) as ServiceRegister;
    const v = service.view(reg, { days: 90 } as never);
    expect(v.basis).toContain(REGISTER_TOTALS_NOT_NET);
    expect(v.basis).toContain(REGISTER_TIP_ON_NET);
    expect(v.notes).toContain(zeroChecksSaid(2));
  });

  it('an older server payload (tip over the total) is not called net', () => {
    const reg = service.select({
      sinceDays: 90,
      dataStatus: 'live',
      waiters: [{ name: 'Maya', checks: 3, revenue: 378, avgCheck: 126, tipPct: 0.159 }],
    }) as ServiceRegister;
    const v = service.view(reg, { days: 90 } as never);
    expect(v.basis).toContain(REGISTER_TOTALS_NOT_NET);
    expect(v.basis).not.toContain(REGISTER_TIP_ON_NET);
    expect(v.notes?.some((n) => String(n).includes('rung at 0'))).toBe(false);
  });

  it('the room register names its basis and the checks rung at 0', () => {
    const reg = seats.select({
      sinceDays: 90,
      dataStatus: 'live',
      checksInWindow: 4,
      checksTakingNoMoney: 1,
      tables: [{ tableId: 't1', label: 'T1', seats: 4, checks: 4, revenue: 300, covers: 8, avgCheck: 100 }],
    }) as SeatsRegister;
    const v = seats.view(reg, { days: 90 } as never);
    expect(v.basis).toContain(REGISTER_TOTALS_NOT_NET);
    expect(v.notes).toContain(zeroChecksSaid(1));
  });
});
