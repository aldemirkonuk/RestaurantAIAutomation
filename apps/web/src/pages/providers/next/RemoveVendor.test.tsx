/**
 * r27 vendor-remove-ui: /vendors can remove a vendor, and says what happened.
 *
 * Pinned here: staff never see the control; the ask says what will happen
 * before it does; confirming calls DELETE for that vendor; the toast body is
 * the gateway's sentence verbatim; a refusal stays in the panel and is never
 * queued as an "offline" removal.
 *
 * `deleteProvider` is mocked, so these assert what the page does with the
 * gateway's answers, never that the gateway gives them (that is
 * `vendor-removal-role.spec.ts` and #1337's `vendor-removal.spec.ts`).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ deleteProvider: vi.fn() }));
const auth = vi.hoisted(() => ({ role: 'manager' as string | null }));
const toast = vi.hoisted(() => ({ info: vi.fn(), success: vi.fn(), error: vi.fn() }));
const sync = vi.hoisted(() => ({ queueMutation: vi.fn() }));
const houseToast = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }));

vi.mock('../../../services/api/providers', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  deleteProvider: (...a: unknown[]) => api.deleteProvider(...a),
}));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRole: auth.role, user: { role: auth.role }, activeRestaurantId: 'house-1' }),
}));
vi.mock('../../../stores', () => ({ useNotificationStore: () => toast }));
vi.mock('../../../lib/sync-manager', () => ({ syncManager: sync }));
vi.mock('sonner', () => ({ toast: houseToast }));

import { RemoveVendor, removalAsk } from './RemoveVendor';

const PROVIDER = { id: 'prov-1', name: 'Bir Dağıtım' } as never;
const SENTENCE =
  'The vendor was removed. No new order can be placed with them. 2 standing orders were paused. 2 open orders stay on Orders. You can still write to them about an order already placed.';

function renderIt(onRemoved = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RemoveVendor provider={PROVIDER} onRemoved={onRemoved} />
    </QueryClientProvider>,
  );
  return onRemoved;
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = 'manager';
});

describe('RemoveVendor — who sees it', () => {
  it.each(['staff', null])('%s sees no remove control', (role) => {
    auth.role = role;
    renderIt();
    expect(screen.queryByTestId('vendor-remove')).toBeNull();
  });

  it.each(['owner', 'manager'])('%s sees it', (role) => {
    auth.role = role;
    renderIt();
    expect(screen.getByTestId('vendor-remove')).toBeTruthy();
  });
});

describe('RemoveVendor — asks first, then says what happened', () => {
  it('the ask names the vendor and what happens to its orders, and nothing is removed yet', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('vendor-remove'));
    expect(screen.getByTestId('vendor-remove-ask').textContent).toBe(
      'Remove Bir Dağıtım? No new order can be placed with them. Their standing orders are paused. Orders already open stay on Orders, and you can still write to them about those.',
    );
    expect(removalAsk('X')).toContain('Their standing orders are paused.');
    expect(api.deleteProvider).not.toHaveBeenCalled();
  });

  it('confirm removes that vendor, toasts the gateway sentence verbatim and closes the sheet', async () => {
    api.deleteProvider.mockResolvedValue({
      success: true,
      standingOrdersPaused: 1,
      schedulesPaused: 1,
      openOrders: 2,
      message: SENTENCE,
    });
    const onRemoved = renderIt();
    fireEvent.click(screen.getByTestId('vendor-remove'));
    fireEvent.click(screen.getByTestId('vendor-remove-confirm'));
    await waitFor(() => expect(onRemoved).toHaveBeenCalledTimes(1));
    expect(api.deleteProvider).toHaveBeenCalledWith('prov-1');
    // The sentence goes to the house toaster (the one the app draws), never to
    // the notification store's list, which no component renders.
    expect(houseToast.success).toHaveBeenCalledWith('Vendor removed', { description: SENTENCE });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('a refusal stays in the panel in the gateway words; nothing is queued or toasted', async () => {
    const refusal =
      "Removing a vendor pauses its standing orders and stops every new order to it, so it is a manager's or an owner's decision. You are signed in as staff at this house, so the vendor was not removed. Ask a manager or an owner to remove it.";
    api.deleteProvider.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 403'), {
        isAxiosError: true,
        request: {},
        response: { status: 403, data: { message: refusal } },
      }),
    );
    const onRemoved = renderIt();
    fireEvent.click(screen.getByTestId('vendor-remove'));
    fireEvent.click(screen.getByTestId('vendor-remove-confirm'));
    await waitFor(() => expect(screen.getByTestId('vendor-remove-problem').textContent).toBe(refusal));
    expect(onRemoved).not.toHaveBeenCalled();
    expect(sync.queueMutation).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
    expect(houseToast.success).not.toHaveBeenCalled();
  });

  it('no connection says nothing was removed, and is not queued as a later removal', async () => {
    api.deleteProvider.mockRejectedValue(
      Object.assign(new Error('Network Error'), { isAxiosError: true, request: {}, response: undefined }),
    );
    renderIt();
    fireEvent.click(screen.getByTestId('vendor-remove'));
    fireEvent.click(screen.getByTestId('vendor-remove-confirm'));
    await waitFor(() =>
      expect(screen.getByTestId('vendor-remove-problem').textContent).toContain('The vendor was not removed'),
    );
    expect(sync.queueMutation).not.toHaveBeenCalled();
  });
});
