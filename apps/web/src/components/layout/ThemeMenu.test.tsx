/**
 * ADR 0169 — on a Mudavym page, this control drives the person's ground
 * choice (Paper/Charcoal), not the legacy app theme. The OFF-a-Mudavym-page
 * branch (Light/Dark/System against `ThemeContext`) is unchanged and already
 * covered by `components/mudavym/shellOverlays.test.tsx`; this file is about
 * the branch ADR 0169 rewired.
 *
 * The founder's 2026-09-21 answer — "Always paper, follows account" — adds a
 * second job to this menu. The choice now lives on the account, which a page
 * cannot read before it paints, so "Paper on screen" can mean four different
 * things. The menu must not put a checkmark next to Paper unless somebody
 * actually said Paper: a pending or failed read is not an answer (CLAUDE.md
 * §9). That is what the second and third describe blocks below are for.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { ThemeMenu } from './ThemeMenu';
import { ThemeProvider } from '../../contexts/ThemeContext';
import { claimMudavymShell, resetMudavymShell } from '../../lib/mudavym/shellGround';
import {
  GROUND_CHOICE_ATTR,
  applyAccountGround,
  getGroundChoice,
  groundMirrorKey,
  registerGroundWriter,
  reportGroundReadFailure,
  resetGroundChoiceForTests,
  setGroundOwner,
} from '../../lib/mudavym/groundChoice';

const ALICE = 'user-alice';

function renderOnMudavymPage() {
  claimMudavymShell(Symbol('test-page'), 'paper');
  return render(
    <ThemeProvider>
      <ThemeMenu />
    </ThemeProvider>,
  );
}

/** Alice is signed in and her account has answered: she has never chosen. */
function signedInAndAnswered() {
  setGroundOwner(ALICE);
  applyAccountGround(undefined);
}

function acceptingWriter() {
  const saved: string[] = [];
  registerGroundWriter((choice) => {
    saved.push(choice);
    return Promise.resolve();
  });
  return saved;
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Theme' }));
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute(GROUND_CHOICE_ATTR);
  resetGroundChoiceForTests();
});

afterEach(() => {
  cleanup();
  resetMudavymShell();
  window.localStorage.clear();
  document.documentElement.removeAttribute(GROUND_CHOICE_ATTR);
  resetGroundChoiceForTests();
});

describe('ThemeMenu on a Mudavym page — ADR 0169', () => {
  it('opens on "Paper" and "Charcoal", not the legacy Light/Dark/System', () => {
    signedInAndAnswered();
    renderOnMudavymPage();
    openMenu();
    expect(screen.getByText('Paper')).toBeInTheDocument();
    expect(screen.getByText('Charcoal')).toBeInTheDocument();
    // No third "match my device" option — the founder's answer has two.
    expect(screen.queryByText('System')).not.toBeInTheDocument();
  });

  it('marks Paper active for a person whose account says they never chose', () => {
    signedInAndAnswered();
    renderOnMudavymPage();
    openMenu();
    expect(screen.getByText('Paper').closest('button')).toHaveAttribute('data-active', 'true');
    expect(screen.getByText('Charcoal').closest('button')).toHaveAttribute(
      'data-active',
      'false',
    );
    expect(document.querySelector('[data-ground-note]')).toBeNull();
  });

  it('choosing Charcoal applies it and saves it to the account', async () => {
    signedInAndAnswered();
    const saved = acceptingWriter();
    renderOnMudavymPage();
    openMenu();
    fireEvent.click(screen.getByText('Charcoal'));
    await settle();

    expect(getGroundChoice()).toBe('charcoal');
    expect(document.documentElement.getAttribute(GROUND_CHOICE_ATTR)).toBe('charcoal');
    expect(saved).toEqual(['charcoal']);
    // The device keeps a mirror of what the ACCOUNT accepted, under her id —
    // never a device-wide key the next person to sign in would inherit.
    expect(window.localStorage.getItem(groundMirrorKey(ALICE))).toBe('charcoal');
    expect(window.localStorage.getItem('mudavym.ground')).toBeNull();
  });

  it('choosing a ground closes the popover', async () => {
    signedInAndAnswered();
    acceptingWriter();
    renderOnMudavymPage();
    openMenu();
    fireEvent.click(screen.getByText('Charcoal'));
    expect(screen.queryByText('Paper')).not.toBeInTheDocument();
    await settle();
  });

  it('the trigger reflects the current choice in its title, before and after opening it', async () => {
    signedInAndAnswered();
    acceptingWriter();
    renderOnMudavymPage();
    expect(screen.getByRole('button', { name: 'Theme' })).toHaveAttribute(
      'title',
      'Ground: Paper',
    );
    openMenu();
    fireEvent.click(screen.getByText('Charcoal'));
    await settle();
    expect(screen.getByRole('button', { name: 'Theme' })).toHaveAttribute(
      'title',
      'Ground: Charcoal',
    );
  });

  it('a ground the account already holds is marked active on a fresh mount', () => {
    setGroundOwner(ALICE);
    applyAccountGround('charcoal');
    renderOnMudavymPage();
    openMenu();
    expect(screen.getByText('Charcoal').closest('button')).toHaveAttribute('data-active', 'true');
  });

  it('reopening the menu after choosing Paper marks Paper active, not stuck on Charcoal', async () => {
    signedInAndAnswered();
    acceptingWriter();
    renderOnMudavymPage();
    openMenu();
    fireEvent.click(screen.getByText('Charcoal'));
    await settle();
    openMenu();
    fireEvent.click(screen.getByText('Paper'));
    await settle();
    openMenu();
    expect(screen.getByText('Paper').closest('button')).toHaveAttribute('data-active', 'true');
    expect(getGroundChoice()).toBe('paper');
  });
});

describe('ThemeMenu never calls a pending or failed read an answer — ADR 0169', () => {
  it('marks NOTHING active while the account has not answered yet', () => {
    setGroundOwner(ALICE); // signed in; no account answer, no mirror
    renderOnMudavymPage();
    openMenu();
    expect(screen.getByText('Paper').closest('button')).toHaveAttribute('data-active', 'false');
    expect(screen.getByText('Charcoal').closest('button')).toHaveAttribute(
      'data-active',
      'false',
    );
    expect(screen.getByText(/Reading the ground you saved/i)).toBeInTheDocument();
  });

  it('says so, and marks nothing active, when the account could not be read', () => {
    setGroundOwner(ALICE);
    reportGroundReadFailure('Network Error');
    renderOnMudavymPage();
    openMenu();
    expect(screen.getByText('Paper').closest('button')).toHaveAttribute('data-active', 'false');
    expect(screen.getByText(/could not be read/i)).toBeInTheDocument();
    expect(screen.getByText(/Network Error/)).toBeInTheDocument();
  });

  it('the trigger title does not claim a ground it has not read', () => {
    setGroundOwner(ALICE);
    renderOnMudavymPage();
    expect(screen.getByRole('button', { name: 'Theme' })).toHaveAttribute(
      'title',
      'Ground: not read yet',
    );
  });

  it('shows this device\'s copy, labelled as such, when the account is unreachable', () => {
    window.localStorage.setItem(groundMirrorKey(ALICE), 'charcoal');
    setGroundOwner(ALICE);
    reportGroundReadFailure('Network Error');
    renderOnMudavymPage();
    openMenu();
    // It IS charcoal on screen and charcoal is what she last chose, so it is
    // marked — but the menu says the account was not reached.
    expect(screen.getByText('Charcoal').closest('button')).toHaveAttribute('data-active', 'true');
    expect(screen.getByText(/could not be reached/i)).toBeInTheDocument();
  });

  it('says nothing at all once the account has answered', () => {
    setGroundOwner(ALICE);
    applyAccountGround('charcoal');
    renderOnMudavymPage();
    openMenu();
    expect(document.querySelector('[data-ground-note]')).toBeNull();
  });
});

describe('ThemeMenu never calls a failed save a save — ADR 0169', () => {
  it('keeps the chosen ground on screen and says it was not saved', async () => {
    signedInAndAnswered();
    registerGroundWriter(() => Promise.reject(new Error('Request failed with status code 503')));
    renderOnMudavymPage();
    openMenu();
    fireEvent.click(screen.getByText('Charcoal'));
    await settle();

    expect(getGroundChoice()).toBe('charcoal');
    openMenu();
    expect(screen.getByText(/not saved to your account/i)).toBeInTheDocument();
    expect(screen.getByText(/503/)).toBeInTheDocument();
    // The mirror still holds the account's confirmed paper — the charcoal
    // that failed to save was never written to it, so the next load shows
    // paper again rather than resurrecting a choice the account refused.
    expect(window.localStorage.getItem(groundMirrorKey(ALICE))).toBe('paper');
  });

  it('with nobody signed in, it says there is no account to remember it', async () => {
    renderOnMudavymPage();
    openMenu();
    fireEvent.click(screen.getByText('Charcoal'));
    openMenu();
    expect(screen.getByText(/no one is signed in/i)).toBeInTheDocument();
    await settle();
  });
});
