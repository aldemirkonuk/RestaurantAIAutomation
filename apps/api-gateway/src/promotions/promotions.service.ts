import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  VENDOR_PRICE_OBSERVATIONS,
  scopePriceRegisterRead,
} from "../price-register/visibility";
import { normalizeUnitPrice } from "../analytics/engine/vendor-price-consensus";
import {
  PRICE_SERIES_UNITS,
  gradeOffer,
  type LedgerLine,
  type OfferGrade,
  type WineBridge,
} from "./offer-grade";

/**
 * The house's offers, graded against its own ledger — the read behind the
 * rebuilt `/promotions` (ADR 0133 new-pages wave, 2026-09-11).
 *
 * WHY A NEW MODULE BESIDE `providers/provider-intelligence.*`
 * -----------------------------------------------------------
 * `GET /providers/promotions/active` read `provider_promotions` with NO
 * restaurant clause (`provider-intelligence.service.ts:165-179`, measured
 * 2026-09-11): every house's offers, with vendor names, to any signed-in
 * account. That read is now scoped in place. This module is the page's own
 * read because the page needs three things that route never had — the
 * house's dismissal (a column, `20260911160000`), the expiry state as a word,
 * and the grade — and one read that carries all of them with one `read_at`.
 *
 * HONESTY (ADR 0020 / 0051)
 * -------------------------
 * Every read here checks `error` and THROWS with the register's name in the
 * sentence; the controller turns that into a 500 whose message the page
 * prints. Nothing returns `[]` over a failed read. A ledger with no lines is
 * reported as a count of zero WITH the window it counted over, so the page can
 * say "no invoice in the last 540 days" rather than "no comparable purchase".
 *
 * UNITS AND MONEY
 * ---------------
 * `price_history` rows are grouped by `unit` (and `currency`) before anything
 * compares them (ADR 0119 Q4; `check_price_history_reads_group_by_unit.py`).
 * A register sighting becomes a comparable line ONLY when its pack size and
 * bottle volume are stated, and then through `normalizeUnitPrice` — the one
 * converter the register allows — with the derivation kept on the line.
 */

/** How far back the ledger is read. Stated on the wire so the page can print it. */
export const LEDGER_WINDOW_DAYS = 540;

/** The one place a house-scoped read of `provider_promotions` is projected. */
const OFFER_COLUMNS =
  "id, provider_id, restaurant_id, name, promo_type, description, conditions, discount_value, applicable_wines, start_date, end_date, is_active, confidence, created_at, dismissed_at, dismissed_by, providers(id, name)";

const PAID_COLUMNS =
  "id, provider_id, master_wine_id, price, unit, currency, effective_date, source, master_wine_library(name, vintage)";

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
}

export interface LedgerSummaryDto {
  window_days: number;
  since: string;
  paid_lines: number;
  house_sightings: number;
  market_sightings: number;
  /** Register rows that could not become a comparable line (no pack size or volume, or an outlier). */
  skipped_sightings: number;
}

export interface PromotionsReadDto {
  read_at: string;
  offers: OfferDto[];
  ledger: LedgerSummaryDto;
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

interface PaidRow {
  id: string;
  provider_id: string | null;
  master_wine_id: string | null;
  price: number | string;
  unit: string;
  currency: string | null;
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

/** The offer's state, said as a word rather than left to the reader to infer. */
export function offerState(row: { end_date: string | null; dismissed_at: string | null }, today: string): OfferState {
  if (row.dismissed_at) return "dismissed";
  if (!row.end_date) return "undated";
  return row.end_date < today ? "passed" : "open";
}

@Injectable()
export class PromotionsService {
  private readonly logger = new Logger(PromotionsService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async readForHouse(
    restaurantId: string,
    opts: { includeDismissed?: boolean; now?: Date } = {},
  ): Promise<PromotionsReadDto> {
    const now = opts.now ?? new Date();
    const today = isoDate(now);
    const since = isoDate(new Date(now.getTime() - LEDGER_WINDOW_DAYS * 86_400_000));
    const db = this.databaseService.supabase;

    // 1. The offers — this house's, live, on the table unless asked for the put-away ones too.
    let offersQuery = db
      .from("provider_promotions")
      .select(OFFER_COLUMNS)
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true);
    if (!opts.includeDismissed) offersQuery = offersQuery.is("dismissed_at", null);
    const offersRes = await offersQuery.order("end_date", { ascending: true, nullsFirst: false });
    if (offersRes.error) {
      throw new Error(`The offers register (provider_promotions) could not be read: ${offersRes.error.message}`);
    }
    const offerRows = (offersRes.data ?? []) as unknown as OfferRow[];

    // 2. The vendors' names, for ledger lines that carry only an id.
    const providersRes = await db.from("providers").select("id, name").eq("restaurant_id", restaurantId);
    if (providersRes.error) {
      throw new Error(`The vendor roster (providers) could not be read: ${providersRes.error.message}`);
    }
    const providerName = new Map<string, string>();
    for (const p of (providersRes.data ?? []) as { id: string; name: string }[]) providerName.set(p.id, p.name);

    // 3. The bridge the extractor's wine names came over: restaurant_inventory.wine_name → master_wine_id.
    const bridgeRes = await db
      .from("restaurant_inventory")
      .select("wine_name, master_wine_id")
      .eq("restaurant_id", restaurantId)
      .limit(2000);
    if (bridgeRes.error) {
      throw new Error(`The shelf (restaurant_inventory) could not be read: ${bridgeRes.error.message}`);
    }
    const bridge: WineBridge[] = ((bridgeRes.data ?? []) as { wine_name: string | null; master_wine_id: string | null }[])
      .filter((r) => typeof r.wine_name === "string" && r.wine_name.trim())
      .map((r) => ({ name: r.wine_name as string, productKey: r.master_wine_id ?? null }));

    // 4. What the house PAID — price_history, this house, the window. Grouped by
    //    unit and currency before anything is compared (ADR 0119 Q4).
    const paidRes = await db
      .from("price_history")
      .select(PAID_COLUMNS)
      .eq("restaurant_id", restaurantId)
      .gte("effective_date", since)
      .order("effective_date", { ascending: false })
      .limit(2000);
    if (paidRes.error) {
      throw new Error(`The house's price series (price_history) could not be read: ${paidRes.error.message}`);
    }
    const paidByUnit = new Map<string, LedgerLine[]>();
    for (const r of (paidRes.data ?? []) as unknown as PaidRow[]) {
      const price = num(r.price);
      if (price == null) continue;
      if (!(PRICE_SERIES_UNITS as readonly string[]).includes(r.unit)) continue;
      const wine = one(r.master_wine_library);
      const productName = wine
        ? [wine.name, wine.vintage != null ? String(wine.vintage) : ""].join(" ").trim()
        : null;
      const line: LedgerLine = {
        kind: "paid",
        ref: `price_history:${r.id}`,
        providerId: r.provider_id ?? null,
        providerName: r.provider_id ? (providerName.get(r.provider_id) ?? null) : null,
        productKey: r.master_wine_id ?? null,
        productName,
        price,
        unit: r.unit,
        currency: r.currency ?? null,
        date: r.effective_date ?? null,
        source: r.source,
        scope: "house",
        note: null,
      };
      const key = `${line.unit}|${line.currency ?? "not recorded"}`;
      const group = paidByUnit.get(key) ?? [];
      group.push(line);
      paidByUnit.set(key, group);
    }
    const paid: LedgerLine[] = Array.from(paidByUnit.values()).flat();

    // 5. What was SEEN — the register, this house's rows plus the open market,
    //    through the one scoping function (ADR 0126/0128).
    const sightingsRes = await scopePriceRegisterRead(
      db.from(VENDOR_PRICE_OBSERVATIONS).select(SIGHTING_COLUMNS),
      VENDOR_PRICE_OBSERVATIONS,
      { kind: "houseAndOpenMarket", restaurantId },
    )
      .gte("observed_at", `${since}T00:00:00Z`)
      .order("observed_at", { ascending: false })
      .limit(2000);
    if (sightingsRes.error) {
      throw new Error(`The price register (vendor_price_observations) could not be read: ${sightingsRes.error.message}`);
    }
    const sightings: LedgerLine[] = [];
    let skippedSightings = 0;
    let houseSightings = 0;
    let marketSightings = 0;
    for (const r of (sightingsRes.data ?? []) as unknown as SightingRow[]) {
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
        productName: r.product_name_raw ?? null,
        price: Math.round(norm.unitPrice * 100) / 100,
        unit: "bottle",
        currency: r.currency ?? null,
        date: r.effective_date ?? (r.observed_at ? r.observed_at.slice(0, 10) : null),
        source: r.source_type,
        scope,
        note: `per 750 ml equivalent of ${price} ${r.currency ?? ""} for ${pack} × ${volume} ml — ${norm.note}`,
      });
    }

    const ledger: LedgerLine[] = [...paid, ...sightings];

    const offers: OfferDto[] = offerRows.map((row) => {
      const provider = one(row.providers);
      const wines = stringList(row.applicable_wines);
      const grade = gradeOffer(
        { id: row.id, providerId: row.provider_id, wines, discount: discountOf(row.discount_value) },
        ledger,
        bridge,
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
