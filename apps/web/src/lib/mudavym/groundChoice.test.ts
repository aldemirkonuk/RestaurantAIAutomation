/**
 * ADR 0169 — the founder's 2026-09-21 answer, "Always paper, follows account".
 *
 * Two halves, and the second replaced what round 4 built:
 *   1. a person who has never chosen always opens on paper, on every device,
 *      and never on their OS's light/dark setting;
 *   2. the choice lives on their ACCOUNT, and this device keeps only a mirror
 *      of what the account said — never a source of truth of its own.
 *
 * The cases below are mostly about the seams of (2): the window before the
 * account answers, a read that fails, a write that fails, and a shared device.
 * The rule this file exists to enforce is that none of those is ever reported
 * as "paper, chosen" (CLAUDE.md §9; memory `absence-reported-as-health`).
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  GROUND_CHOICE_ATTR,
  applyAccountGround,
  getGroundChoice,
  getGroundState,
  groundMirrorKey,
  registerGroundWriter,
  reportGroundReadFailure,
  resetGroundChoiceForTests,
  setGroundChoice,
  setGroundOwner,
  useGroundChoice,
  useGroundState,
} from './groundChoice';

const ALICE = 'user-alice';
const BOB = 'user-bob';

/** A writer that always succeeds, and records what it was asked to save. */
function acceptingWriter() {
  const saved: string[] = [];
  registerGroundWriter((choice) => {
    saved.push(choice);
    return Promise.resolve();
  });
  return saved;
}

/** A writer that always rejects — a gateway that is down, or a 403. */
function refusingWriter(message = 'Network Error') {
  registerGroundWriter(() => Promise.reject(new Error(message)));
}

/** Let the writer's promise settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute(GROUND_CHOICE_ATTR);
  resetGroundChoiceForTests();
});

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute(GROUND_CHOICE_ATTR);
  resetGroundChoiceForTests();
});

describe('ADR 0169 — first visit is paper, and never the device\'s setting', () => {
  it('getGroundChoice() is "paper" before anyone signs in', () => {
    expect(getGroundChoice()).toBe('paper');
    expect(getGroundState().source).toBe('default');
  });

  it('a signed-in person whose account has never held a ground gets paper', () => {
    setGroundOwner(ALICE);
    applyAccountGround(undefined);
    expect(getGroundChoice()).toBe('paper');
    // `default`, not `unknown`: the account ANSWERED, and the answer is that
    // she has never chosen. That is a fact, not an absence.
    expect(getGroundState().source).toBe('default');
  });

  it('ignores the OS setting entirely — a dark-mode device still opens on paper', () => {
    // The founder's answer has no third "match my device" option, so nothing
    // on this path may consult one. `window.matchMedia` is replaced (not
    // spied — `__tests__/setup.ts` defines it non-configurable) with a
    // recorder that reports a dark-mode machine.
    const original = window.matchMedia;
    const asked: string[] = [];
    window.matchMedia = ((query: string) => {
      asked.push(query);
      return {
        matches: true, // as if prefers-color-scheme: dark
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      } as unknown as MediaQueryList;
    }) as typeof window.matchMedia;
    try {
      setGroundOwner(ALICE);
      applyAccountGround(undefined);
      setGroundChoice('paper');
      expect(getGroundChoice()).toBe('paper');
      expect(asked).toEqual([]);
    } finally {
      window.matchMedia = original;
    }
  });

  it('a blocked localStorage (read throws) still resolves to paper', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    try {
      setGroundOwner(ALICE);
      expect(getGroundChoice()).toBe('paper');
      expect(getGroundState().source).toBe('unknown');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('ADR 0169 — the choice is saved to the account, not to this browser', () => {
  it('choosing charcoal applies immediately and is sent to the account', async () => {
    setGroundOwner(ALICE);
    applyAccountGround(undefined);
    const saved = acceptingWriter();

    setGroundChoice('charcoal');
    expect(getGroundChoice()).toBe('charcoal');
    expect(document.documentElement.getAttribute(GROUND_CHOICE_ATTR)).toBe('charcoal');

    await settle();
    expect(saved).toEqual(['charcoal']);
    expect(getGroundState().source).toBe('account');
    expect(getGroundState().writeError).toBeNull();
  });

  it('choosing paper explicitly is saved too — an honest fact, not an absence', async () => {
    setGroundOwner(ALICE);
    const saved = acceptingWriter();
    setGroundChoice('charcoal');
    await settle();
    setGroundChoice('paper');
    await settle();
    expect(saved).toEqual(['charcoal', 'paper']);
    expect(document.documentElement.getAttribute(GROUND_CHOICE_ATTR)).toBe('paper');
  });

  it('writes NO device-wide key — only a mirror under this person\'s id', async () => {
    setGroundOwner(ALICE);
    acceptingWriter();
    setGroundChoice('charcoal');
    await settle();

    expect(window.localStorage.getItem(groundMirrorKey(ALICE))).toBe('charcoal');
    // The round-4 device-wide key is gone. Anything left under it would be
    // read by every person who ever signs in on this browser.
    expect(window.localStorage.getItem('mudavym.ground')).toBeNull();
  });

  it('a mounted useGroundChoice() re-renders when the choice changes', async () => {
    setGroundOwner(ALICE);
    acceptingWriter();
    const { result } = renderHook(() => useGroundChoice());
    expect(result.current[0]).toBe('paper');
    act(() => {
      result.current[1]('charcoal');
    });
    expect(result.current[0]).toBe('charcoal');
    await settle();
  });

  it('a blocked localStorage (write throws) still applies the choice for this view', async () => {
    setGroundOwner(ALICE);
    acceptingWriter();
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    try {
      expect(() => setGroundChoice('charcoal')).not.toThrow();
      await settle();
      expect(getGroundChoice()).toBe('charcoal');
      expect(document.documentElement.getAttribute(GROUND_CHOICE_ATTR)).toBe('charcoal');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('ADR 0169 — the choice follows the person to another device', () => {
  it('a ground saved elsewhere is applied here as soon as the account answers', () => {
    // A brand-new browser: nothing mirrored, nobody has chosen here.
    setGroundOwner(ALICE);
    expect(getGroundChoice()).toBe('paper');
    expect(getGroundState().source).toBe('unknown');

    applyAccountGround('charcoal');
    expect(getGroundChoice()).toBe('charcoal');
    expect(getGroundState().source).toBe('account');
    expect(document.documentElement.getAttribute(GROUND_CHOICE_ATTR)).toBe('charcoal');
  });

  it('a confirmed account answer is mirrored, so the NEXT load paints it before asking', () => {
    setGroundOwner(ALICE);
    applyAccountGround('charcoal');
    expect(window.localStorage.getItem(groundMirrorKey(ALICE))).toBe('charcoal');

    // "Reload": everything in memory is gone, the mirror is not.
    resetGroundChoiceForTests();
    setGroundOwner(ALICE);
    expect(getGroundChoice()).toBe('charcoal');
    expect(getGroundState().source).toBe('device-cache');
  });

  it('syncs across tabs on the same device, for the same person', () => {
    setGroundOwner(ALICE);
    const { result } = renderHook(() => useGroundChoice());
    expect(result.current[0]).toBe('paper');

    // Another tab saved charcoal and mirrored it; jsdom does not dispatch
    // `storage` for same-document writes, so this mirrors a second real tab.
    window.localStorage.setItem(groundMirrorKey(ALICE), 'charcoal');
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: groundMirrorKey(ALICE), newValue: 'charcoal' }),
      );
    });
    expect(result.current[0]).toBe('charcoal');
    expect(document.documentElement.getAttribute(GROUND_CHOICE_ATTR)).toBe('charcoal');
  });

  it('ignores a storage event for another person\'s mirror', () => {
    setGroundOwner(ALICE);
    const { result } = renderHook(() => useGroundChoice());
    window.localStorage.setItem(groundMirrorKey(BOB), 'charcoal');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: groundMirrorKey(BOB) }));
    });
    expect(result.current[0]).toBe('paper');
  });
});

describe('ADR 0169 — a shared device never shows one person another\'s ground', () => {
  it('signing in as someone else drops the previous person\'s ground', () => {
    setGroundOwner(ALICE);
    applyAccountGround('charcoal');
    expect(getGroundChoice()).toBe('charcoal');

    setGroundOwner(BOB);
    expect(getGroundChoice()).toBe('paper');
    expect(getGroundState().source).toBe('unknown');
    expect(document.documentElement.getAttribute(GROUND_CHOICE_ATTR)).toBe('paper');
  });

  it('signing out drops it too, and calls the result a decision, not an unknown', () => {
    setGroundOwner(ALICE);
    applyAccountGround('charcoal');
    setGroundOwner(null);
    expect(getGroundChoice()).toBe('paper');
    expect(getGroundState().source).toBe('default');
  });

  it('each person\'s mirror is their own — Alice\'s charcoal never reaches Bob', () => {
    window.localStorage.setItem(groundMirrorKey(ALICE), 'charcoal');
    setGroundOwner(BOB);
    expect(getGroundChoice()).toBe('paper');
    setGroundOwner(ALICE);
    expect(getGroundChoice()).toBe('charcoal');
  });
});

describe('ADR 0169 — a read that failed is never reported as an answer', () => {
  it('a failed read with no mirror is "unreadable", not "paper by default"', () => {
    setGroundOwner(ALICE);
    reportGroundReadFailure('Network Error');
    const state = getGroundState();
    expect(state.choice).toBe('paper'); // something must paint
    expect(state.source).toBe('unreadable');
    expect(state.readFailed).toBe(true);
    expect(state.detail).toBe('Network Error');
  });

  it('a failed read WITH a mirror keeps showing it, marked unconfirmed', () => {
    window.localStorage.setItem(groundMirrorKey(ALICE), 'charcoal');
    setGroundOwner(ALICE);
    reportGroundReadFailure('Network Error');
    const state = getGroundState();
    expect(state.choice).toBe('charcoal');
    expect(state.source).toBe('device-cache');
    expect(state.readFailed).toBe(true);
  });

  it('an account value this app does not know is reported, not silently ignored', () => {
    setGroundOwner(ALICE);
    applyAccountGround('sepia');
    const state = getGroundState();
    expect(state.choice).toBe('paper');
    expect(state.source).toBe('unreadable');
    expect(state.readFailed).toBe(true);
    expect(state.detail).toContain('sepia');
  });

  it('the window before the account answers is "unknown", not a choice', () => {
    setGroundOwner(ALICE);
    const { result } = renderHook(() => useGroundState());
    expect(result.current.choice).toBe('paper');
    expect(result.current.source).toBe('unknown');
    act(() => {
      applyAccountGround('paper');
    });
    // `account`, not `default`: an explicit stored paper is a choice she made,
    // which is a different thing from never having chosen.
    expect(result.current.source).toBe('account');
  });
});

describe('ADR 0169 — a save that failed is never reported as saved', () => {
  it('reports the failure and leaves the choice applied for this page view', async () => {
    setGroundOwner(ALICE);
    applyAccountGround(undefined);
    refusingWriter('Request failed with status code 503');

    setGroundChoice('charcoal');
    await settle();

    expect(getGroundChoice()).toBe('charcoal'); // still what she asked for
    expect(getGroundState().writeError).toContain('503');
  });

  it('does NOT mirror an unsaved choice — it is gone on the next load', async () => {
    setGroundOwner(ALICE);
    refusingWriter();
    setGroundChoice('charcoal');
    await settle();

    expect(window.localStorage.getItem(groundMirrorKey(ALICE))).toBeNull();
    resetGroundChoiceForTests(); // "reload"
    setGroundOwner(ALICE);
    expect(getGroundChoice()).toBe('paper');
  });

  it('a later account read does not silently snap the ground back underneath her', async () => {
    setGroundOwner(ALICE);
    applyAccountGround('paper');
    refusingWriter();
    setGroundChoice('charcoal');
    await settle();
    expect(getGroundState().writeError).not.toBeNull();

    // `useUserPreferences` rolls its optimistic cache back and refetches, so
    // the OLD server value arrives a moment after the menu said "not saved".
    applyAccountGround('paper');
    expect(getGroundChoice()).toBe('charcoal');
    expect(getGroundState().writeError).not.toBeNull();
  });

  it('with nobody signed in, a choice says so rather than pretending to save', () => {
    setGroundChoice('charcoal');
    expect(getGroundChoice()).toBe('charcoal');
    expect(getGroundState().writeError).toContain('no one is signed in');
    expect(window.localStorage.getItem(groundMirrorKey(ALICE))).toBeNull();
  });
});
