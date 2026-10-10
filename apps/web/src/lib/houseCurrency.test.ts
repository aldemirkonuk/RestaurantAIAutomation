/**
 * Sim F-341, web half: the shared money helpers printed a literal `$` for every
 * house. They now print the house's own currency, an explicit one when given,
 * and never a dollar sign nobody read.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { formatHouseMoney, getHouseCurrency, setHouseCurrency } from './houseCurrency';
import { formatMoney } from './utils';
import { fmtMoney, fmtMoneyExact } from '../pages/inventory/command/bits';
import { money } from '../pages/cellar/next/cellar-format';

const houseCurrency = vi.fn();
vi.mock('../services/api/settings', () => ({
  settingsApi: { houseCurrency: () => houseCurrency() },
}));

describe('money helpers print the house currency', () => {
  it('a house that reports in euros sees euros on the dashboard, inventory and cellar', () => {
    setHouseCurrency('EUR');
    expect(formatMoney(845.5, 'table')).toBe('€845.50');
    expect(formatMoney(14523, 'full')).toBe('€14,523');
    expect(formatMoney(29000, 'compact')).toBe('€29.0K');
    expect(fmtMoney(1234.4)).toBe('€1,234');
    expect(fmtMoneyExact(57.14)).toBe('€57.14');
    expect(money(65)).toBe('€65.00');
  });

  it('a house in Türkiye sees lira, never dollars', () => {
    setHouseCurrency('TRY');
    for (const s of [formatMoney(800), fmtMoney(800), fmtMoneyExact(800), money(800)]) {
      expect(s).not.toContain('$');
      expect(s).toContain('TRY');
    }
  });

  it('an explicit currency wins over the house one', () => {
    setHouseCurrency('EUR');
    expect(formatMoney(10, 'table', 'GBP')).toBe('£10.00');
    expect(fmtMoneyExact(10, 'GBP')).toBe('£10.00');
    expect(money(10, 'GBP')).toBe('£10.00');
  });

  it('yen keep no decimals', () => {
    expect(formatHouseMoney(1200, 'JPY')).toBe('¥1,200');
  });

  it('a house that has not named its money is told so, with no sign', () => {
    setHouseCurrency(null);
    expect(money(65)).toBe('65.00 (currency not recorded)');
    expect(formatMoney(800)).toBe('800 (currency not recorded)');
  });

  it('before the house answers, the figure prints bare rather than in dollars', () => {
    setHouseCurrency(undefined);
    expect(fmtMoney(1234)).toBe('1,234');
    expect(money(65)).toBe('65.00');
  });
});

describe('useHouseCurrency', () => {
  beforeEach(() => {
    houseCurrency.mockReset();
    setHouseCurrency(undefined);
    window.localStorage.setItem('activeRestaurantId', 'house-1');
  });

  it("publishes the house's answer to the helpers", async () => {
    houseCurrency.mockResolvedValue({ restaurantId: 'house-1', code: 'EUR', country: 'FR', readable: true, reason: null, statedAt: null });
    const { useHouseCurrency } = await vi.importActual<typeof import('../hooks/useHouseCurrency')>('../hooks/useHouseCurrency');
    const { result } = renderHook(() => useHouseCurrency());
    await waitFor(() => expect(result.current).toBe('EUR'));
    expect(getHouseCurrency()).toBe('EUR');
    expect(money(5)).toBe('€5.00');
  });

  it('an unreadable answer is not a currency', async () => {
    houseCurrency.mockResolvedValue({ restaurantId: 'house-2', code: null, country: null, readable: false, reason: 'down', statedAt: null });
    window.localStorage.setItem('activeRestaurantId', 'house-2');
    const { useHouseCurrency } = await vi.importActual<typeof import('../hooks/useHouseCurrency')>('../hooks/useHouseCurrency');
    renderHook(() => useHouseCurrency());
    await waitFor(() => expect(houseCurrency).toHaveBeenCalled());
    expect(getHouseCurrency()).toBeUndefined();
    expect(money(5)).toBe('5.00');
  });
});
