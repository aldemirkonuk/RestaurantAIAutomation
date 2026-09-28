import { describe, expect, it } from 'vitest';
import { toRow } from './useOrdersNextData';
import {
  RECURRENCE_UNREAD,
  emptyStationSentence,
  isRecurring,
  ordinal,
  readRecurrence,
  recurrenceLabel,
  shortDate,
} from './recurrence';

/**
 * The Recurring station, filled from a real column.
 *
 * WHAT THIS PROVES, AND WHY IT COULD NOT BE PROVED BEFORE
 *
 * `.planning/v3.0-TECH-DEBT.md` "The orders wire" item 2: `Order.recurrence`
 * was declared and never sent, `toRow` set `recurring = false` unconditionally,
 * and so `OrdersNext.tsx`'s recurring station SHOWED NOTHING while every order
 * fell into "one-time". The page had no way to be right, and no test could have
 * caught it by building an `OrderRowVM` by hand — the defect lived entirely in
 * the key names on the wire.
 *
 * So every test below that matters goes through `toRow` on a payload shaped
 * like the one `GET /procurement/orders` actually sends, which is the only
 * place a wrong key name is visible.
 *
 * THE PRE-FIX CONTROL. `toRow` on a payload with NO recurrence keys must still
 * produce `recurring: false` — and must mark the reading UNREAD, so the station
 * says "this page could not tell" rather than "there are none". That is the
 * distinction the whole change is about, and the last two describe blocks pin
 * both halves of it.
 */

const providers = new Map<string, string>([['prov-1', 'Anadolu']]);

/** A payload shaped like the list route's, plus whatever the case is about. */
const wire = (over: Record<string, unknown> = {}) =>
  ({
    id: 'o-1',
    orderNumber: 'ORD-2026-00042',
    restaurantId: 'r-1',
    inventoryId: 'inv-1',
    providerId: 'prov-1',
    quantity: 5,
    unitType: 'case',
    bottlesTotal: 60,
    finalPrice: 38.99,
    totalCost: 194.95,
    status: 'APPROVED',
    ...over,
  }) as never;

describe('reading a recurrence off the wire', () => {
  it('reads a rule the route sent', () => {
    const r = readRecurrence({
      recurrenceFrequency: 'weekly',
      recurrenceAnchorDay: 1,
      recurrenceNextDueOn: '2026-09-12',
      recurrenceStatus: 'active',
      recurrenceParentOrderId: null,
      recurrenceOccurrenceOn: null,
    });
    expect(r.read).toBe(true);
    expect(r.frequency).toBe('weekly');
    expect(r.anchorDay).toBe(1);
    expect(r.nextDueOn).toBe('2026-09-12');
    expect(r.status).toBe('active');
    expect(r.unreadable).toBeNull();
  });

  it('distinguishes "read and does not repeat" from "not read at all"', () => {
    // THE WHOLE POINT. Both produce `recurring === false`, and they are not the
    // same fact: only the first licenses the station to say "there are none".
    const readAndNo = readRecurrence({ recurrenceFrequency: null });
    expect(readAndNo.read).toBe(true);
    expect(readAndNo.frequency).toBeNull();

    const notRead = readRecurrence({ id: 'o-1' });
    expect(notRead.read).toBe(false);
    expect(notRead).toEqual(RECURRENCE_UNREAD);
  });

  it('says so when the wire names a rule this build cannot read', () => {
    // A newer gateway adding a sixth frequency must make an older page say it
    // cannot read the rule — never silently report the order as one-time.
    const r = readRecurrence({ recurrenceFrequency: 'yearly' });
    expect(r.read).toBe(true);
    expect(r.frequency).toBeNull();
    expect(r.unreadable).toContain('yearly');
    expect(recurrenceLabel(r)).toContain('cannot read');
  });

  it('says so when the wire names a state this build cannot read', () => {
    const r = readRecurrence({
      recurrenceFrequency: 'weekly',
      recurrenceStatus: 'suspended',
    });
    expect(r.unreadable).toContain('suspended');
  });

  it('refuses a next date that is not a calendar date, rather than rendering it', () => {
    const r = readRecurrence({
      recurrenceFrequency: 'weekly',
      recurrenceNextDueOn: 'next Tuesday',
    });
    expect(r.nextDueOn).toBeNull();
    // And the sentence drops the clause rather than printing "next —".
    expect(recurrenceLabel(r)).toBe('recurs weekly');
  });

  it('reads a child occurrence, which carries a parent and a date but no rule', () => {
    const r = readRecurrence({
      recurrenceFrequency: null,
      recurrenceParentOrderId: 'order-parent',
      recurrenceOccurrenceOn: '2026-09-08',
    });
    expect(isRecurring(r)).toBe(false);
    expect(r.parentOrderId).toBe('order-parent');
    expect(r.occurrenceOn).toBe('2026-09-08');
  });
});

describe('which orders belong in the Recurring station', () => {
  const of = (over: Record<string, unknown>) => readRecurrence(over);

  it('an active rule does', () => {
    expect(isRecurring(of({ recurrenceFrequency: 'weekly', recurrenceStatus: 'active' }))).toBe(true);
  });

  it('a paused and an ended rule still do — the station must not lose them', () => {
    // Hiding an ended series the moment it ends would make the station lie
    // about what the house has been buying. The row says which state it is in.
    expect(isRecurring(of({ recurrenceFrequency: 'weekly', recurrenceStatus: 'paused' }))).toBe(true);
    expect(isRecurring(of({ recurrenceFrequency: 'monthly', recurrenceStatus: 'ended' }))).toBe(true);
  });

  it('a CHILD occurrence does not — one standing order must not read as N', () => {
    expect(
      isRecurring(
        of({
          recurrenceFrequency: null,
          recurrenceParentOrderId: 'p',
          recurrenceOccurrenceOn: '2026-09-08',
        }),
      ),
    ).toBe(false);
  });

  it('an unread payload does not', () => {
    expect(isRecurring(RECURRENCE_UNREAD)).toBe(false);
  });
});

describe('the sentence a ledger row shows', () => {
  it('is "recurs weekly on Tuesday, next 12 Sep"', () => {
    const r = readRecurrence({
      recurrenceFrequency: 'weekly',
      recurrenceAnchorDay: 1,
      recurrenceNextDueOn: '2026-09-12',
      recurrenceStatus: 'active',
    });
    // The month's SPELLING is the locale's business (Node's CLDR renders
    // en-GB September as "Sept"), so the assertion pins the rule, the anchor
    // and the DAY — the day is the part a timezone bug moves.
    expect(recurrenceLabel(r, 'en-GB')).toBe(
      `recurs weekly on Tuesday, next ${shortDate('2026-09-12', 'en-GB')}`,
    );
    expect(recurrenceLabel(r, 'en-GB')).toContain('next 12 ');
  });

  it('names a monthly anchor as an ordinal day', () => {
    const r = readRecurrence({
      recurrenceFrequency: 'monthly',
      recurrenceAnchorDay: 12,
      recurrenceNextDueOn: '2026-10-12',
      recurrenceStatus: 'active',
    });
    expect(recurrenceLabel(r, 'en-GB')).toBe(
      `recurs monthly on the 12th, next ${shortDate('2026-10-12', 'en-GB')}`,
    );
    expect(recurrenceLabel(r, 'en-GB')).toContain('next 12 Oct');
  });

  it('says "paused" instead of a next date, never "next —"', () => {
    const r = readRecurrence({
      recurrenceFrequency: 'weekly',
      recurrenceStatus: 'paused',
      recurrenceNextDueOn: '2026-09-12',
    });
    expect(recurrenceLabel(r, 'en-GB')).toBe('recurs weekly — paused');
  });

  it('says "ended" for an ended series', () => {
    const r = readRecurrence({
      recurrenceFrequency: 'quarterly',
      recurrenceStatus: 'ended',
    });
    expect(recurrenceLabel(r, 'en-GB')).toBe('recurs quarterly — ended');
  });

  it('calls biweekly "fortnightly" rather than printing an enum member', () => {
    const r = readRecurrence({
      recurrenceFrequency: 'biweekly',
      recurrenceStatus: 'active',
      recurrenceNextDueOn: '2026-09-22',
    });
    expect(recurrenceLabel(r, 'en-GB')).toBe(
      `recurs fortnightly, next ${shortDate('2026-09-22', 'en-GB')}`,
    );
    expect(recurrenceLabel(r, 'en-GB')).toContain('recurs fortnightly, next 22 ');
  });

  it('is null when there is nothing true to say', () => {
    expect(recurrenceLabel(RECURRENCE_UNREAD)).toBeNull();
    expect(recurrenceLabel(readRecurrence({ recurrenceFrequency: null }))).toBeNull();
  });

  it('formats the date in UTC, so it does not slide a day west of Greenwich', () => {
    // The value is a calendar DATE. Formatting it as an instant in the
    // browser's zone shows 11 Sep to anyone at a negative offset — the same
    // off-by-one-day fault the gateway's arithmetic is written around.
    // The DAY, not the month's spelling: 12, never 11. A date formatted as an
    // instant in the browser's zone shows the 11th to anyone west of
    // Greenwich, and this file's own TZ is whatever the runner's is.
    expect(shortDate('2026-09-12', 'en-GB')).toMatch(/^12 /);
    // A 1 January date is the harshest case: a negative offset rolls it into
    // the previous YEAR as well as the previous day.
    expect(shortDate('2026-01-01', 'en-GB')).toMatch(/^1 Jan/);
    expect(shortDate(null)).toBeNull();
    expect(shortDate('not a date')).toBeNull();
  });

  it('ordinals read correctly, including the teens', () => {
    expect(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']).toEqual([
      ordinal(1),
      ordinal(2),
      ordinal(3),
      ordinal(4),
      ordinal(11),
      ordinal(12),
      ordinal(13),
      ordinal(21),
      ordinal(22),
    ]);
  });
});

describe('toRow, on the payload the route actually sends', () => {
  it('a recurring order now reaches the station, with its sentence', () => {
    const row = toRow(
      wire({
        recurrenceFrequency: 'weekly',
        recurrenceAnchorDay: 1,
        recurrenceNextDueOn: '2026-09-12',
        recurrenceStatus: 'active',
        recurrenceParentOrderId: null,
        recurrenceOccurrenceOn: null,
      }),
      providers,
    );
    // This assertion FAILS against the pre-fix hook, where `recurring` was the
    // literal `false` and `recurrenceLabel` the literal `null`.
    expect(row.recurring).toBe(true);
    expect(row.recurrenceLabel).toContain('recurs weekly on Tuesday');
    expect(row.recurrence.read).toBe(true);
  });

  it('a non-recurring order the route DID read is false, and says it was read', () => {
    const row = toRow(
      wire({
        recurrenceFrequency: null,
        recurrenceAnchorDay: null,
        recurrenceNextDueOn: null,
        recurrenceStatus: null,
        recurrenceParentOrderId: null,
        recurrenceOccurrenceOn: null,
      }),
      providers,
    );
    expect(row.recurring).toBe(false);
    expect(row.recurrence.read).toBe(true);
    expect(row.recurrenceLabel).toBeNull();
  });

  it('a payload with NO recurrence keys is false AND unread — the pre-fix control', () => {
    const row = toRow(wire(), providers);
    expect(row.recurring).toBe(false);
    // The half that did not exist before. Without it, the station cannot tell
    // this case from the one above, and its "there are none" is a fabrication.
    expect(row.recurrence.read).toBe(false);
  });

  it('a child occurrence carries its lineage onto the row', () => {
    const row = toRow(
      wire({
        recurrenceFrequency: null,
        recurrenceParentOrderId: 'order-parent',
        recurrenceOccurrenceOn: '2026-09-08',
      }),
      providers,
    );
    expect(row.recurring).toBe(false);
    expect(row.recurrence.parentOrderId).toBe('order-parent');
  });
});

describe('what the empty Recurring station is allowed to say', () => {
  it('does not claim an empty book before the book has been read', () => {
    expect(emptyStationSentence(false, 0, 0)).toBe('The order book has not been read yet.');
  });

  it('says there are no orders at all when there are none', () => {
    expect(emptyStationSentence(true, 0, 0)).toContain('no orders yet');
  });

  it('REFUSES to say "none" when nothing answered the question', () => {
    // The sentence the station printed for its entire life before 2026-09-05
    // was "Nothing sits at recurring right now" — a claim about the orders made
    // from a fact about the route.
    const s = emptyStationSentence(true, 12, 0);
    expect(s).toContain('could not tell');
    expect(s).toContain('not the same as there being none');
  });

  it('says how many answered when only some did', () => {
    expect(emptyStationSentence(true, 12, 5)).toBe(
      'Of 12 orders, 5 said whether they repeat and none of those do. The other 7 did not say either way.',
    );
  });

  it('says "none" only when every row was read and every row said no', () => {
    expect(emptyStationSentence(true, 12, 12)).toBe('None of the 12 orders in this book repeats.');
  });
});
