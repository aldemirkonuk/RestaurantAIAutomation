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

import LineRow, { LineRowRead, type DraftRow } from './LineRow';
import { readQty } from './units';
import { useShelf } from './useRecipe';

const blank: DraftRow = {
  key: 'r1', role: 'stocked', inventoryId: null, itemName: null, itemKind: null,
  label: '', qtyText: '30', unit: 'ml', saved: null,
};

let last: DraftRow = blank;
function Harness({ start, say = null }: { start: DraftRow; say?: ((n: number) => string) | null }) {
  const [row, setRow] = useState(start);
  last = row;
  return (
    <ol>
      <LineRow row={row} say={say} onChange={(p) => setRow((r) => ({ ...r, ...p }))} onRemove={() => {}} />
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
    expect(screen.getByText('No price yet: it will cost once a delivery of it is checked in.')).toBeInTheDocument();
    unmount();
    mount(<Harness start={{ ...linked, saved: { status: 'linked', costPerServe: 30, costBasis: 'lot_wac' } }} say={say} />);
    expect(screen.getByText('₺30.00 a serve')).toBeInTheDocument();
  });

  it('a read-only line has no inputs and no money', () => {
    const { container } = mount(
      <ol>
        <LineRowRead
          row={{ ...blank, inventoryId: GIN, itemName: 'gin', label: 'gin', saved: { status: 'linked', costPerServe: 30, costBasis: 'lot_wac' } }}
          say={null}
        />
      </ol>,
    );
    expect(container.querySelector('input, select')).toBeNull();
    expect(container.textContent).toBe('30 mlgin');
  });

  it('a failed shelf read says it failed, never "nothing matches"', async () => {
    h.get.mockRejectedValue(new Error('Network Error'));
    mount(<Harness start={{ ...blank, label: 'gin' }} />);
    fireEvent.click(screen.getByRole('button', { name: /link it to your shelf/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your shelf could not be read just now (Network Error).');
    expect(screen.queryByText(/Nothing on your shelf matches/)).toBeNull();
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
