/**
 * /dishes: the current menu's dishes offered onto the list in one step
 * (r28 onboarding audit, gap 1, slice 3). Through the real page, the real
 * query hooks and the real API module; only the HTTP client is stubbed.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { addedWords, someNames } from './MenuDishesOffer';

const RID = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OFFER = `/recipes/${RID}/dishes/from-menu`;
const LIST = `/recipes/${RID}/dishes`;

type Offer = { name: string; section: string | null; price: number | null; pricesDiffer: boolean };
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  role: 'owner',
  offer: [] as Offer[] | Error,
  list: [] as unknown[],
  status: null as number | null,
  current: 1,
}));
vi.mock('../../services/api/client', () => ({
  apiClient: { get: h.get, post: h.post, put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorStatus: () => h.status,
}));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: RID, activeRole: h.role, user: { userId: 'u1', role: h.role } }),
}));

import DishesPage from './DishesPage';

const dish = (name: string, section: string | null, price: number | null, pricesDiffer = false): Offer => ({ name, section, price, pricesDiffer });

beforeEach(() => {
  h.role = 'owner';
  h.status = null;
  h.current = 1;
  h.list = [];
  h.offer = [dish('Adana kebap', 'Mains', 420), dish('Mercimek çorbası', 'Soups', 160), dish('Pide', null, null, true), dish('Baklava', 'Desserts', 140)];
  h.post.mockReset();
  h.get.mockReset().mockImplementation(async (url: string) => {
    if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'TRY', country: 'Turkey', readable: true, reason: null, statedAt: null } };
    if (url === LIST) return { data: h.list };
    if (url === `/recipes/${RID}/menu-prices`) return { data: { amountsWithheld: false, currentMenus: 1, dishes: [], drinks: [] } };
    if (url === OFFER) {
      if (h.offer instanceof Error) throw h.offer;
      return { data: { currentMenus: h.current, dishes: h.offer } };
    }
    throw new Error(`unexpected GET ${url}`);
  });
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/dishes']}>
        <DishesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const offerReads = () => h.get.mock.calls.filter(([u]) => u === OFFER).length;

describe('/dishes offers the menu’s dishes', () => {
  it('says how many menu dishes are not listed, names the first few, and says which come with no price', async () => {
    mount();
    expect(await screen.findByText('Your menu has 4 dishes not on this list yet: Adana kebap, Mercimek çorbası, Pide and 1 more.')).toBeInTheDocument();
    expect(screen.getByText(/Each comes with the menu’s section and price\. Its recipe is added on the dish itself\. Pide comes with no price, because the menu gives it two\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add the menu’s 4 dishes' })).toBeEnabled();
  });

  it('sends exactly the names it showed, then reads the list and the offer again', async () => {
    h.post.mockImplementation(async () => {
      h.list = [{ id: A, name: 'Adana kebap', section: 'Mains', price: 420, hasRecipe: false, yieldServes: null, lineCount: 0, cost: null }];
      h.offer = [];
      return { data: { added: [{ id: A, name: 'Adana kebap' }, { id: 'b', name: 'x' }, { id: 'c', name: 'y' }, { id: 'd', name: 'z' }], already: [], notAdded: [], notOffered: [] } };
    });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Add the menu’s 4 dishes' }));
    expect(h.post).toHaveBeenCalledWith(OFFER, { names: ['Adana kebap', 'Mercimek çorbası', 'Pide', 'Baklava'] });
    expect(await screen.findByRole('status')).toHaveTextContent('4 dishes put on your list from the menu.');
    await waitFor(() => expect(screen.getByTestId(`dish-row-${A}`)).toBeInTheDocument());
    expect(offerReads()).toBe(2);
    expect(screen.queryByRole('button', { name: /from the menu|menu’s/ })).toBeNull();
  });

  it('names a single dish as one', async () => {
    h.offer = [dish('Adana kebap', 'Mains', 420)];
    mount();
    expect(await screen.findByText('Your menu has 1 dish not on this list yet: Adana kebap.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add this dish from the menu' })).toBeInTheDocument();
    expect(screen.queryByText(/with no price/)).toBeNull();
  });

  it('says a stopped run as an alert, naming what is not on the list', async () => {
    h.post.mockResolvedValue({ data: { added: [{ id: A, name: 'Adana kebap' }], already: ['Pide'], notAdded: ['Mercimek çorbası', 'Baklava'], notOffered: [] } });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Add the menu’s 4 dishes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '1 dish put on your list from the menu. Pide was already on it. Mercimek çorbası and Baklava could not be saved just now and are not on your list. Add them again below.',
    );
  });

  it('says a refusal as nothing added, and an unanswered write as unknown', async () => {
    h.status = 403;
    h.post.mockRejectedValueOnce(Object.assign(new Error('x'), { response: { data: { message: 'Forbidden resource' } } }));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Add the menu’s 4 dishes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was added: Forbidden resource');

    h.status = null;
    h.post.mockRejectedValueOnce(new Error('Network Error'));
    const before = offerReads();
    await userEvent.click(screen.getByRole('button', { name: 'Add the menu’s 4 dishes' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('We could not tell whether the menu’s dishes were added: no answer came back. Your list is read again below.'));
    await waitFor(() => expect(offerReads()).toBeGreaterThan(before));
  });

  it('says an unread offer in one line, never as nothing to add', async () => {
    h.offer = new Error('503');
    mount();
    expect(await screen.findByTestId('menu-dishes-unread')).toHaveTextContent('Your menu’s dishes could not be read just now, so none is offered here.');
    expect(screen.queryByRole('button', { name: /menu’s/ })).toBeNull();
  });

  it('offers nothing when every menu dish is listed, two menus current or one', async () => {
    h.current = 2;
    h.offer = [];
    mount();
    await screen.findByTestId('dishes-empty');
    await waitFor(() => expect(offerReads()).toBe(1));
    expect(screen.queryByTestId('menu-dishes-unread')).toBeNull();
    expect(screen.queryByTestId('menu-dishes-no-menu')).toBeNull();
    expect(screen.queryByText(/Your menu has/)).toBeNull();
  });

  it('says no menu is current, and points at Menu, rather than offering nothing', async () => {
    h.current = 0;
    h.offer = [];
    mount();
    const said = await screen.findByTestId('menu-dishes-no-menu');
    expect(said).toHaveTextContent('No menu is current yet, so none of its dishes is offered here. Choose your menu on Menu.');
    expect(screen.getByRole('link', { name: 'Menu' })).toHaveAttribute('href', '/menu');
  });

  it('is not read or shown for staff', async () => {
    h.role = 'staff';
    mount();
    await screen.findByTestId('dishes-empty');
    expect(offerReads()).toBe(0);
    expect(screen.queryByTestId('menu-dishes-offer')).toBeNull();
  });
});

describe('the offer’s words', () => {
  it('lists names the way a sentence does', () => {
    expect(someNames(['A'])).toBe('A');
    expect(someNames(['A', 'B'])).toBe('A and B');
    expect(someNames(['A', 'B', 'C'])).toBe('A, B and C');
    expect(someNames(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C and 2 more');
  });

  it('says what was not offered, and says nothing added when nothing was', () => {
    expect(addedWords({ added: [], already: [], notAdded: [], notOffered: ['Pide'] })).toBe(
      'Pide: no longer offered (listed meanwhile, or gone from the menu), so not added.',
    );
    expect(addedWords({ added: [], already: [], notAdded: [], notOffered: [] })).toBe('Nothing was added.');
    expect(addedWords({ added: [], already: ['A', 'B'], notAdded: ['C'], notOffered: [] })).toBe(
      'A and B were already on it. C could not be saved just now and is not on your list. Add it again below.',
    );
  });
});
