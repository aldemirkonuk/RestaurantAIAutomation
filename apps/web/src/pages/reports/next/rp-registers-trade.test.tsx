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
  TILL_REFUNDS_TAKEN_OFF,
  TILL_TOTALS_NOT_NET,
  lastYearFigure,
  pacing,
  till,
  tillUntotaledSaid,
  week,
  type TillWindow,
  type WeekRegister,
} from './rp-registers-trade';
import {
  AMOUNTS_WITHHELD,
  REGISTER_NET_SALES,
  REGISTER_TIP_ON_NET,
  REGISTER_TOTALS_NOT_NET,
  checksWithoutNetSaid,
  ledger,
  quadrants,
  refundChecksSaid,
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

describe('the till says which refunds are taken off Taken (F-1644, was F-446)', () => {
  it('prints the refund note beside a Taken figure, in the export file’s words', () => {
    const view = till.view(read({ ...OLD_PAYLOAD, timezone: 'America/Los_Angeles', zoneUnset: false }), ctx);
    expect(view.notes).toEqual([TILL_TOTALS_NOT_NET, TILL_REFUNDS_TAKEN_OFF]);
    expect(TILL_REFUNDS_TAKEN_OFF).toBe(
      "Refunds your till sends as a check with a minus total are taken off Taken. A refund your till keeps only in its own refund report does not reach Mudavym, so check that report before you hand this on as net takings.",
    );
  });

  it('keeps a refund check out of the Average check and says how many', () => {
    // 200 sales of 1,000 and 20 refunds of 1,000: Taken 180,000 over 220
    // checks. The average read 180,000 / 220 = 818; it is 1,000.
    const v = till.view(
      read({ ...OLD_PAYLOAD, revenue: 180_000, checkCount: 220, checksRefunded: 20, refunded: 20_000 }),
      ctx,
    );
    const thousand = till.view(read({ ...OLD_PAYLOAD, revenue: 1000, checkCount: 1 }), ctx).figures[2].value;
    expect(v.figures[2]).toMatchObject({ label: 'Average check', value: thousand });
    expect(v.notes).toContain(refundChecksSaid(20));
    expect(refundChecksSaid(1)).toBe(
      '1 check was a refund, sent by your till with a minus total: counted in Checks, taken off Taken, left out of the average check.',
    );
  });

  it('says it on a window with a total and no daily rows, too', () => {
    const view = till.view(read({ ...OLD_PAYLOAD, revenue: 0, dailySeries: [] }), ctx);
    expect(view.notes).toEqual([TILL_TOTALS_NOT_NET, TILL_REFUNDS_TAKEN_OFF]);
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
    expect(v.notes).toEqual([TILL_TOTALS_NOT_NET, TILL_REFUNDS_TAKEN_OFF]);
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

  // F-1588 remainder (ADR 0341 F2): Tip is over net sales, and a window across
  // the day prices began to include tax holds two kinds of net.
  it('F-1588: the server register says when Tip’s window spans a tax-basis switch, and nothing when it does not', () => {
    const note =
      "The house said its till prices include KDV from 10 September 2026, so this period's net is not on one basis.";
    const payload = {
      sinceDays: 90,
      dataStatus: 'live',
      tipBasis: 'net',
      checksInWindow: 9,
      waiters: [{ name: 'Maya', checks: 9, revenue: 882, avgCheck: 126, tipPct: 0.2 }],
    };
    const v = service.view(service.select({ ...payload, tipTaxNote: note }) as ServiceRegister, {
      days: 90,
    } as never);
    expect(v.notes).toContain(`Tip is worked out on net sales. ${note}`);
    const plain = service.view(service.select({ ...payload, tipTaxNote: null }) as ServiceRegister, {
      days: 90,
    } as never);
    expect(plain.notes?.join(' ')).not.toMatch(/not on one basis/);
  });

  it('F-1573: a till with no amount before tax says why Tip is blank, never "over net sales"', () => {
    const why =
      'Your till sends tips but no amount before tax, so no tip rate can be taken. The tips were recorded; Tip stays blank rather than be worked out on totals that hold tax.';
    const reg = service.select({
      sinceDays: 90,
      dataStatus: 'live',
      tipBasis: null,
      tipBasisWhy: why,
      checksInWindow: 3,
      waiters: [{ name: 'Maya', checks: 3, revenue: 378, avgCheck: 126, tipPct: null }],
    }) as ServiceRegister;
    const v = service.view(reg, { days: 90 } as never);
    expect(v.basis).not.toContain(REGISTER_TIP_ON_NET);
    expect(v.basis).toContain(why);
  });

  it('F-1581: tips the house’s tax settings left without net point at the tax rates, not the till', () => {
    const reg = service.select({
      sinceDays: 90,
      dataStatus: 'live',
      tipBasis: null,
      tipBasisWhy: 'Tips were recorded, but these checks have no net sales.',
      tipsNetNotRecorded: 2,
      tipsNetNotRecordedByReason: { no_rate: 2 },
      checksInWindow: 2,
      waiters: [{ name: 'Maya', checks: 2, revenue: 252, avgCheck: 126, tipPct: null }],
    }) as ServiceRegister;
    expect(reg.tipsNetNotRecorded).toBe(2);
    const v = service.view(reg, { days: 90 } as never);
    render(<MemoryRouter>{v.notes}</MemoryRouter>);
    const note = screen.getByTestId('rp-tips-net-not-recorded');
    expect(note.textContent).toMatch(/2 tipped checks have no net sales/);
    expect(note.textContent).toMatch(/2 checks, no tax rate of this house was in force on the day\./);
    expect(screen.getByRole('link', { name: 'Set the tax rates' })).toHaveAttribute('href', '/settings?tab=tax-basis');
  });

  // F-1612 = F-1623: every tipped check without net was blamed on "no tax
  // rate in force", whatever ingest's reason, with a link to the rates.
  it('F-1612: says each reason a tipped check has no net in its own words, never all as no rate', () => {
    const reg = service.select({
      sinceDays: 90,
      dataStatus: 'live',
      tipBasis: null,
      tipBasisWhy: 'Tips were recorded, but these checks have no net sales.',
      tipsNetNotRecorded: 3,
      tipsNetNotRecordedByReason: { tax_unread: 2, tax_on_top: 1 },
      checksInWindow: 3,
      waiters: [{ name: 'Maya', checks: 3, revenue: 378, avgCheck: 126, tipPct: null }],
    }) as ServiceRegister;
    expect(reg.tipsNetNotRecordedByReason).toEqual({ tax_unread: 2, tax_on_top: 1 });
    const v = service.view(reg, { days: 90 } as never);
    render(<MemoryRouter>{v.notes}</MemoryRouter>);
    const note = screen.getByTestId('rp-tips-net-not-recorded');
    expect(note.textContent).not.toMatch(/no tax rate/);
    expect(screen.getByTestId('rp-tips-net-not-recorded-tax_unread').textContent).toMatch(
      /2 checks, the till sent a tax figure, or a line’s tax rate, that could not be read;/,
    );
    expect(screen.getByTestId('rp-tips-net-not-recorded-tax_on_top').textContent).toMatch(/adds tax on top/);
    expect(screen.queryByRole('link', { name: 'Set the tax rates' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Check the answer in Settings' })).toHaveAttribute(
      'href',
      '/settings?tab=tax-basis',
    );
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

// F-1646 (wave-54 sim): "Same month last year" set a whole month against one
// the till covered only partly (the house joined mid-month) and printed the
// change, which read as growth that was only the missing days.
describe('same month last year says how many days were on record (F-1646)', () => {
  const lastMarch = (days: number, onRecord: number) => ({
    revenue: 9000,
    checkCount: 90,
    posConnected: true,
    zoneUnset: false,
    days,
    to: '2025-03-31',
    dailySeries: Array.from({ length: onRecord }, (_, i) => ({
      date: `2025-03-${String(31 - onRecord + i + 1).padStart(2, '0')}`,
      revenue: 9000 / onRecord,
    })),
  });

  it('a month the till covered for 9 of its 31 days gives no change', () => {
    const f = lastYearFigure('2026-03', '2025-03', 31_000, lastMarch(31, 9), 'Europe/Istanbul');
    expect(f.value).not.toMatch(/this year/);
    expect(f.note).toMatch(/^9 of 31 days on record in /);
  });

  it('a month with a check on every day still gives the change (control)', () => {
    const f = lastYearFigure('2026-03', '2025-03', 18_000, lastMarch(31, 31), 'Europe/Istanbul');
    expect(f.value).toMatch(/this year\)$/);
    expect(f.note).toBeUndefined();
  });
});

// F-1662 (wave-55 sim): the till sends days with sales only, so a house shut
// every Monday never had a check on all 31 days and never got its change.
// Coverage runs from the till's first check to the period's end.
describe('same month last year counts the days the till was connected (F-1662)', () => {
  // March 2025: the 3rd, 10th, 17th, 24th and 31st are Mondays.
  const shutMondays = Array.from({ length: 31 }, (_, i) => i + 1)
    .filter((d) => (d - 3) % 7 !== 0)
    .map((d) => ({ date: `2025-03-${String(d).padStart(2, '0')}`, revenue: 350 }));
  const march = (series: typeof shutMondays, coveredFrom: string | null) => ({
    revenue: 9100,
    checkCount: 90,
    posConnected: true,
    zoneUnset: false,
    days: 31,
    to: '2025-03-31',
    dailySeries: series,
    coveredFrom,
  });

  it('a house shut on Mondays gets the change for a month its till covered whole', () => {
    expect(shutMondays).toHaveLength(26);
    const f = lastYearFigure('2026-03', '2025-03', 10_010, march(shutMondays, '2024-11-04'), 'Europe/Istanbul');
    expect(f.value).toMatch(/this year\)$/);
    expect(f.note).toBeUndefined();
  });

  it('a shut first day does not withhold it when the till was on before the month', () => {
    const f = lastYearFigure('2026-03', '2025-03', 10_010, march(shutMondays.slice(1), '2024-11-04'), 'Europe/Istanbul');
    expect(f.note).toBeUndefined();
  });

  it('from an older gateway, the month counts from its own first check', () => {
    const f = lastYearFigure('2026-03', '2025-03', 10_010, march(shutMondays, null), 'Europe/Istanbul');
    expect(f.note).toBeUndefined();
  });

  it('a till first connected on the 20th still gives no change (12 of 31 days)', () => {
    const late = shutMondays.filter((r) => r.date >= '2025-03-20');
    const f = lastYearFigure('2026-03', '2025-03', 10_010, march(late, '2025-03-20'), 'Europe/Istanbul');
    expect(f.value).not.toMatch(/this year/);
    expect(f.note).toMatch(/^12 of 31 days on record in /);
  });

  it('reads coveredFrom off the till window', () => {
    expect(till.select({ posConnected: true, coveredFrom: '2024-11-04' })).toMatchObject({
      coveredFrom: '2024-11-04',
    });
    expect(till.select({ posConnected: true })).toMatchObject({ coveredFrom: null });
  });
});

// w109-gross-basis (ADR 0341): Taken, the room and server registers and the
// Average check / Wine revenue goals add up what the till rang. At a house
// whose till prices include KDV the gateway now says so, and every surface
// prints it; any other house's payload carries no key and reads as before.
describe('till totals say they include KDV where the house says its till prices do (w109-gross-basis)', () => {
  const KDV = 'Prices on your till include KDV, so these totals include KDV.';
  const GOAL_KDV =
    "Average check is worked out on your till's prices, which include KDV, so it reads higher than net sales.";

  it('the till prints it beside Taken, and an older or US payload reads as before', () => {
    expect(till.view(read({ ...OLD_PAYLOAD, totalsTaxNote: KDV }), ctx).notes).toContain(KDV);
    expect(till.view(read(OLD_PAYLOAD), ctx).notes).not.toContain(KDV);
  });

  it('the room and server registers name it in their basis', () => {
    const room = {
      sinceDays: 90,
      dataStatus: 'live',
      checksInWindow: 4,
      tables: [{ tableId: 't1', label: 'T1', seats: 4, checks: 4, revenue: 300, covers: 8, avgCheck: 75 }],
    };
    expect(seats.view(seats.select({ ...room, totalsTaxNote: KDV }) as SeatsRegister, { days: 90 } as never).basis).toContain(KDV);
    expect(seats.view(seats.select(room) as SeatsRegister, { days: 90 } as never).basis).not.toContain(KDV);
    const servers = {
      sinceDays: 90,
      dataStatus: 'live',
      checksInWindow: 9,
      waiters: [{ name: 'Maya', checks: 9, revenue: 882, avgCheck: 98 }],
    };
    expect(
      service.view(service.select({ ...servers, totalsTaxNote: KDV }) as ServiceRegister, { days: 90 } as never).basis,
    ).toContain(KDV);
    expect(service.view(service.select(servers) as ServiceRegister, { days: 90 } as never).basis).not.toContain(KDV);
  });

  it('an Average check goal says it on the desk, in the notes and on the recommendations margin', () => {
    const AVG = {
      goal: { id: 'g-avg', name: 'Lift the check', metric_key: 'avg_check', direction: 'at_least', deadline: null, period: 'custom' },
      metricLabel: 'Average check',
      unit: 'currency',
      current: 500,
      target: 700,
      progressPct: 0.71,
      onTrack: null,
      paceUnread: null,
      taxNote: GOAL_KDV,
    };
    const view = goals.view(book(AVG), { days: 30, goals: desk });
    expect(view.notes).toContain(`Lift the check: ${GOAL_KDV}`);
    render(<MemoryRouter>{view.node}</MemoryRouter>);
    expect(screen.getByText(GOAL_KDV)).toBeInTheDocument();
    expect(toProgressRow(AVG).taxNote).toBe(GOAL_KDV);

    const plain: Record<string, unknown> = { ...AVG };
    delete plain.taxNote;
    expect(book(plain).goals[0].taxNote).toBeNull();
    expect(toProgressRow(plain).taxNote).toBeNull();
    expect(goals.view(book(plain), { days: 30, goals: desk }).notes?.join(' ')).not.toMatch(/include KDV/);
  });
});

// w111-net-table-revenue (AW17): the room and server registers' Taken was the
// till's check totals, tax and tips in, beside a dashboard of net sales. The
// gateway now sends net sales and says so (revenueBasis 'net'); the page names
// that basis, says the checks with no net, and never draws a not-recorded
// Taken as 0.
describe('the room and server registers read net sales, as the dashboard does (w111-net-table-revenue)', () => {
  const SWITCH =
    "The house said its till prices include KDV from 10 September 2026, so this period's net is not on one basis.";
  const room = {
    sinceDays: 90,
    dataStatus: 'live',
    checksInWindow: 5,
    revenueBasis: 'net',
    checksWithoutNet: 1,
    netSalesTaxNote: SWITCH,
    tables: [
      { tableId: 't1', label: 'T1', seats: 4, checks: 4, revenue: 1000, covers: 8, avgCheck: 250 },
      { tableId: 't2', label: 'T2', seats: 2, checks: 1, revenue: null, covers: 2, avgCheck: null },
    ],
  };

  it('the room names net sales, the switch and the check with no net, and leaves a not-recorded table off the bars', () => {
    const reg = seats.select(room) as SeatsRegister;
    expect(reg.tables[1].revenue).toBeNull();
    const v = seats.view(reg, { days: 90 } as never);
    expect(v.basis).toContain(REGISTER_NET_SALES);
    expect(v.basis).not.toContain(REGISTER_TOTALS_NOT_NET);
    expect(v.basis).toContain(SWITCH);
    expect(v.notes).toContain(checksWithoutNetSaid(1));
    expect(v.cats?.data.map((d) => d.label)).toEqual(['T1']);
  });

  it('the server register does the same', () => {
    const reg = service.select({
      sinceDays: 90,
      dataStatus: 'live',
      checksInWindow: 4,
      revenueBasis: 'net',
      checksWithoutNet: 2,
      waiters: [
        { name: 'Ayşe', checks: 2, revenue: 2000, avgCheck: 1000 },
        { name: 'Deniz', checks: 2, revenue: null, avgCheck: null },
      ],
    }) as ServiceRegister;
    expect(reg.waiters[1].revenue).toBeNull();
    const v = service.view(reg, { days: 90 } as never);
    expect(v.basis).toContain(REGISTER_NET_SALES);
    expect(v.notes).toContain(checksWithoutNetSaid(2));
    expect(v.cats?.data.map((d) => d.label)).toEqual(['Ayşe']);
  });

  it('an older gateway (check totals) keeps its own sentence and its zeros', () => {
    const { revenueBasis: _b, checksWithoutNet: _c, netSalesTaxNote: _n, ...old } = room;
    const reg = seats.select(old) as SeatsRegister;
    expect(reg.tables[1].revenue).toBe(0);
    const v = seats.view(reg, { days: 90 } as never);
    expect(v.basis).toContain(REGISTER_TOTALS_NOT_NET);
    expect(v.basis).not.toContain(REGISTER_NET_SALES);
  });
});
