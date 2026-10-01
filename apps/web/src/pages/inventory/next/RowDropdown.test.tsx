/**
 * The opened row (INV-W4): formless, Write off only for owners and managers,
 * and Order more goes through /cellar's own OrderCeremony.
 *
 * The row's reads (ledger purchases, paper, lots, the till record) are
 * stubbed; the sheets and the ceremony stub are real mounts.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { InvRow } from './useInventoryNextData';
import type { Provider } from '../../../services/api/providers';

vi.mock('./useInventoryNextData', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useRowDetail: () => ({
    purchases: [],
    purchasesTotal: 0,
    purchasesError: null,
    paper: new Map(),
    lots: [],
    lotsError: null,
  }),
}));
vi.mock('../../cellar/next/useCellarNextData', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useRowRecord: () => ({ data: null, loading: false, error: null }),
  useCellarSettings: () => ({
    data: {
      restaurantId: 'r1',
      holdCeremony: 'hold',
      holdCeremonyConfigured: false,
      gazetteerMeasures: ['bottles'],
      gazetteerMeasuresConfigured: false,
      setBy: null,
      setAt: null,
      readable: true,
      readError: null,
    },
    loading: false,
  }),
}));
vi.mock('../../cellar/next/OrderCeremony', () => ({
  default: ({ label }: { label: string }) => <div data-testid="order-ceremony">{label}</div>,
}));
vi.mock('../../../hooks/queries/useProviderQueries', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useRecommendedProviders: () => ({ data: undefined, isError: false }),
}));

import RowDropdown, { type RowDropdownProps } from './RowDropdown';

function row(over: Partial<InvRow> = {}): InvRow {
  return {
    id: 'i1',
    wineId: 'w1',
    name: 'Gravner Ribolla',
    libraryName: 'Ribolla Gialla Anfora',
    producer: 'Gravner',
    type: 'orange',
    vintage: 2016,
    grape: 'Ribolla Gialla',
    bottleSizeMl: 750,
    stock: 3,
    shadow: 2,
    par: 6,
    reorderPoint: null,
    analyticsReadable: true,
    velocity: 1,
    runway: 3,
    daysSinceSale: 1,
    deadStock: false,
    bottle: 92,
    glass: 18,
    pourMl: 150,
    wac: 40,
    costProvenance: 'invoice',
    value: 120,
    lastCountedAt: '2026-09-30T10:00:00Z',
    openMl: null,
    zones: [{ locationId: 'z1', qty: 3 }],
    providerId: 'p1',
    providerName: 'Vinoteca',
    standing: 'below',
    ...over,
  };
}

const PROVIDERS = [{ id: 'p1', name: 'Vinoteca' }] as unknown as Provider[];

function renderDrop(over: Partial<RowDropdownProps> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props: RowDropdownProps = {
    row: row(),
    canManage: true,
    currency: { state: 'recorded', code: 'EUR' },
    zoneName: (id) => (id === 'z1' ? 'Cave' : 'Unassigned'),
    locations: [],
    locationsUnavailable: false,
    providers: PROVIDERS,
    providersError: null,
    restaurantId: 'r1',
    ...over,
  };
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <RowDropdown {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RowDropdown', () => {
  it('is formless: no input, textarea or select in the opened row', () => {
    renderDrop();
    const drop = screen.getByTestId('row-dropdown');
    expect(drop.querySelectorAll('input, textarea, select').length).toBe(0);
    expect(within(drop).getByText('Where the count comes from')).toBeTruthy();
    expect(within(drop).getByText('How fast it pours')).toBeTruthy();
    expect(within(drop).getByText('What it has cost')).toBeTruthy();
  });

  it('carries no Name and no Pin button', () => {
    renderDrop();
    const drop = screen.getByTestId('row-dropdown');
    expect(within(drop).queryByRole('button', { name: /^name/i })).toBeNull();
    expect(within(drop).queryByRole('button', { name: /pin/i })).toBeNull();
  });

  it('hides Write off from anyone who is not an owner or manager', () => {
    const { unmount } = renderDrop({ canManage: false });
    const actions = screen.getByRole('group', { name: 'What to do with this title' });
    expect(within(actions).queryByRole('button', { name: 'Write off' })).toBeNull();
    expect(within(actions).getByRole('button', { name: 'Record a count' })).toBeTruthy();
    expect(within(actions).getByRole('button', { name: 'Order more' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Write off' })).toBeNull();
    unmount();
    renderDrop({ canManage: true });
    expect(screen.getByRole('button', { name: 'Write off' })).toBeTruthy();
  });

  it('mounts the cellar OrderCeremony when Order more is pressed', () => {
    renderDrop();
    expect(screen.queryByTestId('order-ceremony')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Order more' }));
    const ceremony = screen.getByTestId('order-ceremony');
    // Par 6 less a stock of 3: three bottles bring it back.
    expect(ceremony.textContent).toBe('Hold to order 3 from Vinoteca');
  });

  it('shows head facts only where they were read', () => {
    renderDrop({ row: row({ grape: null, vintage: null, libraryName: null }) });
    const drop = screen.getByTestId('row-dropdown');
    expect(within(drop).queryByText('Grape')).toBeNull();
    expect(within(drop).queryByText('Vintage')).toBeNull();
    expect(within(drop).queryByText('On the library as')).toBeNull();
    expect(within(drop).getByText('House name')).toBeTruthy();
  });
});
