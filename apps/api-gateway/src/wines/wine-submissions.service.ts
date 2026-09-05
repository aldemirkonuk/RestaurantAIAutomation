import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { CreateWineSubmissionDto } from "./dto/wine-submissions.dto";
import {
  buildWineSignature,
  hashProvisionalWineSignature,
  hashWineSignature,
  isSpecificWineIdentity,
  normalizeSignatureText,
  parsedVintageOrNull,
  wineSignatureHashOrNull,
  wineSignatureInputFromPayload,
} from "./wine-signature";

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
   * True when the identity was too generic to join the shared library, so the
   * row behind `masterWineId` belongs to the asking venue alone (ADR 0130).
   *
   * Reported rather than inferred from `matched`: an unmatched SPECIFIC wine
   * is a genuinely new bottle the shared library should enrich, and a
   * provisional one is a label only this venue uses. Collapsing the two is
   * what sent "House White Wine" to governance review as if it were a
   * discovery.
   */
  provisional?: boolean;
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
   * Public because it is the ONLY correct implementation.
   *
   * There were four: this one, another in wines.service.ts with a narrower
   * diacritic class, a `name.toLowerCase().trim()` in menus.service.ts, and
   * the SQL function. All four wrote the same columns. Anything that needs to
   * normalize a wine string must call this.
   *
   * The implementation moved to ./wine-signature — one module, so a fifth copy
   * cannot appear by accident. This stays as the app-facing name because
   * menus.service.ts and wines.service.ts call through it and the SQL-parity
   * spec pins it.
   */
  normalizeText(value?: string | null): string {
    return normalizeSignatureText(value);
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
    return hashWineSignature(input);
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
   * Mirrored by public.wine_signature_hash(). Field order and the constants
   * behind it now live in ./wine-signature.
   */
  private buildSignature(payload: SignatureInput): string {
    return buildWineSignature(payload);
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
    const signatureHash = this.signatureHashFor(payload);
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
      // Read through the tolerant payload reader rather than trusting the cast
      // above. This table is written by the NestJS DTO (camelCase), the menu
      // importer, and the Python menu-scan pipeline (snake_case, name under
      // `wine_name`) — and only the first of those matches the DTO type. Every
      // identity field below comes from this one reading, so the hash, the
      // matcher probe and the row eventually inserted cannot disagree about
      // what wine this is.
      const identity = wineSignatureInputFromPayload(payload);
      // Deliberately NOT `submission.signature_hash || …`. The stored value on
      // scan-pipeline rows comes from a different algorithm; preferring it
      // guarantees the lookup misses and then writes that foreign key format
      // into master_wine_library.signature_hash, which is UNIQUE and canonical.
      // Recomputing is what makes the two paths agree.
      const signatureHash = wineSignatureHashOrNull(identity);
      const normalizedName = normalizeSignatureText(identity.name);
      const normalizedProducer = normalizeSignatureText(identity.producer);

      // No name means no identity. Matching on an empty normalized_name would
      // pair this row with every other nameless row in the library, and the
      // provisional insert below would claim a UNIQUE key over nothing.
      if (!signatureHash) {
        await this.dbService.supabase
          .from("master_wine_library_submissions")
          .update({
            status: "pending_review",
            decision_reason: "unidentifiable_payload_no_name",
          })
          .eq("id", submission.id);
        results.push({ id: submission.id, status: "pending_review" });
        continue;
      }

      // Matching is delegated to the same RPC the menu importer uses. This
      // path used to run its own ladder — exact signature, then
      // normalized_name + normalized_producer equality with `.limit(1)` and no
      // ORDER BY — which carried every defect the importer's copy did:
      // unreachable across the library's two naming styles, blind to
      // abbreviated producers, and non-deterministic whenever duplicates
      // existed. Two matchers on one table also means two answers for one
      // wine depending on which door it came through, which is what put
      // primary_type in the signature and split the key space in the first
      // place.
      const { data: candidates, error: matchError } =
        await this.dbService.supabase.rpc("match_library_wine", {
          p_name: identity.name,
          p_producer: identity.producer ?? null,
          p_vintage:
            typeof identity.vintage === "string"
              ? parseInt(identity.vintage, 10) || null
              : (identity.vintage ?? null),
          p_country: identity.country ?? null,
          p_region: identity.region ?? null,
          p_grape_variety: identity.grapeVariety ?? null,
        });

      // Leave the submission pending rather than treating an outage as "this
      // wine is new" — that is how duplicates get created.
      if (matchError) {
        this.logger.error("Library match failed for submission", {
          id: submission.id,
          error: matchError.message,
        });
        results.push({ id: submission.id, status: "pending" });
        continue;
      }

      const best = (candidates ?? [])[0];

      if (
        best &&
        best.confidence >= WineSubmissionsService.AUTO_LINK_CONFIDENCE
      ) {
        await this.dbService.supabase
          .from("master_wine_library_submissions")
          .update({
            status: "merged",
            matched_master_id: best.id,
            decision_reason: `library_match_${best.confidence}`,
            signature_hash: signatureHash,
          })
          .eq("id", submission.id);
        results.push({
          id: submission.id,
          status: "merged",
          matchedMasterId: best.id,
        });
        continue;
      }

      // A near miss is the case a human should look at: close enough that
      // creating a second row is probably wrong, not close enough to link
      // automatically. Governance keeps this conservative on purpose.
      if (best) {
        await this.dbService.supabase
          .from("master_wine_library_submissions")
          .update({
            status: "pending_review",
            decision_reason: `near_match_${best.confidence}`,
            matched_master_id: best.id,
            signature_hash: signatureHash,
          })
          .eq("id", submission.id);
        results.push({ id: submission.id, status: "pending_review" });
        continue;
      }

      const wineId = payload["wineId"] || this.generateWineId();
      // Identity columns come from the same resolved reading the hash was
      // computed over. Reading payload.name here directly was the second half
      // of the same defect: a snake_case payload hashed correctly off
      // `wine_name` and then wrote NULL into master_wine_library.name, leaving
      // a canonical row that no future match could ever recognise.
      const insertPayload = {
        wine_id: wineId,
        name: identity.name,
        producer: identity.producer,
        vintage: identity.vintage ?? null,
        price_reference: payload.priceReference ?? null,
        primary_type: identity.primaryType ?? "unknown",
        grape_variety: identity.grapeVariety ?? null,
        country: identity.country ?? "Unknown",
        region: identity.region ?? "Unknown",
        appellation: identity.appellation ?? null,
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
    restaurantId: string,
  ): Promise<LibraryResolutionResult> {
    const parsedVintage = parsedVintageOrNull(item.vintage);

    // ADR 0130. A generic, producer-less name never reaches the shared
    // library — not to match it, not to be matched by it. It becomes this
    // venue's own provisional wine.
    if (!isSpecificWineIdentity(item)) {
      return this.resolveVenueProvisionalWine(
        item,
        restaurantId,
        parsedVintage,
      );
    }

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
    if (
      best &&
      best.confidence >= WineSubmissionsService.AUTO_LINK_CONFIDENCE
    ) {
      return {
        masterWineId: best.id,
        matched: true,
        libraryTier: best.library_tier ?? null,
        confidence: best.confidence,
      };
    }

    const signatureHash = this.signatureHashFor({
      name: item.name,
      producer: item.producer ?? null,
      vintage: parsedVintage,
      country: item.country ?? null,
      region: item.region ?? null,
      grapeVariety: item.grapeVariety ?? null,
    });

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

  /**
   * The venue's own wine, for a name that identifies nothing (ADR 0130).
   *
   * `restaurant_inventory.master_wine_id` is NOT NULL, so "do not join the
   * shared library" cannot mean "no library row" — it means a library row
   * that belongs to one venue and is a match target for nobody.
   * `provisional_for_restaurant_id` says which venue, and
   * `trg_sync_signature_hash` keys such a row on
   * `wine_provisional_signature_hash(owner, ...)` instead of the shared
   * six-field hash. Two venues' "House White Wine" therefore occupy two rows
   * under the same UNIQUE index, and this venue re-scanning its own menu
   * lands back on its own row instead of spawning a duplicate.
   *
   * The matcher is not consulted at all. Consulting it and discarding the
   * answer would still leave the decision to a confidence score; the rule is
   * that a generic identity has nothing to compare, so there is nothing to
   * score.
   */
  private async resolveVenueProvisionalWine(
    item: LibraryResolutionInput,
    restaurantId: string,
    parsedVintage: number | null,
  ): Promise<LibraryResolutionResult> {
    if (!restaurantId) {
      // Better to fail the line than to fall back to the shared library: an
      // unowned generic row is exactly the cross-tenant collision this exists
      // to stop.
      throw new Error(
        `Cannot resolve "${item.name}" without a restaurant: a name this ` +
          `generic is only ever one venue's own wine`,
      );
    }

    const signatureHash = hashProvisionalWineSignature(restaurantId, {
      name: item.name,
      producer: item.producer ?? null,
      vintage: parsedVintage,
      country: item.country ?? null,
      region: item.region ?? null,
      grapeVariety: item.grapeVariety ?? null,
    });

    const insertPayload = {
      wine_id: this.generateWineId(),
      name: item.name,
      // Empty, not invented. `producer` and `country` are NOT NULL columns,
      // which is why the shared path writes the wine's own name and the
      // literal "Unknown" into them; that fabrication is the ops track's to
      // remove. It cannot be carried here, because the hash the trigger
      // recomputes is taken from the STORED fields: writing "Unknown" into
      // country while keying the lookup on an absent one makes this venue
      // unable to find its own row on the next scan. `wine_normalize_text`
      // maps NULL and '' to the same empty segment, so '' hashes identically
      // to the absence it records — and keeps hashing identically once those
      // columns are made nullable.
      producer: item.producer ?? "",
      primary_type: "unknown",
      country: item.country ?? "",
      region: item.region ?? null,
      grape_variety: item.grapeVariety ?? null,
      vintage: parsedVintage,
      library_tier: 3, // Provisional — usable now, pending governance review
      source: "venue_provisional",
      signature_hash: signatureHash,
      normalized_name: this.normalizeText(item.name),
      normalized_producer: this.normalizeText(item.producer),
      signature_source: "venue_provisional",
      provisional_for_restaurant_id: restaurantId,
    };

    const { data: created, error } = await this.dbService.supabase
      .from("master_wine_library")
      .upsert(insertPayload, {
        onConflict: "signature_hash",
        ignoreDuplicates: true,
      })
      .select("id, library_tier")
      .maybeSingle();

    if (error) {
      this.logger.error("Failed to create venue provisional wine", {
        error: error.message,
        name: item.name,
        restaurantId,
      });
      throw new Error(
        `Failed to resolve venue wine "${item.name}": ${error.message}`,
      );
    }

    if (created?.id) {
      return {
        masterWineId: created.id,
        matched: false,
        provisional: true,
        libraryTier: created.library_tier ?? 3,
        confidence: null,
      };
    }

    // ignoreDuplicates returns no row when this venue already has this wine.
    // Scoped by owner as well as by hash: reading by hash alone would be
    // correct today only because the hash carries the owner, and a lookup
    // that relies on that is one refactor away from reading another venue's
    // row.
    const { data: existing, error: readError } = await this.dbService.supabase
      .from("master_wine_library")
      .select("id, library_tier")
      .eq("signature_hash", signatureHash)
      .eq("provisional_for_restaurant_id", restaurantId)
      .maybeSingle();

    if (readError) {
      throw new Error(
        `Failed to read back venue wine "${item.name}": ${readError.message}`,
      );
    }

    if (existing?.id) {
      return {
        masterWineId: existing.id,
        matched: false,
        provisional: true,
        libraryTier: existing.library_tier ?? 3,
        confidence: null,
      };
    }

    throw new Error(
      `Failed to resolve venue wine "${item.name}": insert was skipped but ` +
        `no row carries signature ${signatureHash.slice(0, 12)}`,
    );
  }

  /**
   * Resolve a whole menu at once.
   *
   * resolveOrCreateLibraryWine is one round trip per wine, and against this
   * project's pooler each is ~320-380ms — almost entirely network, since the
   * query itself runs in single-digit milliseconds off the indexes. Measured
   * on a real 182-wine extraction scaled to RL Restaurant's 485:
   *
   *     per wine   183.12s   (378ms each)
   *     batched      0.91s
   *                  202x
   *
   * No amount of index work touches that; the round trips are the cost. This
   * collapses an import to three statements regardless of menu size: one match,
   * one bulk insert of the wines that matched nothing, one read-back.
   *
   * Results are index-aligned with `items`, which the caller depends on to zip
   * them against its own array. Aligning on name would be wrong — the same
   * wine legitimately appears twice on a menu (by the glass and by the
   * bottle), so position is the only correct join.
   */
  async resolveLibraryWinesBatch(
    items: LibraryResolutionInput[],
    restaurantId: string,
  ): Promise<Array<LibraryResolutionResult | null>> {
    if (items.length === 0) return [];

    const parseVintage = parsedVintageOrNull;

    // ADR 0130. Every generic line on the menu is this venue's own wine.
    // The whole array is still sent to the matcher — match_library_wine
    // returns nothing for a query that is not specific, so the generic lines
    // come back empty and index alignment is preserved — but the decision is
    // taken here as well, so the rule survives a matcher that forgets it.
    const isSpecific = items.map((i) => isSpecificWineIdentity(i));
    if (isSpecific.some((s) => !s) && !restaurantId) {
      throw new Error(
        "Cannot resolve a menu with generic wine names without a restaurant: " +
          "a name that generic is only ever one venue's own wine",
      );
    }

    const { data: matches, error: matchError } =
      await this.dbService.supabase.rpc("match_library_wines_batch", {
        p_wines: items.map((i) => ({
          name: i.name,
          producer: i.producer ?? null,
          vintage: i.vintage == null ? null : String(i.vintage),
          country: i.country ?? null,
          region: i.region ?? null,
          grape_variety: i.grapeVariety ?? null,
        })),
      });

    // A matcher outage must not be downgraded into "none of these exist" —
    // that would fabricate a duplicate for every wine on the menu.
    if (matchError) {
      throw new Error(`Library batch match failed: ${matchError.message}`);
    }

    const byIndex = new Map<number, any>();
    for (const row of matches ?? []) {
      if (row?.id) byIndex.set(row.input_index, row);
    }

    const results: Array<LibraryResolutionResult | null> = new Array(
      items.length,
    ).fill(null);
    const needsCreate: number[] = [];

    items.forEach((_, idx) => {
      const best = byIndex.get(idx);
      if (
        isSpecific[idx] &&
        best &&
        best.confidence >= WineSubmissionsService.AUTO_LINK_CONFIDENCE
      ) {
        results[idx] = {
          masterWineId: best.id,
          matched: true,
          libraryTier: best.library_tier ?? null,
          confidence: best.confidence,
        };
      } else {
        needsCreate.push(idx);
      }
    });

    if (needsCreate.length === 0) return results;

    // Two wines on one menu can share a signature — the same bottle listed by
    // the glass and by the bottle. Insert one row per distinct signature and
    // fan the resulting id back out, rather than letting Postgres reject the
    // statement for touching a conflict target twice.
    const signatureOf = new Map<number, string>();
    const rowBySignature = new Map<string, Record<string, unknown>>();

    for (const idx of needsCreate) {
      const item = items[idx];
      const vintage = parseVintage(item.vintage);
      const identity = {
        name: item.name,
        producer: item.producer ?? null,
        vintage,
        country: item.country ?? null,
        region: item.region ?? null,
        grapeVariety: item.grapeVariety ?? null,
      };
      // A specific wine that matched nothing is a new bottle for the shared
      // library. A generic one is this venue's own, keyed behind the venue id
      // so another venue printing the same words does not collide with it
      // (ADR 0130).
      const provisional = !isSpecific[idx];
      const signatureHash = provisional
        ? hashProvisionalWineSignature(restaurantId, identity)
        : this.signatureHashFor(identity);
      signatureOf.set(idx, signatureHash);
      if (!rowBySignature.has(signatureHash)) {
        rowBySignature.set(signatureHash, {
          wine_id: this.generateWineId(),
          name: item.name,
          // A venue's own row records absence as absence — see
          // resolveVenueProvisionalWine for why it cannot inherit the shared
          // path's fabricated producer/country and still find itself again.
          producer: provisional
            ? (item.producer ?? "")
            : item.producer || item.name,
          primary_type: "unknown",
          country: provisional
            ? (item.country ?? "")
            : item.country || "Unknown",
          region: item.region ?? null,
          grape_variety: item.grapeVariety ?? null,
          vintage,
          library_tier: 3,
          source: provisional ? "venue_provisional" : "menu_import",
          signature_hash: signatureHash,
          normalized_name: this.normalizeText(item.name),
          normalized_producer: this.normalizeText(item.producer),
          signature_source: provisional ? "venue_provisional" : "menu_import",
          provisional_for_restaurant_id: provisional ? restaurantId : null,
        });
      }
    }

    const { error: insertError } = await this.dbService.supabase
      .from("master_wine_library")
      .upsert([...rowBySignature.values()], {
        onConflict: "signature_hash",
        ignoreDuplicates: true,
      });

    if (insertError) {
      throw new Error(
        `Failed to create ${rowBySignature.size} provisional library wine(s): ` +
          insertError.message,
      );
    }

    // Read back by signature rather than trusting the insert's RETURNING:
    // ignoreDuplicates omits rows a concurrent import already created, and
    // those rows are exactly the ones we still need ids for.
    const signatures = [...rowBySignature.keys()];
    const { data: created, error: readError } = await this.dbService.supabase
      .from("master_wine_library")
      .select("id, library_tier, signature_hash")
      .in("signature_hash", signatures);

    if (readError) {
      throw new Error(
        `Failed to read back provisional library wines: ${readError.message}`,
      );
    }

    const idBySignature = new Map(
      (created ?? []).map((r) => [r.signature_hash, r]),
    );

    for (const idx of needsCreate) {
      const row = idBySignature.get(signatureOf.get(idx) as string);
      if (!row) continue; // stays null — the caller reports it as unlinked
      results[idx] = {
        masterWineId: row.id,
        matched: false,
        provisional: !isSpecific[idx],
        libraryTier: row.library_tier ?? 3,
        // A generic line was never scored, so there is no confidence to
        // report. Carrying the matcher's number here would attach a score to
        // a comparison that did not happen.
        confidence: isSpecific[idx]
          ? (byIndex.get(idx)?.confidence ?? null)
          : null,
      };
    }

    return results;
  }
}
