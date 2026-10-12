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
import { MenuPlan, kindWords, makeLiveArgs, orderedRows, planSentence, unsureGroups, unsureWords } from './MenuPlan';
import { makeCurrentSentence, untouchedKinds } from './MenuVersions';
import {
  confirmMenuSection,
  getMenuPlan,
  keepGoneLine,
  listMenuSections,
  makeMenuCurrent,
  moveMenuSection,
  type MenuPlan as Plan,
  type MenuSection,
  type PlanLine,
} from '../../../services/api/menus';
import { lockPrice, releasePriceLock } from '../../../services/api/pricing';

vi.mock('../../../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/menus')>('../../../services/api/menus');
  return {
    ...actual,
    getMenuPlan: vi.fn(),
    makeMenuCurrent: vi.fn(),
    listMenuSections: vi.fn(),
    moveMenuSection: vi.fn(),
    confirmMenuSection: vi.fn(),
    confirmMenuLine: vi.fn(),
    keepGoneLine: vi.fn(),
  };
});
vi.mock('../../../services/api/pricing', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/pricing')>('../../../services/api/pricing');
  return { ...actual, lockPrice: vi.fn(), releasePriceLock: vi.fn() };
});

const mockPlan = vi.mocked(getMenuPlan);
const mockMake = vi.mocked(makeMenuCurrent);
const mockLock = vi.mocked(lockPrice);
const mockRelease = vi.mocked(releasePriceLock);
const mockSections = vi.mocked(listMenuSections);
const mockMove = vi.mocked(moveMenuSection);
const mockConfirmSection = vi.mocked(confirmMenuSection);
const mockKeep = vi.mocked(keepGoneLine);

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
  mockSections.mockReset();
  mockSections.mockResolvedValue([]);
  mockMove.mockReset();
  mockConfirmSection.mockReset();
  mockKeep.mockReset();
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
  // F-1297: a kitchen line is set aside, never "not matched to a wine".
  it('counts kitchen lines as set aside, in the plan and in what the choice did', () => {
    const food = line({ menuItemId: 'k1', name: 'Grilled octopus', wineLibraryId: null, inventoryId: null, house: null, bottle: { ...line().bottle, result: 'kitchen', lastSet: null }, glass: { ...line().glass, result: 'kitchen' } });
    const s = planSentence(plan({ lines: [food, food], counts: { change: 0, unchanged: 0, held_by_lock: 0, blank_kept: 0, blank_never_priced: 0, not_linked: 0, kitchen: 4, new_wine: 0 }, dormantLocks: [] }));
    expect(s).toBe('Choosing this menu changes no price. 2 kitchen lines set aside, with no price.');
    expect(s).not.toMatch(/not matched/);
    expect(kindWords(food, food.bottle)).toBe('a kitchen line, set aside');
    expect(
      makeCurrentSentence({ outcome: 'made_current', menuId: 'm1', previousMenuIds: [], lines: 3, priceSync: { changed: 1, kitchen: 2 }, flagged: 0, failed: [] }),
    ).toBe('This is now the current menu: 3 lines, 1 price set from this menu, 2 kitchen lines set aside.');
  });
  // F-1470: a cocktail is made from its recipe, never "not matched to a wine".
  it('counts cocktails as made from their recipes, in the plan and in what the choice did', () => {
    const negroni = line({ menuItemId: 'c1', name: 'Negroni', wineLibraryId: null, inventoryId: null, house: null, bottle: { ...line().bottle, result: 'cocktail', lastSet: null }, glass: { ...line().glass, result: 'cocktail' } });
    const s = planSentence(plan({ lines: [negroni], counts: { change: 0, unchanged: 0, held_by_lock: 0, blank_kept: 0, blank_never_priced: 0, not_linked: 0, cocktail: 2, new_wine: 0 }, dormantLocks: [] }));
    expect(s).toBe('Choosing this menu changes no price. 1 cocktail is made from its recipe, so it gets no stock row and no price here.');
    expect(s).not.toMatch(/not matched/);
    expect(kindWords(negroni, negroni.bottle)).toBe('a cocktail, made from its recipe; priced on /cocktails');
    expect(
      makeCurrentSentence({ outcome: 'made_current', menuId: 'm1', previousMenuIds: [], lines: 3, priceSync: { changed: 1, cocktail: 2 }, flagged: 0, failed: [] }),
    ).toBe('This is now the current menu: 3 lines, 1 price set from this menu, 2 cocktails made from their recipes, not stocked.');
  });
});

describe('F-696: the plan says the current menu it takes off, and the lines that leave with it', () => {
  it('leads the sentence with the menu that ends and counts its lines', () => {
    expect(planSentence(plan({ retiring: [{ menuId: 'menu-old', name: 'Wine list', lines: 42 }] }))).toBe(
      'Choosing this menu takes Wine list off: its 42 lines leave the menu. A house has one current menu of each kind. Choosing this menu will set 1 price from this menu, leave 1 locked price as it is. 1 locked price is not on this menu and stays locked.',
    );
    expect(planSentence(plan({ retiring: [{ menuId: 'menu-old', name: null, lines: 1 }] }))).toMatch(
      /^Choosing this menu takes the current menu off: its 1 line leaves the menu\./,
    );
    // Nothing current, or this one already current: nothing is taken off.
    expect(planSentence(plan({ retiring: [] }))).toMatch(/^Choosing this menu will set/);
  });

  it('shows it on the plan above the choice', async () => {
    mockPlan.mockResolvedValue(plan({ retiring: [{ menuId: 'menu-old', name: 'Wine list', lines: 42 }] }));
    mount(true);
    expect(await screen.findByTestId('menu-plan-sentence')).toHaveTextContent('takes Wine list off: its 42 lines leave the menu');
  });
});

describe("F-699: the plan's dates are the house's day, not UTC's", () => {
  it('prints a price set at 18:00 in Los Angeles on that day, not the next', async () => {
    const late = line({ bottle: { ...line().bottle, lastSet: { by: person('Deniz'), at: '2026-09-11T01:00:00Z', source: 'manual' } } });
    mockPlan.mockResolvedValue(plan({ lines: [late], timezone: 'America/Los_Angeles' }));
    mount(true);
    const rows = await screen.findAllByTestId('menu-plan-row');
    expect(rows[0]).toHaveTextContent('set by hand by Deniz on 2026-09-10');
  });
});

describe('F-618 / S202: a price set by a menu made current reads as from a menu', () => {
  it("says 'from a menu' for 'menu_current', never 'by hand'", async () => {
    const fromMenu = line({ bottle: { ...line().bottle, lastSet: { by: person('Deniz'), at: '2026-09-10T12:00:00Z', source: 'menu_current' } } });
    mockPlan.mockResolvedValue(plan({ lines: [fromMenu] }));
    mount(true);
    const rows = await screen.findAllByTestId('menu-plan-row');
    expect(rows[0]).toHaveTextContent('set from a menu by Deniz on 2026-09-10');
    expect(rows[0]).not.toHaveTextContent('by hand');
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

  it('a menu read only in part says why, and is made current only once the person confirms (F-1292)', async () => {
    mockPlan.mockResolvedValue(plan({ partRead: 'the reading stopped before the end of the menu' }));
    const result = { outcome: 'made_current' as const, menuId: 'menu-new', previousMenuIds: [], lines: 2, priceSync: { changed: 1 }, flagged: 0, failed: [] };
    mockMake.mockResolvedValue(result);
    mount(true);
    const said = await screen.findByTestId('menu-plan-part-read');
    expect(said.textContent).toContain('Only part of this menu was read: the reading stopped before the end of the menu.');
    const go = screen.getByRole('button', { name: 'Make it current' });
    expect(go).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Make it current anyway, with those drinks missing' }));
    expect(go).toBeEnabled();
    fireEvent.click(go);
    await waitFor(() => expect(mockMake).toHaveBeenCalledWith('menu-new', 'fp-1', true));
  });

  it('while it is being made current, says what it is doing and how long it has taken (F-069)', async () => {
    mockPlan.mockResolvedValue(plan());
    mockMake.mockReturnValue(new Promise(() => {}));
    mount(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Make it current' }));
    const working = await screen.findByTestId('menu-plan-working');
    expect(working).toHaveAttribute('role', 'status');
    expect(working).toHaveTextContent('Putting 2 lines on the menu and setting their prices.');
    expect(working).toHaveTextContent('0s so far.');
    await waitFor(() => expect(screen.getByTestId('menu-plan-working')).toHaveTextContent('1s so far.'), { timeout: 2500 });
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

  it('a choice the house never answered is not "nothing changed": the plan is read again and says the menu is current (F-448)', async () => {
    mockPlan.mockResolvedValueOnce(plan()).mockResolvedValue(plan({ current: true }));
    mockMake.mockRejectedValue({ code: 'ECONNABORTED', message: 'timeout of 30000ms exceeded' });
    const { onDone } = mount(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Make it current' }));
    await waitFor(() =>
      expect(screen.getByTestId('menu-plan-unsure')).toHaveTextContent(
        'The house did not answer in time, but this menu is now current.',
      ),
    );
    expect(mockPlan).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Nothing has changed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/timeout of 30000ms/)).not.toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('a choice the house never answered, read again and still not current, says nothing changed', async () => {
    mockPlan.mockResolvedValue(plan());
    mockMake.mockRejectedValue({ message: 'Network Error' });
    mount(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Make it current' }));
    await waitFor(() => expect(mockPlan).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByTestId('menu-plan-unsure')).toHaveTextContent(
        'The house did not answer in time, and this menu is not current. Nothing has changed',
      ),
    );
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
    // F-919: in the house's currency when /menu hands it in, as the line table prints it.
    expect(kindWords(l, k({ result: 'change', menuPrice: 1250, housePrice: 1100 }), 'TRY').replace(/\u00a0/g, ' ')).toBe(
      'becomes TRY 1,250.00 (now TRY 1,100.00)',
    );
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

describe('a menu with no lines (F-681)', () => {
  it('is not offered as the current menu: choosing it would empty the house menu', async () => {
    mockPlan.mockResolvedValue(plan({ lines: [] }));
    mount(true);
    expect(await screen.findByTestId('plan-empty')).toHaveTextContent(
      'This menu has no lines, so it cannot become the current menu.',
    );
    expect(screen.queryByRole('button', { name: 'Make it current' })).not.toBeInTheDocument();
  });
});

// F-919: the sentence after "Make it current" names a held lock's price in the
// house's money, as the line table above it prints it — never a bare toFixed.
describe('the make-current sentence (F-919)', () => {
  it('says a held lock\'s price in the house\'s currency', () => {
    const s = makeCurrentSentence(
      {
        outcome: 'made_current',
        menuId: 'm1',
        previousMenuIds: [],
        lines: 1,
        priceSync: { locked: 1 },
        flagged: 0,
        failed: [],
        held: [
          { menuItemId: 'l1', name: 'Barolo', kind: 'bottle', lockId: 'k1', lockedPrice: 1250, lockedBy: 'u1', lockedAt: '2026-09-01T00:00:00Z' },
        ],
        returned: [],
      },
      'TRY',
    );
    expect(s).toMatch(/Barolo \(bottle, locked at TRY\s1,250\.00\)/);
    expect(s).not.toContain('1250.00');
  });
});

// ADR 0340 lane 6: a read split by kind is reviewed and made live together,
// in rule 18's order (Conflicts, Unsure, Price changed, New, Gone, Same).
const DRINKS = { menuId: 'menu-new', kind: 'beverage', current: false, partRead: null, lines: 2, unsure: 0, conflicts: 1 };
const FOOD = { menuId: 'menu-food', kind: 'food', current: false, partRead: null, lines: 3, unsure: 3, conflicts: 0 };
const CONFLICT = {
  wineLibraryId: 'mw-2',
  inventoryId: 'inv-2',
  kind: 'bottle' as const,
  name: 'Chianti',
  prices: [
    { price: 55, menuId: 'menu-new', menuItemId: 'n1', live: false, menuKind: 'beverage' },
    { price: 58, menuId: 'menu-des', menuItemId: 'd1', live: true, menuKind: 'desserts' },
  ],
};
const KITCHEN = { kind: 'bottle' as const, menuPrice: null, housePrice: null, result: 'kitchen' as const, lastSet: null, lock: null };
const FOOD_LINES = [
  line({ menuItemId: 'f1', name: 'Lamb', menuId: 'menu-food', menuKind: 'food', sectionId: 's-mains', lineKind: null, bottle: KITCHEN }),
  line({ menuItemId: 'f2', name: 'Fish', menuId: 'menu-food', menuKind: 'food', sectionId: 's-mains', lineKind: null, bottle: KITCHEN }),
  line({ menuItemId: 'f3', name: 'Mystery', menuId: 'menu-food', menuKind: 'food', sectionId: null, lineKind: null, bottle: KITCHEN }),
];
const SECTION = (over: Partial<MenuSection>): MenuSection => ({
  id: 's-mains',
  menu_id: 'menu-food',
  parent_id: null,
  position: 0,
  title: 'Mains',
  title_as_read: 'Mains',
  key: 'mains',
  drink_category: null,
  suggested_kind: null,
  suggested_category: null,
  suggestion_confidence: null,
  inherited_from_section_id: null,
  confirmed_by: null,
  confirmed_at: null,
  ...over,
});

function batchPlan(over: Partial<Plan> = {}): Plan {
  return plan({
    lines: [line(), BAROLO, ...FOOD_LINES],
    menus: [DRINKS, FOOD],
    conflicts: [CONFLICT],
    unsure: [
      { menuId: 'menu-food', menuItemId: 'f1', name: 'Lamb', reason: 'kind_not_decided' },
      { menuId: 'menu-food', menuItemId: 'f2', name: 'Fish', reason: 'kind_not_decided' },
      { menuId: 'menu-food', menuItemId: 'f3', name: 'Mystery', reason: 'kind_not_decided' },
    ],
    gone: [{ menuId: 'menu-live-food', menuItemId: 'g1', name: 'Old soup', kind: 'food', sectionKey: 'soups' }],
    ...over,
  });
}

function mountBatch(onDone = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MenuPlan menuId="menu-new" batchIds={['menu-food']} canManage onDone={onDone} onCancel={vi.fn()} />
    </QueryClientProvider>,
  );
  return { onDone };
}

describe('the review per kind (ADR 0340 rule 18)', () => {
  it('Unsure lines group by section; a line in no section stands alone; counted up front', () => {
    const groups = unsureGroups(batchPlan().unsure ?? [], batchPlan().lines, [SECTION({})]);
    expect(groups.map((g) => [g.title, g.lines.length])).toEqual([
      ['Mains', 2],
      ['Mystery', 1],
    ]);
    expect(unsureWords(groups)).toBe('1 section, 3 lines to check');
  });

  it('plans the batch, counts what to answer first, and holds make-live while anything blocks', async () => {
    mockPlan.mockResolvedValue(batchPlan());
    mockSections.mockImplementation(async (id) => (id === 'menu-food' ? [SECTION({})] : []));
    mountBatch();
    expect(await screen.findByTestId('menu-plan-counts')).toHaveTextContent(
      '1 wine at two prices to pick · 1 section, 3 lines to check · 1 price changed · 1 gone',
    );
    expect(mockPlan).toHaveBeenCalledWith('menu-new', ['menu-food']);
    expect(await screen.findByText(/Unsure, 1 section, 3 lines to check/)).toBeInTheDocument();
    expect(screen.getByTestId('conflict-pick')).toHaveTextContent('Chianti (bottle)');
    expect(screen.getByRole('button', { name: 'Make Drinks + Food live' })).toBeDisabled();
  });

  it('a blocked kind is left as a draft with one tap, and the plan is read again without it', async () => {
    mockPlan.mockResolvedValueOnce(batchPlan());
    mockPlan.mockResolvedValueOnce(plan({ menus: [{ ...DRINKS, conflicts: 0 }], conflicts: [], unsure: [], gone: [] }));
    mountBatch();
    fireEvent.click(await screen.findByRole('button', { name: 'Leave Food as a draft' }));
    await waitFor(() => expect(mockPlan).toHaveBeenLastCalledWith('menu-new', []));
    expect(await screen.findByTestId('menu-plan-left')).toHaveTextContent('Left as a draft: Food.');
    expect(await screen.findByRole('button', { name: 'Make it current' })).toBeEnabled();
  });

  it('a picked price is sent with make-live; nothing is written before', async () => {
    mockPlan.mockResolvedValue(batchPlan({ menus: [DRINKS, { ...FOOD, unsure: 0 }], unsure: [], gone: [] }));
    const result = { outcome: 'made_current' as const, menuId: 'menu-new', previousMenuIds: [], lines: 5, priceSync: { changed: 1 }, flagged: 0, failed: [] };
    mockMake.mockResolvedValue(result);
    const { onDone } = mountBatch();
    const live = await screen.findByRole('button', { name: 'Make Drinks + Food live' });
    expect(live).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /58/ }));
    expect(mockMake).not.toHaveBeenCalled();
    fireEvent.click(live);
    await waitFor(() =>
      expect(mockMake).toHaveBeenCalledWith('menu-new', 'fp-1', false, {
        menuIds: ['menu-food'],
        picks: [{ wineLibraryId: 'mw-2', kind: 'bottle', price: 58 }],
        partReadAcceptedKinds: [],
      }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(result));
  });

  it('"Food" on an Unsure section of another kind moves it to Food, then says its lines are dishes', async () => {
    mockPlan.mockResolvedValue(
      batchPlan({
        menus: [DRINKS, FOOD],
        conflicts: [],
        gone: [],
        lines: [line({ menuItemId: 'f1', name: 'Lamb', menuId: 'menu-new', menuKind: 'beverage', sectionId: 's-x' })],
        unsure: [{ menuId: 'menu-new', menuItemId: 'f1', name: 'Lamb', reason: 'no_drink_category' }],
      }),
    );
    mockSections.mockImplementation(async (id) => (id === 'menu-new' ? [SECTION({ id: 's-x', menu_id: 'menu-new', title: 'Grill' })] : []));
    mockMove.mockResolvedValue({ id: 's-x', from_menu_id: 'menu-new', menu_id: 'menu-food', kind: 'food', created_menu: false, line_ids: ['f1'], resolved: 0 });
    mockConfirmSection.mockResolvedValue({ id: 's-x', menu_id: 'menu-food', line_kind: 'dish', applied_line_ids: ['f1'], left_line_ids: [], resolved: 1 });
    mountBatch();
    const group = await screen.findByTestId('menu-plan-unsure-group');
    await waitFor(() => expect(group).toHaveTextContent('Grill'));
    fireEvent.click(within(group).getByRole('button', { name: 'Food' }));
    await waitFor(() => expect(mockConfirmSection).toHaveBeenCalledWith('menu-food', 's-x', 'dish', undefined));
    expect(mockMove).toHaveBeenCalledWith('menu-new', 's-x', 'food');
    expect(await screen.findByText('Grill is Food.')).toBeInTheDocument();
  });

  it('a gone line is kept onto the draft of its kind, by its button or by a swipe right', async () => {
    mockPlan.mockResolvedValue(batchPlan({ menus: [DRINKS, { ...FOOD, unsure: 0 }], unsure: [], conflicts: [] }));
    mockKeep.mockResolvedValue({ line_id: 'k1', menu_id: 'menu-food', section_id: null, kept_from_line_id: 'g1' });
    mountBatch();
    const row = await screen.findByTestId('menu-plan-gone-line');
    fireEvent.pointerDown(row, { clientX: 10 });
    fireEvent.pointerUp(row, { clientX: 30 });
    expect(mockKeep).not.toHaveBeenCalled();
    fireEvent.pointerDown(row, { clientX: 10 });
    fireEvent.pointerUp(row, { clientX: 120 });
    await waitFor(() => expect(mockKeep).toHaveBeenCalledWith('menu-food', 'g1'));
    fireEvent.click(within(row).getByRole('button', { name: 'Keep Old soup on the menu' }));
    await waitFor(() => expect(mockKeep).toHaveBeenCalledTimes(2));
  });

  it('a menu of the batch made live in a batch is retired per kind, in the sentence', () => {
    expect(
      planSentence(batchPlan({ retiring: [{ menuId: 'old-food', name: null, lines: 4, kind: 'food' }] })),
    ).toMatch(/^Making these menus live takes the live Food menu off: its 4 lines leave the menu\. A house has one current menu of each kind\./);
  });
});

describe('the make-live call', () => {
  it('one menu with no pick is the call it always was; a batch or a pick is the batch call', () => {
    expect(makeLiveArgs(['m1'], {}, [], true, [])).toEqual({ menuId: 'm1', partReadAccepted: true, batch: undefined });
    expect(makeLiveArgs(['m1', 'm2'], {}, [], true, ['food'])).toEqual({
      menuId: 'm1',
      partReadAccepted: false,
      batch: { menuIds: ['m2'], picks: [], partReadAcceptedKinds: ['food'] },
    });
    expect(makeLiveArgs(['m1'], { 'mw-2:bottle': 58, 'gone:glass': 1 }, [CONFLICT], false, []).batch?.picks).toEqual([
      { wineLibraryId: 'mw-2', kind: 'bottle', price: 58 },
    ]);
  });
});

describe('the make-live sentence per kind (rule 20)', () => {
  const made = (kind: string, over = {}) => ({
    menuId: `m-${kind}`,
    kind,
    outcome: 'made_current' as const,
    madeCurrentAt: '2026-10-12T10:00:00Z',
    recarried: false,
    carryFinished: true,
    lines: 2,
    ...over,
  });
  const base = { outcome: 'made_current' as const, menuId: 'm-beverage', previousMenuIds: [], lines: 5, priceSync: { changed: 3 }, flagged: 0, failed: [] };

  it('names the kinds updated and the live kinds left untouched', () => {
    const r = { ...base, menus: [made('beverage'), made('desserts')] };
    expect(untouchedKinds(r, ['beverage', 'food'])).toEqual(['food']);
    expect(makeCurrentSentence(r, undefined, ['food'])).toBe('Drinks + Desserts updated · 5 lines, 3 prices set from this menu · Food untouched.');
  });

  it('one menu with no other kind live reads as it always did', () => {
    const r = { ...base, menus: [made('beverage')] };
    expect(makeCurrentSentence(r, undefined, untouchedKinds(r, ['beverage']))).toBe(
      'This is now the current menu: 5 lines, 3 prices set from this menu.',
    );
    expect(untouchedKinds({ ...base, menus: undefined }, ['food'])).toEqual([]);
  });

  it('a carry that did not write every price is said', () => {
    const r = { ...base, menus: [made('beverage', { carryFinished: false }), made('food')] };
    expect(makeCurrentSentence(r)).toMatch(/Drinks: not every price was written yet; choosing that menu again writes the rest\.$/);
  });
});
