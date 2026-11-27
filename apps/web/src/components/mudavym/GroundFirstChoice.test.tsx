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
import { Sheet } from './Sheet';
import { DEEP_LINK_GIVES_UP_MS, resetDeepLinkAtLoad } from './useOwnTurn';
import { DataTermsSignInGate } from '../settings/DataTermsSignInGate';
import { useDataTermsSignInBusy } from '../../hooks/queries/useDataTerms';
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
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.removeAttribute(GROUND_CHOICE_ATTR);
  resetGroundChoiceForTests();
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
    act(() => applyAccountGround(undefined));
    expect(ask()).toBeInTheDocument();
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

  it('waits while a good\'s drawer is open, and asks once it closes (r109 inventory-5)', () => {
    setGroundOwner(ALICE);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const page = (drawer: boolean) => (
      <QueryClientProvider client={client}>
        <MemoryRouter>
          {drawer ? (
            <Sheet open onClose={() => {}} title="Gin" label="This shows one good. Nothing here writes.">
              <p>the drawer</p>
            </Sheet>
          ) : null}
          <DataTermsSignInGate />
          <GroundFirstChoice />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const { rerender } = render(page(true));
    act(() => applyAccountGround(undefined));
    expect(screen.getByText('the drawer')).toBeInTheDocument();
    expect(ask()).toBeNull();
    rerender(page(false));
    expect(ask()).toBeInTheDocument();
  });

  it('one queue for an owner who owes the terms: terms alone, then the drawer she opened, then theme', async () => {
    roleMock.current = 'owner';
    termsMock.getDataTerms.mockResolvedValue(readout({ current: false }));
    neverChose();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // The drawer is held while the terms are owed: the rule InventoryNext
    // applies (`!useDataTermsSignInBusy()`), with the real hook and a real Sheet.
    const Drawer = ({ shown }: { shown: boolean }) => {
      const termsBusy = useDataTermsSignInBusy();
      return shown && !termsBusy ? (
        <Sheet open onClose={() => {}} title="Gin" label="This shows one good. Nothing here writes.">
          <p>the drawer</p>
        </Sheet>
      ) : null;
    };
    const page = (shown: boolean) => (
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Drawer shown={shown} />
          <DataTermsSignInGate />
          <GroundFirstChoice />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const { rerender } = render(page(true));
    // 1. Terms first, over no drawer and no theme sheet: one overlay.
    expect(await screen.findByRole('dialog', { name: TERMS })).toBeInTheDocument();
    expect(screen.queryByText('the drawer')).toBeNull();
    expect(ask()).toBeNull();
    // 2. Accepted: the drawer she opened comes next; theme still waits.
    termsMock.getDataTerms.mockResolvedValue(readout({ current: true, yours: { current: true } }));
    await act(async () => {
      await client.invalidateQueries();
    });
    await waitFor(() => expect(screen.getByText('the drawer')).toBeInTheDocument());
    expect(screen.queryByRole('dialog', { name: TERMS })).toBeNull();
    expect(ask()).toBeNull();
    // 3. The drawer closes: theme asks last.
    rerender(page(false));
    await waitFor(() => expect(ask()).toBeInTheDocument());
  });
});

describe('a deep link whose drawer has not mounted yet (r109 inventory-5)', () => {
  const link = (search: string) => {
    window.history.replaceState(null, '', `/inventory${search}`);
    resetDeepLinkAtLoad();
  };
  afterEach(() => {
    vi.useRealTimers();
    link('');
  });
  const page = (drawer: boolean) => {
    const c = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return (
      <QueryClientProvider client={c}>
        <MemoryRouter>
          {drawer ? (
            <Sheet open onClose={() => {}} title="Gin" label="This shows one good. Nothing here writes.">
              <p>the drawer</p>
            </Sheet>
          ) : null}
          <DataTermsSignInGate />
          <GroundFirstChoice />
        </MemoryRouter>
      </QueryClientProvider>
    );
  };

  it('the choice waits for the drawer a ?open= on first paint is bringing, and is asked once it closes', () => {
    link('?open=item-1');
    setGroundOwner(ALICE);
    const { rerender } = render(page(false));
    act(() => applyAccountGround(undefined));
    // The account answered first and no drawer is up yet: it is not asked on top of one that is coming.
    expect(ask()).toBeNull();
    rerender(page(true));
    expect(screen.getByText('the drawer')).toBeInTheDocument();
    expect(ask()).toBeNull();
    window.history.replaceState(null, '', '/inventory');
    rerender(page(false));
    expect(ask()).toBeInTheDocument();
  });

  it('gives up waiting when the link opens nothing, so a sheet that is owed still shows', () => {
    vi.useFakeTimers();
    link('?open=item-1');
    setGroundOwner(ALICE);
    render(page(false));
    act(() => applyAccountGround(undefined));
    expect(ask()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(DEEP_LINK_GIVES_UP_MS + 1);
    });
    expect(ask()).toBeInTheDocument();
  });

  it('a page loaded without ?open= is asked at once, as before', () => {
    link('');
    setGroundOwner(ALICE);
    render(page(false));
    act(() => applyAccountGround(undefined));
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

describe('closing without saving writes nothing (ruled 2026-10-01: ask again next load)', () => {
  for (const [how, close] of [
    ['Not now', () => fireEvent.click(screen.getByRole('button', { name: 'Not now' }))],
    ['Escape', () => fireEvent.keyDown(window, { key: 'Escape' })],
    [
      'a click outside',
      () => fireEvent.click(document.querySelector('.mdv-ovl__scrim') as HTMLElement),
    ],
  ] as const) {
    it(`${how} closes it, writes nothing, and the account still says "never chosen"`, () => {
      neverChose();
      const calls = countingWriter();
      mount();
      fireEvent.click(radio('Charcoal'));
      act(() => close());
      expect(ask()).toBeNull();
      expect(calls).toEqual([]);
      expect(getGroundState()).toMatchObject({ setting: 'paper', source: 'default' });
      expect(document.documentElement.getAttribute(GROUND_CHOICE_ATTR)).toBe('paper');
    });
  }

  it('asks again on the next load', () => {
    neverChose();
    countingWriter();
    const first = mount();
    act(() => fireEvent.keyDown(window, { key: 'Escape' }));
    expect(ask()).toBeNull();
    first.unmount();

    // A fresh page load: the account answers "never chosen" again.
    resetGroundChoiceForTests();
    neverChose();
    mount();
    expect(ask()).toBeInTheDocument();
  });

  it('a different person signing in on this tab is asked afresh', () => {
    neverChose();
    mount();
    act(() => fireEvent.keyDown(window, { key: 'Escape' }));
    expect(ask()).toBeNull();
    act(() => {
      setGroundOwner('user-bob');
      applyAccountGround(undefined);
    });
    expect(ask()).toBeInTheDocument();
  });
});
