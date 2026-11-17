/** r36 menu audit N6: a line's house price history, newest first, read only. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PriceHistory, versionWords, dayOf } from './PriceHistory';
import { getHousePriceHistory, getHouseZone, type HouseZoneRead, type HousePriceHistory, type HousePriceVersion } from '../../../services/api/priceHistory';

vi.mock('../../../services/api/priceHistory', () => ({ getHousePriceHistory: vi.fn(), getHouseZone: vi.fn() }));
const mockZone = vi.mocked(getHouseZone);
const zoneRead = (over: Partial<HouseZoneRead> = {}): HouseZoneRead => ({ zone: null, readable: true, reason: null, ...over });
const mockHistory = vi.mocked(getHousePriceHistory);
const money = (n: number) => `₺${n}`;

const ver = (over: Partial<HousePriceVersion> = {}): HousePriceVersion => ({
  bottle: 52,
  glass: null,
  from: '2026-11-02T10:00:00Z',
  to: null,
  source: 'manual',
  by: { userId: null, name: null },
  reason: null,
  ...over,
});
const hist = (over: Partial<HousePriceHistory> = {}): HousePriceHistory => ({
  inventoryId: 'g1',
  goodName: 'Chianti',
  versions: [],
  more: false,
  namesReadable: true,
  namesReason: null,
  ...over,
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PriceHistory inventoryId="g1" name="Chianti" money={money} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockHistory.mockReset();
  mockZone.mockReset();
  mockZone.mockResolvedValue(zoneRead({ zone: 'Europe/Istanbul' }));
});

describe('one change in words', () => {
  it('says the prices, when, how, who and why', () => {
    expect(versionWords(ver({ glass: 12.5, by: { userId: 'u1', name: 'Aylin' }, reason: 'supplier rise' }), money)).toBe(
      'bottle ₺52, glass ₺12.5, since 2026-11-02, set by hand, by Aylin (supplier rise).',
    );
    expect(versionWords(ver({ bottle: 48, from: '2026-10-01T09:00:00Z', to: '2026-11-02T10:00:00Z', source: 'import' }), money)).toBe(
      'bottle ₺48, 2026-10-01 to 2026-11-02, set from a menu.',
    );
    expect(versionWords(ver({ bottle: null, source: 'agent_accepted' }), money)).toBe('no price, since 2026-11-02, set accepting price advice.');
    expect(versionWords(ver({ source: 'backfill' }), money)).toBe('bottle ₺52, since 2026-11-02, set as it stood when price records began.');
    expect(versionWords(ver({ source: 'pos_sync' }), money)).toBe('bottle ₺52, since 2026-11-02, set pos sync.');
  });

  it('says the reasons the house writes in its words, never a column or a route', () => {
    // r39 walk: a hand change on /menu read "set from a menu … (menu line corrected (bottle_price))".
    expect(versionWords(ver({ source: 'import', by: { userId: 'u1', name: 'Max' }, reason: 'menu line corrected (bottle_price)' }), money)).toBe(
      'bottle ₺52, since 2026-11-02, set by hand on the menu, by Max (its bottle price).',
    );
    expect(versionWords(ver({ source: 'import', reason: 'menu line corrected (glass_price)' }), money)).toBe(
      'bottle ₺52, since 2026-11-02, set by hand on the menu (its glass price).',
    );
    expect(versionWords(ver({ source: 'import', reason: 'menu line' }), money)).toBe('bottle ₺52, since 2026-11-02, set from a menu.');
    expect(versionWords(ver({ reason: 'typed on /inventory' }), money)).toBe('bottle ₺52, since 2026-11-02, set by hand (typed on Inventory).');
    expect(versionWords(ver({ source: 'backfill', reason: 'Seeded from restaurant_inventory when price versioning was introduced' }), money)).toBe(
      'bottle ₺52, since 2026-11-02, set as it stood when price records began.',
    );
    expect(versionWords(ver({ reason: 'written without set_house_menu_price: no person or source was named' }), money)).toBe(
      'bottle ₺52, since 2026-11-02, set by hand (written outside the price record, so no person or source was named).',
    );
  });

  it('never leaves who blank when someone set it', () => {
    expect(versionWords(ver({ by: { userId: 'u9', name: null } }), money)).toBe(
      'bottle ₺52, since 2026-11-02, set by hand, by someone whose name is not on record.',
    );
    expect(versionWords(ver({ by: { userId: 'u9', name: null } }), money, false)).toBe(
      'bottle ₺52, since 2026-11-02, set by hand, by someone not named here.',
    );
  });
});

describe('the history panel', () => {
  it('lists the changes newest first, and says when older ones are kept', async () => {
    mockHistory.mockResolvedValue(
      hist({ more: true, versions: [ver({ by: { userId: 'u1', name: 'Aylin' } }), ver({ bottle: 48, from: '2026-10-01T09:00:00Z', to: '2026-11-02T10:00:00Z', source: 'import' })] }),
    );
    mount();
    const items = await screen.findAllByTestId('menu-price-history-line');
    expect(items.map((i) => i.textContent)).toEqual([
      'bottle ₺52, since 2026-11-02, set by hand, by Aylin.',
      'bottle ₺48, 2026-10-01 to 2026-11-02, set from a menu.',
    ]);
    expect(screen.getByText('How the house price of Chianti changed, newest first (the last 2; older changes are kept):')).toBeTruthy();
    expect(mockHistory).toHaveBeenCalledWith('g1');
  });

  it('says no change was recorded, rather than an empty list', async () => {
    mockHistory.mockResolvedValue(hist());
    mount();
    expect(await screen.findByText('Chianti has no recorded price change yet.')).toBeTruthy();
    expect(screen.queryByTestId('menu-price-history-line')).toBeNull();
  });

  it('says who could not be named', async () => {
    mockHistory.mockResolvedValue(hist({ versions: [ver({ by: { userId: 'u1', name: null } })], namesReadable: false, namesReason: 'who changed these prices could not be named: denied' }));
    mount();
    expect(await screen.findByText('Not everyone could be named: who changed these prices could not be named: denied.')).toBeTruthy();
    expect(screen.getByTestId('menu-price-history-line').textContent).toBe('bottle ₺52, since 2026-11-02, set by hand, by someone not named here.');
  });

  it('a failed read is said in words, never as no history', async () => {
    mockHistory.mockRejectedValue(Object.assign(new Error('Request failed with status code 500'), { response: { status: 500, data: { message: 'The price history could not be read: timeout.' } } }));
    mount();
    expect((await screen.findByTestId('menu-price-history-error')).textContent).toBe(
      'The price history of Chianti could not be read (The price history could not be read: timeout).',
    );
    expect(screen.queryByText(/no recorded price change/)).toBeNull();
  });

  it('a refusal says who may read it', async () => {
    mockHistory.mockRejectedValue(Object.assign(new Error('Request failed with status code 403'), { response: { status: 403, data: { message: 'Forbidden' } } }));
    mount();
    expect((await screen.findByTestId('menu-price-history-error')).textContent).toBe(
      'The price history of Chianti could not be read (only an owner or a manager reads it).',
    );
  });
});

// r41 R8: a day is the house's day, not the UTC day.
describe('days on the house clock', () => {
  it('a change at 01:30 on 2 Nov in Antalya is the 2nd, not the 1st', () => {
    expect(dayOf('2026-11-01T22:30:00Z', 'Europe/Istanbul')).toBe('2026-11-02');
    expect(dayOf('2026-11-01T22:30:00Z', null)).toBe('2026-11-01');
    expect(dayOf('2026-11-01T22:30:00Z', 'Not/AZone')).toBe('2026-11-01');
    expect(versionWords(ver({ from: '2026-11-01T22:30:00Z' }), money, true, 'Europe/Istanbul')).toContain('since 2026-11-02,');
  });

  it('the panel says the house day and does not add a UTC note', async () => {
    mockHistory.mockResolvedValue(hist({ versions: [ver({ from: '2026-11-01T22:30:00Z' })] }));
    mount();
    const li = await screen.findByTestId('menu-price-history-line');
    expect(li.textContent).toContain('since 2026-11-02');
    expect(screen.queryByTestId('menu-price-history-zone')).toBeNull();
  });

  it('a house with no zone gets UTC days and is told so', async () => {
    mockZone.mockResolvedValue(zoneRead({ zone: null }));
    mockHistory.mockResolvedValue(hist({ versions: [ver({ from: '2026-11-01T22:30:00Z' })] }));
    mount();
    const li = await screen.findByTestId('menu-price-history-line');
    expect(li.textContent).toContain('since 2026-11-01');
    expect(screen.getByTestId('menu-price-history-zone').textContent).toContain('has not said its time zone');
  });

  it('a zone that could not be read says so, never a quiet UTC day', async () => {
    mockZone.mockRejectedValue(new Error('down'));
    mockHistory.mockResolvedValue(hist({ versions: [ver({ from: '2026-11-01T22:30:00Z' })] }));
    mount();
    await screen.findByTestId('menu-price-history-line');
    expect((await screen.findByTestId('menu-price-history-zone')).textContent).toContain('could not be read');
  });
});
