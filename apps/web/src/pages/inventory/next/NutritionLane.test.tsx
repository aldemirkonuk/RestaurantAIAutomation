/**
 * "Fill what's in it" (r108 inventory g14): one good at a time, looked up only
 * when its step opens, saved only on Save, never for staff, and a failed lookup
 * says it could not be reached and leaves the form to type, never 0.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ALLERGENS, type ItemNutrition, type NutritionLookup } from '../../../services/api/inventory';

const api = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), lookup: vi.fn() }));
vi.mock('../../../services/api/inventory', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getItemNutrition: api.read,
  saveItemNutrition: api.save,
  lookupItemNutrition: api.lookup,
}));

import NutritionLane, { LANE_SENDS_NAMES, LANE_UNREACHED } from './NutritionLane';

const GOODS = [
  { id: 'i1', name: 'Ayran' },
  { id: 'i2', name: 'Tulum cheese' },
  { id: 'i3', name: 'Simit' },
];
const empty = (id: string): ItemNutrition => ({
  item: { id, name: id, kind: 'food', uom: 'g' },
  suggestedBasis: '100g',
  figures: null,
  allergens: ALLERGENS.map((a) => ({ allergen: a, status: 'not_stated', statedByName: null, statedAt: null })),
});
const draft: NutritionLookup = {
  kind: 'draft',
  draft: {
    source: 'open_food_facts',
    sourceRef: '8690000000001',
    productName: 'Ayran · Sütaş',
    basis: '100ml',
    figures: { energyKcal: 38, fatG: 1.8, saturatesG: null, carbohydrateG: 2.6, sugarsG: null, proteinG: 1.7, saltG: null, abvPct: null },
    allergens: [{ allergen: 'milk', status: 'contains' }],
    notes: [],
    attribution: 'From Open Food Facts (openfoodfacts.org), shared under the Open Database License.',
  },
};
const httpError = (status: number) => Object.assign(new Error(`status ${status}`), { response: { status, data: {} } });

function mount(canManage = true, onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <NutritionLane goods={GOODS} restaurantId="r1" canManage={canManage} onClose={onClose} />
    </QueryClientProvider>,
  );
}
const start = () => fireEvent.click(screen.getByRole('button', { name: 'Start with Ayran' }));
const press = (key: string) => act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));

beforeEach(() => {
  api.read.mockReset().mockImplementation((id: string) => Promise.resolve(empty(id)));
  api.save.mockReset();
  api.lookup.mockReset().mockResolvedValue(draft);
});

describe('the nutrition fill lane', () => {
  it('says once that names go to Open Food Facts and FoodData Central, and looks nothing up before a step opens', async () => {
    mount();
    expect(screen.getByTestId('ivn-lane-start').textContent).toContain(LANE_SENDS_NAMES);
    expect(api.lookup).not.toHaveBeenCalled();
    start();
    await screen.findByTestId('ivn-draft');
    // Only the step on screen is looked up, by its name; the next ones are not.
    expect(api.lookup).toHaveBeenCalledTimes(1);
    expect(api.lookup).toHaveBeenCalledWith('i1', { name: 'Ayran' }, 'r1');
    expect(screen.getByTestId('ivn-lane-source').textContent).toBe('From Open Food Facts.');
  });

  it('Save sends the draft only on the press, then counts it and moves on', async () => {
    api.save.mockImplementation((id: string) => Promise.resolve(empty(id)));
    mount();
    start();
    await screen.findByTestId('ivn-draft');
    expect(api.save).not.toHaveBeenCalled();
    expect(screen.getByTestId('ivn-lane-count').textContent).toBe('0 of 3 filled');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    const [id, body] = api.save.mock.calls[0];
    expect(id).toBe('i1');
    expect(body.figures).toMatchObject({ source: 'open_food_facts', energyKcal: 38, saltG: null });
    await waitFor(() => expect(screen.getByTestId('ivn-lane-count').textContent).toBe('1 of 3 filled'));
    expect(await screen.findByText('Tulum cheese')).toBeTruthy();
  });

  it('Skip saves nothing; J and K move, and going back does not send the name again', async () => {
    mount();
    start();
    await screen.findByTestId('ivn-draft');
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(api.lookup).toHaveBeenCalledWith('i2', { name: 'Tulum cheese' }, 'r1'));
    press('j');
    await waitFor(() => expect(api.lookup).toHaveBeenCalledWith('i3', { name: 'Simit' }, 'r1'));
    press('k');
    press('k');
    await screen.findByText('Ayran');
    expect(api.lookup).toHaveBeenCalledTimes(3);
    expect(api.save).not.toHaveBeenCalled();
    expect(screen.getByTestId('ivn-lane-count').textContent).toBe('0 of 3 filled');
  });

  it('a key typed in a box does not move the lane', async () => {
    mount();
    start();
    await screen.findByTestId('ivn-draft');
    const salt = screen.getByLabelText('Salt (g)');
    act(() => void salt.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true })));
    expect(screen.getByText('Ayran')).toBeTruthy();
    expect(api.lookup).toHaveBeenCalledTimes(1);
  });

  it('a failed lookup says it could not be reached and leaves the form to type, never 0', async () => {
    api.lookup.mockRejectedValue(httpError(502));
    mount();
    start();
    expect((await screen.findByTestId('ivn-lane-unreached')).textContent).toBe(LANE_UNREACHED);
    expect(screen.queryByTestId('ivn-draft')).toBeNull();
    expect((screen.getByLabelText('Energy (kcal)') as HTMLInputElement).value).toBe('');
    expect(api.save).not.toHaveBeenCalled();
  });

  it('staff cannot open it: nothing is drawn and nothing is read', () => {
    mount(false);
    expect(screen.queryByTestId('ivn-lane-start')).toBeNull();
    expect(api.read).not.toHaveBeenCalled();
    expect(api.lookup).not.toHaveBeenCalled();
  });

  it('a lookup never states an allergen free: the draft adds contains only', async () => {
    api.save.mockImplementation((id: string) => Promise.resolve(empty(id)));
    mount();
    start();
    await screen.findByTestId('ivn-draft');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    const statuses = api.save.mock.calls[0][1].allergens.map((a: { status: string }) => a.status);
    expect(statuses).not.toContain('free');
    expect(statuses).toContain('contains');
  });
});
