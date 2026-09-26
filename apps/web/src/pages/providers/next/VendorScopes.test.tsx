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
