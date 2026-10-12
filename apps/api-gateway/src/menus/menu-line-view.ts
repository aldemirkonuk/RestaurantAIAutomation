import type { SupabaseClient } from "@supabase/supabase-js";

import { policyFor } from "../ask-readings/reading-data-classes";
import {
  MENU_CATEGORY_VOCABULARY,
  type MenuCategory,
} from "./wine-extract-item.interface";

/**
 * What one menu line read says to the person reading it (ADR 0309 option 1c,
 * amended after the audit of #655 at 220e3747d).
 *
 * The import keeps each line as the reading saw it in
 * `menu_items.raw_extracted_text`. For a CSV that is the WHOLE row
 * (`parsers/csv-parser.service.ts:55`), including every column the reader does
 * not map (cost, supplier, margin, notes: `HEADER_MAP`, `:5-29`), and no header
 * is kept with it, so nothing can tell which cell is a cost. Under ADR 0145's
 * ROLE_POLICY staff see neither `money` nor `suppliers`, so the raw line goes
 * only to a role that sees both. That is this read only: the kept source
 * file and the import reply are other paths, and the register fragment
 * `.planning/tech-debt.d/2026-10-08-fix-a-menu-line-carries-its-raw-line.md`
 * (entries (i) and (iii)) says what still reaches a member or an uploader
 * through them.
 *
 * Every member gets `kitchen_line`, worked out here from the stored row, so a
 * line's kitchen split no longer depends on who reads it or in which tab.
 *
 * The reply's marker is `rawLineWithheld`, not the money-policy synthesis's
 * one root marker `amountsWithheld`: these replies still carry the sale prices
 * (`by_glass_price`, `bottle_price`) to every member until MENU-02 withholds
 * them, so `amountsWithheld: true` would tell a reader that amounts are gone
 * when they are not. Moving these replies to `amountsWithheld` belongs with
 * MENU-02 (the coordinator's money-policy synthesis of 2026-10-07, M2).
 */

/**
 * The kitchen hints: words and phrases that mark a food line, in English and
 * Turkish (F-1173). The same list as the web's `KITCHEN`
 * (`apps/web/src/lib/firstProof.ts`); a CLAIMS row keeps the two equal, and
 * the two `isKitchenLine`s are the same test. Matched as whole words, never
 * as a substring: "Radish Imports" names no dish.
 */
export const KITCHEN_HINTS = [
  "food",
  "foods",
  "kitchen",
  "dish",
  "dishes",
  "starter",
  "starters",
  "appetizer",
  "appetizers",
  "appetiser",
  "appetisers",
  "small plates",
  "mains",
  "main course",
  "main courses",
  "entree",
  "entrees",
  "entrée",
  "entrées",
  "sides",
  "pasta",
  "pizza",
  "salad",
  "salads",
  "soup",
  "soups",
  "sandwich",
  "sandwiches",
  "burger",
  "burgers",
  "breakfast",
  "brunch",
  "dessert",
  "mezze",
  "meze",
  "mezeler",
  "ara sıcak",
  "ara sıcaklar",
  "ana yemek",
  "ana yemekler",
  "yemek",
  "yemekler",
  "başlangıç",
  "başlangıçlar",
  "salata",
  "salatalar",
  "çorba",
  "çorbalar",
  "ızgara",
  "ızgaralar",
  "kebap",
  "kebaplar",
  "pide",
  "kahvaltı",
  "mutfak",
];

/**
 * The drink sections, the web's `VOCABULARY`: the import's
 * MENU_CATEGORY_VOCABULARY (wine-extract-item.interface.ts) and 'wine'. A
 * line in one of them is a drink whatever its raw line names: 'dessert' is a
 * wine section (a Muscat de Beaumes-de-Venise), and a wine whose row names a
 * starter pairing is still a wine (F-022 on the web, F-1173 here).
 */
export const DRINK_SECTIONS = [
  "wine",
  "red",
  "white",
  "rose",
  "sparkling",
  "orange",
  "dessert",
  "fortified",
  "beer",
  "cider",
  "sake",
  "cocktail",
  "spirit",
  "whiskey",
  "soft drink",
  "non-alcoholic",
];

/**
 * A section that names wine ("Dessert wines", "Kırmızı şaraplar", "Rouges et
 * Rosés") is a drink section too, whatever food it also names: "Balık
 * Şarapları" are wines for fish (F-1392).
 */
export const WINE_WORDS = [
  "wine",
  "wines",
  "şarap",
  "şaraplar",
  "şarapları",
  "vin",
  "vins",
  "champagne",
  "rouges",
  "blancs",
  "rosés",
];

/**
 * Turkish drink sections, matched as whole words in the section (F-1272): a
 * CSV's Tür/Kategori cell is kept as written, so "Kırmızı", "Roze" or "Tatlı
 * şarap" reach here in Turkish. The same list as the web's `DRINK_WORDS`.
 */
export const DRINK_WORDS = [
  "kırmızı",
  "beyaz",
  "roze",
  "pembe",
  "köpüklü",
  "tatlı şarap",
  "rakı",
  "bira",
  "biralar",
  "viski",
  "kokteyl",
  "kokteyller",
  "alkolsüz",
  "şarap",
];

/**
 * The kind each Turkish drink section names, in MENU_CATEGORY_VOCABULARY
 * (F-1293). The library's classifier reads English words only, so "Rakı" or
 * "Bira" sent as written came back 'unknown', and an unknown house item is
 * filed as wine. 'tatlı şarap' comes before any shorter word it holds;
 * 'şarap' alone names no one kind, so it is not here.
 */
export const DRINK_WORD_KINDS: ReadonlyArray<[string, MenuCategory]> = [
  ["tatlı şarap", "dessert"],
  ["kırmızı", "red"],
  ["beyaz", "white"],
  ["roze", "rose"],
  ["pembe", "rose"],
  ["köpüklü", "sparkling"],
  ["rakı", "spirit"],
  ["bira", "beer"],
  ["biralar", "beer"],
  ["viski", "whiskey"],
  ["kokteyl", "cocktail"],
  ["kokteyller", "cocktail"],
  ["alkolsüz", "non-alcoholic"],
];

/**
 * Food nouns that keep a section a kitchen one whatever drink word it also
 * says (F-1317): "Kırmızı Et" is red meat and "Beyaz Et" is chicken, not red
 * and white wine. The same list as the web's `FOOD_NOUNS`.
 */
export const FOOD_NOUNS = [
  "etler",
  "yemek",
  "yemekler",
  "yemekleri",
  "tavuk",
  "balık",
  "balıklar",
  "köfte",
  "kebap",
  "kebaplar",
  "meze",
  "mezeler",
  "salata",
  "salatalar",
  "çorba",
  "çorbalar",
  "ızgara",
  "ızgaralar",
];

/**
 * Meat sections, as the whole heading only (F-1392): a bare 'et' is also the
 * French "and" ("Rouges et Rosés"), so it marks food only as "Et" alone or
 * after a Turkish colour. The same list as the web's `MEAT_SECTIONS`.
 */
export const MEAT_SECTIONS = ["et", "kırmızı et", "beyaz et"];

/**
 * Hints that mark food only as the section's own heading, never inside a raw
 * line (F-1272): 'tatlı' in a row means sweet, so a semi-sweet wine is no
 * dessert. As the heading, "Tatlı" is the dessert section (F-1317) unless it
 * also says şarap ("Tatlı şarap"). The same list as the web's `SECTION_HINTS`.
 */
export const SECTION_HINTS = ["desserts", "tatlı", "tatlılar"];

/** The raw line's column. Sent only when the caller's view allows it. */
export const RAW_LINE_COLUMN = "raw_extracted_text";

/**
 * The keys of a line any member of the house is sent. An allowlist: a column
 * added to the select reaches nobody until it is named here.
 */
export const MEMBER_LINE_KEYS = [
  "id",
  "name",
  "producer",
  "category",
  "vintage",
  "region",
  "country",
  "grape_variety",
  "by_glass_price",
  "bottle_price",
  "wine_library_id",
  "inventory_item_id",
  "source",
  "status",
  // Why a line is flagged, in the gateway's note ("Manually added during
  // review", "Manager corrected <field>"); /menu says it in plain words (F-151).
  "review_notes",
  "price_flag",
  "price_flag_note",
  "created_at",
] as const;

/** Who a line read is for. `rawLine` true sends the raw line itself. */
export interface LineView {
  rawLine: boolean;
}

/**
 * A text as its words, once per lower-casing, each padded so a hint is found
 * only whole (" ara sıcak "). Both lower-casings: "TATLI" is "tatlı" only the
 * Turkish way, and "Izgara" is "ızgara" only that way too.
 */
function wordRuns(text: string): string[] {
  return [text.toLowerCase(), text.toLocaleLowerCase("tr")].map(
    (lower) =>
      ` ${lower
        .split(/[^\p{L}\p{M}]+/u)
        .filter(Boolean)
        .join(" ")} `,
  );
}

/**
 * Whether a menu line is a kitchen (food) line, from its section and its raw
 * line. A known drink section wins, then a wine word in the section, then
 * a food noun, then a drink word; otherwise a whole-word hint in either decides. The same test as the web's `isKitchenLine`.
 */
export function isKitchenLine(category: unknown, raw: unknown): boolean {
  const section = typeof category === "string" ? category : "";
  if (DRINK_SECTIONS.includes(section.toLowerCase().trim())) return false;
  const sectionRuns = wordRuns(section);
  const sectionSays = (words: string[]) =>
    sectionRuns.some((run) => words.some((w) => run.includes(` ${w} `)));
  // A wine word beats a food noun: "Balık Şarapları" are wines (F-1392).
  if (sectionSays(WINE_WORDS)) return false;
  // A food noun beats a drink word: "Kırmızı Et" is meat (F-1317).
  if (sectionRuns.some((run) => MEAT_SECTIONS.includes(run.trim())))
    return true;
  if (sectionSays(FOOD_NOUNS)) return true;
  if (sectionSays(DRINK_WORDS)) return false;
  if (sectionSays(SECTION_HINTS)) return true;
  const runs = wordRuns(`${section} ${typeof raw === "string" ? raw : ""}`);
  return KITCHEN_HINTS.some((hint) =>
    runs.some((run) => run.includes(` ${hint} `)),
  );
}

/** The section words that say a line is a cocktail (F-1470). */
const COCKTAIL_WORDS = ["cocktail", "cocktails", "kokteyl", "kokteyller"];

/**
 * Whether a menu line is a cocktail, from its section (F-1470): the section
 * names cocktails and no wine. A cocktail is made from its ingredients, never
 * stocked, so a menu made current gives it no stock row of its own; what it
 * takes off the shelf is its recipe's linked lines (F-1329). "Wine &
 * cocktails" names a wine and stays a drink line as before.
 */
export function isCocktailLine(category: unknown): boolean {
  const section = typeof category === "string" ? category : "";
  const runs = wordRuns(section);
  const says = (words: string[]) =>
    runs.some((run) => words.some((w) => run.includes(` ${w} `)));
  return says(COCKTAIL_WORDS) && !says(WINE_WORDS);
}

/**
 * The section a menu line hands the library resolver (F-1293): a vocabulary
 * member as it is, a Turkish drink section as the kind it names, anything
 * else as written.
 */
export function menuCategoryOf(
  category: string | undefined,
): string | undefined {
  if (typeof category !== "string") return category;
  const lower = category.toLowerCase().trim();
  if ((MENU_CATEGORY_VOCABULARY as readonly string[]).includes(lower))
    return lower;
  const runs = wordRuns(category);
  const hit = DRINK_WORD_KINDS.find(([word]) =>
    runs.some((run) => run.includes(` ${word} `)),
  );
  return hit ? hit[1] : category;
}

/**
 * Whether this token's role may read a line's raw line: its ROLE_POLICY row
 * must see both `money` and `suppliers`, because an unmapped CSV cell can be
 * either. An unknown or missing role reads the staff row (false); `admin`
 * reads the owner row (true).
 */
export function seesRawLine(role: string | null | undefined): boolean {
  const sees = policyFor(role).sees;
  return sees.includes("money") && sees.includes("suppliers");
}

/**
 * One stored line as this viewer is sent it: the allowlisted keys the row
 * has, `kitchen_line` for everyone, and the raw line only when `view.rawLine`.
 * When a stored raw line (a non-empty string) is held back, the line says
 * `raw_line_withheld: true`; a line with no stored raw line says nothing,
 * because there is nothing to withhold. A withheld raw line is a missing key,
 * never a null: null already means "no raw line kept".
 */
export function lineForViewer(row: Record<string, unknown>, view: LineView): Record<string, unknown> {
  const raw = row[RAW_LINE_COLUMN];
  const out: Record<string, unknown> = {};
  for (const key of MEMBER_LINE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(row, key)) out[key] = row[key];
  }
  out.kitchen_line = isKitchenLine(row.category, raw);
  if (view.rawLine) {
    out[RAW_LINE_COLUMN] = raw ?? null;
  } else if (typeof raw === "string" && raw.length > 0) {
    out.raw_line_withheld = true;
  }
  return out;
}

const KITCHEN_READ_ROWS = 1000;

/**
 * The house's stock rows that only kitchen lines link to (F-1170): rows a food
 * line seeded before kitchen lines were set aside. The margin advice leaves
 * them out. A row any drink line links to stays. Every menu of the house is
 * read, keyset-paged; the raw line is read only to decide `isKitchenLine` and
 * leaves this function as nothing but the row ids. A failed page is said,
 * never an empty set.
 */
export async function readKitchenInventoryIds(
  client: SupabaseClient,
  restaurantId: string,
): Promise<{ ids: Set<string>; error: string | null }> {
  const kitchen = new Set<string>();
  const drink = new Set<string>();
  let after: string | null = null;
  for (;;) {
    let q = client
      .from("menu_items")
      .select("id, inventory_item_id, category, raw_extracted_text")
      .eq("restaurant_id", restaurantId)
      .not("inventory_item_id", "is", null)
      .neq("status", "discarded");
    if (after) q = q.gt("id", after);
    const { data, error } = await q
      .order("id", { ascending: true })
      .limit(KITCHEN_READ_ROWS);
    if (error) return { ids: new Set(), error: error.message };
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    for (const r of rows) {
      const inv = String(r.inventory_item_id);
      (isKitchenLine(r.category, r[RAW_LINE_COLUMN]) ? kitchen : drink).add(
        inv,
      );
    }
    if (rows.length < KITCHEN_READ_ROWS) break;
    after = String(rows[rows.length - 1].id);
  }
  for (const inv of drink) kitchen.delete(inv);
  return { ids: kitchen, error: null };
}
