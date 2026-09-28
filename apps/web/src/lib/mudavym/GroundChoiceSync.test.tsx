/**
 * ADR 0169 — the wiring between the account and the ground store.
 *
 * `groundChoice.test.ts` proves the store's state machine; this file proves
 * that `GroundChoiceSync` puts it in the right state for each shape the
 * preferences query can be in, and that a choice made in the header reaches
 * `PATCH /users/:userId/preferences` as a `ground` key — the founder's
 * 2026-09-21 answer, "Always paper, follows account".
 *
 * `useUserPreferences` and the auth store are mocked, because what is under
 * test is the reconciliation, not react-query.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

const authState = { userId: null as string | null };
const prefsState = {
  preferences: {} as { ground?: unknown },
  isPlaceholderData: true,
  error: null as Error | null,
  updatePreferencesAsync: vi.fn(async (_partial: Record<string, unknown>) => ({})),
};

vi.mock('../../stores', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: authState.userId ? { userId: authState.userId } : null }),
}));

vi.mock('../../hooks/useUserPreferences', () => ({
  useUserPreferences: () => prefsState,
}));

import { GroundChoiceSync } from './GroundChoiceSync';
import {
  GROUND_CHOICE_ATTR,
  getGroundOwnerId,
  getGroundState,
  groundMirrorKey,
  resetGroundChoiceForTests,
  setGroundChoice,
} from './groundChoice';

const ALICE = 'user-alice';
const BOB = 'user-bob';

function mount() {
  return render(<GroundChoiceSync />);
}

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
  authState.userId = null;
  prefsState.preferences = {};
  prefsState.isPlaceholderData = true;
  prefsState.error = null;
  prefsState.updatePreferencesAsync = vi.fn(async () => ({}));
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.removeAttribute(GROUND_CHOICE_ATTR);
  resetGroundChoiceForTests();
});

describe('GroundChoiceSync — who the ground belongs to', () => {
  it('renders nothing', () => {
    const { container } = mount();
    expect(container).toBeEmptyDOMElement();
  });

  it('leaves a signed-out visitor on paper, and calls that a decision', () => {
    mount();
    expect(getGroundOwnerId()).toBeNull();
    expect(getGroundState().choice).toBe('paper');
    expect(getGroundState().source).toBe('default');
  });

  it('hands the store the signed-in person', () => {
    authState.userId = ALICE;
    mount();
    expect(getGroundOwnerId()).toBe(ALICE);
  });

  it('a switch to another person on the same device drops the first one\'s ground', () => {
    window.localStorage.setItem(groundMirrorKey(ALICE), 'charcoal');
    authState.userId = ALICE;
    const view = mount();
    expect(getGroundState().choice).toBe('charcoal');

    authState.userId = BOB;
    act(() => {
      view.rerender(<GroundChoiceSync />);
    });
    expect(getGroundOwnerId()).toBe(BOB);
    expect(getGroundState().choice).toBe('paper');
    expect(getGroundState().source).toBe('unknown');
  });
});

describe('GroundChoiceSync — what the account says', () => {
  it('does NOT call a pending read an answer', () => {
    authState.userId = ALICE;
    prefsState.isPlaceholderData = true;
    mount();
    expect(getGroundState().source).toBe('unknown');
    expect(getGroundState().choice).toBe('paper');
  });

  it('applies the account\'s ground once it arrives', () => {
    authState.userId = ALICE;
    prefsState.isPlaceholderData = false;
    prefsState.preferences = { ground: 'charcoal' };
    mount();
    expect(getGroundState().source).toBe('account');
    expect(getGroundState().choice).toBe('charcoal');
    expect(document.documentElement.getAttribute(GROUND_CHOICE_ATTR)).toBe('charcoal');
  });

  it('an account with no ground key means "never chose" — paper, confirmed', () => {
    authState.userId = ALICE;
    prefsState.isPlaceholderData = false;
    prefsState.preferences = {};
    mount();
    expect(getGroundState().source).toBe('default');
    expect(getGroundState().choice).toBe('paper');
  });

  it('a failed read is reported as a failure, never as paper-by-default', () => {
    authState.userId = ALICE;
    prefsState.error = new Error('Network Error');
    mount();
    const state = getGroundState();
    expect(state.source).toBe('unreadable');
    expect(state.readFailed).toBe(true);
    expect(state.detail).toBe('Network Error');
  });

  it('checks the error BEFORE the placeholder — a failed request is not an empty answer', () => {
    // react-query leaves `preferences` as the `{}` placeholder when the
    // request fails, which reads exactly like "she has never chosen".
    authState.userId = ALICE;
    prefsState.error = new Error('Request failed with status code 500');
    prefsState.isPlaceholderData = true;
    prefsState.preferences = {};
    mount();
    expect(getGroundState().source).not.toBe('default');
    expect(getGroundState().readFailed).toBe(true);
  });
});

describe('GroundChoiceSync — how a choice reaches the account', () => {
  it('saves a chosen ground as a `ground` key on the person\'s preferences', async () => {
    authState.userId = ALICE;
    prefsState.isPlaceholderData = false;
    mount();

    act(() => {
      setGroundChoice('charcoal');
    });
    await settle();

    expect(prefsState.updatePreferencesAsync).toHaveBeenCalledWith({ ground: 'charcoal' });
    expect(getGroundState().writeError).toBeNull();
    expect(window.localStorage.getItem(groundMirrorKey(ALICE))).toBe('charcoal');
  });

  it('reports a refused save instead of pretending it landed', async () => {
    authState.userId = ALICE;
    prefsState.isPlaceholderData = false;
    prefsState.updatePreferencesAsync = vi.fn(async () => {
      throw new Error('Request failed with status code 403');
    });
    mount();

    act(() => {
      setGroundChoice('charcoal');
    });
    await settle();

    expect(getGroundState().choice).toBe('charcoal'); // still what she asked for
    expect(getGroundState().writeError).toContain('403');
    // The mirror still holds the account's last CONFIRMED value (paper — she
    // had never chosen). The refused charcoal was never written to it, so it
    // is gone on the next load rather than surviving as a local fiction.
    expect(window.localStorage.getItem(groundMirrorKey(ALICE))).toBe('paper');
  });

  it('with nobody signed in there is no writer, and a choice says so', () => {
    mount();
    act(() => {
      setGroundChoice('charcoal');
    });
    expect(prefsState.updatePreferencesAsync).not.toHaveBeenCalled();
    expect(getGroundState().writeError).toContain('no one is signed in');
  });

  it('unmounting clears the writer, so a later choice cannot write to a dead session', () => {
    authState.userId = ALICE;
    prefsState.isPlaceholderData = false;
    const view = mount();
    view.unmount();
    act(() => {
      setGroundChoice('charcoal');
    });
    expect(prefsState.updatePreferencesAsync).not.toHaveBeenCalled();
    expect(getGroundState().writeError).not.toBeNull();
  });
});
