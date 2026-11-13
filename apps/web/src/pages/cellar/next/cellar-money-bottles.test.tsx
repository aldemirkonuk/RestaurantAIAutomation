/**
 * A bottle's leaf and the wine register say whose money each price is. This
 * house's own bottle and glass prices read in its money (a lira house read
 * "$65.00", r8 browser check, 2026-11-12); the library's market average and
 * market price are reference prices whose rows name no currency, so they are
 * printed bare and say so, never with the house's sign and never with "$".
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BottleLeaf from './BottleLeaf';
import type { BottleVM, CellarRow } from './useCellarNextData';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1', loading: false, isAuthenticated: true }),
}));
vi.mock('../../../services/api/settings', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return {
    ...actual,
    settingsApi: {
      ...(actual.settingsApi as object),
      houseCurrency: async () => ({ readable: true, code: 'TRY' }),
    },
  };
});
vi.mock('../../../hooks/queries/useInventoryQueries', () => ({
  useCreateInventoryItem: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../../../hooks/queries/useProviderQueries', () => ({
  useRecommendedProviders: () => ({ data: undefined, isError: false }),
}));
// The lock list (ADR 0193 round 3, L8): read, and empty unless a test says otherwise.
const listPriceLocks = vi.fn(async () => ({
  restaurantId: 'r1',
  generatedAt: '2026-09-21T12:00:00Z',
  readable: true,
  reason: null,
  scope: 'this house' as const,
  currentMenus: [],
  locks: [] as unknown[],
  counts: { open: 0, onCurrentMenu: 0, notOnCurrentMenu: 0, toReview: 0 },
  namesReadable: true,
  namesReason: null,
  markersReadable: true,
  markersReason: null,
}));
vi.mock('../../../services/api/pricing', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  listPriceLocks: () => listPriceLocks(),
}));
vi.mock('./useCellarNextData', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
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
    save: { mutateAsync: vi.fn(), isPending: false, isError: false, error: null },
  }),
}));

function bottle(over: Partial<BottleVM> = {}): BottleVM {
  return {
    id: 'w1',
    name: 'Boğazkere 2021',
    producer: 'Kavaklıdere',
    houseOwn: false,
    grape: 'Boğazkere',
    country: 'Türkiye',
    region: 'Diyarbakır',
    appellation: null,
    style: 'Red',
    vintage: 2021,
    listPrice: 62,
    marketPrice: null,
    bottleSizeMl: 750,
    description: null,
    tastingNotes: null,
    pairingNotes: null,
    imageUrl: null,
    knowledge: 'inferred',
    observedAt: null,
    cellar: null,
    beverageKind: 'wine',
    structure: null,
    ...over,
  };
}

function mount(b: BottleVM) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <BottleLeaf bottle={b} providers={[]} vendorsError={null} restaurantId="r1" onClose={() => {}} />
    </QueryClientProvider>,
  );
}

function cellarRow(over: Partial<CellarRow> = {}): CellarRow {
  return {
    inventoryId: 'inv-1',
    stockLive: 9,
    thresholdMin: 12,
    providerId: null,
    providerName: null,
    lastCountedAt: null,
    glassesPerBottle: null,
    menuPriceGlass: null,
    menuPriceBottle: null,
    velocityPerDay: null,
    daysSinceSale: null,
    analyticsReadable: true,
    ...over,
  };
}

describe("a bottle's leaf says whose money each price is", () => {
  it("this house's prices read lira; the library's figures name no currency", async () => {
    mount(
      bottle({
        listPrice: 62,
        marketPrice: 70,
        cellar: cellarRow({ menuPriceBottle: 650, menuPriceGlass: 140 }),
      }),
    );
    const facts = screen.getByTestId('bottle-leaf-fact-set');
    await waitFor(() => expect(within(facts).getByText('₺650.00')).toBeInTheDocument());
    expect(within(facts).getByText('₺140.00')).toBeInTheDocument();
    const avg = within(facts).getByText('Market average (bottle)').nextElementSibling!;
    expect(avg).toHaveTextContent('62.00 (currency not stated)');
    expect(document.body.textContent).toContain('70.00 (currency not stated)');
    expect(document.body.textContent).not.toMatch(/₺6[27]|₺70/);
    expect(document.body.textContent).not.toMatch(/\$\d/);
  });
});
