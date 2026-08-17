import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { SearchVendorsDto } from "./dto/search-vendors.dto";
import { MatchVendorsDto } from "./dto/match-vendors.dto";

export interface VendorCatalogueRow {
  id: string;
  name: string;
  type: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  wine_specialties: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface VendorSearchResult {
  data: VendorCatalogueRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface VendorMatchCandidate extends VendorCatalogueRow {
  name_similarity: number;
  address_similarity: number | null;
}

@Injectable()
export class VendorCatalogueService {
  private readonly logger = new Logger(VendorCatalogueService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async search(dto: SearchVendorsDto): Promise<VendorSearchResult> {
    const q = dto.q ?? "";
    const country = dto.country ?? "US";
    const limit = dto.limit ?? 20;
    const offset = dto.offset ?? 0;

    let query = this.databaseService.supabase
      .from("vendor_catalogue")
      .select("*", { count: "exact" })
      .eq("is_active", true)
      .eq("country", country);

    // Curated-only by default. vendor_catalogue also holds registry rows
    // ingested from official permit databases (tens of thousands of them), and
    // this endpoint backs the add-provider modal, where an operator expects a
    // short list of vetted suppliers rather than raw federal records. Callers
    // that genuinely want the long tail opt in explicitly.
    if (!dto.includeRegistry) {
      query = query.eq("listing_tier", "curated");
    }

    if (q) {
      query = query.or(`name.ilike.%${q}%,wine_specialties.ilike.%${q}%`);
    }

    if (dto.type) {
      query = query.eq("type", dto.type);
    }

    const { data, error, count } = await query
      .order("name")
      .range(offset, offset + limit - 1);

    if (error) {
      this.logger.warn(
        `Vendor catalogue search query warning: ${error.message}`,
      );
      // Fallback query without listing_tier filter in case listing_tier column is absent
      const fallbackQuery = this.databaseService.supabase
        .from("vendor_catalogue")
        .select("*", { count: "exact" })
        .eq("is_active", true);

      const { data: fbData, count: fbCount } = await fallbackQuery
        .order("name")
        .range(offset, offset + limit - 1);

      return {
        data: (fbData ?? []) as VendorCatalogueRow[],
        total: fbCount ?? 0,
        limit,
        offset,
      };
    }

    return {
      data: (data ?? []) as VendorCatalogueRow[],
      total: count ?? 0,
      limit,
      offset,
    };
  }

  /**
   * Duplicate-detection candidates for the add-provider form.
   *
   * Backed by match_vendor_catalogue (supabase/migrations/
   * 20260811010000_vendor_catalogue_match.sql), a trigram-similarity RPC
   * rather than a query built here — pg_trgm's `similarity()` operator has no
   * PostgREST equivalent, and the ordering-by-best-of-two-columns logic is
   * exactly what a real SQL query, not a builder chain, is for.
   *
   * Empty name AND empty address both being blank is treated as "nothing to
   * match", not an error — the caller (a debounced form) will call this
   * repeatedly as fields empty out while a user is still typing/deleting.
   */
  async match(dto: MatchVendorsDto): Promise<VendorMatchCandidate[]> {
    const name = dto.name?.trim();
    const address = dto.address?.trim();
    if (!name && !address) return [];

    const { data, error } = await this.databaseService.supabase.rpc(
      "match_vendor_catalogue",
      {
        p_name: name || "",
        p_address: address || null,
        p_country: dto.country || null,
        p_limit: dto.limit ?? 5,
      },
    );

    if (error) {
      this.logger.warn(`Vendor catalogue match RPC failed: ${error.message}`);
      // Duplicate detection is a nicety on top of a working form — a failure
      // here must not block the user from adding their vendor.
      return [];
    }

    return (data ?? []) as VendorMatchCandidate[];
  }

  async findById(id: string): Promise<VendorCatalogueRow> {
    const { data, error } = await this.databaseService.supabase
      .from("vendor_catalogue")
      .select("*")
      .eq("id", id)
      .eq("is_active", true)
      .single();

    if (error || !data) {
      this.logger.error("Failed to fetch vendor by id", {
        id,
        error: error?.message,
      });
      throw new NotFoundException(`Vendor catalogue entry not found: ${id}`);
    }

    return data as VendorCatalogueRow;
  }
}
