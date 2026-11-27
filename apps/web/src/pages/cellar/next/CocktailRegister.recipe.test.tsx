/**
 * The register with the real recipe sheet (round 17, D1). CellarNext.test
 * mocks the sheet, so it proves only that a div appears. Here the register,
 * the sheet and the recipe hooks are real; only the network and the
 * register's own list are stubbed. Opening a second drink while the first has
 * unsaved lines must show the second drink's recipe, and Save must send the
 * second drink's lines to the second drink.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { CocktailRecipe, RecipeLine } from '../../../services/api/recipes';

const RID = '11111111-1111-4111-8111-111111111111';
const CA = '22222222-2222-4222-8222-222222222222';
const CB = '88888888-8888-4888-8888-888888888888';
const VA = '44444444-4444-4444-8444-444444444444';
const VB = '99999999-9999-4999-8999-000000000009';

const h = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), recipes: {} as Record<string, unknown> }));

vi.mock('../../../services/api/client', () => ({
  apiClient: { get: h.get, put: h.put, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorStatus: (e: unknown) => {
    const s = (e as { response?: { status?: unknown } } | null)?.response?.status;
    return typeof s === 'number' ? s : null;
  },
}));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: RID, activeRole: 'manager', user: { role: 'manager' } }),
}));
vi.mock('./useCellarNextData', () => {
  const row = (id: string, name: string) => ({
    id, name, display_name: null, menu_section: null, method: null, glass: null, garnish: null, price: 450,
  });
  const mutation = { mutateAsync: vi.fn(), isPending: false };
  return {
    useCocktailRegister: () => ({
      data: { rows: [row(CA, 'Negroni'), row(CB, 'Margarita')], count: 2, truncated: false, referenceRows: 0, recipesAvailable: false, scopeNote: '' },
      loading: false,
      error: null,
    }),
    useCocktailWrites: () => ({ create: mutation, amend: mutation, retire: mutation }),
  };
});

import CocktailRegister from './CocktailRegister';
import { forgetDrafts } from './recipe/drafts';

function line(label: string, qty: number, id: string): RecipeLine {
  return {
    id: `l-${label}`, position: 0, role: 'stocked', inventoryId: id, label, itemName: label, itemKind: 'spirit',
    qtyEntered: qty, unitCode: 'ml', qtyBase: qty * 10, baseUnit: 'ml10', status: 'linked', costPerServe: 10, costBasis: 'lot_wac',
  };
}

function recipe(id: string, name: string, versionId: string | null, lines: RecipeLine[]): CocktailRecipe {
  return {
    cocktail: { id, name, price: 450, glass: null, garnish: null, method: null, description: null },
    current: versionId
      ? { versionId, version: 1, yieldServes: 1, method: null, glass: null, garnish: null, createdAt: '2026-11-07T10:00:00Z', lines }
      : null,
    cost: versionId ? { perServe: 10 * lines.length, priced: lines.length, of: lines.length, complete: true } : null,
    versionCount: versionId ? 1 : 0,
    legacyLines: [],
  };
}

beforeEach(() => {
  // Unsaved drafts live for the session (recipe/drafts.ts); each case starts with none.
  forgetDrafts();
  h.get.mockReset();
  h.put.mockReset();
  h.get.mockImplementation(async (url: string) => {
    if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'TRY', country: 'Turkey', readable: true, reason: null, statedAt: null } };
    for (const [cid, r] of Object.entries(h.recipes)) if (url === `/recipes/${RID}/cocktails/${cid}`) return { data: r };
    if (url === `/recipes/${RID}/shelf`) return { data: [] };
    throw new Error(`unexpected GET ${url}`);
  });
  h.put.mockResolvedValue({ data: { versionId: 'saved', version: 2, lines: [] } });
});

function mount(route = '/cocktails') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[route]}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
  return render(<CocktailRegister register={null} registerLoading={false} />, { wrapper: wrap });
}

const open = (name: string) => fireEvent.click(within(screen.getByRole('table')).getByText(name));
const amounts = () => screen.getAllByLabelText('Amount') as HTMLInputElement[];

describe('CocktailRegister with the real recipe sheet', () => {
  it('a link from the inventory drawer (/cocktails?open=<id>) opens that drink on its cards, then its nutrition card, then its lines', async () => {
    h.recipes = { [CB]: recipe(CB, 'Margarita', VB, [line('tequila', 50, 't1')]) };
    mount(`/cocktails?open=${CB}`);
    const sheet = await screen.findByRole('region', { name: 'Recipe for Margarita' });
    const cards = await within(sheet).findByTestId('drink-cards');
    expect(within(cards).getByTestId('drink-card-cost')).toHaveTextContent('₺10.00');
    expect(within(cards).getByTestId('drink-card-price')).toHaveTextContent('₺450.00');
    // Order on the page: cards, then the nutrition card (here: said as not read), then the lines.
    const order = [cards, within(sheet).getByTestId('recipe-whatisin-unread'), within(sheet).getAllByTestId('recipe-line')[0]];
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(screen.queryByRole('region', { name: 'Recipe for Negroni' })).toBeNull();
  });

  it('a drink opened from a link, then closed, opens again when the same link is followed again', async () => {
    h.recipes = { [CB]: recipe(CB, 'Margarita', VB, [line('tequila', 50, 't1')]) };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    function Where() {
      const l = useLocation();
      return <output data-testid="where">{`${l.pathname}${l.search}`}</output>;
    }
    render(
      <MemoryRouter initialEntries={[`/cocktails?open=${CB}`]}>
        <QueryClientProvider client={qc}>
          <CocktailRegister register={null} registerLoading={false} />
          <Link to={`/cocktails?open=${CB}`}>used in Margarita</Link>
          <Where />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('region', { name: 'Recipe for Margarita' })).toBeInTheDocument();
    // Closing the linked drink takes its name out of the address, so the address says what is open.
    open('Margarita');
    await waitFor(() => expect(screen.queryByTestId('cocktail-leaf')).toBeNull());
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/cocktails$/);
    // The same link again opens it again; before, the search was unchanged and nothing opened.
    fireEvent.click(screen.getByRole('link', { name: 'used in Margarita' }));
    expect(await screen.findByRole('region', { name: 'Recipe for Margarita' })).toBeInTheDocument();
  });

  it('opening another drink while a linked one is open drops the link from the address', async () => {
    h.recipes = {
      [CA]: recipe(CA, 'Negroni', VA, [line('gin', 30, 'g1')]),
      [CB]: recipe(CB, 'Margarita', VB, [line('tequila', 50, 't1')]),
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    function Where() {
      const l = useLocation();
      return <output data-testid="where">{`${l.pathname}${l.search}`}</output>;
    }
    render(
      <MemoryRouter initialEntries={[`/cocktails?open=${CB}&q=keep`]}>
        <QueryClientProvider client={qc}>
          <CocktailRegister register={null} registerLoading={false} />
          <Where />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await screen.findByRole('region', { name: 'Recipe for Margarita' });
    open('Negroni');
    expect(await screen.findByRole('region', { name: 'Recipe for Negroni' })).toBeInTheDocument();
    // Only the drink's name leaves the address; anything else in it stays.
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/cocktails\?q=keep$/);
  });

  it('a link to a drink this house does not list says so, and opens nothing', async () => {
    mount('/cocktails?open=ffffffff-ffff-4fff-8fff-ffffffffffff');
    expect(await screen.findByTestId('cocktails-link-missing')).toHaveTextContent('not on this house’s list');
    expect(screen.queryByTestId('cocktail-leaf')).toBeNull();
  });

  it('opening another drink with unsaved lines shows that drink, and Save sends its own lines to it', async () => {
    h.recipes = {
      [CA]: recipe(CA, 'Negroni', VA, [line('gin', 30, 'g1'), line('Campari', 30, 'c1'), line('vermouth', 30, 'v1')]),
      [CB]: recipe(CB, 'Margarita', VB, [line('tequila', 50, 't1')]),
    };
    mount();
    open('Negroni');
    await screen.findByRole('region', { name: 'Recipe for Negroni' });
    await waitFor(() => expect(amounts()).toHaveLength(3));
    fireEvent.change(amounts()[0], { target: { value: '45' } });

    open('Margarita');
    await screen.findByRole('region', { name: 'Recipe for Margarita' });
    await waitFor(() => expect(amounts()).toHaveLength(1));
    expect(amounts()[0].value).toBe('50');

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    const [url, body] = h.put.mock.calls[0];
    expect(url).toBe(`/recipes/${RID}/cocktails/${CB}`);
    expect(body.expectedVersionId).toBe(VB);
    expect(body.lines).toEqual([{ role: 'stocked', inventoryId: 't1', label: 'tequila', qty: 50, unit: 'ml' }]);
  });

  it('two drinks with no recipe yet: lines typed for one never appear on the other', async () => {
    h.recipes = { [CA]: recipe(CA, 'Negroni', null, []), [CB]: recipe(CB, 'Margarita', null, []) };
    mount();
    open('Negroni');
    fireEvent.click(await screen.findByRole('button', { name: /add an ingredient/i }));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '45' } });

    open('Margarita');
    await screen.findByRole('region', { name: 'Recipe for Margarita' });
    expect(screen.queryAllByLabelText('Amount')).toHaveLength(0);
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    expect(h.put).not.toHaveBeenCalled();
  });

  it('round 19: back on the first drink, its unsaved lines are there and said as unsaved', async () => {
    h.recipes = {
      [CA]: recipe(CA, 'Negroni', VA, [line('gin', 30, 'g1'), line('Campari', 30, 'c1'), line('vermouth', 30, 'v1')]),
      [CB]: recipe(CB, 'Margarita', VB, [line('tequila', 50, 't1')]),
    };
    mount();
    open('Negroni');
    await screen.findByRole('region', { name: 'Recipe for Negroni' });
    await waitFor(() => expect(amounts()).toHaveLength(3));
    fireEvent.change(amounts()[0], { target: { value: '45' } });
    open('Margarita');
    await screen.findByRole('region', { name: 'Recipe for Margarita' });
    open('Negroni');
    await screen.findByRole('region', { name: 'Recipe for Negroni' });
    await waitFor(() => expect(amounts()).toHaveLength(3));
    expect(amounts()[0].value).toBe('45');
    expect(screen.getByTestId('recipe-restored')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    expect(h.put.mock.calls[0][0]).toBe(`/recipes/${RID}/cocktails/${CA}`);
    expect(h.put.mock.calls[0][1].expectedVersionId).toBe(VA);
  });
});
