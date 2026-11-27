import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LooseLines as Answer } from '../../../../services/api/recipes';
import LooseLines from './LooseLines';
import { linkBody } from './linkLines';

const RID = '11111111-1111-4111-8111-111111111111';
const h = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));

vi.mock('../../../../services/api/client', async (orig) => ({
  ...(await orig<typeof import('../../../../services/api/client')>()),
  apiClient: { get: h.get, put: h.put, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => ({ activeRestaurantId: RID, activeRole: 'manager', user: { role: 'manager' } }) }));
vi.mock('./ShelfPicker', () => ({
  default: ({ onPick }: { onPick: (i: unknown) => void }) => (
    <button type="button" onClick={() => onPick({ id: 'i-lime1', name: 'Lime juice (fresh)', kind: 'mixer', uom: 'ml', bottleSizeMl: null })}>
      pick lime
    </button>
  ),
}));

const camp = { id: 'i-camp', name: 'CAMPARI', kind: 'spirit', uom: 'ml', bottleSizeMl: 1000 };

function answer(): Answer {
  return {
    lineCount: 5,
    drinkCount: 2,
    groups: [
      { key: 'campari', label: 'campari', lines: [{ cocktailId: 'c-gim', index: 1 }, { cocktailId: 'c-neg', index: 2 }], drinkCount: 2, proposed: camp, sameName: 1 },
      { key: 'lime juice', label: 'LIME  JUICE', lines: [{ cocktailId: 'c-gim', index: 0 }, { cocktailId: 'c-neg', index: 5 }], drinkCount: 2, proposed: null, sameName: 2 },
      { key: 'sweet vermouth', label: 'Sweet vermouth', lines: [{ cocktailId: 'c-neg', index: 1 }], drinkCount: 1, proposed: null, sameName: 0 },
    ],
    drinks: [
      {
        cocktailId: 'c-gim',
        name: 'Gimlet',
        versionId: 'v-gim1',
        yieldServes: 2,
        method: null,
        glass: null,
        garnish: 'Lime',
        lines: [
          { role: 'stocked', componentId: null, inventoryId: null, label: 'LIME  JUICE', qty: 25, unit: 'ml', usablePct: null },
          { role: 'stocked', componentId: null, inventoryId: null, label: 'campari', qty: 10, unit: 'ml', usablePct: null },
        ],
      },
      {
        cocktailId: 'c-neg',
        name: 'Negroni',
        versionId: 'v-neg2',
        yieldServes: 1,
        method: 'Stir',
        glass: 'Rocks',
        garnish: null,
        lines: [
          { role: 'stocked', componentId: null, inventoryId: 'i-gin', label: 'Gin', qty: 30, unit: 'ml', usablePct: null },
          { role: 'stocked', componentId: null, inventoryId: null, label: 'Sweet vermouth', qty: 30, unit: 'ml', usablePct: 90 },
          { role: 'stocked', componentId: null, inventoryId: null, label: 'Campari', qty: 25, unit: 'ml', usablePct: null },
          { role: 'untracked', componentId: null, inventoryId: null, label: 'Orange twist', qty: 1, unit: 'each', usablePct: null },
          { role: 'made', componentId: 'd-syrup', inventoryId: null, label: 'Syrup', qty: 5, unit: 'ml', usablePct: null },
          { role: 'stocked', componentId: null, inventoryId: null, label: 'Lime juice', qty: 30, unit: 'ml', usablePct: null },
        ],
      },
    ],
  };
}

/** After Campari is linked: the two other names stay, one place higher each. */
function afterCampari(): Answer {
  const a = answer();
  return { ...a, lineCount: 3, groups: a.groups.slice(1) };
}

let reduced = false;
const slid: Array<{ row: string | undefined; frames: unknown; opts: unknown }> = [];
const realRect = HTMLElement.prototype.getBoundingClientRect;
let reads: Answer[] = [];
const looseUrl = `/recipes/${RID}/drinks/loose-lines`;

beforeEach(() => {
  reduced = false;
  slid.length = 0;
  (Element.prototype as unknown as { animate: unknown }).animate = function (this: HTMLElement, frames: unknown, opts: unknown) {
    slid.push({ row: this.dataset?.row, frames, opts });
    return { finished: Promise.resolve(), cancel() {}, onfinish: null } as unknown as Animation;
  };
  window.matchMedia = ((q: string) => ({ matches: reduced && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as never;
  // A group row sits 40 px below the one before it: where the DOM puts it is where it is.
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const row = this.closest('tr[data-row]');
    const at = row ? Array.from(row.parentElement!.children).indexOf(row) * 40 : 0;
    return { top: at, bottom: at + 40, left: 0, right: 0, width: 0, height: 40, x: 0, y: at, toJSON() {} } as DOMRect;
  };
  reads = [answer(), afterCampari()];
  h.get.mockReset().mockImplementation(async (url: string) => {
    if (url === looseUrl) return { data: reads.length > 1 ? reads.shift() : reads[0] };
    throw new Error(`unexpected GET ${url}`);
  });
  h.put.mockReset().mockResolvedValue({ data: { versionId: 'new', version: 3, lines: [] } });
});
afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = realRect;
  delete (Element.prototype as unknown as { animate?: unknown }).animate;
});

function mount(manages = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <LooseLines manages={manages} />
    </QueryClientProvider>,
  );
}

async function openSheet() {
  mount();
  await screen.findByText('5 lines in 2 drinks are not linked to your shelf.', { exact: false });
  fireEvent.click(screen.getByTestId('loose-open'));
  await screen.findByTestId('loose-group-campari');
}

const linkCampari = async () => {
  const row = screen.getByTestId('loose-group-campari');
  fireEvent.click(row.querySelector('[data-testid="loose-link"]')!);
};

describe('the loose-lines queue (r108 drinks-g9)', () => {
  it('says how many lines in how many drinks, and offers to link them', async () => {
    mount();
    const line = await screen.findByTestId('loose-open');
    expect(screen.getByTestId('loose-lines')).toHaveTextContent('5 lines in 2 drinks are not linked to your shelf. Link them');
    expect(line).toHaveTextContent('Link them');
    expect(screen.getByTestId('loose-lines')).toHaveClass('cl-offer-room');
  });

  it('staff get nothing and never ask', () => {
    mount(false);
    expect(screen.queryByTestId('loose-lines')).toBeNull();
    expect(h.get).not.toHaveBeenCalled();
  });

  it('a link sends one PUT per drink: the version read, with only the matched lines’ inventoryId changed', async () => {
    await openSheet();
    expect(screen.getByTestId('loose-group-campari')).toHaveTextContent('Link to CAMPARI');
    expect(screen.getByTestId('loose-group-campari')).toHaveTextContent('Link in 2 drinks');
    await act(linkCampari);
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(2));
    const [gimUrl, gimBody] = h.put.mock.calls[0];
    const [negUrl, negBody] = h.put.mock.calls[1];
    expect(gimUrl).toBe(`/recipes/${RID}/cocktails/c-gim`);
    expect(negUrl).toBe(`/recipes/${RID}/cocktails/c-neg`);
    const a = answer();
    const expected = (i: number, at: number) => {
      const d = a.drinks[i];
      const lines = d.lines.map((l, k) => (k === at ? { ...l, inventoryId: 'i-camp' } : l));
      return { expectedVersionId: d.versionId, yieldServes: d.yieldServes, method: d.method, glass: d.glass, garnish: d.garnish, lines };
    };
    // Byte-equal but for the link: the JSON the gateway gets is the version read, one field changed.
    expect(JSON.stringify(gimBody)).toBe(JSON.stringify(expected(0, 1)));
    expect(JSON.stringify(negBody)).toBe(JSON.stringify(expected(1, 2)));
    expect(negBody.lines[1].usablePct).toBe(90);
    expect(negBody.lines[4].componentId).toBe('d-syrup');
  });

  it('linkBody changes only inventoryId at the named places', () => {
    const d = answer().drinks[1];
    const b = linkBody(d, [1, 5], 'x');
    const changed = b.lines.flatMap((l, i) => (JSON.stringify(l) === JSON.stringify(d.lines[i]) ? [] : [i]));
    expect(changed).toEqual([1, 5]);
    expect(b.lines.map((l, i) => ({ ...l, inventoryId: d.lines[i].inventoryId }))).toEqual(d.lines);
    expect(b.expectedVersionId).toBe('v-neg2');
  });

  it('says each drink’s own outcome: saved, someone saved first (409), or the gateway’s refusal', async () => {
    h.put
      .mockReset()
      .mockResolvedValueOnce({ data: { versionId: 'new', version: 3, lines: [] } })
      .mockRejectedValueOnce({ response: { status: 409, data: { message: 'Someone saved this recipe after you opened it.' } } });
    await openSheet();
    await act(linkCampari);
    const out = await screen.findByTestId('loose-outcomes');
    const items = out.querySelectorAll('li');
    expect(items[0]).toHaveTextContent('Gimlet: saved, campari linked to CAMPARI.');
    expect(items[0]).toHaveAttribute('data-ok', 'true');
    expect(items[1]).toHaveTextContent('Someone saved Negroni first; open it to link this line.');
    expect(items[1]).toHaveAttribute('data-ok', 'false');
  });

  it('a refusal from the gateway is said in its own words, and one refusal never stops the next drink', async () => {
    h.put
      .mockReset()
      .mockRejectedValueOnce({ response: { status: 400, data: { message: 'Ingredient 2 (campari) is more than one line can hold.' } } })
      .mockResolvedValueOnce({ data: { versionId: 'new', version: 3, lines: [] } });
    await openSheet();
    await act(linkCampari);
    const out = await screen.findByTestId('loose-outcomes');
    expect(out).toHaveTextContent('Gimlet: not saved. Ingredient 2 (campari) is more than one line can hold.');
    expect(out).toHaveTextContent('Negroni: saved, campari linked to CAMPARI.');
  });

  it('a group with no proposal waits for a good; picking one links it', async () => {
    await openSheet();
    const lime = screen.getByTestId('loose-group-lime juice');
    expect(lime).toHaveTextContent('2 goods on your shelf have this name');
    expect(lime.querySelector('[data-testid="loose-link"]')).toBeDisabled();
    fireEvent.click(screen.getAllByText('pick lime')[0]);
    expect(lime).toHaveTextContent('Link to Lime juice (fresh)');
    expect(lime.querySelector('[data-testid="loose-link"]')).not.toBeDisabled();
  });

  it('after a link the queue is read again: the linked group snaps out, the others slide 180 ms', async () => {
    await openSheet();
    expect(h.get.mock.calls.filter(([u]) => u === looseUrl)).toHaveLength(1);
    slid.length = 0;
    await act(linkCampari);
    await waitFor(() => expect(screen.queryByTestId('loose-group-campari')).toBeNull());
    expect(h.get.mock.calls.filter(([u]) => u === looseUrl).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId('loose-sheet-count')).toHaveTextContent('3 lines in 2 drinks are not linked to your shelf.');
    const rows = slid.filter((s) => s.row);
    expect(rows.map((s) => s.row).sort()).toEqual(['lime juice', 'sweet vermouth']);
    for (const s of rows) {
      expect(s.frames).toEqual([{ transform: 'translateY(40px)' }, { transform: 'translateY(0)' }]);
      expect(s.opts).toMatchObject({ duration: 180, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    }
    // No exit animation: the linked group is never animated on its way out.
    expect(slid.some((s) => s.row === 'campari')).toBe(false);
  });

  it('reduced motion: the groups that stay move with no animation at all', async () => {
    reduced = true;
    await openSheet();
    slid.length = 0;
    await act(linkCampari);
    await waitFor(() => expect(screen.queryByTestId('loose-group-campari')).toBeNull());
    expect(slid.filter((s) => s.row)).toEqual([]);
  });

  it('a failed read is said, never shown as nothing to link', async () => {
    h.get.mockReset().mockRejectedValue(new Error('down'));
    mount();
    expect(await screen.findByText('Which lines are not linked to your shelf could not be read just now.')).toBeInTheDocument();
  });
});
