import { describe, expect, it } from 'vitest';
import {
  connectionItems,
  failedItems,
  waitingItems,
  type Fetched,
} from './hp-readiness';

const NOW = new Date('2026-09-17T12:00:00.000Z');
const ok = <T,>(data: T): Fetched<T> => ({ status: 'ok', data });
const err = <T,>(message: string): Fetched<T> => ({ status: 'error', message });
const refused = <T,>(message = 'refused'): Fetched<T> => ({ status: 'refused', message });
const loading = <T,>(): Fetched<T> => ({ status: 'loading' });

describe('connectionItems', () => {
  it('a failed read is UNKNOWN, never rendered as "none connected"', () => {
    const items = connectionItems({
      mcp: err('network down'),
      oauth: err('network down'),
      pos: err('network down'),
      mail: err('network down'),
    });
    for (const i of items) {
      expect(i.tone).toBe('unknown');
      expect(i.detail).toMatch(/could not be read/i);
    }
  });

  it('a refused (403) read is its own tone, distinct from a failed one', () => {
    const items = connectionItems({
      mcp: refused(),
      oauth: refused(),
      pos: refused(),
      mail: refused(),
    });
    for (const i of items) expect(i.tone).toBe('refused');
  });

  it('MCP: a non-ok probe is ATTENTION and states when it was probed, in words, never "live"', () => {
    const items = connectionItems({
      mcp: ok([
        {
          id: '1',
          name: 'Vendor bot',
          status: 'active',
          probe: { status: 'unreachable', detail: 'timeout' },
          lastProbeAt: '2026-09-17T10:00:00.000Z',
        },
      ]),
      oauth: ok({ scope: 'own', rows: [] }),
      pos: ok({ sources: [] }),
      mail: ok({ reader: { granted: false, enabled: false, lastReadAt: null, lastError: null } }),
    }, NOW);
    const mcp = items.find((i) => i.id === 'mcp')!;
    expect(mcp.tone).toBe('attention');
    expect(mcp.detail).toContain('unreachable');
    expect(mcp.detail).toContain('2 hours ago');
    expect(mcp.detail).not.toMatch(/is live/i);
  });

  it('MCP: never probed is UNKNOWN, not OK', () => {
    const items = connectionItems({
      mcp: ok([{ id: '1', name: 'X', status: 'active', probe: null, lastProbeAt: null }]),
      oauth: ok({ scope: 'own', rows: [] }),
      pos: ok({ sources: [] }),
      mail: ok({ reader: { granted: false, enabled: false, lastReadAt: null, lastError: null } }),
    });
    expect(items.find((i) => i.id === 'mcp')!.tone).toBe('unknown');
  });

  it('mail: enabled + granted:"unknown" is UNKNOWN, not false', () => {
    const items = connectionItems({
      mcp: ok([]),
      oauth: ok({ scope: 'own', rows: [] }),
      pos: ok({ sources: [] }),
      mail: ok({ reader: { granted: 'unknown', enabled: true, lastReadAt: null, lastError: null } }),
    });
    expect(items.find((i) => i.id === 'mail')!.tone).toBe('unknown');
  });

  it('mail: enabled + granted:false is ATTENTION with a Reconnect action, distinct from off', () => {
    const on = connectionItems({
      mcp: ok([]), oauth: ok({ scope: 'own', rows: [] }), pos: ok({ sources: [] }),
      mail: ok({ reader: { granted: false, enabled: true, lastReadAt: null, lastError: null } }),
    });
    const off = connectionItems({
      mcp: ok([]), oauth: ok({ scope: 'own', rows: [] }), pos: ok({ sources: [] }),
      mail: ok({ reader: { granted: false, enabled: false, lastReadAt: null, lastError: null } }),
    });
    const onItem = on.find((i) => i.id === 'mail')!;
    expect(onItem.tone).toBe('attention');
    expect(onItem.actionUrl).toBe('/connections');
    expect(off.find((i) => i.id === 'mail')!.tone).toBe('ok');
  });

  it('pos: unavailable is UNKNOWN, never a confident "not connected"', () => {
    const items = connectionItems({
      mcp: ok([]), oauth: ok({ scope: 'own', rows: [] }),
      pos: ok({ unavailable: true, sources: null }),
      mail: ok({ reader: { granted: false, enabled: false, lastReadAt: null, lastError: null } }),
    });
    const pos = items.find((i) => i.id === 'pos')!;
    expect(pos.tone).toBe('unknown');
  });

  it('oauth: labels the scope so a house-wide read and a personal read never read as the same fact', () => {
    const own = connectionItems({
      mcp: ok([]),
      oauth: ok({ scope: 'own', rows: [{ integrationId: 'gmail_read', connected: true, connectedAt: null }] }),
      pos: ok({ sources: [] }),
      mail: ok({ reader: { granted: false, enabled: false, lastReadAt: null, lastError: null } }),
    });
    expect(own.find((i) => i.id === 'oauth')!.detail).toContain('of your own');
    const house = connectionItems({
      mcp: ok([]),
      oauth: ok({ scope: 'house', rows: [{ integrationId: 'gmail_read', connected: true, connectedAt: null }] }),
      pos: ok({ sources: [] }),
      mail: ok({ reader: { granted: false, enabled: false, lastReadAt: null, lastError: null } }),
    });
    expect(house.find((i) => i.id === 'oauth')!.detail).toContain('across this house');
  });

  it('a still-loading read is UNKNOWN, not a false OK', () => {
    const items = connectionItems({
      mcp: loading(), oauth: loading(), pos: loading(), mail: loading(),
    });
    for (const i of items) expect(i.tone).toBe('unknown');
  });
});

describe('waitingItems', () => {
  it('a capped Ask AI list renders as a floor, n+, never a bare count at the cap', () => {
    const items = waitingItems({
      oneTap: ok([]),
      ordersPending: ok({ count: 0 }),
      askAi: ok(new Array(20).fill({})),
    });
    expect(items.find((i) => i.id === 'ask-ai')!.detail).toContain('20+');
  });

  it('under the cap it states the real number, no plus', () => {
    const items = waitingItems({
      oneTap: ok([]),
      ordersPending: ok({ count: 0 }),
      askAi: ok(new Array(3).fill({})),
    });
    expect(items.find((i) => i.id === 'ask-ai')!.detail).toContain('3 waiting');
    expect(items.find((i) => i.id === 'ask-ai')!.detail).not.toContain('+');
  });

  it('a failed read is UNKNOWN, never rendered as "nothing waiting"', () => {
    const items = waitingItems({
      oneTap: err('boom'),
      ordersPending: err('boom'),
      askAi: err('boom'),
    });
    for (const i of items) expect(i.tone).toBe('unknown');
  });

  it('a real zero is OK and says so — a computed absence, not a default', () => {
    const items = waitingItems({
      oneTap: ok([]),
      ordersPending: ok({ count: 0 }),
      askAi: ok([]),
    });
    for (const i of items) expect(i.tone).toBe('ok');
  });
});

describe('failedItems', () => {
  it('a clean house with every read settled reports zero items and allChecked true', () => {
    const { items, allChecked } = failedItems({
      producers: ok({ served: true, producers: [{ producer: 'x', lastRun: null, lastRunUnreadable: null }] }),
      reminders: ok({ served: true, ledgerReadable: true, lastRun: null }),
      mail: ok({ reader: { granted: true, enabled: true, lastReadAt: null, lastError: null } }),
      mcp: ok([]),
    });
    expect(items).toHaveLength(0);
    expect(allChecked).toBe(true);
  });

  it('a producer failure surfaces as its own item, dated, with the error', () => {
    const { items } = failedItems({
      producers: ok({
        served: true,
        producers: [{ producer: 'grant_suspended', lastRun: { started_at: '2026-09-17T10:00:00.000Z', failed: 2, error: 'timeout' }, lastRunUnreadable: null }],
      }),
      reminders: ok({ served: true, ledgerReadable: true, lastRun: null }),
      mail: ok({ reader: { granted: true, enabled: true, lastReadAt: null, lastError: null } }),
      mcp: ok([]),
    }, NOW);
    expect(items).toHaveLength(1);
    expect(items[0].detail).toContain('2 failed');
    expect(items[0].detail).toContain('timeout');
  });

  it('a failed read on one source marks allChecked false without dropping other sources’ answers', () => {
    const { items, allChecked } = failedItems({
      producers: err('down'),
      reminders: ok({ served: true, ledgerReadable: true, lastRun: null }),
      mail: ok({ reader: { granted: true, enabled: true, lastReadAt: null, lastError: null } }),
      mcp: ok([]),
    });
    expect(allChecked).toBe(false);
    expect(items.some((i) => i.id === 'producers-read')).toBe(true);
  });

  it('an unreadable inbox error carries no fabricated timestamp', () => {
    const { items } = failedItems({
      producers: ok({ served: true, producers: [] }),
      reminders: ok({ served: true, ledgerReadable: true, lastRun: null }),
      mail: ok({ reader: { granted: true, enabled: true, lastReadAt: null, lastError: 'auth expired' } }),
      mcp: ok([]),
    });
    const mail = items.find((i) => i.id === 'mail')!;
    expect(mail.detail).toBe('auth expired');
    expect(mail.tone).toBe('attention');
  });
});
