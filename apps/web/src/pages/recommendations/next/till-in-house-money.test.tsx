/**
 * The ribbon's "through the till" figure is the house's money.
 *
 * It printed a bare `$` for every house, so a lira house read "$4,210 through
 * the till" on /recommendations (r9, 2026-11-12). The till window names no
 * currency, so the figure is said in the house's own currency, read from
 * `/settings/currency` beside the till window, never guessed.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import type { HouseCurrency } from '@/services/api/settings';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1', activeRole: 'owner' }),
}));
vi.mock('@/services/api/client', () => ({ apiClient: api }));
vi.mock('@/services/api/team', () => ({ getTeamMembers: vi.fn(async () => []) }));

import Ribbon from './Ribbon';
import { useRecommendationsNextData } from './useRecommendationsNextData';
import { sayTill, type DayCell } from './rec-days';

const house = (code: string | null, readable = true): HouseCurrency => ({
  restaurantId: 'r1',
  code,
  country: null,
  readable,
  reason: readable ? null : 'settings could not be read',
  statedAt: null,
});

describe('sayTill', () => {
  it('[REVERT-FAILS] says a lira house its lira, not dollars', () => {
    const said = sayTill(4210.5, house('TRY'));
    expect(said).toBe('₺4,210.50 through the till');
    expect(said).not.toMatch(/\$/);
  });

  it('keeps the dollar for a dollar house', () => {
    expect(sayTill(4210.5, house('USD'))).toBe('$4,210.50 through the till');
  });

  it('waits while the currency is being read, rather than gaining a sign later', () => {
    expect(sayTill(4210.5, undefined)).toBe('… through the till');
  });

  it('prints no sign and says why when the currency cannot be read', () => {
    const want = "4210.50 through the till (the house's money could not be read)";
    expect(sayTill(4210.5, null)).toBe(want);
    expect(sayTill(4210.5, house('TRY', false))).toBe(want);
  });

  it('says the currency is not recorded when the house has none', () => {
    const said = sayTill(4210.5, house(null));
    expect(said).toMatch(/4,210\.50 \(currency not recorded\) through the till/);
    expect(said).not.toMatch(/\$/);
  });
});

describe('the ribbon day head', () => {
  const day: DayCell = {
    date: '2026-11-10',
    weekday: 'T',
    dayNum: 10,
    isToday: false,
    isFuture: false,
    fired: [],
    due: [],
    records: 'yes',
    revenue: 4210.5,
    excluded: false,
    excludedReason: null,
  };

  it('[REVERT-FAILS] says the selected day’s till money in the house’s currency', () => {
    render(
      <Ribbon
        days={[day]}
        month="2026-11"
        onMonth={() => {}}
        today="2026-11-12"
        selected="2026-11-10"
        onSelect={() => {}}
        pos={{ connected: true, from: '2026-11-01', to: '2026-11-12', byDay: { '2026-11-10': 4210.5 } }}
        posProblem={null}
        houseCurrency={house('TRY')}
        exclusionsReadable={true}
        exclusionsProblem={null}
        onExclude={() => {}}
        onInclude={() => {}}
        canRuleOut={false}
        undated={0}
        matching={0}
      />,
    );
    const head = screen.getByTestId('rc-dayhead');
    expect(head).toHaveTextContent('₺4,210.50 through the till');
    expect(head.textContent).not.toMatch(/\$\d/);
  });
});

describe('useRecommendationsNextData reads the house currency', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
  });

  const route = (currency: () => Promise<unknown>) =>
    api.get.mockImplementation(async (url: string) => {
      if (url === '/settings/currency') return currency();
      if (url.includes('/digest')) return { data: { digestEnabled: false, digestHour: 7 } };
      if (url.includes('/exclusions')) return { data: { items: [], readable: true, problem: null } };
      return { data: {} };
    });

  it('[REVERT-FAILS] hands the ribbon the house’s currency', async () => {
    route(async () => ({ data: house('TRY') }));
    const { result } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(result.current.houseCurrency).toEqual(house('TRY')));
    expect(api.get).toHaveBeenCalledWith('/settings/currency');
  });

  it('says null, not a currency, when the read fails', async () => {
    route(async () => {
      throw { response: { status: 500 }, message: 'Request failed' };
    });
    const { result } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(result.current.houseCurrency).toBeNull());
  });

  it('says null for a reply that is not a currency readout', async () => {
    route(async () => ({ data: { items: [] } }));
    const { result } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(result.current.houseCurrency).toBeNull());
  });
});

