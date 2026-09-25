/**
 * Locked prices on /menu (ADR 0193 round 3, L17, L23, L25). The founder,
 * 2026-09-21, verbatim: "add a section to that where you can lock price, but
 * wha f that menu item disappears?". A lock whose wine left the menu is kept
 * and listed; nothing expires; a failed read is never "no locks". The API
 * module is replaced (the gateway is not the unit here); the section runs for
 * real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LockedPrices, markerWords } from './LockedPrices';
import { housePriceNote } from './menu-price-note';
import {
  changeLockedPrice,
  getPriceAdvice,
  listPriceLocks,
  movePriceLock,
  releasePriceLock,
  type LockReadout,
  type PriceLock,
} from '../../../services/api/pricing';

vi.mock('../../../services/api/pricing', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/pricing')>('../../../services/api/pricing');
  return {
    ...actual,
    listPriceLocks: vi.fn(),
    changeLockedPrice: vi.fn(),
    releasePriceLock: vi.fn(),
    movePriceLock: vi.fn(),
    getPriceAdvice: vi.fn(),
  };
});

const mockList = vi.mocked(listPriceLocks);
const mockChange = vi.mocked(changeLockedPrice);
const mockRelease = vi.mocked(releasePriceLock);
const mockMove = vi.mocked(movePriceLock);
const mockAdvice = vi.mocked(getPriceAdvice);

function lock(over: Partial<PriceLock> = {}): PriceLock {
  return {
    lockId: 'lock-a',
    inventoryId: 'inv-a',
    kind: 'bottle',
    lockedPrice: 50,
    lockedAt: '2026-09-09T09:00:00Z',
    ageDays: 12,
    note: 'season',
    movedFromLockId: null,
    lockedBy: { userId: 'u5', name: 'Aylin' },
    wine: { name: 'Barolo', vintage: 2019, masterWineId: 'mw-a', active: true, housePrice: 50 },
    dormant: false,
    menuPrice: 55,
    markers: ['off_target', 'menu_differs'],
    advice: { state: 'raise', sentence: 'Raise the bottle to 57.14 (now 50.00).', advisedPrice: 57.14, gapPct: -12.5 },
    adviceUnknownReason: null,
    ...over,
  };
}

const DORMANT = lock({
  lockId: 'lock-c',
  inventoryId: 'inv-c',
  kind: 'glass',
  lockedPrice: 9,
  ageDays: 3,
  note: null,
  lockedBy: { userId: 'u6', name: 'Deniz' },
  wine: { name: 'Soave', vintage: null, masterWineId: 'mw-c', active: false, housePrice: 9 },
  dormant: true,
  menuPrice: null,
  markers: ['not_on_current_menu', 'wine_removed', 'author_without_access', 'advice_unknown'],
  advice: null,
  adviceUnknownReason: 'Cannot advise: no recorded cost for this wine.',
});

function readout(over: Partial<LockReadout> = {}): LockReadout {
  return {
    restaurantId: 'r1',
    generatedAt: '2026-09-21T12:00:00Z',
    readable: true,
    reason: null,
    scope: 'this house',
    currentMenus: [{ menuId: 'menu-1', name: 'Autumn list' }],
    locks: [lock(), DORMANT],
    counts: { open: 2, onCurrentMenu: 1, notOnCurrentMenu: 1, toReview: 2 },
    namesReadable: true,
    namesReason: null,
    markersReadable: true,
    markersReason: null,
    ...over,
  };
}

function mount(canManage: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LockedPrices canManage={canManage} />
    </QueryClientProvider>,
  );
}

const act = (sentence: string) => ({
  outcome: 'released' as const,
  lock: { lockId: 'x', inventoryId: 'inv-a', kind: 'bottle' as const, lockedPrice: 50 },
  previousLockId: null,
  housePrice: 50,
  sentence,
});

beforeEach(() => {
  mockList.mockReset();
  mockChange.mockReset();
  mockRelease.mockReset();
  mockMove.mockReset();
  mockAdvice.mockReset();
});

describe('Locked prices', () => {
  it('groups the locks by the current menu and says each one\'s facts in words -- a removed wine included (L17, L23)', async () => {
    mockList.mockResolvedValue(readout());
    mount(true);
    expect(await screen.findByTestId('locked-prices-standing')).toHaveTextContent('2 prices locked at this house, 2 worth a look.');
    const onMenu = screen.getByTestId('locked-on-menu');
    expect(onMenu).toHaveTextContent('Barolo 2019 (bottle) locked at 50.00');
    expect(onMenu).toHaveTextContent('by Aylin, 12 days ago');
    expect(onMenu).toHaveTextContent('off your target margin: Raise the bottle to 57.14 (now 50.00).');
    expect(onMenu).toHaveTextContent('the current menu reads 55.00');
    const off = screen.getByTestId('locked-off-menu');
    expect(screen.getByText('Locked, not on the current menu')).toBeInTheDocument();
    expect(off).toHaveTextContent('Soave (glass) locked at 9.00');
    expect(off).toHaveTextContent('the wine was removed from inventory');
    expect(off).toHaveTextContent('set by someone who no longer manages this house');
    expect(off).toHaveTextContent('no advice: Cannot advise: no recorded cost for this wine.');
  });

  it('L25: a lock whose menu standing could not be read is in its own group -- never "On the current menu" (last-call review)', async () => {
    const unknownA = lock({ dormant: null, markers: ['off_target'] });
    const unknownC = { ...DORMANT, dormant: null, markers: ['wine_removed' as const] };
    mockList.mockResolvedValue(
      readout({
        locks: [unknownA, unknownC],
        counts: { open: 2, onCurrentMenu: 0, notOnCurrentMenu: 0, toReview: 2 },
        markersReadable: false,
        markersReason: 'Some facts about these locks are not shown: the current menu could not be read (timeout).',
      }),
    );
    mount(true);
    const group = await screen.findByTestId('locked-menu-unknown');
    expect(screen.getByText('Locked (whether on the current menu could not be read)')).toBeInTheDocument();
    expect(group).toHaveTextContent('Barolo 2019 (bottle) locked at 50.00');
    expect(group).toHaveTextContent('Soave (glass) locked at 9.00');
    expect(screen.queryByTestId('locked-on-menu')).not.toBeInTheDocument();
    expect(screen.queryByTestId('locked-off-menu')).not.toBeInTheDocument();
    expect(screen.getByText(/the current menu could not be read \(timeout\)/)).toBeInTheDocument();
    // A move is offered for a lock KNOWN to be off the menu only.
    expect(within(group).queryByRole('button', { name: 'Move to another wine' })).not.toBeInTheDocument();
  });

  it('with no current menu, the group says so', async () => {
    mockList.mockResolvedValue(readout({ currentMenus: [], locks: [DORMANT] }));
    mount(true);
    expect(await screen.findByText('Locked (there is no current menu)')).toBeInTheDocument();
  });

  it('L25: a lock list that could not be read says so -- never "no price is locked"', async () => {
    mockList.mockResolvedValue(readout({ readable: false, reason: 'The price locks could not be read: denied. This is not the same as having none.', locks: [] }));
    mount(true);
    expect(await screen.findByTestId('locked-prices-error')).toHaveTextContent('could not be read: denied. This is not the same as having none.');
    expect(screen.queryByTestId('locked-prices-none')).not.toBeInTheDocument();
  });

  it('L25: a request that fails outright says so too', async () => {
    mockList.mockRejectedValue(new Error('Network Error'));
    mount(true);
    expect(await screen.findByTestId('locked-prices-error')).toHaveTextContent('could not be read (Network Error). This is not the same as having none.');
  });

  it('no locks at all is said plainly', async () => {
    mockList.mockResolvedValue(readout({ locks: [], counts: { open: 0, onCurrentMenu: 0, notOnCurrentMenu: 0, toReview: 0 } }));
    mount(false);
    expect(await screen.findByTestId('locked-prices-none')).toHaveTextContent('No price is locked at this house.');
  });

  it('L6: change and keep locked names the new price, and the answer is shown as the gateway said it', async () => {
    mockList.mockResolvedValue(readout());
    mockChange.mockResolvedValue({ ...act('The bottle price is now 58.00 (it was 50.00) and stays locked.'), outcome: 'changed_and_locked' });
    mount(true);
    const row = (await screen.findAllByTestId('locked-price-row'))[0];
    fireEvent.click(within(row).getByRole('button', { name: 'Change and keep locked' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Save, keep locked' }));
    expect(await within(row).findByRole('alert')).toHaveTextContent('Say the new price: a number of 0 or more.');
    expect(mockChange).not.toHaveBeenCalled();
    fireEvent.change(within(row).getByLabelText('New bottle price for Barolo'), { target: { value: '58' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save, keep locked' }));
    await waitFor(() => expect(mockChange).toHaveBeenCalledWith('lock-a', 58));
    expect(await screen.findByTestId('locked-prices-said')).toHaveTextContent('The bottle price is now 58.00 (it was 50.00) and stays locked.');
  });

  it('L24: release is one tap, and its sentence (the price stays) is shown', async () => {
    mockList.mockResolvedValue(readout());
    mockRelease.mockResolvedValue(act('The lock is released. The current menu reads 55.00; the house price stays 50.00 until a menu is chosen or a manager changes it.'));
    mount(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Release the bottle lock on Barolo' }));
    await waitFor(() => expect(mockRelease).toHaveBeenCalledWith('lock-a'));
    expect(await screen.findByTestId('locked-prices-said')).toHaveTextContent('the house price stays 50.00 until a menu is chosen');
  });

  it('L20: a dormant lock moves only to a wine the person chooses, at a price the person names', async () => {
    mockList.mockResolvedValue(readout());
    mockAdvice.mockResolvedValue({
      restaurantId: 'r1',
      generatedAt: 'x',
      target: { bottlePct: null, glassPct: null, bandPct: null, set: false, pourConfirmed: false, pourMl: null },
      wines: [
        { inventoryId: 'inv-c', wineName: 'Soave', costBasis: 'unknown', costBasisLabel: '', bottleCost: null, bottle: null, glass: null },
        { inventoryId: 'inv-d', wineName: 'Soave Classico', costBasis: 'unknown', costBasisLabel: '', bottleCost: null, bottle: null, glass: null },
      ],
      counts: { no_target: 0, pour_unconfirmed: 0, no_price: 0, no_cost: 0, on_target: 0, raise: 0, lower: 0 },
    });
    mockMove.mockResolvedValue({ ...act('The lock moved.'), outcome: 'moved' });
    mount(true);
    const rows = await screen.findAllByTestId('locked-price-row');
    // Only the dormant lock offers a move.
    expect(within(rows[0]).queryByRole('button', { name: 'Move to another wine' })).not.toBeInTheDocument();
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Move to another wine' }));
    const select = await within(rows[1]).findByLabelText('Wine the lock moves to');
    // The lock's own wine is not offered as a target.
    expect(within(select).queryByText('Soave')).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'inv-d' } });
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Move the lock' }));
    expect(await within(rows[1]).findByRole('alert')).toHaveTextContent('Say the price it is locked at: a move never guesses one.');
    expect(mockMove).not.toHaveBeenCalled();
    fireEvent.change(within(rows[1]).getByLabelText('Price the moved lock holds'), { target: { value: '9.50' } });
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Move the lock' }));
    await waitFor(() => expect(mockMove).toHaveBeenCalledWith('lock-c', 'inv-d', 9.5));
  });

  it('a refused act is said, and nothing is claimed', async () => {
    mockList.mockResolvedValue(readout());
    mockRelease.mockRejectedValue({ response: { status: 409, data: { message: 'lock lock-a was already released' } } });
    mount(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Release the bottle lock on Barolo' }));
    expect(await screen.findByText('Nothing was changed: lock lock-a was already released.')).toBeInTheDocument();
    expect(screen.queryByTestId('locked-prices-said')).not.toBeInTheDocument();
  });

  it('L8: staff read every lock, with no controls', async () => {
    mockList.mockResolvedValue(readout());
    mount(false);
    expect(await screen.findAllByTestId('locked-price-row')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Release|Change and keep locked|Move/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Only an owner or a manager changes or releases a lock/)).toBeInTheDocument();
  });

  it('markerWords says nothing for a lock that fits', () => {
    expect(markerWords(lock({ markers: [] }))).toEqual([]);
  });
});

describe('the add-a-line note names a held kind (L5)', () => {
  it('a line whose price a lock held says so -- never "now matches"', () => {
    expect(
      housePriceNote({ priceSync: 'locked', priceHeld: [{ kind: 'bottle', lockId: 'k', lockedPrice: 95, lockedBy: 'u', lockedAt: 't' }] })?.text,
    ).toBe("Added to the menu, but the bottle price is locked at 95.00, so the house's price was not changed. An owner or a manager changes it under Locked prices.");
    expect(
      housePriceNote({ priceSync: 'changed', priceHeld: [{ kind: 'glass', lockId: 'k', lockedPrice: 9, lockedBy: 'u', lockedAt: 't' }] })?.text,
    ).toBe("This wine's own price on Inventory was updated where it could be; the glass price is locked at 9.00, so that one was not changed.");
    expect(housePriceNote({ priceSync: 'changed', priceHeld: [] })?.text).toBe("This wine's own price on Inventory now matches the line.");
  });
});
