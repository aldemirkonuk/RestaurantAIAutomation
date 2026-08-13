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

/**
 * Structural subset shared by CreateWineSubmissionDto and menu-import items.
 *
 * primaryType is absent deliberately — see buildSignature.
 */
interface SignatureInput {
  name: string;
  producer?: string | null;
  vintage?: string | number | null;
  country?: string | null;
  region?: string | null;
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
  /**
   * Score of the best candidate, 0-100, or null when nothing came back.
   *
   * Populated even when `matched` is false: a wine that scored 79 against a
   * real library entry is a review candidate, and a wine that scored nothing
   * is a genuinely new bottle that needs enrichment. Collapsing both into
   * "unmatched" is what makes the two indistinguishable downstream.
   */
  confidence: number | null;
}

@Injectable()
export class WineSubmissionsService {
  private readonly logger = new Logger(WineSubmissionsService.name);

  constructor(private readonly dbService: DatabaseService) {}

  /**
   * Diacritics to delete rather than turn into a space.
   *
   * This is deliberately an explicit class and not `\p{Diacritic}`, because
   * the same rule has to run in Postgres (public.wine_normalize_text) to key
   * the same columns, and Postgres regex has no Unicode property classes.
   * When the two drifted, one library row diverged: Catalan "Xarel·lo"
   * normalized to "xarello" here and "xarel lo" there, because U+00B7 is a
   * Diacritic to JS but was not in the SQL class.
   *
   * `\p{Diacritic}` covers 659 codepoints this omits, all of them Hebrew,
   * Arabic, Indic, Thai, Tibetan, Burmese or CJK. Deleting versus spacing only
   * changes the outcome when the character sits BETWEEN Latin alphanumerics —
   * a run of non-Latin text collapses to spaces either way — so the Latin and
   * Greek subset below is the part that can actually alter a wine name.
   *
   * Parity with the SQL function is asserted in the spec, not assumed.
   */
  private static readonly DIACRITICS =
    /[̀-ͯ᪰-᫿᷀-᷿︠-︯^`¨¯´·¸ʰ-˿ʹ͵ͺ΄΅]/g;

  /**
   * Trade abbreviations a menu prints, expanded to the word they stand for.
   *
   * Measured before this existed: of 27 library producers beginning with an
   * abbreviable trade word, rewritten the way a menu prints them, ZERO reached
   * the auto-link floor. "Dom. Faiveley" produced no candidate at all against
   * "Domaine Faiveley"; "Ten. di Arceno" scored 62 against "Tenuta di Arceno".
   * Every one of them silently created a duplicate.
   *
   * Trigram similarity is the wrong instrument for a prefix truncation --
   * "dom" and "domaine" share two trigrams out of five however exactly the
   * rest of the name agrees. Lowering the producer gate far enough to reach 62
   * would admit "chateau musar" vs "chateau de bligny" at 0.571 and every
   * other shared-trade-word false positive. So the fix belongs here: these are
   * the same word, and the normalizer should say so.
   *
   * The trailing period is required on every pattern. Bare "dom" is not an
   * abbreviation -- Dom Perignon is a wine, and expanding it would invent a
   * producer that does not exist. Multi-token patterns come first so
   * "az. agr." expands as a unit rather than "az." matching alone.
   *
   * Mirrored exactly by public.wine_normalize_text; the spec fails on drift.
   */
  private static readonly ABBREVIATIONS: ReadonlyArray<
    readonly [RegExp, string]
  > = [
    [/\baz\.\s*agr\.\s*/g, "azienda agricola "],
    [/\bdom\.\s*/g, "domaine "],
    [/\bch\.\s*/g, "chateau "],
    [/\bcht\.\s*/g, "chateau "],
    [/\bbod\.\s*/g, "bodegas "],
    [/\bwgt\.\s*/g, "weingut "],
    [/\bten\.\s*/g, "tenuta "],
    [/\bfatt\.\s*/g, "fattoria "],
    [/\bcant\.\s*/g, "cantina "],
    [/\bmarch\.\s*/g, "marchesi "],
    [/\bste\.\s*/g, "sainte "],
    [/\bst\.\s*/g, "saint "],
    [/\bmt\.\s*/g, "monte "],
  ];


  /**
   * Public because it is the ONLY correct implementation.
   *
   * There were four: this one, another in wines.service.ts with a narrower
   * diacritic class, a `name.toLowerCase().trim()` in menus.service.ts, and
   * the SQL function. All four wrote the same columns. Anything that needs to
   * normalize a wine string must call this.
   */
  normalizeText(value?: string | null): string {
    if (!value) return "";
    let s = value
      .normalize("NFD")
      .replace(WineSubmissionsService.DIACRITICS, "")
      .toLowerCase();
    for (const [pattern, expansion] of WineSubmissionsService.ABBREVIATIONS) {
      s = s.replace(pattern, expansion);
    }
    return s.replace(/[^a-z0-9]+/g, " ").trim();
  }

  /**
   * The signature hash for a wine, under the one contract that
   * master_wine_library.signature_hash is keyed on.
   *
   * Public for the same reason as normalizeText: wines.service.ts had its own
   * version that dropped empty segments with `.filter(Boolean)` and added
   * primary_type and appellation, so wines it created were unreachable from
   * the menu-import path and from the SQL mirror. Dropping empty segments is
   * the specific bug documented at length in vendor-intel/wine-identity.ts —
   * it lets a missing producer shift the name into the producer's slot.
   */
  signatureHashFor(input: SignatureInput): string {
    return this.hashSignature(this.buildSignature(input));
  }

  /**
   * The master-library dedup key.
   *
   * primary_type used to occupy a slot here, and that silently split the key
   * space in two: submitWine() passed a value for it and
   * resolveOrCreateLibraryWine() did not, so the same bottle hashed two
   * different ways depending on which door it came through. It is a derived
   * classification rather than an identity attribute — a menu never prints it
   * — so removing it is what makes the two paths agree.
   *
   * Mirrored by public.wine_signature_hash().
   */
  private buildSignature(payload: SignatureInput): string {
    return [
      this.normalizeText(payload.producer),
      this.normalizeText(payload.name),
      payload.vintage ?? "NV",
      this.normalizeText(payload.country),
      this.normalizeText(payload.region),
      this.normalizeText(payload.grapeVariety),
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
   * Confidence at or above which a candidate is linked without review.
   *
   * Set from measurement, not taste. 660 probes derived from real library rows
   * and perturbed the way menus actually print them (bare name against a
   * verbose library entry, producer trade-suffix dropped, both at once) recall
   * the correct row at 0.966-1.000 and score 100 when the vintage agrees. The
   * one perturbation that lands below this line is an abbreviated producer
   * ("Dom. Mandeliere" for "Domaine de la Mandeliere") at 73, which is
   * genuinely ambiguous and belongs in review rather than auto-linked.
   */
  private static readonly AUTO_LINK_CONFIDENCE = 85;

  /**
   * Synchronous match-or-create against master_wine_library, used by the menu
   * importer so it can populate menu_items.wine_library_id and
   * restaurant_inventory.master_wine_id immediately (both are FK targets and
   * cannot be left null the way the old fire-and-forget submission path did).
   *
   * Matching is delegated to the match_library_wine RPC. Three reasons it does
   * not belong here as PostgREST calls:
   *
   *   - It was three round trips per wine (exact, fallback, insert). RL
   *     Restaurant's menu is 485 wines, so ~1,500 round trips for one import.
   *   - The fallback compared normalized_name for exact equality, and the
   *     library stores names in two styles depending on which importer wrote
   *     the row: "chardonnay" and "2022 olivier leflaive les setilles
   *     bourgogne france". Half the library was unreachable. Bridging that
   *     needs trigram word-similarity, which has to run in the database to use
   *     the index.
   *   - The fallback was `.limit(1)` with no ORDER BY, so when the library
   *     held duplicates (it holds 14 such groups) the same menu linked to a
   *     different row on each import.
   *
   * Below the auto-link floor the wine still gets a Provisional
   * (library_tier=3) row so the import completes and inventory works, but
   * `matched: false` marks it for governance review via /studio or the
   * research pipeline. Near-miss candidates are returned so the caller can
   * show a reviewer what it nearly matched instead of making them search.
   */
  async resolveOrCreateLibraryWine(
    item: LibraryResolutionInput,
  ): Promise<LibraryResolutionResult> {
    const parsedVintage =
      typeof item.vintage === "string"
        ? parseInt(item.vintage, 10) || null
        : (item.vintage ?? null);

    const { data: candidates, error: matchError } =
      await this.dbService.supabase.rpc("match_library_wine", {
        p_name: item.name,
        p_producer: item.producer ?? null,
        p_vintage: parsedVintage,
        p_country: item.country ?? null,
        p_region: item.region ?? null,
        p_grape_variety: item.grapeVariety ?? null,
      });

    // A matcher failure must not be silently downgraded into "no match" —
    // that would fabricate a duplicate library row for a wine that exists.
    if (matchError) {
      throw new Error(
        `Library match failed for "${item.name}": ${matchError.message}`,
      );
    }

    const best = (candidates ?? [])[0];
    if (best && best.confidence >= WineSubmissionsService.AUTO_LINK_CONFIDENCE) {
      return {
        masterWineId: best.id,
        matched: true,
        libraryTier: best.library_tier ?? null,
        confidence: best.confidence,
      };
    }

    const signatureHash = this.hashSignature(
      this.buildSignature({
        name: item.name,
        producer: item.producer ?? null,
        vintage: parsedVintage,
        country: item.country ?? null,
        region: item.region ?? null,
        grapeVariety: item.grapeVariety ?? null,
      }),
    );

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
      normalized_name: this.normalizeText(item.name),
      normalized_producer: this.normalizeText(item.producer),
      signature_source: "menu_import",
    };

    // ignoreDuplicates rather than the default merge. Two concurrent imports
    // of the same wine race here, and an upsert that merges would overwrite
    // the row the other request just created — including stamping
    // primary_type back to "unknown" and library_tier back to 3 if the loser
    // happened to collide with a curated row. Losing the race is fine; the
    // winner's row is the one we want, so re-read it.
    const { data: created, error } = await this.dbService.supabase
      .from("master_wine_library")
      .upsert(insertPayload, {
        onConflict: "signature_hash",
        ignoreDuplicates: true,
      })
      .select("id, library_tier")
      .maybeSingle();

    if (error) {
      this.logger.error("Failed to create provisional library wine", {
        error: error.message,
        name: item.name,
      });
      throw new Error(
        `Failed to resolve library wine "${item.name}": ${error.message}`,
      );
    }

    if (created?.id) {
      return {
        masterWineId: created.id,
        matched: false,
        libraryTier: created.library_tier ?? 3,
        confidence: best?.confidence ?? null,
      };
    }

    // ignoreDuplicates returns no row when the insert was skipped, which means
    // a concurrent request already created it. Read that row rather than
    // failing an import over a race we expected.
    const { data: existing } = await this.dbService.supabase
      .from("master_wine_library")
      .select("id, library_tier")
      .eq("signature_hash", signatureHash)
      .maybeSingle();

    if (existing?.id) {
      return {
        masterWineId: existing.id,
        matched: true,
        libraryTier: existing.library_tier ?? null,
        confidence: best?.confidence ?? null,
      };
    }

    throw new Error(
      `Failed to resolve library wine "${item.name}": insert was skipped but ` +
        `no row carries signature ${signatureHash.slice(0, 12)}`,
    );
  }
}
