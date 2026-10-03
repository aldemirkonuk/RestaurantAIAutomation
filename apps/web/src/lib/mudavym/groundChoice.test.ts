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
 *
 * [2026-10-01, ADR 0169 amendment batch 4: the person may now CHOOSE System —
 * "Paper / Charcoal / System". Half (1) still holds for anyone who has not
 * chosen; the device is read only while the stored setting is `system`. The
 * last describe block below is that rule.]
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  GROUND_CHOICE_ATTR,
  GROUND_OPTIONS,
  applyAccountGround,
  getGroundChoice,
  getGroundState,
  groundIsKnown,
  groundMirrorKey,
  groundNote,
  groundPaintFor,
  registerGroundWriter,
  reportGroundReadFailure,
  resetGroundChoiceForTests,
  setGroundChoice,
  setGroundOwner,
  useGroundChoice,
  useGroundState,
  type GroundState,
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
    // Nobody who has not chosen System is ever matched to their device
    // (2026-09-21, restated 2026-10-01 — "paper at first always"), so nothing
    // on this path may consult it. `window.matchMedia` is replaced (not
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

/**
 * What a control says — `groundIsKnown` / `groundNote` / `GROUND_OPTIONS`.
 * These moved here from the deleted header `ThemeMenu` when the control moved
 * to `/profile` (founder, 2026-10-01, page walk-through DASH-W23); the
 * assertions are ported from `ThemeMenu.test.tsx`'s ground branch, with the
 * note texts pinned EXACTLY rather than by a fragment.
 */
describe('ADR 0169 — what the ground control says', () => {
  const state = (over: Partial<GroundState>): GroundState => ({
    choice: 'paper',
    setting: 'paper',
    source: 'default',
    readFailed: false,
    writeError: null,
    detail: null,
    ...over,
  });

  it('offers Paper, Charcoal and System, in that order — the founder\'s words, 2026-10-01', () => {
    expect(GROUND_OPTIONS.map((o) => o.value)).toEqual(['paper', 'charcoal', 'system']);
    expect(GROUND_OPTIONS.map((o) => o.label)).toEqual(['Paper', 'Charcoal', 'System']);
    // System is the one that needs saying; it says it in plain words.
    expect(GROUND_OPTIONS.find((o) => o.value === 'system')?.hint).toBe(
      'Follows this device’s light or dark setting.',
    );
  });

  it('counts nothing as chosen under `unknown` and `unreadable`', () => {
    expect(groundIsKnown(state({ source: 'unknown' }))).toBe(false);
    expect(groundIsKnown(state({ source: 'unreadable', readFailed: true, detail: 'x' }))).toBe(false);
  });

  it('counts paper-by-default (`default`) as a real, known answer — and `account` and `device-cache` too', () => {
    expect(groundIsKnown(state({ source: 'default' }))).toBe(true);
    expect(groundIsKnown(state({ source: 'account', choice: 'charcoal' }))).toBe(true);
    expect(groundIsKnown(state({ source: 'device-cache', choice: 'charcoal' }))).toBe(true);
  });

  it('says nothing for a confirmed answer', () => {
    expect(groundNote(state({ source: 'default' }))).toBeNull();
    expect(groundNote(state({ source: 'account', choice: 'charcoal' }))).toBeNull();
  });

  it('says it is still reading under `unknown`', () => {
    expect(groundNote(state({ source: 'unknown' }))).toBe(
      'Reading the ground you saved to your account. Paper until it answers.',
    );
  });

  it('says the saved ground could not be read under `unreadable`, with and without a reason', () => {
    expect(groundNote(state({ source: 'unreadable', readFailed: true, detail: 'Network Error' }))).toBe(
      'The ground you saved could not be read (Network Error). Paper until it can be.',
    );
    expect(groundNote(state({ source: 'unreadable', readFailed: true, detail: null }))).toBe(
      'The ground you saved could not be read (unknown reason). Paper until it can be.',
    );
    expect(groundNote(state({ source: 'unreadable', readFailed: false }))).toBe(
      'The ground you saved could not be read. Paper until it can be.',
    );
  });

  it("names this device's copy under `device-cache`, and says whether the account was reached", () => {
    expect(
      groundNote(state({ source: 'device-cache', choice: 'charcoal', readFailed: true, detail: 'Network Error' })),
    ).toBe(
      'Your account could not be reached (Network Error). This is the last ground this device saw you choose.',
    );
    expect(groundNote(state({ source: 'device-cache', choice: 'charcoal', readFailed: true }))).toBe(
      'Your account could not be reached (unknown reason). This is the last ground this device saw you choose.',
    );
    expect(groundNote(state({ source: 'device-cache', choice: 'charcoal' }))).toBe(
      'This is the last ground this device saw you choose, while your account answers.',
    );
  });

  it('a write error outranks a read error — it is the thing that just happened', () => {
    const writeError = 'This ground is not saved to your account (503). It will go back on your next visit.';
    expect(
      groundNote(state({ source: 'unreadable', readFailed: true, detail: 'Network Error', writeError })),
    ).toBe(writeError);
    expect(groundNote(state({ source: 'device-cache', readFailed: true, detail: 'x', writeError }))).toBe(
      writeError,
    );
    expect(groundNote(state({ source: 'account', writeError }))).toBe(writeError);
  });

  it('the store\'s own failed save reaches the note word for word', async () => {
    setGroundOwner(ALICE);
    applyAccountGround(undefined);
    refusingWriter('Request failed with status code 503');
    setGroundChoice('charcoal');
    await settle();
    expect(groundNote(getGroundState())).toBe(
      'This ground is not saved to your account (Request failed with status code 503). It will go back on your next visit.',
    );
    expect(groundIsKnown(getGroundState())).toBe(true);
  });
});

/**
 * ADR 0169 amendment 2026-10-01 (batch 4) — the founder: "Paper / Charcoal /
 * System". System is stored as itself and painted as the device's light/dark,
 * live; and it is the ONLY setting under which the device is read.
 */
describe('ADR 0169 batch 4 — System follows the device, and only System reads it', () => {
  /** Replaces `window.matchMedia` with a device whose light/dark can be
   *  flipped, and which records every query and every live listener. */
  function fakeDevice(dark: boolean) {
    const original = window.matchMedia;
    const asked: string[] = [];
    const listeners = new Set<() => void>();
    let matches = dark;
    window.matchMedia = ((query: string) => {
      asked.push(query);
      return {
        get matches() {
          return matches;
        },
        media: query,
        onchange: null,
        addListener: (fn: () => void) => listeners.add(fn),
        removeListener: (fn: () => void) => listeners.delete(fn),
        addEventListener: (_: string, fn: () => void) => listeners.add(fn),
        removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
        dispatchEvent: () => false,
      } as unknown as MediaQueryList;
    }) as typeof window.matchMedia;
    return {
      asked,
      listeners,
      flip(next: boolean) {
        matches = next;
        for (const fn of [...listeners]) fn();
      },
      restore() {
        window.matchMedia = original;
      },
    };
  }

  let device: ReturnType<typeof fakeDevice> | null = null;
  afterEach(() => {
    device?.restore();
    device = null;
  });

  it('a stored System resolves to the device, and follows it when it changes', () => {
    device = fakeDevice(true);
    setGroundOwner(ALICE);
    applyAccountGround('system');
    expect(getGroundState()).toMatchObject({ setting: 'system', choice: 'charcoal', source: 'account' });
    // The attribute is always a ground, never the word "system".
    expect(document.documentElement.getAttribute(GROUND_CHOICE_ATTR)).toBe('charcoal');
    expect(device.asked).toEqual(['(prefers-color-scheme: dark)']);

    act(() => device!.flip(false));
    expect(getGroundChoice()).toBe('paper');
    expect(document.documentElement.getAttribute(GROUND_CHOICE_ATTR)).toBe('paper');
    expect(getGroundState().setting).toBe('system');

    act(() => device!.flip(true));
    expect(getGroundChoice()).toBe('charcoal');
    // Followed through one listener the whole time, not one per repaint.
    expect(device.listeners.size).toBe(1);
  });

  it('a mounted useGroundChoice() repaints when the device flips', () => {
    device = fakeDevice(false);
    setGroundOwner(ALICE);
    applyAccountGround('system');
    const { result, unmount } = renderHook(() => useGroundChoice());
    expect(result.current[0]).toBe('paper');
    act(() => device!.flip(true));
    expect(result.current[0]).toBe('charcoal');
    unmount();
  });

  it('the mirror keeps "system", not the ground it painted — so the next load follows the device too', () => {
    device = fakeDevice(true);
    setGroundOwner(ALICE);
    applyAccountGround('system');
    expect(window.localStorage.getItem(groundMirrorKey(ALICE))).toBe('system');

    // Next load on a light device: the mirror applies System before the account answers.
    resetGroundChoiceForTests();
    device.restore();
    device = fakeDevice(false);
    setGroundOwner(ALICE);
    expect(getGroundState()).toMatchObject({ setting: 'system', choice: 'paper', source: 'device-cache' });
    expect(device.asked).toHaveLength(1);
  });

  it('never reads the device for default, unknown, unreadable, Paper or Charcoal', async () => {
    device = fakeDevice(true);
    acceptingWriter();
    // default — nobody signed in
    expect(getGroundChoice()).toBe('paper');
    setGroundOwner(null);
    // unknown — signed in, the account has not answered
    setGroundOwner(ALICE);
    expect(getGroundState().source).toBe('unknown');
    // unreadable — the read failed, no mirror
    reportGroundReadFailure('Network Error');
    expect(getGroundState().source).toBe('unreadable');
    // default — the account answered "never chosen"
    applyAccountGround(undefined);
    expect(getGroundState().source).toBe('default');
    // an account value this app does not know
    applyAccountGround('neon');
    // Paper and Charcoal, from the account and from the control
    applyAccountGround('paper');
    applyAccountGround('charcoal');
    setGroundChoice('paper');
    setGroundChoice('charcoal');
    await settle();
    expect(groundPaintFor('paper')).toBe('paper');
    expect(groundPaintFor('charcoal')).toBe('charcoal');
    // And a fresh person on this device with no mirror at all.
    setGroundOwner(BOB);
    expect(getGroundChoice()).toBe('paper');
    expect(device.asked).toEqual([]);
    expect(device.listeners.size).toBe(0);
  });

  it('choosing System saves "system", and choosing away from it stops following', async () => {
    device = fakeDevice(true);
    const saved = acceptingWriter();
    setGroundOwner(ALICE);
    applyAccountGround(undefined);

    setGroundChoice('system');
    await settle();
    expect(saved).toEqual(['system']);
    expect(getGroundState()).toMatchObject({ setting: 'system', choice: 'charcoal', source: 'account' });
    expect(device.listeners.size).toBe(1);

    setGroundChoice('paper');
    await settle();
    expect(saved).toEqual(['system', 'paper']);
    expect(device.listeners.size).toBe(0);
    act(() => device!.flip(true));
    expect(getGroundChoice()).toBe('paper');
  });

  it('a change of person stops following the previous person\'s device setting', () => {
    device = fakeDevice(true);
    setGroundOwner(ALICE);
    applyAccountGround('system');
    expect(device.listeners.size).toBe(1);

    setGroundOwner(BOB);
    expect(device.listeners.size).toBe(0);
    act(() => device!.flip(false));
    act(() => device!.flip(true));
    // Bob never chose System — a dark device does not reach him.
    expect(getGroundChoice()).toBe('paper');

    // Signing out stops it too.
    setGroundOwner(ALICE);
    expect(device.listeners.size).toBe(1);
    setGroundOwner(null);
    expect(device.listeners.size).toBe(0);
  });

  it('a person switch between two System people follows once, not twice', () => {
    device = fakeDevice(true);
    window.localStorage.setItem(groundMirrorKey(BOB), 'system');
    setGroundOwner(ALICE);
    applyAccountGround('system');
    setGroundOwner(BOB);
    expect(getGroundState()).toMatchObject({ setting: 'system', choice: 'charcoal', source: 'device-cache' });
    expect(device.listeners.size).toBe(1);
  });

  it('a browser with no media queries paints System as paper rather than failing', () => {
    const original = window.matchMedia;
    (window as unknown as { matchMedia: unknown }).matchMedia = undefined;
    try {
      setGroundOwner(ALICE);
      expect(() => applyAccountGround('system')).not.toThrow();
      expect(getGroundState()).toMatchObject({ setting: 'system', choice: 'paper', source: 'account' });
    } finally {
      window.matchMedia = original;
    }
  });

  it('the preview reads the device only when handed System', () => {
    device = fakeDevice(true);
    expect(groundPaintFor('paper')).toBe('paper');
    expect(groundPaintFor('charcoal')).toBe('charcoal');
    expect(device.asked).toEqual([]);
    expect(groundPaintFor('system')).toBe('charcoal');
    expect(device.asked).toHaveLength(1);
  });
});
