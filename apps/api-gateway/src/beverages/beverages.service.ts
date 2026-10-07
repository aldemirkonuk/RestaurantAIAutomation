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
import {
  composeBook,
  composeRowRecord,
  matchLine,
  num as seriesNum,
  str as seriesStr,
  unreadableBook,
  type BookRecord,
  type LedgerEntry,
  type RowRecord,
} from "./row-record";
import {
  readCurrentMenuLines,
  type CurrentMenuLines,
} from "../menus/current-menu-lines";
import type {
  CreateCocktailDto,
  SetCocktailIngredientsDto,
  UpdateCocktailDto,
} from "./dto/beverages.dto";
// The price register's one enforcement point (ADR 0117 addendum, 2026-09-05).
import {
  VENDOR_PRICE_OBSERVATIONS,
  scopePriceRegisterRead,
} from "../price-register/visibility";

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
 * and deliberately a MODULE-LEVEL const rather than a static class property.
 *
 * `scripts/check_read_columns_exist.py` resolves a module-level const and
 * checks every column in it against the migrations; it cannot resolve
 * `Class.COLUMNS`, and counts such a site as "a read nobody is checking"
 * against a ceiling. So the shape of this declaration is load-bearing, and
 * moving it onto the class would silently drop fourteen columns out of guard
 * coverage without changing a single character of the query.
 *
 * No headcount of the repo's unreadable sites is quoted here on purpose: an
 * earlier version of this comment named one, the neighbouring modules fixed
 * theirs the same afternoon, and the number was stale within the hour. Run
 * the guard for the current figure.
 */
const CATALOGUE_COLUMNS =
  "id, beverage_type, name, display_name, producer, brand, country, region, abv_pct, volume_ml, package_format, price_reference, identity_status, observed_at";

/**
 * The five books behind ONE row, read line by line rather than aggregated.
 *
 * Each is a module-level const for the same reason CATALOGUE_COLUMNS is:
 * `scripts/check_read_columns_exist.py` resolves a module-level const and
 * checks every column against the migrations. A read whose column list is
 * inlined at the call site is a read nobody is checking. The menu book's
 * columns are `CURRENT_MENU_LINE_COLUMNS`, beside the one current-menu read
 * (`menus/current-menu-lines.ts`).
 *
 * The invoice book (below). Its vendor is embedded through a NAMED foreign
 * key, and the name is load-bearing. `procurement_documents` and `providers`
 * are joined by two foreign keys: `procurement_documents.provider_id ->
 * providers` (`procurement_documents_provider_id_fkey`, the baseline) and
 * `providers.created_from_document_id -> procurement_documents` (migration
 * a_vendor_is_resolved_by_identity, the document a provider was born from).
 * With two paths a bare `providers(name)` makes PostgREST refuse the whole
 * read ("more than one relationship was found"), and every row record's
 * invoice book said "invoices unread" (2026-10-03 analytics walk, A-043). The
 * hint picks the vendor who billed us; the JSON key stays `providers`.
 *
 * `doc_number` is read because the ledger prints it as the line's note — the
 * invoice the line came from (A-044). Without it every note was null.
 */
const INVOICE_LINE_COLUMNS =
  "id, description, unit_price, line_total, qty_bottles, created_at, procurement_documents!inner(id, doc_type, doc_date, doc_number, restaurant_id, providers!procurement_documents_provider_id_fkey(name))";
const ORDER_LINE_COLUMNS =
  "id, wine_name, producer, quantity, quoted_unit_price, negotiated_unit_price, final_unit_price, procurement_orders!inner(id, requested_at, restaurant_id, providers(name))";
/**
 * No `providers(name)` embed here, and the absence is measured rather than an
 * oversight: `public.vendor_price_observations` carries NO foreign key at all
 * (verified 2026-09-03 — `pg_constraint` returns zero rows of `contype = 'f'`
 * for that relation), so PostgREST cannot resolve the relationship and the
 * whole read 400s with "Could not find a relationship". `house_beverage_ledger`
 * gets the vendor's name with an explicit SQL LEFT JOIN, which PostgREST has no
 * equivalent for. The vendor is therefore read from `vendor_name_raw` — the
 * name the observation itself recorded — and where that is null the ledger line
 * says the vendor is unknown rather than borrowing one.
 */
const QUOTE_COLUMNS =
  "id, product_name_raw, raw_price, normalized_unit_price, source_type, observed_at, vendor_name_raw, provider_id";
/**
 * The till book is the till's own record (ADR 0301 §1): every line of every
 * check that was not voided, read from `pos_checks.items`, plus the
 * `pos_unresolved_lines` rows that have no check behind them. Both functions
 * are in migration the_cellar_reads_the_tills_own_record and are the same
 * record `house_beverage_ledger`'s Sold and Taken sum, so a row's record and
 * its register cell cannot disagree about which lines were sold.
 * [CORRECTED 2026-10-05: too broad. The record and its cell read the same
 * till record, but they group names by different rules: the cell by
 * `beverage_house_key` in SQL, the record by `matchLine` below, the weaker
 * rule ROW_RECORD_MATCH_RULE states (row-record.ts:147). So a row's lines can
 * differ between the two. A line whose qty is not a number differs in amount
 * too: Taken counts it as qty 1 (the ledger's coalesce(qty, 1)) while this
 * record's total for it is null. Both rules are inherited from main (ADR 0301
 * §1, "Stated behaviours").]
 *
 * Q9 (founder 2026-09-22) wired live non-wine sales into the cellar heat map
 * by mining `pos_checks.items` here. That read sampled 200 unordered checks
 * and skipped every wine-flagged line, on the belief that a wine line already
 * had a path through the queue; a MAPPED line never enters the queue, so a
 * mapped rakı read "the till never rang it" (A-016). This read takes every
 * line, paged rather than sampled.
 * [CORRECTED 2026-10-05: "a MAPPED line never enters the queue" was too
 * broad. PosHubService.applyStockEffects queues a mapped wine line whose
 * mapping names another house's item, or whose read of the house's items
 * failed, and one whose sale volume does not resolve (no_sale_volume). A
 * mapped line whose sale volume resolves against this house's own item never
 * enters it, and the rakı's lines had not. house_till_lines reads a queued
 * line from the queue only when no check is behind it.]
 */
const TILL_BOOK_SOURCE =
  "pos_checks.items (every line of every check not voided) + pos_unresolved_lines with no check behind them";

/**
 * One page of the till book. PostgREST stops a response at 1000 rows by
 * default, the same stop `readAll` pages past.
 */
export const TILL_PAGE_ROWS = 1000;

/**
 * How many lines the invoice, order and quote books of one row's record read.
 * The menu book and the till book are read whole.
 */
export const ROW_RECORD_LINE_LIMIT = 400;

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

  /* ── the record behind ONE row: the lines the aggregates were made of ──── */

  /**
   * Every line of this house's five books that names one product, in time
   * order, so a register column can be opened as a graph AND as a ledger.
   *
   * FIVE READS, FIVE SURVIVABLE FAILURES. Each book is read on its own and each
   * failure is reported as that book's own sentence. A row whose invoices could
   * not be read still shows what the till sold; it never shows an empty chart,
   * because an empty chart claims the price never moved, and that is a claim
   * about the vendor rather than about our books.
   *
   * TENANT SCOPE. Four of the five tables carry `restaurant_id` and are
   * filtered on it directly; `procurement_order_items` is filtered through its
   * order's `restaurant_id` with an inner join, exactly as
   * `house_beverage_ledger` does (migration 20260903120000:187-198), so a line
   * cannot arrive from another house by way of a null on the child row.
   */
  async readRowRecord(
    restaurantId: string,
    label: string,
  ): Promise<RowRecord> {
    const trimmed = label.trim();
    const [menu, invoice, order, quote, pos] = await Promise.all([
      this.readMenuLines(restaurantId, trimmed),
      this.readInvoiceLines(restaurantId, trimmed),
      this.readOrderLines(restaurantId, trimmed),
      this.readQuoteLines(restaurantId, trimmed),
      this.readTillLines(restaurantId, trimmed),
    ]);
    return composeRowRecord({
      restaurantId,
      label: trimmed,
      books: [menu, invoice, order, quote, pos],
    });
  }

  private failed(
    book: "menu" | "invoice" | "order" | "quote" | "pos",
    source: string,
    error: { message: string; code?: string },
  ): BookRecord {
    const code = String(error.code);
    this.logger.error(`row record ${book} read failed: ${error.message}`);
    return unreadableBook(
      book,
      source,
      MISSING_RELATION_CODES.has(code)
        ? `${source} is not on this database, so this book could not be read. Unread, not empty.`
        : error.message,
    );
  }

  /**
   * The menu book reads the CURRENT menu only (ADR 0193: `restaurant_menus`
   * `status = 'active'`), through the one read the cellar's registers use.
   * A house keeps every menu it reads, so a read of every `menu_items` row
   * counted the archived copy of the same menu too and printed each line
   * twice (A-028). The read is paged whole, so the old unordered 400-line
   * slice is gone from this book. A discarded line stays out (ADR 0160
   * sec110 item 7).
   */
  private async readMenuLines(
    restaurantId: string,
    label: string,
  ): Promise<BookRecord> {
    const source = "menu_items";
    let current: CurrentMenuLines;
    try {
      current = await readCurrentMenuLines(
        this.dbService.getClient(),
        restaurantId,
      );
    } catch (e) {
      return this.failed("menu", source, {
        message: e instanceof Error ? e.message : String(e),
      });
    }
    if (current.currentMenus === 0) {
      return composeBook({
        book: "menu",
        source,
        ledger: [],
        emptyReason:
          "This house has no current menu, so no line is on it. A menu that was read but never made current is kept, not listed here.",
      });
    }

    const ledger: LedgerEntry[] = [];
    for (const r of current.rows) {
      const line = [seriesStr(r.producer), seriesStr(r.name)]
        .filter(Boolean)
        .join(" ");
      const how = matchLine(label, line);
      if (how === null) continue;
      const bottle = seriesNum(r.bottle_price);
      const glass = seriesNum(r.by_glass_price);
      ledger.push({
        at: seriesStr(r.created_at),
        label: line,
        who: null,
        qty: null,
        unitPrice: bottle ?? glass,
        total: null,
        note:
          [
            seriesStr(r.category),
            glass === null ? null : `by the glass ${glass}`,
          ]
            .filter(Boolean)
            .join(" · ") || null,
        matchedBy: how,
      });
    }
    return composeBook({
      book: "menu",
      source,
      ledger,
      emptyReason:
        "This house's menu was read and does not list this line. Not listed is not the same as not sold.",
    });
  }

  private async readInvoiceLines(
    restaurantId: string,
    label: string,
  ): Promise<BookRecord> {
    const source = "procurement_document_lines";
    const { data, error } = await this.dbService
      .getClient()
      .from("procurement_document_lines")
      .select(INVOICE_LINE_COLUMNS)
      .eq("restaurant_id", restaurantId)
      .eq("procurement_documents.doc_type", "invoice")
      .limit(ROW_RECORD_LINE_LIMIT);
    if (error) return this.failed("invoice", source, error);

    const ledger: LedgerEntry[] = [];
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      const line = seriesStr(r.description) ?? "";
      const how = matchLine(label, line);
      if (how === null) continue;
      const doc = (r.procurement_documents ?? null) as Record<
        string,
        unknown
      > | null;
      const provider = (doc?.providers ?? null) as Record<
        string,
        unknown
      > | null;
      ledger.push({
        // The invoice's own date, never the row's insert time: what we were
        // charged happened when the vendor says it did.
        at: seriesStr(doc?.doc_date) ?? seriesStr(r.created_at),
        label: line,
        who: seriesStr(provider?.name),
        qty: seriesNum(r.qty_bottles),
        unitPrice: seriesNum(r.unit_price),
        total: seriesNum(r.line_total),
        note: seriesStr(doc?.doc_number),
        matchedBy: how,
      });
    }
    return composeBook({
      book: "invoice",
      source,
      ledger,
      emptyReason:
        "No invoice line in this house's books names this. Nothing has been charged for it that we have a document of — which is not the same as nothing having been paid.",
    });
  }

  private async readOrderLines(
    restaurantId: string,
    label: string,
  ): Promise<BookRecord> {
    const source = "procurement_order_items";
    const { data, error } = await this.dbService
      .getClient()
      .from("procurement_order_items")
      .select(ORDER_LINE_COLUMNS)
      .eq("procurement_orders.restaurant_id", restaurantId)
      .limit(ROW_RECORD_LINE_LIMIT);
    if (error) return this.failed("order", source, error);

    const ledger: LedgerEntry[] = [];
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      const line = [seriesStr(r.producer), seriesStr(r.wine_name)]
        .filter(Boolean)
        .join(" ");
      const how = matchLine(label, line);
      if (how === null) continue;
      const ord = (r.procurement_orders ?? null) as Record<
        string,
        unknown
      > | null;
      const provider = (ord?.providers ?? null) as Record<
        string,
        unknown
      > | null;
      // The order's own precedence: what was finally agreed beats what was
      // negotiated beats what was quoted. Same order the ledger uses.
      const unit =
        seriesNum(r.final_unit_price) ??
        seriesNum(r.negotiated_unit_price) ??
        seriesNum(r.quoted_unit_price);
      ledger.push({
        at: seriesStr(ord?.requested_at),
        label: line,
        who: seriesStr(provider?.name),
        qty: seriesNum(r.quantity),
        unitPrice: unit,
        total: null,
        note: null,
        matchedBy: how,
      });
    }
    return composeBook({
      book: "order",
      source,
      ledger,
      emptyReason:
        "This house has never put this on a purchase order. An order is what we asked for; it is a different claim from what we were charged.",
    });
  }

  private async readQuoteLines(
    restaurantId: string,
    label: string,
  ): Promise<BookRecord> {
    const source = "vendor_price_observations";
    // `houseOwnRowsOnly`, not `houseAndOpenMarket`: this is the HOUSE'S OWN
    // record of what it was quoted. A scraped public list price is not a quote
    // this house was given, and folding the open market into this book would
    // put a number nobody said to them in their own ledger.
    const { data, error } = await scopePriceRegisterRead(
      this.dbService
        .getClient()
        .from("vendor_price_observations")
        .select(QUOTE_COLUMNS),
      VENDOR_PRICE_OBSERVATIONS,
      { kind: "houseOwnRowsOnly", restaurantId },
    ).limit(ROW_RECORD_LINE_LIMIT);
    if (error) return this.failed("quote", source, error);

    const ledger: LedgerEntry[] = [];
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      const line = seriesStr(r.product_name_raw) ?? "";
      const how = matchLine(label, line);
      if (how === null) continue;
      ledger.push({
        at: seriesStr(r.observed_at),
        label: line,
        who: seriesStr(r.vendor_name_raw),
        qty: null,
        // The normalized unit price where the observation carries one, because
        // a case price and a bottle price on the same axis is not a series.
        unitPrice:
          seriesNum(r.normalized_unit_price) ?? seriesNum(r.raw_price),
        total: null,
        note: seriesStr(r.source_type),
        matchedBy: how,
      });
    }
    return composeBook({
      book: "quote",
      source,
      ledger,
      emptyReason:
        "No vendor has quoted this to this house. vendor_price_observations is scoped to the tenant here on purpose — a scraped public list price belongs to everyone and is not this house's quote.",
    });
  }

  /**
   * The till book: what the till rang up for this row, every line of it.
   *
   * THREE STEPS, so a row's record never carries the whole till across the
   * wire. (1) `house_till_names` lists the distinct names the till has rung.
   * (2) `matchLine` picks the names that belong to this row, here in the
   * gateway, so the rule is the same fold and contains-floor every other book
   * of this record uses (a second matcher in SQL would fold case differently,
   * e.g. the Turkish dotted İ under the C locale). (3) `house_till_lines`
   * reads every line under those names, each sent back exactly as step (1)
   * returned it (`rawTillName`). Both reads are keyset-paged on their
   * own unique column until a short page, so nothing is sampled and nothing is
   * capped. A failed read on either leaves the book unreadable, never zero.
   */
  private async readTillLines(
    restaurantId: string,
    label: string,
  ): Promise<BookRecord> {
    const source = TILL_BOOK_SOURCE;
    const client = this.dbService.getClient();
    const unread = (error: { message: string; code?: string }) => {
      if (!MISSING_FUNCTION_CODES.has(String(error.code))) {
        return this.failed("pos", source, error);
      }
      this.logger.error(`row record pos read failed: ${error.message}`);
      return unreadableBook(
        "pos",
        source,
        "The till's record (house_till_lines) is not on this database yet: migration the_cellar_reads_the_tills_own_record has not been applied here. Unread, not empty.",
      );
    };

    const names = await readTillPages("item_name", (after) => {
      const q = client.rpc("house_till_names", {
        p_restaurant_id: restaurantId,
      });
      return after === null ? q : q.gt("item_name", after);
    });
    if (names.error) return unread(names.error);

    // Keyed by the name exactly as house_till_names returned it, and sent back
    // that way. house_till_lines keeps a line only when btrim(name) =
    // ANY(p_names), and SQL btrim strips spaces only, while seriesStr's JS
    // trim() also strips a tab, a newline or a no-break space. A name sent
    // back JS-trimmed ('Zqtl Cola' for 'Zqtl Cola\t') would match none of its
    // lines. `matchLine` folds whitespace itself, so the raw name matches the
    // same way.
    const matched = new Map<string, "exact" | "contains">();
    for (const r of names.rows) {
      const name = rawTillName(r.item_name);
      if (name === null) continue;
      const how = matchLine(label, name);
      if (how !== null) matched.set(name, how);
    }

    const ledger: LedgerEntry[] = [];
    if (matched.size > 0) {
      const lines = await readTillPages("id", (after) => {
        const q = client.rpc("house_till_lines", {
          p_restaurant_id: restaurantId,
          p_names: [...matched.keys()],
        });
        return after === null ? q : q.gt("id", after);
      });
      if (lines.error) return unread(lines.error);

      for (const r of lines.rows) {
        const name = rawTillName(r.item_name);
        const how =
          name === null ? null : (matched.get(name) ?? matchLine(label, name));
        if (how === null) continue;
        // Shown trimmed; matched and fetched by the name the till holds.
        const line = seriesStr(name) ?? "";
        const qty = seriesNum(r.qty);
        const price = seriesNum(r.price);
        ledger.push({
          // When the check closed, else when it opened; a queue line with no
          // check behind it is dated when it was queued.
          at: seriesStr(r.sold_at),
          label: line,
          who: null,
          qty,
          unitPrice: price,
          total: qty !== null && price !== null ? qty * price : null,
          note: seriesStr(r.external_check_id),
          matchedBy: how,
        });
      }
    }

    return composeBook({
      book: "pos",
      source,
      ledger,
      emptyReason:
        "The till has not rung this up. Every line of every check that was not voided (pos_checks.items) was read, with the queued lines no check holds; none names this.",
    });
  }
}

/**
 * A till name exactly as house_till_names or house_till_lines returned it,
 * untrimmed: the functions' own btrim(name), which can still carry a tab or a
 * no-break space at its edge. It is the key that round-trips through
 * `p_names`; trim it only to show it.
 */
function rawTillName(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/**
 * Every row of one keyset-paged rpc. `build(after)` returns the call with its
 * cursor filter; this adds the order and the page size, and stops at a short
 * page. The rpc name stays a literal at the call site, where
 * `scripts/check_queried_tables_exist.py` can resolve it.
 */
async function readTillPages(
  key: string,
  build: (after: string | null) => {
    order: (
      col: string,
      o: { ascending: boolean },
    ) => {
      limit: (n: number) => PromiseLike<{
        data: unknown;
        error: { message: string; code?: string } | null;
      }>;
    };
  },
): Promise<{
  rows: Record<string, unknown>[];
  error: { message: string; code?: string } | null;
}> {
  const rows: Record<string, unknown>[] = [];
  let after: string | null = null;
  for (;;) {
    const { data, error } = await build(after)
      .order(key, { ascending: true })
      .limit(TILL_PAGE_ROWS);
    if (error) return { rows: [], error };
    const page = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < TILL_PAGE_ROWS) return { rows, error: null };
    after = String(page[page.length - 1][key]);
  }
}
