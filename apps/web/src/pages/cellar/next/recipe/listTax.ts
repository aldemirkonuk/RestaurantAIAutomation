/**
 * What a drink's or a dish's cost share is taken against: the price on the
 * house's list, or that price with the tax taken out when the house says its
 * prices include tax. A share of a price that holds tax reads lower cost than
 * the house really bears, so a tax-inclusive house would see its pour or food
 * cost understated and its margin overstated by the rate.
 *
 * The basis is the house's own answer (settings, "tax-basis"); it is never
 * guessed from the country. An unset house keeps the figure it has always had.
 */
export type ListTax =
  | { basis: 'unset' | 'prices_exclude_tax' | 'not_vat_charging' }
  | { basis: 'prices_include_tax'; /** The tax inside the list price, in percent; null when none is recorded. */ ratePct: number | null }
  /** The basis was not read (still asking, or the read failed): said, never silently assumed. */
  | { basis: 'unread'; failed: boolean };

export const UNSET_TAX: ListTax = { basis: 'unset' };

/** The price a cost share is taken against, or why there is none. */
export function priceForShare(price: number, tax: ListTax): { price: number } | { missing: string } {
  if (tax.basis !== 'prices_include_tax') return { price };
  const r = tax.ratePct;
  if (r == null || !Number.isFinite(r) || r < 0) {
    return { missing: 'your list prices include tax and no tax rate for them is recorded' };
  }
  return { price: price / (1 + r / 100) };
}

/** Said under a share or a margin: which price it is of. */
export function taxSaid(tax: ListTax): string {
  switch (tax.basis) {
    case 'unset':
      return 'Of the price as your list has it; whether that price includes tax is not recorded.';
    case 'unread':
      return `Of the price as your list has it; whether that price includes tax ${tax.failed ? 'could not be read' : 'is being read'}.`;
    case 'prices_exclude_tax':
      return 'Of the price as your list has it, which holds no tax.';
    case 'not_vat_charging':
      return 'Of the price as your list has it; your house charges no VAT.';
    case 'prices_include_tax':
      return tax.ratePct == null
        ? 'Your list prices include tax and no rate for it is recorded.'
        : `Of the price without tax: ${tax.ratePct}% taken out of your list price.`;
  }
}
