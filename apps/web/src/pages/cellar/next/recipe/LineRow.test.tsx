/**
 * A recipe line (proposal §2a). Main's recipe box kept each line as text a
 * regex split (`CocktailRegister.tsx:80-213` at origin/main): nothing linked
 * to the shelf, so no line could take stock or cost a serve. Each case below
 * fails without this line.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, renderHook, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

const RID = '11111111-1111-4111-8111-111111111111';
const GIN = '33333333-3333-4333-8333-333333333333';

const RID_B = '99999999-9999-4999-8999-999999999999';

const h = vi.hoisted(() => ({ get: vi.fn(), rid: '11111111-1111-4111-8111-111111111111' }));
vi.mock('../../../../services/api/client', () => ({ apiClient: { get: h.get } }));
vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => ({ activeRestaurantId: h.rid }) }));

import LineRow, { LineRowRead, boughtDay, rowQty, type DraftRow } from './LineRow';
import { amountWithUnit, qtyText, readQty, unitWord } from './units';
import { useShelf } from './useRecipe';

const blank: DraftRow = {
  key: 'r1', role: 'stocked', inventoryId: null, itemName: null, itemKind: null,
  label: '', qtyText: '30', unit: 'ml', saved: null,
};

let last: DraftRow = blank;
function Harness({ start, say = null, kind }: { start: DraftRow; say?: ((n: number) => string) | null; kind?: 'cocktail' | 'dish' }) {
  const [row, setRow] = useState(start);
  last = row;
  return (
    <ol>
      <LineRow row={row} say={say} kind={kind} onChange={(p) => setRow((r) => ({ ...r, ...p }))} onRemove={() => {}} />
    </ol>
  );
}

function mount(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  h.get.mockReset();
  h.rid = RID;
  last = blank;
});

describe('LineRow', () => {
  it('picking a shelf item links the line to it', async () => {
    h.get.mockResolvedValue({ data: [{ id: GIN, name: 'Tanqueray gin', kind: 'spirit', uom: 'bottle', bottleSizeMl: 700 }] });
    mount(<Harness start={blank} />);
    fireEvent.click(screen.getByRole('button', { name: /link it to your shelf/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Tanqueray gin/ }));
    expect(last).toMatchObject({ inventoryId: GIN, itemName: 'Tanqueray gin', label: 'Tanqueray gin', saved: null });
    expect(h.get).toHaveBeenCalledWith(`/recipes/${RID}/shelf`, { params: { limit: 20 } });
  });

  it('an unlinked counted line warns that the drink will not take stock', () => {
    mount(<Harness start={{ ...blank, label: 'sweet vermouth' }} />);
    expect(
      screen.getByText("This drink won't take stock until 'sweet vermouth' is linked to something on your shelf."),
    ).toBeInTheDocument();
  });

  it('switching a line to Not counted drops its link', () => {
    mount(<Harness start={{ ...blank, inventoryId: GIN, itemName: 'gin', label: 'gin' }} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(last).toMatchObject({ role: 'untracked', inventoryId: null, itemName: null });
    expect(screen.getByRole('switch')).toHaveTextContent('Not counted');
  });

  it('a linked line with no price says why, and a priced one says its cost', () => {
    const say = (n: number) => `₺${n.toFixed(2)}`;
    const linked = { ...blank, inventoryId: GIN, itemName: 'gin', label: 'gin' };
    const { unmount } = mount(
      <Harness start={{ ...linked, saved: { status: 'linked', costPerServe: null, costBasis: 'unknown' } }} say={say} />,
    );
    // r36 gap 12: a delivery checked in at the door has no price until it is verified.
    expect(
      screen.getByText('No price yet: nothing says what gin cost. It is priced once a delivery of it is verified with its invoice or an agreed price.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/checked in/)).toBeNull();
    unmount();
    mount(<Harness start={{ ...linked, saved: { status: 'linked', costPerServe: 30, costBasis: 'lot_wac' } }} say={say} />);
    expect(screen.getByText('₺30.00 a serve')).toBeInTheDocument();
  });

  it('a read-only line has no inputs and no money', () => {
    const { container } = mount(
      <ol>
        <LineRowRead
          row={{ ...blank, inventoryId: GIN, itemName: 'gin', label: 'gin', saved: { status: 'linked', costPerServe: 30, costBasis: 'lot_wac' } }}
        />
      </ol>,
    );
    expect(container.querySelector('input, select')).toBeNull();
    // The line, and the link to its good (no money in it).
    expect(container.textContent).toBe('30 mlginOpen in inventory');
  });

  it('round 17 D7: staff read an unlinked or archived line with no warning they cannot act on', () => {
    const { container } = mount(
      <ol>
        <LineRowRead row={{ ...blank, label: 'Campari' }} />
        <LineRowRead row={{ ...blank, inventoryId: GIN, itemName: 'gin', label: 'gin', itemGone: 'archived' }} />
      </ol>,
    );
    expect(container.querySelector('.cl-rcp-note')).toBeNull();
    expect(container.textContent).not.toMatch(/won't take stock|archived|shelf/);
  });

  it.each([
    ['size_not_known', 'bottle', 'ml', "No price yet: your shelf doesn't say how much one bottle of gin holds."],
    ['pack_size_not_known', 'case', 'ml', "No price: gin is counted by the case, and your shelf doesn't say what one holds. Link the line to the single bottle you pour from."],
    ['pack_size_not_known', 'glass', 'oz', "No price: gin is counted by the glass, and your shelf doesn't say what one holds. Link the line to the single bottle you pour from."],
    ['pack_size_not_known', 'pack', 'g', "No price: gin is counted by the pack, and your shelf doesn't say what one holds. Link the line to something your shelf counts by weight, in g or kg."],
    ['pack_size_not_known', 'case', 'kg', "No price: gin is counted by the case, and your shelf doesn't say what one holds. Link the line to something your shelf counts by weight, in g or kg."],
    ['unit_mismatch', 'kg', 'ml', 'No price: this line is measured by volume, but gin is counted in kg. Change the unit, or link the item it pours from.'],
    ['unit_mismatch', 'bottle', 'each', 'No price: this line is counted by the piece, but gin is counted by the bottle. Change the unit, or link the item it pours from.'],
    ['unit_mismatch', 'l', 'g', 'No price: this line is weighed, but gin is counted in l. Change the unit, or link the item it pours from.'],
  ] as const)('round 17 D6: %s on a %s item, %s line, says the real reason', (basis, uom, unit, text) => {
    const linked = { ...blank, inventoryId: GIN, itemName: 'gin', label: 'gin', itemUom: uom, unit };
    mount(<Harness start={{ ...linked, saved: { status: 'linked', costPerServe: null, costBasis: basis } }} say={(n) => `₺${n}`} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('a line under half a cent is said as under a cent, never as free or as a cent it does not cost', () => {
    const linked = { ...blank, inventoryId: GIN, itemName: 'gin', label: 'gin' };
    const say = (n: number) => `₺${n.toFixed(2)}`;
    const { unmount } = mount(
      <Harness start={{ ...linked, saved: { status: 'linked', costPerServe: 0, costPerServeExact: 0.004, costBasis: 'lot_wac' } }} say={say} />,
    );
    expect(screen.getByText('Under ₺0.01 a serve')).toBeInTheDocument();
    unmount();
    // A good that truly costs nothing, or an older gateway with no six-place figure, reads as the cents say.
    mount(<Harness start={{ ...linked, saved: { status: 'linked', costPerServe: 0, costPerServeExact: 0, costBasis: 'lot_wac' } }} say={say} />);
    expect(screen.getByText('₺0.00 a serve')).toBeInTheDocument();
  });

  it('r36 gap 1: a line priced at what its good last cost says so, and when it was bought', () => {
    const linked = { ...blank, inventoryId: GIN, itemName: 'Campari', label: 'campari' };
    const at = new Date().getFullYear() + '-03-07T09:00:00Z';
    const { unmount } = mount(
      <Harness start={{ ...linked, saved: { status: 'linked', costPerServe: 4, costBasis: 'last_known_lot_cost', boughtAt: at } }} say={(n) => `₺${n.toFixed(2)}`} />,
    );
    expect(screen.getByText('₺4.00 a serve, at what Campari last cost (bought 7 Mar); nothing on hand has a price.')).toBeInTheDocument();
    unmount();
    mount(<Harness start={{ ...linked, saved: { status: 'linked', costPerServe: 4, costBasis: 'last_known_lot_cost', boughtAt: null } }} say={(n) => `₺${n.toFixed(2)}`} />);
    expect(screen.getByText('₺4.00 a serve, at what Campari last cost; nothing on hand has a price.')).toBeInTheDocument();
  });

  it('r36 gap 1: a bought day outside this year carries its year, and no date is made up', () => {
    const now = new Date('2026-11-13T12:00:00Z');
    expect(boughtDay('2025-11-01T09:00:00Z', now)).toBe('1 Nov 2025');
    expect(boughtDay('2026-11-01T09:00:00Z', now)).toBe('1 Nov');
    expect(boughtDay('not a date', now)).toBeNull();
    expect(boughtDay(null, now)).toBeNull();
  });

  it('a line priced from part of the stock says so beside its cost', () => {
    const linked = { ...blank, inventoryId: GIN, itemName: 'gin', label: 'gin' };
    mount(<Harness start={{ ...linked, saved: { status: 'linked', costPerServe: 30, costBasis: 'invoice_lot_wac_partial' } }} say={(n) => `₺${n.toFixed(2)}`} />);
    expect(screen.getByText('₺30.00 a serve, from the bottles that have an invoice; some on hand have none yet.')).toBeInTheDocument();
  });

  it('round 17 D9: an editor is told a linked good was archived, even with no money shown', () => {
    mount(<Harness start={{ ...blank, inventoryId: GIN, itemName: 'Old gin', label: 'gin', itemGone: 'archived' }} />);
    expect(
      screen.getByText("'Old gin' was archived from your shelf. Link this line to something still on it, or mark it not counted, before saving."),
    ).toBeInTheDocument();
  });

  it('picking a shelf item clears an archived flag and keeps how the shelf counts it', async () => {
    h.get.mockResolvedValue({ data: [{ id: GIN, name: 'Tanqueray gin', kind: 'spirit', uom: 'bottle', bottleSizeMl: 700 }] });
    mount(<Harness start={{ ...blank, inventoryId: 'old', itemName: 'Old gin', label: 'gin', itemGone: 'deleted' }} />);
    fireEvent.click(screen.getByRole('button', { name: /Old gin/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Tanqueray gin/ }));
    expect(last).toMatchObject({ inventoryId: GIN, itemGone: null, itemUom: 'bottle' });
  });

  it('a failed shelf read says it failed, never "nothing matches"', async () => {
    h.get.mockRejectedValue(new Error('Network Error'));
    mount(<Harness start={{ ...blank, label: 'gin' }} />);
    fireEvent.click(screen.getByRole('button', { name: /link it to your shelf/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your shelf could not be read just now (Network Error).');
    expect(screen.queryByText(/Nothing on your shelf matches/)).toBeNull();
  });

  it('R3: a count says "2 dashes" and "1 dash", in the read and in the unit picker; symbols never take a plural', () => {
    expect(unitWord('dash', 2)).toBe('dashes');
    expect(unitWord('dash', 1)).toBe('dash');
    expect(unitWord('barspoon', 0.5)).toBe('barspoons');
    expect(unitWord('dash', null)).toBe('dash');
    expect(unitWord('ml', 30)).toBe('ml');
    expect(unitWord('oz', 2)).toBe('US oz');
    expect(unitWord('each', 2)).toBe('each');
    expect(amountWithUnit(2, 'dash')).toBe('2 dashes');
    expect(amountWithUnit(1, 'barspoon')).toBe('1 barspoon');
    expect(amountWithUnit(30, null)).toBe('30');
    const { unmount } = render(<ul><LineRowRead row={{ ...blank, label: 'Angostura', qtyText: '2', unit: 'dash' }} /></ul>);
    expect(screen.getByText('2 dashes')).toBeInTheDocument();
    unmount();
    mount(<Harness start={{ ...blank, qtyText: '2', unit: 'dash' }} />);
    expect((screen.getByLabelText('Unit') as HTMLSelectElement).selectedOptions[0].textContent).toBe('dashes');
  });

  it('QA round 21: the ambiguity rule is exactly one to three digits, a separator, three digits', () => {
    // u2: four or more decimals is a plain decimal, not a thousand-or-one.
    expect(readQty('1.1255')).toBe(1.1255);
    expect(readQty('1,0001')).toBe(1.0001);
    // u4: four integer digits and a separator is a plain decimal too.
    expect(readQty('1000.125')).toBe(1000.125);
    expect(readQty('1234,567')).toBe(1234.567);
    // and the edges that are still ambiguous
    for (const t of ['1,250', '12,345', '123.456', '999,999']) expect(readQty(t), t).toBeNull();
  });

  it('three digits after a separator is a decimal when the unit is one no serve holds a thousand of', () => {
    for (const u of ['oz', 'tsp', 'tbsp', 'dash', 'barspoon', 'cl', 'l', 'kg'] as const) {
      expect(readQty('1.125', u), u).toBe(1.125);
      expect(readQty('1,125', u), u).toBe(1.125);
    }
    expect(readQty('1.500', 'l')).toBe(1.5);
    for (const u of ['ml', 'g', 'each', '', null, undefined] as const) expect(readQty('1.125', u), String(u)).toBeNull();
    expect(rowQty({ ...blank, qtyText: '1.125', unit: 'oz' })).toBe(1.125);
    expect(rowQty({ ...blank, qtyText: '1.125', unit: 'ml' })).toBeNull();
  });

  it('QA round 21: a stored three-decimal amount the person did not edit is never refused', () => {
    for (const n of [1.125, 1.375, 2.125, 3.333, 15.625, 999.999]) {
      const row = { ...blank, qtyText: qtyText(n), storedQty: n };
      expect(readQty(row.qtyText), `typed ${n}`).toBeNull();
      expect(rowQty(row), `loaded ${n}`).toBe(n);
    }
    // keeps the stored number past the three printed decimals
    expect(rowQty({ ...blank, qtyText: '3.333', storedQty: 3.3333 })).toBe(3.3333);
  });

  it('QA round 21: typing into a loaded amount makes it typed again', () => {
    mount(<Harness start={{ ...blank, qtyText: '1.125', storedQty: 1.125 }} />);
    const box = screen.getByLabelText('Amount');
    expect(box).toHaveAttribute('aria-invalid', 'false');
    fireEvent.change(box, { target: { value: '1.12' } });
    fireEvent.change(box, { target: { value: '1.125' } });
    expect(last.storedQty).toBeNull();
    expect(box).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(box, { target: { value: '1.25' } });
    expect(box).toHaveAttribute('aria-invalid', 'false');
  });

  it('the amount takes a comma, and nothing at or below zero', () => {
    expect(readQty('22,5')).toBe(22.5);
    expect(readQty('0')).toBeNull();
    expect(readQty('-1')).toBeNull();
    expect(readQty('abc')).toBeNull();
    // Round 19: "1,000" saved as 1. A thousand-or-one is not guessed either way.
    for (const t of ['1,000', '1.000', '22,500', '100.000']) expect(readQty(t), t).toBeNull();
    expect(readQty('0,125')).toBe(0.125);
    expect(readQty('1000')).toBe(1000);
    expect(readQty('1,25')).toBe(1.25);
  });

  // Round-17 QA M18: with the house left out of the shelf key, a second house
  // was shown the first house's cached shelf for 30 s (the key's staleTime).
  // The house-switch cache wipe covers it today; this pins the key itself.
  it("reads the shelf per house: another house never gets this house's cached items", async () => {
    h.get.mockImplementation(async (url: string) => ({
      data: [{ id: GIN, name: url.includes(RID_B) ? 'House B gin' : 'House A gin', kind: 'spirit', uom: 'bottle', bottleSizeMl: 700 }],
    }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result, rerender } = renderHook(() => useShelf('gin', true), { wrapper });
    await waitFor(() => expect(result.current.data?.[0]?.name).toBe('House A gin'));
    h.rid = RID_B;
    rerender();
    await waitFor(() => expect(result.current.data?.[0]?.name).toBe('House B gin'));
    expect(h.get).toHaveBeenCalledWith(`/recipes/${RID_B}/shelf`, expect.anything());
  });
});

describe('LineRow unit picker by recipe kind', () => {
  const options = () =>
    Array.from((screen.getByLabelText('Unit') as HTMLSelectElement).options)
      .map((o) => o.textContent)
      .filter((t) => t !== 'unit');

  it('a dish line offers kitchen units, never a bar measure', () => {
    mount(<Harness start={{ ...blank, qtyText: '250', unit: 'g' }} kind="dish" />);
    expect(options()).toEqual(['g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'each']);
  });

  it('a drink line still offers every unit, the bar measures included', () => {
    mount(<Harness start={{ ...blank, qtyText: '2', unit: 'dash' }} kind="cocktail" />);
    expect(options()).toEqual(['ml', 'cl', 'l', 'US oz', 'tsp', 'tbsp', 'dashes', 'barspoons', 'g', 'kg', 'each']);
  });

  it('a dish line that already reads in a bar unit keeps it chosen', () => {
    mount(<Harness start={{ ...blank, qtyText: '1', unit: 'oz' }} kind="dish" />);
    expect(options()).toEqual(['g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'each', 'US oz']);
    expect((screen.getByLabelText('Unit') as HTMLSelectElement).value).toBe('oz');
  });
});
