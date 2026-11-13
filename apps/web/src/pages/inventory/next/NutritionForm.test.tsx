/**
 * Editing "What's in it" (NutritionForm): an empty box is sent as null, never
 * 0; a lookup that could not reach Open Food Facts says so in words and fills
 * nothing; a lookup draft is saved only when the person presses Save.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ALLERGENS, type ItemNutrition, type StoredNutrition } from '../../../services/api/inventory';

const api = vi.hoisted(() => ({ save: vi.fn(), lookup: vi.fn() }));
vi.mock('../../../services/api/inventory', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  saveItemNutrition: api.save,
  lookupItemNutrition: api.lookup,
}));

import NutritionForm, { LOOKUP_UNREACHED, readFigure } from './NutritionForm';

const stored: StoredNutrition = {
  basis: '100g',
  energyKcal: 350,
  fatG: 28,
  saturatesG: null,
  carbohydrateG: null,
  sugarsG: null,
  proteinG: 22,
  saltG: null,
  abvPct: null,
  energyFromAbv: false,
  source: 'pack_label',
  sourceRef: null,
  statedByName: 'Ayşe',
  statedAt: '2026-11-07T10:00:00Z',
};

const answer = (figures: StoredNutrition | null): ItemNutrition => ({
  item: { id: 'i1', name: 'Tulum cheese', kind: 'food', uom: 'g' },
  suggestedBasis: '100g',
  figures,
  allergens: ALLERGENS.map((a) => ({ allergen: a, status: 'not_stated', statedByName: null, statedAt: null })),
});

const httpError = (status: number) => Object.assign(new Error(`status ${status}`), { response: { status, data: {} } });

function show(data: ItemNutrition, startWithLookup = false) {
  const onDone = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <NutritionForm restaurantId="r1" itemId="i1" data={data} startWithLookup={startWithLookup} onDone={onDone} />
    </QueryClientProvider>,
  );
  return onDone;
}

beforeEach(() => {
  api.save.mockReset();
  api.lookup.mockReset();
});

describe('editing what is in it', () => {
  it('sends an empty box as null, never 0', async () => {
    api.save.mockResolvedValue(answer(stored));
    const onDone = show(answer(stored));
    fireEvent.change(screen.getByLabelText('Salt (g)'), { target: { value: '1,5' } });
    fireEvent.change(screen.getByLabelText('Fat (g)'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    const [itemId, body, rid] = api.save.mock.calls[0];
    expect([itemId, rid]).toEqual(['i1', 'r1']);
    expect(body.figures.basis).toBe('100g');
    expect(body.figures.saltG).toBe(1.5);
    expect(body.figures.fatG).toBeNull();
    expect(body.figures.sugarsG).toBeNull();
    expect(body.allergens).toHaveLength(14);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('reads a box: empty is not known, a comma is a decimal point, a word is refused', () => {
    expect(readFigure('')).toBeNull();
    expect(readFigure(' 2,5 ')).toBe(2.5);
    expect(readFigure('0')).toBe(0);
    expect(readFigure('abc')).toBe('bad');
    expect(readFigure('-1')).toBe('bad');
  });
});

describe('the label lookup', () => {
  function lookUp(text: string) {
    fireEvent.change(screen.getByLabelText('Barcode or name'), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: 'Look it up' }));
  }

  it('says Open Food Facts could not be reached, in words, and fills nothing', async () => {
    api.lookup.mockRejectedValue(httpError(502));
    show(answer(null), true);
    lookUp('8690000000001');
    expect((await screen.findByTestId('ivn-lookup-said')).textContent).toBe(LOOKUP_UNREACHED);
    expect(api.lookup).toHaveBeenCalledWith('i1', { barcode: '8690000000001' }, 'r1');
    expect(screen.queryByTestId('ivn-draft')).toBeNull();
    expect(api.save).not.toHaveBeenCalled();
  });

  it('fills a draft that is saved only on Save, with its source, and keeps a missing figure null', async () => {
    api.lookup.mockResolvedValue({
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
    });
    api.save.mockResolvedValue(answer(null));
    show(answer(null), true);
    lookUp('ayran');
    expect((await screen.findByTestId('ivn-draft')).textContent).toContain('nothing is saved until you press Save');
    expect(api.lookup).toHaveBeenCalledWith('i1', { name: 'ayran' }, 'r1');
    expect(api.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    const [, body] = api.save.mock.calls[0];
    expect(body.figures).toMatchObject({ basis: '100ml', source: 'open_food_facts', sourceRef: '8690000000001', energyKcal: 38, saltG: null });
    expect(body.allergens.find((a: { allergen: string }) => a.allergen === 'milk').status).toBe('contains');
    expect(body.allergens.find((a: { allergen: string }) => a.allergen === 'gluten').status).toBe('not_stated');
  });
});

describe('checking the figures (#938)', () => {
  const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

  it('refuses Save when protein, fat, carbohydrate and salt weigh more than 100 g in 100 g', () => {
    show(answer(null));
    type('Protein (g)', '60');
    type('Fat (g)', '30');
    type('Carbohydrate (g)', '30');
    expect(screen.getByText(/add up to 120 g, which is more than 100 g/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.save).not.toHaveBeenCalled();
  });

  it('warns, but still lets the house save, when the energy disagrees with 4/4/9', async () => {
    api.save.mockResolvedValue(answer(null));
    show(answer(null));
    type('Energy (kcal)', '10');
    type('Protein (g)', '20');
    type('Fat (g)', '50');
    type('Carbohydrate (g)', '30');
    expect(screen.getByTestId('ivn-kcal-warning').textContent).toContain('about 650 kcal');
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
  });

  it('does not warn when the energy agrees, nor when a macro is not stated', () => {
    show(answer(null));
    type('Energy (kcal)', '640');
    type('Protein (g)', '20');
    type('Fat (g)', '50');
    type('Carbohydrate (g)', '30');
    expect(screen.queryByTestId('ivn-kcal-warning')).toBeNull();
    type('Carbohydrate (g)', '');
    expect(screen.queryByTestId('ivn-kcal-warning')).toBeNull();
  });

  it('shows a lookup draft that has no notes, instead of crashing', async () => {
    api.lookup.mockResolvedValue({
      kind: 'draft',
      draft: {
        source: 'open_food_facts',
        sourceRef: '1',
        productName: null,
        basis: '100g',
        figures: { energyKcal: null, fatG: null, saturatesG: null, carbohydrateG: null, sugarsG: null, proteinG: null, saltG: null, abvPct: null },
        allergens: [],
        attribution: 'From Open Food Facts.',
      },
    });
    show(answer(null), true);
    fireEvent.change(screen.getByLabelText('Barcode or name'), { target: { value: 'ayran' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look it up' }));
    expect(await screen.findByTestId('ivn-draft')).toBeTruthy();
  });
});
