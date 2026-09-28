import { describe, expect, it } from 'vitest';
import {
  NOT_RECORDED,
  countBySource,
  dayKeyOf,
  displaySources,
  fmtClock,
  fmtStamp,
  groupByDay,
  labelOf,
  linkOutFor,
  listSources,
  nameOf,
  noLinkReason,
  orderForThread,
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
