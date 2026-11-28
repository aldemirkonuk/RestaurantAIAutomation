/**
 * Every row draws one cell per header column, and "Used in" once.
 *
 * WHY. The "Used in" cell is added to the table row by more than one open PR,
 * each in a different hunk, and a textual merge of them keeps both copies. A row
 * then has one cell more than the header and Status sits under no column. This
 * fails on that merge, whichever of the PRs lands second.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import InventoryTable, { type InventoryTableProps } from './InventoryTable';
import { type InvRow } from './useInventoryNextData';

vi.mock('../command/HousePriceCell', () => ({
  HousePriceCell: ({ bottle }: { bottle: number | null }) => <span>{bottle}</span>,
}));
vi.mock('./NameThisWine', () => ({ NameHint: () => null }));

const row: InvRow = {
  id: 'i1',
  rollupReadable: true,
  locationsReadable: true,
  wineId: 'w1',
  name: 'Gravner Ribolla',
  libraryName: null,
  producer: 'Gravner',
  type: 'orange',
  kind: 'wine',
  vintage: 2016,
  grape: null,
  bottleSizeMl: 750,
  stock: 12,
  shadow: 0,
  par: 4,
  reorderPoint: null,
  analyticsReadable: true,
  velocity: 1,
  runway: 12,
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
  value: 480,
  lastCountedAt: null,
  openMl: null,
  zones: [{ locationId: 'z1', qty: 12 }],
  providerId: null,
  providerName: null,
  standing: 'above',
  active: true,
  usedIn: 3,
} as InvRow;

const props: InventoryTableProps = {
  rows: [row],
  openId: null,
  onToggle: vi.fn(),
  onUsedIn: vi.fn(),
  canManage: false,
  currency: { state: 'recorded', code: 'EUR' },
  zoneName: () => 'Cellar',
  locations: [],
  locationsUnavailable: false,
  providers: [],
  providersError: null,
  restaurantId: 'r1',
  advice: { status: 'loading' },
  onPriceChanged: vi.fn(),
  grouped: false,
};

afterEach(cleanup);

describe('a table row lines up with its header', () => {
  it('draws one cell per column and the Used in cell once', () => {
    render(<InventoryTable {...props} />);
    const heads = document.querySelectorAll('thead th').length;
    const cells = screen.getByTestId('inv-row-i1').querySelectorAll('td').length;
    expect(heads).toBeGreaterThan(0);
    expect(cells).toBe(heads);
    expect(document.querySelectorAll('[data-testid="inv-usedin-i1"]').length).toBe(1);
  });
});
