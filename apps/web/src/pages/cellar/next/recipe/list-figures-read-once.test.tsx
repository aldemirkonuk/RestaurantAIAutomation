/**
 * r41 recipes audit, gap 5: App.tsx's default `refetchOnMount: 'always'`
 * ignores every staleTime, so reopening a recipe re-read the house's money and
 * coming back to /cocktails re-priced the whole house. The house money, the
 * house percent form, the drinks' figures and the menu prices now use a fresh
 * answer when a reader mounts again, and a write still refreshes them.
 */
import { act, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const RID = '11111111-1111-4111-8111-111111111111';
const CURRENCY = '/settings/currency';
const FIGURES = `/recipes/${RID}/drinks/figures`;
const MENU = `/recipes/${RID}/menu-prices`;

const get = vi.hoisted(() => vi.fn());
vi.mock('../../../../services/api/client', () => ({
  apiClient: { get: (...a: unknown[]) => get(...a), put: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorStatus: () => null,
}));
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: RID, activeRole: 'owner', user: { role: 'owner' } }),
}));

import { drinkFiguresKey, useDrinkFigures, useMenuPrices } from './useRecipe';
import { useHouseMoney } from '../useHouseMoney';
import { useHousePercent } from './useHousePercent';

/** App.tsx's query defaults (module-private there), copied as they stand. */
function appClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 5_000, refetchOnWindowFocus: true, refetchOnMount: 'always', retry: 1, throwOnError: false },
    },
  });
}

/** What a recipe sheet and a list row read on mount. */
function Reader() {
  const say = useHouseMoney();
  const pct = useHousePercent();
  const figures = useDrinkFigures(true);
  const menu = useMenuPrices('drink', true);
  return (
    <p data-testid="read">
      {say(1)} {pct(10)} {figures.byId ? figures.byId.size : 'unread'} {menu.byId ? 'menu' : 'no menu'}
    </p>
  );
}

let toggle: () => void = () => {};
function Page() {
  const [on, setOn] = useState(true);
  toggle = () => setOn((v) => !v);
  return on ? <Reader /> : null;
}

const count = (url: string) => get.mock.calls.filter(([u]) => u === url).length;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

beforeEach(() => {
  get.mockReset().mockImplementation(async (url: string) => {
    if (url === CURRENCY) return { data: { restaurantId: RID, code: 'TRY', country: null, readable: true, reason: null, statedAt: null } };
    if (url === FIGURES) return { data: { drinks: [] } };
    if (url === MENU) return { data: { amountsWithheld: false, currentMenus: 1, dishes: [], drinks: [] } };
    throw new Error(`unexpected GET ${url}`);
  });
});

describe('a list or sheet mounted again while its figures are fresh reads nothing again', () => {
  it('closing and reopening reads the money, the figures and the menu once each', async () => {
    const view = render(
      <QueryClientProvider client={appClient()}>
        <Page />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(view.getByTestId('read').textContent).toContain('menu'));
    act(() => toggle());
    act(() => toggle());
    await settle();
    expect(view.getByTestId('read').textContent).toContain('menu');
    expect([count(CURRENCY), count(FIGURES), count(MENU)]).toEqual([1, 1, 1]);
  });

  it('a write that moves the figures still reads them again', async () => {
    const client = appClient();
    const view = render(
      <QueryClientProvider client={client}>
        <Page />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(view.getByTestId('read').textContent).toContain('menu'));
    await act(async () => {
      await client.invalidateQueries({ queryKey: drinkFiguresKey(RID) });
    });
    expect(count(FIGURES)).toBe(2);
    expect(count(CURRENCY)).toBe(1);
  });
});
