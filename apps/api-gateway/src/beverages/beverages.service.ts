import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  beverageTypesForRegister,
  isRegisterId,
  type RegisterId,
} from "../cellar/cellar-registers";

/**
 * The two catalogue tables that had a schema and no way in.
 *
 * `public.beverages` (20260817070000) and `public.cocktails` /
 * `public.cocktail_ingredients` (20260817090000) have existed since August and
 * no controller served either, so `/beer`, `/whiskey` and `/cocktails` could
 * not report a single row — not even a count. This service is the smallest
 * honest read over both.
 *
 * THE SCOPE FACT, STATED IN THE RESPONSE. `public.beverages` has **no
 * `restaurant_id` column** (read the CREATE TABLE at
 * `20260817070000_beverages_table.sql:217`) — it is a global reference
 * catalogue, exactly like `master_wine_library`. Returning its rows to a
 * tenant without saying so would let a page print "your cellar holds 400
 * beers" about rows nobody in this house has ever touched. So every response
 * carries `scope`, and the browser is expected to render the word.
 *
 * `public.cocktails` DOES carry `restaurant_id`, but it is nullable and the 55
 * migrated rows are unattributed demo-corpus provenance
 * (`20260817090000_cocktails.sql:11-17`). The tenant read therefore returns
 * only rows this house owns, and reports the unattributed count SEPARATELY as
 * reference rows — never mixed in, and never another tenant's rows, which are
 * excluded by the same filter.
 */

const MISSING_RELATION_CODES = new Set(["42P01", "PGRST205", "PGRST202"]);

export interface CatalogueScope {
  /** `tenant` — rows this house owns. `global-reference` — a shared catalogue. */
  scope: "tenant" | "global-reference";
  /** One sentence the browser may render verbatim. */
  scopeNote: string;
}

export interface BeverageListResult extends CatalogueScope {
  restaurantId: string;
  /** The register asked for, or null when the whole table was listed. */
  register: RegisterId | null;
  /** The `beverage_type` values the register resolved to. */
  matchedTypes: string[];
  /** False when this table has no `beverage_type` for the register asked for. */
  servedByThisTable: boolean;
  rows: unknown[];
  /** Rows returned. Distinct from the table's size when `truncated`. */
  count: number;
  /** True when the read came back at its own limit — so `count` is a floor. */
  truncated: boolean;
  limit: number;
}

export interface CocktailListResult extends CatalogueScope {
  restaurantId: string;
  rows: unknown[];
  count: number;
  truncated: boolean;
  limit: number;
  /**
   * Rows in `public.cocktails` with a null `restaurant_id`: unattributed
   * reference data, not this house's and not another house's. Null when the
   * count could not be read — never 0.
   */
  referenceRows: number | null;
  /**
   * `cocktail_ingredients` is empty BY DESIGN — recipes were never extracted
   * (`20260817090000_cocktails.sql:20-25`). Carried on the response so a
   * cocktails register can say "names without recipes" instead of rendering a
   * recipe panel that will always be blank.
   */
  recipesAvailable: false;
}

@Injectable()
export class BeveragesService {
  private readonly logger = new Logger(BeveragesService.name);

  constructor(private readonly dbService: DatabaseService) {}

  private explain(error: { message: string; code?: string }, table: string): Error {
    return new Error(
      MISSING_RELATION_CODES.has(String(error.code))
        ? `public.${table} is not on this database yet (migration not applied)`
        : error.message,
    );
  }

  async listBeverages(
    restaurantId: string,
    opts: { type?: string; register?: string; search?: string; limit: number },
  ): Promise<BeverageListResult> {
    // `register` is the useful filter for a cellar page — "beer", "whiskey",
    // "spirits" — and it resolves to the measured `beverage_type` vocabulary in
    // ONE place (cellar/cellar-registers.ts), so the browser never has to hold
    // its own copy of which types are spirits.
    const register: RegisterId | null =
      opts.register && isRegisterId(opts.register) ? opts.register : null;
    const types = register ? beverageTypesForRegister(register) : [];

    // A register this table cannot serve returns NOTHING, and says why.
    //
    // Caught live 2026-09-03: `?register=soft_drinks` resolved to an empty type
    // list, the `IN (...)` filter was therefore skipped, and the endpoint
    // cheerfully returned the first N rows of the whole catalogue — whiskies
    // and tequila under the heading "soft drinks". An unserviceable filter that
    // silently degrades to "no filter" is worse than an error: it answers a
    // question it was never able to answer.
    if (register !== null && types.length === 0) {
      return {
        restaurantId,
        register,
        matchedTypes: [],
        servedByThisTable: false,
        rows: [],
        count: 0,
        truncated: false,
        limit: opts.limit,
        scope: "global-reference",
        scopeNote:
          "No value of beverages.beverage_type identifies this register, so this table cannot answer for it. This is the absence of a query, not an empty result.",
      };
    }
    let q = this.dbService
      .getClient()
      .from("beverages")
      .select(
        "id, beverage_type, name, display_name, producer, brand, country, region, abv_pct, volume_ml, package_format, price_reference, identity_status, observed_at",
      )
      // A superseded row is pointed at its keeper and never deleted (arch §3.7).
      // Listing both sides would show one bottle twice.
      .is("superseded_by", null)
      .is("deleted_at", null)
      .order("name", { ascending: true })
      .limit(opts.limit);

    if (types.length > 0) q = q.in("beverage_type", types);
    if (opts.type) q = q.ilike("beverage_type", `%${opts.type}%`);
    if (opts.search) {
      q = q.or(`name.ilike.%${opts.search}%,producer.ilike.%${opts.search}%`);
    }

    const { data, error } = await q;
    if (error) {
      this.logger.error(`Failed to list beverages: ${error.message}`);
      throw this.explain(error, "beverages");
    }

    const rows = data ?? [];
    return {
      restaurantId,
      rows,
      count: rows.length,
      truncated: rows.length >= opts.limit,
      limit: opts.limit,
      register,
      // The types the filter actually used, so a page can say what it counted
      // and a missing vocabulary entry is visible rather than silent.
      matchedTypes: types,
      // A register with no `beverage_type` behind it is named as such. Soft
      // drinks are the live case: no value of the column separates a cola from
      // a kombucha, so an empty list here means "this table cannot answer",
      // not "the house has none".
      servedByThisTable: register === null || types.length > 0,
      scope: "global-reference",
      scopeNote:
        "public.beverages carries no restaurant_id — this is the shared reference catalogue, not what this house holds. Nothing here is stock.",
    };
  }

  async listCocktails(
    restaurantId: string,
    opts: { search?: string; limit: number },
  ): Promise<CocktailListResult> {
    let q = this.dbService
      .getClient()
      .from("cocktails")
      .select(
        "id, name, display_name, menu_section, method, glass, garnish, price, description, source",
      )
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null)
      .order("name", { ascending: true })
      .limit(opts.limit);

    if (opts.search) q = q.ilike("name", `%${opts.search}%`);

    const { data, error } = await q;
    if (error) {
      this.logger.error(`Failed to list cocktails: ${error.message}`);
      throw this.explain(error, "cocktails");
    }

    // Unattributed reference rows, counted separately. A failure here leaves
    // the figure null; it must never fall back to 0, which would read as "there
    // is no reference data" when the truth is "we could not ask".
    let referenceRows: number | null = null;
    const { count, error: refError } = await this.dbService
      .getClient()
      .from("cocktails")
      .select("id", { count: "exact", head: true })
      .is("restaurant_id", null)
      .is("deleted_at", null);
    if (!refError) referenceRows = count ?? 0;

    const rows = data ?? [];
    return {
      restaurantId,
      rows,
      count: rows.length,
      truncated: rows.length >= opts.limit,
      limit: opts.limit,
      referenceRows,
      recipesAvailable: false,
      scope: "tenant",
      scopeNote:
        "Only cocktails this restaurant owns. Rows with no restaurant are unattributed reference data and are counted separately, never listed here.",
    };
  }
}
