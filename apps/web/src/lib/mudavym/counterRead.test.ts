/**
 * The counter's arithmetic — every line here is a way it could print a failure
 * as health (sketch 119, rounds two and three of the critique).
 */

import { describe, expect, it } from 'vitest';
import {
  actsWaiting,
  counterHead,
  roomForAct,
  verbMark,
  type CounterRegister,
} from './counterRead';

const T = '2026-09-21T14:02:11Z';

function answered(key: CounterRegister['key'], verb: CounterRegister['verb'], count: number, over: Record<string, unknown> = {}): CounterRegister {
  return { key, verb, state: 'answered', readAt: T, ms: 4, count, complete: true, rows: [], act: 'yours', ...over } as CounterRegister;
}
function refused(key: CounterRegister['key'], verb: CounterRegister['verb']): CounterRegister {
  return { key, verb, state: 'refused', readAt: T, ms: 0, sentence: 'for an owner or a manager' };
}
function unread(key: CounterRegister['key'], verb: CounterRegister['verb']): CounterRegister {
  return { key, verb, state: 'unreadable', readAt: T, ms: 8000, status: 503, sentence: 'x could not be read (503).' };
}

const OWNER_ALL: CounterRegister[] = [
  answered('orders', 'seal', 3),
  answered('deliveries', 'verify', 1),
  answered('credits', 'verify', 1),
  answered('threads', 'reply', 2),
  answered('identities', 'decide', 0),
  answered('invitations', 'decide', 1),
  answered('proposals', 'proposed', 1),
];

describe('the head counts registers, never acts', () => {
  it('n of n only when every register answered', () => {
    expect(counterHead(OWNER_ALL)).toBe('7 of 7 registers');
  });

  it('names refusals on their own, never folded into the n that answered', () => {
    const staff = OWNER_ALL.map((r) =>
      r.key === 'credits' || r.key === 'invitations' ? refused(r.key, r.verb) : r,
    );
    expect(counterHead(staff)).toBe('5 of 7 registers · 2 refused');
  });

  it('names registers not read, and never n of n with one missing', () => {
    const partial = OWNER_ALL.map((r) => (r.key === 'credits' ? unread(r.key, r.verb) : r));
    expect(counterHead(partial)).toBe('6 of 7 registers · 1 not read');
  });

  it('carries both clauses when both happen', () => {
    const both = OWNER_ALL.map((r) =>
      r.key === 'credits' ? refused(r.key, r.verb) : r.key === 'threads' ? unread(r.key, r.verb) : r,
    );
    expect(counterHead(both)).toBe('5 of 7 registers · 1 refused · 1 not read');
  });

  it('is never a sum of acts', () => {
    // 3 + 1 + 1 + 2 + 0 + 1 + 1 = 9 acts; the head must not print 9.
    expect(counterHead(OWNER_ALL)).not.toMatch(/\b9\b/);
  });
});

describe("a verb's mark on the tucked strip", () => {
  it('sums a verb only when every register under it answered', () => {
    expect(verbMark(OWNER_ALL, 'verify')).toEqual({ kind: 'count', count: 2, floor: false });
  });

  it('is a ring, not a smaller number, when one of its registers was not read', () => {
    const partial = OWNER_ALL.map((r) => (r.key === 'credits' ? unread(r.key, r.verb) : r));
    expect(verbMark(partial, 'verify')).toEqual({ kind: 'unread' });
  });

  it('is refused when every register under it refused', () => {
    const regs = [refused('invitations', 'decide'), refused('identities', 'decide')];
    expect(verbMark(regs, 'decide')).toEqual({ kind: 'refused' });
  });

  it('counts what the role may see when the rest refused', () => {
    const regs = [answered('deliveries', 'verify', 2), refused('credits', 'verify')];
    expect(verbMark(regs, 'verify')).toEqual({ kind: 'count', count: 2, floor: false });
  });

  it('marks a page-sized answer as a floor', () => {
    const regs = [answered('identities', 'decide', 50, { complete: false })];
    expect(verbMark(regs, 'decide')).toEqual({ kind: 'count', count: 50, floor: true });
  });
});

describe('the dot: something waits on YOU, or cannot say', () => {
  it('true when an answered register of yours holds a row', () => {
    expect(actsWaiting(OWNER_ALL)).toBe(true);
  });

  it("false only when every register answered and none of yours holds a row", () => {
    const quiet = OWNER_ALL.map((r) => (r.state === 'answered' ? { ...r, count: 0 } : r));
    expect(actsWaiting(quiet)).toBe(false);
  });

  it("the house's count is not your act", () => {
    const notMine = [answered('orders', 'seal', 4, { act: 'not_yours' })];
    expect(actsWaiting(notMine)).toBe(false);
  });

  it('null — not false — when a register was not read', () => {
    const quiet = [answered('orders', 'seal', 0), unread('threads', 'reply')];
    expect(actsWaiting(quiet)).toBeNull();
  });
});

describe('roomForAct — an act opens the record it names (DASH-W16e)', () => {
  const thread = { id: 't-1', vendor: null, orderNumber: null, channel: null, intent: null, aiGenerated: false, createdAt: null };
  it('deep-links every register that has a room, and none that has not', () => {
    expect(roomForAct('orders', { id: 'o-1' } as never)).toEqual({ name: 'Orders', path: '/orders?order=o-1' });
    expect(roomForAct('deliveries', { orderId: 'o-2' } as never)).toEqual({ name: 'Receiving', path: '/receiving?order=o-2' });
    expect(roomForAct('credits', { id: 'c-1' } as never)).toEqual({ name: 'Receipts & Credits', path: '/receipts?tab=credits&credit=c-1' });
    expect(roomForAct('threads', { ...thread, orderId: 'o-3' })).toEqual({ name: 'Communications', path: '/communications?reply=o-3' });
    expect(roomForAct('threads', { ...thread, orderId: null })).toEqual({ name: 'Communications', path: '/communications' });
    expect(roomForAct('invitations', { id: 'i-1' } as never)).toEqual({ name: 'Team', path: '/team' });
    expect(roomForAct('identities', { id: 'x' } as never)).toBeNull();
    expect(roomForAct('proposals', { id: 'x' } as never)).toBeNull();
  });
  it('encodes the id', () => {
    expect(roomForAct('orders', { id: 'a&b=c d' } as never)?.path).toBe('/orders?order=a%26b%3Dc%20d');
  });
});
