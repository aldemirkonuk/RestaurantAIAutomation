import { normalizeSignatureText } from "../wines/wine-signature";

/**
 * A MENU LINE FINDS THE HOUSE'S OWN GOOD FIRST (r21 walk, D1, 2026-11-13).
 *
 * A line added by hand or imported used to go straight to the shared wine
 * library. When the house already carried the good, that made a second copy:
 * "Local Check Cabernet 2020" typed on /menu made a new library row and a
 * second inventory row beside the seeded one, and the CSV line "House London
 * Dry Gin, Spirits" made a kind=wine twin of the house's own gin, whose row
 * names no library wine at all. The house's goods are read first now; a line
 * that names exactly one of them is linked to it.
 *
 * What counts as the same good:
 *  - the name, folded the way the library folds it (case, accents,
 *    punctuation, spacing), compared with the good's display name and its wine
 *    name. A year or a size at the end of a name is read off it, so
 *    "Local Check Cabernet 2020" is "Local Check Cabernet" of 2020;
 *  - the kind, where the line's category says one: a gin line never takes a
 *    wine, and no drink line takes a food or a supply. A good kept as "other"
 *    (how a receipt adds an untyped drink) fits any drink line;
 *  - the vintage, the producer and the size, where both sides state one.
 *    Unknown on either side is not a difference. The producer matters most:
 *    a library wine's name rarely carries it, so "Cabernet Sauvignon" by
 *    Caymus must not take the house's Cabernet Sauvignon by Duckhorn. A line
 *    that splits the producer off ("Caymus" + "Cabernet Sauvignon") also
 *    finds a good named "Caymus Cabernet Sauvignon".
 *
 * Two or more goods that fit are not guessed between: the line goes the old
 * way, and the caller is told which goods were candidates.
 */

export interface HouseGood {
  id: string;
  display_name: string | null;
  wine_name: string | null;
  kind: string | null;
  master_wine_id: string | null;
  bottle_size_ml: number | null;
  /** The library wine's vintage and producer, when the good names one. */
  vintage?: string | number | null;
  producer?: string | null;
}

export type HouseMatch =
  | { outcome: "none" }
  | { outcome: "one"; good: HouseGood }
  | { outcome: "many"; goods: HouseGood[] };

export interface MatchableLine {
  name: string;
  producer?: string | null;
  category?: string | null;
  vintage?: string | number | null;
}

const PAGE_ROWS = 1000;
const ID_CHUNK = 150;

const SIZE_TAIL = /[\s,(]*(\d+(?:[.,]\d+)?)\s*(ml|cl|lt|l|litre|liter)\.?\)?\s*$/i;
const YEAR_TAIL = /[\s,(]*\b((?:19|20)\d{2})\)?\s*$/;

function toMl(amount: string, unit: string): number | null {
  const n = Number(amount.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = unit.toLowerCase();
  const ml = u === "ml" ? n : u === "cl" ? n * 10 : n * 1000;
  return Math.round(ml);
}

/** A stated vintage in one spelling: a year, "NV", or null when none is stated. */
export function statedVintage(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (/^(19|20)\d{2}$/.test(s)) return s;
  if (/^nv$/i.test(s)) return "NV";
  return null;
}

/** A name folded for comparison, with a year and a size at its end read off. */
export function nameParts(raw: string | null | undefined): { key: string; vintage: string | null; sizeMl: number | null } {
  let s = (raw ?? "").trim();
  let vintage: string | null = null;
  let sizeMl: number | null = null;
  // "X 2019 75cl" and "X 75cl 2019" both happen: up to one of each, either order.
  for (let pass = 0; pass < 2; pass++) {
    const size = sizeMl === null ? SIZE_TAIL.exec(s) : null;
    if (size) {
      sizeMl = toMl(size[1], size[2]);
      s = s.slice(0, size.index);
      continue;
    }
    const year = vintage === null ? YEAR_TAIL.exec(s) : null;
    if (year) {
      vintage = year[1];
      s = s.slice(0, year.index);
      continue;
    }
    break;
  }
  return { key: normalizeSignatureText(s), vintage, sizeMl };
}

type Family = "wine" | "beer" | "cider" | "sake" | "cocktail" | "spirit" | "soft";

// Checked in this order, so "non-alcoholic beer" is a soft drink and
// "dessert wine" is a wine.
const FAMILY_WORDS: Array<[Family, string[]]> = [
  ["soft", ["non alcoholic", "alcohol free", "soft drink", "soft drinks", "soft", "juice", "juices", "soda", "sodas", "water"]],
  ["cocktail", ["cocktail", "cocktails"]],
  ["beer", ["beer", "beers", "lager", "ale", "ales"]],
  ["cider", ["cider", "ciders"]],
  ["sake", ["sake"]],
  [
    "spirit",
    ["spirit", "spirits", "whiskey", "whisky", "whiskies", "liqueur", "liqueurs", "gin", "vodka", "rum", "tequila", "mezcal", "brandy", "cognac", "raki", "rak"],
  ],
  [
    "wine",
    ["wine", "wines", "red", "reds", "white", "whites", "rose", "roses", "sparkling", "champagne", "orange", "dessert", "fortified", "port", "sherry"],
  ],
];

/** What a menu line's category says it is, or null when it says nothing known. */
export function lineFamily(category: string | null | undefined): Family | null {
  const words = ` ${normalizeSignatureText(category)} `;
  if (words.trim() === "") return null;
  for (const [family, list] of FAMILY_WORDS) {
    if (list.some((w) => words.includes(` ${w} `))) return family;
  }
  return null;
}

// restaurant_inventory_kind_check. `other` fits every drink; food and supply none.
const KIND_FAMILY: Record<string, Family | "any" | "never"> = {
  wine: "wine",
  beer: "beer",
  cider: "cider",
  sake: "sake",
  cocktail: "cocktail",
  spirit: "spirit",
  whiskey: "spirit",
  liqueur: "spirit",
  non_alcoholic: "soft",
  soft_drink: "soft",
  other: "any",
  food: "never",
  supply: "never",
};

export function kindFits(family: Family | null, kind: string | null | undefined): boolean {
  const k = KIND_FAMILY[String(kind ?? "")] ?? "any";
  if (k === "never") return false;
  if (family === null || k === "any") return true;
  return k === family;
}

function nameFits(line: MatchableLine, good: HouseGood, withLibrary: boolean): boolean {
  if (withLibrary) {
    const a = normalizeSignatureText(line.producer);
    const b = normalizeSignatureText(good.producer);
    if (a && b && a !== b) return false;
  }
  const forms = [line.name, line.producer ? `${line.producer} ${line.name}` : null];
  return forms.some((form) => form !== null && formFits(form, line, good, withLibrary));
}

function formFits(form: string, line: MatchableLine, good: HouseGood, withVintage: boolean): boolean {
  const lp = nameParts(form);
  if (!lp.key) return false;
  const lineVintage = statedVintage(line.vintage) ?? lp.vintage;
  return [good.display_name, good.wine_name].some((n) => {
    if (!n) return false;
    const gp = nameParts(n);
    if (gp.key !== lp.key) return false;
    if (withVintage) {
      const goodVintage = gp.vintage ?? statedVintage(good.vintage);
      if (lineVintage && goodVintage && lineVintage !== goodVintage) return false;
    }
    const goodSize = good.bottle_size_ml ?? gp.sizeMl;
    if (lp.sizeMl && goodSize && lp.sizeMl !== goodSize) return false;
    return true;
  });
}

/** The house's goods that fit one line. Pure: the goods are already read. */
export function matchLine(line: MatchableLine, goods: HouseGood[]): HouseMatch {
  const family = lineFamily(line.category);
  const hits = goods.filter((g) => kindFits(family, g.kind) && nameFits(line, g, true));
  if (hits.length === 0) return { outcome: "none" };
  if (hits.length === 1) return { outcome: "one", good: hits[0] };
  return { outcome: "many", goods: hits };
}

/** The noun a sentence uses for a good of this kind. */
export function kindNoun(kind: string | null | undefined): string {
  switch (kind) {
    case "wine":
    case "beer":
    case "cider":
    case "sake":
    case "cocktail":
    case "spirit":
    case "whiskey":
    case "liqueur":
      return kind;
    case "food":
    case "supply":
      return "good";
    default:
      return "drink";
  }
}

// The narrow slice of the Supabase builder this reads through.
type Client = { from: (table: string) => any };

/**
 * Every line's match against this house's live goods. `lines[i] === null`
 * (a kitchen line) is never matched and costs no read. Throws when a read
 * fails: a failed read is not "the house carries nothing".
 */
export async function matchHouseGoods(
  client: Client,
  restaurantId: string,
  lines: Array<MatchableLine | null>,
): Promise<HouseMatch[]> {
  const none: HouseMatch = { outcome: "none" };
  if (lines.every((l) => l === null)) return lines.map(() => none);

  // 1. The house's live goods, keyset-paged past the 1000-row cap.
  const goods: HouseGood[] = [];
  let after: string | null = null;
  for (;;) {
    let q = client
      .from("restaurant_inventory")
      .select("id, display_name, wine_name, kind, master_wine_id, bottle_size_ml")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .is("deleted_at", null);
    if (after) q = q.gt("id", after);
    const { data, error } = await q.order("id", { ascending: true }).limit(PAGE_ROWS);
    if (error) throw new Error(`the house's goods could not be read: ${error.message}`);
    const rows = (data ?? []) as HouseGood[];
    goods.push(...rows);
    if (rows.length < PAGE_ROWS) break;
    after = String(rows[rows.length - 1].id);
  }

  // 2. The library vintage and producer of each good some line names, so a
  //    2019 line does not take the house's 2020, nor Caymus the house's
  //    Duckhorn. Read only for the goods a name already fits.
  const named = new Set<HouseGood>();
  for (const line of lines) {
    if (!line) continue;
    const family = lineFamily(line.category);
    for (const g of goods) if (kindFits(family, g.kind) && nameFits(line, g, false)) named.add(g);
  }
  const wineIds = [...new Set([...named].map((g) => g.master_wine_id).filter((w): w is string => !!w))];
  const library = new Map<string, { vintage: string | number | null; producer: string | null }>();
  for (let at = 0; at < wineIds.length; at += ID_CHUNK) {
    const chunk = wineIds.slice(at, at + ID_CHUNK);
    const { data, error } = await client.from("master_wine_library").select("id, vintage, producer").in("id", chunk);
    if (error) throw new Error(`the vintages and producers of the house's wines could not be read: ${error.message}`);
    for (const r of (data ?? []) as Array<{ id: string; vintage: string | number | null; producer: string | null }>) {
      library.set(String(r.id), { vintage: r.vintage ?? null, producer: r.producer ?? null });
    }
  }
  const candidates = [...named].map((g) => {
    const lib = g.master_wine_id ? library.get(String(g.master_wine_id)) : undefined;
    return { ...g, vintage: lib?.vintage ?? null, producer: lib?.producer ?? null };
  });

  return lines.map((line) => (line ? matchLine(line, candidates) : none));
}
