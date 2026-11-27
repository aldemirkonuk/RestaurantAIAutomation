/**
 * The warm start's store (r108 g8): one tab's sessionStorage, keyed by
 * (user, house, role). Another role or another house never sees an entry, an
 * entry past 15 minutes is ignored, sign-out and a house switch clear it, and
 * a store that throws is simply no warm start.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flushWarm,
  forgetWarm,
  WARM_KEY,
  WARM_MAX_AGE_MS,
  WARM_MAX_CHARS,
  warmRead,
  warmWords,
  warmWrite,
  type WarmOwner,
} from './rp-warm';

const OWNER: WarmOwner = { userId: 'u1', restaurantId: 'r1', role: 'owner' };
const T0 = 1_800_000_000_000;

/** What the next page load finds: the store as written, read afresh. */
function reload() {
  flushWarm(T0);
  const kept = sessionStorage.getItem(WARM_KEY);
  forgetWarm();
  if (kept !== null) sessionStorage.setItem(WARM_KEY, kept);
}

beforeEach(() => {
  forgetWarm();
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('the warm store', () => {
  it('[REVERT-FAILS] keeps a read across a reload, in sessionStorage and never localStorage', () => {
    warmWrite(OWNER, 'till', { revenue: 4120 }, T0);
    reload();
    expect(warmRead(OWNER, 'till', T0 + 1000)).toEqual({ at: T0, data: { revenue: 4120 } });
    expect(localStorage.getItem(WARM_KEY)).toBeNull();
  });

  it('[REVERT-FAILS] another role in the same house never sees it, and the entry is dropped', () => {
    warmWrite({ ...OWNER, role: 'manager' }, 'till', { revenue: 4120 }, T0);
    reload();
    expect(warmRead({ ...OWNER, role: 'staff' }, 'till', T0)).toBeUndefined();
    // Not kept for the manager either once another role has asked: the owner of the store changed hands.
    expect(warmRead({ ...OWNER, role: 'manager' }, 'till', T0)).toBeUndefined();
    expect(sessionStorage.getItem(WARM_KEY)).toBeNull();
  });

  it('[REVERT-FAILS] another house, or another person, never sees it', () => {
    warmWrite(OWNER, 'till', { revenue: 4120 }, T0);
    reload();
    expect(warmRead({ ...OWNER, restaurantId: 'r2' }, 'till', T0)).toBeUndefined();
    warmWrite(OWNER, 'till', { revenue: 4120 }, T0);
    reload();
    expect(warmRead({ ...OWNER, userId: 'u2' }, 'till', T0)).toBeUndefined();
  });

  it('[REVERT-FAILS] no owner (the role not known yet) reads and writes nothing', () => {
    warmWrite(null, 'till', { revenue: 1 }, T0);
    flushWarm(T0);
    expect(sessionStorage.getItem(WARM_KEY)).toBeNull();
    warmWrite(OWNER, 'till', { revenue: 1 }, T0);
    expect(warmRead(null, 'till', T0)).toBeUndefined();
  });

  it('[REVERT-FAILS] a read older than 15 minutes is ignored', () => {
    warmWrite(OWNER, 'till', { revenue: 4120 }, T0);
    reload();
    expect(warmRead(OWNER, 'till', T0 + WARM_MAX_AGE_MS)).toBeDefined();
    expect(warmRead(OWNER, 'till', T0 + WARM_MAX_AGE_MS + 1)).toBeUndefined();
  });

  it('[REVERT-FAILS] holds at most 400,000 characters, the oldest read out first', () => {
    const big = 'x'.repeat(150_000);
    warmWrite(OWNER, 'a', big, T0);
    warmWrite(OWNER, 'b', big, T0 + 1);
    warmWrite(OWNER, 'c', big, T0 + 2);
    reload();
    expect((sessionStorage.getItem(WARM_KEY) ?? '').length).toBeLessThanOrEqual(WARM_MAX_CHARS);
    expect(warmRead(OWNER, 'a', T0 + 3)).toBeUndefined();
    expect(warmRead(OWNER, 'b', T0 + 3)).toBeDefined();
    expect(warmRead(OWNER, 'c', T0 + 3)).toBeDefined();
    // A read that alone is past the cap is not kept at all.
    warmWrite(OWNER, 'huge', 'y'.repeat(WARM_MAX_CHARS + 1), T0 + 4);
    expect(warmRead(OWNER, 'huge', T0 + 5)).toBeUndefined();
  });

  it('[REVERT-FAILS] a store that throws is no warm start, and nothing throws to the page', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(() => {
      warmWrite(OWNER, 'till', { revenue: 1 }, T0);
      flushWarm(T0);
    }).not.toThrow();
    vi.restoreAllMocks();
    forgetWarm();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(warmRead(OWNER, 'till', T0)).toBeUndefined();
  });

  it('[REVERT-FAILS] says when the kept read was read', () => {
    const at = new Date(2026, 10, 27, 14, 2).getTime();
    expect(warmWords(at)).toBe('Read at 14:02, reading again');
  });
});
