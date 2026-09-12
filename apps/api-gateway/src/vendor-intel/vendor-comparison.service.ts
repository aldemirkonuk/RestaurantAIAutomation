import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { hashWineIdentity, wineDisplayLabel } from "./wine-identity";
import {
  BelowAverageResult,
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

/**
 * One register row, with everything a reader needs to open the thing it was
 * read from (2026-09-11, the /vendor-prices rebuild).
 *
 * The provenance travels on the row and nowhere else: `sourceRef` is the
 * writer's own pointer (`receipt_verified:<orderId>`, `<url>#<product>`, a feed
 * key), `raw` carries what the writer chose to keep beside it (the own-paper
 * mirror's `orderId` and `statedUnit`, a typed price's `enteredBy` and
 * `note`), and the write-time verdict comes back as the sentence that was
 * stored, never re-derived here. `scope` says whose row it is — this house's
 * own paper or the openly posted market — because `restaurant_id` itself is
 * not returned: a reader is told which side of the boundary a row sits on, not
 * handed the key.
 */
export interface RegisterObservation {
  id: string;
  scope: "house" | "market";
  providerId: string | null;
  vendorCatalogueId: string | null;
  vendorName: string | null;
  productName: string | null;
  masterWineId: string | null;
  identityId: string | null;
  sourceType: PriceSourceType;
  trustTier: number | null;
  sourceRef: string | null;
  sourceUrl: string | null;
  rawPrice: number;
  currency: string;
  packSize: number;
  unitVolumeMl: number | null;
  observedAt: string;
  effectiveDate: string | null;
  parseConfidence: number | null;
  /** The stored verdict. `null` reason means no judge has ever looked. */
  isOutlier: boolean;
  outlierReason: string | null;
  outlierBasis: string | null;
  outlierJudgedAt: string | null;
  /** The writer's own notes, verbatim. Never interpreted here. */
  raw: Record<string, unknown>;
}

export interface VendorComparison {
  productKey: { masterWineId?: string; signatureHash?: string };
  productName: string | null;
  consensus: ConsensusResult;
  trends: PriceTrend[];
  /** Every observation behind the ladder, for the "show your working" panel. */
  observations: RegisterObservation[];
}

/**
 * A vendor's book: every price this house may see that names one vendor,
 * newest first. `complete` is false when the page came back full, so the count
 * is a floor and the caller must print it as one.
 */
export interface VendorBook {
  vendor: { providerId: string | null; vendorName: string | null };
  items: RegisterObservation[];
  count: number;
  limit: number;
  complete: boolean;
  /** The tenancy boundary the read was made under, in words. */
  scope: string;
}

/** The columns a register read names. One list, so the two reads cannot drift. */
const REGISTER_COLUMNS =
  "id, restaurant_id, provider_id, vendor_catalogue_id, vendor_name_raw, product_name_raw, master_wine_id, identity_id, source_type, trust_tier, source_ref, source_url, raw_price, currency, pack_size, unit_volume_ml, yield_factor, parse_confidence, observed_at, effective_date, is_outlier, outlier_reason, outlier_basis, outlier_judged_at, raw";

function toRegisterObservation(r: any): RegisterObservation {
  return {
    id: String(r.id),
    scope: r.restaurant_id ? "house" : "market",
    providerId: r.provider_id ?? null,
    vendorCatalogueId: r.vendor_catalogue_id ?? null,
    vendorName: r.vendor_name_raw ?? null,
    productName: r.product_name_raw ?? null,
    masterWineId: r.master_wine_id ?? null,
    identityId: r.identity_id ?? null,
    sourceType: r.source_type,
    trustTier:
      r.trust_tier === null || r.trust_tier === undefined
        ? null
        : Number(r.trust_tier),
    sourceRef: r.source_ref ?? null,
    sourceUrl: r.source_url ?? null,
    rawPrice: Number(r.raw_price),
    currency: r.currency ?? "USD",
    packSize: r.pack_size ?? 1,
    unitVolumeMl: r.unit_volume_ml ?? null,
    observedAt: r.observed_at,
    effectiveDate: r.effective_date ?? null,
    parseConfidence:
      r.parse_confidence === null || r.parse_confidence === undefined
        ? null
        : Number(r.parse_confidence),
    isOutlier: r.is_outlier === true,
    outlierReason: r.outlier_reason ?? null,
    outlierBasis: r.outlier_basis ?? null,
    outlierJudgedAt: r.outlier_judged_at ?? null,
    raw: r.raw && typeof r.raw === "object" ? r.raw : {},
  };
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
        .select(REGISTER_COLUMNS),
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
    /**
     * The money the price was quoted in, ISO 4217. Until 2026-09-11 this
     * writer hard-coded "USD" on every hand-typed row, so a lira quote in
     * Antalya entered the register as dollars. Validated by the DTO; defaults
     * to USD only when the caller says nothing, and that default is printed
     * back to them on the form.
     */
    currency?: string;
    restaurantId: string;
    userId?: string;
    /**
     * The name (or email) on the token, kept on the row. `raw.enteredBy` is an
     * id that goes stale when the person leaves; a register that can name
     * who typed a price is worth more than one that can only number them.
     */
    enteredByLabel?: string | null;
  }) {
    const sourceType = params.sourceType ?? "manual";
    const TRUST_BY_SOURCE: Record<string, number> = {
      quote: 2,
      chat: 5,
      social: 6,
      manual: 7,
    };

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
        currency: (params.currency ?? "USD").toUpperCase(),
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
          enteredByLabel: params.enteredByLabel?.trim() || null,
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
      // The row's id rides through the engine to its rung on the ladder, so
      // the page can open the source behind a price (2026-09-11).
      id: r.id ?? null,
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
      trends: standardTrends(observations),
      observations: rows.map(toRegisterObservation),
    };
  }

  /**
   * A vendor's book — every price this house may see that names one vendor.
   *
   * The other way into the register (2026-09-11): `compare()` starts from a
   * bottle, this starts from a vendor, which is how a person arrives from the
   * vendor's own card on /providers. It is the same read under the same
   * boundary — `houseAndOpenMarket`, so this house's own paper plus the openly
   * posted rows, never another house's — and it is keyed by `provider_id`
   * when the caller has one and by the raw vendor name otherwise, because most
   * hand-typed prices name a vendor the book has no row for.
   *
   * `.limit()` makes the count a FLOOR: `complete` is false when the page came
   * back full, and the page must not print `items.length` as a total then
   * (`scripts/check_windowed_figures.py`). A failed read THROWS, with the
   * reason: an empty book and an unreadable one are different sentences.
   */
  async vendorBook(params: {
    restaurantId: string;
    providerId?: string | null;
    vendorName?: string | null;
    limit?: number;
  }): Promise<VendorBook> {
    const providerId = params.providerId?.trim() || null;
    const vendorName = params.vendorName?.trim() || null;
    if (!providerId && !vendorName) {
      throw new BadRequestException(
        "Name the vendor: providerId for a vendor in the book, or vendorName for one that only a typed price knows.",
      );
    }
    const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);

    let q = scopePriceRegisterRead(
      this.databaseService.supabase
        .from("vendor_price_observations")
        .select(REGISTER_COLUMNS),
      VENDOR_PRICE_OBSERVATIONS,
      { kind: "houseAndOpenMarket", restaurantId: params.restaurantId },
    )
      .order("observed_at", { ascending: false })
      .limit(limit);

    // `.eq()` parameterises; `.ilike()` on a free-text name is the one place a
    // caller's string reaches a filter, and PostgREST escapes it as a value,
    // not as filter syntax. The two keys are alternatives, not a union: a
    // provider id is exact, a name is a name.
    q = providerId
      ? q.eq("provider_id", providerId)
      : q.ilike("vendor_name_raw", vendorName as string);

    const { data, error } = await q;
    if (error) {
      this.logger.error(`Failed to read a vendor's book: ${error.message}`);
      if ((error as { code?: string }).code === "22P02") {
        throw new BadRequestException(
          "providerId must be a vendor id. Open the vendor from the book rather than typing an id.",
        );
      }
      throw new InternalServerErrorException(
        `Could not read the vendor's book: ${error.message}`,
      );
    }

    const items = ((data ?? []) as any[]).map(toRegisterObservation);
    return {
      vendor: { providerId, vendorName },
      items,
      count: items.length,
      limit,
      complete: items.length < limit,
      scope:
        "this house's own sightings of the vendor, plus the openly posted market rows that name it; no other house's",
    };
  }
}
