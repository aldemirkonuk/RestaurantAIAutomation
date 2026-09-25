/**
 * The plan before a menu is chosen (ADR 0193 round 3, L13). The founder,
 * 2026-09-21, verbatim: "add a section to that where you can lock price, but
 * wha f that menu item disappears? so think verify validate your decision and
 * build". The API modules are replaced (the gateway is not the unit here); the
 * section itself runs for real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MenuPlan, kindWords, orderedRows, planSentence } from './MenuPlan';
import { getMenuPlan, makeMenuCurrent, type MenuPlan as Plan, type PlanLine } from '../../../services/api/menus';
import { lockPrice, releasePriceLock } from '../../../services/api/pricing';

vi.mock('../../../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/menus')>('../../../services/api/menus');
  return { ...actual, getMenuPlan: vi.fn(), makeMenuCurrent: vi.fn() };
});
vi.mock('../../../services/api/pricing', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/pricing')>('../../../services/api/pricing');
  return { ...actual, lockPrice: vi.fn(), releasePriceLock: vi.fn() };
});

const mockPlan = vi.mocked(getMenuPlan);
const mockMake = vi.mocked(makeMenuCurrent);
const mockLock = vi.mocked(lockPrice);
const mockRelease = vi.mocked(releasePriceLock);

const person = (name: string | null) => ({ userId: 'u1', name });

function line(over: Partial<PlanLine> = {}): PlanLine {
  return {
    menuItemId: 'n1',
    name: 'Chianti',
    producer: null,
    vintage: null,
    wineLibraryId: 'mw-2',
    inventoryId: 'inv-2',
    house: { wineName: 'Chianti', vintage: 2021, active: true },
    bottle: {
      kind: 'bottle',
      menuPrice: 55,
      housePrice: 50,
      result: 'change',
      lastSet: { by: person('Deniz'), at: '2026-09-10T08:00:00Z', source: 'manual' },
      lock: null,
    },
    glass: { kind: 'glass', menuPrice: null, housePrice: null, result: 'blank_never_priced', lastSet: null, lock: null },
    flag: null,
    returned: false,
    vintageMismatch: false,
    ...over,
  };
}

const BAROLO = line({
  menuItemId: 'n2',
  name: 'Barolo',
  vintage: '2020',
  inventoryId: 'inv-1',
  house: { wineName: 'Barolo', vintage: 2019, active: true },
  bottle: {
    kind: 'bottle',
    menuPrice: 64,
    housePrice: 60,
    result: 'held_by_lock',
    lastSet: null,
    lock: { lockId: 'lock-1', lockedPrice: 60, lockedBy: person('Aylin'), lockedAt: '2026-09-01T09:00:00Z' },
  },
  returned: true,
  vintageMismatch: true,
});

function plan(over: Partial<Plan> = {}): Plan {
  return {
    menuId: 'menu-new',
    current: false,
    generatedAt: '2026-09-21T12:00:00Z',
    fingerprint: 'fp-1',
    lines: [line(), BAROLO],
    counts: { change: 1, unchanged: 0, held_by_lock: 1, blank_kept: 0, blank_never_priced: 2, not_linked: 0, new_wine: 0 },
    dormantLocks: [
      { lockId: 'lock-9', inventoryId: 'inv-9', kind: 'bottle', lockedPrice: 80, lockedBy: person('Aylin'), lockedAt: '2026-08-01T09:00:00Z', wineName: 'Old Rioja', active: false },
    ],
    namesReadable: true,
    namesReason: null,
    ...over,
  };
}

function mount(canManage: boolean, onDone = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MenuPlan menuId="menu-new" canManage={canManage} onDone={onDone} onCancel={vi.fn()} />
    </QueryClientProvider>,
  );
  return { onDone };
}

beforeEach(() => {
  mockPlan.mockReset();
  mockMake.mockReset();
  mockLock.mockReset();
  mockRelease.mockReset();
});

describe('the plan in one sentence', () => {
  it('says what the choice will do, in the order a person reads it, and counts lines where lines are meant', () => {
    expect(planSentence(plan())).toBe(
      'Choosing this menu will set 1 price from this menu, leave 1 locked price as it is. 1 locked price is not on this menu and stays locked.',
    );
    const unmatched = line({ menuItemId: 'n5', wineLibraryId: null, inventoryId: null, house: null, bottle: { ...line().bottle, result: 'not_linked', lastSet: null }, glass: { ...line().glass, result: 'not_linked' } });
    const unpriced = line({ menuItemId: 'n6', flag: 'blank_no_house_price', bottle: { ...line().bottle, menuPrice: null, result: 'blank_never_priced', lastSet: null } });
    expect(
      planSentence(plan({ lines: [unmatched, unpriced], counts: { change: 0, unchanged: 0, held_by_lock: 0, blank_kept: 0, blank_never_priced: 3, not_linked: 2, new_wine: 0 }, dormantLocks: [] })),
    ).toBe('Choosing this menu changes no price. 1 line shows no price and the house has none either (flagged); 1 line is not matched to a wine, so no price.');
    expect(planSentence(plan({ current: true }))).toBe('This is already the current menu. Choosing it again changes nothing.');
  });
});

describe('MenuPlan -- the section before the choice (L13)', () => {
  it('shows each price it would change with who set it, each held price with its lock, the returned wine, the vintage to check, and the dormant locks', async () => {
    mockPlan.mockResolvedValue(plan());
    mount(true);
    const rows = await screen.findAllByTestId('menu-plan-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Chianti');
    expect(rows[0]).toHaveTextContent('Becomes 55.00; it was set by hand by Deniz on 2026-09-10');
    expect(rows[1]).toHaveTextContent('Stays 60.00: locked by Aylin on 2026-09-01');
    const back = screen.getByTestId('menu-plan-returned');
    expect(back).toHaveTextContent("Barolo comes back with this menu and its lock still holds (the house's Barolo 2019).");
    expect(back).toHaveTextContent('Check this one: the menu reads Barolo 2020, and the locked wine it is linked to is the 2019 vintage.');
    expect(screen.getByTestId('menu-plan-dormant')).toHaveTextContent('Old Rioja (bottle) at 80.00, removed from inventory');
  });

  it('Keep locks that price there and then, and the plan is read again', async () => {
    mockPlan.mockResolvedValueOnce(plan());
    mockPlan.mockResolvedValue(plan({ fingerprint: 'fp-2' }));
    mockLock.mockResolvedValue({ outcome: 'locked', lock: { lockId: 'k', inventoryId: 'inv-2', kind: 'bottle', lockedPrice: 50 }, previousLockId: null, housePrice: 50, sentence: 'The bottle price is locked at 50.00 at this house.' });
    mount(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Keep the bottle price of Chianti' }));
    await waitFor(() => expect(mockLock).toHaveBeenCalledWith('inv-2', 'bottle', 'kept from the menu plan'));
    expect(await screen.findByText('The bottle price is locked at 50.00 at this house.')).toBeInTheDocument();
    await waitFor(() => expect(mockPlan).toHaveBeenCalledTimes(2));
  });

  it('a kept price can be let go from here too (the release changes no price)', async () => {
    mockPlan.mockResolvedValue(plan());
    mockRelease.mockResolvedValue({ outcome: 'released', lock: { lockId: 'lock-1', inventoryId: 'inv-1', kind: 'bottle', lockedPrice: 60 }, previousLockId: null, housePrice: 60, sentence: 'The lock is released.' });
    mount(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Let the menu set the bottle price of Barolo' }));
    await waitFor(() => expect(mockRelease).toHaveBeenCalledWith('lock-1', 'released from the menu plan'));
  });

  it('"Make it current" sends the plan\'s fingerprint, and hands back what the choice did', async () => {
    mockPlan.mockResolvedValue(plan());
    const result = { outcome: 'made_current' as const, menuId: 'menu-new', previousMenuIds: [], lines: 2, priceSync: { changed: 1, locked: 1 }, flagged: 0, failed: [] };
    mockMake.mockResolvedValue(result);
    const { onDone } = mount(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Make it current' }));
    await waitFor(() => expect(mockMake).toHaveBeenCalledWith('menu-new', 'fp-1'));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(result));
  });

  it('a plan that moved (409) is said, nothing is changed, and it is read again', async () => {
    mockPlan.mockResolvedValue(plan());
    mockMake.mockRejectedValue({ response: { status: 409, data: { message: 'changed since it was shown' } } });
    const { onDone } = mount(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Make it current' }));
    expect(await screen.findByTestId('menu-plan-moved')).toHaveTextContent('A price or a lock changed since this was shown, so nothing was changed.');
    await waitFor(() => expect(mockPlan).toHaveBeenCalledTimes(2));
    expect(onDone).not.toHaveBeenCalled();
  });

  it('a plan that cannot be worked out says so, and offers no choice', async () => {
    mockPlan.mockRejectedValue({ response: { status: 500, data: { message: "the house's price locks could not be read" } } });
    mount(true);
    expect(await screen.findByTestId('menu-plan-error')).toHaveTextContent(
      "could not be worked out (the house's price locks could not be read), so it cannot be made current yet",
    );
    expect(screen.queryByRole('button', { name: 'Make it current' })).not.toBeInTheDocument();
  });

  it('staff read the plan with no Keep and no choice', async () => {
    mockPlan.mockResolvedValue(plan());
    mount(false);
    const rows = await screen.findAllByTestId('menu-plan-row');
    expect(within(rows[1]).getByText('Kept (locked)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Keep the/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make it current' })).not.toBeInTheDocument();
    expect(screen.getByText(/An owner or a manager chooses the current menu/)).toBeInTheDocument();
  });

  it('names that could not be read are said, and the prices still stand', async () => {
    mockPlan.mockResolvedValue(plan({ namesReadable: false, namesReason: 'the people named in this plan could not be named: timeout' }));
    mount(true);
    expect(await screen.findByText(/Some names could not be read \(the people named in this plan could not be named: timeout\)/)).toBeInTheDocument();
  });
});

describe("the founder's L11 confirmation: a price a person set after the menu was read is listed first", () => {
  // "The menu sets it, locks keep" (2026-09-21, verbatim): the menu replaces
  // such a price, so the plan puts it first, with who and when, beside Keep.
  const TYPED = line({
    menuItemId: 'n3',
    name: 'Rioja',
    inventoryId: 'inv-3',
    bottle: {
      kind: 'bottle',
      menuPrice: 42,
      housePrice: 48,
      result: 'change',
      lastSet: { by: person('Deniz'), at: '2026-09-12T08:00:00Z', source: 'manual' },
      setAfterRead: true,
      lock: null,
    },
  });

  it('orders it before every other price, whatever the menu order', () => {
    const rows = orderedRows([line(), BAROLO, TYPED]);
    expect(rows.map((r) => `${r.line.name}:${r.k.kind}`)).toEqual(['Rioja:bottle', 'Chianti:bottle', 'Barolo:bottle']);
  });

  it('shows it first, says who set it and that it was after the read, and says why it is first', async () => {
    mockPlan.mockResolvedValue(plan({ lines: [line(), BAROLO, TYPED], readAt: '2026-09-05T10:00:00Z' }));
    mount(true);
    const rows = await screen.findAllByTestId('menu-plan-row');
    expect(rows[0]).toHaveTextContent('Rioja');
    expect(rows[0]).toHaveAttribute('data-after-read', 'true');
    expect(rows[0]).toHaveTextContent('Becomes 42.00; it was set by hand by Deniz on 2026-09-12, after this menu was read');
    expect(within(rows[0]).getByRole('button', { name: 'Keep the bottle price of Rioja' })).toBeInTheDocument();
    expect(rows[1]).toHaveAttribute('data-after-read', 'false');
    expect(screen.getByTestId('menu-plan-typed-after')).toHaveTextContent(
      '1 price was set by a person after this menu was read (2026-09-05). This menu would replace it, so it is listed first: keep one to hold it.',
    );
  });

  it('with none set after the read, no such line is shown', async () => {
    mockPlan.mockResolvedValue(plan());
    mount(true);
    await screen.findAllByTestId('menu-plan-row');
    expect(screen.queryByTestId('menu-plan-typed-after')).not.toBeInTheDocument();
  });
});

describe('every line of the menu, per kind (L13)', () => {
  it('says in words what the choice does to each kind, the flagged and unmatched lines included', async () => {
    const unmatched = line({ menuItemId: 'n5', name: 'House red', wineLibraryId: null, inventoryId: null, house: null, bottle: { ...line().bottle, menuPrice: 20, result: 'not_linked', lastSet: null }, glass: { ...line().glass, result: 'not_linked' } });
    const unpriced = line({ menuItemId: 'n6', name: 'Mystery', flag: 'blank_no_house_price', bottle: { ...line().bottle, menuPrice: null, housePrice: null, result: 'blank_never_priced', lastSet: null } });
    mockPlan.mockResolvedValue(plan({ lines: [line(), BAROLO, unmatched, unpriced] }));
    mount(true);
    const all = await screen.findByTestId('menu-plan-every-line');
    expect(all).toHaveTextContent('Every line on this menu (4)');
    const lines = within(all).getAllByTestId('menu-plan-line');
    expect(lines[0]).toHaveTextContent('becomes 55.00 (now 50.00)');
    expect(lines[1]).toHaveTextContent('Barolo 2020');
    expect(lines[1]).toHaveTextContent('stays 60.00, locked');
    expect(lines[2]).toHaveTextContent('not matched to a wine, so no price');
    expect(lines[3]).toHaveTextContent('no price on the menu or at the house (flagged)');
  });

  it('each result has its words, and one it does not know is still printed', () => {
    const l = line();
    const k = (over: Partial<PlanLine['bottle']>) => ({ ...l.bottle, ...over });
    expect(kindWords(l, k({ result: 'unchanged', housePrice: 50 }))).toBe('already 50.00');
    expect(kindWords(l, k({ result: 'blank_kept', housePrice: 30 }))).toBe('blank on the menu; the house keeps 30.00 (flagged)');
    expect(kindWords(l, k({ result: 'new_wine', menuPrice: 40 }))).toBe('new to the house at 40.00');
    expect(kindWords(l, k({ result: 'blank_never_priced' }))).toBe('—');
    expect(kindWords(l, k({ result: 'held_somewhere_else' as never }))).toBe('held somewhere else');
  });
});

describe('L2 on the plan: nothing to keep where the house has no price', () => {
  it('a price the menu would set for a kind the house never priced offers no Keep, and says why', async () => {
    const fresh = line({
      menuItemId: 'n8',
      name: 'Vermentino',
      inventoryId: 'inv-8',
      bottle: { kind: 'bottle', menuPrice: 38, housePrice: null, result: 'change', lastSet: null, setAfterRead: false, lock: null },
    });
    mockPlan.mockResolvedValue(plan({ lines: [fresh] }));
    mount(true);
    const rows = await screen.findAllByTestId('menu-plan-row');
    expect(within(rows[0]).getByText('Nothing to keep yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Keep the bottle price of Vermentino' })).not.toBeInTheDocument();
  });
});
