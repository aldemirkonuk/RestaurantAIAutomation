/**
 * The shell is gated like every Mudavym page: the browser override, then
 * LIVE_PAGES, then the house flag, then false (useMudavymDesign.ts).
 *
 * [2026-09-25, ADR 0149 row 36's bracket, founder Q2/Q4 of 2026-09-22:
 * `shell` is in LIVE_PAGES. It resolves ON for every house in code — on the
 * first render, with no flag request, whether the house has a
 * restaurant_feature_flags row or not. Until now this file proved the
 * opposite ("off for this house: legacy"); a house created after the
 * 2026-09-25 production read (every existing house had the column ON) got the
 * legacy layout because the column defaults to false. The legacy layout is
 * still mounted, untouched, and reachable only through the browser's QA
 * override `mudavym.design.shell = 0` — never from a house's data.]
 *
 * `HouseShell` and the legacy layout's heavy children are replaced by markers:
 * what is under test is the GATE (DashboardLayout + useMudavymDesign), and the
 * flag API is mocked at the network seam (`settingsApi.checkFeatureFlag`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const checkFlag = vi.hoisted(() => vi.fn());
const authValue = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('../../contexts/AuthContext', async () => {
  const React = await import('react');
  const AuthContext = React.createContext<unknown>(null);
  return {
    AuthContext,
    useAuth: () => authValue.current,
    AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});
vi.mock('../../services/api/settings', () => ({
  settingsApi: { checkFeatureFlag: (...a: unknown[]) => checkFlag(...a) },
}));
vi.mock('../mudavym/HouseShell', () => ({
  HouseShell: () => <div data-testid="house-shell" />,
}));
vi.mock('./Sidebar', () => ({ Sidebar: () => <nav data-testid="legacy-sidebar" /> }));
// The data-terms gate (ADR 0207 q19) mounts beside both shells; it has its
// own suites, and this one is about which shell renders.
vi.mock('../settings/DataTermsSignInGate', () => ({ DataTermsSignInGate: () => null }));
vi.mock('../command/CommandProvider', () => ({
  CommandProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../askai/AskAiSurface', () => ({ AskAiSurface: () => null }));
vi.mock('../../guidance/GuidanceProvider', () => ({
  GuidanceProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../guidance/components/PageTipStrip', () => ({ PageTipStrip: () => null }));
vi.mock('../../guidance/components/SetupNudgeBanner', () => ({ SetupNudgeBanner: () => null }));
vi.mock('../../guidance/announce', () => ({ GuidanceLiveRegion: () => null }));

import { DashboardLayout } from './DashboardLayout';
import {
  LIVE_PAGES,
  MUDAVYM_PAGES,
  clearMudavymDesignCache,
  flagKeyFor,
  overrideKeyFor,
} from '../../lib/mudavym/useMudavymDesign';

function mount() {
  return render(
    <MemoryRouter>
      <DashboardLayout>{null}</DashboardLayout>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  clearMudavymDesignCache();
  window.localStorage.clear();
  checkFlag.mockReset();
  checkFlag.mockResolvedValue({ active: false, enabled: false });
  authValue.current = null;
});
afterEach(() => window.localStorage.clear());

describe('the shell is enrolled in the design gate', () => {
  it('is a gated slug with its own override key and house flag, live in code', () => {
    expect(MUDAVYM_PAGES).toContain('shell');
    expect(LIVE_PAGES.has('shell')).toBe(true);
    expect(overrideKeyFor('shell')).toBe('mudavym.design.shell');
    expect(flagKeyFor('shell')).toBe('mudavym_design_shell');
  });
});

describe('layer 1 — the browser override (QA only)', () => {
  it('"1" shows the house shell and no legacy chrome', () => {
    window.localStorage.setItem('mudavym.design.shell', '1');
    mount();
    expect(screen.getByTestId('house-shell')).toBeTruthy();
    expect(screen.queryByTestId('legacy-sidebar')).toBeNull();
  });

  it('"0" forces the legacy layout even though the shell is live in code', async () => {
    window.localStorage.setItem('mudavym.design.shell', '0');
    window.localStorage.setItem('activeRestaurantId', 'r-1');
    checkFlag.mockResolvedValue({ active: true, enabled: true });
    mount();
    expect(screen.getByTestId('legacy-sidebar')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByTestId('house-shell')).toBeNull();
    // An override does not spend the request.
    expect(checkFlag).not.toHaveBeenCalled();
  });
});

describe('layer 2 — LIVE_PAGES: every house, whatever its row says', () => {
  it('a house with NO flag row gets the shell on the first render, and no request is spent', async () => {
    window.localStorage.setItem('activeRestaurantId', 'r-new-house');
    // What the gateway answers for a house with no settings row.
    checkFlag.mockResolvedValue({ active: false, enabled: false });
    mount();
    expect(screen.getByTestId('house-shell')).toBeTruthy();
    expect(screen.queryByTestId('legacy-sidebar')).toBeNull();
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByTestId('house-shell')).toBeTruthy();
    expect(checkFlag).not.toHaveBeenCalled();
  });

  it('a house whose column is an explicit false still gets the shell', async () => {
    window.localStorage.setItem('activeRestaurantId', 'r-1');
    checkFlag.mockResolvedValue({ active: true, enabled: false });
    mount();
    expect(screen.getByTestId('house-shell')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByTestId('legacy-sidebar')).toBeNull();
    expect(checkFlag).not.toHaveBeenCalled();
  });

  it('a flag API that is down cannot take the shell away', async () => {
    window.localStorage.setItem('activeRestaurantId', 'r-1');
    checkFlag.mockRejectedValue(new Error('503'));
    mount();
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByTestId('house-shell')).toBeTruthy();
    expect(screen.queryByTestId('legacy-sidebar')).toBeNull();
    expect(checkFlag).not.toHaveBeenCalled();
  });
});

describe('layer 3 — no house known', () => {
  it('no override and no house: still the shell (live in code needs no house)', () => {
    mount();
    expect(screen.getByTestId('house-shell')).toBeTruthy();
    expect(screen.queryByTestId('legacy-sidebar')).toBeNull();
    expect(checkFlag).not.toHaveBeenCalled();
  });
});
