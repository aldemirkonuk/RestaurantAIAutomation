/**
 * The name-only wine search on /vendors — founder, 2026-09-26, round 7, item 48
 * (ADR 0221).
 *
 * HIS RULE, as recorded: "'Supplies my menu' = exact vintage; a NAME-ONLY search
 * (menu filter not applied) matches any vintage — implement now." So when a
 * person types a wine's name on "All my vendors" or "Find new vendors", every
 * vendor with evidence for ANY vintage of that wine appears, and each is
 * labelled with the vintage(s) the evidence names. "Supplies my menu" is not
 * touched: it still matches the menu line's exact `wine_library_id`
 * (`vendor-menu-supply.ts`), because a menu line IS one vintage.
 *
 * TWO ARMS, TWO KINDS OF EVIDENCE — never mixed, never called the same thing
 *
 *   own book  (`readOwnWineSellers`, "All my vendors")
 *     The house's own PURCHASE evidence, the same three sources as the menu
 *     rung — price_history, lines of orders that reached the vendor
 *     (BOUGHT_STATUSES), live inventory rows naming the vendor — but with NO
 *     180-day window: "who has sold me any vintage of this" is a question about
 *     the whole book, and the label says which kinds of evidence there were.
 *
 *   catalogue (`readCatalogueWineListers`, "Find new vendors")
 *     Curated `vendor_catalogue` vendors (the rung's own tier, active, in the
 *     country the rung is set to) that a price SIGHTING ties to the wine —
 *     `vendor_price_observations.vendor_catalogue_id`. A sighting is not a sale:
 *     it is a list price on their site, a quote, or (tier 1) an invoice. Each
 *     wine carries the strongest source seen so the page can say "listed",
 *     "quoted" or "invoiced" instead of pretending all of them are sales. The
 *     read goes through `scopePriceRegisterRead` with `houseAndOpenMarket`
 *     (ADR 0117's visibility rule): this house's own sightings plus openly
 *     posted ones — never another house's paper (ADR 0221: each house owns its
 *     vendors; the shared layer comes later and is not this).
 *
 * THE MATCH (one rule, both arms — `parseWineQuery` / `matchesWine`)
 *   * Words of the query are matched against "producer name" of the library row
 *     (or the sighting's text as written, when the sighting names no library
 *     row), accent- and case-folded, every word required, in any order. So
 *     "chateau margaux" finds "Château Margaux", "opus one" finds producer
 *     "Opus One Winery" / name "Opus One".
 *   * A four-digit year in the query (1900–2099) is not a word of the name: it
 *     narrows to THAT vintage, exactly. A name alone matches every vintage.
 *     [Reading of item 48 by this lane, not a founder answer: "name-only
 *     matches any vintage" says nothing about a query that states a year, and
 *     treating "2019" as text would find nothing, since no wine's NAME contains
 *     its vintage. Recorded in ADR 0221's bracket as a reading.]
 *   * The name part must be at least two characters; shorter is a 400, not a
 *     search of everything.
 *
 * WHY THE RULES BELOW ARE LOAD-BEARING (same five as the menu rung)
 *   1. Every read is house-scoped (the gateway reads with the service role, so
 *      RLS protects nothing): `.eq("restaurant_id", …)` on price_history and
 *      inventory, the ORDER's house for order lines, `scopePriceRegisterRead`
 *      for sightings. `master_wine_library` and `vendor_catalogue` are shared
 *      reference tables and are read only BY ID for rows the scoped reads named.
 *   2. No read is capped: keyset-paged on `id` to a short page (`readAll`), and
 *      id lists are chunked, never truncated.
 *   3. The name match is done here, in code, over rows already scoped — never
 *      by interpolating the person's text into a PostgREST filter string.
 *      (The one server-side narrowing, on the sightings' own text, goes through
 *      `.ilike()`, which parameterises its value; see `accentBlindLike`.)
 *   4. A failed read throws; the service turns it into a 503 with the reason.
 *      "No vendor sold this" and "the book did not answer" never look alike.
 *   5. Price history is read as PRESENCE only (`id, provider_id,
 *      master_wine_id`) — no price, no quantity — so the unit guard's presence
 *      arm (`scripts/check_price_history_reads_group_by_unit.py`) admits it and
 *      nothing here can average a case price with a bottle price.
 */

import { hasStatus } from "../procurement/order-status";
import {
  scopePriceRegisterRead,
  VENDOR_PRICE_OBSERVATIONS,
} from "../price-register/visibility";
import { BOUGHT_STATUSES, readAll, type Row } from "./vendor-menu-supply";

/** How many ids go in one `.in()` — well under PostgREST's URL limits. */
export const ID_CHUNK = 150;

export const MIN_NAME_CHARS = 2;

export interface WineQuery {
  /** The query as the person typed it, trimmed. */
  text: string;
  /** Folded name words; every one must appear. */
  words: string[];
  /** Vintages the query named; empty = any vintage (the name-only search). */
  vintages: number[];
}

const YEAR = /^(19|20)\d{2}$/;

/** Lower-case, accents stripped, punctuation to spaces. */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Null when the name part is too short to search. */
export function parseWineQuery(raw: unknown): WineQuery | null {
  const text = typeof raw === "string" ? raw.trim().slice(0, 200) : "";
  const words: string[] = [];
  const vintages: number[] = [];
  for (const w of fold(text).split(" ")) {
    if (!w) continue;
    if (YEAR.test(w)) vintages.push(Number(w));
    else words.push(w);
  }
  if (words.join(" ").length < MIN_NAME_CHARS) return null;
  return { text, words, vintages: [...new Set(vintages)] };
}

/** A four-digit year written in a sighting's own text, or null. */
export function vintageWritten(text: string | null): number | null {
  if (!text) return null;
  const m = fold(text).match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
}

export function matchesWine(
  q: WineQuery,
  nameText: string,
  vintage: number | null,
): boolean {
  const hay = ` ${fold(nameText)} `;
  if (!q.words.every((w) => hay.includes(w))) return false;
  if (q.vintages.length === 0) return true;
  return vintage !== null && q.vintages.includes(vintage);
}

// ---------------------------------------------------------------------------
// Shared reference reads — by id only, chunked.
// ---------------------------------------------------------------------------

interface LibraryWine {
  id: string;
  name: string;
  producer: string | null;
  vintage: number | null;
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

async function readLibraryWines(
  db: any,
  ids: string[],
): Promise<Map<string, LibraryWine>> {
  const out = new Map<string, LibraryWine>();
  for (const part of chunks(ids, ID_CHUNK)) {
    const { data, error } = await db
      .from("master_wine_library")
      .select("id, name, producer, vintage")
      .in("id", part);
    if (error) {
      throw new Error(`The wine library could not be read (${error.message})`);
    }
    for (const r of (data ?? []) as Row[]) {
      const id = str(r.id);
      const name = str(r.name);
      if (!id || !name) continue;
      out.set(id, {
        id,
        name,
        producer: str(r.producer),
        vintage: num(r.vintage),
      });
    }
  }
  return out;
}

const wineText = (w: { producer: string | null; name: string }): string =>
  w.producer && !fold(w.name).includes(fold(w.producer))
    ? `${w.producer} ${w.name}`
    : w.name;

/** Name first, then newest vintage first, unknown vintage last. */
function byWine(
  a: { name: string; producer: string | null; vintage: number | null },
  b: { name: string; producer: string | null; vintage: number | null },
): number {
  return (
    wineText(a).localeCompare(wineText(b)) ||
    (b.vintage ?? -1) - (a.vintage ?? -1)
  );
}

// ---------------------------------------------------------------------------
// Own book — "All my vendors".
// ---------------------------------------------------------------------------

export interface WineSold {
  masterWineId: string;
  producer: string | null;
  name: string;
  vintage: number | null;
  priced: boolean;
  ordered: boolean;
  stocked: boolean;
}

export interface OwnWineSeller {
  providerId: string;
  wines: WineSold[];
}

export interface OwnWineSearch {
  query: WineQuery;
  /** Distinct library wines (vintages) in the house's evidence that matched. */
  winesMatched: number;
  sellers: OwnWineSeller[];
}

export async function readOwnWineSellers(
  db: any,
  restaurantId: string,
  query: WineQuery,
): Promise<OwnWineSearch> {
  const [priced, ordered, stocked] = await Promise.all([
    readAll("The price history", (after) => {
      let q = db
        .from("price_history")
        .select("id, provider_id, master_wine_id")
        .eq("restaurant_id", restaurantId)
        .not("provider_id", "is", null)
        .not("master_wine_id", "is", null);
      if (after) q = q.gt("id", after);
      return q;
    }),
    readAll("The order lines", (after) => {
      let q = db
        .from("procurement_order_items")
        .select(
          "id, master_wine_id, procurement_orders!inner(provider_id, status, restaurant_id)",
        )
        .eq("procurement_orders.restaurant_id", restaurantId)
        .not("master_wine_id", "is", null);
      if (after) q = q.gt("id", after);
      return q;
    }),
    readAll("The inventory", (after) => {
      let q = db
        .from("restaurant_inventory")
        .select("id, provider_id, master_wine_id")
        .eq("restaurant_id", restaurantId)
        .is("deleted_at", null)
        .not("provider_id", "is", null);
      if (after) q = q.gt("id", after);
      return q;
    }),
  ]);

  type Kinds = { priced: boolean; ordered: boolean; stocked: boolean };
  // providerId -> wineId -> kinds
  const evidence = new Map<string, Map<string, Kinds>>();
  const note = (
    providerId: string | null,
    wine: string | null,
    kind: keyof Kinds,
  ) => {
    if (!providerId || !wine) return;
    let wines = evidence.get(providerId);
    if (!wines) {
      wines = new Map();
      evidence.set(providerId, wines);
    }
    let k = wines.get(wine);
    if (!k) {
      k = { priced: false, ordered: false, stocked: false };
      wines.set(wine, k);
    }
    k[kind] = true;
  };
  for (const r of priced)
    note(str(r.provider_id), str(r.master_wine_id), "priced");
  for (const r of ordered) {
    const raw = r.procurement_orders as Row | Row[] | null | undefined;
    const order = Array.isArray(raw) ? raw[0] : raw;
    if (!order) continue;
    if (!hasStatus(str(order.status), BOUGHT_STATUSES)) continue;
    note(str(order.provider_id), str(r.master_wine_id), "ordered");
  }
  for (const r of stocked)
    note(str(r.provider_id), str(r.master_wine_id), "stocked");

  const wineIds = new Set<string>();
  for (const wines of evidence.values())
    for (const id of wines.keys()) wineIds.add(id);
  const library = await readLibraryWines(db, [...wineIds].sort());

  const matched = new Set<string>();
  for (const [id, w] of library) {
    if (matchesWine(query, wineText(w), w.vintage)) matched.add(id);
  }

  const sellers: OwnWineSeller[] = [];
  for (const [providerId, wines] of evidence) {
    const list: WineSold[] = [];
    for (const [id, k] of wines) {
      if (!matched.has(id)) continue;
      const w = library.get(id)!;
      list.push({
        masterWineId: id,
        producer: w.producer,
        name: w.name,
        vintage: w.vintage,
        ...k,
      });
    }
    if (list.length) sellers.push({ providerId, wines: list.sort(byWine) });
  }
  sellers.sort(
    (a, b) =>
      b.wines.length - a.wines.length ||
      a.providerId.localeCompare(b.providerId),
  );
  return { query, winesMatched: matched.size, sellers };
}

// ---------------------------------------------------------------------------
// Catalogue — "Find new vendors".
// ---------------------------------------------------------------------------

/** The strongest kind of sighting, in the register's own trust order. */
export type SightingKind = "invoiced" | "quoted" | "listed";

function kindOf(sourceType: string | null): SightingKind {
  if (sourceType === "invoice") return "invoiced";
  if (sourceType === "quote") return "quoted";
  return "listed";
}

const KIND_RANK: Record<SightingKind, number> = {
  invoiced: 0,
  quoted: 1,
  listed: 2,
};

export interface WineListed {
  /** Null when the sighting names no library wine; `asWritten` is then all there is. */
  masterWineId: string | null;
  producer: string | null;
  name: string;
  vintage: number | null;
  /** True when the vintage was read out of the sighting's own text, not the library. */
  vintageFromText: boolean;
  kind: SightingKind;
  lastSeen: string | null;
}

export interface CatalogueWineLister {
  vendor: {
    id: string;
    name: string;
    type: string | null;
    country: string | null;
    state: string | null;
    city: string | null;
    wine_specialties: string | null;
  };
  wines: WineListed[];
}

export interface CatalogueWineSearch {
  query: WineQuery;
  country: string;
  /** Sightings of a catalogue vendor whose text named the query's longest word. */
  sightingsRead: number;
  listers: CatalogueWineLister[];
}

/**
 * The server-side narrowing pattern for one folded query word. `.ilike()` is
 * case-blind but NOT accent-blind, and the word is folded ("chateau") while a
 * vendor's text may not be ("Château"), so every letter that commonly carries
 * a diacritic becomes `_` (any one character). The pattern only NARROWS; the
 * full rule (`matchesWine`) runs on every row it lets through. A folded word
 * holds only letters and digits, so no `%`, `_` or `\\` of the person's own
 * can reach the pattern.
 */
export function accentBlindLike(word: string): string {
  return `%${word.replace(/[aeiouycnszg]/g, "_")}%`;
}

export async function readCatalogueWineListers(
  db: any,
  restaurantId: string,
  query: WineQuery,
  country: string,
): Promise<CatalogueWineSearch> {
  // Narrow on the longest word server-side (a parameterised `.ilike`, accent-
  // blind by `accentBlindLike`), then apply the full rule here. A sighting
  // whose own text lacks that word but whose library row has it is missed —
  // stated in ADR 0221's bracket.
  const longest = [...query.words].sort((a, b) => b.length - a.length)[0];
  const sightings = await readAll("The price sightings", (after) => {
    let q = scopePriceRegisterRead(
      db
        .from("vendor_price_observations")
        .select(
          "id, vendor_catalogue_id, master_wine_id, product_name_raw, source_type, observed_at",
        ),
      VENDOR_PRICE_OBSERVATIONS,
      { kind: "houseAndOpenMarket", restaurantId },
    )
      .not("vendor_catalogue_id", "is", null)
      .ilike("product_name_raw", accentBlindLike(longest));
    if (after) q = q.gt("id", after);
    return q;
  });

  const library = await readLibraryWines(
    db,
    [
      ...new Set(
        sightings
          .map((r) => str(r.master_wine_id))
          .filter((x): x is string => x !== null),
      ),
    ].sort(),
  );

  // vendorId -> wine key -> listed
  const byVendor = new Map<string, Map<string, WineListed>>();
  for (const r of sightings) {
    const vendorId = str(r.vendor_catalogue_id);
    const raw = str(r.product_name_raw);
    if (!vendorId || !raw) continue;
    const libId = str(r.master_wine_id);
    const lib = libId ? library.get(libId) : undefined;
    const listed: WineListed = lib
      ? {
          masterWineId: lib.id,
          producer: lib.producer,
          name: lib.name,
          vintage: lib.vintage,
          vintageFromText: false,
          kind: kindOf(str(r.source_type)),
          lastSeen: str(r.observed_at),
        }
      : {
          masterWineId: null,
          producer: null,
          name: raw,
          vintage: vintageWritten(raw),
          vintageFromText: true,
          kind: kindOf(str(r.source_type)),
          lastSeen: str(r.observed_at),
        };
    // A library row matches on its own name OR on what the vendor wrote.
    const hit = lib
      ? matchesWine(query, wineText(lib), lib.vintage) ||
        (lib.vintage === null && matchesWine(query, raw, vintageWritten(raw)))
      : matchesWine(query, raw, listed.vintage);
    if (!hit) continue;
    const key = listed.masterWineId ?? `raw:${fold(raw)}`;
    let wines = byVendor.get(vendorId);
    if (!wines) {
      wines = new Map();
      byVendor.set(vendorId, wines);
    }
    const prev = wines.get(key);
    if (!prev) {
      wines.set(key, listed);
    } else {
      if (KIND_RANK[listed.kind] < KIND_RANK[prev.kind])
        prev.kind = listed.kind;
      if (
        listed.lastSeen &&
        (!prev.lastSeen || listed.lastSeen > prev.lastSeen)
      )
        prev.lastSeen = listed.lastSeen;
    }
  }

  // The vendors themselves: the rung's own tier, active, in its country.
  const vendorIds = [...byVendor.keys()].sort();
  const vendors: Row[] = [];
  for (const part of chunks(vendorIds, ID_CHUNK)) {
    const { data, error } = await db
      .from("vendor_catalogue")
      .select("id, name, type, country, state, city, wine_specialties")
      .in("id", part)
      .eq("is_active", true)
      .eq("listing_tier", "curated")
      .eq("country", country);
    if (error) {
      throw new Error(
        `The vendor catalogue could not be read (${error.message})`,
      );
    }
    vendors.push(...((data ?? []) as Row[]));
  }

  const listers: CatalogueWineLister[] = [];
  for (const v of vendors) {
    const id = str(v.id);
    const name = str(v.name);
    if (!id || !name) continue;
    const wines = byVendor.get(id);
    if (!wines || wines.size === 0) continue;
    listers.push({
      vendor: {
        id,
        name,
        type: str(v.type),
        country: str(v.country),
        state: str(v.state),
        city: str(v.city),
        wine_specialties: str(v.wine_specialties),
      },
      wines: [...wines.values()].sort(byWine),
    });
  }
  listers.sort(
    (a, b) =>
      b.wines.length - a.wines.length ||
      a.vendor.name.localeCompare(b.vendor.name),
  );
  return { query, country, sightingsRead: sightings.length, listers };
}
