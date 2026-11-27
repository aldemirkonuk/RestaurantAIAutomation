/**
 * "What's in it" (NutritionCard): unknown is never shown as 0, every figure
 * says per 100 g or per 100 ml, a failed read is said, and staff read only.
 * Editing and the label lookup are in NutritionForm.test.tsx.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ALLERGENS, type ItemNutrition, type StoredNutrition } from '../../../services/api/inventory';

const api = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../services/api/inventory', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getItemNutrition: api.read,
}));

import NutritionCard from './NutritionCard';

const stored = (over: Partial<StoredNutrition> = {}): StoredNutrition => ({
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
  ...over,
});

const answer = (figures: StoredNutrition | null, stated: Partial<Record<string, string>> = {}): ItemNutrition => ({
  item: { id: 'i1', name: 'Tulum cheese', kind: 'food', uom: 'g' },
  suggestedBasis: '100g',
  figures,
  allergens: ALLERGENS.map((a) => ({
    allergen: a,
    status: (stated[a] ?? 'not_stated') as ItemNutrition['allergens'][number]['status'],
    statedByName: null,
    statedAt: null,
  })),
});

const httpError = (status: number) => Object.assign(new Error(`status ${status}`), { response: { status, data: {} } });

function show(canManage = true, sizeMl?: number | null, house?: { kind: string | null; uom: string | null }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NutritionCard row={{ id: 'i1', bottleSizeRecordedMl: sizeMl }} house={house} restaurantId="r1" canManage={canManage} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.read.mockReset();
});

describe('what is in it', () => {
  it('says "not known" for a figure nobody stated, never 0, and says per 100 g', async () => {
    api.read.mockResolvedValue(answer(stored(), { milk: 'contains', tree_nuts: 'may_contain' }));
    show();
    const figs = await screen.findByTestId('ivn-figures');
    expect(api.read).toHaveBeenCalledWith('i1', 'r1');
    expect(screen.getByText('Per 100 g')).toBeTruthy();
    expect(figs.textContent).toContain('350 kcal');
    expect(figs.textContent).toContain('22 g');
    const salt = within(figs).getByText('Salt').parentElement!;
    expect(salt.textContent).toContain('not known');
    expect(figs.textContent).not.toMatch(/\b0 g\b/);
    const allergens = screen.getByTestId('ivn-allergens').textContent ?? '';
    expect(allergens).toContain('Contains milk.');
    expect(allergens).toContain('May contain tree nuts.');
    expect(allergens).toContain('Not stated:');
    expect(screen.getByTestId('ivn-source').textContent).toContain('From the pack’s label, stated by Ayşe');
  });

  it('says per 100 ml for a drink, and that energy from the ABV is the alcohol alone', async () => {
    api.read.mockResolvedValue(
      answer(stored({ basis: '100ml', energyKcal: 220.9, fatG: null, proteinG: null, abvPct: 40, energyFromAbv: true, source: 'house' })),
    );
    show();
    const figs = await screen.findByTestId('ivn-figures');
    expect(screen.getByText('Per 100 ml')).toBeTruthy();
    expect(figs.textContent).toContain('221 kcal');
    expect(figs.textContent).toContain('from the alcohol alone, at least');
    expect(figs.textContent).toContain('40 %');
  });

  it('says nothing is recorded, and that unstated allergens are not "none"', async () => {
    api.read.mockResolvedValue(answer(null));
    show();
    expect((await screen.findByTestId('ivn-none')).textContent).toContain('Nothing is recorded yet');
    expect(screen.getByTestId('ivn-allergens').textContent).toBe('No allergens are stated yet. That does not mean it has none.');
    expect(screen.queryByTestId('ivn-figures')).toBeNull();
  });

  it('says a failed read failed and shows nothing as known', async () => {
    api.read.mockRejectedValue(httpError(503));
    show();
    const alert = await screen.findByTestId('ivn-unread');
    expect(alert.textContent).toContain('could not be read');
    expect(alert.textContent).toContain('Nothing is shown as known');
    expect(screen.queryByTestId('ivn-figures')).toBeNull();
    expect(screen.queryByTestId('ivn-allergens')).toBeNull();
  });

  it('opens the form for an owner or manager, straight at the lookup when asked', async () => {
    api.read.mockResolvedValue(answer(stored()));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Fill from the label lookup' }));
    expect(screen.getByTestId('ivn-form')).toBeTruthy();
    expect(screen.getByLabelText('Barcode or name')).toBeTruthy();
  });

  it('lets staff read but not change it', async () => {
    api.read.mockResolvedValue(answer(stored()));
    show(false);
    await screen.findByTestId('ivn-figures');
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fill from the label lookup' })).toBeNull();
    expect(screen.getByText('Only an owner or manager can change what is recorded here.')).toBeTruthy();
  });

  it('says plainly that a bottle\'s energy from the ABV leaves its sugar out (r109 inventory-8)', async () => {
    api.read.mockResolvedValue(
      answer(stored({ basis: '100ml', energyKcal: 138.1, carbohydrateG: 20, sugarsG: 20, abvPct: 25, energyFromAbv: true })),
    );
    show(true, 700, { kind: 'spirit', uom: 'bottle' });
    const line = (await screen.findByTestId('ivn-pack')).textContent ?? '';
    expect(line).toContain('967 kcal (from the alcohol alone; the energy in any sugar is not added)');
    expect(line).toContain('carbohydrate 140 g');
    expect(line).toContain('sugar 140 g');
    expect(line).not.toContain('at least)');
  });

  it('says what one recorded bottle holds under the per-100 table, and nothing for an unsized good', async () => {
    api.read.mockResolvedValue(answer(stored({ basis: '100ml', energyKcal: 230, fatG: 0, proteinG: null, abvPct: 13.5, energyFromAbv: true })));
    const { unmount } = show(true, 750, { kind: 'wine', uom: 'bottle' });
    const line = await screen.findByTestId('ivn-pack');
    expect(line.textContent).toBe(
      'A 750 ml bottle: 1,725 kcal (from the alcohol alone; the energy in any sugar is not added), protein not known, fat 0 g, carbohydrate not known, sugar not known, salt not known.',
    );
    unmount();
    show(true, null, { kind: 'wine', uom: 'bottle' });
    await screen.findByTestId('ivn-figures');
    expect(screen.queryByTestId('ivn-pack')).toBeNull();
  });

  it('a bottle whose figures are per 100 g says it needs a stated weight', async () => {
    api.read.mockResolvedValue(answer(stored({ basis: '100g' })));
    show(true, 700, { kind: 'spirit', uom: 'bottle' });
    expect((await screen.findByTestId('ivn-pack')).textContent).toBe(
      'A 700 ml bottle: these figures are per 100 g, so it needs a stated weight of one ml.',
    );
  });
});
