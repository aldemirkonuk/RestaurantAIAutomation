/**
 * r28 recipes audit, gap 7, what r32 left: a line priced through a weight the
 * house stated says that weight under its price, and an owner or manager can
 * change it there. A mistyped weight (600 g for one egg) otherwise shows only
 * as a price that looks wrong.
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

import LineRow, { weighedBy, weighedWords, type DraftRow } from './LineRow';
import { plainGrams } from './WeighBox';

const say = (n: number) => `₺${n.toFixed(2)}`;
const comma = (g: number) => String(g).replace('.', ',');
const eggs = (over: Partial<DraftRow> = {}, saved: Partial<NonNullable<DraftRow['saved']>> = {}): DraftRow => ({
  key: 'r1', role: 'stocked', inventoryId: EGGS, itemName: 'Eggs', itemKind: 'food', itemUom: 'kg',
  label: 'Eggs', qtyText: '2', unit: 'each',
  saved: { status: 'linked', costPerServe: 6, costBasis: 'invoice_lot_wac', needs: null, weighed: { by: 'piece_grams', grams: 60 }, ...saved },
  ...over,
});

function mount(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}
const weighed = vi.fn();
function Harness({ start, money = say, sayGrams }: { start: DraftRow; money?: ((n: number) => string) | null; sayGrams?: (g: number) => string }) {
  const [row, setRow] = useState(start);
  return (
    <ol>
      <LineRow
        row={row}
        say={money}
        kind="dish"
        onChange={(p) => setRow((r) => ({ ...r, ...p }))}
        onRemove={() => {}}
        onWeighed={weighed}
        sayGrams={sayGrams}
      />
    </ol>
  );
}

beforeEach(() => {
  h.put.mockReset();
  weighed.mockReset();
});

describe('weighedBy: which weight a line can show', () => {
  it('is the weight a saved, priced line went through', () => {
    expect(weighedBy(eggs())).toEqual({ by: 'piece_grams', grams: 60 });
  });

  it.each([
    ['a line with no price', eggs({}, { costPerServe: null })],
    ['a line not priced through a weight', eggs({}, { weighed: null })],
    ['a line edited since the read', eggs({ saved: null })],
    ['a line not counted', eggs({ role: 'untracked' })],
    ['a line with no good', eggs({ inventoryId: null })],
    ['a line whose good was archived', eggs({ itemGone: 'archived' })],
    ['a weight of no grams', eggs({}, { weighed: { by: 'piece_grams', grams: 0 } })],
  ])('is none on %s', (_n, row) => {
    expect(weighedBy(row)).toBeNull();
  });
});

describe('weighedWords', () => {
  it('says the piece or the ml, the good, and the grams in the form it is given', () => {
    expect(weighedWords({ by: 'piece_grams', grams: 60 }, 'Eggs')).toBe('Priced from one piece of Eggs at 60 g.');
    expect(weighedWords({ by: 'ml_grams', grams: 0.53 }, 'Flour', comma)).toBe('Priced from one ml of Flour at 0,53 g.');
    expect(weighedWords({ by: 'ml_grams', grams: 0.5333 }, 'Flour', plainGrams)).toBe('Priced from one ml of Flour at 0.533 g.');
  });
});

describe('a priced line shows the weight behind its price', () => {
  it('says it under the price, with a Change button, and no box until asked', () => {
    mount(<Harness start={eggs()} />);
    expect(screen.getByTestId('recipe-line-weighed').textContent).toContain('Priced from one piece of Eggs at 60 g.');
    expect(screen.getByRole('button', { name: 'Change what one piece of Eggs weighs' })).toBeTruthy();
    expect(screen.queryByTestId('recipe-line-weigh')).toBeNull();
  });

  it('writes the grams the way the house writes numbers', () => {
    mount(<Harness start={eggs({ itemName: 'Flour', unit: 'tbsp' }, { weighed: { by: 'ml_grams', grams: 0.53 } })} sayGrams={comma} />);
    expect(screen.getByTestId('recipe-line-weighed').textContent).toContain('Priced from one ml of Flour at 0,53 g.');
  });

  it('opens an empty box on Change, says the weight now, and that every dish with the good is priced again', () => {
    mount(<Harness start={eggs()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change what one piece of Eggs weighs' }));
    expect((screen.getByLabelText('Eggs: one piece weighs') as HTMLInputElement).value).toBe('');
    expect(screen.getByTestId('recipe-line-weigh-now').textContent).toContain('Now 60 g.');
    expect(screen.getByText('A new weight prices every dish with Eggs again.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Change what one piece of Eggs weighs' })).toBeNull();
  });

  it('keeps a new weight for the good, tells the sheet, and closes the box', async () => {
    h.put.mockResolvedValue({ data: { id: EGGS, pieceGrams: 55, mlGrams: null } });
    mount(<Harness start={eggs()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change what one piece of Eggs weighs' }));
    fireEvent.change(screen.getByLabelText('Eggs: one piece weighs'), { target: { value: '55' } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    await waitFor(() => expect(weighed).toHaveBeenCalledWith(EGGS, { id: EGGS, pieceGrams: 55, mlGrams: null }));
    expect(h.put).toHaveBeenCalledWith(`/recipes/${RID}/items/${EGGS}/weights`, { pieceGrams: 55 });
    await waitFor(() => expect(screen.queryByTestId('recipe-line-weigh')).toBeNull());
  });

  it('changes one ml\'s weight on a volume line', async () => {
    h.put.mockResolvedValue({ data: { id: EGGS, pieceGrams: null, mlGrams: 0.6 } });
    mount(<Harness start={eggs({ itemName: 'Flour', unit: 'tbsp' }, { weighed: { by: 'ml_grams', grams: 0.53 } })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change what one ml of Flour weighs' }));
    fireEvent.change(screen.getByLabelText('Flour: one ml weighs'), { target: { value: '0,6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    await waitFor(() => expect(h.put).toHaveBeenCalledWith(`/recipes/${RID}/items/${EGGS}/weights`, { mlGrams: 0.6 }));
  });

  it('keeps the box open and says why when the weight is not kept', async () => {
    h.put.mockRejectedValue(Object.assign(new Error('x'), { response: { data: { message: 'One piece must weigh more than 0 g.' } } }));
    mount(<Harness start={eggs()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change what one piece of Eggs weighs' }));
    fireEvent.change(screen.getByLabelText('Eggs: one piece weighs'), { target: { value: '55' } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByTestId('recipe-line-weigh')).toBeTruthy();
    expect(weighed).not.toHaveBeenCalled();
  });

  it('closes on Cancel without sending anything', () => {
    mount(<Harness start={eggs()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change what one piece of Eggs weighs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('recipe-line-weigh')).toBeNull();
    expect(screen.getByRole('button', { name: 'Change what one piece of Eggs weighs' })).toBeTruthy();
    expect(h.put).not.toHaveBeenCalled();
  });

  it('shows nothing of it to a role without money', () => {
    mount(<Harness start={eggs()} money={null} />);
    expect(screen.queryByTestId('recipe-line-weighed')).toBeNull();
  });

  it('drops it once the amount is typed again: the weight no longer makes the price shown', () => {
    mount(<Harness start={eggs()} />);
    fireEvent.change(screen.getAllByLabelText('Amount')[0], { target: { value: '3' } });
    expect(screen.queryByTestId('recipe-line-weighed')).toBeNull();
  });
});
