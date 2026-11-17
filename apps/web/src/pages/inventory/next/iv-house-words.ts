/**
 * The words the page says a house's goods in.
 *
 * A house that stocks drinks says "cellar", "titles" and "bottles", the way the
 * page always has. A house whose book holds only food and supplies has no
 * cellar and no bottles, so it hears "stock room" and "goods", and the opening
 * sentence does not add kilograms to litres and call the sum bottles. A house
 * with any drink at all keeps the drink words, so a mixed house reads as before.
 * Rows not read yet say nothing about the house, so they get the drink words.
 */
import type { GoodKind } from './iv-url';

export type HouseWords = {
  /** "The cellar · Inventory" */
  place: string;
  one: string;
  /** The map view's button. */
  map: string;
  many: string;
  /** The search box's label and hint. */
  search: string;
  /** True when the opening sentence may count bottles. */
  bottles: boolean;
};

export const DRINK_WORDS: HouseWords = {
  place: 'cellar',
  one: 'title',
  map: 'Cellar map',
  many: 'titles',
  search: 'Search titles, producers, grapes',
  bottles: true,
};

export const GOODS_WORDS: HouseWords = {
  place: 'stock room',
  one: 'good',
  map: 'Stock room map',
  many: 'goods',
  search: 'Search goods',
  bottles: false,
};

/** Goods-only when at least one good is listed and none of them is a drink. */
export function houseWordsFor(kinds: GoodKind[]): HouseWords {
  return kinds.length > 0 && kinds.every((k) => k !== 'drink') ? GOODS_WORDS : DRINK_WORDS;
}
