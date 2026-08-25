import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  DistributorFacetsDto,
  SearchDistributorsDto,
} from "./dto/search-distributors.dto";
import {
  escapeLikeWildcards,
  groupFacetCounts,
  normalizeBbox,
  parseFacets,
} from "./distributor-query";

export interface DistributorRow {
  id: string;
  name: string;
  type: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  website: string | null;
  wine_specialties: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Metres to the nearest serving location, or null when un-geocoded. */
  distance_m: number | null;
  /** True when distance_m came from the HQ because no location is on file. */
  distance_is_hq: boolean;
  nearest_location_kind: string | null;
  may_serve: boolean;
  /** Admin area whose licence permits service, or 'nationwide'. */
  serves_via: string | null;
  /** curated = human-vetted; registry = unverified permit-database row. */
  listing_tier: string;
  data_confidence: number | null;
  verified_at: string | null;
}

export interface DistributorSearchResult {
  data: DistributorRow[];
  total: number;
  limit: number;
  offset: number;
  /**
   * The restaurant's own coordinates, so the map can place the "you are here"
   * marker and centre sensibly. Null when the restaurant has not been geocoded.
   */
  origin: { lat: number; lng: number; label: string } | null;
}

export interface DistributorDetail {
  vendor: Record<string, unknown>;
  locations: Array<Record<string, unknown>>;
  territories: Array<Record<string, unknown>>;
  facets: Record<
    string,
    Array<{ slug: string; value: string; vendors: number }>
  >;
}

@Injectable()
export class DistributorDiscoveryService {
  private readonly logger = new Logger(DistributorDiscoveryService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async search(
    restaurantId: string,
    dto: SearchDistributorsDto,
  ): Promise<DistributorSearchResult> {
    const limit = dto.limit ?? 50;
    const offset = dto.offset ?? 0;
    const bbox = normalizeBbox(dto);

    const originPromise = this.databaseService
      .getClient()
      .from("restaurants")
      .select("name, latitude, longitude")
      .eq("id", restaurantId)
      .maybeSingle();

    const { data, error } = await this.databaseService
      .getClient()
      .rpc("search_distributors", {
        p_restaurant_id: restaurantId,
        p_origin_lat: dto.lat ?? null,
        p_origin_lng: dto.lng ?? null,
        p_radius_m: dto.radiusM ?? null,
        p_bbox_min_lng: bbox?.minLng ?? null,
        p_bbox_min_lat: bbox?.minLat ?? null,
        p_bbox_max_lng: bbox?.maxLng ?? null,
        p_bbox_max_lat: bbox?.maxLat ?? null,
        p_territory_only: dto.territoryOnly ?? true,
        p_types: dto.type ?? null,
        p_facets: parseFacets(dto.facet),
        // Escaped rather than interpolated: the RPC takes q as a bound parameter,
        // and escaping stops a literal % or _ from behaving as a wildcard.
        p_q: dto.q ? escapeLikeWildcards(dto.q) : null,
        p_sort: dto.sort ?? "distance",
        p_limit: limit,
        p_offset: offset,
        p_tiers: dto.tier ?? null,
      });

    if (error) {
      // Rethrow rather than returning an empty page. "0 distributors found" and
      // "the query failed" are different facts, and collapsing them renders a
      // confident empty-state to someone whose search actually broke — they
      // conclude no vendor serves them and stop looking. The caller can decide
      // to degrade; this layer must not decide it silently.
      this.logger.error("Failed to search distributors RPC", {
        restaurantId,
        error: error.message,
      });
      throw new Error(error.message);
    }

    const rows = (data ?? []) as Array<
      DistributorRow & { total_count: number }
    >;
    // The RPC carries the window count on every row, so pagination costs no
    // extra round trip. An empty page legitimately means zero total.
    const total = rows.length ? Number(rows[0].total_count) : 0;

    const { data: restaurant } = await originPromise;
    const origin =
      restaurant?.latitude != null && restaurant?.longitude != null
        ? {
            lat: Number(restaurant.latitude),
            lng: Number(restaurant.longitude),
            label: String(restaurant.name ?? "Your restaurant"),
          }
        : null;

    return {
      data: rows.map(({ total_count: _ignored, ...row }) => row),
      total,
      limit,
      offset,
      origin,
    };
  }

  async facetCounts(
    restaurantId: string,
    dto: DistributorFacetsDto,
  ): Promise<
    Record<string, Array<{ slug: string; value: string; vendors: number }>>
  > {
    const { data, error } = await this.databaseService
      .getClient()
      .rpc("search_distributor_facet_counts", {
        p_restaurant_id: restaurantId,
        p_territory_only: dto.territoryOnly ?? true,
        p_types: dto.type ?? null,
        p_tiers: dto.tier ?? null,
      });

    if (error) {
      this.logger.warn(
        "Failed to load distributor facet counts RPC, returning empty object",
        {
          restaurantId,
          error: error.message,
        },
      );
      return {};
    }

    return groupFacetCounts(data ?? []);
  }

  async findById(id: string): Promise<DistributorDetail> {
    const db = this.databaseService.getClient();

    const { data: vendor, error } = await db
      .from("vendor_catalogue")
      .select("*")
      .eq("id", id)
      .eq("is_active", true)
      .maybeSingle();

    if (error || !vendor) {
      this.logger.warn("Distributor not found", { id, error: error?.message });
      throw new NotFoundException(`Distributor not found: ${id}`);
    }

    const [locations, territories, facets] = await Promise.all([
      db
        .from("vendor_locations")
        .select(
          "id, kind, name, address, city, admin_area_code, postal_code, country, latitude, longitude, is_primary",
        )
        .eq("vendor_id", id)
        .order("is_primary", { ascending: false }),
      db
        .from("vendor_service_territories")
        .select(
          "country, admin_area_code, license_type, license_id, valid_until",
        )
        .eq("vendor_id", id)
        .order("country"),
      db
        .from("vendor_portfolio_facets")
        .select(
          "facet_kind, facet_slug, facet_value, confidence, source_url, observed_at",
        )
        .eq("vendor_id", id),
    ]);

    return {
      vendor,
      locations: locations.data ?? [],
      territories: territories.data ?? [],
      facets: groupFacetCounts(
        (facets.data ?? []).map((f: Record<string, unknown>) => ({
          facet_kind: f.facet_kind as string,
          facet_slug: f.facet_slug as string,
          facet_value: f.facet_value as string,
          vendors: 1,
        })),
      ),
    };
  }
}
