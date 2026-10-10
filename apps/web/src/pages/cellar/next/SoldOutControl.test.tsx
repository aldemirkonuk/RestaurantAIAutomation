/**
 * SoldOutControl -- a drink can be 86'd on the bottle leaf, with why, and the
 * stock-out is kept (F-145). The API client is the boundary mocked here; the
 * component and the leaf around it are real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SoldOutControl, { type StockOut, type StockOutState } from './SoldOutControl';

const get = vi.fn();
const post = vi.fn();
vi.mock('../../../services/api/client', async (orig) => ({
  ...(await orig<typeof import('../../../services/api/client')>()),
  apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
}));

const BASE = '/inventory/r1/item/inv-1/stock-out';

function so(over: Partial<StockOut> = {}): StockOut {
  return {
    id: 'so-1',
    cause: 'ran_out',
    note: null,
    startedAt: '2026-09-05T17:30:00Z',
    startedBy: 'u-1',
    endedAt: null,
    endedBy: null,
    ...over,
  };
}

function mount(restaurantId: string | null = 'r1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SoldOutControl restaurantId={restaurantId} inventoryId="inv-1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

describe('SoldOutControl -- a drink can be 86\'d, with why (F-145)', () => {
  it('marks it sold out with the reason chosen, and then says so', async () => {
    const none: StockOutState = { open: null, recent: [] };
    get.mockResolvedValue({ data: none });
    post.mockResolvedValue({ data: { open: so(), recent: [so()] } });
    mount();

    const confirm = await screen.findByTestId('sold-out-confirm');
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId('sold-out-cause'), { target: { value: 'ran_out' } });
    fireEvent.click(confirm);

    await waitFor(() => expect(post).toHaveBeenCalledWith(BASE, { cause: 'ran_out' }));
    expect(get).toHaveBeenCalledWith(BASE);
    const open = await screen.findByTestId('sold-out-open');
    expect(open).toHaveTextContent(/Sold out since .*ran out/);
  });

  it('brings it back with one tap', async () => {
    get.mockResolvedValue({ data: { open: so({ cause: 'broken' }), recent: [so({ cause: 'broken' })] } });
    const ended = so({ cause: 'broken', endedAt: '2026-09-05T19:00:00Z', endedBy: 'u-2' });
    post.mockResolvedValue({ data: { open: null, recent: [ended] } });
    mount();

    fireEvent.click(await screen.findByTestId('sold-out-back'));

    await waitFor(() => expect(post).toHaveBeenCalledWith(`${BASE}/end`));
    expect(await screen.findByTestId('sold-out-confirm')).toBeInTheDocument();
    expect(screen.getByTestId('sold-out-past')).toHaveTextContent(/Sold out before: .*\(broken\)/);
  });

  it('says a failed read is not the same as not sold out', async () => {
    get.mockRejectedValue(new Error('network down'));
    mount();

    const alert = await screen.findByTestId('sold-out-unread');
    expect(alert).toHaveTextContent('could not be read. That is not the same as not sold out.');
    expect(screen.queryByTestId('sold-out-confirm')).toBeNull();
  });

  it('says when marking did not save, and the drink is not shown as sold out', async () => {
    get.mockResolvedValue({ data: { open: null, recent: [] } });
    post.mockRejectedValue(new Error('the server did not answer'));
    mount();

    fireEvent.change(await screen.findByTestId('sold-out-cause'), { target: { value: 'pulled' } });
    fireEvent.click(screen.getByTestId('sold-out-confirm'));

    expect(await screen.findByTestId('sold-out-failed')).toHaveTextContent('That did not save');
    expect(screen.queryByTestId('sold-out-open')).toBeNull();
  });

  it('reads nothing when no house is chosen', () => {
    mount(null);
    expect(get).not.toHaveBeenCalled();
    expect(screen.queryByTestId('sold-out')).toBeNull();
  });
});
