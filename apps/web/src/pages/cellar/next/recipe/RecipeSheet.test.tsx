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
const CID2 = '88888888-8888-4888-8888-888888888888';
const V9 = '99999999-9999-4999-8999-000000000009';
const TEQ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

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

import RecipeSheet, { LEGACY_NOTE, NEWER_SENTENCE, RESTORED_SENTENCE, SET_ASIDE_SENTENCE, STALE_SENTENCE } from './RecipeSheet';
import { forgetDrafts } from './drafts';

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

/** A second drink, for switching rows: a Margarita with 50 ml tequila. */
function margarita(): CocktailRecipe {
  const n = negroni();
  return {
    ...n,
    cocktail: { ...n.cocktail, id: CID2, name: 'Margarita' },
    current: { ...n.current!, versionId: V9, version: 9, lines: [{ ...linked('tequila', 20, TEQ), qtyEntered: 50 }] },
    cost: { perServe: 20, priced: 1, of: 1, complete: true },
  };
}

let versions: unknown[] = [];
let other: CocktailRecipe | null = null;
function serve(recipe: CocktailRecipe, shelf: unknown[] = []) {
  h.get.mockImplementation(async (url: string) => {
    if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'TRY', country: 'Turkey', readable: true, reason: null, statedAt: null } };
    if (url === `/recipes/${RID}/cocktails/${CID}`) return { data: recipe };
    if (other && url === `/recipes/${RID}/cocktails/${CID2}`) return { data: other };
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
  other = null;
  h.auth = { activeRestaurantId: RID, activeRole: 'manager', user: { userId: 'u1', role: 'manager' } };
  forgetDrafts();
});

/** True when leaving the page now would make the browser warn first. */
function leaveWarns(): boolean {
  const ev = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(ev);
  return ev.defaultPrevented;
}

function mountSwitchable(first: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return render(<RecipeSheet cocktailId={first} />, { wrapper: wrap });
}

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
    await screen.findByTestId('recipe-legacy');
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

  it('Save is disabled while a line has no amount above zero', async () => {
    serve(negroni());
    mount();
    const amounts = await screen.findAllByLabelText('Amount');
    fireEvent.change(amounts[1], { target: { value: '0' } });
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    expect(screen.getByText('Line 2 (Campari) needs an amount above zero.')).toBeInTheDocument();
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

  it('switching to another drink with an unsaved draft never carries it into that drink', async () => {
    serve(negroni());
    other = margarita();
    h.put.mockResolvedValue({ data: { versionId: 'v10', version: 10, lines: [] } });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { rerender } = render(<RecipeSheet cocktailId={CID} />, { wrapper: wrap });
    fireEvent.change((await screen.findAllByLabelText('Amount'))[0], { target: { value: '45' } });

    rerender(<RecipeSheet cocktailId={CID2} />);
    expect(await screen.findByRole('region', { name: 'Recipe for Margarita' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByLabelText('Amount')).toHaveLength(1));
    expect(amount(0)).toBe('50');

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    const [url, body] = h.put.mock.calls[0];
    expect(url).toBe(`/recipes/${RID}/cocktails/${CID2}`);
    expect(body.expectedVersionId).toBe(V9);
    expect(body.lines).toEqual([{ role: 'stocked', inventoryId: TEQ, label: 'tequila', qty: 50, unit: 'ml' }]);
  });

  it('a new recipe typed for one drink does not appear on another drink with none', async () => {
    serve(EMPTY);
    other = { ...EMPTY, cocktail: { ...EMPTY.cocktail, id: CID2, name: 'Margarita' } };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { rerender } = render(<RecipeSheet cocktailId={CID} />, { wrapper: wrap });
    fireEvent.click(await screen.findByRole('button', { name: /add an ingredient/i }));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '45' } });
    rerender(<RecipeSheet cocktailId={CID2} />);
    expect(await screen.findByRole('region', { name: 'Recipe for Margarita' })).toBeInTheDocument();
    expect(screen.queryAllByLabelText('Amount')).toHaveLength(0);
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  it('a Turkish decimal comma saves as the number it means: 22,5 is 22.5', async () => {
    serve(negroni());
    h.put.mockResolvedValue({ data: { versionId: V5, version: 5, lines: [] } });
    mount();
    fireEvent.change((await screen.findAllByLabelText('Amount'))[1], { target: { value: '22,5' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    expect(h.put.mock.calls[0][1].lines.map((l: { qty: number }) => l.qty)).toEqual([30, 22.5, 30]);
  });

  it('loading the saved recipe sets the typed lines aside, and they can be put back over it', async () => {
    serve(negroni());
    h.put.mockRejectedValueOnce(Object.assign(new Error('conflict'), { response: { status: 409 } }));
    mount();
    fireEvent.change((await screen.findAllByLabelText('Amount'))[0], { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(STALE_SENTENCE);

    serve(negroniV5());
    fireEvent.click(screen.getByRole('button', { name: 'Load the saved recipe' }));
    await waitFor(() => expect(screen.getAllByLabelText('Amount')).toHaveLength(1));
    expect(amount(0)).toBe('50');
    expect(screen.getByTestId('recipe-set-aside')).toHaveTextContent(SET_ASIDE_SENTENCE);

    fireEvent.click(screen.getByRole('button', { name: 'Put my lines back' }));
    expect(screen.getAllByLabelText('Amount')).toHaveLength(3);
    expect(amount(0)).toBe('45');
    expect(screen.queryByTestId('recipe-set-aside')).toBeNull();

    // Put back on top of version 5, so a save now replaces version 5 on purpose.
    h.put.mockResolvedValueOnce({ data: { versionId: 'v6', version: 6, lines: [] } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(2));
    expect(h.put.mock.calls[1][1].expectedVersionId).toBe(V5);
    expect(h.put.mock.calls[1][1].lines.map((l: { qty: number }) => l.qty)).toEqual([45, 30, 30]);
  });

  it('a clean sheet loads the saved recipe with nothing to set aside', async () => {
    serve(negroni());
    h.put.mockRejectedValue(Object.assign(new Error('Network Error'), { request: {} }));
    mount();
    await screen.findAllByTestId('recipe-line');
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Load the saved recipe' }));
    await waitFor(() => expect(screen.queryByTestId('recipe-said')).toBeNull());
    expect(screen.queryByTestId('recipe-set-aside')).toBeNull();
  });

  it('an amount past what one line holds stops Save and says the most', async () => {
    serve(negroni());
    mount();
    const amounts = await screen.findAllByLabelText('Amount');
    fireEvent.change(amounts[0], { target: { value: '100001' } });
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    expect(screen.getByText('Line 1 (gin) is more than one line can hold. The most is 100,000 ml.')).toBeInTheDocument();
    fireEvent.change(amounts[0], { target: { value: '100000' } });
    expect(screen.getByRole('button', { name: /^save$/i })).not.toBeDisabled();
  });

  it('a save the gateway refuses with a sentence shows that sentence', async () => {
    const said = 'Ingredient 2 (Campari) is more than one line can hold. The most is 100,000 ml.';
    serve(negroni());
    h.put.mockRejectedValueOnce(Object.assign(new Error('Request failed with status code 400'), { response: { status: 400, data: { message: said } } }));
    mount();
    await screen.findAllByTestId('recipe-line');
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(`${said} Not saved. Your recipe is as it was.`);
  });

  it('a 400 without a sentence (a validation list) says only that it was not saved', async () => {
    serve(negroni());
    h.put.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 400'), { response: { status: 400, data: { message: ['lines.0.qty must be a number'] } } }),
    );
    mount();
    await screen.findAllByTestId('recipe-line');
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Not saved. Your recipe is as it was.');
    expect(alert.textContent).not.toMatch(/lines\.0/);
  });
  it('round 19: going A -> B -> A brings back what was typed for A, said as unsaved, pinned to its version', async () => {
    serve(negroni());
    other = margarita();
    const { rerender } = mountSwitchable(CID);
    fireEvent.change((await screen.findAllByLabelText('Amount'))[0], { target: { value: '45' } });
    rerender(<RecipeSheet cocktailId={CID2} />);
    expect(await screen.findByRole('region', { name: 'Recipe for Margarita' })).toBeInTheDocument();
    await waitFor(() => expect(amount(0)).toBe('50'));
    expect(screen.queryByTestId('recipe-restored')).toBeNull();

    rerender(<RecipeSheet cocktailId={CID} />);
    expect(await screen.findByRole('region', { name: 'Recipe for Negroni' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByLabelText('Amount')).toHaveLength(3));
    expect(amount(0)).toBe('45');
    expect(screen.getByTestId('recipe-restored')).toHaveTextContent(RESTORED_SENTENCE);
    expect(screen.getByRole('button', { name: 'Load the saved recipe' })).toBeInTheDocument();

    h.put.mockResolvedValueOnce({ data: { versionId: V5, version: 5, lines: [] } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    const [url, body] = h.put.mock.calls[0];
    expect(url).toBe(`/recipes/${RID}/cocktails/${CID}`);
    expect(body.expectedVersionId).toBe(V4);
    expect(body.lines.map((l: { qty: number }) => l.qty)).toEqual([45, 30, 30]);
    await waitFor(() => expect(screen.queryByTestId('recipe-restored')).toBeNull());
    expect(leaveWarns()).toBe(false);

    // Typed again after that save, the lines are new, not "from earlier".
    fireEvent.change(screen.getAllByLabelText('Amount')[0], { target: { value: '46' } });
    h.put.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('recipe-restored')).toBeNull();
  });

  it('round 19: a kept draft goes back only to the person who typed it', async () => {
    serve(negroni());
    other = margarita();
    const { rerender } = mountSwitchable(CID);
    fireEvent.change((await screen.findAllByLabelText('Amount'))[0], { target: { value: '45' } });
    rerender(<RecipeSheet cocktailId={CID2} />);
    await screen.findByRole('region', { name: 'Recipe for Margarita' });
    h.auth = { ...h.auth, user: { userId: 'u2', role: 'manager' } };
    rerender(<RecipeSheet cocktailId={CID} />);
    await screen.findByRole('region', { name: 'Recipe for Negroni' });
    await waitFor(() => expect(screen.getAllByLabelText('Amount')).toHaveLength(3));
    expect(amount(0)).toBe('30');
    expect(screen.queryByTestId('recipe-restored')).toBeNull();
  });

  it('round 19: leaving the page warns while any draft is unsaved, even one on a drink no longer open', async () => {
    serve(negroni());
    other = margarita();
    const { rerender } = mountSwitchable(CID);
    await screen.findAllByLabelText('Amount');
    expect(leaveWarns()).toBe(false);
    fireEvent.change(screen.getAllByLabelText('Amount')[0], { target: { value: '45' } });
    expect(leaveWarns()).toBe(true);
    rerender(<RecipeSheet cocktailId={CID2} />);
    await screen.findByRole('region', { name: 'Recipe for Margarita' });
    expect(leaveWarns()).toBe(true);
  });

  it('round 19: set-aside lines can be thrown away, and then leaving no longer warns', async () => {
    serve(negroni());
    h.put.mockRejectedValueOnce(Object.assign(new Error('conflict'), { response: { status: 409 } }));
    mount();
    fireEvent.change((await screen.findAllByLabelText('Amount'))[0], { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await screen.findByRole('alert');
    serve(negroniV5());
    fireEvent.click(screen.getByRole('button', { name: 'Load the saved recipe' }));
    await screen.findByTestId('recipe-set-aside');
    expect(leaveWarns()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Throw them away' }));
    expect(screen.queryByTestId('recipe-set-aside')).toBeNull();
    expect(leaveWarns()).toBe(false);
  });

  it('round 19: a save over the loaded version ends the set-aside lines', async () => {
    serve(negroni());
    h.put.mockRejectedValueOnce(Object.assign(new Error('conflict'), { response: { status: 409 } }));
    mount();
    fireEvent.change((await screen.findAllByLabelText('Amount'))[0], { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await screen.findByRole('alert');
    serve(negroniV5());
    fireEvent.click(screen.getByRole('button', { name: 'Load the saved recipe' }));
    await screen.findByTestId('recipe-set-aside');
    fireEvent.change(screen.getAllByLabelText('Amount')[0], { target: { value: '55' } });
    h.put.mockResolvedValueOnce({ data: { versionId: 'v6', version: 6, lines: [] } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('recipe-set-aside')).toBeNull());
    expect(leaveWarns()).toBe(false);
  });

  it('round 19: only a 400 shows the gateway sentence; a 422 or 500 with a message says only not saved', async () => {
    for (const status of [422, 500]) {
      forgetDrafts();
      serve(negroni());
      h.put.mockReset();
      h.put.mockRejectedValueOnce(Object.assign(new Error(`status ${status}`), { response: { status, data: { message: 'internal detail' } } }));
      const { unmount } = mount();
      await screen.findAllByTestId('recipe-line');
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Not saved. Your recipe is as it was.');
      expect(alert.textContent).not.toMatch(/internal detail/);
      unmount();
    }
  });
});
