/**
 * /vendors opens house-first (founder, 2026-09-26, item 36; ADR 0221):
 *
 *   Supplies my menu → All my vendors → Find new vendors
 *
 * Rendered through the real page and the real scope hook, with the gateway
 * mocked at the client, so the counts, the default rung, the widened-default
 * banner, the honest empty states and the catalogue rung are all asserted as a
 * person would see them.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { Provider } from '../../../services/api/providers';

const h = vi.hoisted(() => ({
  cards: [] as unknown[],
  supply: null as unknown,
  supplyFails: false,
  catalogue: null as unknown,
  catalogueFails: false,
  house: null as unknown,
  houseFails: false,
  wineSellers: null as unknown,
  wineSellersFails: false,
  wineListers: null as unknown,
  gets: [] as string[],
  posts: [] as Array<{ url: string; body: unknown }>,
}));

vi.mock('./useProvidersNextData', () => ({
  useProvidersNextData: () => ({
    cards: h.cards,
    hasData: true,
    isError: false,
    errorMessage: '',
    ordersKnown: true,
    refetch: vi.fn(),
  }),
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1' }),
}));

vi.mock('./UsualCurrencyCoveragePanel', () => ({
  UsualCurrencyCoveragePanel: () => null,
}));

vi.mock('../../../services/api/client', () => ({
  apiClient: {
    get: vi.fn(async (url: string) => {
      h.gets.push(url);
      if (url === '/providers/menu-supply') {
        if (h.supplyFails) {
          throw Object.assign(new Error('503'), {
            response: { status: 503, data: { message: 'The price history could not be read (timeout)' } },
          });
        }
        return { data: h.supply };
      }
      if (url === '/settings/currency') {
        if (h.houseFails) throw Object.assign(new Error('503'), { response: { status: 503 } });
        return { data: h.house };
      }
      if (url.startsWith('/providers/wine-sellers')) {
        if (h.wineSellersFails) {
          throw Object.assign(new Error('503'), {
            response: { status: 503, data: { message: 'The inventory could not be read (timeout)' } },
          });
        }
        return { data: h.wineSellers };
      }
      if (url.startsWith('/providers/catalogue-wine-listers')) {
        return { data: h.wineListers };
      }
      if (url.startsWith('/vendor-catalogue/search')) {
        if (h.catalogueFails) {
          throw Object.assign(new Error('503'), {
            response: { status: 503, data: { message: 'Vendor catalogue search is unavailable right now.' } },
          });
        }
        return { data: h.catalogue };
      }
      throw new Error(`unexpected GET ${url}`);
    }),
    post: vi.fn(async (url: string, body: unknown) => {
      h.posts.push({ url, body });
      return { data: { id: 'new' } };
    }),
  },
}));

import ProvidersNext from './ProvidersNext';

function provider(id: string, name: string, over: Partial<Provider> = {}): Provider {
  return {
    id,
    name,
    primaryBusinessType: 'Distributor',
    winePortfolio: '',
    phone: '',
    email: '',
    physicalAddress: '',
    website: '',
    restaurantId: 'r1',
    ...over,
  };
}

const card = (p: Provider) => ({ provider: p, openOrders: 0, leadTimeDays: null, lastContact: null });

function menuSupply(over: Record<string, unknown> = {}, suppliers: unknown[] = []) {
  return {
    menu: { current: true, menus: 1, readAt: '2026-09-01T00:00:00Z', lines: 12, linkedLines: 9, wines: 9, ...over },
    windowDays: 180,
    since: '2026-03-30',
    suppliers,
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ProvidersNext />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const count = (s: string) => screen.getByTestId(`scope-${s}-count`).textContent;
const names = () =>
  screen.queryAllByRole('button').map((b) => b.textContent ?? '').filter((t) => /Bodega|Cave|Vinos/.test(t));

beforeEach(() => {
  h.cards = [
    card(provider('p1', 'Bodega Álvaro')),
    card(provider('p2', 'Cave Lumière', { catalogueVendorId: 'cat-2' })),
    card(provider('p3', 'Vinos del Sur')),
  ];
  h.supply = menuSupply({}, [
    { providerId: 'p2', menuWines: 3, priced: 2, ordered: 1, stocked: 0 },
    { providerId: 'p1', menuWines: 1, priced: 0, ordered: 0, stocked: 1 },
  ]);
  h.supplyFails = false;
  h.catalogue = {
    data: [
      { id: 'cat-2', name: 'Cave Lumière', type: 'importer', country: 'US', state: 'CA', city: 'Napa', wine_specialties: 'Burgundy' },
      { id: 'cat-9', name: 'Harbor Wine Co', type: 'distributor', country: 'US', state: 'CA', city: 'Oakland', wine_specialties: null },
    ],
    total: 57,
    limit: 20,
    offset: 0,
  };
  h.catalogueFails = false;
  h.house = { restaurantId: 'r1', code: 'USD', country: 'United States', readable: true, reason: null, statedAt: null };
  h.houseFails = false;
  h.wineSellers = {
    query: { text: 'opus one', words: ['opus', 'one'], vintages: [] },
    winesMatched: 2,
    sellers: [
      {
        providerId: 'p3',
        wines: [
          { masterWineId: 'w19', producer: 'Opus One Winery', name: 'Opus One', vintage: 2019, priced: false, ordered: true, stocked: false },
          { masterWineId: 'w18', producer: 'Opus One Winery', name: 'Opus One', vintage: 2018, priced: true, ordered: false, stocked: false },
        ],
      },
    ],
  };
  h.wineSellersFails = false;
  h.wineListers = {
    query: { text: 'opus', words: ['opus'], vintages: [] },
    country: 'US',
    sightingsRead: 3,
    listers: [
      {
        vendor: { id: 'cat-7', name: 'Napa Imports', type: 'importer', country: 'US', state: 'CA', city: 'Napa', wine_specialties: null },
        wines: [
          { masterWineId: null, producer: null, name: 'OPUS ONE Napa 2016', vintage: 2016, vintageFromText: true, kind: 'listed', lastSeen: '2026-07-01T00:00:00Z' },
          { masterWineId: 'w18', producer: 'Opus One Winery', name: 'Opus One', vintage: 2018, vintageFromText: false, kind: 'quoted', lastSeen: '2026-09-01T00:00:00Z' },
        ],
      },
    ],
  };
  h.gets = [];
  h.posts = [];
  window.history.replaceState({}, '', '/vendors');
});

describe('/vendors opens on Supplies my menu', () => {
  it('shows only the vendors with purchase evidence, tagged, with live counts on every rung', async () => {
    renderPage();
    await waitFor(() => expect(count('menu')).toBe('2'));
    expect(screen.getByTestId('scope-menu')).toHaveAttribute('aria-selected', 'true');
    expect(count('all')).toBe('3');
    await waitFor(() => expect(count('find')).toBe('57'));

    expect(names().map((t) => t.includes('Vinos'))).not.toContain(true);
    expect(screen.getByText('Cave Lumière')).toBeInTheDocument();
    expect(screen.getByText('3 wines on your menu · priced, ordered')).toBeInTheDocument();
    expect(screen.getByText('1 wine on your menu · stocked')).toBeInTheDocument();
    expect(screen.getByTestId('scope-menu-basis')).toHaveTextContent('9 wines on your current menu');
    expect(screen.queryByTestId('scope-widened')).not.toBeInTheDocument();
  });

  it('the menu rung keeps the book’s order — it hides cards, never re-ranks them', async () => {
    renderPage();
    await waitFor(() => expect(count('menu')).toBe('2'));
    const tags = screen.getAllByTestId('supply-tag').map((t) => t.textContent);
    // Book order is p1, p2 (from useProvidersNextData); the evidence order (p2 first) is not used.
    expect(tags).toEqual(['1 wine on your menu · stocked', '3 wines on your menu · priced, ordered']);
  });

  it('switches to All my vendors on a tap, drops the tags, and remembers it in the URL', async () => {
    renderPage();
    await waitFor(() => expect(count('menu')).toBe('2'));
    fireEvent.click(screen.getByTestId('scope-all'));
    expect(screen.getByText('Vinos del Sur')).toBeInTheDocument();
    expect(screen.queryAllByTestId('supply-tag')).toHaveLength(0);
    expect(new URLSearchParams(window.location.search).get('scope')).toBe('all');
    // chosen, so no "showing all" banner
    expect(screen.queryByTestId('scope-widened')).not.toBeInTheDocument();
  });

  it('says so, and offers the whole book, when no vendor supplies the current menu', async () => {
    h.supply = menuSupply({}, []);
    renderPage();
    await waitFor(() => expect(count('menu')).toBe('0'));
    const empty = screen.getByTestId('scope-menu-empty');
    expect(empty).toHaveTextContent('None of your vendors has a price in the last 180 days, an order, or a stock line');
    fireEvent.click(within(empty).getByText('See all your vendors'));
    expect(screen.getByTestId('scope-all')).toHaveAttribute('aria-selected', 'true');
  });
});

describe('no menu → All my vendors, with a banner', () => {
  it('a house with no current menu opens on All my vendors and says why', async () => {
    h.supply = menuSupply({ current: false, menus: 0, readAt: null, lines: 0, linkedLines: 0, wines: 0 });
    renderPage();
    const banner = await screen.findByTestId('scope-widened');
    expect(banner).toHaveTextContent('No menu read yet — showing all your vendors.');
    expect(within(banner).getByText('Read your menu')).toHaveAttribute('href', '/house/menu');
    expect(screen.getByTestId('scope-all')).toHaveAttribute('aria-selected', 'true');
    expect(count('menu')).toBe('—'); // not a zero: there is no menu to count against
    expect(screen.getByText('Vinos del Sur')).toBeInTheDocument();
  });

  it('a menu whose lines link no wine widens too, and says that instead', async () => {
    h.supply = menuSupply({ linkedLines: 0, wines: 0 });
    renderPage();
    const banner = await screen.findByTestId('scope-widened');
    expect(banner).toHaveTextContent('None of your current menu’s lines is linked to a wine yet');
  });

  it('a failed evidence read widens, prints the failure, and the menu rung claims nothing', async () => {
    h.supplyFails = true;
    renderPage();
    // The hook retries once (as in production) before it calls the read failed.
    const banner = await screen.findByTestId('scope-widened', {}, { timeout: 4000 });
    expect(banner).toHaveTextContent('could not be worked out (The price history could not be read (timeout))');
    fireEvent.click(screen.getByTestId('scope-menu'));
    expect(screen.getByRole('alert')).toHaveTextContent('Nothing below is claimed about who supplies it.');
    expect(screen.queryByText('Bodega Álvaro')).not.toBeInTheDocument();
    expect(count('menu')).toBe('—');
  });
});

describe('Find new vendors — the curated catalogue', () => {
  it('the /distributors redirect (?tab=discover) lands here, with the live total', async () => {
    window.history.replaceState({}, '', '/vendors?tab=discover');
    renderPage();
    expect(screen.getByTestId('scope-find')).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByTestId('find-total')).toHaveTextContent(
      '57 curated vendors in US — showing the first 2; narrow the search to see others.',
    );
    expect(h.gets.some((u) => u.startsWith('/vendor-catalogue/search') && u.includes('country=US'))).toBe(true);
    // the book's grid is not drawn under the catalogue
    expect(screen.queryByText('Vinos del Sur')).not.toBeInTheDocument();
  });

  it('a vendor already in the book says so; a new one can be added to the book', async () => {
    window.history.replaceState({}, '', '/vendors?scope=find');
    renderPage();
    const rows = await screen.findAllByTestId('find-row');
    expect(within(rows[0]).getByText('In your vendors')).toBeInTheDocument();
    fireEvent.click(within(rows[1]).getByText('Add to my vendors'));
    await waitFor(() => expect(h.posts).toEqual([{ url: '/providers', body: { catalogue_vendor_id: 'cat-9' } }]));
    expect(await within(rows[1]).findByText('In your vendors')).toBeInTheDocument();
  });

  it('a failed search is said as a failure, never as an empty catalogue', async () => {
    h.catalogueFails = true;
    window.history.replaceState({}, '', '/vendors?scope=find');
    renderPage();
    expect(await screen.findByRole('alert', {}, { timeout: 4000 })).toHaveTextContent(
      'That is a failed search, not an empty catalogue.',
    );
    expect(count('find')).toBe('—');
  });
});

describe('Find new vendors opens on the house’s own country (founder, round 7, item 48)', () => {
  const catalogueGets = () => h.gets.filter((u) => u.startsWith('/vendor-catalogue/search'));

  it('a house in Türkiye searches TR, never US first, and says where the country came from', async () => {
    h.house = { restaurantId: 'r1', code: 'TRY', country: 'Türkiye', readable: true, reason: null, statedAt: null };
    window.history.replaceState({}, '', '/vendors?scope=find');
    renderPage();
    await waitFor(() => expect(catalogueGets().length).toBeGreaterThan(0));
    expect(catalogueGets().every((u) => u.includes('country=TR'))).toBe(true);
    expect(screen.getByTestId('find-country')).toHaveValue('TR');
    expect(screen.getByTestId('find-country-basis')).toHaveTextContent('Opens on your house’s country (TR, from “Türkiye”).');
  });

  it('a house with no country recorded opens on US, and says so', async () => {
    h.house = { restaurantId: 'r1', code: null, country: null, readable: true, reason: null, statedAt: null };
    window.history.replaceState({}, '', '/vendors?scope=find');
    renderPage();
    await waitFor(() => expect(catalogueGets().length).toBeGreaterThan(0));
    expect(catalogueGets().every((u) => u.includes('country=US'))).toBe(true);
    expect(screen.getByTestId('find-country-basis')).toHaveTextContent('Your house has no country recorded, so this opens on US.');
  });

  it('a country the table does not know is not guessed at: US, and the hint names what was written', async () => {
    h.house = { restaurantId: 'r1', code: null, country: 'Atlantis', readable: true, reason: null, statedAt: null };
    window.history.replaceState({}, '', '/vendors?scope=find');
    renderPage();
    await waitFor(() => expect(catalogueGets().length).toBeGreaterThan(0));
    expect(catalogueGets().every((u) => u.includes('country=US'))).toBe(true);
    expect(screen.getByTestId('find-country-basis')).toHaveTextContent('Your house’s country (“Atlantis”) is not one this list knows');
  });

  it('a failed read of the house falls back to US and says the country could not be read', async () => {
    h.houseFails = true;
    window.history.replaceState({}, '', '/vendors?scope=find');
    renderPage();
    await waitFor(() => expect(catalogueGets().length).toBeGreaterThan(0), { timeout: 4000 });
    expect(catalogueGets().every((u) => u.includes('country=US'))).toBe(true);
    expect(screen.getByTestId('find-country-basis')).toHaveTextContent('could not be read, so this opens on US');
  });

  it('the field stays editable: a typed country wins over the house’s', async () => {
    h.house = { restaurantId: 'r1', code: 'TRY', country: 'Türkiye', readable: true, reason: null, statedAt: null };
    window.history.replaceState({}, '', '/vendors?scope=find');
    renderPage();
    await waitFor(() => expect(screen.getByTestId('find-country')).toHaveValue('TR'));
    fireEvent.change(screen.getByTestId('find-country'), { target: { value: 'fr' } });
    await waitFor(() => expect(catalogueGets().some((u) => u.includes('country=FR'))).toBe(true));
    expect(screen.getByTestId('find-country-basis')).toHaveTextContent(/^$/);
  });
});

describe('a wine NAME matches any vintage where the menu rung is not applied (item 48)', () => {
  it('All my vendors: a wine name finds who sold any vintage of it, labelled with the vintages', async () => {
    window.history.replaceState({}, '', '/vendors?scope=all');
    renderPage();
    fireEvent.change(screen.getByTestId('book-q'), { target: { value: 'opus one' } });
    const tag = await screen.findByTestId('supply-tag');
    expect(tag).toHaveTextContent('Sold you Opus One Winery Opus One 2019, 2018 · priced, ordered');
    expect(h.gets).toContain('/providers/wine-sellers?q=opus+one');
    expect(screen.getByText('Vinos del Sur')).toBeInTheDocument();
    expect(screen.queryByText('Bodega Álvaro')).not.toBeInTheDocument();
    expect(screen.getByTestId('book-wine-basis')).toHaveTextContent('1 of your vendors sold you a wine matching “opus one” — any vintage');
  });

  it('the same box still finds a vendor by its own name, accent-blind', async () => {
    h.wineSellers = { query: { text: 'alvaro', words: ['alvaro'], vintages: [] }, winesMatched: 0, sellers: [] };
    window.history.replaceState({}, '', '/vendors?scope=all');
    renderPage();
    fireEvent.change(screen.getByTestId('book-q'), { target: { value: 'alvaro' } });
    await screen.findByTestId('book-wine-basis');
    expect(screen.getByText('Bodega Álvaro')).toBeInTheDocument();
    expect(screen.queryByText('Vinos del Sur')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('supply-tag')).toHaveLength(0);
  });

  it('a failed wine search says so and keeps only the name matches — never “nobody sold it”', async () => {
    h.wineSellersFails = true;
    window.history.replaceState({}, '', '/vendors?scope=all');
    renderPage();
    fireEvent.change(screen.getByTestId('book-q'), { target: { value: 'opus one' } });
    const alert = await screen.findByTestId('book-wine-failed', {}, { timeout: 4000 });
    expect(alert).toHaveTextContent('That is a failed search, not a wine nobody sold you.');
    expect(screen.queryByTestId('book-q-empty')).not.toBeInTheDocument();
  });

  it('the menu rung has no name search — it is the exact-vintage rung', async () => {
    renderPage();
    await waitFor(() => expect(count('menu')).toBe('2'));
    expect(screen.queryByTestId('book-q')).not.toBeInTheDocument();
    expect(h.gets.some((u) => u.startsWith('/providers/wine-sellers'))).toBe(false);
  });

  it('Find new vendors: a wine name lists curated vendors seen pricing any vintage, saying how each was seen', async () => {
    window.history.replaceState({}, '', '/vendors?scope=find');
    renderPage();
    fireEvent.change(screen.getByTestId('find-q'), { target: { value: 'opus' } });
    const row = await screen.findByTestId('find-wine-row');
    expect(within(row).getByText('Napa Imports')).toBeInTheDocument();
    expect(within(row).getByTestId('find-wine-tag')).toHaveTextContent(
      'Quoted Opus One Winery Opus One 2018 · Listed “OPUS ONE Napa 2016” (as written on their list)',
    );
    expect(h.gets).toContain('/providers/catalogue-wine-listers?q=opus&country=US');
    expect(screen.getByTestId('find-wine-basis')).toHaveTextContent('A price on a vendor’s list is not a sale');
    fireEvent.click(within(row).getByText('Add to my vendors'));
    await waitFor(() => expect(h.posts).toEqual([{ url: '/providers', body: { catalogue_vendor_id: 'cat-7' } }]));
  });
});
