import { foldName } from "./name-fold";
import type { MenuLine } from "./menu-price-match";

/**
 * The current menu's cocktails that are not on the house's cocktail list yet
 * (r36 recipes audit, gap 3). The twin of menu-dishes.ts for /cocktails.
 *
 * WHY. A bar reads its menu and makes it current. Its dishes could already
 * come onto /dishes in one step (menu-dishes.ts); its cocktails could not.
 * The owner typed every drink again on /cocktails, with the price the menu
 * had just given, before a single pour cost could show.
 *
 * WHICH LINES ARE COCKTAILS. Only a line whose section NAMES cocktails: the
 * reader's own word "cocktail", a printed heading with the word "cocktail"
 * or "cocktails" in it ("Signature Cocktails"), or a Turkish heading with a
 * word that starts "kokteyl" ("Kokteyller", "Kokteyl Menüsü"). Compared
 * folded (`foldName`), word by word, so "Cocktail" in "Cocktails & Mocktails"
 * counts and "mocktail" alone does not.
 *  - A mocktail section is left out on purpose: the menu chain counts it a
 *    soft drink, and offering it here would put one drink in two places.
 *  - The cellar ledger's wider word list ("sour", "spritz", "signature",
 *    "punch") is NOT used: it is a hint for which register a house has, and
 *    a "Whisky sour" under "Whisky" is a whisky line there, not a recipe to
 *    make here.
 *  - A cocktail section wins over a kitchen hint: "Dessert cocktails" is a
 *    drink, and menu-dishes.ts no longer offers it as a dish.
 *
 * THE REST OF THE RULE mirrors the dishes:
 *  - a line whose folded name is already a live cocktail's name OR shown name
 *    is never offered (the Menu column matches a drink by either);
 *  - lines of one folded name are ONE drink, named and sectioned by the first
 *    read;
 *  - a line's price is its glass price when it states one, else its bottle
 *    price: a recipe is one serve, and pour cost divides by that serve's
 *    price. Lines of one name that state different prices give NO price and
 *    say so (`pricesDiffer`); a line with no price does not disagree;
 *  - a section that only says "cocktail" is not kept; one the menu names
 *    ("Signature Cocktails", "Aperitivo") is;
 *  - a name or a section is cut to 200 characters (the create form's limit)
 *    and a price past numeric(12,2), or below zero, is no price.
 */

export interface MenuDrink {
  name: string;
  section: string | null;
  price: number | null;
  /** Lines of this name gave different prices, so none is offered. */
  pricesDiffer: boolean;
}

const NAME_MAX = 200;
const PRICE_MAX = 9_999_999_999.99;

const tidy = (v: unknown): string => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");

const money = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > PRICE_MAX) return null;
  return Math.round(n * 100) / 100;
};

/** The section's words, folded. */
const words = (category: unknown): string[] => foldName(tidy(category)).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

const isCocktailWord = (w: string): boolean => w === "cocktail" || w === "cocktails" || w.startsWith("kokteyl");

/** Whether a menu line's section names cocktails. */
export function isCocktailLine(category: unknown): boolean {
  return words(category).some(isCocktailWord);
}

function sectionOf(category: unknown): string | null {
  const s = tidy(category).slice(0, NAME_MAX).trim();
  const w = words(s);
  if (w.length === 0 || w.every(isCocktailWord)) return null;
  return s;
}

/**
 * `lines` are the current menu's lines as read; `listed` the names and shown
 * names of the house's live cocktails. The answer keeps the order read.
 */
export function menuDrinksNotListed(lines: MenuLine[], listed: Array<string | null | undefined>): MenuDrink[] {
  const have = new Set(listed.filter((n): n is string => typeof n === "string").map(foldName));
  const out = new Map<string, { name: string; section: string | null; prices: Set<number> }>();
  for (const l of lines) {
    if (!isCocktailLine(l.category)) continue;
    const name = tidy(l.name).slice(0, NAME_MAX).trim();
    const key = foldName(name);
    if (!key || have.has(key)) continue;
    const price = money(l.by_glass_price) ?? money(l.bottle_price);
    let drink = out.get(key);
    if (!drink) {
      drink = { name, section: sectionOf(l.category), prices: new Set() };
      out.set(key, drink);
    }
    if (price !== null) drink.prices.add(price);
  }
  return [...out.values()].map(({ name, section, prices }) => ({
    name,
    section,
    price: prices.size === 1 ? [...prices][0] : null,
    pricesDiffer: prices.size > 1,
  }));
}
