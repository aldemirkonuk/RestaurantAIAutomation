/**
 * The in-app 404: gated the same way every shell page is (the browser
 * override, then LIVE_PAGES, then the house flag, then false —
 * `useMudavymDesign.ts`; `shell` is in LIVE_PAGES since 2026-09-25), and
 * nested under `DashboardLayout` so it never races that flag check (see
 * ShellCatchAll.tsx's doc comment for the defect this replaces).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const checkFlag = vi.hoisted(() => vi.fn());

vi.mock('../../services/api/settings', () => ({
  settingsApi: { checkFeatureFlag: (...a: unknown[]) => checkFlag(...a) },
}));

import { ShellCatchAll } from './ShellCatchAll';
import { HouseNotFound } from './HouseNotFound';
import { AuthContext } from '../../contexts/AuthContext';
import { clearMudavymDesignCache } from '../../lib/mudavym/useMudavymDesign';

function auth(role: 'owner' | 'manager' | 'staff' = 'owner') {
  return {
    user: { userId: 'u-1', email: 'a@b.c', name: 'Maya', role, restaurantId: 'r-1' },
    loading: false,
    error: null,
    clearError: vi.fn(),
    activeRestaurantId: 'r-1',
    activeRole: role,
    availableRestaurants: [],
    isAuthenticated: true,
  } as never;
}

function mountCatchAll(path: string) {
  return render(
    <AuthContext.Provider value={auth()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<div data-testid="dashboard">dashboard</div>} />
          <Route path="*" element={<ShellCatchAll />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

beforeEach(() => {
  clearMudavymDesignCache();
  window.localStorage.clear();
  checkFlag.mockReset();
  checkFlag.mockResolvedValue({ active: false, enabled: false });
});
afterEach(() => window.localStorage.clear());

// [2026-09-25: `shell` is in LIVE_PAGES (ADR 0149 row 36's bracket, founder
// Q2/Q4 of 2026-09-22), so "off" is no longer the default or a house's flag —
// only the browser's QA override reaches the legacy redirect now.]
describe("shell off (the QA override '0' -- since 2026-09-25 the only way to legacy)", () => {
  it("the legacy behaviour is unchanged: a silent redirect home", () => {
    window.localStorage.setItem('mudavym.design.shell', '0');
    mountCatchAll('/this/does/not/exist');
    expect(screen.getByTestId('dashboard')).toBeTruthy();
  });
});

describe('shell on (the default: live in code, no override, the house has no flag row)', () => {
  it('renders the in-app 404 instead of redirecting, without asking for a flag', () => {
    mountCatchAll('/this/does/not/exist');
    expect(screen.queryByTestId('dashboard')).toBeNull();
    expect(screen.getByRole('heading', { name: "That page isn't in the book." })).toBeTruthy();
    expect(screen.getByText('/this/does/not/exist')).toBeTruthy();
    expect(checkFlag).not.toHaveBeenCalled();
  });
});

describe('HouseNotFound content', () => {
  function mountNotFound(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="*"
            element={<HouseNotFound role="owner" flags={{ connections: false }} />}
          />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('names the nearest room for a path inside a known prefix', () => {
    mountNotFound('/orders/some/unknown/tail');
    expect(
      screen.getByText(
        'Orders is the nearest room this path stands in, but nothing here answers for it.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to Orders' })).toBeTruthy();
  });

  it('says nothing answers for a path that matches no room at all', () => {
    mountNotFound('/nothing-like-a-room');
    expect(screen.getByText('Nothing in the house answers for this path.')).toBeTruthy();
  });

  it('has no "Go to" link at all when nothing matches (no dangling recovery link)', () => {
    mountNotFound('/nothing-like-a-room');
    const links = screen.getAllByRole('link').map((l) => l.textContent);
    expect(links.every((t) => !t?.startsWith('Go to'))).toBe(true);
  });

  it('is not a link index: one primary, the palette field, no rooms list', () => {
    mountNotFound('/orders/some/unknown/tail');
    expect(screen.queryByRole('navigation', { name: 'Rooms of the house' })).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Go to Orders' })).toBeTruthy();
  });

  it('the primary is Back to Dashboard when no room is near', () => {
    mountNotFound('/nowhere');
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe('Back to Dashboard');
  });

  it('the palette field opens the command palette, which reads the rooms table the rail does', () => {
    mountNotFound('/nowhere');
    const seen = vi.fn();
    window.addEventListener('wineops:command-open', seen);
    fireEvent.click(screen.getByRole('button', { name: /Find a room or an action/ }));
    window.removeEventListener('wineops:command-open', seen);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('is 404 type at the floor: headline 34 px, eyebrow 11 px, field and primary 48 px', () => {
    const css = readFileSync(resolve(__dirname, 'house-shell.css'), 'utf8');
    const from = css.indexOf('the in-app 404');
    const block = css.slice(from, css.indexOf('The header\'s Ask', from));
    expect(block).toMatch(/\.mdv-404__headline\s*{[^}]*font-size:\s*34px/);
    expect(block).toMatch(/\.mdv-404__eyebrow\s*{[^}]*font-size:\s*11px/);
    expect(block).toMatch(/\.mdv-404__primary\s*{[^}]*min-height:\s*48px/);
    expect(block).toMatch(/\.mdv-404__find\s*{[^}]*min-height:\s*48px/);
    expect(block).not.toMatch(/transition:\s*all/);
    expect(block).toMatch(/prefers-reduced-motion: reduce\)\s*{[\s\S]*\.mdv-404[\s\S]*animation:\s*none/);
  });
});
