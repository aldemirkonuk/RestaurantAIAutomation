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
  // ADR 0340 rule 25: the line's own section, its place in it, whether it is
  // a drink or a dish (NULL = legacy or undecided), its drink category token,
  // and a dish's price. A dish price is a sale price like bottle_price, so it
  // follows the same allowlist (rule 23).
  "section_id",
  "position",
  "line_kind",
  "drink_category",
  "price",
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
 * Section words that name a stocked drink beside cocktails (F-1503):
 * "Cocktails & Spirits", "Beer & Cocktails", "Kokteyller ve Rakılar".
 */
const STOCKED_DRINK_WORDS = [
  "spirit",
  "spirits",
  "beer",
  "beers",
  "whisky",
  "whiskey",
  "whiskies",
  "bourbon",
  "gin",
  "vodka",
  "rum",
  "tequila",
  "cognac",
  "liqueur",
  "liqueurs",
  "shots",
  "rakı",
  "rakılar",
  "bira",
  "biralar",
  "viski",
  "votka",
  "cin",
  "konyak",
  "likör",
  "likörler",
];

/** Words that make a line in a mixed section a beer, so stocked (F-1503). */
const BEER_WORDS = ["beer", "lager", "pilsner", "pils", "ipa", "stout", "bira"];

/**
 * A pour size or a bottle in a line's name (F-1503): "Maker's Mark 5cl",
 * "Efes 50 cl", "Yeni Rakı 70'lik", "Jameson bottle", "Jack duble".
 */
const STOCKED_SIZE =
  /\d\s*(cl|ml|lt?|oz)(?![\p{L}])|\d\s*'?\s*l[iı]k(?![\p{L}])|(?<![\p{L}])(bottle|şişe|pint|duble|tek)(?![\p{L}])/iu;

/**
 * Whether a menu line is a cocktail, from its section (F-1470): the section
 * names cocktails and no wine. A cocktail is made from its ingredients, never
 * stocked, so a menu made current gives it no stock row of its own; what it
 * takes off the shelf is its recipe's linked lines (F-1329). "Wine &
 * cocktails" names a wine and stays a drink line as before.
 *
 * F-1503: a section that also names a stocked drink ("Cocktails & Spirits",
 * "Kokteyller ve Rakılar") is decided line by line. A line with a pour size
 * or a bottle, or one naming a beer, is stocked and keeps its stock row; any
 * other line there is a cocktail, as before. A spirit with no size ("Gin
 * Tonic", "Hendrick's") cannot be told from a cocktail by its name and stays
 * a cocktail.
 */
export function isCocktailLine(category: unknown, name?: unknown): boolean {
  const section = typeof category === "string" ? category : "";
  const runs = wordRuns(section);
  const says = (words: string[]) =>
    runs.some((run) => words.some((w) => run.includes(` ${w} `)));
  if (!says(COCKTAIL_WORDS) || says(WINE_WORDS)) return false;
  if (!says(STOCKED_DRINK_WORDS)) return true;
  const line = typeof name === "string" ? name : "";
  const lineRuns = wordRuns(line);
  const lineSays = (words: string[]) =>
    lineRuns.some((run) => words.some((w) => run.includes(` ${w} `)));
  if (lineSays(COCKTAIL_WORDS)) return true;
  return !(STOCKED_SIZE.test(line) || lineSays(BEER_WORDS));
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
 * The menu kinds on which a line with no stored kind is never a drink (ADR
 * 0340 rule 7, lane 3a). Every line stored before lane 1 sits on a Drinks
 * menu (`createVersion` wrote `beverage` only), so the legacy rule below
 * keeps each of them where it was; a line on a Food or Desserts menu has to
 * be told it is a drink (its `line_kind`) before it reaches the library, the
 * stock or a house price. The same list as the web's `NON_DRINK_MENU_KINDS`.
 */
export const NON_DRINK_MENU_KINDS = ["food", "desserts"];

/** What `lineIsDrink` reads of a line: its stored kind, section and raw line. */
export interface LineKindInput {
  line_kind?: unknown;
  category?: unknown;
  raw?: unknown;
}

/**
 * Whether a menu line is a drink (ADR 0340 rules 7 and 8): the ONE test every
 * gate uses (the import's resolver call, a line added by hand, the carry,
 * `kitchen_line`, the margin advice's kitchen rows).
 * - a stored `line_kind` decides: 'drink' yes, 'dish' no;
 * - with none, on a Food or Desserts menu: no (undecided is not a drink);
 * - with none, on any other menu (Drinks, a legacy kind, or a kind the caller
 *   does not know, `null`): today's rule exactly, a drink unless
 *   `isKitchenLine` says kitchen, so no stored line changes status.
 */
export function lineIsDrink(line: LineKindInput, menuKind: unknown): boolean {
  if (line.line_kind === "drink") return true;
  if (line.line_kind === "dish") return false;
  if (typeof menuKind === "string" && NON_DRINK_MENU_KINDS.includes(menuKind))
    return false;
  return !isKitchenLine(line.category, line.raw);
}

/** Whether a value is a token of the 0186 vocabulary. */
export function isMenuCategory(value: unknown): value is MenuCategory {
  return (
    typeof value === "string" &&
    (MENU_CATEGORY_VOCABULARY as readonly string[]).includes(value)
  );
}

/** A section as the drink category reads it (`menu_sections`, ADR 0340 rule 6). */
export interface SectionCategory {
  parent_id: string | null;
  drink_category: string | null;
  confirmed_at: string | null;
}

/** What the drink category reads of a line. */
export interface CategoryInput {
  drink_category?: unknown;
  section_id?: unknown;
  category?: unknown;
}

/** A section's parents, nearest first. Stops at a missing id or a cycle. */
function ancestors(
  sectionId: unknown,
  sections: ReadonlyMap<string, SectionCategory>,
): SectionCategory[] {
  const out: SectionCategory[] = [];
  const seen = new Set<string>();
  let id = typeof sectionId === "string" ? sectionId : null;
  while (id && !seen.has(id)) {
    seen.add(id);
    const s = sections.get(id);
    if (!s) break;
    out.push(s);
    id = s.parent_id;
  }
  return out;
}

/**
 * A drink line's effective category (ADR 0340 rule 7): the line's own
 * `drink_category`, else its nearest section's (walking up), else the token
 * its `category` names (a vocabulary token as it is, a Turkish drink section
 * as the kind it names, `menuCategoryOf`, F-1293). Always a vocabulary token,
 * or null when none is known: heading text never comes out of here, so it
 * never reaches the library's `menu_category` (ADR 0333).
 */
export function effectiveDrinkCategory(
  line: CategoryInput,
  sections: ReadonlyMap<string, SectionCategory> = new Map(),
): MenuCategory | null {
  if (isMenuCategory(line.drink_category)) return line.drink_category;
  for (const s of ancestors(line.section_id, sections)) {
    if (isMenuCategory(s.drink_category)) return s.drink_category;
  }
  const named = menuCategoryOf(
    typeof line.category === "string" ? line.category : undefined,
  );
  return isMenuCategory(named) ? named : null;
}

/**
 * The category a person confirmed for this line (ADR 0340 rule 8, ADR 0333
 * item 3): the line's own `drink_category` (a per-line override, set only by
 * a person), else the nearest section's `drink_category` when that section
 * was confirmed (`confirmed_at`). A section's category that was back-filled
 * or inherited and never confirmed, and a token read out of `category`, are
 * not confirmations: null.
 */
export function confirmedDrinkCategory(
  line: CategoryInput,
  sections: ReadonlyMap<string, SectionCategory> = new Map(),
): MenuCategory | null {
  if (isMenuCategory(line.drink_category)) return line.drink_category;
  for (const s of ancestors(line.section_id, sections)) {
    if (isMenuCategory(s.drink_category))
      return s.confirmed_at ? s.drink_category : null;
  }
  return null;
}

/**
 * The house item's `kind` (restaurant_inventory_kind_check) a vocabulary
 * token files under: every wine style is 'wine'.
 */
export function houseKindOf(token: MenuCategory): string {
  switch (token) {
    case "beer":
    case "cider":
    case "sake":
    case "cocktail":
    case "spirit":
    case "whiskey":
      return token;
    case "soft drink":
      return "soft_drink";
    case "non-alcoholic":
      return "non_alcoholic";
    default:
      return "wine";
  }
}

const SECTION_READ_ROWS = 1000;

/**
 * One menu's sections as the drink category reads them, keyset-paged. A
 * failed page is said, never an empty map (ADR 0067).
 */
export async function readMenuSectionCategories(
  client: SupabaseClient,
  restaurantId: string,
  menuId: string,
): Promise<{
  sections: Map<string, SectionCategory>;
  error: string | null;
}> {
  const sections = new Map<string, SectionCategory>();
  let after: string | null = null;
  for (;;) {
    let q = client
      .from("menu_sections")
      .select("id, parent_id, drink_category, confirmed_at")
      .eq("restaurant_id", restaurantId)
      .eq("menu_id", menuId);
    if (after) q = q.gt("id", after);
    const { data, error } = await q
      .order("id", { ascending: true })
      .limit(SECTION_READ_ROWS);
    if (error) return { sections: new Map(), error: error.message };
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    for (const r of rows) {
      sections.set(String(r.id), {
        parent_id: typeof r.parent_id === "string" ? r.parent_id : null,
        drink_category:
          typeof r.drink_category === "string" ? r.drink_category : null,
        confirmed_at:
          typeof r.confirmed_at === "string" ? r.confirmed_at : null,
      });
    }
    if (rows.length < SECTION_READ_ROWS) break;
    after = String(rows[rows.length - 1].id);
  }
  return { sections, error: null };
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
 * has, `kitchen_line` for everyone (not a drink by `lineIsDrink`, on the
 * kind of the menu the line is on; `null` when the reader does not know it),
 * and the raw line only when `view.rawLine`.
 * When a stored raw line (a non-empty string) is held back, the line says
 * `raw_line_withheld: true`; a line with no stored raw line says nothing,
 * because there is nothing to withhold. A withheld raw line is a missing key,
 * never a null: null already means "no raw line kept".
 */
export function lineForViewer(
  row: Record<string, unknown>,
  view: LineView,
  menuKind: string | null = null,
): Record<string, unknown> {
  const raw = row[RAW_LINE_COLUMN];
  const out: Record<string, unknown> = {};
  for (const key of MEMBER_LINE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(row, key)) out[key] = row[key];
  }
  out.kitchen_line = !lineIsDrink(
    { line_kind: row.line_kind, category: row.category, raw },
    menuKind,
  );
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
 * read, keyset-paged, and each line is judged by `lineIsDrink` on its own
 * menu's kind (ADR 0340 rule 8); the raw line is read only for that test and
 * leaves this function as nothing but the row ids. A failed page is said,
 * never an empty set.
 */
export async function readKitchenInventoryIds(
  client: SupabaseClient,
  restaurantId: string,
): Promise<{ ids: Set<string>; error: string | null }> {
  const kinds = new Map<string, string | null>();
  let menuAfter: string | null = null;
  for (;;) {
    let mq = client
      .from("restaurant_menus")
      .select("id, menu_type")
      .eq("restaurant_id", restaurantId);
    if (menuAfter) mq = mq.gt("id", menuAfter);
    const { data, error } = await mq
      .order("id", { ascending: true })
      .limit(KITCHEN_READ_ROWS);
    if (error) return { ids: new Set(), error: error.message };
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    for (const r of rows)
      kinds.set(
        String(r.id),
        typeof r.menu_type === "string" ? r.menu_type : null,
      );
    if (rows.length < KITCHEN_READ_ROWS) break;
    menuAfter = String(rows[rows.length - 1].id);
  }
  const kitchen = new Set<string>();
  const drink = new Set<string>();
  let after: string | null = null;
  for (;;) {
    let q = client
      .from("menu_items")
      .select(
        "id, menu_id, inventory_item_id, category, line_kind, raw_extracted_text",
      )
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
      const isDrink = lineIsDrink(
        {
          line_kind: r.line_kind,
          category: r.category,
          raw: r[RAW_LINE_COLUMN],
        },
        kinds.get(String(r.menu_id)) ?? null,
      );
      (isDrink ? drink : kitchen).add(inv);
    }
    if (rows.length < KITCHEN_READ_ROWS) break;
    after = String(rows[rows.length - 1].id);
  }
  for (const inv of drink) kitchen.delete(inv);
  return { ids: kitchen, error: null };
}

/**
 * A menu kind as the heading classifier reads it (ADR 0340 rule 15): the
 * three kinds a menu can be, or `unknown` when the rules cannot tell. The
 * stored `menu_type` for "drinks" is `beverage` (`menuTypeOfKind`).
 */
export type MenuKindGuess = "drinks" | "food" | "desserts" | "unknown";

export const MENU_KIND_GUESSES: readonly MenuKindGuess[] = [
  "drinks",
  "food",
  "desserts",
  "unknown",
];

/*
 * The heading word lists (ADR 0340 rule 15, lane 5a), in English, Turkish,
 * French, Italian, Spanish and German. They are NOT the legacy kitchen lists
 * above: `isKitchenLine` keeps today's words exactly (rule 7, and the CLAIMS
 * rows and the refile migration that pin them), and these lists decide only
 * new reads. Words are matched whole after folding (lower-cased, accents
 * dropped, Turkish ı as i, ß as ss), so "Entrées" and "entrees", "İçecekler"
 * and "ICECEKLER" are one word. A phrase matches as consecutive whole words.
 * kind-of.golden.spec.ts holds every list to its headings.
 */

/** Words that name wine: they win over a food or dessert word in the same part ("Dessert wines", "Balık Şarapları", "Vini dolci"). */
const KIND_WINE_WORDS = [
  "wine",
  "wines",
  "champagne",
  "champagnes",
  "prosecco",
  "cava",
  "cavas",
  "port",
  "ports",
  "sherry",
  "sherries",
  "madeira",
  "bubbles",
  "sparkling",
  "vin",
  "vins",
  "crémant",
  "bulles",
  "vino",
  "vini",
  "bollicine",
  "spumante",
  "spumanti",
  "vinos",
  "espumosos",
  "espumoso",
  "wein",
  "weine",
  "weinkarte",
  "sekt",
];

/** A heading that names a serving format of wine (§F17): a drink heading. */
const KIND_FORMAT_PHRASES = [
  "by the glass",
  "by the bottle",
  "half bottles",
  "au verre",
  "à la bouteille",
  "en bouteille",
  "al calice",
  "alla bottiglia",
  "in bottiglia",
  "por copa",
  "a copa",
  "por botella",
  "offene weine",
  "im glas",
  "vom fass",
  "kadehle",
  "kadeh",
  "şişe",
];

/** Other drink words: a drink heading, unless the same part also names food or a dessert. */
const KIND_DRINK_WORDS = [
  // English
  "drinks",
  "drink",
  "beverages",
  "beverage",
  "soft drinks",
  "sodas",
  "soda",
  "juices",
  "juice",
  "smoothies",
  "milkshakes",
  "coffee",
  "coffees",
  "espresso",
  "tea",
  "teas",
  "hot drinks",
  "cold drinks",
  "water",
  "waters",
  "beer",
  "beers",
  "draft",
  "draught",
  "ales",
  "ale",
  "lagers",
  "cider",
  "ciders",
  "sake",
  "cocktails",
  "cocktail",
  "mocktails",
  "spirits",
  "whisky",
  "whiskey",
  "whiskies",
  "bourbon",
  "scotch",
  "gin",
  "gins",
  "vodka",
  "rum",
  "rums",
  "tequila",
  "mezcal",
  "cognac",
  "brandy",
  "armagnac",
  "liqueurs",
  "liqueur",
  "aperitifs",
  "aperitif",
  "digestifs",
  "digestif",
  "non-alcoholic",
  "non alcoholic",
  "zero proof",
  "after dinner",
  "longdrinks",
  "shots",
  // Turkish
  "içecekler",
  "içecek",
  "meşrubat",
  "meşrubatlar",
  "rakı",
  "rakılar",
  "bira",
  "biralar",
  "fıçı bira",
  "viski",
  "viskiler",
  "kokteyl",
  "kokteyller",
  "alkolsüz",
  "alkolsüz içecekler",
  "kahve",
  "kahveler",
  "türk kahvesi",
  "çay",
  "çaylar",
  "sular",
  "maden suyu",
  "meyve suları",
  "likör",
  "likörler",
  "votka",
  "cin",
  "konyak",
  "tekila",
  "köpüklü",
  // French
  "boissons",
  "boisson",
  "boissons chaudes",
  "boissons fraîches",
  "bières",
  "bière",
  "cidres",
  "cidre",
  "apéritifs",
  "apéritif",
  "spiritueux",
  "cafés",
  "café",
  "thés",
  "infusions",
  "eaux",
  "eaux minérales",
  "jus",
  "softs",
  "sans alcool",
  // Italian
  "birre",
  "birra",
  "bevande",
  "bibite",
  "analcolici",
  "acque",
  "acqua",
  "caffetteria",
  "caffè",
  "tè",
  "tisane",
  "liquori",
  "amari",
  "amaro",
  "grappe",
  "grappa",
  "distillati",
  "aperitivi",
  // Spanish
  "cerveza",
  "cervezas",
  "sidra",
  "sidras",
  "bebidas",
  "refrescos",
  "zumos",
  "jugos",
  "licores",
  "cócteles",
  "cocteles",
  "sin alcohol",
  "aguas",
  "destilados",
  "vermut",
  "vermouth",
  // German
  "bier",
  "biere",
  "getränke",
  "heißgetränke",
  "spirituosen",
  "schnäpse",
  "schnaps",
  "liköre",
  "kaffee",
  "tee",
  "alkoholfrei",
  "alkoholfreie",
  "säfte",
  "wasser",
  "glas",
  "flasche",
];

/** Colour words: a drink heading alone ("Reds", "Kırmızı"), but any food or dessert word beats them ("Kırmızı Et", "Red Velvet Cake"). */
const KIND_COLOUR_WORDS = [
  "red",
  "reds",
  "white",
  "whites",
  "rosé",
  "rosés",
  "rose",
  "roses",
  "orange",
  "kırmızı",
  "beyaz",
  "roze",
  "pembe",
  "rouge",
  "rouges",
  "blanc",
  "blancs",
  "rosso",
  "rossi",
  "bianco",
  "bianchi",
  "rosato",
  "rosati",
  "tinto",
  "tintos",
  "blanco",
  "blancos",
  "rosado",
  "rosados",
  "rot",
  "rote",
  "rotweine",
  "weiß",
  "weisse",
  "weiße",
];

/** Dessert words: a Desserts heading. */
const KIND_DESSERT_WORDS = [
  "desserts",
  "sweets",
  "puddings",
  "pudding",
  "cakes",
  "cake",
  "pastries",
  "ice cream",
  "ice creams",
  "gelato",
  "sorbets",
  "sorbet",
  "tatlılar",
  "pastalar",
  "dondurma",
  "dondurmalar",
  "baklava",
  "douceurs",
  "pâtisseries",
  "glaces",
  "dolci",
  "gelati",
  "torte",
  "postres",
  "helados",
  "dulces",
  "nachspeisen",
  "nachtisch",
  "süßspeisen",
  "kuchen",
  "eis",
  "eisbecher",
];

/** Food words: a Food heading. */
const KIND_FOOD_WORDS = [
  // English
  "food",
  "kitchen",
  "starters",
  "starter",
  "appetizers",
  "appetizer",
  "appetisers",
  "small plates",
  "plates",
  "sharing",
  "to share",
  "mains",
  "main",
  "main courses",
  "main course",
  "entrees",
  "entree",
  "entrées",
  "entrée",
  "sides",
  "side dishes",
  "dishes",
  "salads",
  "salad",
  "soups",
  "soup",
  "pasta",
  "pizza",
  "pizzas",
  "burgers",
  "sandwiches",
  "wraps",
  "breakfast",
  "brunch",
  "lunch",
  "dinner",
  "grill",
  "seafood",
  "fish",
  "meat",
  "steaks",
  "steak",
  "chicken",
  "vegetarian",
  "vegan",
  "kids",
  "snacks",
  "tapas",
  "mezze",
  "meze",
  "platters",
  "boards",
  "charcuterie",
  "oysters",
  "sushi",
  "noodles",
  "rice",
  "curries",
  "tacos",
  "bowls",
  "chips",
  "fries",
  "raw bar",
  "cheese",
  "cheeses",
  // Turkish
  "yemek",
  "yemekler",
  "yemekleri",
  "başlangıçlar",
  "başlangıç",
  "mezeler",
  "ara sıcak",
  "ara sıcaklar",
  "ana yemek",
  "ana yemekler",
  "salata",
  "salatalar",
  "çorba",
  "çorbalar",
  "mezeleri",
  "ızgara",
  "ızgaralar",
  "kebap",
  "kebaplar",
  "pide",
  "pideler",
  "lahmacun",
  "kahvaltı",
  "makarna",
  "sandviçler",
  "makarnalar",
  "pizzalar",
  "burgerler",
  "tost",
  "tostlar",
  "sandviç",
  "dürüm",
  "dürümler",
  "balık",
  "balıklar",
  "deniz ürünleri",
  "etler",
  "tavuk",
  "köfte",
  "zeytinyağlılar",
  "mantı",
  "börek",
  "börekler",
  "aperatifler",
  "atıştırmalıklar",
  "peynirler",
  "peynir",
  "mutfak",
  // French
  "entrées",
  "plats",
  "plat",
  "plats principaux",
  "hors d'oeuvre",
  "hors d oeuvre",
  "poissons",
  "poisson",
  "viandes",
  "viande",
  "salades",
  "soupes",
  "potages",
  "garnitures",
  "accompagnements",
  "à partager",
  "fromages",
  "fromage",
  "enfants",
  "enfant",
  "tartines",
  // Italian
  "antipasti",
  "antipasto",
  "primi",
  "primi piatti",
  "secondi",
  "secondi piatti",
  "contorni",
  "insalate",
  "zuppe",
  "pizze",
  "piatti",
  "risotti",
  "pesce",
  "carne",
  "formaggi",
  "taglieri",
  // Spanish
  "entrantes",
  "raciones",
  "primeros",
  "segundos",
  "platos principales",
  "principales",
  "platos",
  "ensaladas",
  "sopas",
  "carnes",
  "pescados",
  "mariscos",
  "arroces",
  "arroz",
  "pescado",
  "paellas",
  "quesos",
  "montaditos",
  "bocadillos",
  "guarniciones",
  "huevos",
  // German
  "vorspeisen",
  "hauptspeisen",
  "hauptgerichte",
  "beilagen",
  "salate",
  "suppen",
  "fleisch",
  "fisch",
  "vom grill",
  "käse",
  "speisen",
  "kleine gerichte",
  "brotzeit",
  "flammkuchen",
  "schnitzel",
  "vegetarisch",
  "kinderkarte",
];

/** Cheese courses (§F16): Food, but always Unsure. */
const KIND_CHEESE_WORDS = [
  "cheese",
  "cheeses",
  "peynirler",
  "peynir",
  "fromages",
  "fromage",
  "formaggi",
  "quesos",
  "käse",
];

/**
 * Headings decided only as the whole part, never as a word inside one:
 * Turkish "Et" is meat but French "et" is "and"; "Tatlı" alone is the
 * dessert section but "Tatlı Beyaz" is a sweet white; "Su" and "Bar" alone.
 * "Dessert" (singular) is `ambiguous` (§F14): in US menus often a food
 * heading, in a wine list a dessert-wine one; the line's shape decides, and
 * the heading is a blind spot (always Unsure).
 */
const KIND_WHOLE_HEADINGS: ReadonlyArray<
  [string, MenuKindGuess | "ambiguous"]
> = [
  ["et", "food"],
  ["kırmızı et", "food"],
  ["beyaz et", "food"],
  ["tatlı", "desserts"],
  ["su", "drinks"],
  ["bar", "drinks"],
  // French "thé" folds to "the": only the whole heading is tea.
  ["thé", "drinks"],
  ["dessert", "ambiguous"],
];

/** Words that join two headings in one part ("Rouges et Rosés", "Primi e Secondi"). */
const KIND_JOINERS = [
  "and",
  "ve",
  "et",
  "e",
  "y",
  "und",
  "or",
  "ou",
  "o",
  "oder",
];

/** One word or phrase as the classifier compares it: lower-cased, no accents, ı as i, ß as ss. */
function foldWord(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/ı/g, "i");
}

/** A text's folded words, in order. */
function foldedTokens(text: string): string[] {
  return foldWord(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

const foldList = (words: readonly string[]) =>
  words.map((w) => foldedTokens(w).join(" ")).filter(Boolean);

const F_WINE = foldList(KIND_WINE_WORDS);
const F_FORMAT = foldList(KIND_FORMAT_PHRASES);
const F_DRINK = foldList(KIND_DRINK_WORDS);
const F_COLOUR = foldList(KIND_COLOUR_WORDS);
const F_DESSERT = foldList(KIND_DESSERT_WORDS);
const F_FOOD = foldList(KIND_FOOD_WORDS);
const F_CHEESE = foldList(KIND_CHEESE_WORDS);
const F_WHOLE = new Map(
  KIND_WHOLE_HEADINGS.map(([w, k]) => [foldedTokens(w).join(" "), k]),
);
const F_JOINERS = new Set(KIND_JOINERS);

/**
 * A heading split where it joins two headings: at "&", "/", "+", ",", "|"
 * and at a joining word with words on both sides. "Kırmızı Et" stays one
 * part (nothing follows "et"), "Rouges et Rosés" is two.
 */
function headingParts(heading: string): string[][] {
  const parts: string[][] = [];
  for (const chunk of heading.split(/[&+/|,;·•]+/)) {
    const toks = foldedTokens(chunk);
    let cur: string[] = [];
    toks.forEach((t, i) => {
      if (F_JOINERS.has(t) && cur.length > 0 && i < toks.length - 1) {
        parts.push(cur);
        cur = [];
      } else cur.push(t);
    });
    if (cur.length > 0) parts.push(cur);
  }
  return parts;
}

/** German compounds: "Rotweine", "Dessertweine", "Fassbier", "Heißgetränke". "Schweine" is pork. */
function germanCompoundKind(tok: string): "wine" | "drinks" | "food" | null {
  if (tok.startsWith("schwein")) return null;
  if (/.{2,}weine?$/.test(tok)) return "wine";
  if (/.{2,}(getranke|biere?)$/.test(tok)) return "drinks";
  if (/.{2,}(speisen|gerichte)$/.test(tok)) return "food";
  return null;
}

/** What one part of a heading names, before any line is read. */
function partKind(toks: string[]): MenuKindGuess | "ambiguous" {
  if (toks.length === 0) return "unknown";
  const whole = F_WHOLE.get(toks.join(" "));
  if (whole) return whole;
  const run = ` ${toks.join(" ")} `;
  const has = (list: string[]) => list.some((w) => run.includes(` ${w} `));
  const compounds = toks.map(germanCompoundKind);
  // Turkish "şarap", "şarapları", "şarabı" in every form.
  const wine =
    has(F_WINE) ||
    has(F_FORMAT) ||
    compounds.includes("wine") ||
    toks.some((t) => t.startsWith("sarap") || t.startsWith("sarab"));
  if (wine) return "drinks";
  const drink = has(F_DRINK) || compounds.includes("drinks");
  // A drink phrase's own words vote once: "After dinner drinks" names no
  // dinner. Every multi-word drink phrase found is blanked before the food
  // and dessert words are read.
  const rest = F_DRINK.filter((w) => w.includes(" ")).reduce(
    (r, w) => r.split(` ${w} `).join(" _ "),
    run,
  );
  const hasRest = (list: string[]) => list.some((w) => rest.includes(` ${w} `));
  // Dessert words are checked before the German "-speisen" food compound,
  // so "Nachspeisen" and "Süßspeisen" stay desserts.
  const sweet = hasRest(F_DESSERT);
  const food = hasRest(F_FOOD) || (!sweet && compounds.includes("food"));
  if (drink && (food || sweet)) return "unknown";
  if (drink) return "drinks";
  if (food && sweet) return "unknown";
  if (sweet) return "desserts";
  if (food) return "food";
  if (has(F_COLOUR)) return "drinks";
  // "Dessert" (singular) with nothing that decides: §F14.
  if (run.includes(" dessert ")) return "ambiguous";
  return "unknown";
}

/** What one heading names: its parts must agree; a part that names nothing does not vote. */
function oneHeadingKind(heading: string): MenuKindGuess | "ambiguous" {
  const kinds = headingParts(heading).map(partKind);
  const known = kinds.filter(
    (k): k is Exclude<MenuKindGuess, "unknown"> =>
      k !== "unknown" && k !== "ambiguous",
  );
  if (known.length === 0)
    return kinds.includes("ambiguous") ? "ambiguous" : "unknown";
  return known.every((k) => k === known[0]) ? known[0] : "unknown";
}

/** Whether a heading is a known blind spot of the rules (§F14 "Dessert", §F16 cheese). */
function headingIsBlindSpot(heading: string): boolean {
  return headingParts(heading).some((toks) => {
    const run = ` ${toks.join(" ")} `;
    return (
      partKind(toks) === "ambiguous" ||
      F_CHEESE.some((w) => run.includes(` ${w} `))
    );
  });
}

/** What the classifier reads of a line: only its shape, never its words. */
export interface KindLineInput {
  by_glass_price?: unknown;
  bottle_price?: unknown;
  price?: unknown;
  drink_category?: unknown;
  category?: unknown;
}

const isAmount = (v: unknown) =>
  (typeof v === "number" && Number.isFinite(v)) ||
  (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)));

/**
 * A line's shape: `drink` when it has a glass or bottle price or a drink
 * category of its own, `dish` when it has a dish price and neither, else
 * null (nothing to tell).
 */
export function lineShapeOf(
  line: KindLineInput | null | undefined,
): "drink" | "dish" | null {
  if (!line) return null;
  if (
    isAmount(line.by_glass_price) ||
    isAmount(line.bottle_price) ||
    isMenuCategory(line.drink_category)
  )
    return "drink";
  if (isAmount(line.price)) return "dish";
  return null;
}

/** A heading, or a section's heading path from the top ("Wines", "Red", "Turkey"). */
export type HeadingInput = string | readonly string[] | null | undefined;

/** How `kindOf` decided, for the verdict. */
export interface HeadingKindDetail {
  kind: MenuKindGuess;
  /** "heading": the section's own heading; "parent": a heading above it; "shape": the line (§F14); "none": nothing decided. */
  by: "heading" | "parent" | "shape" | "none";
  /** The deciding heading, or the ambiguous one, is a blind spot of the rules. */
  blindSpot: boolean;
}

/**
 * Section-level resolution (ADR 0340 rule 15, lane 5a): the nearest heading
 * that decides wins, from the section itself up to the top ("Specials" under
 * "Food" is food; "Dessert" under "Wines" is a drink). A path where only an
 * ambiguous heading ("Dessert") speaks is decided by the line's shape, and
 * otherwise is `unknown`. Nothing decided is `unknown`, never a drink.
 */
export function classifyHeading(
  heading: HeadingInput,
  line?: KindLineInput | null,
): HeadingKindDetail {
  const path = (
    typeof heading === "string" ? [heading] : (heading ?? [])
  ).filter((h): h is string => typeof h === "string" && h.trim() !== "");
  let ambiguous: string | null = null;
  for (let i = path.length - 1; i >= 0; i--) {
    const k = oneHeadingKind(path[i]);
    if (k === "ambiguous") {
      ambiguous ??= path[i];
      continue;
    }
    if (k !== "unknown")
      return {
        kind: k,
        by: i === path.length - 1 ? "heading" : "parent",
        blindSpot: headingIsBlindSpot(path[i]),
      };
  }
  if (ambiguous !== null) {
    const shape = lineShapeOf(line);
    if (shape === "drink")
      return { kind: "drinks", by: "shape", blindSpot: true };
    if (shape === "dish")
      return { kind: "desserts", by: "shape", blindSpot: true };
    return { kind: "unknown", by: "none", blindSpot: true };
  }
  return { kind: "unknown", by: "none", blindSpot: false };
}

/**
 * The menu kind a heading (or heading path) names, for NEW reads (ADR 0340
 * rule 15). The default is `unknown`: a heading no rule knows is never a
 * drink. Legacy lines keep `lineIsDrink`'s rule (rule 7); this does not
 * replace `isKitchenLine`.
 */
export function kindOf(
  heading: HeadingInput,
  line?: KindLineInput | null,
): MenuKindGuess {
  return classifyHeading(heading, line).kind;
}

/** The stored `menu_type` of a kind; null for `unknown`. */
export function menuTypeOfKind(kind: MenuKindGuess): string | null {
  if (kind === "drinks") return "beverage";
  if (kind === "unknown") return null;
  return kind;
}

/** The stored `line_kind` of a kind (rule 7); null for `unknown`. */
export function lineKindOfKind(kind: MenuKindGuess): "drink" | "dish" | null {
  if (kind === "drinks") return "drink";
  if (kind === "unknown") return null;
  return "dish";
}

/** Why a line or section is Unsure (ADR 0340 rule 15). */
export type UnsureReason =
  | "rules_unknown"
  | "model_disagrees"
  | "kind_differs_from_section"
  | "no_drink_category"
  | "shape_contradicts_heading"
  | "blind_spot";

export interface KindVerdictInput {
  heading: HeadingInput;
  /** The line, for a line's verdict; absent for a section's. */
  line?: KindLineInput | null;
  /**
   * The model's kind (the read's suggestion or the §F12 second opinion).
   * Null or absent: no model opinion (rules only); it adds no reason.
   */
  modelKind?: string | null;
  /** For a line: its section's decided kind. */
  sectionKind?: MenuKindGuess | null;
  /** For a line: its section's (or an ancestor's) drink category. */
  sectionDrinkCategory?: string | null;
}

export interface KindVerdict {
  kind: MenuKindGuess;
  unsure: boolean;
  reasons: UnsureReason[];
}

/**
 * Whether a line or section is Unsure, and why (ADR 0340 rule 15): the rules
 * cannot tell; the model says otherwise; a line's kind is not its section's;
 * a drink line has no vocabulary category; the line's shape contradicts the
 * heading (a dish under "Dessert wines", a wine under "Desserts" with no
 * drink category); or the heading is a known blind spot. A confidence is no
 * input: it never clears Unsure.
 */
export function kindVerdict(input: KindVerdictInput): KindVerdict {
  const detail = classifyHeading(input.heading, input.line);
  const kind = detail.kind;
  const reasons: UnsureReason[] = [];
  if (kind === "unknown") reasons.push("rules_unknown");
  if (
    input.modelKind !== null &&
    input.modelKind !== undefined &&
    input.modelKind !== kind
  )
    reasons.push("model_disagrees");
  if (input.sectionKind && input.sectionKind !== kind)
    reasons.push("kind_differs_from_section");
  if (input.line) {
    const shape = lineShapeOf(input.line);
    const token =
      isMenuCategory(input.line.drink_category) ||
      isMenuCategory(input.sectionDrinkCategory) ||
      isMenuCategory(
        menuCategoryOf(
          typeof input.line.category === "string"
            ? input.line.category
            : undefined,
        ),
      );
    if (kind === "drinks" && !token) reasons.push("no_drink_category");
    if (
      (kind === "drinks" && shape === "dish") ||
      ((kind === "food" || kind === "desserts") && shape === "drink" && !token)
    )
      reasons.push("shape_contradicts_heading");
  }
  if (detail.blindSpot) reasons.push("blind_spot");
  return { kind, unsure: reasons.length > 0, reasons };
}
