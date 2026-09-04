/**
 * The gate's real promise: with no Mudavym page on screen, a shell overlay
 * renders EXACTLY the markup it always did.
 *
 * "Looks the same" is not a test — a class string that drifted by one utility
 * would pass it. These assertions pin the literal class strings, so the day
 * someone edits the legacy branch the test says so, out loud.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ShortcutsSheet } from '../command/ShortcutsSheet';
import { RecentlyViewed } from '../command/RecentlyViewed';
import { ThemeMenu } from '../layout/ThemeMenu';
import { ThemeProvider } from '../../contexts/ThemeContext';
import { claimMudavymShell, resetMudavymShell } from '../../lib/mudavym/shellGround';

const PANEL_POSITIONER = 'fixed inset-0 z-[100] flex items-center justify-center px-4';
const PANEL_SCRIM = 'absolute inset-0 bg-gray-900/40';
const PANEL_CARD =
  'relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden';
const RECENTS_POSITIONER = 'fixed inset-0 z-[100] flex items-start justify-center pt-[16vh] px-4';
const RECENTS_CARD =
  'relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden';
const THEME_MENU =
  'absolute right-0 mt-2 w-40 rounded-xl border border-gray-200 bg-white p-1 shadow-xl z-50 dark:border-gray-700 dark:bg-gray-800';

beforeEach(() => {
  resetMudavymShell();
});

describe('with no Mudavym page on screen', () => {
  it('ShortcutsSheet renders its legacy chrome, class string for class string', () => {
    const { container } = render(<ShortcutsSheet open onClose={() => {}} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('class')).toBe(PANEL_POSITIONER);
    expect(root.children[0].getAttribute('class')).toBe(PANEL_SCRIM);
    expect(root.children[1].getAttribute('class')).toBe(PANEL_CARD);
    expect(document.querySelector('.mdv-ovl')).toBeNull();
  });

  it('RecentlyViewed renders its legacy chrome, class string for class string', () => {
    const { container } = render(
      <MemoryRouter>
        <RecentlyViewed open onClose={() => {}} />
      </MemoryRouter>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('class')).toBe(RECENTS_POSITIONER);
    expect(root.children[1].getAttribute('class')).toBe(RECENTS_CARD);
    expect(document.querySelector('.mdv-ovl')).toBeNull();
  });

  it('ThemeMenu renders its legacy menu, class string for class string', () => {
    render(
      <ThemeProvider>
        <ThemeMenu />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }));
    expect(screen.getByRole('menu').getAttribute('class')).toBe(THEME_MENU);
    expect(document.querySelector('.mdv-ovl')).toBeNull();
  });
});

describe('with a Mudavym page on screen', () => {
  beforeEach(() => {
    claimMudavymShell(Symbol('test-page'), 'paper');
  });

  it('ShortcutsSheet becomes the house Panel', () => {
    render(<ShortcutsSheet open onClose={() => {}} />);
    const root = document.querySelector('.mdv-ovl') as HTMLElement;
    expect(root).not.toBeNull();
    expect(root).toHaveClass('mdv-ovl--panel', 'mudavym');
    expect(document.querySelector('.bg-gray-900\\/40')).toBeNull();
  });

  it('RecentlyViewed becomes the house Panel and keeps its listbox contract', () => {
    render(
      <MemoryRouter>
        <RecentlyViewed open onClose={() => {}} />
      </MemoryRouter>,
    );
    expect(document.querySelector('.mdv-ovl--panel')).not.toBeNull();
  });

  it('ThemeMenu becomes the house Popover — non-modal, still a dialog', () => {
    render(
      <ThemeProvider>
        <ThemeMenu />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }));
    expect(document.querySelector('.mdv-ovl--popover')).not.toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-modal');
  });

  it('carries the page ground onto the portalled root', () => {
    resetMudavymShell();
    claimMudavymShell(Symbol('charcoal-page'), 'charcoal');
    render(<ShortcutsSheet open onClose={() => {}} />);
    expect(document.querySelector('.mdv-ovl')).toHaveAttribute('data-ground', 'charcoal');
  });
});
