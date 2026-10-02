/**
 * COMMS-W31 — the house's drafted letters are an owner's or manager's to open
 * (`GET communications/letters/drafts` is owner/manager in the gateway). A
 * staff member's page does not ask, so nothing waits on them here; a refusal
 * that still comes back is the same fact, never a failure. Any other failure
 * stays a failure, in the server's words.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const h = vi.hoisted(() => ({ get: vi.fn(), auth: {} as Record<string, unknown> }));
vi.mock('../../../../services/api/client', () => ({
  apiClient: { get: (...a: unknown[]) => h.get(...a) },
}));
vi.mock('../../../../contexts/AuthContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../contexts/AuthContext')>()),
  useAuth: () => h.auth,
}));

import { HouseDrafts, useHouseDrafts } from './HouseDrafts';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const DRAFT = {
  id: 'D1',
  providerId: 'p1',
  providerName: 'Cave Ruiz',
  orderId: null,
  subject: 'Credit request',
  to: 'marta@caveruiz.example',
  category: 'credit_claim',
  creditId: 'c1',
  body: 'Hello Marta',
  createdAt: '2026-09-25T09:00:00Z',
};

beforeEach(() => {
  h.get.mockReset();
});

describe('useHouseDrafts (COMMS-W31)', () => {
  it('a staff member is not asked: nothing waits on them and nothing failed', async () => {
    h.auth = { activeRestaurantId: 'r1', activeRole: 'staff', user: { role: 'owner', restaurantId: 'r1' } };
    const { result } = renderHook(() => useHouseDrafts(), { wrapper: wrapper() });
    expect(result.current).toMatchObject({ drafts: [], withheld: true, failed: false, error: null });
    await new Promise((r) => setTimeout(r, 20));
    expect(h.get).not.toHaveBeenCalled();
  });

  it('an owner reads them', async () => {
    h.auth = { activeRestaurantId: 'r1', activeRole: 'owner', user: { role: 'staff', restaurantId: 'r1' } };
    h.get.mockResolvedValue({ data: { drafts: [DRAFT] } });
    const { result } = renderHook(() => useHouseDrafts(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.drafts).toEqual([DRAFT]));
    expect(h.get).toHaveBeenCalledWith('/communications/letters/drafts');
    expect(result.current.withheld).toBe(false);
  });

  it('a refusal that still comes back is the same fact, not a failure', async () => {
    h.auth = { activeRestaurantId: 'r1', activeRole: 'manager', user: null };
    h.get.mockRejectedValue({ response: { status: 403, data: { message: 'Forbidden resource' } } });
    const { result } = renderHook(() => useHouseDrafts(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.withheld).toBe(true));
    expect(result.current).toMatchObject({ drafts: [], failed: false, error: null });
  });

  it('any other failure stays a failure, in the server’s words', async () => {
    h.auth = { activeRestaurantId: 'r1', activeRole: 'owner', user: null };
    h.get.mockRejectedValue({ response: { status: 500, data: { message: 'The drafts could not be read' } } });
    const { result } = renderHook(() => useHouseDrafts(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current).toMatchObject({ drafts: null, withheld: false, error: 'The drafts could not be read' });
  });
});

// COMMS-W33 (founder: "A: keep, say when").
describe('the drafted letters when a read fails', () => {
  const AT = new Date();
  AT.setHours(20, 43, 0, 0);
  const D = {
    id: 'D1', providerId: 'p1', providerName: 'Cave Ruiz', orderId: null, subject: 'Credit note for PO-009',
    to: 'marta@caveruiz.example', category: null, creditId: null, body: 'Hello', createdAt: null,
  };

  it('a read that fails after answering keeps its letters and says when they are from', () => {
    render(<HouseDrafts drafts={[D]} failed error="boom" at={AT.getTime()} onOpen={() => {}} />);
    expect(screen.getByText('Credit note for PO-009')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Could not be read again (boom). This is as it was at 20:43; there may be more or fewer now.',
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('an empty answer that could not be read again says there were none then', () => {
    render(<HouseDrafts drafts={[]} failed error="boom" at={AT.getTime()} onOpen={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent('Could not be read again (boom). At 20:43 there were none; there may be some now.');
    expect(screen.queryByText('No drafted letters are waiting.')).toBeNull();
  });

  it('a first read that failed is said in words, not as the bare server message', () => {
    render(<HouseDrafts drafts={null} failed error="boom" onOpen={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent('The drafted letters could not be read (boom). That does not mean none are waiting.');
    expect(screen.queryByText(/unknown, not none/)).toBeNull();
  });
});

describe('HouseDrafts keeps a place under each letter (COMMS-W34)', () => {
  it('draws what the page holds for a letter under that letter, and nothing under the others', () => {
    const other = { ...DRAFT, id: 'D2', subject: 'Another letter' };
    render(
      <HouseDrafts
        drafts={[DRAFT, other]}
        failed={false}
        error={null}
        onOpen={() => {}}
        below={(d) => (d.id === 'D1' ? <p data-testid="held-under">held</p> : null)}
      />,
    );
    const held = screen.getByTestId('held-under');
    expect(held.closest('li')).toHaveTextContent('Credit request');
    expect(held.closest('li')).not.toHaveTextContent('Another letter');
  });

  it("hands the stub a way to put focus on its letter's own button", () => {
    let focusD1 = () => {};
    render(
      <HouseDrafts
        drafts={[DRAFT]}
        failed={false}
        error={null}
        onOpen={() => {}}
        below={(_d, focusRow) => {
          focusD1 = focusRow;
          return null;
        }}
      />,
    );
    focusD1();
    expect(screen.getByText('Credit request').closest('button')).toHaveFocus();
  });
});
