import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { MenusService } from "../menus/menus.service";
import {
  VENDOR_PRICE_OBSERVATIONS,
  scopePriceRegisterRead,
} from "../price-register/visibility";
import { normalizeUnitPrice } from "../analytics/engine/vendor-price-consensus";
import {
  PRICE_SERIES_UNITS,
  bundleWorth,
  gradeOffer,
  type BundleWorth,
  type LedgerLine,
  type OfferGrade,
  type OfferMinimum,
  type WineBridge,
} from "./offer-grade";
import {
  indexMenu,
  indexShelf,
  menuCoverage,
  scopeOffer,
  type CurrentMenuLine,
  type MenuCoverage,
  type OfferScopeTag,
  type ShelfRow,
} from "./offer-scope";

/**
 * The house's offers, graded against its own ledger — the read behind
 * `/promotions` (sketch 113 direction B, ADR 0160 §113: "worth expressed as
 * size, seeing ten or more offers at once, bundles as a first-class thing").
 *
 * WHY A NEW MODULE BESIDE `providers/provider-intelligence.*`
 * -----------------------------------------------------------
 * `GET /providers/promotions/active` reads `provider_promotions` with NO
 * restaurant clause (`provider-intelligence.service.ts:165-179`): every
 * house's offers, with vendor names, to any signed-in account. That read is
 * a separate, pre-existing fault this module does not touch (see the build
 * doc's not_fixed — fixing five endpoints shared with `ProviderPromotionsPanel`
 * is a wider change than this page). **[corrected 2026-09-21: "the build
 * doc" was a scratch report never committed to this repo, so that pointer
 * resolved to nothing for the next reader. The record is now
 * `v3.0-TECH-DEBT.md`, "GET /providers/promotions/active reads every house's
 * vendor offers with no restaurant clause" (origin: follow-up chip
 * task_38bd6fbb).]** **[corrected 2026-09-25: that entry was never merged;
 * the fault itself is CLOSED on main by PR #416 (ADR 0147) — every
 * `ProviderIntelligenceService` promotions read now filters by the caller's
 * house (`v3.0-TECH-DEBT.md`, "Twelve `ProviderIntelligenceService` methods
 * read across every tenant — CLOSED 2026-09-25"). What PR #416 did not add is
 * a role gate on those routes; this module keeps its own owner/manager gate
 * (ADR 0124), see the controller.]** This module is the page's own read
 * because the page needs three things that route never had — the house's
 * dismissal (a column, `20260926160100`), the expiry state as a word, and
 * the grade — and one read that carries all of them with one `read_at`.
 *
 * HONESTY (ADR 0020 / 0051)
 * -------------------------
 * Every read here checks `error` and THROWS with the register's name in the
 * sentence; the controller turns that into a 500 whose message the page
 * prints. Nothing returns `[]` over a failed read. A ledger with no lines is
 * reported as a count of zero WITH the window it counted over, so the page can
 * say "no invoice in the last 540 days" rather than "no comparable purchase".
 *
 * UNITS, MONEY AND IDENTITY
 * -------------------------
 * `price_history` rows are grouped by `unit` (and `currency`, and — where
 * present — `identity_id`) before anything compares them (ADR 0119 Q4, ADR
 * 0117 Q25, ADR 0124 Q5). A register sighting becomes a comparable line ONLY
 * when its pack size and bottle volume are stated, and then through
 * `normalizeUnitPrice` — the one converter the register allows — with the
 * derivation kept on the line.
 *
 * ROLE (ADR 0124:357-362)
 * ------------------------
 * The controller gates this read to owner/manager, matching `/vendor-intel`:
 * "everything ... expos[ing] what a vendor quoted this house — its
 * negotiating position" carries the same role gate as the pricing column.
 * This read carries exactly that — the house's own landed cost, beside its
 * comparison across vendors — so it is not left open the way the legacy
 * `usePromotionsQueries.ts` reads were.
 */

/**
 * How far back the ledger is read. Stated on the wire so the page can print
 * it (ADR 0060: a window is a floor and an unknown is not a zero).
 *
 * NOT a founder decision — see the build doc's not_fixed. **[updated
 * 2026-09-19: it now is. Founder, "Lane answers batch 3" ~09:45Z,
 * founder-sketch-decisions-106-115.md:143 (corrected 2026-09-19 from a stale 140): "promos grade window = keep
 * trailing 540 days." The value is unchanged; only its status is — see ADR
 * 0165 Consequences.]** This value is
 * carried over from the unmerged `feat/mudavym-new-pages` WIP
 * (`offer-grade.ts`, 297fcec3) as the least-new-surface default, printed
 * rather than hidden, so nothing here is a silent assumption.
 */
export const LEDGER_WINDOW_DAYS = 540;

/** The one place a house-scoped read of `provider_promotions` is projected. */
const OFFER_COLUMNS =
  "id, provider_id, restaurant_id, name, promo_type, description, conditions, discount_value, applicable_wines, start_date, end_date, is_active, confidence, created_at, dismissed_at, dismissed_by, providers(id, name)";

/**
 * The shelf, as the grader's bridge AND the house-first scope read it
 * (`offer-scope.ts`): the name the extractor matched, the library wine, whether
 * the row is live, its classifier and whether its stock was ever counted.
 */
const SHELF_COLUMNS =
  "id, wine_name, master_wine_id, is_active, deleted_at, stock_live, threshold_min, last_counted_at, master_wine_library(beverage_kind)";

/**
 * PostgREST stops at 1000 rows without saying so (menus.service.ts `readLines`
 * says the same). The offers and the shelf are read in keyset pages of this
 * size so a long list is read whole, never silently cut (research-filters
 * F12). The two ledger reads keep their stated caps below instead, and the
 * wire says when a cap was reached.
 */
const PAGE_ROWS = 1000;

/** The ledger reads' caps — stated on the wire (`LedgerSummaryDto.caps`), never silent. */
export const PAID_LINES_CAP = 2000;
export const SIGHTINGS_CAP = 2000;

const PAID_COLUMNS =
  "id, provider_id, master_wine_id, identity_id, price, unit, currency, quantity, effective_date, source, master_wine_library(name, vintage)";

const SIGHTING_COLUMNS =
  "id, restaurant_id, provider_id, vendor_name_raw, master_wine_id, product_name_raw, source_type, observed_at, effective_date, raw_price, currency, pack_size, unit_volume_ml, is_outlier";

export type OfferState = "open" | "undated" | "passed" | "dismissed";

export interface OfferDto {
  id: string;
  provider_id: string;
  provider_name: string | null;
  name: string;
  promo_type: string;
  description: string | null;
  conditions: Record<string, unknown>;
  discount_value: Record<string, unknown>;
  applicable_wines: string[];
  start_date: string | null;
  end_date: string | null;
  confidence: number | null;
  created_at: string | null;
  dismissed_at: string | null;
  dismissed_by: string | null;
  /** Computed against `read_at`: on the table, no end date read, past its date, or put away. */
  state: OfferState;
  grade: OfferGrade;
  /**
   * Set only when `promo_type === 'bundle'` — the rollup sketch 113's
   * "bundles as their own shape" asks for (see `offer-grade.ts`'s
   * `bundleWorth` doc for the grading rule and its open half).
   */
  bundle: BundleWorth | null;
  /** Where the offer sits on the house-first ladder, and why (`offer-scope.ts`). */
  scope: OfferScopeTag;
}

export interface LedgerSummaryDto {
  window_days: number;
  since: string;
  paid_lines: number;
  house_sightings: number;
  market_sightings: number;
  /** Register rows that could not become a comparable line (no pack size or volume, or an outlier). */
  skipped_sightings: number;
  /**
   * The two ledger reads are capped (newest first). `reached` is true when a
   * read came back AT its cap, so older lines may exist that were not read —
   * the page says so rather than grade as if the window were whole.
   */
  caps: {
    paid_lines: { cap: number; reached: boolean };
    sightings: { cap: number; reached: boolean };
  };
}

/**
 * What the house-first ladder stood on for this read (founder item 36). The
 * page prints it: which menu "On my menu" means, how much of it could be seen,
 * and how much of the shelf was ever counted (the only rows "Running low" may
 * speak for).
 */
export interface HouseScopeDto {
  /** The house's CURRENT menus (status active). Empty = no menu read yet: the page opens on "Everything I stock". */
  menus: Array<{ menu_id: string; name: string | null; read_at: string | null }>;
  coverage: MenuCoverage;
  shelf: { rows: number; active: number; counted: number };
}

export interface PromotionsReadDto {
  read_at: string;
  offers: OfferDto[];
  ledger: LedgerSummaryDto;
  house: HouseScopeDto;
}

interface OfferRow {
  id: string;
  provider_id: string;
  restaurant_id: string;
  name: string;
  promo_type: string;
  description: string | null;
  conditions: Record<string, unknown> | null;
  discount_value: Record<string, unknown> | null;
  applicable_wines: unknown;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean | null;
  confidence: number | null;
  created_at: string | null;
  dismissed_at: string | null;
  dismissed_by: string | null;
  providers: { id: string; name: string } | { id: string; name: string }[] | null;
}

/**
 * The two counters are typed through a Record so no line here reads like a
 * write to the projected stock column (`check_no_direct_stock_writes.sh`
 * flags any `<column>:`); this module only READS them.
 */
type ShelfCounters = Record<"stock_live" | "threshold_min", number | string | null>;

interface ShelfDbRow extends ShelfCounters {
  id: string;
  wine_name: string | null;
  master_wine_id: string | null;
  is_active: boolean | null;
  deleted_at: string | null;
  last_counted_at: string | null;
  master_wine_library: { beverage_kind: string | null } | { beverage_kind: string | null }[] | null;
}

interface PaidRow {
  id: string;
  provider_id: string | null;
  master_wine_id: string | null;
  identity_id: string | null;
  price: number | string;
  unit: string;
  currency: string | null;
  quantity: number | string | null;
  effective_date: string | null;
  source: string;
  master_wine_library: { name: string; vintage: number | null } | { name: string; vintage: number | null }[] | null;
}

interface SightingRow {
  id: string;
  restaurant_id: string | null;
  provider_id: string | null;
  vendor_name_raw: string | null;
  master_wine_id: string | null;
  product_name_raw: string | null;
  source_type: string;
  observed_at: string | null;
  effective_date: string | null;
  raw_price: number | string;
  currency: string | null;
  pack_size: number | null;
  unit_volume_ml: number | null;
  is_outlier: boolean | null;
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function stringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function discountOf(dv: Record<string, unknown> | null) {
  const d = dv ?? {};
  return {
    percent: num(d.percent),
    amount: num(d.amount),
    currency: typeof d.currency === "string" && d.currency ? d.currency : null,
    freeShipping: d.free_shipping === true,
  };
}

/**
 * The offer's stated minimum order, from `conditions.min_qty` (the extractor
 * writes the number). `conditions.min_qty_unit` is read when present, but no
 * writer sets it yet, so today every stored minimum reads unit-less and
 * withholds the offer's worth — the grader says so rather than guess a unit.
 */
export function minimumOf(
  conditions: Record<string, unknown> | null,
  offerText: string | null = null,
): OfferMinimum | null {
  const c = conditions ?? {};
  const quantity = num(c.min_qty);
  if (quantity == null || !(quantity > 0)) return null;
  const unit = typeof c.min_qty_unit === "string" && c.min_qty_unit ? c.min_qty_unit : null;
  return { quantity, unit, mixed: saysMixed(c, offerText) };
}

/**
 * Does the OFFER say its minimum may be mixed across its wines (ADR 0165 open item 3)?
 * A stated flag first (`conditions.mixed` / `conditions.mixed_case`, which no
 * writer sets yet), then the offer's own words — its name, its summary and the
 * validity text the extractor kept — for a mixed-case phrase. Any negation
 * ("no mixed cases", "cannot be mixed", "not mixable") reads as NOT mixed.
 *
 * Conservative on purpose: a missed "mixed" only understates qualification
 * (per wine is the stricter reading), a false "mixed" would overstate it.
 */
const MIXED_PHRASE =
  /\b(mixed\s+(case|cases|order|orders|lot|lots|pallet|pallets)|mix[\s-]*(and|&|n|'n')[\s-]*match|(may|can)\s+be\s+mixed|mixing\s+(allowed|permitted|welcome))\b/i;
const MIXED_NEGATION = /\b(no|not|non|cannot|can't|never|without)[\s-]+(be\s+)?mix/i;

export function saysMixed(conditions: Record<string, unknown> | null, offerText: string | null): boolean {
  const c = conditions ?? {};
  if (c.mixed === true || c.mixed_case === true) return true;
  if (c.mixed === false || c.mixed_case === false) return false;
  const words = [offerText ?? "", typeof c.valid_text === "string" ? c.valid_text : ""].join(" \n ");
  if (MIXED_NEGATION.test(words)) return false;
  return MIXED_PHRASE.test(words);
}

/** The offer's state, said as a word rather than left to the reader to infer. */
export function offerState(row: { end_date: string | null; dismissed_at: string | null }, today: string): OfferState {
  if (row.dismissed_at) return "dismissed";
  if (!row.end_date) return "undated";
  return row.end_date < today ? "passed" : "open";
}

@Injectable()
export class PromotionsService {
  private readonly logger = new Logger(PromotionsService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly menusService: MenusService,
  ) {}

  /**
   * Every row of a house-scoped read, in keyset pages on `id` — a failed page
   * is an error naming the register, never a shorter list.
   */
  private async readAll<T extends { id: string }>(
    register: string,
    page: (after: string | null) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  ): Promise<T[]> {
    const out: T[] = [];
    let after: string | null = null;
    for (;;) {
      const { data, error } = await page(after);
      if (error) throw new Error(`${register} could not be read: ${error.message}`);
      const rows = (data ?? []) as T[];
      out.push(...rows);
      if (rows.length < PAGE_ROWS) break;
      after = rows[rows.length - 1].id;
    }
    return out;
  }

  async readForHouse(
    restaurantId: string,
    opts: { includeDismissed?: boolean; now?: Date } = {},
  ): Promise<PromotionsReadDto> {
    const now = opts.now ?? new Date();
    const today = isoDate(now);
    const since = isoDate(new Date(now.getTime() - LEDGER_WINDOW_DAYS * 86_400_000));
    const db = this.databaseService.supabase;

    // 1. The offers — this house's, live, on the table unless asked for the
    //    put-away ones too. Read whole (keyset pages), then ordered ends-soonest
    //    with undated last, as the single read used to return them.
    const offerRows = (
      await this.readAll<OfferRow>("The offers register (provider_promotions)", (after) => {
        let q = db
          .from("provider_promotions")
          .select(OFFER_COLUMNS)
          .eq("restaurant_id", restaurantId)
          .eq("is_active", true);
        if (!opts.includeDismissed) q = q.is("dismissed_at", null);
        if (after) q = q.gt("id", after);
        return q.order("id", { ascending: true }).limit(PAGE_ROWS);
      })
    ).sort((a, b) => {
      if (a.end_date === b.end_date) return a.id.localeCompare(b.id);
      if (a.end_date == null) return 1;
      if (b.end_date == null) return -1;
      return a.end_date.localeCompare(b.end_date);
    });

    // 2. The vendors' names, for ledger lines that carry only an id.
    const providersRes = await db.from("providers").select("id, name").eq("restaurant_id", restaurantId);
    if (providersRes.error) {
      throw new Error(`The vendor roster (providers) could not be read: ${providersRes.error.message}`);
    }
    const providerName = new Map<string, string>();
    for (const p of (providersRes.data ?? []) as { id: string; name: string }[]) providerName.set(p.id, p.name);

    // 3. The shelf: the bridge the extractor's wine names came over
    //    (restaurant_inventory.wine_name → master_wine_id) and the rows the
    //    house-first scope reads. Read whole — it used to stop at 2000 rows, a silent
    //    cap every rung's count would have inherited (research-filters F12).
    const shelfDb = await this.readAll<ShelfDbRow>("The shelf (restaurant_inventory)", (after) => {
      let q = db.from("restaurant_inventory").select(SHELF_COLUMNS).eq("restaurant_id", restaurantId);
      if (after) q = q.gt("id", after);
      return q.order("id", { ascending: true }).limit(PAGE_ROWS);
    });
    const named = shelfDb.filter((r) => typeof r.wine_name === "string" && r.wine_name.trim());
    const bridge: WineBridge[] = named.map((r) => ({ name: r.wine_name as string, productKey: r.master_wine_id ?? null }));
    const shelf: ShelfRow[] = named.map((r) => ({
      name: r.wine_name as string,
      productKey: r.master_wine_id ?? null,
      active: r.is_active !== false && r.deleted_at == null,
      kind: one(r.master_wine_library)?.beverage_kind ?? null,
      stockLive: num(r.stock_live),
      thresholdMin: num(r.threshold_min),
      lastCountedAt: r.last_counted_at ?? null,
    }));

    // 3b. The house's CURRENT menu(s) — active versions only, every line
    //     (MenusService pages them), several actives unioned (F1/F2).
    const current = await this.menusService.readCurrentMenus(restaurantId);
    const menuLines: CurrentMenuLine[] = current.lines.map((l) => ({
      id: String(l.id),
      menuId: l.menu_id,
      name: typeof l.name === "string" ? l.name : null,
      category: typeof l.category === "string" ? l.category : null,
      wineLibraryId: typeof l.wine_library_id === "string" && l.wine_library_id ? l.wine_library_id : null,
    }));
    const shelfIndex = indexShelf(shelf);
    const menuIndex = indexMenu(menuLines);

    // 4. What the house PAID — price_history, this house, the window. Grouped
    //    by unit, currency and identity before anything is compared (ADR
    //    0119 Q4, ADR 0117 Q25, ADR 0124 Q5) — `offer-grade.ts` does the
    //    grouping; this only reads the columns it needs to do it.
    const paidRes = await db
      .from("price_history")
      .select(PAID_COLUMNS)
      .eq("restaurant_id", restaurantId)
      .gte("effective_date", since)
      .order("effective_date", { ascending: false })
      .limit(PAID_LINES_CAP);
    if (paidRes.error) {
      throw new Error(`The house's price series (price_history) could not be read: ${paidRes.error.message}`);
    }
    const paidRows = (paidRes.data ?? []) as unknown as PaidRow[];
    const paid: LedgerLine[] = [];
    for (const r of paidRows) {
      const price = num(r.price);
      if (price == null) continue;
      if (!(PRICE_SERIES_UNITS as readonly string[]).includes(r.unit)) continue;
      const wine = one(r.master_wine_library);
      const productName = wine
        ? [wine.name, wine.vintage != null ? String(wine.vintage) : ""].join(" ").trim()
        : null;
      paid.push({
        kind: "paid",
        ref: `price_history:${r.id}`,
        providerId: r.provider_id ?? null,
        providerName: r.provider_id ? (providerName.get(r.provider_id) ?? null) : null,
        productKey: r.master_wine_id ?? null,
        identityId: r.identity_id ?? null,
        productName,
        price,
        unit: r.unit,
        currency: r.currency ?? null,
        date: r.effective_date ?? null,
        source: r.source,
        scope: "house",
        quantity: num(r.quantity),
        note: null,
      });
    }

    // 5. What was SEEN — the register, this house's rows plus the open market,
    //    through the one scoping function (ADR 0126/0128).
    const sightingsRes = await scopePriceRegisterRead(
      db.from(VENDOR_PRICE_OBSERVATIONS).select(SIGHTING_COLUMNS),
      VENDOR_PRICE_OBSERVATIONS,
      { kind: "houseAndOpenMarket", restaurantId },
    )
      .gte("observed_at", `${since}T00:00:00Z`)
      .order("observed_at", { ascending: false })
      .limit(SIGHTINGS_CAP);
    if (sightingsRes.error) {
      throw new Error(`The price register (vendor_price_observations) could not be read: ${sightingsRes.error.message}`);
    }
    const sightingRows = (sightingsRes.data ?? []) as unknown as SightingRow[];
    const sightings: LedgerLine[] = [];
    let skippedSightings = 0;
    let houseSightings = 0;
    let marketSightings = 0;
    for (const r of sightingRows) {
      const price = num(r.raw_price);
      const pack = r.pack_size ?? null;
      const volume = r.unit_volume_ml ?? null;
      if (price == null || r.is_outlier === true || !(pack && pack > 0) || !(volume && volume > 0)) {
        skippedSightings += 1;
        continue;
      }
      const norm = normalizeUnitPrice({
        price,
        sourceType: r.source_type as never,
        observedAt: r.observed_at ?? r.effective_date ?? new Date(0),
        packSize: pack,
        unitVolumeMl: volume,
      });
      if (norm.unitPrice == null) {
        skippedSightings += 1;
        continue;
      }
      const scope: LedgerLine["scope"] = r.restaurant_id ? "house" : "open_market";
      if (scope === "house") houseSightings += 1;
      else marketSightings += 1;
      sightings.push({
        kind: "sighting",
        ref: `vendor_price_observations:${r.id}`,
        providerId: r.provider_id ?? null,
        providerName:
          (r.provider_id ? providerName.get(r.provider_id) : undefined) ?? r.vendor_name_raw ?? null,
        productKey: r.master_wine_id ?? null,
        // The register carries no identity_id column (`vendor_price_
        // observations` was not part of the ADR 0124 Q5 backfill) — a
        // sighting can never be skipped for an identity mismatch, only ever
        // matched or not, on name/master_wine_id.
        identityId: null,
        productName: r.product_name_raw ?? null,
        price: Math.round(norm.unitPrice * 100) / 100,
        unit: "bottle",
        currency: r.currency ?? null,
        date: r.effective_date ?? (r.observed_at ? r.observed_at.slice(0, 10) : null),
        source: r.source_type,
        scope,
        // A sighting prices what was SEEN, not what was bought — it never
        // contributes to the purchase-rate figure `offer-grade.ts` sums for
        // `worth`.
        quantity: null,
        note: `per 750 ml equivalent of ${price} ${r.currency ?? ""} for ${pack} × ${volume} ml — ${norm.note}`,
      });
    }

    const ledger: LedgerLine[] = [...paid, ...sightings];

    const offers: OfferDto[] = offerRows.map((row) => {
      const provider = one(row.providers);
      const wines = stringList(row.applicable_wines);
      const grade = gradeOffer(
        {
          id: row.id,
          providerId: row.provider_id,
          wines,
          discount: discountOf(row.discount_value),
          minimum: minimumOf(row.conditions, [row.name, row.description].filter(Boolean).join(" \n ")),
        },
        ledger,
        bridge,
        LEDGER_WINDOW_DAYS,
        today,
      );
      return {
        id: row.id,
        provider_id: row.provider_id,
        provider_name: provider?.name ?? providerName.get(row.provider_id) ?? null,
        name: row.name,
        promo_type: row.promo_type,
        description: row.description ?? null,
        conditions: row.conditions ?? {},
        discount_value: row.discount_value ?? {},
        applicable_wines: wines,
        start_date: row.start_date ?? null,
        end_date: row.end_date ?? null,
        confidence: num(row.confidence),
        created_at: row.created_at ?? null,
        dismissed_at: row.dismissed_at ?? null,
        dismissed_by: row.dismissed_by ?? null,
        state: offerState(row, today),
        grade,
        bundle: row.promo_type === "bundle" ? bundleWorth(grade.wines) : null,
        scope: scopeOffer(wines, shelfIndex, menuIndex),
      };
    });

    return {
      read_at: now.toISOString(),
      offers,
      ledger: {
        window_days: LEDGER_WINDOW_DAYS,
        since,
        paid_lines: paid.length,
        house_sightings: houseSightings,
        market_sightings: marketSightings,
        skipped_sightings: skippedSightings,
        caps: {
          paid_lines: { cap: PAID_LINES_CAP, reached: paidRows.length >= PAID_LINES_CAP },
          sightings: { cap: SIGHTINGS_CAP, reached: sightingRows.length >= SIGHTINGS_CAP },
        },
      },
      house: {
        menus: current.menus.map((m) => ({ menu_id: m.menuId, name: m.name, read_at: m.readAt })),
        coverage: menuCoverage(menuLines),
        shelf: {
          rows: shelf.length,
          active: shelf.filter((r) => r.active).length,
          counted: shelf.filter((r) => r.active && r.lastCountedAt != null).length,
        },
      },
    };
  }

  /** Put an offer away for the whole house. Scoped to the caller's house; a foreign id is "not found". */
  async dismiss(
    restaurantId: string,
    userId: string,
    id: string,
    now: Date = new Date(),
  ): Promise<{ dismissed: true; dismissed_at: string }> {
    const stamp = now.toISOString();
    const { data, error } = await this.databaseService.supabase
      .from("provider_promotions")
      .update({ dismissed_at: stamp, dismissed_by: userId })
      .eq("id", id)
      .eq("restaurant_id", restaurantId)
      .select("id, dismissed_at")
      .maybeSingle();
    if (error) {
      throw new Error(`The offer could not be put away (provider_promotions): ${error.message}`);
    }
    if (!data) {
      throw new NotFoundException("No such offer on this house's table.");
    }
    this.logger.log(`Offer ${id} dismissed for restaurant ${restaurantId} by ${userId}`);
    return { dismissed: true, dismissed_at: (data as { dismissed_at: string }).dismissed_at ?? stamp };
  }

  /** Bring a put-away offer back to the table. */
  async restore(restaurantId: string, id: string): Promise<{ restored: true }> {
    const { data, error } = await this.databaseService.supabase
      .from("provider_promotions")
      .update({ dismissed_at: null, dismissed_by: null })
      .eq("id", id)
      .eq("restaurant_id", restaurantId)
      .select("id")
      .maybeSingle();
    if (error) {
      throw new Error(`The offer could not be restored (provider_promotions): ${error.message}`);
    }
    if (!data) {
      throw new NotFoundException("No such offer on this house's table.");
    }
    return { restored: true };
  }
}
