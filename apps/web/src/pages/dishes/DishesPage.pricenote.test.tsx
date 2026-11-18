/**
 * An open dish's price box is read with the sentence under it: a price that
 * cannot be read, or a blank that saves no price, is named by the box itself
 * (aria-describedby), as the add form's box already does (r55 recipes audit).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const RID = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const h = vi.hoisted(() => ({ get: vi.fn(), auth: {} as Record<string, unknown> }));
vi.mock('../../services/api/client', () => ({
  apiClient: { get: h.get, post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorStatus: () => null,
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('../cellar/next/recipe/RecipeSheet', () => ({ default: () => <div data-testid="sheet" /> }));

import DishesPage from './DishesPage';
import { PRICE_UNREAD } from '../cellar/next/recipe/price-text';

const list = [
  { id: A, name: 'Lamb shank', section: 'Mains', price: 900, hasRecipe: true, yieldServes: 1, lineCount: 1, cost: null },
  { id: B, name: 'Mezze', section: 'Starters', price: null, hasRecipe: true, yieldServes: 1, lineCount: 1, cost: null },
];

beforeEach(() => {
  h.auth = { activeRestaurantId: RID, activeRole: 'manager', user: { userId: 'u1', role: 'manager' } };
  h.get.mockReset().mockImplementation(async (url: string) => {
    if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'TRY', country: 'Turkey', readable: true, reason: null, statedAt: null } };
    if (url === `/recipes/${RID}/dishes/figures`) return { data: { costsUnread: false, dishes: [] } };
    if (url === `/recipes/${RID}/dishes`) return { data: list };
    throw new Error(`unexpected GET ${url}`);
  });
});

async function openDish(id = A) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/dishes?open=${id}`]}>
        <DishesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const form = await screen.findByTestId(`dish-details-${id}`);
  return { form, price: within(form).getByLabelText('Price') as HTMLInputElement };
}

/** The text the box is described by, or null when it is described by nothing. */
const describedBy = (box: HTMLElement) => {
  const id = box.getAttribute('aria-describedby');
  return id ? (document.getElementById(id)?.textContent ?? '') : null;
};

describe('an open dish’s price box', () => {
  it('is described by the sentence that says the price cannot be read', async () => {
    const { price } = await openDish();
    expect(describedBy(price)).toBeNull();
    fireEvent.change(price, { target: { value: '12,5x' } });
    expect(price).toHaveAttribute('aria-invalid', 'true');
    expect(describedBy(price)).toBe(PRICE_UNREAD);
  });

  it('is described by the sentence that a blank price saves no price', async () => {
    const { price } = await openDish();
    fireEvent.change(price, { target: { value: '' } });
    expect(describedBy(price)).toBe('A blank price saves the dish with no price.');
  });

  it('is described by nothing when a dish with no price is left blank', async () => {
    const { price } = await openDish(B);
    fireEvent.change(price, { target: { value: '' } });
    expect(price).not.toHaveAttribute('aria-describedby');
  });

  it('is described by nothing once the price reads again', async () => {
    const { price } = await openDish();
    fireEvent.change(price, { target: { value: '12,5x' } });
    fireEvent.change(price, { target: { value: '12,50' } });
    expect(price).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText(PRICE_UNREAD)).toBeNull();
  });
});
