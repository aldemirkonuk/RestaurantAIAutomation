/**
 * `?order=` on `/receiving` — the `/deliveries/:id` hand-off
 * (DeliveryRedirect.tsx) — reaching the staff and owner renderings, not only
 * the manager one.
 *
 * `highlightOrderId` used to be passed only to `ManagerBody`
 * (RcManagerQueue): a staff or owner rendering silently ignored the hand-off
 * with no sign it had even arrived. Delivery notifications
 * are persisted for the WHOLE house (`delivery-clock.service.ts`
 * `persistForRestaurant`) and production is majority owner-only (6 of 10
 * restaurants, production-tenant-shape memory; re-measured live 2026-09-19),
 * so an owner is the person most likely to actually
 * follow the link.
 *
 * ADR 0149 row 44 (2026-09-18): the decision queue itself
 * now opens for the owner rendering too, not only manager — an owner is
 * often the only person in the house who can act on it. The owner rendering
 * therefore now behaves like manager for this hand-off: `RcManagerQueue`
 * mounts directly (and highlights the row itself) instead of a note pointing
 * "elsewhere". Only staff, which still has no queue at all, keeps the note.
 *
 * The underlying data hooks (`useReceivingNextData`) are mocked wholesale —
 * their own correctness is `ReceivingNext.test.tsx`'s job; this file is only
 * about whether the note (or the queue itself) reaches each rendering.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  CreditDraftsData,
  ManagerQueueData,
  OutboxData,
  RecoveryData,
  StaffLaneData,
} from './useReceivingNextData';

const role = vi.hoisted(() => ({ current: 'owner' as string }));
vi.mock('@/contexts/AuthContext', async () => {
  const React = await import('react');
  return {
    // The day line (sketch 119 E, a page element on this page) reads the
    // context itself; with none, its shell gate resolves off — the default.
    AuthContext: React.createContext(null),
    useAuth: () => ({ user: { userId: 'u1', restaurantId: 'rest-A', role: role.current } }),
  };
});

const staffData: StaffLaneData = {
  deliveries: [],
  totalOutForDelivery: null,
  listTruncated: false,
  hasData: false,
  isLoading: true,
  isError: false,
  isFetching: false,
  failure: null,
  refetch: vi.fn(),
};

const managerData: ManagerQueueData = {
  items: [],
  laneCounts: { accepted: null, short: null, refused: null },
  totalAtRisk: null,
  itemsAtFloor: false,
  unverified: null,
  unverifiedAtFloor: false,
  hasData: false,
  isLoading: true,
  isError: false,
  errorMessage: null,
  failure: null,
  refetch: vi.fn(),
};

const creditDraftsData: CreditDraftsData = {
  drafts: [],
  hasData: false,
  isLoading: true,
  isError: false,
  failure: null,
  refetch: vi.fn(),
};

const ownerData: RecoveryData = {
  stats: null,
  creditedThisMonth: null,
  creditedLastMonth: null,
  trendIsError: false,
  trendFailure: null,
  statsAtFloor: false,
  trendAtFloor: false,
  hasData: false,
  isLoading: true,
  isError: false,
  failure: null,
  refetch: vi.fn(),
};

const outboxData: OutboxData = {
  queued: [],
  drops: [],
  lastFlush: null,
  online: true,
  dismissDrop: vi.fn(),
  flushNow: vi.fn(),
};

vi.mock('./useReceivingNextData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useReceivingNextData')>();
  return {
    ...actual,
    useStaffDeliveries: () => staffData,
    useManagerQueue: () => managerData,
    useCreditDrafts: () => creditDraftsData,
    useOwnerRecovery: () => ownerData,
    useDoorOutbox: () => outboxData,
  };
});

import ReceivingNext from './ReceivingNext';

function harness(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <ReceivingNext />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('staff rendering', () => {
  it('names the delivery hand-off instead of saying nothing about it', () => {
    role.current = 'staff';
    harness('/receiving?order=ord-9');
    const note = screen.getByTestId('highlight-elsewhere-note');
    expect(note).toHaveTextContent('ord-9');
    expect(note).toHaveTextContent('decision queue');
    // ADR 0149 row 44: the queue now opens for owner too, so staff (the one
    // rendering still without it) is told both roles can act on it.
    expect(note).toHaveTextContent('manager or owner');
  });

  it('renders nothing extra when no order is named', () => {
    role.current = 'staff';
    harness('/receiving');
    expect(screen.queryByTestId('highlight-elsewhere-note')).not.toBeInTheDocument();
  });
});

describe('owner rendering', () => {
  it('mounts the decision queue directly instead of a note pointing elsewhere', () => {
    role.current = 'owner';
    harness('/receiving?order=ord-9');
    // The queue now opens for owner (ADR 0149 row 44): no "elsewhere" note,
    // and the queue section (RcManagerQueue) is on the page alongside the
    // owner's own ledger.
    expect(screen.queryByTestId('highlight-elsewhere-note')).not.toBeInTheDocument();
    expect(screen.getByText('Needing a decision')).toBeInTheDocument();
  });

  it('names the missing order when the loaded queue does not have it (wave-5 links R3)', () => {
    // Regression for a real test gap (mutation M-b2): giving
    // the owner's mounted `RcManagerQueue` a loaded queue without the
    // highlighted order, via `highlightOrderId={null}`, still passed all 97
    // receiving tests. Nothing asserted that OwnerBody actually threads
    // `?order=` into its own queue rather than dropping it on the floor.
    role.current = 'owner';
    const original = { ...managerData };
    Object.assign(managerData, {
      hasData: true,
      isLoading: false,
      isError: false,
      items: [
        {
          orderId: 'ord-2',
          orderNumber: 'PO-2',
          verdict: 'qty_short',
          summary: 'Two bottles short',
          backorderQty: 0,
          verifiedAt: '2026-08-30T09:00:00.000Z',
          dollarsAtRisk: 120,
          selfEvidenced: false,
          openClaims: 1,
          lane: 'short',
          laneLabel: 'Short',
          chip: 'Short shipment',
          atRisk: 120,
          openClaimsFloor: 1,
        },
      ],
    });
    try {
      // ord-9 is highlighted but the loaded queue only holds ord-2.
      harness('/receiving?order=ord-9');
      expect(screen.getByTestId('highlight-order-missing')).toHaveTextContent('ord-9');
    } finally {
      Object.assign(managerData, original);
    }
  });
});

describe('manager rendering', () => {
  it('does not duplicate the note — RcManagerQueue already highlights the row itself', () => {
    role.current = 'manager';
    harness('/receiving?order=ord-9');
    expect(screen.queryByTestId('highlight-elsewhere-note')).not.toBeInTheDocument();
  });
});
