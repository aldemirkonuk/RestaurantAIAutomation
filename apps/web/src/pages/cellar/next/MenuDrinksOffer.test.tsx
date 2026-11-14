/**
 * /cocktails: the current menu's cocktails offered onto the list in one step
 * (r36 recipes audit, gap 3). Through the real register, the real offer, the
 * real query hooks and the real API module; only the HTTP client and the
 * register's own list hook are stubbed.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { drinksAddedWords } from './MenuDrinksOffer';

const RID = '11111111-1111-4111-8111-111111111111';
const OFFER = `/recipes/${RID}/drinks/from-menu`;
const MENU = `/recipes/${RID}/menu-prices`;

type Offer = { name: string; section: string | null; price: number | null; pricesDiffer: boolean };
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  role: 'owner',
  offer: [] as Offer[] | Error,
  status: null as number | null,
  current: 1,
}));
vi.mock('../../../services/api/client', () => ({
  apiClient: { get: h.get, post: h.post, put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorStatus: () => h.status,
}));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: RID, activeRole: h.role, user: { userId: 'u1', role: h.role } }),
}));
vi.mock('./recipe/RecipeSheet', () => ({ default: () => <div data-testid="sheet" /> }));
vi.mock('./useCellarNextData', () => ({
  useCocktailRegister: () => ({
    data: { rows: [], count: 0, truncated: false, referenceRows: 0, recipesAvailable: true, scopeNote: '' },
    loading: false,
    error: null,
  }),
  useCocktailWrites: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    amend: { mutateAsync: vi.fn(), isPending: false },
    retire: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

import CocktailRegister from './CocktailRegister';

const drink = (name: string, section: string | null, price: number | null, pricesDiffer = false): Offer => ({ name, section, price, pricesDiffer });

beforeEach(() => {
  h.role = 'owner';
  h.status = null;
  h.current = 1;
  h.offer = [drink('Negroni', 'Aperitivo', 12), drink('Margarita', null, 11), drink('Mojito', null, null, true), drink('Rakı sour', null, 280)];
  h.post.mockReset();
  h.get.mockReset().mockImplementation(async (url: string) => {
    if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'TRY', country: 'Turkey', readable: true, reason: null, statedAt: null } };
    if (url === `/recipes/${RID}/drinks/figures`) return { data: { drinks: [] } };
    if (url === MENU) return { data: { amountsWithheld: false, currentMenus: 1, dishes: [], drinks: [] } };
    if (url === OFFER) {
      if (h.offer instanceof Error) throw h.offer;
      return { data: { currentMenus: h.current, drinks: h.offer } };
    }
    throw new Error(`unexpected GET ${url}`);
  });
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/cocktails']}>
        <CocktailRegister register={null} registerLoading={false} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const reads = (url: string) => h.get.mock.calls.filter(([u]) => u === url).length;

describe('/cocktails offers the menu’s cocktails', () => {
  it('says how many menu cocktails are not listed, names the first few, and which come with no price', async () => {
    mount();
    expect(await screen.findByText('Your menu has 4 cocktails not on this list yet: Negroni, Margarita, Mojito and 1 more.')).toBeInTheDocument();
    expect(
      screen.getByText(/Its recipe is added on the drink itself, and its pour cost comes from that\. Mojito comes with no price, because the menu gives it two\./),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add the menu’s 4 cocktails' })).toBeEnabled();
  });

  it('sends exactly the names it showed, then reads the offer and the Menu column again', async () => {
    h.post.mockImplementation(async () => {
      h.offer = [];
      return { data: { added: ['a', 'b', 'c', 'd'].map((id, i) => ({ id, name: `x${i}` })), already: [], notAdded: [], notOffered: [] } };
    });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Add the menu’s 4 cocktails' }));
    expect(h.post).toHaveBeenCalledWith(OFFER, { names: ['Negroni', 'Margarita', 'Mojito', 'Rakı sour'] });
    expect(await screen.findByTestId('menu-drinks-said')).toHaveTextContent(
      '4 cocktails put on your list from the menu. Open one to add its recipe and see its pour cost.',
    );
    expect(screen.getByTestId('menu-drinks-said')).toHaveAttribute('role', 'status');
    await waitFor(() => expect(reads(OFFER)).toBe(2));
    await waitFor(() => expect(reads(MENU)).toBe(2));
    expect(screen.queryByRole('button', { name: /menu’s|from the menu/ })).toBeNull();
  });

  it('sends at most 500 names in one run, the gateway’s limit', async () => {
    h.offer = Array.from({ length: 501 }, (_, i) => drink(`Drink ${i}`, null, 1));
    h.post.mockResolvedValue({ data: { added: [], already: [], notAdded: [], notOffered: [] } });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Add the menu’s 501 cocktails' }));
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(1));
    expect(h.post.mock.calls[0][1].names).toHaveLength(500);
  });

  it('names a single cocktail as one', async () => {
    h.offer = [drink('Negroni', null, 12)];
    mount();
    expect(await screen.findByText('Your menu has 1 cocktail not on this list yet: Negroni.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add this cocktail from the menu' })).toBeInTheDocument();
    expect(screen.queryByText(/with no price/)).toBeNull();
  });

  it('says a refusal as nothing added, and an unanswered write as unknown', async () => {
    h.status = 503;
    h.post.mockRejectedValueOnce(
      Object.assign(new Error('x'), { response: { data: { message: 'The menu’s cocktails could not be saved just now. None was added; try again.' } } }),
    );
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Add the menu’s 4 cocktails' }));
    expect(await screen.findByTestId('menu-drinks-said')).toHaveTextContent('Nothing was added: The menu’s cocktails could not be saved just now. None was added; try again.');
    expect(screen.getByTestId('menu-drinks-said')).toHaveAttribute('role', 'alert');

    h.status = null;
    h.post.mockRejectedValueOnce(new Error('Network Error'));
    const before = reads(OFFER);
    await userEvent.click(screen.getByRole('button', { name: 'Add the menu’s 4 cocktails' }));
    await waitFor(() =>
      expect(screen.getByTestId('menu-drinks-said')).toHaveTextContent(
        'We could not tell whether the menu’s cocktails were added: no answer came back. Your list is read again below.',
      ),
    );
    await waitFor(() => expect(reads(OFFER)).toBeGreaterThan(before));
  });

  it('says an unread offer in one line, never as nothing to add', async () => {
    h.offer = new Error('503');
    mount();
    expect(await screen.findByTestId('menu-drinks-unread')).toHaveTextContent('Your menu’s cocktails could not be read just now, so none is offered here.');
    expect(screen.queryByRole('button', { name: /menu’s/ })).toBeNull();
  });

  it('offers nothing when every menu cocktail is listed', async () => {
    h.offer = [];
    mount();
    await waitFor(() => expect(reads(OFFER)).toBe(1));
    expect(await screen.findByTestId('menu-drinks-offer')).toBeEmptyDOMElement();
  });

  it('says no menu is current, and points at Menu', async () => {
    h.current = 0;
    h.offer = [];
    mount();
    expect(await screen.findByTestId('menu-drinks-no-menu')).toHaveTextContent(
      'No menu is current yet, so none of its cocktails is offered here. Choose your menu on Menu.',
    );
    expect(screen.getByRole('link', { name: 'Menu' })).toHaveAttribute('href', '/menu');
  });

  it.each(['staff', 'server'])('is not read or shown for %s', async (role) => {
    h.role = role;
    mount();
    await screen.findByTestId('cocktail-register');
    await new Promise((r) => setTimeout(r, 20));
    expect(reads(OFFER)).toBe(0);
    expect(screen.queryByTestId('menu-drinks-offer')).toBeNull();
  });

  it('is shown to a manager', async () => {
    h.role = 'manager';
    mount();
    expect(await screen.findByRole('button', { name: 'Add the menu’s 4 cocktails' })).toBeInTheDocument();
  });
});

describe('the drinks offer’s words', () => {
  it('says what was already listed, not offered, or not saved, and nothing added when nothing was', () => {
    expect(drinksAddedWords({ added: [], already: [], notAdded: [], notOffered: [] })).toBe('Nothing was added.');
    expect(drinksAddedWords({ added: [{ id: 'a', name: 'A' }], already: ['B'], notAdded: [], notOffered: ['C', 'D'] })).toBe(
      '1 cocktail put on your list from the menu. Open one to add its recipe and see its pour cost. B was already on it. C and D: no longer offered (listed meanwhile, or gone from the menu), so not added.',
    );
    expect(drinksAddedWords({ added: [], already: [], notAdded: ['E', 'F'], notOffered: [] })).toBe(
      'E and F could not be saved just now and are not on your list.',
    );
  });
});
