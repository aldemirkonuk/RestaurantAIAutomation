/**
 * SoldOutControl -- a drink can be 86'd on the bottle leaf, with why, and the
 * stock-out is kept (F-145). The API client is the boundary mocked here; the
 * component and the leaf around it are real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import SoldOutControl, { SoldOutChip, comesBackWords, type StockOut, type StockOutState } from './SoldOutControl';
import { toInventoryItem } from '../../inventory/useInventoryPage';

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

    // F-1521: it names the 86 on screen, so the gateway ends only that one.
    await waitFor(() => expect(post).toHaveBeenCalledWith(`${BASE}/end`, { stockOutId: 'so-1' }));
    expect(await screen.findByTestId('sold-out-confirm')).toBeInTheDocument();
    expect(screen.getByTestId('sold-out-past')).toHaveTextContent(/Sold out before: .*\(broken\)/);
  });

  it('F-1521: a newer 86 since the screen was read is refused, said, and read again', async () => {
    const pulled = so({ id: 'so-2', cause: 'pulled', note: 'corked lot' });
    get
      .mockResolvedValueOnce({ data: { open: so(), recent: [so()] } })
      .mockResolvedValue({ data: { open: pulled, recent: [pulled] } });
    post.mockRejectedValue(new Error('This changed since you looked: Deniz marked it sold out again because they pulled it (corked lot).'));
    mount();

    fireEvent.click(await screen.findByTestId('sold-out-back'));

    expect(await screen.findByTestId('sold-out-failed')).toHaveTextContent(/Deniz marked it sold out again/);
    await waitFor(() => expect(screen.getByTestId('sold-out-open')).toHaveTextContent(/pulled \(corked lot\)/));
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

describe('F-1434: an 86 is seen on the lists, and a broken bottle is said to stay on stock', () => {
  it('says choosing "it broke" does not take the bottle off stock', async () => {
    get.mockResolvedValue({ data: { open: null, recent: [] } });
    mount();

    fireEvent.change(await screen.findByTestId('sold-out-cause'), { target: { value: 'broken' } });

    expect(screen.getByTestId('sold-out-broken-stock')).toHaveTextContent(
      /does not take the broken bottle off stock/,
    );
    fireEvent.change(screen.getByTestId('sold-out-cause'), { target: { value: 'ran_out' } });
    expect(screen.queryByTestId('sold-out-broken-stock')).toBeNull();
  });

  it('has the lists read again after an 86 is marked or ended', async () => {
    get.mockResolvedValue({ data: { open: null, recent: [] } });
    post.mockResolvedValue({ data: { open: so(), recent: [so()] } });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    render(
      <QueryClientProvider client={qc}>
        <SoldOutControl restaurantId="r1" inventoryId="inv-1" />
      </QueryClientProvider>,
    );

    fireEvent.change(await screen.findByTestId('sold-out-cause'), { target: { value: 'ran_out' } });
    fireEvent.click(screen.getByTestId('sold-out-confirm'));

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({ queryKey: ['inventory', 'list'] }),
    );
  });

  it('shows a sold-out chip on a list row, and says a failed read', () => {
    const { rerender } = render(
      <SoldOutChip soldOut={{ cause: 'ran_out', startedAt: '2026-10-10T21:00:00Z' }} />,
    );
    expect(screen.getByTestId('sold-out-chip')).toHaveTextContent('Sold out (86)');
    expect(screen.getByTestId('sold-out-chip').getAttribute('title')).toMatch(/ran out/);

    rerender(<SoldOutChip soldOut={null} readable />);
    expect(screen.queryByTestId('sold-out-chip')).toBeNull();
    expect(screen.queryByTestId('sold-out-chip-unread')).toBeNull();

    rerender(<SoldOutChip soldOut={null} readable={false} />);
    expect(screen.getByTestId('sold-out-chip-unread')).toHaveTextContent(/not read/i);
  });

  it('carries the list 86 onto an /inventory row of any kind', () => {
    const row = toInventoryItem({
      id: 'inv-titos',
      kind: 'spirit',
      stockLive: 3,
      soldOut: { cause: 'ran_out', startedAt: '2026-10-10T21:00:00Z' },
      soldOutReadable: true,
    } as never);
    expect(row.soldOut).toEqual({ cause: 'ran_out', startedAt: '2026-10-10T21:00:00Z' });
    expect(row.soldOutReadable).toBe(true);

    const unread = toInventoryItem({ id: 'inv-2', stockLive: 1, soldOut: null, soldOutReadable: false } as never);
    expect(unread.soldOutReadable).toBe(false);
  });
});

/** F-1496: a pulled 86 stays off after a delivery (20270106300000). */
describe('how an 86 comes back, by its cause', () => {
  it('never promises a delivery for a pulled drink', () => {
    expect(comesBackWords('pulled')).toBe('It comes back only when someone brings it back.');
    expect(comesBackWords('pulled')).not.toMatch(/delivery/);
  });

  it('says a delivery brings back one that ran out', () => {
    expect(comesBackWords('ran_out')).toMatch(/a delivery is booked in/);
  });

  it('says both when the cause is not known', () => {
    expect(comesBackWords()).toMatch(/unless it was pulled/);
  });
});

/**
 * F-1598: "it broke" said to record the breakage "in the count too". A count
 * has no breakage reason, so the bottle counted short read as missing. The
 * note now sends it to a take-off as breakage: the row's own Manual adjust on
 * /inventory, or Inventory from the cellar's leaf.
 */
describe('F-1598: a broken bottle is taken off as breakage, not in a count', () => {
  function mountWith(node: React.ReactNode) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
  }

  it('never sends the breakage to the count', async () => {
    get.mockResolvedValue({ data: { open: null, recent: [] } });
    mount();
    fireEvent.change(await screen.findByTestId('sold-out-cause'), { target: { value: 'broken' } });
    const note = screen.getByTestId('sold-out-broken-stock');
    expect(note).not.toHaveTextContent(/breakage in the count/i);
    expect(note).toHaveTextContent(/Manual adjust, reason Breakage/);
  });

  it('links the cellar leaf to this wine on Inventory', async () => {
    get.mockResolvedValue({ data: { open: null, recent: [] } });
    mountWith(
      <MemoryRouter>
        <SoldOutControl restaurantId="r1" inventoryId="inv-1" wineName="Barolo 2019" />
      </MemoryRouter>,
    );
    fireEvent.change(await screen.findByTestId('sold-out-cause'), { target: { value: 'broken' } });
    expect(screen.getByTestId('sold-out-broken-link')).toHaveAttribute('href', '/inventory?wine=Barolo%202019');
  });

  it('offers the take-off itself where the page has one', async () => {
    get.mockResolvedValue({ data: { open: null, recent: [] } });
    const takeOff = vi.fn();
    mountWith(<SoldOutControl restaurantId="r1" inventoryId="inv-1" onTakeOffBroken={takeOff} />);
    fireEvent.change(await screen.findByTestId('sold-out-cause'), { target: { value: 'broken' } });
    fireEvent.click(screen.getByTestId('sold-out-broken-take-off'));
    expect(takeOff).toHaveBeenCalledTimes(1);
  });
});

/**
 * F-1600: `.cl-note`/`.cl-btn` live in cellar-next.css, which only lazy
 * chunks imported; /inventory loads first, so its 86 drew as bare buttons
 * until a cellar or menu page had been opened.
 */
describe('F-1600: the 86 control brings its own styles', () => {
  it('imports the sheet that defines .cl-note and .cl-btn', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/pages/cellar/next/SoldOutControl.tsx'), 'utf8');
    expect(src).toMatch(/^import '\.\/cellar-next\.css';$/m);
    const css = readFileSync(resolve(process.cwd(), 'src/pages/cellar/next/cellar-next.css'), 'utf8');
    expect(css).toMatch(/^\.cl-btn \{/m);
    expect(css).toMatch(/^\.cl-note \{/m);
  });
});
