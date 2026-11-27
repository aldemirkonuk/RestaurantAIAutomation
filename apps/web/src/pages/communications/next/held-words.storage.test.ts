/**
 * r109 mail-gap g2: a half-written reply is kept in this tab under
 * mail-reply:<userId>:<restaurantId>:<threadKey>, stamped, for a day. What this
 * pins: the round trip, the day's limit, that another person's or another
 * house's hold is removed as it is read, that sign-out's sweep removes only
 * held replies, that the hook writes, keeps on Resume, and lets go on Discard
 * and on a queued send, and that blocked storage costs nothing but the tab.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  REPLY_HOLD_MS,
  clearReplyHold,
  forgetReplyHolds,
  readReplyHolds,
  useReplyHolds,
  writeReplyHold,
} from './held-words';

type W = { subject: string; body: string };
type A = { answers: string };
const hold = (at: number) => ({ words: { subject: 'Re: Friday', body: 'Six cases' }, answer: { answers: 'm1' }, personKey: 'vendor:p1', at });
const KEY = 'mail-reply:u1:r1:gm:t1';

beforeEach(() => window.sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('reply holds in sessionStorage', () => {
  it('a hold is written under the person, the house and the thread, and read back', () => {
    writeReplyHold('u1', 'r1', 'gm:t1', hold(1000));
    expect(JSON.parse(window.sessionStorage.getItem(KEY) ?? 'null')).toMatchObject({ at: 1000, personKey: 'vendor:p1' });
    expect(readReplyHolds<W, A>('u1', 'r1', 2000)).toEqual({ 'gm:t1': hold(1000) });
    clearReplyHold('u1', 'r1', 'gm:t1');
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it('a hold a day old is dropped, and removed, as it is read', () => {
    writeReplyHold('u1', 'r1', 'gm:t1', hold(0));
    expect(readReplyHolds('u1', 'r1', REPLY_HOLD_MS - 1)).toHaveProperty(['gm:t1']);
    expect(readReplyHolds('u1', 'r1', REPLY_HOLD_MS)).toEqual({});
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("another person's or another house's hold is never read, and is removed", () => {
    writeReplyHold('u2', 'r1', 'gm:t1', hold(1000));
    writeReplyHold('u1', 'r2', 'gm:t1', hold(1000));
    window.sessionStorage.setItem('mail-reply:u1:r1:gm:bad', '{not json');
    window.sessionStorage.setItem('mail-people-height:r1:wide', '300');
    expect(readReplyHolds('u1', 'r1', 2000)).toEqual({});
    expect(Object.keys(window.sessionStorage)).toEqual(['mail-people-height:r1:wide']);
  });

  it('sign-out and a house switch remove every held reply and nothing else', () => {
    writeReplyHold('u1', 'r1', 'gm:t1', hold(1000));
    writeReplyHold('u1', 'r2', 'gm:t2', hold(1000));
    window.sessionStorage.setItem('mail-people-height:r1:wide', '300');
    forgetReplyHolds();
    expect(Object.keys(window.sessionStorage)).toEqual(['mail-people-height:r1:wide']);
  });

  it('blocked storage throws nowhere and reads as nothing held', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'key').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => writeReplyHold('u1', 'r1', 'gm:t1', hold(1000))).not.toThrow();
    expect(readReplyHolds('u1', 'r1')).toEqual({});
    expect(() => forgetReplyHolds()).not.toThrow();
  });
});

describe('useReplyHolds', () => {
  it('holds in storage, keeps it on Resume, lets it go on Discard, and Put it back writes it again', () => {
    const { result } = renderHook(() => useReplyHolds<W, A>('u1', 'r1'));
    act(() => result.current.hold('gm:t1', { subject: 'Re: Friday', body: 'Six cases' }, { answers: 'm1' }, 'vendor:p1'));
    expect(result.current.get('gm:t1')?.words.body).toBe('Six cases');
    expect(result.current.people.has('vendor:p1')).toBe(true);
    expect(window.sessionStorage.getItem(KEY)).not.toBeNull();

    act(() => result.current.discard('gm:t1'));
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
    expect(result.current.get('gm:t1')?.discarded).toBe(true);
    expect(result.current.people.has('vendor:p1')).toBe(false);
    expect(result.current.take('gm:t1')).toBeNull();

    act(() => result.current.restore('gm:t1'));
    expect(window.sessionStorage.getItem(KEY)).not.toBeNull();

    let taken: ReturnType<typeof result.current.take> = null;
    act(() => {
      taken = result.current.take('gm:t1');
    });
    expect(taken).toMatchObject({ words: { body: 'Six cases' }, answer: { answers: 'm1' } });
    // The stub is gone; the words stay in the tab until the reply is queued.
    expect(result.current.get('gm:t1')).toBeUndefined();
    expect(window.sessionStorage.getItem(KEY)).not.toBeNull();

    act(() => result.current.clear('gm:t1'));
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it('a reload finds the hold again; another house does not', () => {
    writeReplyHold('u1', 'r1', 'gm:t1', { ...hold(Date.now()) });
    // Every render is seen, so not even one frame draws the last house's words.
    const seen: string[] = [];
    const { result, rerender } = renderHook(({ house }) => {
      const r = useReplyHolds<W, A>('u1', house);
      if (house === 'r2' && r.get('gm:t1')) seen.push(house);
      return r;
    }, { initialProps: { house: 'r1' } });
    expect(result.current.get('gm:t1')?.words.subject).toBe('Re: Friday');
    rerender({ house: 'r2' });
    expect(seen).toEqual([]);
    expect(result.current.get('gm:t1')).toBeUndefined();
    expect(result.current.people.size).toBe(0);
  });

  it('with no person or house known, a hold lives in memory and writes nothing', () => {
    const { result } = renderHook(() => useReplyHolds<W, A>(undefined, 'r1'));
    act(() => result.current.hold('gm:t1', { subject: 'Re', body: 'x' }, { answers: 'm1' }, null));
    expect(result.current.get('gm:t1')?.words.body).toBe('x');
    expect(window.sessionStorage.length).toBe(0);
  });
});
