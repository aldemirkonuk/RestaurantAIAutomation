import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  beverageTypesForRegister,
  isRegisterId,
  type RegisterId,
} from "../cellar/cellar-registers";
import {
  composeRegister,
  unregistered,
  type CatalogueRow,
  type LedgerRow,
  type RegisterResult,
  type SourceStatus,
} from "./house-record";
import type {
  CreateCocktailDto,
  SetCocktailIngredientsDto,
  UpdateCocktailDto,
} from "./dto/beverages.dto";

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

/**
 * A function this database does not have yet. Distinct from a missing table:
 * `42883` is "no such function", and PostgREST reports an unknown RPC as
 * `PGRST202`. Kept apart from MISSING_RELATION_CODES so the sentence the
 * browser renders names the migration rather than a table.
 */
const MISSING_FUNCTION_CODES = new Set(["42883", "PGRST202", "PGRST203"]);

/**
 * The catalogue columns every read of `public.beverages` selects. One home,
 * and deliberately a MODULE-LEVEL const rather than a static class property:
 * `scripts/check_read_columns_exist.py` resolves a module const and checks each
 * column against the migrations, but cannot resolve `Class.COLUMNS`, which it
 * counts as "a read nobody is checking". Measured 2026-09-03 by instrumenting
 * that guard: this const resolves; the five `McpConnectionsService.ROW_COLUMNS`
 * and three `PaymentMethodsService.COLUMNS` sites in neighbouring modules do
 * not, and are 8 of its 10 unreadable reads.
 */
const CATALOGUE_COLUMNS =
  "id, beverage_type, name, display_name, producer, brand, country, region, abv_pct, volume_ml, package_format, price_reference, identity_status, observed_at";

/** The register read's own cap on each side. The response says if it was hit. */
export const REGISTER_CATALOGUE_LIMIT = 400;
export const REGISTER_LEDGER_LIMIT = 600;

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
      .select(CATALOGUE_COLUMNS)
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

  /* ── the house's own record ────────────────────────────────────────────── */

  /**
   * `public.house_beverage_ledger` — one row per product THIS house's own books
   * name, assembled across menu, invoices, orders, quotes and till lines
   * (migration 20260903120000).
   *
   * THE MISSING-FUNCTION CASE IS THE INTERESTING ONE. Until that migration is
   * applied, this RPC does not exist, and the temptation is to return `[]` and
   * let the register render as "this house has no record of anything" — which
   * is the absence-reported-as-health fault exactly. It returns `null` rows
   * with `readable: false` and a reason that names the migration, and every
   * surface renders the sentence instead of an empty ledger.
   */
  async readHouseLedger(
    restaurantId: string,
    limit: number,
  ): Promise<{ rows: LedgerRow[] | null; status: SourceStatus }> {
    const { data, error } = await this.dbService
      .getClient()
      .rpc("house_beverage_ledger", {
        p_restaurant_id: restaurantId,
        p_limit: limit,
      });

    if (error) {
      const code = String((error as { code?: string }).code);
      this.logger.error(`house_beverage_ledger failed: ${error.message}`);
      return {
        rows: null,
        status: {
          readable: false,
          reason: MISSING_FUNCTION_CODES.has(code)
            ? "public.house_beverage_ledger is not on this database yet — migration 20260903120000_the_house_s_own_record.sql has not been applied here. This house's own record is unread, not empty."
            : error.message,
          rows: null,
        },
      };
    }

    const rows = (data ?? []) as LedgerRow[];
    return {
      rows,
      status: { readable: true, reason: null, rows: rows.length },
    };
  }

  /**
   * One register, whole: the house's own rows with their record, then the
   * shared catalogue rows nobody here has touched.
   *
   * Both reads are issued together and BOTH failures are survivable. A register
   * whose catalogue read failed still shows the house's twelve real bottles; a
   * register whose ledger read failed still shows the catalogue and says the
   * record could not be read. Neither failure is allowed to produce an empty
   * list that reads as "there is nothing here".
   */
  async readRegister(
    restaurantId: string,
    register: RegisterId,
    opts: { search?: string; catalogueLimit: number; ledgerLimit: number },
  ): Promise<RegisterResult & { unregistered: { label: string; books: string[] }[] }> {
    const types = beverageTypesForRegister(register);

    const [catalogue, ledger] = await Promise.all([
      this.readRegisterCatalogue(register, types, opts),
      this.readHouseLedger(restaurantId, opts.ledgerLimit),
    ]);

    const result = composeRegister({
      restaurantId,
      register,
      ledger: ledger.rows,
      ledgerStatus: ledger.status,
      ledgerTruncated: (ledger.status.rows ?? 0) >= opts.ledgerLimit,
      ledgerLimit: opts.ledgerLimit,
      catalogue: catalogue.rows,
      catalogueStatus: catalogue.status,
      catalogueTruncated: (catalogue.status.rows ?? 0) >= opts.catalogueLimit,
      catalogueLimit: opts.catalogueLimit,
      matchedTypes: types,
      // `soft_drinks` is the live case: no value of `beverage_type` separates a
      // cola from a kombucha, so this table cannot answer for it — and since
      // this pass the HOUSE's books can, which is why an empty catalogue no
      // longer means an empty register.
      servedByThisTable: types.length > 0,
    });

    // The search filters the ASSEMBLED register rather than either source, so
    // a house row and a catalogue row are searched by the same rule.
    const q = opts.search?.trim().toLowerCase();
    const rows = q
      ? result.rows.filter((r) =>
          [r.name, r.producer, r.catalogue?.beverageType, r.catalogue?.region, r.catalogue?.country]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(q),
        )
      : result.rows;

    const typeById = new Map<string, string | null>(
      (catalogue.rows ?? []).map((c) => [c.id, c.beverage_type]),
    );

    return {
      ...result,
      rows,
      counts: {
        ...result.counts,
        total: rows.length,
        houseRows: rows.filter((r) => r.house !== null).length,
        catalogueOnly: rows.filter((r) => r.house === null).length,
      },
      // Whole-ledger, not this register's slice: "how many of this house's own
      // lines can no register hold" is a question about the seven, not about
      // whichever one is open.
      unregistered: ledger.rows ? unregistered(ledger.rows, typeById) : [],
    };
  }

  private async readRegisterCatalogue(
    register: RegisterId,
    types: string[],
    opts: { catalogueLimit: number },
  ): Promise<{ rows: CatalogueRow[] | null; status: SourceStatus }> {
    if (types.length === 0) {
      // Not an empty result — the absence of a query. Said as such.
      return {
        rows: [],
        status: {
          readable: true,
          reason: `No value of beverages.beverage_type identifies ${register}, so the shared catalogue cannot answer for it. Every row in this register is this house's own.`,
          rows: 0,
        },
      };
    }

    const { data, error } = await this.dbService
      .getClient()
      .from("beverages")
      .select(CATALOGUE_COLUMNS)
      .is("superseded_by", null)
      .is("deleted_at", null)
      .in("beverage_type", types)
      .order("name", { ascending: true })
      .limit(opts.catalogueLimit);

    if (error) {
      this.logger.error(`Failed to read the ${register} catalogue: ${error.message}`);
      return {
        rows: null,
        status: {
          readable: false,
          reason: MISSING_RELATION_CODES.has(String((error as { code?: string }).code))
            ? "public.beverages is not on this database yet (migration not applied)"
            : error.message,
          rows: null,
        },
      };
    }

    const rows = (data ?? []) as unknown as CatalogueRow[];
    return { rows, status: { readable: true, reason: null, rows: rows.length } };
  }

  /* ── cocktails: the one register this house can actually write ─────────── */

  /**
   * `public.cocktails` is the ONLY one of these tables that carries a
   * `restaurant_id` (20260817090000_cocktails.sql:28), which is why CRUD lands
   * here and nowhere else in this module. A create endpoint over
   * `public.beverages` would be a tenant writing into a global reference
   * catalogue whose identity is decided by a database trigger — a second writer
   * for somebody else's table. That is refused, and the refusal is a sentence
   * on the page rather than a missing button.
   */
  async createCocktail(restaurantId: string, dto: CreateCocktailDto) {
    const { data, error } = await this.dbService
      .getClient()
      .from("cocktails")
      .insert({
        // The tenant comes from the guarded path parameter, never the body.
        restaurant_id: restaurantId,
        name: dto.name.trim(),
        display_name: dto.displayName?.trim() ?? null,
        menu_section: dto.menuSection?.trim() ?? null,
        method: dto.method?.trim() ?? null,
        glass: dto.glass?.trim() ?? null,
        garnish: dto.garnish?.trim() ?? null,
        price: dto.price ?? null,
        description: dto.description?.trim() ?? null,
        // Provenance, so a hand-entered row is never mistaken later for one the
        // extraction pipeline produced.
        source: "manual",
      })
      .select(
        "id, name, display_name, menu_section, method, glass, garnish, price, description, source, created_at",
      )
      .single();

    if (error) {
      this.logger.error(`Failed to create a cocktail: ${error.message}`);
      throw this.explain(error, "cocktails");
    }
    return data;
  }

  async updateCocktail(
    restaurantId: string,
    cocktailId: string,
    dto: UpdateCocktailDto,
  ) {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    // Only fields the caller actually sent. A PATCH that nulled every absent
    // field would erase a row's method and glass on a price edit.
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.displayName !== undefined) patch.display_name = dto.displayName?.trim() ?? null;
    if (dto.menuSection !== undefined) patch.menu_section = dto.menuSection?.trim() ?? null;
    if (dto.method !== undefined) patch.method = dto.method?.trim() ?? null;
    if (dto.glass !== undefined) patch.glass = dto.glass?.trim() ?? null;
    if (dto.garnish !== undefined) patch.garnish = dto.garnish?.trim() ?? null;
    if (dto.price !== undefined) patch.price = dto.price;
    if (dto.description !== undefined) patch.description = dto.description?.trim() ?? null;

    const { data, error } = await this.dbService
      .getClient()
      .from("cocktails")
      .update(patch)
      // The tenant filter is part of the WHERE, not only the guard: a uuid from
      // another house must miss, not update.
      .eq("id", cocktailId)
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null)
      .select(
        "id, name, display_name, menu_section, method, glass, garnish, price, description, source, updated_at",
      )
      .maybeSingle();

    if (error) {
      this.logger.error(`Failed to update cocktail ${cocktailId}: ${error.message}`);
      throw this.explain(error, "cocktails");
    }
    if (!data) {
      throw new Error(
        "No cocktail of this house has that id. Nothing was changed — a write that matched no row must not report success.",
      );
    }
    return data;
  }

  /**
   * Soft delete, for the same reason `user_mcp_connections` revokes softly: a
   * row that vanished is indistinguishable from a row that never existed, and
   * a cocktail that came off the list in September is a fact about the season.
   */
  async deleteCocktail(restaurantId: string, cocktailId: string) {
    const { data, error } = await this.dbService
      .getClient()
      .from("cocktails")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", cocktailId)
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();

    if (error) {
      this.logger.error(`Failed to retire cocktail ${cocktailId}: ${error.message}`);
      throw this.explain(error, "cocktails");
    }
    if (!data) {
      throw new Error(
        "No live cocktail of this house has that id. Nothing was retired.",
      );
    }
    return { id: data.id, retired: true as const };
  }

  /**
   * Replace one cocktail's recipe lines.
   *
   * `cocktail_ingredients` was created empty and has stayed empty because the
   * extraction pass over the scanned cocktail sections never ran
   * (20260817090000_cocktails.sql:20-25). That is a reason for the EXTRACTOR
   * not to have written rows; it was never a reason for a bartender to be
   * unable to. This is the first writer the table has ever had.
   *
   * Replace rather than merge: a recipe is one document, and a per-line diff
   * against a list a human just retyped invents an edit history nobody made.
   */
  async setCocktailIngredients(
    restaurantId: string,
    cocktailId: string,
    dto: SetCocktailIngredientsDto,
  ) {
    const client = this.dbService.getClient();

    // Ownership first, and read from the table rather than trusted from the
    // path: the ingredients table has no restaurant_id of its own, so this
    // lookup IS the tenancy check for the write below.
    const { data: owner, error: ownerError } = await client
      .from("cocktails")
      .select("id")
      .eq("id", cocktailId)
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null)
      .maybeSingle();
    if (ownerError) throw this.explain(ownerError, "cocktails");
    if (!owner) {
      throw new Error(
        "No live cocktail of this house has that id. No recipe line was written.",
      );
    }

    const { error: clearError } = await client
      .from("cocktail_ingredients")
      .delete()
      .eq("cocktail_id", cocktailId);
    if (clearError) throw this.explain(clearError, "cocktail_ingredients");

    if (dto.lines.length === 0) {
      return { cocktailId, lines: 0, recipesAvailable: true as const };
    }

    const { data, error } = await client
      .from("cocktail_ingredients")
      .insert(
        dto.lines.map((l, i) => ({
          cocktail_id: cocktailId,
          // `free_text` covers what no catalogue holds — "fresh lime juice",
          // "egg white" — and the CHECK constraint requires one of the three.
          free_text: l.freeText?.trim() ?? null,
          beverage_id: l.beverageId ?? null,
          wine_id: l.wineId ?? null,
          quantity: l.quantity ?? null,
          unit: l.unit?.trim() ?? null,
          sort_order: l.sortOrder ?? i,
        })),
      )
      .select("id");
    if (error) throw this.explain(error, "cocktail_ingredients");

    return {
      cocktailId,
      lines: (data ?? []).length,
      recipesAvailable: true as const,
    };
  }

  /** One cocktail's recipe lines, in the order the house recorded them. */
  async readCocktailIngredients(restaurantId: string, cocktailId: string) {
    const client = this.dbService.getClient();
    const { data: owner, error: ownerError } = await client
      .from("cocktails")
      .select("id")
      .eq("id", cocktailId)
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null)
      .maybeSingle();
    if (ownerError) throw this.explain(ownerError, "cocktails");
    if (!owner) {
      throw new Error("No live cocktail of this house has that id.");
    }

    const { data, error } = await client
      .from("cocktail_ingredients")
      .select("id, free_text, beverage_id, wine_id, quantity, unit, sort_order")
      .eq("cocktail_id", cocktailId)
      .order("sort_order", { ascending: true });
    if (error) throw this.explain(error, "cocktail_ingredients");

    const rows = data ?? [];
    return {
      cocktailId,
      rows,
      count: rows.length,
      // The table is no longer empty BY DESIGN — it is empty for this cocktail
      // until somebody writes the recipe. Those are different sentences and the
      // register renders them differently.
      writable: true as const,
    };
  }
}
