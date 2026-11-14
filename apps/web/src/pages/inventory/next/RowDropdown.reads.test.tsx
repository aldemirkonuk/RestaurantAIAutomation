/**
 * The opened row asks only for the reads a drawn panel shows (inventory r36
 * audit, gap 7): the drawer's acts draw no panel, a staff reader is never
 * shown a cost, a settled price needs no ledger fallback, and a food has no
 * auction lots. Harness copied from RowDropdown.test.tsx, with the row-detail
 * stub recording what it was asked for.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { InvRow } from './useInventoryNextData';
import type { Provider } from '../../../services/api/providers';

// Per-test overrides for the stubbed reads (INV-W8 / INV-W9).
const reads = vi.hoisted(() => ({
  detail: {} as Record<string, unknown>,
  record: {} as Record<string, unknown>,
  need: [] as Array<Record<string, boolean> | undefined>,
}));

vi.mock('./useInventoryNextData', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useRowDetail: (_id: string, need?: Record<string, boolean>) => {
    reads.need.push(need);
    return {
    purchases: [],
    purchasesTotal: 0,
    purchasesError: null,
    paper: new Map(),
    lots: [],
    lotsError: null,
    rereadPurchases: () => {},
    rereadLots: () => {},
    ...reads.detail,
    };
  },
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

const last = () => reads.need[reads.need.length - 1];

beforeEach(() => {
  reads.need = [];
  reads.detail = {};
});

describe('RowDropdown asks only for what it draws', () => {
  it('the drawer\'s acts (no evidence panel) read nothing', () => {
    renderDrop({ sections: [] });
    expect(last()).toEqual({ purchases: false, paper: false, lots: false });
  });

  it('a manager\'s cost panel with settled prices reads the lots, not the ledger', () => {
    renderDrop({ sections: ['cost'], settled: [{ receivedAt: '2026-11-01T00:00:00Z', unitCost: 9 }] });
    expect(last()).toEqual({ purchases: false, paper: false, lots: true });
  });

  it('a manager\'s cost panel with no settled price falls back to the ledger', () => {
    renderDrop({ sections: ['cost'], settled: [] });
    expect(last()).toEqual({ purchases: true, paper: false, lots: true });
    renderDrop({ sections: ['cost'] });
    expect(last()).toEqual({ purchases: true, paper: false, lots: true });
  });

  it('while the figures read or after they failed, the cost panel reads no ledger', () => {
    renderDrop({ sections: ['cost'], settled: 'reading' });
    expect(last()?.purchases).toBe(false);
    renderDrop({ sections: ['cost'], settled: 'failed' });
    expect(last()?.purchases).toBe(false);
  });

  it('a staff reader\'s cost panel reads neither the ledger nor the lots', () => {
    renderDrop({ canManage: false, sections: ['cost'] });
    expect(last()).toEqual({ purchases: false, paper: false, lots: false });
  });

  it('a food\'s cost panel reads no auction lots', () => {
    renderDrop({ sections: ['cost'], kind: 'food', uom: 'g', settled: [] });
    expect(last()).toEqual({ purchases: true, paper: false, lots: false });
  });

  it('the paperwork reads the purchases and their paper, for anyone', () => {
    renderDrop({ canManage: false, sections: ['paper'] });
    expect(last()).toEqual({ purchases: true, paper: true, lots: false });
  });

  it('the whole row, as the legacy expansion drew it, reads all three', () => {
    renderDrop();
    expect(last()).toEqual({ purchases: true, paper: true, lots: true });
  });
});
