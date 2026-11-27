/**
 * The figures behind the cocktail list's sort, its one-line strip and its
 * export (r104 drinks need 3). One place reads a drink's four numbers, so the
 * table, the sort and the export can never disagree about which drink is
 * unpriced.
 *
 * A number the list cannot stand behind is `null`, and `null` is never 0: it
 * sorts last in both directions, adds nothing to the average, and exports as an
 * empty cell (a 0 in a sheet an accountant sums would read as "free").
 */
import type { DrinkFigureRow } from '../../../services/api/recipes';
import { marginPerServe, pourCostShare } from './recipe/DrinkCards';
import type { ListTax } from './recipe/listTax';
import type { TableExportColumn } from '../../../lib/tableExport';

export type SortKey = 'price' | 'cost' | 'share' | 'margin';
export type SortDir = 'asc' | 'desc';

export interface DrinkNumbers {
  price: number | null;
  /** Cost a serve, only when the cost is complete. */
  cost: number | null;
  /** Pour cost in percent points. */
  share: number | null;
  margin: number | null;
  /** Whether the drink has a recipe; null when the figures were not read. */
  hasRecipe: boolean | null;
}

/** The first click on a header: worst-first for a cost, highest-first for a price. */
export const FIRST_DIR: Record<SortKey, SortDir> = { price: 'desc', cost: 'desc', share: 'desc', margin: 'asc' };

export function drinkNumbers(
  price: number | null | undefined,
  f: DrinkFigureRow | undefined,
  read: boolean,
  tax: ListTax,
): DrinkNumbers {
  const p = price ?? null;
  if (!read || !f) return { price: p, cost: null, share: null, margin: null, hasRecipe: null };
  if (!f.hasRecipe) return { price: p, cost: null, share: null, margin: null, hasRecipe: false };
  const share = pourCostShare(f.cost, p, tax);
  const margin = marginPerServe(f.cost, p, tax);
  return {
    price: p,
    cost: f.cost?.complete ? f.cost.perServe : null,
    share: 'pct' in share ? share.pct : null,
    margin: 'margin' in margin ? margin.margin : null,
    hasRecipe: true,
  };
}

/** Sorts a copy: an unknown number is last whichever way the column runs, ties fall to the name. */
export function sortDrinks<T extends { name: string; display_name?: string | null }>(
  rows: T[],
  key: SortKey | null,
  dir: SortDir,
  numbersOf: (row: T) => DrinkNumbers,
): T[] {
  if (!key) return rows;
  const label = (r: T) => r.display_name ?? r.name;
  return [...rows].sort((a, b) => {
    const x = numbersOf(a)[key];
    const y = numbersOf(b)[key];
    if (x == null && y == null) return label(a).localeCompare(label(b));
    if (x == null) return 1;
    if (y == null) return -1;
    if (x !== y) return dir === 'asc' ? x - y : y - x;
    return label(a).localeCompare(label(b));
  });
}

export interface Strip {
  /** Mean pour cost over the drinks that have one; null when none does. */
  averageShare: number | null;
  priced: number;
  /** Has a recipe but no complete cost: the cost is what is missing. */
  unpriced: number;
  /** Has a complete cost but no share: the list price (or its tax rate) is missing. */
  noShare: number;
  noRecipe: number;
  /** The basis is "prices include tax" with no rate recorded: no share can be taken for any drink. */
  noTaxRate: boolean;
}

export function stripFor(all: DrinkNumbers[], tax?: ListTax): Strip {
  const shares = all.map((n) => n.share).filter((s): s is number => s != null);
  const avg = shares.length ? shares.reduce((a, b) => a + b, 0) / shares.length : null;
  const costedNoShare = all.filter((n) => n.hasRecipe === true && n.cost != null && n.share == null).length;
  return {
    averageShare: avg == null ? null : Math.round(avg * 10) / 10,
    priced: shares.length,
    unpriced: all.filter((n) => n.hasRecipe === true && n.cost == null).length,
    noShare: costedNoShare,
    noRecipe: all.filter((n) => n.hasRecipe === false).length,
    noTaxRate: tax?.basis === 'prices_include_tax' && tax.ratePct == null && costedNoShare > 0,
  };
}

/** The strip's one line. "Not priced" counts only drinks with no cost; a costed drink is never called unpriced. */
export function stripSaid(s: Strip, sayPct: (n: number) => string): string {
  const drinks = `${s.priced} priced ${s.priced === 1 ? 'drink' : 'drinks'}`;
  const head = s.noTaxRate
    ? `Pour cost not known: no tax rate recorded for your list prices (${s.noShare} costed ${s.noShare === 1 ? 'drink' : 'drinks'})`
    : `${s.averageShare == null ? 'Average pour cost: not known' : `Average pour cost ${sayPct(s.averageShare)}`} over ${drinks}`;
  const noPrice = !s.noTaxRate && s.noShare > 0 ? ` · ${s.noShare} costed with no usable list price` : '';
  return `${head} · ${s.unpriced} not priced${noPrice} · ${s.noRecipe} with no recipe`;
}

interface ExportRow {
  name: string;
  display_name?: string | null;
  menu_section?: string | null;
  method?: string | null;
  glass?: string | null;
  garnish?: string | null;
  numbers: DrinkNumbers;
}

/** What is on screen, in the order it is on screen. Cost columns exist only for a role that sees cost. */
export function exportColumns(seesCost: boolean): TableExportColumn<ExportRow>[] {
  const base: TableExportColumn<ExportRow>[] = [
    { header: 'Cocktail', value: (r) => r.display_name ?? r.name },
    { header: 'Section', value: (r) => r.menu_section },
    { header: 'Method', value: (r) => r.method },
    { header: 'Glass', value: (r) => r.glass },
    { header: 'Garnish', value: (r) => r.garnish },
    { header: 'Price', value: (r) => r.numbers.price },
  ];
  if (!seesCost) return base;
  return [
    ...base,
    { header: 'Cost per serve', value: (r) => r.numbers.cost },
    { header: 'Pour cost %', value: (r) => r.numbers.share },
    { header: 'Margin', value: (r) => r.numbers.margin },
  ];
}
