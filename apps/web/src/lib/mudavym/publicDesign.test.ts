import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_OVERRIDE_KEY, isPublicDesignOn, usePublicDesign } from './publicDesign';

/**
 * ADR 0133 §Decision 1 / decision 0149 rows 3 and 7 — the public door's one
 * switch is now permanent-on. The only escape is an explicit QA override of
 * `"off"` in `localStorage`, kept solely so today's page stays reachable and
 * compiling until the gated cutover deletes it.
 */
describe('publicDesign — permanent-on (decision 0149)', () => {
  beforeEach(() => {
    window.localStorage.removeItem(PUBLIC_OVERRIDE_KEY);
  });

  afterEach(() => {
    window.localStorage.removeItem(PUBLIC_OVERRIDE_KEY);
    vi.restoreAllMocks();
  });

  it('absence of any override is on — the house treatment is the default now', () => {
    expect(isPublicDesignOn()).toBe(true);
    expect(usePublicDesign()).toBe(true);
  });

  it.each(['0', 'false', 'off', ' OFF '])(
    'an explicit QA override %j forces today\'s page',
    (v) => {
      window.localStorage.setItem(PUBLIC_OVERRIDE_KEY, v);
      expect(isPublicDesignOn()).toBe(false);
    },
  );

  it.each(['1', 'true', 'on', 'yes', 'maybe', ''])(
    'anything that is not an explicit off (%j) stays on',
    (v) => {
      window.localStorage.setItem(PUBLIC_OVERRIDE_KEY, v);
      expect(isPublicDesignOn()).toBe(true);
    },
  );

  it('blocked storage behaves as no override — still on', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(isPublicDesignOn()).toBe(true);
  });
});
