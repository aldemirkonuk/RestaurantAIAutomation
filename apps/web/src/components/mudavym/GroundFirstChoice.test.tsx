/**
 * The one-time theme question — ADR 0169 amendment 2026-10-01 (batch 4).
 *
 * The founder: "paper at first always , then they can select is what i meant
 * at onboarding", and "First sign-in, never chosen (Recommended)". So it asks
 * only when the ACCOUNT has answered that this person never chose, Paper
 * pre-selected; saving writes to the account; closing writes nothing.
 *
 * It is rendered here beside the REAL `DataTermsSignInGate`, exactly as
 * `DashboardLayout` mounts the two, with the real `useDataTermsSignInBusy`
 * over a real query client — only the terms endpoint and the auth context are
 * stubbed — so "never stacks on the terms sheet" is measured, not assumed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { GroundFirstChoice } from './GroundFirstChoice';
import { DataTermsSignInGate } from '../settings/DataTermsSignInGate';
import {
  GROUND_CHOICE_ATTR,
  applyAccountGround,
  getGroundState,
  groundMirrorKey,
  registerGroundWriter,
  reportGroundReadFailure,
  resetGroundChoiceForTests,
  setGroundOwner,
} from '../../lib/mudavym/groundChoice';
import {
  GROUND_ASK_SNOOZE_MS,
  applyAccountGroundAsk,
  getGroundAskGate,
  registerGroundAskWriter,
  resetGroundAskForTests,
  type GroundAskRecord,
  noteGroundTaskDone,
} from '../../lib/mudavym/groundAsk';
import type { DataTermsReadout } from '../../services/api/dataTerms';

const roleMock = vi.hoisted(() => ({ current: 'manager' as string | null }));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRole: roleMock.current, activeRestaurantId: 'house-1' }),
}));

const termsMock = vi.hoisted(() => ({ getDataTerms: vi.fn() }));
vi.mock('../../services/api/dataTerms', () => ({
  getDataTerms: termsMock.getDataTerms,
  issueDataTermsSealChallenge: vi.fn(),
  acceptDataTerms: vi.fn(),
}));

const ALICE = 'user-alice';
const ASK = /Choose how Mudavym looks for you/;
const TERMS = /data and privacy terms/;

function readout(over: Partial<DataTermsReadout> = {}): DataTermsReadout {
  return {
    readable: true,
    reason: null,
    version: 1,
    digest: 'a'.repeat(64),
    statements: [{ key: 'k', kind: 'fact', text: 'Jev reads masked vendor mail.', evidence: ['x'] }],
    subprocessors: [],
    changedSince: {},
    acceptance: null,
    current: false,
    jev: { enabled: false, effective: false, pausedBecause: null },
    ...over,
  } as DataTermsReadout;
}

let client: QueryClient;
function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DataTermsSignInGate />
        <GroundFirstChoice />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function ask(): HTMLElement | null {
  return screen.queryByRole('dialog', { name: ASK });
}
function radio(name: 'Paper' | 'Charcoal' | 'System'): HTMLInputElement {
  return screen.getByRole('radio', { name: new RegExp(`^${name}`) }) as HTMLInputElement;
}

/** Alice is signed in and her account has answered: she has never chosen. */
function neverChose() {
  setGroundOwner(ALICE);
  applyAccountGround(undefined);
  // ...and she has finished a task, the gate for the question (N-08 / P0-1).
  applyAccountGroundAsk({ firstTaskAt: '2026-11-01T10:00:00.000Z' });
}
function askWriter() {
  const sent: GroundAskRecord[] = [];
  registerGroundAskWriter((record) => {
    sent.push(record);
    return Promise.resolve();
  });
  return sent;
}
function acceptingWriter() {
  const saved: string[] = [];
  registerGroundWriter((setting) => {
    saved.push(setting);
    return Promise.resolve();
  });
  return saved;
}
function countingWriter() {
  const calls: string[] = [];
  registerGroundWriter((setting) => {
    calls.push(setting);
    return Promise.resolve();
  });
  return calls;
}

beforeEach(() => {
  roleMock.current = 'manager';
  termsMock.getDataTerms.mockReset();
  window.localStorage.clear();
  document.documentElement.removeAttribute(GROUND_CHOICE_ATTR);
  resetGroundChoiceForTests();
  resetGroundAskForTests();
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.removeAttribute(GROUND_CHOICE_ATTR);
  resetGroundChoiceForTests();
  resetGroundAskForTests();
});

describe('when it asks', () => {
  it('asks a signed-in person whose account says they never chose — Paper pre-selected', () => {
    neverChose();
    mount();
    expect(ask()).toBeInTheDocument();
    expect(radio('Paper').checked).toBe(true);
    expect(radio('Charcoal').checked).toBe(false);
    expect(radio('System').checked).toBe(false);
    // System says what it does.
    expect(screen.getByText('Follows this device’s light or dark setting.')).toBeInTheDocument();
  });

  it('[REVERT-FAILS] never asks while the account has not answered (`unknown`)', () => {
    setGroundOwner(ALICE);
    expect(getGroundState().source).toBe('unknown');
    mount();
    expect(ask()).toBeNull();
  });

  it('[REVERT-FAILS] never asks when the account could not be read (`unreadable`)', () => {
    setGroundOwner(ALICE);
    reportGroundReadFailure('Network Error');
    expect(getGroundState().source).toBe('unreadable');
    mount();
    expect(ask()).toBeNull();
  });

  it('[REVERT-FAILS] never asks on this device\'s copy alone (`device-cache`)', () => {
    window.localStorage.setItem(groundMirrorKey(ALICE), 'paper');
    setGroundOwner(ALICE);
    expect(getGroundState().source).toBe('device-cache');
    mount();
    expect(ask()).toBeNull();
  });

  it('[REVERT-FAILS] never asks someone whose account holds a choice (`account`)', () => {
    setGroundOwner(ALICE);
    applyAccountGround('paper');
    expect(getGroundState().source).toBe('account');
    mount();
    expect(ask()).toBeNull();
  });

  it('never asks when nobody is signed in', () => {
    expect(getGroundState().source).toBe('default');
    mount();
    expect(ask()).toBeNull();
  });

  it('asks the moment the account answers "never chosen", not before', () => {
    setGroundOwner(ALICE);
    mount();
    expect(ask()).toBeNull();
    act(() => {
      applyAccountGround(undefined);
      applyAccountGroundAsk({ firstTaskAt: '2026-11-01T10:00:00.000Z' });
    });
    expect(ask()).toBeInTheDocument();
  });

  it('[REVERT-FAILS] does not ask before the first completed task, however the account answers', () => {
    setGroundOwner(ALICE);
    applyAccountGround(undefined);
    applyAccountGroundAsk(undefined);
    mount();
    expect(ask()).toBeNull();
  });

  it('[REVERT-FAILS] does not ask while the account has not said what it holds about the question', () => {
    setGroundOwner(ALICE);
    applyAccountGround(undefined);
    mount();
    expect(getGroundAskGate().known).toBe(false);
    expect(ask()).toBeNull();
  });

  it('asks the moment the first task lands', () => {
    setGroundOwner(ALICE);
    applyAccountGround(undefined);
    applyAccountGroundAsk(undefined);
    mount();
    expect(ask()).toBeNull();
    act(() => noteGroundTaskDone());
    expect(ask()).toBeInTheDocument();
  });

  it('[REVERT-FAILS] stays quiet inside a 30-day snooze and asks once it has run out', () => {
    setGroundOwner(ALICE);
    applyAccountGround(undefined);
    const future = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();
    applyAccountGroundAsk({ firstTaskAt: '2026-11-01T10:00:00.000Z', snoozedUntil: future });
    const first = mount();
    expect(ask()).toBeNull();
    first.unmount();
    cleanup();
    resetGroundAskForTests();
    applyAccountGroundAsk({
      firstTaskAt: '2026-11-01T10:00:00.000Z',
      snoozedUntil: new Date(Date.now() - 1000).toISOString(),
    });
    mount();
    expect(ask()).toBeInTheDocument();
  });
});

describe('on a dark device', () => {
  function dark(matches: boolean) {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: matches && /dark/.test(q),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }));
  }
  afterEach(() => vi.unstubAllGlobals());

  it('[REVERT-FAILS] offers System first and has it selected', () => {
    dark(true);
    neverChose();
    mount();
    const labels = screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).value);
    expect(labels).toEqual(['system', 'paper', 'charcoal']);
    expect(radio('System').checked).toBe(true);
    expect(radio('Paper').checked).toBe(false);
  });

  it('a light device keeps Paper first and selected', () => {
    dark(false);
    neverChose();
    mount();
    const labels = screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).value);
    expect(labels).toEqual(['paper', 'charcoal', 'system']);
    expect(radio('Paper').checked).toBe(true);
  });
});

describe('never on top of the data terms', () => {
  it('waits while an owner\'s terms read is in flight', () => {
    roleMock.current = 'owner';
    termsMock.getDataTerms.mockReturnValue(new Promise(() => {}));
    neverChose();
    mount();
    expect(ask()).toBeNull();
  });

  it('[REVERT-FAILS] waits while the "Hold to accept" sheet is up, and asks once it has closed', async () => {
    roleMock.current = 'owner';
    termsMock.getDataTerms.mockResolvedValue(readout({ current: false }));
    neverChose();
    mount();
    expect(await screen.findByRole('dialog', { name: TERMS })).toBeInTheDocument();
    expect(ask()).toBeNull();

    // She accepts; the gate re-reads and closes.
    termsMock.getDataTerms.mockResolvedValue(readout({ current: true, yours: { current: true } }));
    await act(async () => {
      await client.invalidateQueries();
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: TERMS })).toBeNull());
    expect(ask()).toBeInTheDocument();
  });

  it('asks an owner who has already accepted', async () => {
    roleMock.current = 'owner';
    termsMock.getDataTerms.mockResolvedValue(readout({ current: true, yours: { current: true } }));
    neverChose();
    mount();
    await waitFor(() => expect(ask()).toBeInTheDocument());
    expect(screen.queryByRole('dialog', { name: TERMS })).toBeNull();
  });

  it('asks when the terms could not be read — no terms sheet shows, so nothing is held back', async () => {
    roleMock.current = 'owner';
    termsMock.getDataTerms.mockRejectedValue(new Error('Network Error'));
    neverChose();
    mount();
    // `useDataTerms` retries once (its own `retry: 1`); the gate may still open
    // during that retry, so this waits it out rather than jumping in.
    expect(ask()).toBeNull();
    await waitFor(() => expect(ask()).toBeInTheDocument(), { timeout: 5000 });
    expect(termsMock.getDataTerms).toHaveBeenCalledTimes(2);
  });

  it('a manager never reads the terms at all, and is asked straight away', () => {
    neverChose();
    mount();
    expect(termsMock.getDataTerms).not.toHaveBeenCalled();
    expect(ask()).toBeInTheDocument();
  });
});

describe('answering it', () => {
  it('Save writes the picked setting to the account and closes', async () => {
    neverChose();
    const saved = acceptingWriter();
    mount();
    fireEvent.click(radio('Charcoal'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(ask()).toBeNull());
    expect(saved).toEqual(['charcoal']);
    expect(getGroundState()).toMatchObject({ setting: 'charcoal', source: 'account' });
    expect(window.localStorage.getItem(groundMirrorKey(ALICE))).toBe('charcoal');
  });

  it('Save with nothing touched writes Paper — so it never asks again', async () => {
    neverChose();
    const saved = acceptingWriter();
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(ask()).toBeNull());
    expect(saved).toEqual(['paper']);
    expect(getGroundState().source).toBe('account');
  });

  it('System saves "system"', async () => {
    neverChose();
    const saved = acceptingWriter();
    mount();
    fireEvent.click(radio('System'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(ask()).toBeNull());
    expect(saved).toEqual(['system']);
  });

  it('previews the pick on the sheet itself, and leaves the page behind on Paper until Save', () => {
    neverChose();
    mount();
    const dialog = ask()!;
    const root = dialog.closest('.mdv-ovl') as HTMLElement;
    expect(root).not.toHaveAttribute('data-ground');
    fireEvent.click(radio('Charcoal'));
    expect(root).toHaveAttribute('data-ground', 'charcoal');
    expect(document.documentElement.getAttribute(GROUND_CHOICE_ATTR)).toBe('paper');
  });

  it('stays open and says so when the save fails, and writes no mirror', async () => {
    neverChose();
    registerGroundWriter(() => Promise.reject(new Error('Request failed with status code 503')));
    mount();
    fireEvent.click(radio('Charcoal'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const refusal = await screen.findByRole('alert');
    expect(refusal).toHaveTextContent(/not saved to your account/i);
    expect(ask()).toBeInTheDocument();
    expect(window.localStorage.getItem(groundMirrorKey(ALICE))).toBe('paper');
  });
});

describe('closing without saving writes no theme, and is remembered for 30 days', () => {
  for (const [how, close] of [
    ['Not now', () => fireEvent.click(screen.getByRole('button', { name: 'Not now' }))],
    ['Escape', () => fireEvent.keyDown(window, { key: 'Escape' })],
    [
      'a click outside',
      () => fireEvent.click(document.querySelector('.mdv-ovl__scrim') as HTMLElement),
    ],
  ] as const) {
    it(`${how} closes it, writes no theme, snoozes the question, and the account still says "never chosen"`, () => {
      neverChose();
      const calls = countingWriter();
      const sent = askWriter();
      mount();
      fireEvent.click(radio('Charcoal'));
      const before = Date.now();
      act(() => close());
      expect(ask()).toBeNull();
      expect(calls).toEqual([]);
      expect(getGroundState()).toMatchObject({ setting: 'paper', source: 'default' });
      expect(document.documentElement.getAttribute(GROUND_CHOICE_ATTR)).toBe('paper');
      // The snooze is written WHOLE (the first-task stamp rides with it).
      expect(sent).toHaveLength(1);
      expect(sent[0].firstTaskAt).toBe('2026-11-01T10:00:00.000Z');
      const until = Date.parse(sent[0].snoozedUntil!);
      expect(until - before).toBeGreaterThanOrEqual(GROUND_ASK_SNOOZE_MS - 1000);
      expect(until - before).toBeLessThanOrEqual(GROUND_ASK_SNOOZE_MS + 5000);
    });
  }

  it('[REVERT-FAILS] does not ask again on the next load', () => {
    neverChose();
    countingWriter();
    const sent = askWriter();
    const first = mount();
    act(() => fireEvent.keyDown(window, { key: 'Escape' }));
    expect(ask()).toBeNull();
    first.unmount();

    // A fresh page load: the account answers with what it was sent.
    resetGroundChoiceForTests();
    resetGroundAskForTests();
    setGroundOwner(ALICE);
    applyAccountGround(undefined);
    applyAccountGroundAsk(sent[0]);
    mount();
    expect(ask()).toBeNull();
  });

  it('a different person signing in on this tab is asked afresh', () => {
    neverChose();
    mount();
    act(() => fireEvent.keyDown(window, { key: 'Escape' }));
    expect(ask()).toBeNull();
    act(() => {
      setGroundOwner('user-bob');
      resetGroundAskForTests();
      applyAccountGround(undefined);
      applyAccountGroundAsk({ firstTaskAt: '2026-11-02T10:00:00.000Z' });
    });
    expect(ask()).toBeInTheDocument();
  });
});
