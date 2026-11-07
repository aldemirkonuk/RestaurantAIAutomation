/**
 * The drink's recipe sheet (proposal §2a). Main's recipe box was a textarea a
 * regex split into unlinked text (`CocktailRegister.tsx:80-213` at
 * origin/main): it sent no shelf item, costed nothing, never versioned its
 * lines, and its success line named a table. Each case below fails against
 * that box.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { CocktailRecipe, RecipeLine } from '../../../../services/api/recipes';

const RID = '11111111-1111-4111-8111-111111111111';
const CID = '22222222-2222-4222-8222-222222222222';
const GIN = '33333333-3333-4333-8333-333333333333';
const V4 = '44444444-4444-4444-8444-444444444444';
const V5 = '77777777-7777-4777-8777-777777777777';

const h = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  auth: {} as Record<string, unknown>,
}));

vi.mock('../../../../services/api/client', () => ({
  apiClient: { get: h.get, put: h.put },
  getErrorStatus: (e: unknown) => {
    const s = (e as { response?: { status?: unknown } } | null)?.response?.status;
    return typeof s === 'number' ? s : null;
  },
}));
vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => h.auth }));

import RecipeSheet, { LEGACY_NOTE, NEWER_SENTENCE, STALE_SENTENCE } from './RecipeSheet';

function line(over: Partial<RecipeLine>): RecipeLine {
  return {
    id: `l-${over.label}`,
    position: 0,
    role: 'stocked',
    inventoryId: null,
    label: 'gin',
    itemName: null,
    itemKind: null,
    qtyEntered: 30,
    unitCode: 'ml',
    qtyBase: 300,
    baseUnit: 'ml10',
    status: 'not_linked',
    costPerServe: null,
    costBasis: null,
    ...over,
  };
}

const linked = (label: string, cost: number | null, id: string) =>
  line({ label, inventoryId: id, itemName: label, itemKind: 'spirit', status: 'linked', costPerServe: cost, costBasis: cost == null ? 'unknown' : 'lot_wac' });

/** Lane 1's fixture: 30 ml each of gin (1.00/ml), Campari (0.50), vermouth (0.40) = 57.00. */
function negroni(over: Partial<CocktailRecipe> = {}): CocktailRecipe {
  return {
    cocktail: { id: CID, name: 'Negroni', price: 450, glass: 'Rocks', garnish: 'Orange peel', method: 'Stirred', description: null },
    current: {
      versionId: V4,
      version: 4,
      yieldServes: 1,
      method: 'Stirred',
      glass: 'Rocks',
      garnish: 'Orange peel',
      createdAt: '2026-11-07T10:00:00Z',
      lines: [
        linked('gin', 30, GIN),
        linked('Campari', 15, '55555555-5555-4555-8555-555555555555'),
        linked('sweet vermouth', 12, '66666666-6666-4666-8666-666666666666'),
      ],
    },
    cost: { perServe: 57, priced: 3, of: 3, complete: true },
    versionCount: 1,
    legacyLines: [],
    ...over,
  };
}

/** A colleague's version 5: gin only, 50 ml. */
function negroniV5(): CocktailRecipe {
  const n = negroni();
  return {
    ...n,
    current: { ...n.current!, versionId: V5, version: 5, lines: [linked('gin', 50, GIN)].map((l) => ({ ...l, id: 'v5-gin', qtyEntered: 50 })) },
    cost: { perServe: 50, priced: 1, of: 1, complete: true },
    versionCount: 2,
  };
}

const EMPTY: CocktailRecipe = {
  cocktail: { id: CID, name: 'Negroni', price: 450, glass: null, garnish: null, method: null, description: null },
  current: null,
  cost: null,
  versionCount: 0,
  legacyLines: [],
};

let versions: unknown[] = [];
function serve(recipe: CocktailRecipe, shelf: unknown[] = []) {
  h.get.mockImplementation(async (url: string) => {
    if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'TRY', country: 'Turkey', readable: true, reason: null, statedAt: null } };
    if (url === `/recipes/${RID}/cocktails/${CID}`) return { data: recipe };
    if (url === `/recipes/${RID}/shelf`) return { data: shelf };
    if (url === `/recipes/${RID}/cocktails/${CID}/versions`) return { data: versions };
    throw new Error(`unexpected GET ${url}`);
  });
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const out = render(<RecipeSheet cocktailId={CID} />, { wrapper: wrap });
  return { ...out, qc };
}

/** What the app's focus refetch does (App.tsx: refetchOnWindowFocus). */
async function refocus(qc: QueryClient) {
  await act(async () => {
    await qc.refetchQueries({ queryKey: ['recipes', RID, CID] });
  });
}

const amount = (i: number) => (screen.getAllByLabelText('Amount')[i] as HTMLInputElement).value;

beforeEach(() => {
  h.get.mockReset();
  h.put.mockReset();
  versions = [];
  h.auth = { activeRestaurantId: RID, activeRole: 'manager', user: { role: 'manager' } };
});

describe('RecipeSheet', () => {
  it('2. 2 of 3 lines priced says so and shows no total', async () => {
    serve(
      negroni({
        current: { ...negroni().current!, lines: [linked('gin', 30, GIN), linked('Campari', 15, '55555555-5555-4555-8555-555555555555'), linked('sweet vermouth', null, '66666666-6666-4666-8666-666666666666')] },
        cost: { perServe: null, priced: 2, of: 3, complete: false },
      }),
    );
    mount();
    const foot = await screen.findByTestId('recipe-footer');
    await waitFor(() => expect(foot).toHaveTextContent('2 of 3 ingredients priced'));
    expect(foot.textContent).not.toMatch(/₺|Costs/);
  });

  it('3. a complete Negroni costs ₺57.00 a serve at today’s prices', async () => {
    serve(negroni());
    mount();
    await waitFor(() =>
      expect(screen.getByTestId('recipe-footer')).toHaveTextContent("Costs ₺57.00 a serve at today's prices"),
    );
    expect(screen.getByTestId('recipe-footer').textContent).not.toMatch(/%/);
  });

  it('1. picking a shelf item sends inventoryId in the PUT body', async () => {
    serve(EMPTY, [{ id: GIN, name: 'Tanqueray gin', kind: 'spirit', uom: 'bottle', bottleSizeMl: 700 }]);
    h.put.mockResolvedValue({ data: { versionId: 'v1', version: 1, lines: [] } });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /add an ingredient/i }));
    fireEvent.click(screen.getByRole('button', { name: /link it to your shelf/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Tanqueray gin/ }));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    const [url, body] = h.put.mock.calls[0];
    expect(url).toBe(`/recipes/${RID}/cocktails/${CID}`);
    expect(body.expectedVersionId).toBeNull();
    expect(body.lines).toEqual([
      { role: 'stocked', inventoryId: GIN, label: 'Tanqueray gin', qty: 30, unit: 'ml' },
    ]);
  });

  it('4. staff read it with no money and no inputs', async () => {
    h.auth = { activeRestaurantId: RID, activeRole: 'staff', user: { role: 'staff' } };
    const n = negroni();
    serve({
      ...n,
      cocktail: { ...n.cocktail, price: null },
      current: { ...n.current!, lines: n.current!.lines.map((l) => ({ ...l, costPerServe: null, costBasis: null })) },
      cost: null,
    });
    const { container } = mount();
    await screen.findAllByTestId('recipe-line');
    expect(container.textContent).not.toMatch(/₺/);
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
    expect(screen.queryByRole('spinbutton')).toBeNull();
    expect(screen.queryByLabelText('Amount')).toBeNull();
    expect(screen.queryByRole('button', { name: /paste a spec/i })).toBeNull();
  });

  it('4b. staff see the old recipe box lines when nothing is saved here yet', async () => {
    h.auth = { activeRestaurantId: RID, activeRole: 'staff', user: { role: 'staff' } };
    serve({ ...EMPTY, legacyLines: [{ label: 'gin', quantity: 1.5, unit: 'oz' }, { label: 'orange twist', quantity: null, unit: null }] });
    mount();
    const box = await screen.findByTestId('recipe-legacy');
    expect(box).toHaveTextContent(LEGACY_NOTE);
    expect(box).toHaveTextContent('1.5 oz');
    expect(box).toHaveTextContent('orange twist');
    expect(screen.queryByText('No recipe yet.')).toBeNull();
    expect(screen.queryByTestId('recipe-proposed')).toBeNull();
    expect(screen.queryByRole('button', { name: /use these lines/i })).toBeNull();
  });

  it('4c. staff see "No recipe yet." only when there is none at all', async () => {
    h.auth = { activeRestaurantId: RID, activeRole: 'staff', user: { role: 'staff' } };
    serve(EMPTY);
    mount();
    expect(await screen.findByTestId('recipe-footer')).toHaveTextContent('No recipe yet.');
    expect(screen.queryByTestId('recipe-legacy')).toBeNull();
  });

  it('5a. a refused save says it was not saved', async () => {
    serve(negroni());
    h.put.mockRejectedValue(Object.assign(new Error('Request failed with status code 500'), { response: { status: 500 } }));
    mount();
    await screen.findAllByTestId('recipe-line');
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not saved. Your recipe is as it was.');
  });

  it('5b. a 409 says someone saved first and keeps the typed lines', async () => {
    serve(negroni());
    h.put.mockRejectedValue(Object.assign(new Error('conflict'), { response: { status: 409 } }));
    mount();
    const amounts = await screen.findAllByLabelText('Amount');
    fireEvent.change(amounts[0], { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(STALE_SENTENCE);
    expect(amount(0)).toBe('45');
    expect(h.put.mock.calls[0][1].expectedVersionId).toBe(V4);
  });

  it('5c. a colleague’s version arriving mid-edit never replaces the typed lines', async () => {
    serve(negroni());
    h.put.mockRejectedValue(Object.assign(new Error('conflict'), { response: { status: 409 } }));
    const { qc } = mount();
    fireEvent.change((await screen.findAllByLabelText('Amount'))[0], { target: { value: '45' } });

    // Tabbing back refetches, and the server now holds version 5.
    serve(negroniV5());
    await refocus(qc);
    expect(await screen.findByTestId('recipe-newer')).toHaveTextContent(NEWER_SENTENCE);
    expect(screen.getAllByLabelText('Amount')).toHaveLength(3);
    expect(amount(0)).toBe('45');

    // The save stays pinned to the version the editor opened, so the 409 guard fires.
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(STALE_SENTENCE);
    expect(h.put.mock.calls[0][1].expectedVersionId).toBe(V4);

    // Another refetch after the 409 still keeps them.
    await refocus(qc);
    expect(amount(0)).toBe('45');
    expect(screen.getAllByLabelText('Amount')).toHaveLength(3);

    // Loading the saved recipe is a button on the sheet, and it shows theirs.
    fireEvent.click(screen.getByRole('button', { name: 'Load the saved recipe' }));
    await waitFor(() => expect(screen.getAllByLabelText('Amount')).toHaveLength(1));
    expect(amount(0)).toBe('50');
    expect(screen.queryByTestId('recipe-said')).toBeNull();
    expect(screen.queryByTestId('recipe-newer')).toBeNull();
  });

  it('5d. a clean sheet takes a colleague’s newer version as it arrives', async () => {
    serve(negroni());
    const { qc } = mount();
    await screen.findAllByLabelText('Amount');
    serve(negroniV5());
    await refocus(qc);
    await waitFor(() => expect(screen.getAllByLabelText('Amount')).toHaveLength(1));
    expect(screen.queryByTestId('recipe-newer')).toBeNull();
  });

  it('6. a successful save invalidates the recipe key and says what was saved', async () => {
    serve(negroni());
    h.put.mockResolvedValue({ data: { versionId: V5, version: 5, lines: [] } });
    const { qc } = mount();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    await screen.findAllByTestId('recipe-line');
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByText('Saved. 3 ingredients, version 5.')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith({ queryKey: ['recipes', RID, CID] });
  });

  it('7. never shows a table name or the word confidence', async () => {
    serve({ ...EMPTY, legacyLines: [{ label: 'whites', quantity: 2, unit: 'egg' }] });
    const { container } = mount();
    await screen.findByTestId('recipe-proposed');
    for (const html of [container.innerHTML, container.textContent ?? '']) {
      expect(html).not.toMatch(/cocktail_ingredients/);
      expect(html).not.toMatch(/confidence/i);
    }
  });

  it('earlier versions leave out the one on the sheet', async () => {
    versions = [
      { versionId: V5, version: 5, createdAt: '2026-11-07T11:00:00Z', author: '99999999-9999-4999-8999-999999999999', lineCount: 1 },
      { versionId: V4, version: 4, createdAt: '2026-11-07T10:00:00Z', author: null, lineCount: 3 },
    ];
    serve(negroniV5());
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Earlier versions (1)' }));
    const list = await screen.findByTestId('recipe-versions');
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(list).toHaveTextContent('Version 4');
    expect(list).not.toHaveTextContent('Version 5');
    expect(list.textContent).not.toMatch(/9999/);
  });

  it('an editor gets the old recipe box as proposed rows, read by the parser', async () => {
    serve({ ...EMPTY, legacyLines: [{ label: 'whites', quantity: 2, unit: 'egg' }, { label: 'gin', quantity: 1.5, unit: 'oz' }] });
    mount();
    const box = await screen.findByTestId('recipe-proposed');
    expect(box).toHaveTextContent(LEGACY_NOTE);
    expect(box).toHaveTextContent('2 each');
    expect(box).toHaveTextContent('egg white');
    expect(screen.queryAllByTestId('recipe-line')).toHaveLength(0);
    fireEvent.click(within(box).getByRole('button', { name: 'Use these lines' }));
    expect(screen.getAllByTestId('recipe-line')).toHaveLength(2);
    expect(amount(1)).toBe('1.5');
    expect(h.put).not.toHaveBeenCalled();
  });

  it('pasting a spec proposes rows and saves nothing until they are used', async () => {
    serve(EMPTY);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /paste a spec/i }));
    fireEvent.change(screen.getByLabelText(/paste a spec/i), { target: { value: '1½ oz gin / 2 dashes Angostura' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read it' }));
    const box = screen.getByTestId('recipe-proposed');
    expect(box).toHaveTextContent('1.5 oz');
    expect(box).toHaveTextContent('Nothing is saved yet.');
    fireEvent.click(within(box).getByRole('button', { name: 'Discard' }));
    expect(screen.queryByTestId('recipe-proposed')).toBeNull();
    expect(screen.queryAllByTestId('recipe-line')).toHaveLength(0);
    // Discarding the reading keeps the pasted text to correct and read again.
    expect(screen.getByLabelText(/paste a spec/i)).toHaveValue('1½ oz gin / 2 dashes Angostura');
    fireEvent.click(screen.getByRole('button', { name: 'Read it' }));
    fireEvent.click(within(screen.getByTestId('recipe-proposed')).getByRole('button', { name: 'Use these lines' }));
    expect(screen.getAllByTestId('recipe-line')).toHaveLength(2);
    expect(h.put).not.toHaveBeenCalled();
  });

  it('Save is disabled while a line has no amount above zero', async () => {
    serve(negroni());
    mount();
    const amounts = await screen.findAllByLabelText('Amount');
    fireEvent.change(amounts[1], { target: { value: '0' } });
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    fireEvent.change(amounts[1], { target: { value: '22,5' } });
    expect(screen.getByRole('button', { name: /^save$/i })).not.toBeDisabled();
  });

  it('a failed read says it failed', async () => {
    h.get.mockRejectedValue(new Error('boom'));
    mount();
    expect(await screen.findByTestId('recipe-unread')).toHaveTextContent('could not be read');
  });

  it('a failed re-read says so and keeps the typed lines on the sheet', async () => {
    serve(negroni());
    const { qc } = mount();
    fireEvent.change((await screen.findAllByLabelText('Amount'))[0], { target: { value: '45' } });
    h.get.mockRejectedValue(new Error('Network Error'));
    await refocus(qc);
    expect(await screen.findByTestId('recipe-reread-failed')).toHaveTextContent('could not be read again just now (Network Error)');
    expect(screen.getAllByTestId('recipe-line')).toHaveLength(3);
    expect(amount(0)).toBe('45');
  });

  it('a manager sees the price and each line’s cost; staff see neither', async () => {
    serve(negroni());
    const { unmount } = mount();
    await waitFor(() => expect(screen.getByText('₺450.00 a serve')).toBeInTheDocument());
    expect(screen.getByText('₺30.00 a serve')).toBeInTheDocument();
    unmount();
    h.auth = { activeRestaurantId: RID, activeRole: 'staff', user: { role: 'manager' } };
    const { container } = mount();
    await screen.findAllByTestId('recipe-line');
    expect(container.textContent).not.toMatch(/₺|a serve at/);
  });
});
