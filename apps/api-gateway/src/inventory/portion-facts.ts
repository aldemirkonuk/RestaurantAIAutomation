import { confirmedWinePourFrom } from "../pricing/target-margin.service";

/**
 * What a POS sale of one good can be, read only from what the house stated
 * (r24 pos-portions). The POS mapping panel builds its answers from this, and
 * its answer is saved as the sale size that moves stock.
 *
 * Each fact is the one the depletion itself reads, so the panel can offer only
 * what the till can do right:
 *  - `bottleMl` is the row's OWN `bottle_size_ml`. `record_glass_pour` reads
 *    that column and nothing else (COALESCE(ri.bottle_size_ml, 750)), so a
 *    library size or the 750 stand-in is not what a pour is taken from. The
 *    library's `bottle_size_ml` is NOT NULL DEFAULT 750 and cannot be told
 *    from a typed one.
 *  - `pourMl` is the row's own CONFIRMED pour (ADR 0193 F7, round 6c). The
 *    unconfirmed `pour_size_ml` is the database's DEFAULT 150. The house's
 *    confirmed pour is read by the web from /pricing/target-margin, and it is
 *    a wine glass, never a shot.
 *  - `kind` is the row's kind. A row the wine path inserted is `wine` by the
 *    insert trigger's default, so a library row that knows better (a gin, a
 *    beer) wins over that default; a kind the house chose (`whiskey`) stays.
 *  - `uom` is the unit the stock is kept in. A whole-container sale is a unit
 *    move, which is right only when one unit is one container.
 */
export interface PortionFacts {
  kind: string | null;
  uom: string | null;
  bottleMl: number | null;
  pourMl: number | null;
}

/** The library's beverage kinds that name a drink other than wine. */
const LIBRARY_KINDS = new Set(["beer", "spirit", "sake", "cider", "cocktail", "non_alcoholic"]);

function word(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim().toLowerCase() : null;
}

export function portionFactsOf(row: Record<string, any>): PortionFacts {
  const own = Number(row?.bottle_size_ml);
  const rowKind = word(row?.kind) ?? (row?.master_wine_id ? "wine" : null);
  const libKind = word(row?.master_wine_library?.beverage_kind);
  return {
    kind: rowKind === "wine" && libKind && LIBRARY_KINDS.has(libKind) ? libKind : rowKind,
    uom: word(row?.uom),
    bottleMl: Number.isFinite(own) && own > 0 ? own : null,
    pourMl: confirmedWinePourFrom(row),
  };
}
