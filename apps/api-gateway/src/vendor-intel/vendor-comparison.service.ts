import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { hashWineIdentity } from "./wine-identity";
import {
  ConsensusResult,
  PriceObservation,
  PriceSourceType,
  PriceTrend,
  standardTrends,
  vendorPriceConsensus,
} from "../analytics/engine/vendor-price-consensus";

export interface VendorComparison {
  productKey: { masterWineId?: string; signatureHash?: string };
  productName: string | null;
  consensus: ConsensusResult;
  trends: PriceTrend[];
  /** Every observation behind the ladder, for the "show your working" panel. */
  observations: Array<{
    vendorName: string | null;
    sourceType: PriceSourceType;
    sourceUrl: string | null;
    rawPrice: number;
    packSize: number;
    unitVolumeMl: number | null;
    observedAt: string;
    parseConfidence: number | null;
  }>;
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
      label:
        [row.producer, row.name, row.vintage].filter(Boolean).join(" ") || null,
    };
  }

  /**
   * Load observations for a product.
   *
   * Deliberately NOT scoped to one restaurant by default. A scraped list price
   * is market intelligence that belongs to everyone; restricting the ladder to
   * rows this tenant happened to generate would make a vendor look absent
   * simply because this restaurant has never bought from them. Tenant-scoped
   * rows (invoices, negotiated quotes) are included on top when a restaurantId
   * is supplied.
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

    let q = this.databaseService.supabase
      .from("vendor_price_observations")
      .select(
        "provider_id, vendor_name_raw, product_name_raw, source_type, source_url, raw_price, currency, pack_size, unit_volume_ml, yield_factor, parse_confidence, observed_at",
      )
      .gte(
        "observed_at",
        new Date(Date.now() - windowDays * 86_400_000).toISOString(),
      )
      .order("observed_at", { ascending: false })
      .limit(500);

    // Match on either key. An observation resolved to a library row and one
    // that only ever knew a name are the same bottle, and ranking them apart
    // is the bug this replaces. Two separate `.or()` calls are ANDed by
    // PostgREST, which is what we want: (product) AND (tenant scope).
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

    // Market rows (restaurant_id null) plus this tenant's own rows.
    if (restaurantId) {
      q = q.or(`restaurant_id.is.null,restaurant_id.eq.${restaurantId}`);
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
        currency: "USD",
        pack_size: params.packSize ?? 1,
        unit_volume_ml: params.unitVolumeMl ?? null,
        // Null, not 1. parse_confidence answers "how well did we read this",
        // and nothing was parsed — a human asserted it. Claiming 1.0 would
        // make a typed number the best-parsed row in the ladder.
        parse_confidence: null,
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
      this.logger.error(`Failed to record manual observation: ${error.message}`);
      throw new InternalServerErrorException(
        `Could not record the observation: ${error.message}`,
      );
    }

    return { id: (data as any).id, observedAt: (data as any).observed_at };
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
      observations: rows.map((r: any) => ({
        vendorName: r.vendor_name_raw ?? null,
        sourceType: r.source_type,
        sourceUrl: r.source_url ?? null,
        rawPrice: Number(r.raw_price),
        packSize: r.pack_size ?? 1,
        unitVolumeMl: r.unit_volume_ml ?? null,
        observedAt: r.observed_at,
        parseConfidence:
          r.parse_confidence === null || r.parse_confidence === undefined
            ? null
            : Number(r.parse_confidence),
      })),
    };
  }
}
