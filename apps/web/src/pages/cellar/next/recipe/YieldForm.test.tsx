/**
 * r106 drinks-3: the screen that sets a dish's batch yield (PATCH
 * /recipes/:house/dishes/:dish/yield, #2067). Owner and manager only; an
 * amount above zero; the unit list; the gateway's refusal said as it sent it.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const RID = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const V1 = '44444444-4444-4444-8444-444444444444';

const h = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn(), auth: {} as Record<string, unknown> }));

vi.mock('../../../../services/api/client', () => ({
  apiClient: { get: h.get, put: h.put, post: h.post, patch: h.patch },
  getErrorStatus: () => null,
}));
vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => h.auth }));

import RecipeSheet from './RecipeSheet';
import YieldForm, { yieldWords } from './YieldForm';
import { forgetDrafts } from './drafts';

const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => {
  for (const f of [h.get, h.put, h.post, h.patch]) f.mockReset();
  h.auth = { activeRestaurantId: RID, activeRole: 'manager', user: { userId: 'u1', role: 'manager' } };
  forgetDrafts();
});

const button = () => screen.getByRole('button', { name: /save what a batch makes/i });

describe('YieldForm', () => {
  it('sends the amount and unit to the yield route and says every recipe is priced again', async () => {
    h.patch.mockResolvedValue({ data: { id: ID, name: 'House Sour Mix', yield: { amount: 700, unit: 'ml', qtyBase: 7000, baseUnit: 'ml10' } } });
    render(<YieldForm dishId={ID} current={null} />, { wrapper: wrap });
    fireEvent.change(screen.getByLabelText(/one batch makes/i), { target: { value: '700' } });
    fireEvent.click(button());
    await waitFor(() => expect(h.patch).toHaveBeenCalledTimes(1));
    expect(h.patch).toHaveBeenCalledWith(`/recipes/${RID}/dishes/${ID}/yield`, { amount: 700, unit: 'ml' });
    expect(await screen.findByTestId('yield-said')).toHaveTextContent('One batch makes 700 ml. Every recipe that draws it is priced again.');
  });

  it('will not send nothing, zero or a word, and lists the gateway\'s units', () => {
    render(<YieldForm dishId={ID} current={null} />, { wrapper: wrap });
    expect(button()).toBeDisabled();
    for (const bad of ['0', 'abc', '-3']) {
      fireEvent.change(screen.getByLabelText(/one batch makes/i), { target: { value: bad } });
      expect(button()).toBeDisabled();
    }
    const units = screen.getAllByRole('option').map((o) => o.textContent);
    expect(units).toEqual(['ml', 'cl', 'l', 'US oz', 'tsp', 'tbsp', 'dash', 'barspoon', 'g', 'kg', 'each']);
    expect(h.patch).not.toHaveBeenCalled();
  });

  it('shows the gateway\'s refusal in its own words and keeps what was typed', async () => {
    const sentence = 'This is made in millilitres, and a recipe in use draws it in millilitres. Take it out of those recipes before changing what kind of unit it is made in. Nothing was changed.';
    h.patch.mockRejectedValue(Object.assign(new Error('Request failed'), { response: { status: 400, data: { message: sentence } } }));
    render(<YieldForm dishId={ID} current={{ qtyBase: 7000, baseUnit: 'ml10' }} />, { wrapper: wrap });
    expect((screen.getByLabelText(/one batch makes/i) as HTMLInputElement).value).toBe('700');
    fireEvent.change(screen.getByLabelText(/^unit$/i), { target: { value: 'g' } });
    fireEvent.click(button());
    expect(await screen.findByRole('alert')).toHaveTextContent(sentence);
    expect((screen.getByLabelText(/one batch makes/i) as HTMLInputElement).value).toBe('700');
  });

  it('reads a stored batch back in its own unit', () => {
    expect(yieldWords({ qtyBase: 7000, baseUnit: 'ml10' })).toBe('700 ml');
    expect(yieldWords({ qtyBase: 1_500_000, baseUnit: 'mg' })).toBe('1500 g');
    expect(yieldWords(null)).toBeNull();
  });
});

describe('on a dish\'s recipe sheet', () => {
  const answer = {
    dish: { id: ID, name: 'House Sour Mix', section: null, price: null, description: null },
    current: { versionId: V1, version: 1, yieldServes: 1, method: null, glass: null, garnish: null, createdAt: '', lines: [] },
    cost: null,
    versionCount: 1,
    legacyLines: [],
    yield: { qtyBase: 7000, baseUnit: 'ml10' },
  };
  const serve = () =>
    h.get.mockImplementation(async (url: string) => {
      if (url === `/recipes/${RID}/dishes/${ID}`) return { data: answer };
      if (url === `/recipes/${RID}/shelf`) return { data: [] };
      if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'TRY', country: 'Turkey', readable: true, reason: null, statedAt: null } };
      throw new Error(`unexpected GET ${url}`);
    });

  it('an owner or manager sees the form, with the saved batch in it', async () => {
    serve();
    render(<RecipeSheet dishId={ID} />, { wrapper: wrap });
    expect(await screen.findByTestId('yield-form')).toBeInTheDocument();
    expect((screen.getByLabelText(/one batch makes/i) as HTMLInputElement).value).toBe('700');
  });

  it('staff do not see it', async () => {
    h.auth = { activeRestaurantId: RID, activeRole: 'staff', user: { role: 'staff' } };
    serve();
    render(<RecipeSheet dishId={ID} />, { wrapper: wrap });
    // The sheet has read the dish (its Ingredients card is drawn) before the form's absence means anything.
    await screen.findByText(/from your shelf/);
    expect(screen.queryByTestId('yield-form')).toBeNull();
  });
});
