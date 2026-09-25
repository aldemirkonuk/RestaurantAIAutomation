/**
 * The shell is gated like every Mudavym page: the browser override, then the
 * house flag, then false (useMudavymDesign.ts). Off — and while the flag check
 * is in flight — the legacy layout renders; the new shell is never flashed at
 * someone who is not meant to see it.
 *
 * `HouseShell` and the legacy layout's heavy children are replaced by markers:
 * what is under test is the GATE (DashboardLayout + useMudavymDesign), and the
 * flag API is mocked at the network seam (`settingsApi.checkFeatureFlag`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
  it('is a gated slug with its own override key and house flag', () => {
    expect(MUDAVYM_PAGES).toContain('shell');
    expect(overrideKeyFor('shell')).toBe('mudavym.design.shell');
    expect(flagKeyFor('shell')).toBe('mudavym_design_shell');
  });
});

describe('layer 1 — the browser override', () => {
  it('"1" shows the house shell and no legacy chrome', () => {
    window.localStorage.setItem('mudavym.design.shell', '1');
    mount();
    expect(screen.getByTestId('house-shell')).toBeTruthy();
    expect(screen.queryByTestId('legacy-sidebar')).toBeNull();
  });

  it('"0" forces the legacy layout even when the house flag is on', async () => {
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

describe('layer 2 — the house flag', () => {
  it('on for this house: the shell renders once the flag answers', async () => {
    window.localStorage.setItem('activeRestaurantId', 'r-1');
    checkFlag.mockResolvedValue({ active: true, enabled: true });
    mount();
    // In flight: legacy, never a flash of the new shell.
    expect(screen.getByTestId('legacy-sidebar')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('house-shell')).toBeTruthy());
    expect(checkFlag).toHaveBeenCalledWith('r-1', 'mudavym_design_shell');
  });

  it('off for this house: legacy, byte for byte (WineAgentFab removed everywhere, ADR 0149 row 33)', async () => {
    window.localStorage.setItem('activeRestaurantId', 'r-1');
    mount();
    await waitFor(() => expect(checkFlag).toHaveBeenCalled());
    expect(screen.getByTestId('legacy-sidebar')).toBeTruthy();
    expect(screen.queryByTestId('house-shell')).toBeNull();
  });

  it('a flag read that fails is legacy, never a broken page', async () => {
    window.localStorage.setItem('activeRestaurantId', 'r-1');
    checkFlag.mockRejectedValue(new Error('503'));
    mount();
    await waitFor(() => expect(checkFlag).toHaveBeenCalled());
    expect(screen.getByTestId('legacy-sidebar')).toBeTruthy();
    expect(screen.queryByTestId('house-shell')).toBeNull();
  });
});

describe('layer 3 — the default', () => {
  it('no override and no house: legacy', () => {
    mount();
    expect(screen.getByTestId('legacy-sidebar')).toBeTruthy();
    expect(checkFlag).not.toHaveBeenCalled();
  });
});
