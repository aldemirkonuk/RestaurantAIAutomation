/**
 * Who is offered the Credits tab on the legacy /receipts page (ADR 0167).
 *
 * The gateway answers 403 on the credit list, stats and every transition unless the
 * caller is owner or manager IN THE HOUSE THE TOKEN NAMES (ADR 0162). The page must
 * decide from that same role, `activeRole`, and not from the global `users.role`
 * that `user.role` carries: the audit of PR #395 found the first cut read the
 * global one, which shows a person who is staff here but manager globally a tab
 * that can only end in a 403, and hides it from one who is manager here but staff
 * globally.
 *
 * What is asserted is the observable pair: whether the tab is on the screen, and
 * whether the credit endpoints are ever asked. A test that checked only the button
 * would pass a page that still fired the credit queries at a staff caller.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { createContext } from 'react';

const h = vi.hoisted(() => ({
  activeRole: null as 'owner' | 'manager' | 'staff' | null,
  userRole: null as string | null,
  creditsList: vi.fn(() => Promise.resolve([])),
  creditsStats: vi.fn(() => Promise.resolve({})),
  docsList: vi.fn(() => Promise.resolve([])),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    activeRestaurantId: 'rest-A',
    activeRole: h.activeRole,
    user: h.userRole === null ? null : { role: h.userRole },
  }),
  AuthContext: createContext<{ activeRestaurantId: string | null } | null>(null),
}));
vi.mock('../components/layout/Header', () => ({ Header: () => null }));
vi.mock('../services/api/credits', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../services/api/credits')>();
  return {
    ...mod,
    creditsApi: { ...mod.creditsApi, list: h.creditsList, stats: h.creditsStats },
  };
});
vi.mock('../services/api/documents', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../services/api/documents')>();
  return { ...mod, documentsApi: { ...mod.documentsApi, list: h.docsList } };
});

import { ReceiptsPage } from './ReceiptsPage';

function show(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <ReceiptsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const creditsTab = () => screen.queryByRole('button', { name: 'Credits' });

beforeEach(() => {
  h.activeRole = null;
  h.userRole = null;
  h.creditsList.mockClear();
  h.creditsStats.mockClear();
  h.docsList.mockClear();
});

describe('the Credits tab follows the role in this house (ADR 0167, ADR 0162)', () => {
  it.each([
    ['staff in this house', 'staff', null],
    ['staff in this house though the global role is manager', 'staff', 'manager'],
    ['no role at all', null, null],
    ['an unrecognised role', null, 'contractor'],
  ] as const)('%s: no tab, and ?tab=credits lands on Receipts without asking for credits', async (_n, active, global) => {
    h.activeRole = active as typeof h.activeRole;
    h.userRole = global;
    show('/receipts?tab=credits');
    await waitFor(() => expect(h.docsList).toHaveBeenCalled());
    expect(creditsTab()).toBeNull();
    expect(h.creditsList).not.toHaveBeenCalled();
    expect(h.creditsStats).not.toHaveBeenCalled();
  });

  it.each([
    ['owner in this house', 'owner', null],
    ['manager in this house', 'manager', null],
    ['manager in this house though the global role is staff', 'manager', 'staff'],
    ['admin, on a session that names no house', null, 'admin'],
  ] as const)('%s: the tab is offered and ?tab=credits loads the ledger', async (_n, active, global) => {
    h.activeRole = active as typeof h.activeRole;
    h.userRole = global;
    show('/receipts?tab=credits');
    await waitFor(() => expect(h.creditsList).toHaveBeenCalled());
    expect(creditsTab()).not.toBeNull();
    expect(h.creditsStats).toHaveBeenCalled();
  });

  it('a manager who has not opened the tab does not ask for credits either', async () => {
    h.activeRole = 'manager';
    show('/receipts');
    await waitFor(() => expect(h.docsList).toHaveBeenCalled());
    expect(creditsTab()).not.toBeNull();
    expect(h.creditsList).not.toHaveBeenCalled();
  });
});
