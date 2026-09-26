/**
 * House-first scope for `/promotions` (founder item 36, 2026-09-25/26 —
 * ADR 0160 §113, round-6 bracket). Pure: every function takes rows already
 * read and returns a tag; nothing here touches the database or the clock.
 *
 * THE LADDER (his words, three rungs): "On my menu" → "Everything I stock" →
 * "All offers". Each rung contains the one before it. An offer's `scope` is
 * the NARROWEST rung it belongs to; the page shows a rung as every offer whose
 * scope is that rung or narrower. The ranking is computed once over every
 * offer before any rung hides anything (the box sizes do not move when the
 * rung changes) — that half lives in the web's `rankOffers`.
 *
 * HOW AN OFFER IS PLACED (research-filters.md, adversarial pass, corrected
 * recommendation — its F1/F3/F4/F9 overturn the first synthesis):
 *
 *  - The extractor only ever writes the NAMES of this house's own
 *    `restaurant_inventory.wine_name` rows into `applicable_wines`
 *    (`promotion-extractor.service.ts`, `matchApplicableWines`). So an offer
 *    wine is joined back to the shelf by folded-name equality — the same
 *    `foldName` the grader uses — and to the menu through those shelf rows'
 *    `master_wine_id` = `menu_items.wine_library_id`. No new name matcher.
 *  - VINTAGE-AGNOSTIC, ANY ROW (F4). Two vintages of one wine are two shelf
 *    rows (UNIQUE (restaurant_id, master_wine_id)) that can share one
 *    `wine_name`. The grader's `bridgeKeyFor` returns the FIRST row's key,
 *    which depends on row order; here EVERY row of that name is consulted, so
 *    "on my menu" holds if ANY of them is on a current menu line, whatever
 *    order the rows came back in.
 *  - CURRENT MENU ONLY (F1). The menu set is built by the caller from the
 *    house's ACTIVE menu(s) only (drafts and archived versions are not "on my
 *    menu"), every page of their lines (F2), discarded lines excluded.
 *  - THE CLAIM IS NAMED, NOT ASSERTED (F3). The extractor matches a name
 *    inside the vendor's mail by substring, and menu-linked shelf rows carry
 *    the menu line's own name, which is often generic ("Malbec"). So each
 *    menu match carries the menu line it matched, and the page's words are
 *    only "names a wine on your menu: <line>" — checkable by the owner.
 *
 * CATEGORIES (coarse, his words "not that deep"). Source:
 * `master_wine_library.beverage_kind` of the matched shelf rows — the
 * database's own classifier (20260817060000, auto-maintained by
 * trg_wine_beverage_kind: real primary_type first, then the menu's own section
 * header, else `unknown`). Folded to five words a buyer uses. Whiskey is NOT
 * split from spirits: `beverage_kind` has no whiskey value (cellar-registers
 * `NAME_ONLY_REGISTERS`), and "not that deep" is his. Fruit and produce have
 * no source here — the extractor only ever names shelf rows, and the shelf
 * holds the library's drinks — so no such chip is drawn rather than one that
 * could never hold an offer.
 *
 * RUNNING LOW, HONESTLY. `stock_live` defaults to 0 and `threshold_min` to 3
 * (baseline), and menu linking inserts rows with no count — so "below par" is
 * true of every row nobody ever counted (F6). A wine is called running low
 * ONLY when every active shelf row of that name has been COUNTED —
 * `restaurant_inventory.last_counted_at` IS NOT NULL, which only
 * `record_stock_count()` stamps, in the same transaction as the
 * `stock_counts` row (20260902190000_a_count_is_a_record.sql:305-312) — and
 * each is below par by the one predicate every counter asks (`isBelowPar`,
 * common/stock-status.ts). A row nobody counted makes the wine "not known",
 * never "low".
 */

import { isBelowPar } from "../common/stock-status";
import { placeMenuLine } from "../cellar/cellar-registers";
import { foldName } from "./offer-grade";

export type OfferScope = "menu" | "stock" | "other";

export const COARSE_CATEGORIES = [
  "wine",
  "beer",
  "spirits",
  "soft_drinks",
  "other_drinks",
  "not_classified",
] as const;
export type CoarseCategory = (typeof COARSE_CATEGORIES)[number];

/** `master_wine_library.beverage_kind` → the coarse word the filter shows. */
export function coarseCategoryOf(kind: string | null | undefined): CoarseCategory {
  switch (kind) {
    case "wine":
      return "wine";
    case "beer":
      return "beer";
    case "spirit":
      return "spirits";
    case "non_alcoholic":
      return "soft_drinks";
    case "sake":
    case "cider":
    case "cocktail":
      return "other_drinks";
    default:
      return "not_classified";
  }
}

/** One `restaurant_inventory` row of this house, as the scope reads it. */
export interface ShelfRow {
  name: string;
  productKey: string | null;
  /** `is_active` is not false AND `deleted_at` is null. */
  active: boolean;
  kind: string | null;
  stockLive: number | null;
  thresholdMin: number | null;
  /** `last_counted_at` — stamped only by a real count. */
  lastCountedAt: string | null;
}

/** One live line of one of the house's CURRENT (active) menus. */
export interface CurrentMenuLine {
  id: string;
  menuId: string;
  name: string | null;
  category: string | null;
  wineLibraryId: string | null;
}

export interface MenuMatch {
  /** The offer's wine, as the mail named it. */
  wine: string;
  menuLineId: string;
  /** The menu line's own words — what the page shows beside the claim. */
  menuLine: string;
}

export interface RunningLow {
  wine: string;
  /** Summed over the wine's active shelf rows, every one of them counted. */
  stockLive: number;
  thresholdMin: number;
  /** The OLDEST count among those rows — the claim is only as fresh as that. */
  countedAt: string;
}

export interface OfferScopeTag {
  /** The narrowest rung the offer belongs to. */
  scope: OfferScope;
  /** Distinct named wines (m). */
  wines: number;
  /** Of those, how many name a wine on a current menu line (n) — "n of m on your menu". */
  winesOnMenu: number;
  menuMatches: MenuMatch[];
  categories: CoarseCategory[];
  runningLow: RunningLow[];
}

export type ShelfIndex = Map<string, ShelfRow[]>;
export type MenuIndex = Map<string, CurrentMenuLine[]>;

/** Shelf rows by folded name — every row of a name, never only the first. */
export function indexShelf(rows: readonly ShelfRow[]): ShelfIndex {
  const out: ShelfIndex = new Map();
  for (const r of rows) {
    const k = foldName(r.name);
    if (!k) continue;
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

/** Current menu lines by the library wine they are linked to. */
export function indexMenu(lines: readonly CurrentMenuLine[]): MenuIndex {
  const out: MenuIndex = new Map();
  for (const l of lines) {
    if (!l.wineLibraryId) continue;
    const list = out.get(l.wineLibraryId);
    if (list) list.push(l);
    else out.set(l.wineLibraryId, [l]);
  }
  return out;
}

/** A total order on menu lines, so the line a match names never depends on row order. */
function menuLineOrder(a: CurrentMenuLine, b: CurrentMenuLine): number {
  return (a.name ?? "").localeCompare(b.name ?? "") || a.id.localeCompare(b.id);
}

export function scopeOffer(wines: readonly string[], shelf: ShelfIndex, menu: MenuIndex): OfferScopeTag {
  const names = Array.from(new Set(wines.map((w) => w.trim()).filter(Boolean)));
  const menuMatches: MenuMatch[] = [];
  const runningLow: RunningLow[] = [];
  const categories = new Set<CoarseCategory>();
  let stocked = false;

  for (const wine of names) {
    const rows = shelf.get(foldName(wine)) ?? [];
    // ANY row of this name on a current menu line (F4) — the candidates are
    // gathered from every row, then one line is chosen by a total order.
    const candidates: CurrentMenuLine[] = [];
    for (const r of rows) {
      if (r.productKey) candidates.push(...(menu.get(r.productKey) ?? []));
    }
    if (candidates.length > 0) {
      const line = [...candidates].sort(menuLineOrder)[0];
      menuMatches.push({ wine, menuLineId: line.id, menuLine: line.name ?? wine });
    }
    const active = rows.filter((r) => r.active);
    if (active.length > 0) stocked = true;
    for (const r of rows) categories.add(coarseCategoryOf(r.kind));

    // Running low: every active row counted, every one below par.
    if (
      active.length > 0 &&
      active.every(
        (r) =>
          r.lastCountedAt != null &&
          r.stockLive != null &&
          r.thresholdMin != null &&
          isBelowPar(r.stockLive, r.thresholdMin),
      )
    ) {
      const counted = active.map((r) => r.lastCountedAt as string).sort();
      runningLow.push({
        wine,
        stockLive: active.reduce((n, r) => n + (r.stockLive as number), 0),
        thresholdMin: active.reduce((n, r) => n + (r.thresholdMin as number), 0),
        countedAt: counted[0],
      });
    }
  }

  // An offer whose wines matched no shelf row has no classifier to read.
  if (categories.size === 0) categories.add("not_classified");
  const scope: OfferScope = menuMatches.length > 0 ? "menu" : stocked ? "stock" : "other";
  return {
    scope,
    wines: names.length,
    winesOnMenu: menuMatches.length,
    menuMatches,
    categories: COARSE_CATEGORIES.filter((c) => categories.has(c)),
    runningLow,
  };
}

/**
 * How much of the current menu the "On my menu" rung can see (F9). Counted
 * over DRINK lines only: a line with a library wine, or one `placeMenuLine`
 * puts on a drinks register other than cocktails (a mixed drink is never a
 * bottle a vendor offers). Food lines never get a `wine_library_id`, so
 * counting them as "not linked" would call the burger a failure; they are
 * reported apart as `otherLines`. The word is "linked", not "placed" —
 * "placed" already means sorted into a register (`MenuLineTally`).
 */
export interface MenuCoverage {
  lines: number;
  drinkLines: number;
  linked: number;
  notLinked: number;
  otherLines: number;
}

export function menuCoverage(lines: readonly CurrentMenuLine[]): MenuCoverage {
  let drinkLines = 0;
  let linked = 0;
  for (const l of lines) {
    const registers = placeMenuLine({ category: l.category, name: l.name }).filter((r) => r !== "cocktails");
    const isDrink = l.wineLibraryId != null || registers.length > 0;
    if (!isDrink) continue;
    drinkLines += 1;
    if (l.wineLibraryId != null) linked += 1;
  }
  return { lines: lines.length, drinkLines, linked, notLinked: drinkLines - linked, otherLines: lines.length - drinkLines };
}
