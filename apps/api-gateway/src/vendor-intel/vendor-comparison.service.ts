import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
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

    if (masterWineId) q = q.eq("master_wine_id", masterWineId);
    else if (signatureHash) q = q.eq("signature_hash", signatureHash);

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
      throw new Error(error.message);
    }
    return data ?? [];
  }

  async compare(params: {
    masterWineId?: string;
    signatureHash?: string;
    restaurantId?: string | null;
    windowDays?: number;
  }): Promise<VendorComparison> {
    const rows = await this.loadObservations(params);

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
      productName: rows[0]?.product_name_raw ?? null,
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
