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
  post: vi.fn(),
  auth: {} as Record<string, unknown>,
}));

vi.mock('../../../../services/api/client', () => ({
  apiClient: { get: h.get, put: h.put, post: h.post },
  getErrorStatus: (e: unknown) => {
    const s = (e as { response?: { status?: unknown } } | null)?.response?.status;
    return typeof s === 'number' ? s : null;
  },
}));
vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => h.auth }));

import RecipeSheet, { fromProposal, LEGACY_NOTE, NEWER_SENTENCE, RESTORED_SENTENCE, SET_ASIDE_SENTENCE, STALE_SENTENCE } from './RecipeSheet';
import { draftKey, forgetDrafts, keepDraft } from './drafts';

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
let past: Record<string, unknown> = {};
let other: CocktailRecipe | null = null;
function serve(recipe: CocktailRecipe, shelf: unknown[] = []) {
  h.get.mockImplementation(async (url: string) => {
    if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'TRY', country: 'Turkey', readable: true, reason: null, statedAt: null } };
    if (url === `/recipes/${RID}/cocktails/${CID}`) return { data: recipe };
    if (other && url === `/recipes/${RID}/cocktails/${CID2}`) return { data: other };
    if (url === `/recipes/${RID}/shelf`) return { data: shelf };
    if (url === `/recipes/${RID}/cocktails/${CID}/versions`) return { data: versions };
    const v = url.startsWith(`/recipes/${RID}/cocktails/${CID}/versions/`) ? past[url.split('/').pop() as string] : undefined;
    if (v) return { data: v };
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
  h.post.mockReset();
  versions = [];
  past = {};
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

/** Asks the leave warning what it sets: the legacy returnValue older Chrome and Edge need. */
function leaveReturnValue(): unknown {
  const ev = new Event('beforeunload', { cancelable: true });
  let got: unknown;
  Object.defineProperty(ev, 'returnValue', { configurable: true, get: () => got, set: (v) => { got = v; } });
  window.dispatchEvent(ev);
  return got;
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
    const card = await screen.findByTestId('drink-card-cost');
    expect(card).toHaveTextContent('2 of 3 ingredients priced');
    expect(card.textContent).not.toMatch(/₺/);
    // The cost is said once, on its card: no second cost sentence under the lines.
    expect(screen.queryByTestId('recipe-footer')).toBeNull();
  });

  it('the drink opens on its cards: a line with no price makes the cost not known and names it, never a partial sum', async () => {
    serve(
      negroni({
        current: { ...negroni().current!, lines: [linked('gin', 30, GIN), linked('Campari', 15, '55555555-5555-4555-8555-555555555555'), linked('sweet vermouth', null, '66666666-6666-4666-8666-666666666666')] },
        cost: { perServe: null, priced: 2, of: 3, complete: false },
      }),
    );
    mount();
    const card = await screen.findByTestId('drink-card-cost');
    expect(card).toHaveAttribute('data-known', 'false');
    expect(card).toHaveTextContent('Cost a serve');
    expect(card).toHaveTextContent('Not known');
    expect(card).toHaveTextContent('2 of 3 ingredients priced; no price yet for sweet vermouth.');
    // 30 + 15 of the priced lines is never shown as the drink's cost.
    expect(card.textContent).not.toMatch(/₺|45/);
    expect(screen.getByTestId('drink-card-ingredients')).toHaveTextContent('3 from your shelf.');
  });

  it('the cards say a complete cost, the price, and what a serve holds; a line under a cent is not free', async () => {
    serve(negroni({ cost: { perServe: 0, perServeExact: 0.004, priced: 3, of: 3, complete: true } }));
    mount();
    expect(await screen.findByTestId('drink-card-cost')).toHaveTextContent('Under ₺0.01');
    expect(screen.getByTestId('drink-card-price')).toHaveTextContent('₺450.00A serve, as your list has it.');
    // No whatIsIn from this gateway: said as not read on both cards, never 0.
    expect(screen.getByTestId('drink-card-energy')).toHaveTextContent('Not read');
    expect(screen.getByTestId('drink-card-alcohol')).toHaveTextContent('Not read');
  });

  it('3. a complete Negroni costs ₺57.00 a serve at today’s prices', async () => {
    serve(negroni());
    mount();
    const card = await screen.findByTestId('drink-card-cost');
    expect(card).toHaveTextContent("₺57.00At today's prices, all 3 ingredients priced.");
    expect(card.textContent).not.toMatch(/%/);
    expect(screen.queryByTestId('recipe-footer')).toBeNull();
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
    // Staff get the cards that are theirs to read: no cost, no price.
    expect(screen.queryByTestId('drink-card-cost')).toBeNull();
    expect(screen.queryByTestId('drink-card-price')).toBeNull();
    expect(screen.getByTestId('drink-card-ingredients')).toHaveTextContent('3');
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
    expect(box).toHaveTextContent('1.5 US oz');
    expect(box).toHaveTextContent('2 dashes');
    expect(box).toHaveTextContent('Nothing is saved yet.');
    fireEvent.click(within(box).getByRole('button', { name: 'Change the paste' }));
    expect(screen.queryByTestId('recipe-proposed')).toBeNull();
    expect(screen.queryAllByTestId('recipe-line')).toHaveLength(0);
    // Changing the paste keeps the pasted text to correct and read again.
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
    await waitFor(() => expect(screen.getByTestId('drink-card-price')).toHaveTextContent('₺450.00'));
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

  it('a typed 1.125 with oz saves as a decimal; with ml it still stops Save', async () => {
    serve(negroni());
    mount();
    const amounts = await screen.findAllByLabelText('Amount');
    fireEvent.change(amounts[0], { target: { value: '1.125' } });
    // the gin row is in ml: refused with the existing words
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    expect(screen.getByText('Line 1 (gin): 1.125 could be 1125 or 1.125. Type it without the separator.')).toBeInTheDocument();
    fireEvent.change(screen.getAllByLabelText('Unit')[0], { target: { value: 'oz' } });
    expect(screen.queryByText(/could be 1125/)).toBeNull();
    expect(screen.getByRole('button', { name: /^save$/i })).not.toBeDisabled();
  });

  it('round 19: an amount that could be a thousand or one stops Save and says both', async () => {
    serve(negroni());
    mount();
    const amounts = await screen.findAllByLabelText('Amount');
    fireEvent.change(amounts[0], { target: { value: '1,000' } });
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    expect(screen.getByText('Line 1 (gin): 1,000 could be 1000 or 1. Type it without the separator.')).toBeInTheDocument();
    fireEvent.change(amounts[0], { target: { value: '22,500' } });
    expect(screen.getByText('Line 1 (gin): 22,500 could be 22500 or 22.5. Type it without the separator.')).toBeInTheDocument();
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

  it('the old recipe box is not proposed again once a version is saved here', async () => {
    serve(negroni({ legacyLines: [{ label: 'gin', quantity: 1.5, unit: 'oz' }] }));
    mount();
    await screen.findAllByTestId('recipe-line');
    expect(screen.queryByTestId('recipe-proposed')).toBeNull();
    expect(screen.queryByTestId('recipe-legacy')).toBeNull();
  });

  it('a pasted garnish saves as written, 1 each and not counted', async () => {
    serve(EMPTY);
    h.put.mockResolvedValue({ data: { versionId: 'v1', version: 1, lines: [] } });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /paste a spec/i }));
    fireEvent.change(screen.getByLabelText(/paste a spec/i), { target: { value: '2 oz gin\nOrange twist garnish' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read it' }));
    fireEvent.click(within(screen.getByTestId('recipe-proposed')).getByRole('button', { name: 'Use these lines' }));
    const save = screen.getByRole('button', { name: /^save$/i });
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    expect(h.put.mock.calls[0][1].lines).toEqual([
      { role: 'stocked', inventoryId: null, label: 'gin', qty: 2, unit: 'oz' },
      { role: 'untracked', inventoryId: null, label: 'Orange twist garnish', qty: 1, unit: 'each' },
    ]);
  });

  it('a pasted measure off the menu waits for a unit, and Save names the line', async () => {
    serve(EMPTY);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /paste a spec/i }));
    fireEvent.change(screen.getByLabelText(/paste a spec/i), { target: { value: '1 shot gin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read it' }));
    fireEvent.click(within(screen.getByTestId('recipe-proposed')).getByRole('button', { name: 'Use these lines' }));
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    expect(screen.getByText('Line 1 (shot gin) needs a unit.')).toBeInTheDocument();
  });

  it('a paste past 40 lines is refused before it becomes lines, and says so', async () => {
    serve(negroni());
    mount();
    await screen.findAllByTestId('recipe-line');
    fireEvent.click(screen.getByRole('button', { name: /paste a spec/i }));
    const big = Array.from({ length: 45 }, (_, i) => `${i + 1} ml syrup ${i}`).join('\n');
    fireEvent.change(screen.getByLabelText(/paste a spec/i), { target: { value: big } });
    fireEvent.click(screen.getByRole('button', { name: 'Read it' }));
    const box = screen.getByTestId('recipe-proposed');
    expect(within(box).getByTestId('recipe-too-many')).toHaveTextContent('That is 48 lines; a recipe holds at most 40. Remove 8 before saving.');
    // Every proposed row is shown, so any of them can be left out.
    expect(within(box).getAllByRole('listitem')).toHaveLength(45);
    expect(within(box).getByRole('button', { name: 'Use these lines' })).toBeDisabled();
    expect(screen.getAllByTestId('recipe-line')).toHaveLength(3);
  });

  it('more than 40 lines on the sheet stops Save and says how many to remove', async () => {
    const many = Array.from({ length: 41 }, (_, i) => ({ ...line({ label: `syrup ${i}` }), id: `m${i}` }));
    serve(negroni({ current: { ...negroni().current!, lines: many } }));
    mount();
    await waitFor(() => expect(screen.getAllByTestId('recipe-line')).toHaveLength(41));
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    expect(screen.getByText('That is 41 lines; a recipe holds at most 40. Remove 1 before saving.')).toBeInTheDocument();
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

  it('QA round 21: a loaded 1.125 oz line (and the other 3-decimal amounts) saves with no edit', async () => {
    const values = [1.125, 1.375, 2.125, 3.333, 15.625, 999.999];
    const n = negroni();
    serve({
      ...n,
      current: {
        ...n.current!,
        lines: values.map((q, i) => ({ ...linked(`spirit${i}`, 1, GIN), id: `l${i}`, qtyEntered: q, unitCode: 'oz' })),
      },
    });
    h.put.mockResolvedValue({ data: { versionId: V5, version: 5, lines: [] } });
    mount();
    await waitFor(() => expect(screen.getAllByLabelText('Amount')).toHaveLength(values.length));
    expect(amount(0)).toBe('1.125');
    const save = screen.getByRole('button', { name: /^save$/i });
    expect(save).toBeEnabled();
    expect(screen.queryByText(/could be/)).toBeNull();
    fireEvent.click(save);
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    expect(h.put.mock.calls[0][1].lines.map((l: { qty: number }) => l.qty)).toEqual(values);
  });

  it('QA round 21: the same amount typed by hand is still refused (in ml; oz reads it as a decimal), and a loaded one stops being exempt once edited', async () => {
    const n = negroni();
    serve({ ...n, current: { ...n.current!, lines: [{ ...linked('gin', 30, GIN), qtyEntered: 1.125, unitCode: 'ml' }] } });
    mount();
    const box = (await screen.findAllByLabelText('Amount'))[0];
    expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled();
    fireEvent.change(box, { target: { value: '1.12' } });
    fireEvent.change(box, { target: { value: '1.125' } });
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    expect(screen.getByText('Line 1 (gin): 1.125 could be 1125 or 1.125. Type it without the separator.')).toBeInTheDocument();
  });

  it('QA round 21: a save that finishes after the sheet was left clears the draft (no warning, no banner)', async () => {
    serve(negroni());
    let finish: (v: unknown) => void = () => {};
    h.put.mockReturnValueOnce(new Promise((r) => { finish = r; }));
    const view = mount();
    fireEvent.change((await screen.findAllByLabelText('Amount'))[0], { target: { value: '45' } });
    expect(leaveWarns()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    view.unmount();
    expect(leaveWarns()).toBe(true); // still unsaved while the answer is out
    await act(async () => {
      finish({ data: { versionId: V5, version: 5, lines: [] } });
    });
    await waitFor(() => expect(leaveWarns()).toBe(false));
    mount();
    await waitFor(() => expect(screen.getAllByLabelText('Amount')).toHaveLength(3));
    expect(screen.queryByTestId('recipe-restored')).toBeNull();
  });

  it('QA round 21: a refused save after the sheet was left keeps the draft', async () => {
    serve(negroni());
    let fail: (e: unknown) => void = () => {};
    h.put.mockReturnValueOnce(new Promise((_, rej) => { fail = rej; }));
    const view = mount();
    fireEvent.change((await screen.findAllByLabelText('Amount'))[0], { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => {
      fail(Object.assign(new Error('conflict'), { response: { status: 409 } }));
    });
    expect(leaveWarns()).toBe(true);
  });

  it('QA round 21: the draft key names the person, the house and the drink', () => {
    const base = draftKey('u1', RID, CID);
    expect(draftKey('u2', RID, CID)).not.toBe(base);
    expect(draftKey('u1', '99999999-9999-4999-8999-999999999999', CID)).not.toBe(base);
    expect(draftKey('u1', RID, CID2)).not.toBe(base);
  });

  it('QA round 21: a draft kept in one house is not handed to the same person in another', async () => {
    const OTHER = '99999999-9999-4999-8999-999999999999';
    const row = {
      key: 'x1', role: 'stocked' as const, inventoryId: GIN, itemName: 'gin', itemKind: 'spirit', label: 'gin',
      qtyText: '77', unit: 'ml' as const, saved: null,
    };
    keepDraft(draftKey('u1', OTHER, CID), { rows: [row], openedFrom: V4, dirty: true, setAside: null });
    serve(negroni());
    mount();
    await waitFor(() => expect(screen.getAllByLabelText('Amount')).toHaveLength(3));
    expect(amount(0)).toBe('30');
    expect(screen.queryByTestId('recipe-restored')).toBeNull();
  });

  it('QA round 21: staff never take or write a draft', async () => {
    h.auth = { activeRestaurantId: RID, activeRole: 'staff', user: { userId: 'u9', role: 'staff' } };
    const row = {
      key: 'x1', role: 'stocked' as const, inventoryId: GIN, itemName: 'gin', itemKind: 'spirit', label: 'gin',
      qtyText: '77', unit: 'ml' as const, saved: null,
    };
    keepDraft(draftKey('u9', RID, CID), { rows: [row], openedFrom: V4, dirty: true, setAside: null });
    serve(negroni());
    const { container } = mount();
    await screen.findAllByTestId('recipe-line');
    expect(container.textContent).toContain('30 ml');
    expect(container.textContent).not.toContain('77 ml');
    expect(screen.queryByTestId('recipe-restored')).toBeNull();
  });

  it('QA round 21: the leave warning sets returnValue as well as cancelling, for older Chrome and Edge', async () => {
    serve(negroni());
    mount();
    fireEvent.change((await screen.findAllByLabelText('Amount'))[0], { target: { value: '45' } });
    expect(leaveReturnValue()).toBeTruthy();
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

  it('round 19: a mistyped unit in a paste is flagged before use, and Save waits for a unit', async () => {
    serve(EMPTY);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /paste a spec/i }));
    fireEvent.change(screen.getByLabelText(/paste a spec/i), { target: { value: '30 mll gin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read it' }));
    const box = screen.getByTestId('recipe-proposed');
    expect(within(box).getByTestId('recipe-proposed-flag')).toHaveTextContent('"mll" is not a unit I know. Pick the unit.');
    fireEvent.click(within(box).getByRole('button', { name: 'Use these lines' }));
    expect(amount(0)).toBe('30');
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    expect(screen.getByText('Line 1 (mll gin) needs a unit.')).toBeInTheDocument();
  });

  it('round 19: a paste that makes exactly 40 lines can be used; 41 cannot', async () => {
    serve(negroni());
    mount();
    await screen.findAllByTestId('recipe-line');
    const paste = (n: number) => {
      const open = screen.queryByRole('button', { name: /paste a spec/i });
      if (open) fireEvent.click(open);
      fireEvent.change(screen.getByLabelText(/paste a spec/i), {
        target: { value: Array.from({ length: n }, (_, i) => `${i + 1} ml syrup ${i}`).join('\n') },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Read it' }));
      return screen.getByTestId('recipe-proposed');
    };
    let box = paste(38);
    expect(within(box).getByRole('button', { name: 'Use these lines' })).toBeDisabled();
    fireEvent.click(within(box).getByRole('button', { name: 'Discard' }));
    box = paste(37);
    expect(within(box).queryByTestId('recipe-too-many')).toBeNull();
    fireEvent.click(within(box).getByRole('button', { name: 'Use these lines' }));
    expect(screen.getAllByTestId('recipe-line')).toHaveLength(40);
  });
  it('round 17 D8: an earlier version opens to its lines and who saved it, and an editor can start from it', async () => {
    versions = [
      { versionId: V5, version: 5, createdAt: '2026-11-07T11:00:00Z', author: 'u2', authorName: 'Deniz', lineCount: 1 },
      { versionId: V4, version: 4, createdAt: '2026-11-07T10:00:00Z', author: 'u1', authorName: 'Ayşe Bar', lineCount: 3 },
    ];
    const v4 = negroni();
    past = { [V4]: { version: { ...v4.current!, yieldServes: 2, glass: 'Coupe', method: 'Stirred' }, cost: v4.cost } };
    serve(negroniV5());
    h.put.mockResolvedValue({ data: { versionId: 'v6', version: 6, lines: [] } });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Earlier versions (1)' }));
    const list = await screen.findByTestId('recipe-versions');
    expect(list).toHaveTextContent('Ayşe Bar');
    fireEvent.click(within(list).getByRole('button', { name: /Version 4/ }));
    const opened = await screen.findByTestId('recipe-past-version');
    expect(within(opened).getAllByTestId('recipe-line')).toHaveLength(3);
    expect(opened).toHaveTextContent("Would cost ₺57.00 a serve at today's prices.");
    expect(within(opened).queryByLabelText('Amount')).toBeNull();

    fireEvent.click(within(opened).getByRole('button', { name: 'Start from version 4' }));
    expect(screen.getAllByLabelText('Amount')).toHaveLength(3);
    expect(screen.getByTestId('recipe-said')).toHaveTextContent('Version 4 is on the sheet. Nothing is saved yet');
    expect(screen.getByRole('region', { name: 'Recipe for Negroni' })).toHaveTextContent('Coupe');

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    const body = h.put.mock.calls[0][1];
    // A new version over the current one, carrying version 4's serves and glass.
    expect(body).toMatchObject({ expectedVersionId: V5, yieldServes: 2, glass: 'Coupe', method: 'Stirred' });
    expect(body.lines.map((l: { label: string }) => l.label)).toEqual(['gin', 'Campari', 'sweet vermouth']);
  });

  it('round 17 D8: starting from an earlier version sets a typed draft aside rather than dropping it', async () => {
    versions = [{ versionId: V4, version: 4, createdAt: '2026-11-07T10:00:00Z', author: null, lineCount: 3 }];
    past = { [V4]: { version: negroni().current!, cost: null } };
    serve(negroniV5());
    mount();
    fireEvent.change((await screen.findAllByLabelText('Amount'))[0], { target: { value: '55' } });
    fireEvent.click(screen.getByRole('button', { name: 'Earlier versions (1)' }));
    fireEvent.click(await screen.findByRole('button', { name: /Version 4/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start from version 4' }));
    expect(screen.getAllByLabelText('Amount')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Put my lines back' }));
    expect(screen.getAllByLabelText('Amount')).toHaveLength(1);
    expect(amount(0)).toBe('55');
  });

  it('round 17 D8: staff open an earlier version to read, with no money and nothing to start from', async () => {
    h.auth = { activeRestaurantId: RID, activeRole: 'staff', user: { role: 'staff' } };
    versions = [{ versionId: V4, version: 4, createdAt: '2026-11-07T10:00:00Z', author: null, lineCount: 3 }];
    const v4 = negroni().current!;
    past = { [V4]: { version: { ...v4, lines: v4.lines.map((l) => ({ ...l, costPerServe: null })) }, cost: null } };
    serve(negroniV5());
    const { container } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Earlier versions (1)' }));
    fireEvent.click(await screen.findByRole('button', { name: /Version 4/ }));
    expect(await screen.findByTestId('recipe-past-version')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start from/ })).toBeNull();
    expect(container.textContent).not.toMatch(/₺/);
  });

  it('round 17 D9: a line linked to an archived good stops Save and says which', async () => {
    const n = negroni();
    serve({ ...n, current: { ...n.current!, lines: [{ ...n.current!.lines[0], itemGone: 'archived' }, ...n.current!.lines.slice(1)] } });
    mount();
    await screen.findAllByLabelText('Amount');
    fireEvent.change(screen.getAllByLabelText('Amount')[1], { target: { value: '25' } });
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    expect(screen.getByText('Line 1 (gin) is linked to something archived from your shelf. Link it again, or mark it not counted.')).toBeInTheDocument();
  });

  it('a complete cost priced partly from uninvoiced stock says so on the cost card', async () => {
    serve(negroni({ cost: { perServe: 57, priced: 3, of: 3, complete: true, partial: 1 } }));
    mount();
    expect(await screen.findByTestId('drink-card-cost')).toHaveTextContent(
      "₺57.00At today's prices; 1 ingredient is priced from the bottles with an invoice only.",
    );
  });

  it('round 19: a drink gone from the house (404) drops its kept draft, so leaving no longer warns', async () => {
    keepDraft(draftKey('u1', RID, CID), { rows: [], openedFrom: null, dirty: true, setAside: null });
    expect(leaveWarns()).toBe(true);
    h.get.mockImplementation(async (url: string) => {
      if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'TRY', readable: true } };
      throw Object.assign(new Error('gone'), { response: { status: 404, data: { message: "This drink is not on this house's list." } } });
    });
    mount();
    expect(await screen.findByTestId('recipe-unread')).toBeInTheDocument();
    await waitFor(() => expect(leaveWarns()).toBe(false));
  });
  it('round 17: an editor sets the serves, glass, garnish and method, and the save carries them', async () => {
    serve(negroni());
    h.put.mockResolvedValue({ data: { versionId: 'v5', version: 5, lines: [] } });
    mount();
    const meta = await screen.findByTestId('recipe-meta');
    const serves = within(meta).getByLabelText(/Makes/);
    expect(serves).toHaveValue(1);
    fireEvent.change(serves, { target: { value: '20' } });
    fireEvent.change(within(meta).getByLabelText('Glass'), { target: { value: 'Coupe' } });
    fireEvent.change(within(meta).getByLabelText('Garnish'), { target: { value: '' } });
    fireEvent.change(within(meta).getByLabelText('Method'), { target: { value: 'Batch, then stir over ice' } });
    // The cost shown is still the saved recipe's, and says so.
    const cards = screen.getByTestId('drink-cards');
    expect(cards).toHaveTextContent("These are the saved recipe’s figures. Save to count your changes.");
    expect(within(cards).getByTestId('drink-card-cost')).toHaveTextContent('₺57.00');
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    const body = h.put.mock.calls[0][1];
    expect(body).toMatchObject({ yieldServes: 20, glass: 'Coupe', method: 'Batch, then stir over ice' });
    // An emptied garnish is not sent, so the new version has none.
    expect(body).not.toHaveProperty('garnish');
  });

  it.each(['', '0', '2.5', '1001'])('serves of %j stop Save and say what is wanted', async (v) => {
    serve(negroni());
    mount();
    fireEvent.change(within(await screen.findByTestId('recipe-meta')).getByLabelText(/Makes/), { target: { value: v } });
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    expect(screen.getByText('Say how many serves it makes: a whole number from 1 to 1,000.')).toBeInTheDocument();
  });

  it('staff read the method, with no fields', async () => {
    h.auth = { activeRestaurantId: RID, activeRole: 'staff', user: { role: 'staff' } };
    serve(negroni({ cost: null }));
    mount();
    expect(await screen.findByTestId('recipe-method')).toHaveTextContent('Stirred');
    expect(screen.queryByTestId('recipe-meta')).toBeNull();
  });

  it('round 19: a 45-line old recipe box can be used by leaving rows out one at a time', async () => {
    const legacyLines = Array.from({ length: 45 }, (_, i) => ({ label: `syrup ${i}`, quantity: 5, unit: 'ml' }));
    serve({ ...EMPTY, legacyLines });
    mount();
    const box = await screen.findByTestId('recipe-proposed');
    expect(within(box).getByRole('button', { name: 'Use these lines' })).toBeDisabled();
    expect(within(box).getByTestId('recipe-too-many')).toHaveTextContent('Leave some out below');
    for (let i = 0; i < 5; i++) fireEvent.click(within(box).getAllByRole('button', { name: /^Leave out/ })[0]);
    expect(within(box).getAllByTestId('recipe-proposed-line')).toHaveLength(40);
    fireEvent.click(within(box).getByRole('button', { name: 'Use these lines' }));
    expect(screen.getAllByTestId('recipe-line')).toHaveLength(40);
    expect(screen.getAllByLabelText('Amount').map((a) => (a as HTMLInputElement).value)[0]).toBe('5');
  });

  it('leaving out the last proposed row closes the proposal; Discard clears the paste box', async () => {
    serve(EMPTY);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /paste a spec/i }));
    fireEvent.change(screen.getByLabelText(/paste a spec/i), { target: { value: '30 ml gin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read it' }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave out gin' }));
    expect(screen.queryByTestId('recipe-proposed')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Read it' }));
    fireEvent.click(within(screen.getByTestId('recipe-proposed')).getByRole('button', { name: 'Discard' }));
    expect(screen.queryByLabelText(/paste a spec/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /paste a spec/i }));
    expect(screen.getByLabelText(/paste a spec/i)).toHaveValue('');
  });

  it('round 19: unused paste-box text is kept for the session, A -> B -> A, and leaving warns', async () => {
    serve(negroni());
    other = margarita();
    const { rerender } = mountSwitchable(CID);
    fireEvent.click(await screen.findByRole('button', { name: /paste a spec/i }));
    fireEvent.change(screen.getByLabelText(/paste a spec/i), { target: { value: '30 ml mezcal' } });
    expect(leaveWarns()).toBe(true);
    rerender(<RecipeSheet cocktailId={CID2} />);
    await screen.findByRole('region', { name: 'Recipe for Margarita' });
    rerender(<RecipeSheet cocktailId={CID} />);
    expect(await screen.findByLabelText(/paste a spec/i)).toHaveValue('30 ml mezcal');
  });

  it('the same good on two counted lines is said, not merged', async () => {
    const n = negroni();
    serve(negroni({ current: { ...n.current!, lines: [linked('gin', 30, GIN), { ...linked('gin', 15, GIN), id: 'gin-2' }] } }));
    mount();
    expect(await screen.findByTestId('recipe-repeated')).toHaveTextContent('gin is on 2 lines; a serve takes all of them.');
  });
});

describe('RecipeSheet: the cost of unsaved lines', () => {
  const PREVIEW_URL = `/recipes/${RID}/cocktails/${CID}/cost-preview`;
  const previewAnswer = {
    perServe: 60,
    perServeExact: 60,
    priced: 3,
    of: 3,
    complete: true,
    partial: 0,
    lines: [
      { status: 'linked', costPerServe: 30, costBasis: 'lot_wac' },
      { status: 'linked', costPerServe: 22.5, costBasis: 'lot_wac' },
      { status: 'linked', costPerServe: 7.5, costBasis: 'lot_wac' },
    ],
  };
  const later = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  it('asks the gateway once, 400 ms after the last edit of a whole draft, and shows its cost', async () => {
    serve(negroni());
    h.post.mockResolvedValue({ data: previewAnswer });
    mount();
    const amounts = await screen.findAllByLabelText('Amount');
    vi.useFakeTimers();
    try {
      fireEvent.change(amounts[1], { target: { value: '2' } });
      await later(300);
      fireEvent.change(amounts[1], { target: { value: '22,5' } });
      await later(399);
      expect(h.post).not.toHaveBeenCalled();
      await later(1);
      expect(h.post).toHaveBeenCalledTimes(1);
      await later(2000);
      expect(h.post).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
    const [url, body] = h.post.mock.calls[0];
    expect(url).toBe(PREVIEW_URL);
    expect(body).toEqual({
      yieldServes: 1,
      lines: [
        { role: 'stocked', inventoryId: GIN, qtyEntered: 30, unitCode: 'ml' },
        { role: 'stocked', inventoryId: '55555555-5555-4555-8555-555555555555', qtyEntered: 22.5, unitCode: 'ml' },
        { role: 'stocked', inventoryId: '66666666-6666-4666-8666-666666666666', qtyEntered: 30, unitCode: 'ml' },
      ],
    });
    await waitFor(() => expect(screen.getByTestId('drink-card-cost')).toHaveTextContent("Your unsaved lines, at today's prices."));
    expect(screen.getByTestId('drink-card-cost')).toHaveTextContent('60');
    expect(h.put).not.toHaveBeenCalled();
  });

  it('never asks while the sheet is clean', async () => {
    serve(negroni());
    mount();
    await screen.findAllByLabelText('Amount');
    vi.useFakeTimers();
    try {
      await later(2000);
    } finally {
      vi.useRealTimers();
    }
    expect(h.post).not.toHaveBeenCalled();
  });

  it('never asks while a stocked line has no amount, and keeps the saved figures', async () => {
    serve(negroni());
    h.post.mockResolvedValue({ data: previewAnswer });
    mount();
    const amounts = await screen.findAllByLabelText('Amount');
    vi.useFakeTimers();
    try {
      fireEvent.change(amounts[1], { target: { value: '' } });
      await later(2000);
    } finally {
      vi.useRealTimers();
    }
    expect(h.post).not.toHaveBeenCalled();
    expect(screen.getByTestId('drink-card-cost')).toHaveTextContent("At today's prices");
    expect(screen.getByTestId('drink-cards')).toHaveTextContent('Save to count your changes.');
  });

  it('never asks while a stocked line is not linked to the shelf', async () => {
    serve(negroni({ current: { ...negroni().current!, lines: [linked('gin', 30, GIN), line({ label: 'Campari' })] }, cost: { perServe: null, priced: 1, of: 2, complete: false } }));
    h.post.mockResolvedValue({ data: previewAnswer });
    mount();
    const amounts = await screen.findAllByLabelText('Amount');
    vi.useFakeTimers();
    try {
      fireEvent.change(amounts[0], { target: { value: '40' } });
      await later(2000);
    } finally {
      vi.useRealTimers();
    }
    expect(h.post).not.toHaveBeenCalled();
  });

  it('keeps the saved figures and the old note when the gateway cannot price the draft', async () => {
    serve(negroni());
    h.post.mockRejectedValue(Object.assign(new Error('down'), { response: { status: 503 } }));
    mount();
    const amounts = await screen.findAllByLabelText('Amount');
    fireEvent.change(amounts[1], { target: { value: '22,5' } });
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('drink-card-cost')).toHaveTextContent("At today's prices");
    expect(screen.getByTestId('drink-cards')).toHaveTextContent('Save to count your changes.');
  });

  it('a drink never saved, even with no price on the list, shows its draft cost once its lines are whole', async () => {
    serve({ ...EMPTY, cocktail: { ...EMPTY.cocktail, price: null } }, [
      { id: GIN, name: 'Tanqueray gin', kind: 'spirit', uom: 'bottle', bottleSizeMl: 700 },
    ]);
    h.post.mockResolvedValue({
      data: { ...previewAnswer, perServe: 30, perServeExact: 30, priced: 1, of: 1, lines: [previewAnswer.lines[0]] },
    });
    mount();
    // Before anything is typed, a never-saved drink has no cards at all.
    fireEvent.click(await screen.findByRole('button', { name: /add an ingredient/i }));
    expect(screen.queryByTestId('drink-cards')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /link it to your shelf/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Tanqueray gin/ }));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '30' } });
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(1));
    const [url, body] = h.post.mock.calls[0];
    expect(url).toBe(PREVIEW_URL);
    expect(body).toEqual({ yieldServes: 1, lines: [{ role: 'stocked', inventoryId: GIN, qtyEntered: 30, unitCode: 'ml' }] });
    await waitFor(() => expect(screen.getByTestId('drink-card-cost')).toHaveTextContent("Your unsaved lines, at today's prices."));
    expect(screen.getByTestId('drink-card-cost')).toHaveTextContent('30');
    expect(screen.getByTestId('drink-cards')).toHaveTextContent('Nothing else is counted until the recipe is saved.');
    expect(screen.getByTestId('drink-card-price')).toHaveTextContent('No price');
    expect(h.put).not.toHaveBeenCalled();
  });

  it('staff never ask about a drink never saved either', async () => {
    h.auth = { activeRestaurantId: RID, activeRole: 'staff', user: { role: 'staff' } };
    serve({ ...EMPTY, cocktail: { ...EMPTY.cocktail, price: null } });
    mount();
    await screen.findByTestId('recipe-sheet');
    expect(h.post).not.toHaveBeenCalled();
    expect(screen.queryByTestId('drink-cards')).toBeNull();
  });

  it('staff never ask: they see no money', async () => {
    h.auth = { activeRestaurantId: RID, activeRole: 'staff', user: { role: 'staff' } };
    serve(negroni({ cost: null, cocktail: { ...negroni().cocktail, price: null } }));
    mount();
    await screen.findByTestId('recipe-sheet');
    expect(h.post).not.toHaveBeenCalled();
  });
});

describe('a pasted line proposes its shelf item by exact name (ADR 0366 item 7)', () => {
  const BOLS = { id: GIN, name: 'Bols Gin', kind: 'spirit', uom: 'bottle', bottleSizeMl: 700 };
  const shelfAnswers = (answer: (labels: string[]) => Promise<unknown>) =>
    h.post.mockImplementation((url: string, body: { labels: string[] }) =>
      url === `/recipes/${RID}/shelf/match` ? answer(body.labels) : new Promise(() => undefined),
    );
  const read = async (text: string) => {
    fireEvent.click(await screen.findByRole('button', { name: /paste a spec/i }));
    fireEvent.change(screen.getByLabelText(/paste a spec/i), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: 'Read it' }));
    return screen.getByTestId('recipe-proposed');
  };
  const useAndSave = async () => {
    fireEvent.click(within(screen.getByTestId('recipe-proposed')).getByRole('button', { name: 'Use these lines' }));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    return h.put.mock.calls[0][1].lines as Array<{ inventoryId: string | null; label: string }>;
  };

  beforeEach(() => {
    serve(EMPTY);
    h.put.mockResolvedValue({ data: { versionId: 'v1', version: 1, lines: [] } });
  });

  it('asks the shelf once for the counted lines, shows the link, and saves it only on Save', async () => {
    shelfAnswers(async (labels) => ({ data: labels.map((label) => ({ label, item: label === 'Bols Gin' ? BOLS : null, sameName: label === 'Bols Gin' ? 1 : 0 })) }));
    mount();
    const box = await read('2 oz Bols Gin\n1 oz lime juice\nOrange twist garnish');
    expect(await within(box).findByTestId('recipe-proposed-link')).toHaveTextContent('links to Bols Gin');
    expect(h.post).toHaveBeenCalledTimes(1);
    // The garnish is not counted, so it is not asked about.
    expect(h.post.mock.calls[0][1]).toEqual({ labels: ['Bols Gin', 'lime juice'] });
    expect(h.put).not.toHaveBeenCalled();
    const lines = await useAndSave();
    expect(lines.map((l) => l.inventoryId)).toEqual([GIN, null, null]);
  });

  it('"Do not link" drops the proposed link, and the line saves unlinked', async () => {
    shelfAnswers(async () => ({ data: [{ label: 'Bols Gin', item: BOLS, sameName: 1 }] }));
    mount();
    const box = await read('2 oz Bols Gin');
    fireEvent.click(await within(box).findByRole('button', { name: 'Do not link Bols Gin to Bols Gin' }));
    expect(within(box).queryByTestId('recipe-proposed-link')).toBeNull();
    expect((await useAndSave())[0].inventoryId).toBeNull();
  });

  it('two shelf items of one name link neither, and say how many', async () => {
    shelfAnswers(async () => ({ data: [{ label: 'sugar syrup', item: null, sameName: 2 }] }));
    mount();
    const box = await read('10 ml sugar syrup');
    expect(await within(box).findByTestId('recipe-proposed-same-name')).toHaveTextContent('2 shelf items have this name, so none is linked');
    expect((await useAndSave())[0].inventoryId).toBeNull();
  });

  it('a shelf that cannot be read says so, and links nothing', async () => {
    shelfAnswers(async () => {
      throw Object.assign(new Error('down'), { response: { status: 503 } });
    });
    mount();
    const box = await read('2 oz Bols Gin');
    expect(await within(box).findByTestId('recipe-proposed-unread')).toHaveTextContent('could not be read');
    expect((await useAndSave())[0].inventoryId).toBeNull();
  });

  it("an older paste's late answer never links the newer paste's lines", async () => {
    const answers: Array<(v: unknown) => void> = [];
    h.post.mockImplementation(() => new Promise((ok) => answers.push(ok)));
    mount();
    let box = await read('2 oz Bols Gin');
    fireEvent.click(within(box).getByRole('button', { name: 'Change the paste' }));
    fireEvent.click(screen.getByRole('button', { name: 'Read it' }));
    box = screen.getByTestId('recipe-proposed');
    expect(answers).toHaveLength(2);
    // The first paste's answer arrives while the second is still looking: it is dropped.
    await act(async () => answers[0]({ data: [{ label: 'Bols Gin', item: BOLS, sameName: 1 }] }));
    expect(within(box).queryByTestId('recipe-proposed-link')).toBeNull();
    expect(within(box).getByTestId('recipe-proposed-looking')).toBeInTheDocument();
    await act(async () => answers[1]({ data: [{ label: 'Bols Gin', item: null, sameName: 0 }] }));
    expect(within(box).queryByTestId('recipe-proposed-looking')).toBeNull();
    expect(within(box).queryByTestId('recipe-proposed-link')).toBeNull();
  });

  it('a proposed line carries only a linked item into the draft', () => {
    const p = { qty: 2, unit: 'oz' as const, label: 'Bols Gin', role: 'stocked' as const, confirmed: false as const, flag: null };
    expect(fromProposal({ ...p, link: { status: 'linked', item: BOLS } })).toMatchObject({ inventoryId: GIN, itemName: 'Bols Gin', itemUom: 'bottle' });
    expect(fromProposal({ ...p, link: { status: 'same-name', n: 2 } }).inventoryId).toBeNull();
    expect(fromProposal({ ...p, link: { status: 'looking' } }).inventoryId).toBeNull();
  });
});

describe('a fresh line starts in the unit its kind measures by', () => {
  function mountDish() {
    h.get.mockImplementation(async (url: string) => {
      if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'TRY', country: 'Turkey', readable: true, reason: null, statedAt: null } };
      if (url === `/recipes/${RID}/dishes/${CID}`) {
        const { cocktail, ...rest } = EMPTY;
        return { data: { ...rest, dish: { id: cocktail.id, name: 'Lemon Tart', section: null, price: null, description: null } } };
      }
      if (url === `/recipes/${RID}/shelf`) return { data: [] };
      if (url === `/recipes/${RID}/dishes/${CID}/versions`) return { data: [] };
      throw new Error(`unexpected GET ${url}`);
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    return render(<RecipeSheet dishId={CID} />, { wrapper: wrap });
  }
  const lastUnit = () => {
    const units = document.querySelectorAll<HTMLSelectElement>('select.cl-rcp-unit');
    return units[units.length - 1].value;
  };

  it('a dish line starts in grams', async () => {
    mountDish();
    fireEvent.click(await screen.findByRole('button', { name: 'Add an ingredient' }));
    expect(lastUnit()).toBe('g');
  });

  it('a drink line still starts in ml', async () => {
    serve(EMPTY);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Add an ingredient' }));
    expect(lastUnit()).toBe('ml');
  });
});
