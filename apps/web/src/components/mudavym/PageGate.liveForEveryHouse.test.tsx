/**
 * The 2026-09-25 promotions reach a house with NO restaurant_feature_flags row.
 *
 * ADR 0149 row 36's 2026-09-25 bracket (founder Q2/Q4 of 2026-09-22): `admin`
 * and `authorize_integration` join `LIVE_PAGES` (with `shell`, whose reader is
 * covered by DashboardLayout.shellGate.test.tsx). A 2026-09-25 production read
 * found `admin` ON for all 14 existing houses, but the column defaults to
 * false, so a house created later still got the legacy admin page. This file
 * drives the REAL gate (`PageGate` + `useMudavymDesign`, the flag API mocked
 * at the network seam) for each route App.tsx mounts on these keys, as a new
 * house with no row, and pins App.tsx to those same route elements so the
 * behaviour tested here is the behaviour routed there.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';

const checkFlag = vi.hoisted(() => vi.fn());

vi.mock('../../services/api/settings', () => ({
  settingsApi: { checkFeatureFlag: (...a: unknown[]) => checkFlag(...a) },
}));
// What is under test is the gate's choice of tree, not the header it adds.
vi.mock('./HouseHeader', () => ({ HouseHeader: () => null }));

import { PageGate } from './PageGate';
import { AuthContext } from '../../contexts/AuthContext';
import { LIVE_PAGES, clearMudavymDesignCache } from '../../lib/mudavym/useMudavymDesign';
import { useAuthorizeDesignOn } from '../../pages/authorize-integration/AuthorizeShell';

const NEW_HOUSE = 'r-created-after-the-production-read';

const newHouseAuth = {
  user: { userId: 'u-1', email: 'a@b.c', name: 'Maya', role: 'owner', restaurantId: NEW_HOUSE },
  activeRestaurantId: NEW_HOUSE,
  availableRestaurants: [],
} as never;

function mountAt(path: string) {
  return render(
    <AuthContext.Provider value={newHouseAuth}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          {/* The same three route elements App.tsx mounts (pinned below). */}
          <Route
            path="/admin"
            element={<PageGate page="admin" legacy={<p>legacy admin panel</p>} next={<main data-testid="admin-desk" />} />}
          />
          <Route
            path="/admin/health"
            element={<PageGate page="admin" legacy={<p>legacy admin health</p>} next={<Navigate to="/admin" replace />} />}
          />
          <Route
            path="/authorize/:integrationId"
            element={
              <PageGate
                page="authorize_integration"
                legacy={<p>legacy consent page</p>}
                next={<main data-testid="authorize-next" />}
              />
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

beforeEach(() => {
  clearMudavymDesignCache();
  window.localStorage.clear();
  checkFlag.mockReset();
  // The gateway's answer for a house with no settings row.
  checkFlag.mockResolvedValue({ active: false, enabled: false });
});
afterEach(() => window.localStorage.clear());

describe('a house with no flag row gets the Mudavym version, first render, no request', () => {
  it('both keys are live in code', () => {
    expect(LIVE_PAGES.has('admin')).toBe(true);
    expect(LIVE_PAGES.has('authorize_integration')).toBe(true);
  });

  it('/admin renders the admin desk, not the legacy panel', () => {
    mountAt('/admin');
    expect(screen.getByTestId('admin-desk')).toBeTruthy();
    expect(screen.queryByText('legacy admin panel')).toBeNull();
    expect(checkFlag).not.toHaveBeenCalled();
  });

  it('/admin/health (the old bookmark) lands on the admin desk', () => {
    mountAt('/admin/health');
    expect(screen.getByTestId('admin-desk')).toBeTruthy();
    expect(screen.queryByText('legacy admin health')).toBeNull();
    expect(checkFlag).not.toHaveBeenCalled();
  });

  it('/authorize/:integrationId renders the Mudavym consent page', () => {
    mountAt('/authorize/gmail_send');
    expect(screen.getByTestId('authorize-next')).toBeTruthy();
    expect(screen.queryByText('legacy consent page')).toBeNull();
    expect(checkFlag).not.toHaveBeenCalled();
  });

  it("AuthorizeShell's own frame (useAuthorizeDesignOn) is on for that house too", () => {
    function Probe() {
      return <span data-testid="probe">{String(useAuthorizeDesignOn())}</span>;
    }
    render(
      <AuthContext.Provider value={newHouseAuth}>
        <Probe />
      </AuthContext.Provider>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('true');
    expect(checkFlag).not.toHaveBeenCalled();
  });

  it("the QA override '0' is the only way back to legacy", () => {
    window.localStorage.setItem('mudavym.design.admin', '0');
    window.localStorage.setItem('mudavym.design.authorize_integration', '0');
    mountAt('/admin');
    expect(screen.getByText('legacy admin panel')).toBeTruthy();
  });
});

describe('App.tsx routes these paths through the same gates', () => {
  const app = readFileSync(join(__dirname, '..', '..', 'App.tsx'), 'utf8');

  it('/admin: PageGate page="admin", next is the admin desk', () => {
    expect(app).toMatch(/<Route path="\/admin" element=\{<PageGate page="admin" legacy=\{[^\n]*\} next=\{<AdminDesk \/>\} \/>\} \/>/);
  });

  it('/admin/health: PageGate page="admin", next redirects to /admin', () => {
    expect(app).toMatch(
      /<Route path="\/admin\/health" element=\{<PageGate page="admin" legacy=\{[^\n]*\} next=\{<Navigate to="\/admin" replace \/>\} \/>\} \/>/,
    );
  });

  it('/authorize/:integrationId: PageGate page="authorize_integration", next is the Mudavym consent page', () => {
    expect(app).toMatch(/path="\/authorize\/:integrationId"/);
    expect(app).toMatch(
      /<PageGate page="authorize_integration" legacy=\{<AuthorizeIntegration \/>\} next=\{<AuthorizeIntegrationNext \/>\} \/>/,
    );
  });
});
