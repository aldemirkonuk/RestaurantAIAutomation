/**
 * r28 recipes audit, gap 8: a recipe line whose search finds nothing on the
 * shelf can add the good there and link to it, without leaving the sheet.
 * Each case fails without this slice.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

const RID = '11111111-1111-4111-8111-111111111111';
const NEW = '55555555-5555-4555-8555-555555555555';
const OLD = '66666666-6666-4666-8666-666666666666';

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('../../../../services/api/client', () => ({ apiClient: { get: h.get, post: h.post, put: h.put } }));
vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => ({ activeRestaurantId: '11111111-1111-4111-8111-111111111111' }) }));

import LineRow, { type DraftRow } from './LineRow';
import { ADD_KINDS, uomForLine } from './AddToShelf';

const blank = (over: Partial<DraftRow> = {}): DraftRow => ({
  key: 'r1', role: 'stocked', inventoryId: null, itemName: null, itemKind: null, itemUom: null,
  label: 'Yuzu juice', qtyText: '20', unit: 'ml', saved: null, ...over,
});

let qc: QueryClient;
let last: DraftRow;
function Harness({ start, kind }: { start: DraftRow; kind?: 'cocktail' | 'dish' }) {
  const [row, setRow] = useState(start);
  last = row;
  return (
    <ol>
      <LineRow row={row} say={null} kind={kind} onChange={(p) => setRow((r) => ({ ...r, ...p }))} onRemove={() => {}} />
    </ol>
  );
}
function mount(node: ReactNode) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}
async function openEmptySearch(start = blank(), kind?: 'cocktail' | 'dish') {
  mount(<Harness start={start} kind={kind} />);
  fireEvent.click(screen.getByRole('button', { name: /find it on your shelf|link/i }));
  return screen.findByTestId('shelf-add');
}

beforeEach(() => {
  h.get.mockReset();
  h.post.mockReset();
  h.get.mockResolvedValue({ data: [] });
});

describe('the good each line unit meets without a weight', () => {
  it('is ml for a volume, g for a weight, a piece for a piece', () => {
    expect(uomForLine('ml')).toBe('ml');
    expect(uomForLine('oz')).toBe('ml');
    expect(uomForLine('dash')).toBe('ml');
    expect(uomForLine('g')).toBe('g');
    expect(uomForLine('kg')).toBe('g');
    expect(uomForLine('each')).toBe('each');
    expect(uomForLine('')).toBe('ml');
  });
  it('offers only kinds the house-item route takes, food first on a dish and spirit first on a drink', () => {
    const route = ['beer', 'whiskey', 'spirit', 'liqueur', 'cocktail', 'sake', 'cider', 'non_alcoholic', 'soft_drink', 'food', 'supply', 'other'];
    for (const [k] of [...ADD_KINDS.cocktail, ...ADD_KINDS.dish]) expect(route).toContain(k);
    expect(ADD_KINDS.dish[0][0]).toBe('food');
    expect(ADD_KINDS.cocktail[0][0]).toBe('spirit');
  });
});

describe('a search that finds nothing', () => {
  it('offers to add what was typed', async () => {
    const add = await openEmptySearch();
    expect(add.textContent).toBe('Add “Yuzu juice” to your shelf');
    expect(screen.getByRole('status').textContent).toBe('Nothing on your shelf matches “Yuzu juice”.');
  });

  it('adds it under the typed name, kind and the line\'s unit, then links the line', async () => {
    h.post.mockResolvedValue({ data: { id: NEW, kind: 'non_alcoholic', uom: 'ml', displayName: 'Yuzu juice' } });
    fireEvent.click(await openEmptySearch());
    fireEvent.change(screen.getByLabelText('What it is'), { target: { value: 'non_alcoholic' } });
    expect((screen.getByLabelText('Counted') as HTMLSelectElement).value).toBe('ml');
    fireEvent.click(screen.getByRole('button', { name: 'Add and link' }));
    await screen.findByTestId('shelf-added');
    expect(h.post).toHaveBeenCalledWith(`/inventory/${RID}/house-items`, { kind: 'non_alcoholic', uom: 'ml', displayName: 'Yuzu juice' });
    expect(last.inventoryId).toBe(NEW);
    expect(last.itemName).toBe('Yuzu juice');
    expect(last.itemUom).toBe('ml');
    expect(last.saved).toBeNull();
    expect(screen.getByTestId('shelf-added').textContent).toBe(
      'Yuzu juice is on your shelf now, with no stock until a delivery of it is checked in.',
    );
    expect(screen.queryByTestId('shelf-picker')).toBeNull();
  });

  it('starts a dish\'s good as food counted by weight when the line is weighed', async () => {
    h.post.mockResolvedValue({ data: { id: NEW, kind: 'food', uom: 'g', displayName: 'Sumac' } });
    fireEvent.click(await openEmptySearch(blank({ label: 'Sumac', unit: 'g', qtyText: '3' }), 'dish'));
    fireEvent.click(screen.getByRole('button', { name: 'Add and link' }));
    await screen.findByTestId('shelf-added');
    expect(h.post).toHaveBeenCalledWith(`/inventory/${RID}/house-items`, { kind: 'food', uom: 'g', displayName: 'Sumac' });
  });

  it('sends the name as edited, trimmed', async () => {
    h.post.mockResolvedValue({ data: { id: NEW, kind: 'spirit', uom: 'ml', displayName: 'Yuzu sake' } });
    fireEvent.click(await openEmptySearch());
    fireEvent.change(screen.getByLabelText('Name on your shelf'), { target: { value: '  Yuzu sake ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add and link' }));
    await screen.findByTestId('shelf-added');
    expect(h.post.mock.calls[0][1].displayName).toBe('Yuzu sake');
  });

  it('refuses an empty name without asking the gateway', async () => {
    fireEvent.click(await openEmptySearch());
    fireEvent.change(screen.getByLabelText('Name on your shelf'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add and link' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Give it a name of 1 to 120 characters.');
    expect(h.post).not.toHaveBeenCalled();
  });

  it('refuses a name over 120 characters without asking the gateway', async () => {
    fireEvent.click(await openEmptySearch());
    fireEvent.change(screen.getByLabelText('Name on your shelf'), { target: { value: 'x'.repeat(121) } });
    fireEvent.click(screen.getByRole('button', { name: 'Add and link' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Give it a name of 1 to 120 characters.');
    expect(h.post).not.toHaveBeenCalled();
  });

  it('links to the good the house already carries instead of doubling it', async () => {
    h.post.mockRejectedValue({ response: { status: 409, data: { message: 'This house already carries Yuzu juice', existingId: OLD } } });
    fireEvent.click(await openEmptySearch());
    fireEvent.click(screen.getByRole('button', { name: 'Add and link' }));
    await screen.findByTestId('shelf-added');
    expect(last.inventoryId).toBe(OLD);
    expect(screen.getByTestId('shelf-added').textContent).toBe('Your shelf already carries Yuzu juice, so this line is linked to it.');
  });

  it('says a refusal in the gateway\'s words and leaves the line unlinked', async () => {
    h.post.mockRejectedValue({ response: { status: 403, data: { message: 'Only an owner or manager can do that.' } } });
    fireEvent.click(await openEmptySearch());
    fireEvent.click(screen.getByRole('button', { name: 'Add and link' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Yuzu juice was not added: Only an owner or manager can do that.');
    expect(last.inventoryId).toBeNull();
  });

  it('a 409 without a good to link is a refusal, not a link', async () => {
    h.post.mockRejectedValue({ response: { status: 409, data: { message: 'Already there' } } });
    fireEvent.click(await openEmptySearch());
    fireEvent.click(screen.getByRole('button', { name: 'Add and link' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Yuzu juice was not added: Already there');
    expect(last.inventoryId).toBeNull();
  });

  it('links only on a 409: another refusal naming a good still refuses', async () => {
    h.post.mockRejectedValue({ response: { status: 403, data: { message: 'Only an owner or manager can do that.', existingId: OLD } } });
    fireEvent.click(await openEmptySearch());
    fireEvent.click(screen.getByRole('button', { name: 'Add and link' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Yuzu juice was not added: Only an owner or manager can do that.');
    expect(last.inventoryId).toBeNull();
  });

  it('says a missing route in the house\'s words, never the internal path', async () => {
    h.post.mockRejectedValue({ response: { status: 404, data: { message: 'Cannot POST /inventory/x/house-items' } } });
    fireEvent.click(await openEmptySearch());
    fireEvent.click(screen.getByRole('button', { name: 'Add and link' }));
    const said = (await screen.findByRole('alert')).textContent ?? '';
    expect(said).toBe('Yuzu juice was not added: this house cannot add a good from a recipe yet. Add it on the Inventory page, then pick it here.');
    expect(said).not.toContain('/inventory');
  });

  it('re-reads the shelf after adding, so the next search finds the good', async () => {
    h.post.mockResolvedValue({ data: { id: NEW, kind: 'spirit', uom: 'ml', displayName: 'Yuzu juice' } });
    fireEvent.click(await openEmptySearch());
    const spy = vi.spyOn(qc, 'invalidateQueries');
    fireEvent.click(screen.getByRole('button', { name: 'Add and link' }));
    await screen.findByTestId('shelf-added');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['recipes', 'shelf', RID] });
  });

  it('Cancel goes back to the offer without adding', async () => {
    fireEvent.click(await openEmptySearch());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('shelf-add')).toBeTruthy();
    expect(screen.queryByTestId('shelf-add-form')).toBeNull();
    expect(h.post).not.toHaveBeenCalled();
  });

  it('is not offered when the shelf has a match', async () => {
    h.get.mockResolvedValue({ data: [{ id: OLD, name: 'Yuzu juice', kind: 'food', uom: 'ml', bottleSizeMl: null }] });
    mount(<Harness start={blank()} />);
    fireEvent.click(screen.getByRole('button', { name: /find it on your shelf|link/i }));
    await screen.findByRole('list', { name: 'On your shelf' });
    expect(screen.queryByTestId('shelf-add')).toBeNull();
  });

  it('is not offered on an empty search', async () => {
    mount(<Harness start={blank({ label: '' })} />);
    fireEvent.click(screen.getByRole('button', { name: /find it on your shelf|link/i }));
    await screen.findByText('Your shelf has nothing on it yet.');
    expect(screen.queryByTestId('shelf-add')).toBeNull();
  });

  it('shows Adding… while the gateway answers', async () => {
    let done: (v: unknown) => void = () => {};
    h.post.mockReturnValue(new Promise((r) => { done = r; }));
    fireEvent.click(await openEmptySearch());
    fireEvent.click(screen.getByRole('button', { name: 'Add and link' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Adding…' })).toHaveProperty('disabled', true));
    await act(async () => done({ data: { id: NEW, kind: 'spirit', uom: 'ml', displayName: 'Yuzu juice' } }));
  });
});
