/**
 * r28 recipes audit, gap 7, slice 3: a saved line that waits for a weight
 * says which one, and an owner or manager can state it on the line. Each case
 * fails without this slice.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

const RID = '11111111-1111-4111-8111-111111111111';
const EGGS = '44444444-4444-4444-8444-444444444444';

const h = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn() }));
vi.mock('../../../../services/api/client', () => ({ apiClient: { put: h.put, get: h.get } }));
vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => ({ activeRestaurantId: '11111111-1111-4111-8111-111111111111' }) }));

import LineRow, { rowNote, weightNeeded, type DraftRow } from './LineRow';
import { readWeight, weighLabel } from './WeighBox';

const say = (n: number) => `₺${n.toFixed(2)}`;
const eggs = (over: Partial<DraftRow> = {}, saved: Partial<NonNullable<DraftRow['saved']>> = {}): DraftRow => ({
  key: 'r1', role: 'stocked', inventoryId: EGGS, itemName: 'Eggs', itemKind: 'food', itemUom: 'kg',
  label: 'Eggs', qtyText: '2', unit: 'each',
  saved: { status: 'linked', costPerServe: null, costBasis: 'unit_mismatch', needs: 'piece_grams', ...saved },
  ...over,
});

let qc: QueryClient;
function mount(node: ReactNode) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}
const weighed = vi.fn();
function Harness({ start, money = say, kind }: { start: DraftRow; money?: ((n: number) => string) | null; kind?: 'cocktail' | 'dish' }) {
  const [row, setRow] = useState(start);
  return (
    <ol>
      <LineRow row={row} say={money} kind={kind} onChange={(p) => setRow((r) => ({ ...r, ...p }))} onRemove={() => {}} onWeighed={weighed} />
    </ol>
  );
}

beforeEach(() => {
  h.put.mockReset();
  weighed.mockReset();
});

describe('a line that waits for a weight', () => {
  it('says what it waits for, in the line and the good\'s own words', () => {
    expect(rowNote(eggs(), say, undefined)?.text).toBe(
      'No price yet: this line is counted by the piece, but Eggs is counted in kg. Say what one weighs, and every drink with Eggs is priced from that.',
    );
    const flour = eggs({ itemName: 'Flour', unit: 'tbsp' }, { needs: 'ml_grams' });
    expect(rowNote(flour, say, undefined)?.text).toBe(
      'No price yet: this line is measured by volume, but Flour is counted in kg. Say what one ml of it weighs, and every drink with Flour is priced from that.',
    );
  });

  it('says "dish" on a dish\'s sheet', () => {
    mount(<Harness start={eggs()} kind="dish" />);
    expect(screen.getByText(/every dish with Eggs is priced from that/)).toBeTruthy();
  });

  it('keeps the plain mismatch sentence when the gateway names no weight', () => {
    expect(rowNote(eggs({}, { needs: null }), say, undefined)?.text).toMatch(/^No price: this line is counted by the piece, but Eggs is counted in kg\. Change the unit/);
    expect(weightNeeded(eggs({}, { needs: undefined }))).toBeNull();
  });

  it.each([
    ['a line that is priced', eggs({}, { costPerServe: 1.5, costBasis: 'last_purchase_price' })],
    ['a line with another reason', eggs({}, { costBasis: 'size_not_known' })],
    ['an edited line', eggs({ saved: null })],
    ['an unlinked line', eggs({ inventoryId: null })],
    ['a line whose good was archived', eggs({ itemGone: 'archived' })],
    ['a line not counted', eggs({ role: 'untracked' })],
  ])('asks nothing of %s', (_n, row) => {
    expect(weightNeeded(row)).toBeNull();
  });

  it('offers the box to an editor who sees money, labelled for the good', () => {
    mount(<Harness start={eggs()} />);
    expect(screen.getByLabelText('Eggs: one piece weighs')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep' })).toBeTruthy();
  });

  it('offers no box without money: nothing in it is theirs to see priced', () => {
    mount(<Harness start={eggs()} money={null} />);
    expect(screen.queryByTestId('recipe-line-weigh')).toBeNull();
  });

  it('keeps one egg\'s weight on the good, read with a comma, and says so to the sheet', async () => {
    h.put.mockResolvedValue({ data: { id: EGGS, pieceGrams: 60.5, mlGrams: null } });
    mount(<Harness start={eggs()} />);
    const spy = vi.spyOn(qc, 'invalidateQueries');
    fireEvent.change(screen.getByLabelText('Eggs: one piece weighs'), { target: { value: '60,5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    await waitFor(() => expect(weighed).toHaveBeenCalledWith(EGGS, { id: EGGS, pieceGrams: 60.5, mlGrams: null }));
    expect(h.put).toHaveBeenCalledWith(`/recipes/${RID}/items/${EGGS}/weights`, { pieceGrams: 60.5 });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['recipes', RID] });
  });

  it('sends what one ml weighs as mlGrams', async () => {
    h.put.mockResolvedValue({ data: { id: EGGS, pieceGrams: null, mlGrams: 0.53 } });
    mount(<Harness start={eggs({ itemName: 'Flour', unit: 'tbsp' }, { needs: 'ml_grams' })} />);
    fireEvent.change(screen.getByLabelText('Flour: one ml weighs'), { target: { value: '0.53' } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    await waitFor(() => expect(h.put).toHaveBeenCalledWith(`/recipes/${RID}/items/${EGGS}/weights`, { mlGrams: 0.53 }));
  });

  it.each([
    ['', 'Type a weight in grams.'],
    ['abc', 'Type the weight as a number of grams, such as 60 or 0,53, without a thousands mark.'],
    ['1.000', 'Type the weight as a number of grams, such as 60 or 0,53, without a thousands mark.'],
    ['0', 'Type the weight as a number of grams, such as 60 or 0,53, without a thousands mark.'],
    ['50001', 'One piece can weigh at most 50000 g. Check the figure.'],
  ])('says why %p is not sent, and sends nothing', async (typed, sentence) => {
    mount(<Harness start={eggs()} />);
    fireEvent.change(screen.getByLabelText('Eggs: one piece weighs'), { target: { value: typed } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect((await screen.findByRole('alert')).textContent).toBe(sentence);
    expect(h.put).not.toHaveBeenCalled();
  });

  it('bounds one ml at 5 g, and lets 50000 g a piece and 5 g a ml through', () => {
    expect(readWeight('1030', 'ml_grams')).toEqual({ why: 'One ml can weigh at most 5 g (honey is about 1,4). Check the figure.' });
    expect(readWeight('5', 'ml_grams')).toEqual({ grams: 5 });
    expect(readWeight('50000', 'piece_grams')).toEqual({ grams: 50000 });
  });

  it('says the gateway\'s own sentence when the weight is refused, and tells the sheet nothing', async () => {
    h.put.mockRejectedValue({ response: { data: { message: 'That good is not on this house\'s shelf.' } } });
    mount(<Harness start={eggs()} />);
    fireEvent.change(screen.getByLabelText('Eggs: one piece weighs'), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect((await screen.findByRole('alert')).textContent).toBe("The weight was not kept: That good is not on this house's shelf.");
    expect(weighed).not.toHaveBeenCalled();
  });

  it('labels a piece and a ml apart', () => {
    expect(weighLabel('piece_grams', 'Lemons')).toBe('Lemons: one piece weighs');
    expect(weighLabel('ml_grams', 'Honey')).toBe('Honey: one ml weighs');
  });
});
