/**
 * Money on the cellar's pages, in two kinds that must never be mixed up.
 *
 * 1. THE HOUSE'S MONEY (`useHouseMoney`): every price, cost and takings figure
 *    from this house's own books (menu, invoices, orders, quotes, till, price
 *    locks), said the way /receipts says it (`fmtMoney`: ₺ for lira, the code
 *    where a sign is shared). The cellar's own `money()` (`cellar-format.ts`)
 *    printed a bare `$` for every house, so a lira house read "$14.00" on its
 *    bottles, records, rows, charts and price locks (r8 browser check,
 *    2026-11-12). This is the hook the recipe sheet and the cocktail list
 *    already used (`recipe/useRecipe.ts`), moved here so the whole cellar
 *    prints through one; the recipe module re-exports it.
 *    - While the currency is being read: `…`, never a bare figure that gains a
 *      sign a moment later.
 *    - A failed read, or one that says the currency could not be read: the
 *      figure, and says so beside it. Never a guessed sign.
 *    - No currency stated: `fmtMoney` prints the figure with its own caveat.
 *    - An unknown amount: `—`. A numeric string from the wire is read as its
 *      number, as `money()` read it (`num`).
 *
 * 2. A REFERENCE PRICE (`sayReference`): the wine library's `price_reference`
 *    ("Market average", "List") and `retail_price_avg` ("Market price"), and
 *    the shared catalogue's `price_reference`. These are not this house's
 *    money and carry no currency at all: neither table has a currency column,
 *    and most library prices were read off restaurant menus elsewhere (ADR
 *    0117: 3,474 of 4,226 from `menu_corpus`). Printing them with the house's
 *    sign would turn a menu's 62 into 62 lira; printing `$` claims a currency
 *    the row does not state. So the figure is printed bare and says its
 *    currency is not stated.
 *
 * KEEP THIS FILE BYTE-IDENTICAL on every branch that adds it. It is added by
 * more than one open stack (each fixes the cellar files it owns), and git
 * merges an identical add of one path without a conflict.
 */
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../contexts/AuthContext';
import { settingsApi } from '../../../services/api/settings';
import { fmtMoney } from '../../receipts/next/rc2-format';
import { EM, num } from './cellar-format';

/** Formats one amount in the house's money. */
export type SayMoney = (n: number | null | undefined) => string;

export function useHouseMoney(): SayMoney {
  const { activeRestaurantId } = useAuth();
  const q = useQuery({
    queryKey: ['settings', 'currency', activeRestaurantId ?? null],
    enabled: Boolean(activeRestaurantId),
    queryFn: () => settingsApi.houseCurrency(),
    staleTime: 5 * 60_000,
  });
  const unread = q.isError || (q.data !== undefined && q.data.readable === false);
  const code = q.data?.readable ? q.data.code : null;
  return (v: number | null | undefined): string => {
    const n = num(v);
    if (n === null) return EM;
    if (q.isLoading) return '…';
    if (unread) return `${n.toFixed(2)} (the house's money could not be read)`;
    return fmtMoney(n, code);
  };
}

/** Said after a reference price: its row names no currency. */
export const REFERENCE_CURRENCY_NOTE = 'currency not stated';

/**
 * A library or catalogue reference price: the bare figure, then
 * `REFERENCE_CURRENCY_NOTE`. `noted: false` drops the note where the column or
 * fact already says it once (a table of many rows), never the figure's sign
 * rule: there is no sign either way.
 */
export function sayReference(v: number | null | undefined, noted = true): string {
  const n = num(v);
  if (n === null) return EM;
  const figure = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return noted ? `${figure} (${REFERENCE_CURRENCY_NOTE})` : figure;
}
