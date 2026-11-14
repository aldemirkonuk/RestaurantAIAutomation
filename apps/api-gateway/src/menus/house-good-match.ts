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
  /**
   * What tells two goods of one name apart for a person choosing between them
   * (r37 walk w1 M-F1): the house's own prices and where the good came from.
   * Read with the goods; never used to match.
   */
  menu_price_current?: number | string | null;
  menu_price_glass?: number | string | null;
  identity_provenance?: string | null;
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

/**
 * Text folded for comparison here: the library's fold (`normalizeSignatureText`:
 * case, accents, punctuation, spacing), with the Turkish dotless ı read as i
 * first (r28 G6). The library fold has no decomposition for ı, so it dropped
 * the letter: "Yeni Rakı" folded to "yeni rak" while "Yeni RAKI" folded to
 * "yeni raki", and the same raki on two menus were two goods. The shared fold
 * is left alone: it keys stored signature hashes, and changing it would
 * re-key the library.
 */
export function foldName(value: string | null | undefined): string {
  return normalizeSignatureText(value ? value.replace(/ı/g, "i") : value);
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
  return { key: foldName(s), vintage, sizeMl };
}

type Family = "wine" | "beer" | "cider" | "sake" | "cocktail" | "spirit" | "soft";

// Checked in this order, so "non-alcoholic beer" is a soft drink and
// "dessert wine" is a wine. The words are folded (foldName), Turkish ones
// too: "Alkolsüz İçecekler" is "alkolsuz icecekler", "Şaraplar" is "saraplar".
const FAMILY_WORDS: Array<[Family, string[]]> = [
  ["soft", ["non alcoholic", "alcohol free", "soft drink", "soft drinks", "soft", "juice", "juices", "soda", "sodas", "water", "alkolsuz", "mesrubat", "mesrubatlar", "meyve suyu"]],
  ["cocktail", ["cocktail", "cocktails", "kokteyl", "kokteyller"]],
  ["beer", ["beer", "beers", "lager", "ale", "ales", "bira", "biralar"]],
  ["cider", ["cider", "ciders"]],
  ["sake", ["sake"]],
  [
    "spirit",
    ["spirit", "spirits", "whiskey", "whisky", "whiskies", "liqueur", "liqueurs", "gin", "vodka", "rum", "tequila", "mezcal", "brandy", "cognac", "raki", "rakilar", "viski", "viskiler", "likor", "likorler", "votka", "cin", "konyak"],
  ],
  [
    "wine",
    ["wine", "wines", "red", "reds", "white", "whites", "rose", "roses", "sparkling", "champagne", "orange", "dessert", "fortified", "port", "sherry", "sarap", "saraplar", "kirmizi", "beyaz", "roze", "kopuklu"],
  ],
];

/** What a menu line's category says it is, or null when it says nothing known. */
export function lineFamily(category: string | null | undefined): Family | null {
  const words = ` ${foldName(category)} `;
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

/** A good's names, each folded once (r28 G5), keyed by the folded name. */
interface GoodName {
  good: HouseGood;
  /** The good's place in the list it came from, so hits keep that order. */
  at: number;
  parts: ReturnType<typeof nameParts>;
}
export type GoodIndex = Map<string, GoodName[]>;

/**
 * The goods by folded name: each good's display name and wine name are folded
 * once here, not once per line. Matching a line is then a lookup of its own
 * folded name, so a menu of L lines against a house of G goods costs about
 * L + G folds, where it cost L x G (r28 G5: 485 lines x 1,500 goods was over
 * 700,000 folds inside one request).
 */
export function indexGoods(goods: HouseGood[]): GoodIndex {
  const index: GoodIndex = new Map();
  goods.forEach((good, at) => {
    const seen = new Set<string>();
    for (const n of [good.display_name, good.wine_name]) {
      if (!n) continue;
      const parts = nameParts(n);
      if (!parts.key || seen.has(`${parts.key}|${parts.vintage}|${parts.sizeMl}`)) continue;
      seen.add(`${parts.key}|${parts.vintage}|${parts.sizeMl}`);
      const list = index.get(parts.key) ?? [];
      list.push({ good, at, parts });
      index.set(parts.key, list);
    }
  });
  return index;
}

/** The goods a line's name fits, in their list order: kind, producer, name, vintage and size. */
function goodsFitting(line: MatchableLine, index: GoodIndex, withLibrary: boolean): HouseGood[] {
  const family = lineFamily(line.category);
  const lineProducer = withLibrary ? foldName(line.producer) : "";
  const hits = new Map<number, HouseGood>();
  const forms = [line.name, line.producer ? `${line.producer} ${line.name}` : null];
  for (const form of forms) {
    if (form === null) continue;
    const lp = nameParts(form);
    if (!lp.key) continue;
    const lineVintage = statedVintage(line.vintage) ?? lp.vintage;
    for (const { good, at, parts: gp } of index.get(lp.key) ?? []) {
      if (!kindFits(family, good.kind)) continue;
      if (withLibrary) {
        const goodProducer = foldName(good.producer);
        if (lineProducer && goodProducer && lineProducer !== goodProducer) continue;
        const goodVintage = gp.vintage ?? statedVintage(good.vintage);
        if (lineVintage && goodVintage && lineVintage !== goodVintage) continue;
      }
      const goodSize = good.bottle_size_ml ?? gp.sizeMl;
      if (lp.sizeMl && goodSize && lp.sizeMl !== goodSize) continue;
      hits.set(at, good);
    }
  }
  return [...hits.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g);
}

/** The house's goods that fit one line, read from an index built once. */
export function matchLineIn(line: MatchableLine, index: GoodIndex): HouseMatch {
  const hits = goodsFitting(line, index, true);
  if (hits.length === 0) return { outcome: "none" };
  if (hits.length === 1) return { outcome: "one", good: hits[0] };
  return { outcome: "many", goods: hits };
}

/** The house's goods that fit one line. Pure: the goods are already read. */
export function matchLine(line: MatchableLine, goods: HouseGood[]): HouseMatch {
  return matchLineIn(line, indexGoods(goods));
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
 *
 * `liveGoods`, when given, is every live good of this house already read by
 * the caller (the plan reads them all; r35 G21), and step 1 is skipped.
 */
export async function matchHouseGoods(
  client: Client,
  restaurantId: string,
  lines: Array<MatchableLine | null>,
  liveGoods?: HouseGood[],
): Promise<HouseMatch[]> {
  const none: HouseMatch = { outcome: "none" };
  if (lines.every((l) => l === null)) return lines.map(() => none);

  // 1. The house's live goods, keyset-paged past the 1000-row cap.
  const goods: HouseGood[] = liveGoods ? [...liveGoods] : [];
  let after: string | null = null;
  for (; !liveGoods; ) {
    let q = client
      .from("restaurant_inventory")
      .select("id, display_name, wine_name, kind, master_wine_id, bottle_size_ml, menu_price_current, menu_price_glass, identity_provenance")
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
  const byName = indexGoods(goods);
  const named = new Set<HouseGood>();
  for (const line of lines) {
    if (!line) continue;
    for (const g of goodsFitting(line, byName, false)) named.add(g);
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

  const byCandidate = indexGoods(candidates);
  return lines.map((line) => (line ? matchLineIn(line, byCandidate) : none));
}
