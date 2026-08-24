import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  hashWineSignature,
  normalizeSignatureText,
  wineSignatureInputFromPayload,
} from "./wine-signature";
import {
  GetWinesQueryDto,
  WineMetaQueryDto,
  WineSuggestionsQueryDto,
  SimilarWinesQueryDto,
} from "./dto/wines.dto";

const ML_PER_OZ = 29.5735;

interface WineRow {
  id: string;
  wine_id?: string;
  name: string;
  producer: string;
  vintage: number | null;
  price_reference: number | null;
  retail_price_avg?: number | null;
  primary_type: string | null;
  grape_variety: string | null;
  country: string | null;
  region: string | null;
  appellation: string | null;
  producer_story?: string | null;
  tasting_notes?: string | null;
  bottle_size_ml?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface WineSubmissionRow {
  id: string;
  restaurant_id?: string | null;
  submitted_by?: string | null;
  payload: any;
  normalized_fields?: any;
  signature_hash?: string | null;
  status: string;
  decision_reason?: string | null;
  matched_master_id?: string | null;
}

@Injectable()
export class WinesService {
  private readonly logger = new Logger(WinesService.name);

  constructor(private readonly dbService: DatabaseService) {}

  private mapWine(row: WineRow) {
    const bottleSizeMl = row.bottle_size_ml ?? 750;
    const bottleSizeOz = Math.round((bottleSizeMl / ML_PER_OZ) * 10) / 10;
    return {
      id: row.id,
      name: row.name,
      producer: row.producer,
      vintage: row.vintage ?? undefined,
      price: row.price_reference ?? 0,
      // Same field the inventory read model surfaces as marketPrice, so a library
      // row and an inventory row agree on what "market" means. Null until the
      // price-enrichment pipeline populates it.
      retailPriceAvg: row.retail_price_avg ?? undefined,
      category: row.primary_type ?? undefined,
      region: row.region ?? undefined,
      country: row.country ?? undefined,
      appellation: row.appellation ?? undefined,
      grapeVariety: row.grape_variety ?? undefined,
      description: row.producer_story ?? undefined,
      tastingNotes: row.tasting_notes ?? undefined,
      bottleSizeMl,
      bottleSizeOz,
      createdAt: row.created_at ?? undefined,
      updatedAt: row.updated_at ?? undefined,
    };
  }

  /**
   * The denormalised columns the near-match fallback queries on. Derived from
   * the same reading of the payload as the signature, so a wine cannot match on
   * one and miss on the other.
   */
  private buildNormalizedFields(payload: any) {
    const input = wineSignatureInputFromPayload(payload);
    return {
      normalized_name: normalizeSignatureText(input.name),
      normalized_producer: normalizeSignatureText(input.producer),
      normalized_primary_type: normalizeSignatureText(input.primaryType),
      normalized_grape_variety: normalizeSignatureText(input.grapeVariety),
      normalized_country: normalizeSignatureText(input.country),
      normalized_region: normalizeSignatureText(input.region),
      normalized_appellation: normalizeSignatureText(input.appellation),
    };
  }

  async submitWine(payload: any, restaurantId?: string, submittedBy?: string) {
    const client = this.dbService.getClient();
    const normalizedFields = this.buildNormalizedFields(payload);
    const signatureHash = hashWineSignature(
      wineSignatureInputFromPayload(payload),
    );

    const { data, error } = await client
      .from("master_wine_library_submissions")
      .insert({
        restaurant_id: restaurantId || null,
        submitted_by: submittedBy || null,
        payload,
        normalized_fields: normalizedFields,
        signature_hash: signatureHash,
        status: "pending",
      })
      .select("*")
      .single();

    if (error) {
      this.logger.error(`Failed to submit wine: ${error.message}`);
      throw error;
    }

    return data as WineSubmissionRow;
  }

  async processPendingSubmissions(limit = 50) {
    const client = this.dbService.getClient();
    const { data, error } = await client
      .from("master_wine_library_submissions")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) {
      this.logger.error(`Failed to load submissions: ${error.message}`);
      throw error;
    }

    const submissions = (data || []) as WineSubmissionRow[];
    const results: { id: string; status: string; matchedId?: string }[] = [];

    for (const submission of submissions) {
      const payload = submission.payload || {};
      // Always recomputed from the payload, never read off
      // submission.signature_hash: rows written by the Python menu-scan
      // pipeline carry a hash from a different algorithm, and trusting a stored
      // value would copy that foreign key format into master_wine_library.
      const signatureHash = hashWineSignature(
        wineSignatureInputFromPayload(payload),
      );

      if (signatureHash) {
        const { data: existing } = await client
          .from("master_wine_library")
          .select("id")
          .eq("signature_hash", signatureHash)
          .maybeSingle();

        if (existing?.id) {
          await client
            .from("master_wine_library_submissions")
            .update({
              status: "merged",
              matched_master_id: existing.id,
              decision_reason: "signature_hash_match",
              signature_hash: signatureHash,
            })
            .eq("id", submission.id);

          results.push({
            id: submission.id,
            status: "merged",
            matchedId: existing.id,
          });
          continue;
        }
      }

      const normalizedFields = this.buildNormalizedFields(payload);
      const nearMatch = await client
        .from("master_wine_library")
        .select("id")
        .eq("normalized_name", normalizedFields.normalized_name)
        .eq("normalized_producer", normalizedFields.normalized_producer)
        .limit(1);

      if (nearMatch.data && nearMatch.data.length > 0) {
        await client
          .from("master_wine_library_submissions")
          .update({
            status: "review",
            matched_master_id: nearMatch.data[0].id,
            decision_reason: "normalized_name_producer_match",
            signature_hash: signatureHash,
            normalized_fields: normalizedFields,
          })
          .eq("id", submission.id);

        results.push({
          id: submission.id,
          status: "review",
          matchedId: nearMatch.data[0].id,
        });
        continue;
      }

      const insertPayload: any = {
        wine_id: payload?.wine_id || payload?.WINE_ID || null,
        name: payload?.name,
        producer: payload?.producer,
        vintage: payload?.vintage ?? null,
        price_reference: payload?.price_reference ?? payload?.price ?? null,
        primary_type:
          payload?.primary_type ||
          payload?.classification?.primary_type ||
          null,
        grape_variety:
          payload?.grape_variety ||
          payload?.classification?.grape_variety ||
          null,
        country: payload?.country || payload?.classification?.country || null,
        region: payload?.region || payload?.classification?.region || null,
        appellation:
          payload?.appellation || payload?.classification?.appellation || null,
        sub_region:
          payload?.sub_region || payload?.classification?.sub_region || null,
        wine_structure: payload?.wine_structure || null,
        sensory_profile: payload?.sensory_profile || null,
        quality_classification:
          payload?.quality_signals || payload?.quality_classification || null,
        source: payload?.source || "submission",
        data_enrichment: payload?.data_enrichment || null,
        signature_hash: signatureHash,
        normalized_name: normalizedFields.normalized_name,
        normalized_producer: normalizedFields.normalized_producer,
        signature_source: "submission",
        bottle_size_ml: payload?.bottleSizeMl ?? payload?.bottle_size_ml ?? 750,
      };

      const { data: inserted, error: insertError } = await client
        .from("master_wine_library")
        .insert(insertPayload)
        .select("id")
        .single();

      if (insertError) {
        await client
          .from("master_wine_library_submissions")
          .update({
            status: "rejected",
            decision_reason: insertError.message,
            signature_hash: signatureHash,
            normalized_fields: normalizedFields,
          })
          .eq("id", submission.id);

        results.push({ id: submission.id, status: "rejected" });
        continue;
      }

      await client
        .from("master_wine_library_submissions")
        .update({
          status: "accepted",
          matched_master_id: inserted.id,
          decision_reason: "inserted_new_master",
          signature_hash: signatureHash,
          normalized_fields: normalizedFields,
        })
        .eq("id", submission.id);

      results.push({
        id: submission.id,
        status: "accepted",
        matchedId: inserted.id,
      });
    }

    return { processed: results.length, results };
  }

  async searchWines(query: GetWinesQueryDto) {
    const client = this.dbService.getClient();
    let supa = client.from("master_wine_library").select("*");

    if (query.ids) {
      const ids = query.ids
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      if (ids.length) {
        supa = supa.in("id", ids);
      }
    }

    if (query.search) {
      supa = supa.or(
        `name.ilike.%${query.search}%,producer.ilike.%${query.search}%`,
      );
    }

    if (query.type) {
      supa = supa.ilike("primary_type", `%${query.type}%`);
    }

    if (query.region) {
      supa = supa.ilike("region", `%${query.region}%`);
    }

    if (query.country) {
      supa = supa.ilike("country", `%${query.country}%`);
    }

    if (query.minPrice !== undefined) {
      supa = supa.gte("price_reference", query.minPrice);
    }

    if (query.maxPrice !== undefined) {
      supa = supa.lte("price_reference", query.maxPrice);
    }

    if (query.sortBy) {
      const column =
        query.sortBy === "price"
          ? "price_reference"
          : query.sortBy === "type"
            ? "primary_type"
            : query.sortBy;
      supa = supa.order(column, { ascending: query.sortOrder !== "desc" });
    } else {
      supa = supa.order("name", { ascending: true });
    }

    if (query.limit) {
      supa = supa.limit(query.limit);
    }

    if (query.offset !== undefined && query.limit) {
      supa = supa.range(query.offset, query.offset + query.limit - 1);
    }

    const { data, error } = await supa;
    if (error) {
      this.logger.error(`Failed to search wines: ${error.message}`);
      throw error;
    }

    return (data || []).map((row: WineRow) => this.mapWine(row));
  }

  async getWineById(wineId: string) {
    const client = this.dbService.getClient();
    const { data, error } = await client
      .from("master_wine_library")
      .select("*")
      .eq("id", wineId)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return null;
      }
      throw error;
    }

    return this.mapWine(data as WineRow);
  }

  async getWineCategories() {
    const client = this.dbService.getClient();
    const { data, error } = await client
      .from("master_wine_library")
      .select("primary_type")
      .not("primary_type", "is", null);

    if (error) throw error;
    const types = (data || []).map((row) => row.primary_type).filter(Boolean);
    return Array.from(new Set(types)).sort();
  }

  async getWineRegions(query: WineMetaQueryDto) {
    const client = this.dbService.getClient();
    let supa = client.from("master_wine_library").select("region, country");

    if (query.country) {
      supa = supa.ilike("country", `%${query.country}%`);
    }

    const { data, error } = await supa;
    if (error) throw error;
    const regions = (data || []).map((row) => row.region).filter(Boolean);
    return Array.from(new Set(regions)).sort();
  }

  async getWineCountries() {
    const client = this.dbService.getClient();
    const { data, error } = await client
      .from("master_wine_library")
      .select("country")
      .not("country", "is", null);

    if (error) throw error;
    const countries = (data || []).map((row) => row.country).filter(Boolean);
    return Array.from(new Set(countries)).sort();
  }

  async getWineSuggestions(query: WineSuggestionsQueryDto) {
    if (!query.text || query.text.length < 2) {
      return [];
    }

    const client = this.dbService.getClient();
    const { data, error } = await client
      .from("master_wine_library")
      .select(
        "id, wine_id, name, producer, vintage, price_reference, retail_price_avg, primary_type, region, country, appellation, grape_variety, bottle_size_ml, created_at, updated_at",
      )
      .or(`name.ilike.%${query.text}%,producer.ilike.%${query.text}%`)
      .limit(query.limit || 10);

    if (error) throw error;
    return (data || []).map((row: WineRow) => this.mapWine(row));
  }

  async getSimilarWines(wineId: string, query: SimilarWinesQueryDto) {
    const wine = await this.getWineById(wineId);
    if (!wine) return [];

    const client = this.dbService.getClient();
    let supa = client.from("master_wine_library").select("*").neq("id", wineId);

    if (wine.category) {
      supa = supa.ilike("primary_type", `%${wine.category}%`);
    }

    if (wine.region) {
      supa = supa.ilike("region", `%${wine.region}%`);
    }

    if (wine.price) {
      supa = supa
        .gte("price_reference", wine.price * 0.7)
        .lte("price_reference", wine.price * 1.3);
    }

    const { data, error } = await supa.limit(query.limit || 5);
    if (error) throw error;
    return (data || []).map((row: WineRow) => this.mapWine(row));
  }
}
