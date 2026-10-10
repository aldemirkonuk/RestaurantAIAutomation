import { describe, expect, it } from 'vitest';
import {
  NOT_RECORDED,
  countBySource,
  dayKeyOf,
  displaySources,
  fmtClock,
  fmtDay,
  fmtStamp,
  groupByDay,
  labelOf,
  linkOutFor,
  listSources,
  nameOf,
  noLinkReason,
  orderForThread,
  parseDay,
  payloadLines,
  threadSpan,
  word,
  type LinkContext,
  type TimelineEvent,
} from './lg-format';

function ev(over: Partial<TimelineEvent>): TimelineEvent {
  return {
    id: 'x',
    source: 'decision_log',
    occurredAt: '2026-09-10T10:00:00.000Z',
    correlationId: null,
    summary: 's',
    detail: {},
    ...over,
  };
}

const CTX: LinkContext = { documentPageOn: false, posLogAvailable: true, restaurantId: 'r1' };

describe('lg-format — an undated row says so', () => {
  it('prints "not recorded" for a null or unparseable timestamp, never Invalid Date', () => {
    expect(fmtClock(null)).toBe(NOT_RECORDED);
    expect(fmtStamp(undefined)).toBe(NOT_RECORDED);
    expect(fmtClock('not-a-date')).toBe(NOT_RECORDED);
    expect(fmtStamp('not-a-date')).not.toMatch(/Invalid/);
    expect(dayKeyOf('nope')).toBeNull();
  });

  it('groups a newest-first feed by local day and collects undated rows in one trailing group', () => {
    const rows = [
      ev({ id: 'a', occurredAt: '2026-09-10T23:00:00.000Z' }),
      ev({ id: 'b', occurredAt: '2026-09-10T22:00:00.000Z' }),
      ev({ id: 'c', occurredAt: '2026-09-08T09:00:00.000Z' }),
      ev({ id: 'd', occurredAt: null }),
      ev({ id: 'e', occurredAt: '2026-09-08T08:00:00.000Z' }),
      ev({ id: 'f', occurredAt: null }),
    ];
    const groups = groupByDay(rows);
    // Day keys follow the local calendar; the two evening rows may share a day
    // or not depending on the zone, but the undated tail is always one group
    // at the end and never interleaved.
    expect(groups[groups.length - 1].key).toBeNull();
    expect(groups[groups.length - 1].events.map((r) => r.id)).toEqual(['d', 'f']);
    expect(groups[groups.length - 1].heading).toBe('No date recorded');
    const dated = groups.slice(0, -1).flatMap((g) => g.events.map((r) => r.id));
    expect(dated).toEqual(['a', 'b', 'c', 'e']);
    for (const g of groups.slice(0, -1)) expect(g.key).not.toBeNull();
  });
});

describe('lg-format — a thread reads like a ledger page', () => {
  it('orders a thread oldest first with undated rows last', () => {
    const rows = [
      ev({ id: 'new', occurredAt: '2026-09-10T10:00:00.000Z' }),
      ev({ id: 'undated', occurredAt: null }),
      ev({ id: 'old', occurredAt: '2026-09-09T10:00:00.000Z' }),
    ];
    expect(orderForThread(rows).map((r) => r.id)).toEqual(['old', 'new', 'undated']);
  });

  it('spans from the first dated moment to the last, counting distinct registers', () => {
    const rows = [
      ev({ id: '1', source: 'pos_checks', occurredAt: '2026-09-10T10:00:00.000Z' }),
      ev({ id: '2', source: 'inventory_transactions', occurredAt: '2026-09-10T10:00:05.000Z' }),
      ev({ id: '3', source: 'inventory_transactions', occurredAt: null }),
    ];
    expect(threadSpan(rows)).toEqual({
      first: '2026-09-10T10:00:00.000Z',
      last: '2026-09-10T10:00:05.000Z',
      registers: 2,
    });
    expect(threadSpan([ev({ occurredAt: null })])).toEqual({ first: null, last: null, registers: 1 });
  });
});

describe('lg-format — registers', () => {
  it('labels a source it has not mirrored with its raw key, never blank', () => {
    expect(labelOf('pos_checks')).toBe('Till');
    expect(labelOf('webhook_log')).toBe('webhook_log');
    expect(nameOf('webhook_log')).toBe('webhook_log');
  });

  it('drives the strip and the tally from ONE list, gateway extras appended', () => {
    expect(displaySources(null)).toHaveLength(6);
    expect(displaySources(['pos_checks', 'webhook_log'])).toHaveLength(7);
    expect(displaySources(['pos_checks', 'webhook_log'])[6]).toBe('webhook_log');
  });

  it('counts rows per register and lists names as a sentence', () => {
    expect(countBySource([ev({ source: 'pos_checks' }), ev({ source: 'pos_checks' }), ev({})])).toEqual({
      pos_checks: 2,
      decision_log: 1,
    });
    expect(listSources(['pos_checks'])).toBe('the till');
    expect(listSources(['pos_checks', 'system_audit_log'])).toBe('the till and the audit trail');
    expect(listSources(['pos_checks', 'decision_log', 'event_store'])).toBe(
      'the till, the agents and the event store',
    );
    expect(word(6)).toBe('six');
    expect(word(12)).toBe('12');
  });
});

describe('lg-format — the way out of the timeline', () => {
  it('sends a document to the canonical page when it is on, and to receipts with its id otherwise', () => {
    const doc = ev({ id: 'doc-1', source: 'procurement_documents' });
    expect(linkOutFor(doc, { ...CTX, documentPageOn: true })).toEqual({ to: '/documents/doc-1', label: 'Open the document' });
    expect(linkOutFor(doc, CTX)).toEqual({ to: '/receipts?doc=doc-1', label: 'Open in receipts' });
  });

  it('sends a stock movement to the ledger and a till check to the till log while the log is served', () => {
    expect(linkOutFor(ev({ source: 'inventory_transactions' }), CTX)?.to).toBe('/inventory');
    expect(linkOutFor(ev({ source: 'pos_checks' }), CTX)?.to).toBe('/simpos/r1/orders');
    // The till log is a development surface: in a production build it is not
    // served, and the row must say so instead of pointing at a redirect.
    expect(linkOutFor(ev({ source: 'pos_checks' }), { ...CTX, posLogAvailable: false })).toBeNull();
    expect(noLinkReason(ev({ source: 'pos_checks' }), { ...CTX, posLogAvailable: false })).toMatch(/development surface/);
    expect(linkOutFor(ev({ source: 'pos_checks' }), { ...CTX, restaurantId: null })).toBeNull();
  });

  it('sends an audit entry to the page of the record it names, and nowhere when it names none', () => {
    const audit = (entityType: string | null) =>
      ev({ source: 'system_audit_log', detail: entityType ? { entityType } : {} });
    expect(linkOutFor(audit('procurement_order'), CTX)?.to).toBe('/orders');
    expect(linkOutFor(audit('generated_report'), CTX)?.to).toBe('/documents-reports');
    expect(linkOutFor(audit('restaurant_feature_flag'), CTX)?.to).toBe('/settings?tab=features');
    expect(linkOutFor(audit('restaurant_member'), CTX)?.to).toBe('/team');
    expect(linkOutFor(audit('payment_method'), CTX)).toBeNull();
    expect(linkOutFor(audit(null), CTX)).toBeNull();
  });

  it('has no way out for an agent decision or an event-store row, and says why', () => {
    expect(linkOutFor(ev({ source: 'decision_log' }), CTX)).toBeNull();
    expect(noLinkReason(ev({ source: 'decision_log' }), CTX)).toMatch(/no page of its own/);
    expect(linkOutFor(ev({ source: 'event_store' }), CTX)).toBeNull();
    expect(noLinkReason(ev({ source: 'event_store' }), CTX)).toMatch(/thread/);
  });
});

describe('lg-format — the payload', () => {
  it('prints scalars as they are, nulls as not recorded, and objects as JSON', () => {
    expect(payloadLines({ a: 'x', b: 2, c: true, d: null, e: { k: 1 } })).toEqual([
      { key: 'a', value: 'x' },
      { key: 'b', value: '2' },
      { key: 'c', value: 'true' },
      { key: 'd', value: NOT_RECORDED },
      { key: 'e', value: '{\n  "k": 1\n}' },
    ]);
    expect(payloadLines(null)).toEqual([]);
  });
});

/**
 * A day the reader names is read back from its END, in the same clock the day
 * headings use. The second case is the coupling with the headings: if the day
 * headings move to the house's zone (A-056) and the jump does not, or the
 * other way round, it fails — and the reader would land on a page whose first
 * heading is not the day they asked for. The suite runs in America/New_York
 * (`src/__tests__/setup.ts:12`), whose clocks change on 2026-03-08 and
 * 2026-11-01; the European change days are kept so the case still means
 * something if that pin moves. Measured outside the pin on 2026-10-03: every
 * day of 2026 holds the pair in nine zones, Havana and Beirut (which change
 * AT midnight) included.
 */
describe('lg-format — a day to read back from', () => {
  it('reads a strict YYYY-MM-DD and names it in the day heading’s own words', () => {
    const d = parseDay('2026-07-22');
    expect(d).not.toBeNull();
    expect(d!.key).toBe('2026-07-22');
    expect(d!.heading).toBe(fmtDay(new Date(2026, 6, 22, 12).toISOString()));
    expect(d!.heading).toMatch(/22/);
    expect(d!.heading).toMatch(/Jul/);
  });

  /** The calendar day after `key`, by arithmetic that no zone can move. */
  const dayAfter = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  };

  it('ends the day where the day headings end it, DST days included', () => {
    for (const key of ['2026-07-22', '2026-03-08', '2026-11-01', '2026-03-29', '2026-10-25', '2026-12-31']) {
      const end = Date.parse(parseDay(key)!.end);
      // The last millisecond before the cursor is still the day …
      expect(dayKeyOf(new Date(end - 1).toISOString())).toBe(key);
      // … and the cursor itself is already the next one: nothing in between.
      expect(dayKeyOf(new Date(end).toISOString())).toBe(dayAfter(key));
    }
  });

  it('refuses anything that is not a real calendar day, rather than guessing', () => {
    for (const raw of ['2026-02-30', '2026-13-01', '2026-7-22', '22/07/2026', '', ' 2026-07-22', '2026-07-22 ', 'foo', '0099-01-01']) {
      expect(parseDay(raw)).toBeNull();
    }
    expect(parseDay(null)).toBeNull();
    expect(parseDay(undefined)).toBeNull();
    expect(parseDay('2028-02-29')).not.toBeNull();
  });

  it('never seeds an expanded-year instant, which a hand-typed 9999-12-31 would make', () => {
    // Where the day after 9999-12-31 starts past 9999 in UTC (every zone west
    // of Greenwich, the suite's New York pin included) the raw end would be
    // `+010000-01-01T…`; east of it the end is still 9999-12-31 in UTC and is
    // an ordinary seed. Either way the cursor keeps the four-digit shape.
    const expanded = new Date(9999, 11, 32).getUTCFullYear() > 9999;
    if (expanded) expect(parseDay('9999-12-31')).toBeNull();
    for (const key of ['9999-12-31', '9999-12-30', '0100-01-01', '2026-07-22']) {
      const d = parseDay(key);
      if (d) expect(d.end).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
    expect(parseDay('9999-12-30')).not.toBeNull();
  });
});

/**
 * F-634 (2026-10-09). /logs dated every row on the device's clock. The suite
 * runs on New York's; these read a Los Angeles house from there.
 */
describe('lg-format — the house’s clock', () => {
  const LA = 'America/Los_Angeles';
  // Friday 24 Jul 2026, 20:30 and 22:00 in Los Angeles; 23:30 Fri and 01:00 Sat in New York.
  const late = '2026-07-25T03:30:00.000Z';
  const later = '2026-07-25T05:00:00.000Z';
  const row = (id: string, at: string) => ({ id, source: 'pos_checks', occurredAt: at, summary: id }) as never;

  it('keeps one service on one house day, wherever it is read from', () => {
    expect(groupByDay([row('b', later), row('a', late)]).map((g) => g.key)).toEqual(['2026-07-25', '2026-07-24']);
    const house = groupByDay([row('b', later), row('a', late)], LA);
    expect(house.map((g) => g.key)).toEqual(['2026-07-24']);
    expect(house[0].heading).toMatch(/Fri/);
    expect(house[0].heading).toMatch(/24/);
  });

  it('stamps the time of day on the house’s clock', () => {
    expect(fmtClock(later, LA)).toMatch(/10:00:00\s*PM/);
    expect(fmtStamp(later, LA)).toMatch(/Fri.*24.*10:00:00\s*PM/);
    expect(dayKeyOf(later, LA)).toBe('2026-07-24');
  });

  it('a zone this browser cannot read leaves the device’s clock, never a blank', () => {
    expect(dayKeyOf(later, 'Not/AZone')).toBe(dayKeyOf(later));
    expect(fmtClock(later, 'Not/AZone')).toBe(fmtClock(later));
  });

  it('ends a named day where the house’s day headings end it, DST days included', () => {
    const dayAfter = (key: string) => {
      const [y, m, d] = key.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    };
    for (const zone of [LA, 'Europe/Istanbul', 'America/Havana', 'Asia/Beirut', 'Australia/Lord_Howe']) {
      for (const key of ['2026-07-22', '2026-03-08', '2026-11-01', '2026-03-29', '2026-10-25', '2026-12-31']) {
        const d = parseDay(key, zone)!;
        const end = Date.parse(d.end);
        expect(dayKeyOf(new Date(end - 1).toISOString(), zone)).toBe(key);
        expect(dayKeyOf(new Date(end).toISOString(), zone)).toBe(dayAfter(key));
      }
    }
    // The heading is the house's name for the day.
    expect(parseDay('2026-07-24', LA)!.heading).toMatch(/Fri/);
    // A Los Angeles day ends at 07:00 UTC in summer, not at New York's 04:00.
    expect(parseDay('2026-07-24', LA)!.end).toBe('2026-07-25T07:00:00.000Z');
  });
});
