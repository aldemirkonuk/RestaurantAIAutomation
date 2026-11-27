/**
 * The vocabulary `category` may hold, and the reason it is a closed list.
 *
 * `category` is not display copy: `menus.service.ts` persists it to
 * `menu_items.category` AND hands it to the library writer, which stores it as
 * `master_wine_library.data_enrichment.menu_category` — the second input to
 * `wine_classify_beverage_kind()`
 * (20260817060000_beverage_kind_classification.sql:85-101), which is what
 * decides `beverage_kind` and therefore which cellar register the line lands
 * in. Every member below is a word that classifier's own regexes recognise,
 * except `soft drink`, which it has no value for on purpose — see
 * `NAME_ONLY_REGISTERS` in cellar/cellar-registers.ts.
 *
 * Kept singular and lowercase because the classifier matches WHOLE WORDS:
 * `\m(...|red|...)\M` does not match "reds", so a section header copied
 * verbatim ("Reds by the Glass") would classify as `unknown` while "red"
 * classifies as wine. The prompt asks for the vocabulary member, not the
 * printed heading, for exactly that reason.
 */
export const MENU_CATEGORY_VOCABULARY = [
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
] as const;

export type MenuCategory = (typeof MENU_CATEGORY_VOCABULARY)[number];

export interface WineExtractItem {
  name: string;
  producer?: string; // e.g. 'Chateau Margaux', 'Duckhorn' — required for reliable library matching
  /** One of MENU_CATEGORY_VOCABULARY. Drives beverage_kind — see above. */
  category?: string;
  vintage?: string; // e.g. '2019', '2020'
  region?: string; // e.g. 'Burgundy', 'Napa Valley'
  grape_variety?: string; // e.g. 'Pinot Noir', 'Chardonnay'
  by_glass_price?: number;
  bottle_price?: number;
  raw_text?: string; // original text line from scan/csv
}

/**
 * Why a scan read may hold fewer lines than the file (ADR 0213 #17).
 * `truncated`: the reply was cut off and could not be split further;
 * `chunk_failed`: a page range errored;
 * `page_cap`: pages past the 120-page cap were not sent (`pages` = the dropped range);
 * `unreadable_reply`: the model answered with something that is not a list of lines.
 * `pages` (1-based) is null when no narrower range is known. Stored on
 * `restaurant_menus.read_warnings`.
 */
export interface MenuReadWarning {
  kind: "truncated" | "chunk_failed" | "page_cap" | "unreadable_reply";
  pages: { first: number; last: number } | null;
}
