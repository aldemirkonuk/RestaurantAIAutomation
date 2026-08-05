import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "crypto";
import { DatabaseService } from "../database/database.service";
import { CreateWineSubmissionDto } from "./dto/wine-submissions.dto";

type SubmissionRow = {
  id: string;
  payload: Record<string, any>;
  normalized_fields?: Record<string, any> | null;
  signature_hash?: string | null;
  status: string;
  matched_master_id?: string | null;
};

/** Structural subset shared by CreateWineSubmissionDto and menu-import items. */
interface SignatureInput {
  name: string;
  producer?: string | null;
  vintage?: string | number | null;
  country?: string | null;
  region?: string | null;
  primaryType?: string | null;
  grapeVariety?: string | null;
}

export interface LibraryResolutionInput {
  name: string;
  producer?: string | null;
  vintage?: string | number | null;
  region?: string | null;
  grapeVariety?: string | null;
  country?: string | null;
}

export interface LibraryResolutionResult {
  masterWineId: string;
  matched: boolean;
  libraryTier: number | null;
}

@Injectable()
export class WineSubmissionsService {
  private readonly logger = new Logger(WineSubmissionsService.name);

  constructor(private readonly dbService: DatabaseService) {}

  private normalizeText(value?: string | null): string {
    if (!value) return "";
    return value
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^a-zA-Z0-9]+/g, " ")
      .trim()
      .toLowerCase();
  }

  private buildSignature(payload: SignatureInput): string {
    const producer = this.normalizeText(payload.producer);
    const name = this.normalizeText(payload.name);
    const vintage = payload.vintage ?? "NV";
    const country = this.normalizeText(payload.country);
    const region = this.normalizeText(payload.region);
    const primaryType = this.normalizeText(payload.primaryType);
    const grapeVariety = this.normalizeText(payload.grapeVariety);
    return [
      producer,
      name,
      vintage,
      country,
      region,
      primaryType,
      grapeVariety,
    ].join("|");
  }

  private hashSignature(signature: string): string {
    return createHash("sha256").update(signature).digest("hex");
  }

  private generateWineId(): string {
    const suffix = Math.random().toString(36).slice(2, 8);
    const timestamp = Date.now().toString(36).slice(-8);
    return `WINE_${timestamp}${suffix}`.slice(0, 20);
  }

  async submitWine(
    restaurantId: string,
    userId: string,
    payload: CreateWineSubmissionDto,
  ) {
    const signature = this.buildSignature(payload);
    const signatureHash = this.hashSignature(signature);
    const normalizedFields = {
      normalized_name: this.normalizeText(payload.name),
      normalized_producer: this.normalizeText(payload.producer),
      vintage: payload.vintage ?? null,
      country: this.normalizeText(payload.country),
      region: this.normalizeText(payload.region),
      primary_type: this.normalizeText(payload.primaryType),
      grape_variety: this.normalizeText(payload.grapeVariety),
    };

    const { data, error } = await this.dbService.supabase
      .from("master_wine_library_submissions")
      .insert({
        restaurant_id: restaurantId,
        submitted_by: userId,
        payload,
        normalized_fields: normalizedFields,
        signature_hash: signatureHash,
        status: "pending",
      })
      .select("*")
      .single();

    if (error) {
      this.logger.error("Failed to submit wine", { error: error.message });
      throw error;
    }

    return data;
  }

  async listSubmissions(status?: string, limit = 50) {
    let query = this.dbService.supabase
      .from("master_wine_library_submissions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async processPendingSubmissions(limit = 50) {
    const { data, error } = await this.dbService.supabase
      .from("master_wine_library_submissions")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) throw error;
    const submissions = (data || []) as SubmissionRow[];

    const results: Array<{
      id: string;
      status: string;
      matchedMasterId?: string | null;
    }> = [];

    for (const submission of submissions) {
      const payload = submission.payload as CreateWineSubmissionDto;
      const signature = this.buildSignature(payload);
      const signatureHash =
        submission.signature_hash || this.hashSignature(signature);

      // Exact signature match
      const { data: existingMaster } = await this.dbService.supabase
        .from("master_wine_library")
        .select("id")
        .eq("signature_hash", signatureHash)
        .maybeSingle();

      if (existingMaster?.id) {
        await this.dbService.supabase
          .from("master_wine_library_submissions")
          .update({
            status: "merged",
            matched_master_id: existingMaster.id,
            decision_reason: "signature_match",
            signature_hash: signatureHash,
          })
          .eq("id", submission.id);
        results.push({
          id: submission.id,
          status: "merged",
          matchedMasterId: existingMaster.id,
        });
        continue;
      }

      // Conservative review: same name+producer, different vintage
      const normalizedName = this.normalizeText(payload.name);
      const normalizedProducer = this.normalizeText(payload.producer);
      const { data: nameProducerMatch } = await this.dbService.supabase
        .from("master_wine_library")
        .select("id, vintage")
        .eq("normalized_name", normalizedName)
        .eq("normalized_producer", normalizedProducer)
        .limit(1);

      if (nameProducerMatch && nameProducerMatch.length > 0) {
        await this.dbService.supabase
          .from("master_wine_library_submissions")
          .update({
            status: "pending_review",
            decision_reason: "name_producer_match",
            signature_hash: signatureHash,
          })
          .eq("id", submission.id);
        results.push({ id: submission.id, status: "pending_review" });
        continue;
      }

      const wineId = payload["wineId"] || this.generateWineId();
      const insertPayload = {
        wine_id: wineId,
        name: payload.name,
        producer: payload.producer,
        vintage: payload.vintage ?? null,
        price_reference: payload.priceReference ?? null,
        primary_type: payload.primaryType ?? "unknown",
        grape_variety: payload.grapeVariety ?? null,
        country: payload.country ?? "Unknown",
        region: payload.region ?? "Unknown",
        appellation: payload.appellation ?? null,
        sub_region: payload.subRegion ?? null,
        wine_structure: payload.wineStructure ?? null,
        sensory_profile: payload.sensoryProfile ?? null,
        signature_hash: signatureHash,
        normalized_name: normalizedName,
        normalized_producer: normalizedProducer,
        signature_source: "submission",
      };

      const { data: upserted, error: upsertError } =
        await this.dbService.supabase
          .from("master_wine_library")
          .upsert(insertPayload, { onConflict: "signature_hash" })
          .select("id")
          .single();

      if (upsertError) {
        this.logger.error("Failed to upsert master wine", {
          error: upsertError.message,
        });
        await this.dbService.supabase
          .from("master_wine_library_submissions")
          .update({
            status: "pending",
            decision_reason: upsertError.message,
            signature_hash: signatureHash,
          })
          .eq("id", submission.id);
        results.push({ id: submission.id, status: "pending" });
        continue;
      }

      await this.dbService.supabase
        .from("master_wine_library_submissions")
        .update({
          status: "accepted",
          matched_master_id: upserted?.id ?? null,
          decision_reason: "upserted",
          signature_hash: signatureHash,
        })
        .eq("id", submission.id);

      results.push({
        id: submission.id,
        status: "accepted",
        matchedMasterId: upserted?.id ?? null,
      });
    }

    return { processed: results.length, results };
  }

  /**
   * Synchronous match-or-create against master_wine_library, used by the menu
   * importer so it can populate menu_items.wine_library_id and
   * restaurant_inventory.master_wine_id immediately (both are FK targets and
   * cannot be left null the way the old fire-and-forget submission path did).
   *
   * Resolution order mirrors processPendingSubmissions:
   *   1. Exact signature_hash match → link, no governance change.
   *   2. normalized_name + normalized_producer match (only when a producer
   *      is present, to avoid false-positive matches across unrelated wines
   *      that all share an empty producer) → link, no governance change.
   *   3. No match → create a Provisional (library_tier=3) row. It is
   *      immediately usable for this restaurant's inventory, but stays
   *      outside the canonical (tier 0) library until reviewed via /studio
   *      or the research/ontology pipeline.
   */
  async resolveOrCreateLibraryWine(
    item: LibraryResolutionInput,
  ): Promise<LibraryResolutionResult> {
    const signatureInput: SignatureInput = {
      name: item.name,
      producer: item.producer ?? null,
      vintage: item.vintage ?? null,
      country: item.country ?? null,
      region: item.region ?? null,
      grapeVariety: item.grapeVariety ?? null,
    };
    const signature = this.buildSignature(signatureInput);
    const signatureHash = this.hashSignature(signature);
    const normalizedName = this.normalizeText(item.name);
    const normalizedProducer = this.normalizeText(item.producer);

    const { data: exactMatch } = await this.dbService.supabase
      .from("master_wine_library")
      .select("id, library_tier")
      .eq("signature_hash", signatureHash)
      .maybeSingle();

    if (exactMatch?.id) {
      return {
        masterWineId: exactMatch.id,
        matched: true,
        libraryTier: exactMatch.library_tier ?? null,
      };
    }

    if (normalizedProducer) {
      const { data: nameProducerMatch } = await this.dbService.supabase
        .from("master_wine_library")
        .select("id, library_tier")
        .eq("normalized_name", normalizedName)
        .eq("normalized_producer", normalizedProducer)
        .limit(1)
        .maybeSingle();

      if (nameProducerMatch?.id) {
        return {
          masterWineId: nameProducerMatch.id,
          matched: true,
          libraryTier: nameProducerMatch.library_tier ?? null,
        };
      }
    }

    const parsedVintage =
      typeof item.vintage === "string"
        ? parseInt(item.vintage, 10) || null
        : (item.vintage ?? null);

    const insertPayload = {
      wine_id: this.generateWineId(),
      name: item.name,
      producer: item.producer || item.name,
      primary_type: "unknown",
      country: item.country || "Unknown",
      region: item.region ?? null,
      grape_variety: item.grapeVariety ?? null,
      vintage: parsedVintage,
      library_tier: 3, // Provisional — usable now, pending governance review
      source: "menu_import",
      signature_hash: signatureHash,
      normalized_name: normalizedName,
      normalized_producer: normalizedProducer,
      signature_source: "menu_import",
    };

    const { data: created, error } = await this.dbService.supabase
      .from("master_wine_library")
      .upsert(insertPayload, { onConflict: "signature_hash" })
      .select("id, library_tier")
      .single();

    if (error || !created) {
      this.logger.error("Failed to create provisional library wine", {
        error: error?.message,
        name: item.name,
      });
      throw new Error(
        `Failed to resolve library wine "${item.name}": ${error?.message}`,
      );
    }

    return {
      masterWineId: created.id,
      matched: false,
      libraryTier: created.library_tier ?? 3,
    };
  }
}
