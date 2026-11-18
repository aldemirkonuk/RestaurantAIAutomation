import { isKitchenLine } from "../menus/menu-line-view";
import { foldName } from "./name-fold";
import type { MenuLine } from "./menu-price-match";
import { isCocktailLine } from "./menu-drinks";

/**
 * The current menu's dishes that are not on the house's dish list yet
 * (r28 onboarding audit, gap 1, slice 3).
 *
 * WHY. A food house reads its menu at /get-started and /house/menu tells it
 * "A dish is not carried to stock or prices yet." On /dishes it then had to
 * type every dish again, one form at a time, with the price it had just read.
 * Nothing carried a menu dish to a dish card, so a house with forty plates
 * met forty forms before its first food cost.
 *
 * THE RULE.
 *  - Only a kitchen line of a CURRENT menu is offered (the caller reads
 *    `readCurrentMenuLines`; this decides kitchen the way the Menu column
 *    does, `isKitchenLine(category, null)` in menu-price-match.ts). Which
 *    sections count as kitchen is that rule's call, not this file's: the
 *    menu chain widens it to "Mains", "Meze", "Çorbalar" and the like.
 *  - A line whose folded name (`foldName`: case, the dotless ı, accents,
 *    spaces) is already a live dish is never offered, so a dish is never made
 *    twice and a dish the house typed itself is left as it is.
 *  - Lines of one folded name are ONE dish. Its name and section come from
 *    the first of them as read (`readCurrentMenuLines` reads in line-id
 *    order; a menu keeps no other order).
 *  - A line's price is its `bottle_price`, else its `by_glass_price`: the
 *    readers keep a dish's one figure in `bottle_price` (HouseMenu's
 *    `dishPrice` reads it the same way). When the lines of one name state
 *    different prices, the dish is offered with NO price and says so
 *    (`pricesDiffer`), never one of them guessed. A line with no price does
 *    not disagree with one that has one.
 *  - A line whose section names cocktails ("Cocktails", "Kokteyller") is a
 *    drink, never a dish, even when the section also holds a kitchen hint
 *    ("Dessert cocktails"): it is offered on /cocktails instead
 *    (menu-drinks.ts, r36 recipes audit gap 3).
 *  - A section that only says "this is food" ("Food", "Kitchen", "Dish") is
 *    not kept as a section; one the menu names ("Starters", "Pasta") is.
 *  - Values the dishes table would refuse are not sent: a name or section is
 *    cut to 200 characters, and a price past numeric(12,2) is no price.
 */

/** One dish the menu offers. */
export interface MenuDish {
  name: string;
  section: string | null;
  price: number | null;
  /** Lines of this name gave different prices, so none is offered. */
  pricesDiffer: boolean;
}

/** The dishes table's limits (migration 20270803100000_a_dish_has_a_recipe). */
const NAME_MAX = 200;
const PRICE_MAX = 9_999_999_999.99;

/** Section words that say only "food". Compared folded. */
const NOT_A_SECTION = new Set(["food", "foods", "kitchen", "dish", "dishes", "unknown"]);

const tidy = (v: unknown): string => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");

const money = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > PRICE_MAX) return null;
  return Math.round(n * 100) / 100;
};

const linePrice = (l: MenuLine): number | null => money(l.bottle_price) ?? money(l.by_glass_price);

function sectionOf(category: unknown): string | null {
  const s = tidy(category).slice(0, NAME_MAX).trim();
  if (!s || NOT_A_SECTION.has(foldName(s))) return null;
  return s;
}

/**
 * `lines` are the current menu's lines as read; `listed` the names of the
 * house's live dishes. The answer keeps the order the lines were read in.
 */
export function menuDishesNotListed(lines: MenuLine[], listed: Array<string | null | undefined>): MenuDish[] {
  const have = new Set(listed.filter((n): n is string => typeof n === "string").map(foldName));
  const out = new Map<string, { name: string; section: string | null; prices: Set<number> }>();
  for (const l of lines) {
    const name = tidy(l.name).slice(0, NAME_MAX).trim();
    const key = foldName(name);
    if (!key || have.has(key)) continue;
    if (!isKitchenLine(l.category, null) || isCocktailLine(l.category)) continue;
    const price = linePrice(l);
    let dish = out.get(key);
    if (!dish) {
      dish = { name, section: sectionOf(l.category), prices: new Set() };
      out.set(key, dish);
    }
    // A line that states no price does not disagree with one that does.
    if (price !== null) dish.prices.add(price);
  }
  return [...out.values()].map(({ name, section, prices }) => ({
    name,
    section,
    price: prices.size === 1 ? [...prices][0] : null,
    pricesDiffer: prices.size > 1,
  }));
}
