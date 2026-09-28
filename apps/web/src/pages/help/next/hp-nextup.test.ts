import { describe, expect, it } from 'vitest';
import { nextUpEntries, serviceNeedsAttention } from './hp-nextup';
import type { ReadinessItem } from './hp-readiness';
import type { ServiceState } from './hp-service';

const READY: ServiceState = {
  kind: 'answered',
  ready: true,
  httpStatus: 200,
  commit: 'abc1234',
  bootedAt: null,
  checkedAt: null,
  database: 'ok',
  supabaseClient: 'ok',
  reason: null,
  latencyMs: 40,
  readAt: new Date('2026-09-19T00:00:00.000Z'),
};

const UNREACHABLE: ServiceState = {
  kind: 'unreachable',
  error: 'Network Error',
  latencyMs: 8000,
  readAt: new Date('2026-09-19T00:00:00.000Z'),
};

const item = (over: Partial<ReadinessItem> & Pick<ReadinessItem, 'id'>): ReadinessItem => ({
  label: 'X',
  tone: 'ok',
  detail: 'fine',
  ...over,
});

describe('serviceNeedsAttention', () => {
  it('is false while checking — a read in flight is not a fault', () => {
    expect(serviceNeedsAttention({ kind: 'checking' })).toBe(false);
  });
  it('is true when unreachable', () => {
    expect(serviceNeedsAttention(UNREACHABLE)).toBe(true);
  });
  it('is true when answered but not ready', () => {
    expect(serviceNeedsAttention({ ...READY, ready: false, httpStatus: 503 })).toBe(true);
  });
  it('is false when answered and ready', () => {
    expect(serviceNeedsAttention(READY)).toBe(false);
  });
});

describe('nextUpEntries', () => {
  it('is empty when the service is ready and nothing carries ATTENTION', () => {
    const entries = nextUpEntries({
      service: READY,
      connections: [item({ id: 'mail', tone: 'unknown', detail: 'Reading.' })],
      failed: [],
      waiting: [item({ id: 'orders', tone: 'refused', detail: 'Not yours to see.' })],
    });
    expect(entries).toEqual([]);
  });

  it('a still-loading read never becomes a false next step', () => {
    // Every leaf builder in hp-readiness.ts reports a read in flight as tone
    // `unknown`, detail exactly "Reading." — the case the rail must ignore.
    // If a builder ever starts marking a loading read `attention`, this is
    // the test that should turn red, not a coincidence: nextUpEntries has no
    // separate "is this loading" check of its own to get out of sync.
    const entries = nextUpEntries({
      service: { kind: 'checking' },
      connections: [item({ id: 'mcp', tone: 'unknown', detail: 'Reading.' })],
      failed: [],
      waiting: [item({ id: 'one-tap', tone: 'unknown', detail: 'Reading.' })],
    });
    expect(entries).toEqual([]);
  });

  it('unknown and refused reads stay off the rail — Section I already draws them muted, identically', () => {
    const entries = nextUpEntries({
      service: READY,
      connections: [
        item({ id: 'mcp', tone: 'unknown', detail: 'never probed' }),
        item({ id: 'oauth', tone: 'refused', detail: 'Not yours to see.' }),
      ],
      failed: [],
      waiting: [],
    });
    expect(entries).toEqual([]);
  });

  it('orders the deployment ahead of connections, then last failed, then waiting', () => {
    const entries = nextUpEntries({
      service: UNREACHABLE,
      connections: [
        item({ id: 'mail', tone: 'attention', detail: 'no live grant', actionUrl: '/connections', actionLabel: 'Reconnect' }),
      ],
      failed: [item({ id: 'producer-x', tone: 'attention', detail: '2 failed on its run' })],
      waiting: [
        item({ id: 'one-tap', tone: 'attention', detail: '3 pending', actionUrl: '/', actionLabel: 'Open Dashboard' }),
      ],
    });
    expect(entries.map((e) => e.id)).toEqual(['service', 'connections:mail', 'failed:producer-x', 'waiting:one-tap']);
  });

  it('keeps every attention item within a group, in the group\'s own order', () => {
    const entries = nextUpEntries({
      service: READY,
      connections: [
        item({ id: 'mcp', tone: 'attention', detail: 'bad probe' }),
        item({ id: 'mail', tone: 'attention', detail: 'no live grant' }),
      ],
      failed: [],
      waiting: [],
    });
    expect(entries.map((e) => e.id)).toEqual(['connections:mcp', 'connections:mail']);
  });

  it('carries an item\'s action link through untouched, and prefixes the id with its group', () => {
    const entries = nextUpEntries({
      service: READY,
      connections: [
        item({ id: 'mail', tone: 'attention', detail: 'no live grant', actionUrl: '/connections', actionLabel: 'Reconnect' }),
      ],
      failed: [],
      waiting: [],
    });
    expect(entries).toEqual([
      { id: 'connections:mail', title: 'X', body: 'no live grant', actionUrl: '/connections', actionLabel: 'Reconnect' },
    ]);
  });

  it('drops the actionUrl/actionLabel keys entirely when the item has none — no undefined leaks into the entry', () => {
    const [entry] = nextUpEntries({
      service: READY,
      connections: [item({ id: 'mail', tone: 'attention', detail: 'no live grant' })],
      failed: [],
      waiting: [],
    });
    expect('actionUrl' in entry).toBe(false);
    expect('actionLabel' in entry).toBe(false);
  });

  it('the deployment entry reuses hp-service\'s own sentence and next step, verbatim', () => {
    const [entry] = nextUpEntries({ service: UNREACHABLE, connections: [], failed: [], waiting: [] });
    expect(entry.title).toBe('The gateway did not answer.');
    expect(entry.body).toMatch(/write to support/i);
  });

  it('every entry has a UNIQUE id, even when two groups\' ReadinessItems reuse the same one', () => {
    // Real case, not a contrived one: a live mail grant whose last read
    // failed is ATTENTION in BOTH connectionItems' mailItem (hp-readiness.ts,
    // id "mail") and failedItems' mail check (also id "mail") — the same
    // reading, reported once per group, because Section I renders the two
    // groups in separate cards and never has to tell them apart by id. This
    // rail flattens every group into one list, so a collision here is a
    // real duplicate React key, not a theoretical one.
    const entries = nextUpEntries({
      service: READY,
      connections: [item({ id: 'mail', tone: 'attention', detail: 'Granted, but the last read failed: timeout' })],
      failed: [item({ id: 'mail', tone: 'attention', detail: 'timeout' })],
      waiting: [],
    });
    expect(entries).toHaveLength(2);
    expect(new Set(entries.map((e) => e.id)).size).toBe(2);
  });
});
