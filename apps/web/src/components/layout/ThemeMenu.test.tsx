/**
 * ADR 0169 — on a Mudavym page, this control drives the person's ground
 * choice (Paper/Charcoal), not the legacy app theme. The OFF-a-Mudavym-page
 * branch (Light/Dark/System against `ThemeContext`) is unchanged and already
 * covered by `components/mudavym/shellOverlays.test.tsx`; this file is about
 * the branch ADR 0169 rewired.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ThemeMenu } from './ThemeMenu';
import { ThemeProvider } from '../../contexts/ThemeContext';
import { claimMudavymShell, resetMudavymShell } from '../../lib/mudavym/shellGround';
import {
  GROUND_CHOICE_ATTR,
  GROUND_CHOICE_STORAGE_KEY,
  getGroundChoice,
  resetGroundChoiceForTests,
} from '../../lib/mudavym/groundChoice';

function renderOnMudavymPage() {
  claimMudavymShell(Symbol('test-page'), 'paper');
  return render(
    <ThemeProvider>
      <ThemeMenu />
    </ThemeProvider>,
  );
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
    renderOnMudavymPage();
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }));
    expect(screen.getByText('Paper')).toBeInTheDocument();
    expect(screen.getByText('Charcoal')).toBeInTheDocument();
    expect(screen.queryByText('System')).not.toBeInTheDocument();
  });

  it('defaults to Paper marked active — nothing chosen yet on this device', () => {
    renderOnMudavymPage();
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }));
    const paper = screen.getByText('Paper').closest('button');
    const charcoal = screen.getByText('Charcoal').closest('button');
    expect(paper).toHaveAttribute('data-active', 'true');
    expect(charcoal).toHaveAttribute('data-active', 'false');
  });

  it('choosing Charcoal sets the person\'s ground choice and persists it', () => {
    renderOnMudavymPage();
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }));
    fireEvent.click(screen.getByText('Charcoal'));

    expect(getGroundChoice()).toBe('charcoal');
    expect(window.localStorage.getItem(GROUND_CHOICE_STORAGE_KEY)).toBe('charcoal');
    expect(document.documentElement.getAttribute(GROUND_CHOICE_ATTR)).toBe('charcoal');
  });

  it('choosing a ground closes the popover', () => {
    renderOnMudavymPage();
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }));
    fireEvent.click(screen.getByText('Charcoal'));
    expect(screen.queryByText('Paper')).not.toBeInTheDocument();
  });

  it('the trigger reflects the current choice in its title, before and after opening it', () => {
    renderOnMudavymPage();
    expect(screen.getByRole('button', { name: 'Theme' })).toHaveAttribute(
      'title',
      'Ground: Paper',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }));
    fireEvent.click(screen.getByText('Charcoal'));
    expect(screen.getByRole('button', { name: 'Theme' })).toHaveAttribute(
      'title',
      'Ground: Charcoal',
    );
  });

  it('a choice made in an earlier mount (e.g. an earlier page) is read on a fresh mount', () => {
    // Stand in for "the person chose charcoal on Dashboard, then opened Settings":
    // persist the choice, then mount a brand new instance with no shared state
    // except localStorage.
    window.localStorage.setItem(GROUND_CHOICE_STORAGE_KEY, 'charcoal');
    resetGroundChoiceForTests();

    renderOnMudavymPage();
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }));
    const charcoal = screen.getByText('Charcoal').closest('button');
    expect(charcoal).toHaveAttribute('data-active', 'true');
  });

  it('reopening the menu after choosing Paper marks Paper active, not stuck on Charcoal', () => {
    renderOnMudavymPage();
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }));
    fireEvent.click(screen.getByText('Charcoal'));
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }));
    fireEvent.click(screen.getByText('Paper'));
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }));
    const paper = screen.getByText('Paper').closest('button');
    expect(paper).toHaveAttribute('data-active', 'true');
    expect(getGroundChoice()).toBe('paper');
  });
});
