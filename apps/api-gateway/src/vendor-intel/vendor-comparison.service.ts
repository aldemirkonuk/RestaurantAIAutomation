import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { hashWineIdentity, wineDisplayLabel } from "./wine-identity";
import { isIso4217 } from "../common/iso-4217";
import {
  BelowAverageResult,
  ComparisonClass,
  ObservationRow,
  comparisonClassOf,
  priceBelowAverage,
} from "./price-below-average";
// The floor and the dispersion test are the SAME ones the other two writers
// use, imported rather than re-implemented. `vendor-site-sighting.ts`
// re-exports them from `procurement/own-paper-sighting.ts`, which is where the
// judgement and its reasoning live.
import {
  MIN_OUTLIER_SAMPLE,
  isOutlierAgainstPriors,
} from "./vendor-site-sighting";
import {
  ConsensusResult,
  PriceObservation,
  PriceSourceType,
  PriceTrend,
  normalizeUnitPrice,
  standardTrends,
  vendorPriceConsensus,
} from "../analytics/engine/vendor-price-consensus";
// The register's tenancy boundary, in one place (ADR 0117 addendum,
// 2026-09-05). Every read of `vendor_price_observations` in this file goes
// through it; `scripts/check_price_register_reads_are_scoped.py` fails CI for
// one that does not. The `.from()` above each call keeps the table's name as a
// STRING LITERAL on purpose: `check_read_columns_exist.py` pairs a literal
// `.from("t")` with the `.select(` that follows it, and a constant there would
// make every register read invisible to that guard.
import {
  VENDOR_PRICE_OBSERVATIONS,
  scopePriceRegisterRead,
} from "../price-register/visibility";

export interface VendorComparison {
  productKey: { masterWineId?: string; signatureHash?: string };
  productName: string | null;
  /**
   * Pooled across every comparison class. Kept exactly as it was — the
   * legacy `/vendor-prices` page (`VendorPriceCompare.tsx`) reads this field
   * and nothing here may change its shape. `consensusByClass` below is the
   * additive figure the Mudavym ladder uses instead (ADR 0160 §112, fork 1:
   * "Quoted to this house" and "Public pages" are two figures that never
   * average).
   */
  consensus: ConsensusResult;
  trends: PriceTrend[];
  /**
   * The same consensus math, run once per comparison class rather than once
   * pooled. A class with too few admitted rows to judge still gets an entry
   * (`vendorPriceConsensus` on an empty/short array already returns nulls and
   * says why, never a thrown error) — so a caller can print "not enough
   * quoted rows yet" for one class while another class has a real number.
   */
  consensusByClass: Record<string, ConsensusResult>;
  /**
   * The 7/30/90-day trend chips, run once per comparison class — the same
   * reason `consensusByClass` exists rather than one pooled `trends`. A trend
   * that blended a quoted-price movement with a public-page movement would
   * report the exact class-crossing the founder ruled out for the consensus
   * figure (ADR 0160 §112 fork 1); `trends` above stays pooled ONLY because
   * the legacy page reads it and its shape may not change.
   */
  trendsByClass: Record<string, PriceTrend[]>;
  /**
   * Every observation behind the ladder, for the "show your working" panel.
   * Additive fields carry what direction A's ladder needs — id to key rows
   * and open the sighting sheet, currency and trust tier per row (a bottle
   * quoted in two currencies must never average across them), the STORED
   * outlier verdict (never re-derived client-side, so the ladder agrees with
   * the write-time judgement `own-paper-sighting.ts` and
   * `outlier-rejudge.ts` keep current), the comparison class so the ladder
   * can badge and group without re-deriving it, and sourceRef so an
   * own-paper row (`receipt_verified:<orderId>` / `order_confirmed:<orderId>`)
   * can carry a link to the order/receipt it came from — fork 6(b), the
   * sighted A build. A hand-recorded row has no sourceRef, which is the
   * signal the ladder prints "No paper attached" on rather than a broken
   * link.
   */
  observations: Array<{
    id: string;
    vendorName: string | null;
    providerId: string | null;
    sourceType: PriceSourceType;
    sourceUrl: string | null;
    sourceRef: string | null;
    comparisonClass: ComparisonClass;
    rawPrice: number;
    currency: string;
    trustTier: number | null;
    packSize: number;
    unitVolumeMl: number | null;
    observedAt: string;
    parseConfidence: number | null;
    isOutlier: boolean;
    outlierReason: string | null;
    /** The note recorded with this sighting, own-paper or hand-typed —
     * null when none was written. */
    note: string | null;
    identityId: string | null;
    /** The identity's own name (`beverage_identities.display_label`), best
     * effort — null when the row is unidentified or the label could not be
     * read; `identityId` is still returned either way, never swapped out. */
    identityLabel: string | null;
    /**
     * Per-750ml, pack- and yield-adjusted — the SAME `normalizeUnitPrice` the
     * consensus and the write-time outlier test both use, run once per row
     * here rather than re-implemented in the client. Null when the row
     * cannot be normalised (a non-positive pack, an out-of-range yield); the
     * ladder ranks a null last within its class rather than treating it as
     * free or infinite.
     */
    normalizedUnitPrice: number | null;
  }>;
  /**
   * False when the 500-row window this read is capped at (`loadObservations`)
   * was hit — the counts and consensus above are then a FLOOR, not a total,
   * the same rule `identity/candidates` and `identity/decisions` already
   * hold to.
   */
  complete: boolean;
  /**
   * How many days back `loadObservations` actually looked (365 by default,
   * `?windowDays=` otherwise) — silently dropping an older rung is a defect
   * this field exists so the page can state instead of hiding (ADR 0160
   * §112 review, minor: "the page never says the ladder covers the last N
   * days only").
   */
  windowDays: number;
}

/**
 * Vendor price comparison for one product.
 *
 * All the judgement — normalisation, outlier rejection, weighting, consensus —
 * is in the pure engine. This service only fetches rows and hands them over,
 * which is why the interesting behaviour is unit-tested without a database.
 */
@Injectable()
export class VendorComparisonService {
  private readonly logger = new Logger(VendorComparisonService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * The identity hash for a master-library wine, so observations that were
   * never resolved to an id still join the ladder.
   *
   * Without this the feature does not work end to end. A scrape writes
   * `signature_hash` and no `master_wine_id` — it read a name off a page, it
   * has no idea which library row that is. A user picks a wine and sends a
   * `master_wine_id`. Querying only the id returns nothing and the page says
   * "no usable price observations", which is indistinguishable from "no vendor
   * sells this" and is the reason the ladder looked permanently empty.
   *
   * A missing wine returns null rather than throwing: the caller still has a
   * valid master_wine_id to query on, and one missing library row should
   * narrow the answer, not fail the request.
   */
  private async resolveWine(
    masterWineId: string,
  ): Promise<{ identityHash: string | null; label: string | null }> {
    const { data, error } = await this.databaseService.supabase
      .from("master_wine_library")
      .select("producer, name, vintage")
      .eq("id", masterWineId)
      .maybeSingle();

    if (error) {
      this.logger.warn(
        `Could not resolve identity for master wine ${masterWineId}: ${error.message}`,
      );
      return { identityHash: null, label: null };
    }
    if (!data) return { identityHash: null, label: null };

    const row = data as {
      producer: string | null;
      name: string | null;
      vintage: number | null;
    };
    return {
      identityHash: hashWineIdentity(row),
      label: wineDisplayLabel(row),
    };
  }

  /**
   * Load observations for a product.
   *
   * A scraped list price is market intelligence that belongs to everyone;
   * restricting the ladder to rows this tenant happened to generate would make
   * a vendor look absent simply because this restaurant has never bought from
   * them. So the openly posted rows are always in, and this house's own rows
   * (invoices, negotiated quotes) are added on top when a restaurantId is
   * supplied.
   *
   * CHANGED 2026-09-05 (ADR 0117 addendum): with no restaurantId this read used
   * to apply NO tenancy clause at all, which is not "the market" -- it is every
   * house's private paper. The docblock above it said "deliberately not scoped",
   * which was true of the intent and false of the effect. It is now
   * `openMarketOnly`. The only caller (line 523) always passes a restaurantId,
   * so nothing on any screen changes; what changes is that the branch which
   * could have leaked no longer exists.
   */
  private async loadObservations(params: {
    masterWineId?: string;
    signatureHash?: string;
    identityHash?: string | null;
    restaurantId?: string | null;
    windowDays?: number;
  }) {
    const {
      masterWineId,
      signatureHash,
      restaurantId,
      windowDays = 365,
    } = params;

    // The scope is decided FIRST, before the query exists, so there is no
    // branch in which a query is built and then not scoped. A read with no
    // house named is the openly posted rows only -- never everything.
    let q = scopePriceRegisterRead(
      this.databaseService.supabase
        .from("vendor_price_observations")
        .select(
          "id, provider_id, vendor_name_raw, product_name_raw, source_type, source_url, source_ref, raw_price, currency, trust_tier, pack_size, unit_volume_ml, yield_factor, parse_confidence, observed_at, is_outlier, outlier_reason, identity_id, raw",
        ),
      VENDOR_PRICE_OBSERVATIONS,
      restaurantId
        ? { kind: "houseAndOpenMarket", restaurantId }
        : { kind: "openMarketOnly" },
    )
      .gte(
        "observed_at",
        new Date(Date.now() - windowDays * 86_400_000).toISOString(),
      )
      .order("observed_at", { ascending: false })
      .limit(500);

    // Match on either key. An observation resolved to a library row and one
    // that only ever knew a name are the same bottle, and ranking them apart
    // is the bug this replaces. Separate `.or()` calls are ANDed by PostgREST,
    // which is what we want: (product) AND (tenant scope) AND (not contributed).
    const identityHash = params.identityHash ?? signatureHash ?? null;

    const keys: Array<[column: string, value: string]> = [];
    if (masterWineId) keys.push(["master_wine_id", masterWineId]);
    if (identityHash) keys.push(["signature_hash", identityHash]);
    if (signatureHash && signatureHash !== identityHash) {
      keys.push(["signature_hash", signatureHash]);
    }

    if (keys.length === 1) {
      // A single key goes through .eq() rather than a one-clause .or(): .eq()
      // parameterises the value, while .or() interpolates it into a filter
      // string. Both keys here are server-derived (a UUID we already validated,
      // or a hex hash we computed), but the narrower path is still the right
      // default for the common case.
      q = q.eq(keys[0][0], keys[0][1]);
    } else if (keys.length > 1) {
      q = q.or(keys.map(([col, val]) => `${col}.eq.${val}`).join(","));
    }

    const { data, error } = await q;
    if (error) {
      // Rethrow rather than returning an empty ladder: "no vendor sells this"
      // and "the query failed" must not look identical, which is the same
      // mistake distributor search made.
      this.logger.error(
        `Failed to load vendor price observations: ${error.message}`,
      );
      // 22P02 is Postgres for "that text is not a uuid". It is caused by what
      // the caller typed, not by anything being broken, so it must not be a
      // 500 — a 500 tells the user to report an outage when the actual fix is
      // to enter a different value. The controller validates first; this is
      // the backstop for any other path into the service.
      if ((error as { code?: string }).code === "22P02") {
        throw new BadRequestException(
          "That product identifier is not a valid id. Pick a wine from the list rather than typing a name.",
        );
      }
      throw new InternalServerErrorException(
        `Could not load vendor price observations: ${error.message}`,
      );
    }
    return data ?? [];
  }

  /**
   * Record a price a person was told.
   *
   * Lives here rather than in the extractor because the hard part is not the
   * insert — it is deriving the identity key so the row lands in the same
   * ladder as the scraped ones, and `resolveWine` is what does that.
   *
   * Trust tier is derived from sourceType, never accepted from the caller. The
   * whole consensus rests on sources being weighted by how believable they
   * are; a caller that can assert its own tier can put a guess above an
   * invoice, and the resulting number looks exactly as confident as a real one.
   */
  async recordManualObservation(params: {
    masterWineId?: string;
    productName?: string;
    producer?: string;
    vintage?: number;
    providerId?: string;
    vendorName?: string;
    price: number;
    packSize?: number;
    unitVolumeMl?: number;
    sourceType?: "quote" | "chat" | "social" | "manual";
    sourceUrl?: string;
    observedAt?: string;
    note?: string;
    restaurantId: string;
    userId?: string;
    currency?: string;
  }) {
    const sourceType = params.sourceType ?? "manual";
    const TRUST_BY_SOURCE: Record<string, number> = {
      quote: 2,
      chat: 5,
      social: 6,
      manual: 7,
    };

    // Checked here rather than in the DTO so the message can be specific
    // (`common/iso-4217.ts#isIso4217` — real membership, not "three capital
    // letters"). A caller that sends nothing keeps the long-standing USD
    // default (the legacy page never sends this field); a caller that sends
    // something wrong is refused rather than silently filed under a code
    // that is not a currency.
    let currency = "USD";
    if (params.currency !== undefined && params.currency !== null) {
      const trimmed = String(params.currency).trim().toUpperCase();
      if (!isIso4217(trimmed)) {
        throw new BadRequestException(
          `"${params.currency}" is not a currency code. Use the ISO 4217 code the price was actually quoted in (e.g. USD, TRY, EUR).`,
        );
      }
      currency = trimmed;
    }

    const wine = params.masterWineId
      ? await this.resolveWine(params.masterWineId)
      : { identityHash: null, label: null };

    // Fall back to what the user typed when no library wine was picked, so an
    // off-catalogue bottle is still comparable against other observations of
    // the same off-catalogue bottle.
    const identityHash =
      wine.identityHash ??
      hashWineIdentity({
        producer: params.producer,
        name: params.productName,
        vintage: params.vintage,
      });

    if (!params.masterWineId && !identityHash) {
      throw new BadRequestException(
        "Provide masterWineId, or a productName so the price can be matched to other observations of the same wine.",
      );
    }

    let observedAt = new Date().toISOString();
    if (params.observedAt) {
      const parsed = new Date(params.observedAt);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException("observedAt is not a valid date.");
      }
      // A future observation would be weighted as maximally recent forever.
      if (parsed.getTime() > Date.now() + 86_400_000) {
        throw new BadRequestException("observedAt cannot be in the future.");
      }
      observedAt = parsed.toISOString();
    }

    // SCREENED AT WRITE TIME, exactly like the other two writers.
    //
    // Until 2026-09-04 this was the ONE writer that still let `is_outlier` take
    // its column DEFAULT of false — i.e. every hand-typed price entered the
    // ladder pre-certified as clean, which is precisely the fault ADR 0117
    // named when it said the column "has no writer anywhere". A typed price is
    // the LEAST-provenanced row in the register (trust tier 7, and
    // `parse_confidence` is deliberately null because nothing parsed it), so it
    // is the last row that should be exempt from the test the tier-1 invoices
    // and tier-4 scrapes both take.
    //
    // The test is `isOutlierAgainstPriors` — `flagOutliers` at 3.5 robust
    // deviations — over the sightings of the SAME product in the SAME
    // comparison class, and it is never a bound: no typed number is clamped,
    // rounded, rejected or refused for being extreme. The row is written
    // exactly as entered; a flag only keeps it out of the "cheaper than usual"
    // ladder, stays visible, and the nightly re-judge clears it if later
    // evidence proves it ordinary (`outlier-rejudge.ts`).
    //
    // Below `MIN_OUTLIER_SAMPLE` comparable priors nothing is flagged at all,
    // and the reason SAYS the row was not judged rather than saying it is
    // clean.
    const candidateUnitPrice = normalizeUnitPrice({
      price: params.price,
      sourceType: sourceType as PriceSourceType,
      observedAt,
      packSize: params.packSize ?? 1,
      unitVolumeMl: params.unitVolumeMl ?? undefined,
      yieldFactor: 1,
    }).unitPrice;

    const priors =
      candidateUnitPrice === null
        ? []
        : await this.priorUnitPricesInClass({
            restaurantId: params.restaurantId,
            masterWineId: params.masterWineId ?? null,
            signatureHash: identityHash,
            sourceClass: comparisonClassOf(sourceType),
          });

    const judged =
      candidateUnitPrice !== null && priors.length + 1 >= MIN_OUTLIER_SAMPLE;
    const isOutlier = judged
      ? isOutlierAgainstPriors(priors, candidateUnitPrice as number)
      : false;
    const judgedAt = new Date().toISOString();
    const outlierReason = !judged
      ? candidateUnitPrice === null
        ? `Not judged: the pack and volume given do not support a comparable unit price, so there is no number to test. The row is stored as entered; it is not claimed to be clean.`
        : `Not judged: only ${priors.length} comparable sighting(s) of this product exist in its class, below the floor of ${MIN_OUTLIER_SAMPLE} at which a deviation test means anything. The row is stored as entered; it is not claimed to be clean.`
      : isOutlier
        ? `Flagged at write time against ${priors.length} earlier sighting(s) of this product in the same comparison class: it sits more than 3.5 robust deviations from their median. The price is stored exactly as entered and stays visible; it is kept out of the "cheaper than usual" ladder until it is corrected at source or the nightly re-judge clears it.`
        : `Judged clean at write time against ${priors.length} earlier sighting(s) of this product in the same comparison class.`;

    const { data, error } = await this.databaseService.supabase
      .from("vendor_price_observations")
      .insert({
        // Tenant-scoped on purpose. A scraped list price is public market
        // intelligence; a price a rep quoted this restaurant is a negotiating
        // position and must not leak into another tenant's ladder.
        restaurant_id: params.restaurantId,
        provider_id: params.providerId ?? null,
        vendor_name_raw: params.vendorName ?? null,
        master_wine_id: params.masterWineId ?? null,
        signature_hash: identityHash,
        product_name_raw: params.productName ?? wine.label ?? null,
        source_type: sourceType,
        trust_tier: TRUST_BY_SOURCE[sourceType],
        source_url: params.sourceUrl ?? null,
        observed_at: observedAt,
        raw_price: params.price,
        currency,
        pack_size: params.packSize ?? 1,
        unit_volume_ml: params.unitVolumeMl ?? null,
        // Null, not 1. parse_confidence answers "how well did we read this",
        // and nothing was parsed — a human asserted it. Claiming 1.0 would
        // make a typed number the best-parsed row in the ladder.
        parse_confidence: null,
        is_outlier: isOutlier,
        outlier_reason: outlierReason,
        outlier_basis: "write_time",
        outlier_judged_at: judgedAt,
        raw: {
          enteredBy: params.userId ?? null,
          note: params.note ?? null,
          producer: params.producer ?? null,
          vintage: params.vintage ?? null,
        },
      })
      .select("id, observed_at")
      .single();

    if (error) {
      this.logger.error(
        `Failed to record manual observation: ${error.message}`,
      );
      throw new InternalServerErrorException(
        `Could not record the observation: ${error.message}`,
      );
    }

    return {
      id: (data as any).id,
      observedAt: (data as any).observed_at,
      // Returned so the caller that just typed the price is TOLD it was set
      // aside, rather than discovering later that it never reached the ladder.
      isOutlier,
      outlierReason,
    };
  }

  /**
   * The comparable unit prices already on the register for this product, in
   * one comparison class.
   *
   * SCOPE matches `belowTrailingAverage`: market rows (`restaurant_id IS
   * NULL`) plus this house's own, never another house's negotiating position.
   * CLASS matches ADR 0117's closing rule — a quote is only ever set beside
   * another quote — so a tier-4 public-site price can never make a quoted one
   * look deviant.
   *
   * A read failure returns an EMPTY list, which puts the group below
   * `MIN_OUTLIER_SAMPLE` and therefore flags nothing. A register we could not
   * read is not a register that agrees with the number being typed.
   */
  private async priorUnitPricesInClass(args: {
    restaurantId: string;
    masterWineId: string | null;
    signatureHash: string | null;
    sourceClass: ReturnType<typeof comparisonClassOf>;
  }): Promise<number[]> {
    if (!args.masterWineId && !args.signatureHash) return [];
    try {
      let q = scopePriceRegisterRead(
        this.databaseService.supabase
          .from("vendor_price_observations")
          .select(
            "raw_price, source_type, observed_at, pack_size, unit_volume_ml, yield_factor",
          ),
        VENDOR_PRICE_OBSERVATIONS,
        { kind: "houseAndOpenMarket", restaurantId: args.restaurantId },
      )
        .order("observed_at", { ascending: false })
        .limit(200);
      q = args.masterWineId
        ? q.eq("master_wine_id", args.masterWineId)
        : q.eq("signature_hash", args.signatureHash as string);

      const { data, error } = await q;
      if (error) throw new Error(error.message);

      const out: number[] = [];
      for (const r of (data ?? []) as any[]) {
        if (comparisonClassOf(r.source_type) !== args.sourceClass) continue;
        const { unitPrice } = normalizeUnitPrice({
          price: Number(r.raw_price),
          sourceType: r.source_type as PriceSourceType,
          observedAt: r.observed_at,
          packSize: Number(r.pack_size) || 1,
          unitVolumeMl: r.unit_volume_ml ?? undefined,
          yieldFactor: Number(r.yield_factor) || 1,
        });
        if (unitPrice !== null && Number.isFinite(unitPrice)) out.push(unitPrice);
      }
      return out;
    } catch (e: any) {
      this.logger.warn(
        `Could not read the price register to screen a typed price for outliers: ${e?.message}. Nothing was flagged, and nothing is claimed to be clean.`,
      );
      return [];
    }
  }

  /**
   * "What is cheaper now than it has lately been" — the whole tenant at once.
   *
   * `compare()` answers for ONE product the caller already knows the id of.
   * This answers the question /notifications asks, which is the other way
   * round: nobody types a wine in, the house is supposed to notice. So the
   * window is swept once and the products are ranked.
   *
   * TENANT SCOPE matches `loadObservations`: market rows (`restaurant_id IS
   * NULL`) are public list prices that belong to everyone, and this tenant's
   * own invoices and quotes are added on top. Another restaurant's rows are
   * never read.
   *
   * `is_outlier` rows are excluded here rather than in the pure function:
   * outlier-ness is decided by the consensus pass over the whole group, so
   * re-deciding it per window would contradict the stored verdict.
   *
   * A failed query THROWS. "Nothing is below its average" and "the register
   * could not be read" must not render as the same empty box — that is the
   * defect this page's rebuild exists to remove.
   */
  async belowTrailingAverage(params: {
    restaurantId: string;
    windowDays?: number;
    minObservations?: number;
    limit?: number;
  }): Promise<BelowAverageResult & { window: { days: number; from: string } }> {
    const windowDays = params.windowDays ?? 30;
    const from = new Date(Date.now() - windowDays * 86_400_000).toISOString();

    const { data, error } = await scopePriceRegisterRead(
      this.databaseService.supabase
        .from("vendor_price_observations")
        .select(
          "identity_id, master_wine_id, signature_hash, product_name_raw, vendor_name_raw, provider_id, source_type, observed_at, raw_price, currency, pack_size, unit_volume_ml, yield_factor",
        ),
      VENDOR_PRICE_OBSERVATIONS,
      { kind: "houseAndOpenMarket", restaurantId: params.restaurantId },
    )
      .gte("observed_at", from)
      .eq("is_outlier", false)
      .order("observed_at", { ascending: true })
      .limit(2000);

    if (error) {
      this.logger.error(
        `Failed to sweep vendor price observations: ${error.message}`,
      );
      throw new InternalServerErrorException(
        `Could not read the price register: ${error.message}`,
      );
    }

    const result = priceBelowAverage((data ?? []) as ObservationRow[], {
      minObservations: params.minObservations,
      limit: params.limit,
    });
    return { ...result, window: { days: windowDays, from } };
  }

  async compare(params: {
    masterWineId?: string;
    signatureHash?: string;
    restaurantId?: string | null;
    windowDays?: number;
  }): Promise<VendorComparison> {
    const wine = params.masterWineId
      ? await this.resolveWine(params.masterWineId)
      : { identityHash: null, label: null };

    const rows = await this.loadObservations({
      ...params,
      identityHash: wine.identityHash,
    });

    const observations: PriceObservation[] = rows.map((r: any) => ({
      price: Number(r.raw_price),
      sourceType: r.source_type as PriceSourceType,
      observedAt: r.observed_at,
      packSize: r.pack_size ?? 1,
      unitVolumeMl: r.unit_volume_ml ?? undefined,
      yieldFactor: r.yield_factor ? Number(r.yield_factor) : 1,
      parseConfidence:
        r.parse_confidence === null || r.parse_confidence === undefined
          ? undefined
          : Number(r.parse_confidence),
      vendorId: r.provider_id ?? null,
      vendorName: r.vendor_name_raw ?? null,
      currency: r.currency ?? "USD",
    }));

    // Direction A (ADR 0160 §112, fork 1): a consensus never crosses a
    // comparison class — "Quoted to this house $30.20" and "Public pages
    // $40.49" are two figures, not one blend. `observations` and `rows` are
    // the same array mapped in place, so index `i` names the same sighting
    // in both; grouping by that index (rather than re-deriving the class
    // from `PriceObservation`, which does not carry `sourceType` under the
    // same key `comparisonClassOf` expects) keeps the two in lockstep by
    // construction instead of by convention.
    const byClass = new Map<ComparisonClass, PriceObservation[]>();
    rows.forEach((r: any, i: number) => {
      const cls = comparisonClassOf(r.source_type);
      const bucket = byClass.get(cls);
      if (bucket) bucket.push(observations[i]);
      else byClass.set(cls, [observations[i]]);
    });
    const consensusByClass: Record<string, ConsensusResult> = {};
    const trendsByClass: Record<string, PriceTrend[]> = {};
    for (const [cls, obs] of byClass) {
      consensusByClass[cls] = vendorPriceConsensus(obs);
      trendsByClass[cls] = standardTrends(obs);
    }

    // A confirmed identity's own name, not its id — a person reads "Krug
    // Grande Cuvée (750ml)", never a UUID (ADR 0160 §112 review, minor: "the
    // sheet prints a raw identity UUID to the person"). Best-effort: a failed
    // or empty lookup leaves `identityLabel` null and the row still carries
    // `identityId`, so nothing is hidden — only the label is missing.
    const identityIds = [
      ...new Set(rows.map((r: any) => r.identity_id).filter(Boolean)),
    ];
    const identityLabels: Record<string, string> = {};
    if (identityIds.length > 0) {
      const { data: idRows, error: idErr } = await this.databaseService.supabase
        .from("beverage_identities")
        .select("id, display_label")
        .in("id", identityIds);
      if (idErr) {
        this.logger.warn(
          `Could not read identity labels for the compare panel (${idErr.message}); rows will show the identity id instead.`,
        );
      } else {
        for (const idRow of (idRows ?? []) as Array<{ id: string; display_label: string | null }>) {
          if (idRow.display_label) identityLabels[idRow.id] = idRow.display_label;
        }
      }
    }

    return {
      productKey: {
        masterWineId: params.masterWineId,
        signatureHash: params.signatureHash,
      },
      // The library's own name first. Falling back to whatever the newest
      // observation happened to be called means the heading changes when a
      // vendor edits their page, and shows nothing at all when there are no
      // observations yet — which is exactly the moment a user needs to be
      // told which wine they are looking at.
      productName: wine.label ?? rows[0]?.product_name_raw ?? null,
      consensus: vendorPriceConsensus(observations),
      consensusByClass,
      trends: standardTrends(observations),
      trendsByClass,
      observations: rows.map((r: any, i: number) => ({
        id: r.id,
        vendorName: r.vendor_name_raw ?? null,
        providerId: r.provider_id ?? null,
        sourceType: r.source_type,
        sourceUrl: r.source_url ?? null,
        sourceRef: r.source_ref ?? null,
        comparisonClass: comparisonClassOf(r.source_type),
        rawPrice: Number(r.raw_price),
        currency: r.currency ?? "USD",
        trustTier:
          r.trust_tier === null || r.trust_tier === undefined
            ? null
            : Number(r.trust_tier),
        packSize: r.pack_size ?? 1,
        unitVolumeMl: r.unit_volume_ml ?? null,
        observedAt: r.observed_at,
        parseConfidence:
          r.parse_confidence === null || r.parse_confidence === undefined
            ? null
            : Number(r.parse_confidence),
        isOutlier: r.is_outlier === true,
        outlierReason: r.outlier_reason ?? null,
        // The own-paper writer stores `raw.notes` (`own-paper-sighting.ts`);
        // the hand-typed writer stores `raw.note` (this file, `record()`) —
        // two writers, two keys, read defensively rather than made to agree
        // here (an unrelated rename is not this fix's job). Review finding:
        // the sighting sheet never showed a row's recorded note at all
        // because this mapping dropped `raw` on the floor before it reached
        // the client (ADR 0160 §112).
        note:
          typeof r.raw?.note === "string"
            ? r.raw.note
            : typeof r.raw?.notes === "string"
              ? r.raw.notes
              : null,
        identityId: r.identity_id ?? null,
        identityLabel: r.identity_id ? (identityLabels[r.identity_id] ?? null) : null,
        normalizedUnitPrice: normalizeUnitPrice(observations[i]).unitPrice,
      })),
      // `loadObservations` caps at 500 rows, newest first (see its own
      // comment). Hitting the cap means older sightings within the window
      // were left out — the counts above are then a floor.
      complete: rows.length < 500,
      windowDays: params.windowDays ?? 365,
    };
  }
}
