/**
 * The opened row carries "What did these cost?" in its cost panel (r36
 * invoices R1, web half), for an owner or a manager only. OpeningCost itself
 * is stubbed here (its own behaviour is OpeningCost.test.tsx); this checks the
 * wiring: which house, which good, which unit, and who. The row's other reads
 * are stubbed as RowDropdown.test.tsx stubs them.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type InvRow } from './useInventoryNextData';
import type { Provider } from '../../../services/api/providers';

// Per-test overrides for the stubbed reads (INV-W8 / INV-W9).
const reads = vi.hoisted(() => ({
  detail: {} as Record<string, unknown>,
  record: {} as Record<string, unknown>,
}));

vi.mock('./useInventoryNextData', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useRowDetail: () => ({
    purchases: [],
    purchasesTotal: 0,
    purchasesError: null,
    paper: new Map(),
    lots: [],
    lotsError: null,
    rereadPurchases: () => {},
    rereadLots: () => {},
    ...reads.detail,
  }),
}));
vi.mock('../../cellar/next/useCellarNextData', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useRowRecord: () => ({ data: null, loading: false, error: null, ...reads.record }),
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
// The two acts ported from the legacy page call the same API functions it does.
const inv = vi.hoisted(() => ({
  update: vi.fn(),
  reconcile: vi.fn(),
  del: vi.fn(),
  research: vi.fn(async (): Promise<unknown[]> => []),
}));
vi.mock('../../../services/api/inventory', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  updateInventoryItem: inv.update,
  reconcileItem: inv.reconcile,
  deleteInventoryItem: inv.del,
  fetchHouseItemResearch: inv.research,
}));
const tableExport = vi.hoisted(() => ({ exportTable: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../lib/tableExport', () => ({ exportTable: tableExport.exportTable }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  toast: Object.assign(vi.fn(), { success: toasts.success, error: toasts.error, warning: vi.fn(), message: vi.fn() }),
}));
vi.mock('../../../hooks/queries/useProviderQueries', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useRecommendedProviders: () => ({ data: undefined, isError: false }),
}));

vi.mock('./OpeningCost', () => ({
  OpeningCost: (p: { restaurantId: string | null; inventoryId: string; uom: string | null; canManage: boolean; title: string }) => (
    <div data-testid="opening-cost-stub">{`${p.restaurantId}|${p.inventoryId}|${p.uom}|${p.canManage}|${p.title}`}</div>
  ),
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
    kind: 'wine',
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
    usageSource: null,
    usageSince: null,
    usageUntil: null,
    usageQty: null,
    bottle: 92,
    glass: 18,
    pourMl: 150,
    wac: 40,
    costProvenance: 'invoice',
    value: 120,
    lastCountedAt: '2026-09-30T10:00:00Z',
    openMl: 0,
    zones: [{ locationId: 'z1', qty: 3 }],
    providerId: 'p1',
    providerName: 'Vinoteca',
    standing: 'below',
    active: true,
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

describe('RowDropdown — What did these cost? (r36 R1)', () => {
  it('an owner or a manager gets it in the cost panel, for this house, this good and its unit', () => {
    renderDrop({ uom: 'g', kind: 'food', row: row({ id: 'i7', name: 'Flour' }) });
    expect(screen.getByTestId('opening-cost-stub').textContent).toBe('r1|i7|g|true|Flour');
  });

  it('a wine with no unit recorded is asked a bottle (no unit passed down)', () => {
    renderDrop();
    expect(screen.getByTestId('opening-cost-stub').textContent).toBe('r1|i1|null|true|Gravner Ribolla');
  });

  it('staff never get it', () => {
    renderDrop({ canManage: false });
    expect(screen.queryByTestId('opening-cost-stub')).toBeNull();
  });

  it('a panel list without the cost panel does not draw it', () => {
    renderDrop({ sections: ['where'] });
    expect(screen.queryByTestId('opening-cost-stub')).toBeNull();
  });
});
