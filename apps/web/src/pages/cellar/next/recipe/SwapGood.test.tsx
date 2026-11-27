import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LooseDrink, LooseLines as Answer } from '../../../../services/api/recipes';
import SwapGood, { costWords, familyOf } from './SwapGood';

const RID = '11111111-1111-4111-8111-111111111111';
const h = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));

vi.mock('../../../../services/api/client', async (orig) => ({
  ...(await orig<typeof import('../../../../services/api/client')>()),
  apiClient: { get: h.get, put: h.put, post: h.post, patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => ({ activeRestaurantId: RID, activeRole: 'owner', user: { role: 'owner' } }) }));
const SHELF = [
  { id: 'i-gin', name: 'House gin', kind: 'spirit', uom: 'bottle', bottleSizeMl: 700 },
  { id: 'i-gin2', name: 'Better gin', kind: 'spirit', uom: 'bottle', bottleSizeMl: 700 },
  { id: 'i-lime', name: 'Limes', kind: 'fruit', uom: 'each', bottleSizeMl: null },
];
vi.mock('./ShelfPicker', () => ({
  default: ({ onPick }: { onPick: (i: unknown) => void }) => (
    <div>
      {SHELF.map((i) => (
        <button key={i.id} type="button" onClick={() => onPick(i)}>
          pick {i.name}
        </button>
      ))}
    </div>
  ),
}));

const drink = (cocktailId: string, name: string, baseUnit: string, extra: LooseDrink['lines'] = []): LooseDrink => ({
  cocktailId,
  name,
  versionId: `v-${cocktailId}`,
  yieldServes: 1,
  method: null,
  glass: 'Coupe',
  garnish: null,
  lines: [
    ...extra,
    baseUnit === 'each_milli'
      ? { role: 'stocked', componentId: null, inventoryId: 'i-gin', label: 'Gin', qty: 1, unit: 'each', usablePct: null }
      : { role: 'stocked', componentId: null, inventoryId: 'i-gin', label: 'Gin', qty: 50, unit: 'ml', usablePct: 95 },
  ],
});

let uses: Answer;
function answer(drinks: Array<[LooseDrink, string]>, dishCount = 2): Answer {
  return {
    lineCount: drinks.length,
    drinkCount: drinks.length,
    dishCount,
    groups: [{ key: 'gin', label: 'Gin', drinkCount: drinks.length, proposed: null, sameName: 0, lines: drinks.map(([d, u]) => ({ cocktailId: d.cocktailId, index: d.lines.length - 1, baseUnit: u })) }],
    drinks: drinks.map(([d]) => d),
  };
}
const lime = { role: 'stocked' as const, componentId: null, inventoryId: 'i-lime-juice', label: 'Lime juice', qty: 25, unit: 'ml', usablePct: null };
const threeDrinks = () =>
  answer([
    [drink('c-gim', 'Gimlet', 'each_milli', [lime]), 'each_milli'],
    [drink('c-neg', 'Negroni', 'ml10'), 'ml10'],
    [drink('c-col', 'Collins', 'ml10', [lime]), 'ml10'],
  ]);

let inFlight = 0;
let most = 0;
let afterCost: object;

beforeEach(() => {
  uses = threeDrinks();
  inFlight = 0;
  most = 0;
  afterCost = { perServe: 2.91, perServeExact: 2.91, priced: 1, of: 1, complete: true, partial: 0, lines: [] };
  h.get.mockReset().mockImplementation(async (url: string) => {
    if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'TRY', country: 'TR', readable: true, reason: null, statedAt: null } };
    if (url === `/recipes/${RID}/drinks/loose-lines?linkedTo=i-gin`) return { data: uses };
    throw new Error(`unexpected GET ${url}`);
  });
  h.post.mockReset().mockImplementation(async (_url: string, body: { lines: Array<{ inventoryId: string | null }> }) => {
    inFlight++;
    most = Math.max(most, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    const swapped = body.lines.some((l) => l.inventoryId === 'i-gin2' || l.inventoryId === 'i-lime');
    return { data: swapped ? afterCost : { perServe: 2.55, perServeExact: 2.55, priced: 1, of: 1, complete: true, partial: 0, lines: [] } };
  });
  h.put.mockReset().mockResolvedValue({ data: { versionId: 'new', version: 2, lines: [] } });
});

function mount(manages = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <SwapGood manages={manages} />
    </QueryClientProvider>,
  );
}

async function choose(toName: string) {
  mount();
  fireEvent.click(screen.getByTestId('swap-open'));
  fireEvent.click(screen.getByText('pick House gin'));
  await screen.findByTestId('swap-uses');
  fireEvent.click(screen.getByText(`pick ${toName}`));
  await screen.findByTestId('swap-plan');
}

describe('swap a good in every drink (r108 drinks-g10)', () => {
  it('says how many lines use the good, and that its dishes are not changed', async () => {
    mount();
    fireEvent.click(screen.getByTestId('swap-open'));
    fireEvent.click(screen.getByText('pick House gin'));
    expect(await screen.findByTestId('swap-uses')).toHaveTextContent('3 lines in 3 drinks pour from it.');
    expect(screen.getByTestId('swap-dishes')).toHaveTextContent('2 dishes use it too; they are not changed here.');
    expect(screen.getByText('Each drink keeps its earlier version.')).toBeInTheDocument();
  });

  it('the good being swapped out cannot be its own replacement', async () => {
    mount();
    fireEvent.click(screen.getByTestId('swap-open'));
    fireEvent.click(screen.getByText('pick House gin'));
    await screen.findByTestId('swap-uses');
    fireEvent.click(screen.getByText('pick House gin'));
    expect(screen.getByText('That is the good being swapped out; choose another.')).toBeInTheDocument();
    expect(screen.queryByTestId('swap-plan')).toBeNull();
  });

  it('a drink measured another way than the new good is counted is listed as not swapped, and is never sent', async () => {
    await choose('Limes');
    const plan = screen.getByTestId('swap-plan');
    expect(plan).toHaveTextContent('Negroni: not swapped: counted in pieces');
    expect(plan).toHaveTextContent('Collins: not swapped: counted in pieces');
    expect(screen.getByTestId('swap-confirm')).toHaveTextContent('Swap in 1 drink');
    await act(async () => fireEvent.click(screen.getByTestId('swap-confirm')));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    expect(h.put.mock.calls[0][0]).toBe(`/recipes/${RID}/cocktails/c-gim`);
    // The refused drinks are never priced or sent.
    expect(h.post.mock.calls.every(([u]) => u === `/recipes/${RID}/cocktails/c-gim/cost-preview`)).toBe(true);
  });

  it('each drink shows its cost a serve before and after, from the cost preview', async () => {
    await choose('Better gin');
    const plan = screen.getByTestId('swap-plan');
    expect(plan).toHaveTextContent('Gimlet: not swapped: counted by volume');
    await waitFor(() => expect(plan).toHaveTextContent('Negroni: cost a serve ₺2,55 -> ₺2,91'));
    expect(plan).toHaveTextContent('Collins: cost a serve ₺2,55 -> ₺2,91');
  });

  it('an incomplete cost says how many lines are priced, never a partial sum or 0', async () => {
    afterCost = { perServe: null, perServeExact: null, priced: 1, of: 2, complete: false, partial: 0, lines: [] };
    await choose('Better gin');
    const plan = screen.getByTestId('swap-plan');
    await waitFor(() => expect(plan).toHaveTextContent('Negroni: cost a serve ₺2,55 -> 1 of 2 priced'));
    expect(plan.textContent).not.toMatch(/₺0/);
    expect(costWords({ perServe: 1.2, perServeExact: 1.2, priced: 1, of: 2, complete: false, partial: 0, lines: [] }, (n) => `£${n}`)).toBe('1 of 2 priced');
  });

  it('previews four requests at a time', async () => {
    const many: Array<[LooseDrink, string]> = Array.from({ length: 7 }, (_, i) => [drink(`c-${i}`, `Drink ${i}`, 'ml10'), 'ml10']);
    uses = answer(many);
    await choose('Better gin');
    await waitFor(() => expect(screen.getByTestId('swap-plan')).toHaveTextContent('Drink 6: cost a serve'));
    expect(h.post).toHaveBeenCalledTimes(14);
    expect(most).toBe(4);
  });

  it('confirm sends one PUT per drink: the version read, with only the good’s lines changed, qty, unit and usable share kept', async () => {
    await choose('Better gin');
    await act(async () => fireEvent.click(screen.getByTestId('swap-confirm')));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(2));
    const col = uses.drinks.find((d) => d.cocktailId === 'c-col')!;
    const [url, body] = h.put.mock.calls.find(([u]) => u.endsWith('/c-col'))!;
    expect(url).toBe(`/recipes/${RID}/cocktails/c-col`);
    expect(JSON.stringify(body)).toBe(
      JSON.stringify({
        expectedVersionId: 'v-c-col',
        yieldServes: 1,
        method: null,
        glass: 'Coupe',
        garnish: null,
        lines: [col.lines[0], { ...col.lines[1], inventoryId: 'i-gin2' }],
      }),
    );
    expect(body.lines[1]).toMatchObject({ qty: 50, unit: 'ml', usablePct: 95 });
  });

  it('says the usable share a swapped line carries over, so keeping it is a seen choice (r108 fix)', async () => {
    await choose('Better gin');
    const plan = screen.getByTestId('swap-plan');
    await waitFor(() => expect(plan).toHaveTextContent('Negroni: cost a serve ₺2,55 -> ₺2,91, keeps usable 95%'));
    // A drink that is not swapped carries nothing.
    expect(within(plan).queryAllByTestId('swap-keeps')).toHaveLength(2);
    expect(plan).not.toHaveTextContent('Gimlet: not swapped: counted by volume, keeps');
  });

  it('Confirm stays off until the reads land, so a second click never sends a stale version (r108 fix)', async () => {
    await choose('Better gin');
    let release: (v: unknown) => void = () => {};
    const held = new Promise((r) => (release = r));
    const was = h.get.getMockImplementation()!;
    h.get.mockImplementation(async (url: string) => {
      if (url.includes('loose-lines')) await held;
      return was(url);
    });
    await act(async () => fireEvent.click(screen.getByTestId('swap-confirm')));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('swap-confirm')).toBeDisabled();
    fireEvent.click(screen.getByTestId('swap-confirm'));
    expect(h.put).toHaveBeenCalledTimes(2);
    await act(async () => release(null));
    await waitFor(() => expect(screen.getByTestId('swap-confirm')).not.toBeDisabled());
  });

  it('says each drink’s outcome: one saved, one someone saved first', async () => {
    h.put
      .mockReset()
      .mockResolvedValueOnce({ data: { versionId: 'n', version: 2, lines: [] } })
      .mockRejectedValueOnce({ response: { status: 409, data: { message: 'stale' } } });
    await choose('Better gin');
    await act(async () => fireEvent.click(screen.getByTestId('swap-confirm')));
    const out = await screen.findByTestId('swap-outcomes');
    expect(out).toHaveTextContent('Negroni: saved, House gin swapped for Better gin.');
    expect(out).toHaveTextContent('Someone saved Collins first; open it to swap this good.');
  });

  it('staff are offered nothing', () => {
    mount(false);
    expect(screen.queryByTestId('swap-open')).toBeNull();
  });

  it('reads how a good is counted from its unit', () => {
    expect(['ml', 'l', 'bottle', 'keg'].map(familyOf)).toEqual(['ml10', 'ml10', 'ml10', 'ml10']);
    expect(['mg', 'g', 'kg'].map(familyOf)).toEqual(['mg', 'mg', 'mg']);
    expect(['each', 'case', null].map(familyOf)).toEqual(['each_milli', 'each_milli', 'each_milli']);
  });
});
