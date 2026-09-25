import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { UpdateIntelligenceDto } from "./dto/update-intelligence.dto";

/**
 * NOTE — `createRetroactiveOrder` used to live here as well, as a near-copy of
 * the one in `providers.service.ts`. It was deleted on 2026-09-01: nothing
 * called it (no controller, no service, no test — grepped repo-wide), and the
 * two copies had already diverged, so a fix applied to the routed one would
 * have left a broken twin behind for the next reader to fix again. The live
 * implementation is `ProvidersService.createRetroactiveOrder`, routed from
 * `providers.controller.ts` `POST :id/retroactive-order`.
 *
 * TENANCY (ADR 0147) — every read here takes `restaurantId` and puts it in the
 * query. It is not optional and it is never defaulted: the controller reads it
 * from the verified token via `houseOf(user)` and a session that names no house
 * is refused there, so no call path can reach these methods without a house.
 * The parameter sits immediately after the id it scopes (or first, where there
 * is no id). `provider_knowledge`, `provider_promotions`,
 * `conversation_embeddings`, `provider_conversation_sessions` and
 * `provider_sentiment_history` all carry `restaurant_id NOT NULL`
 * (supabase/migrations/20260805000000_baseline_from_production.sql), so there
 * is no row these filters can wrongly hide. An empty string cannot leak either:
 * `restaurant_id` is `uuid`, and PostgREST answers 22P02 rather than matching.
 */
@Injectable()
export class ProviderIntelligenceService {
  private readonly logger = new Logger(ProviderIntelligenceService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  // =========================================================================
  // DIGITAL TWIN (Knowledge Graph)
  // =========================================================================

  async getKnowledge(
    providerId: string,
    restaurantId: string,
    category?: string,
  ) {
    await this.assertProviderInHouse(providerId, restaurantId);
    let query = this.databaseService.supabase
      .from("provider_knowledge")
      .select("*")
      .eq("provider_id", providerId)
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .order("category")
      .order("updated_at", { ascending: false });

    if (category) {
      query = query.eq("category", category);
    }

    const { data, error } = await query;

    if (error) {
      if (
        error.message?.includes("does not exist") ||
        error.message?.includes("relation") ||
        (error as any).code === "42P01" ||
        (error as any).code === "42703"
      ) {
        this.logger.warn(
          "provider_knowledge table/column not available yet, returning empty",
          {
            providerId,
            errorCode: (error as any).code,
            errorMessage: error.message,
          },
        );
        return {};
      }
      this.logger.error("Failed to fetch provider knowledge", {
        providerId,
        error: error.message,
      });
      throw error;
    }

    const grouped: Record<string, any[]> = {};
    for (const row of data || []) {
      const cat = row.category;
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push({
        id: row.id,
        subcategory: row.subcategory,
        label: row.label,
        attributes: row.attributes,
        confidence: row.confidence,
        verified: row.verified,
        version: row.version,
        expiresAt: row.expires_at,
        updatedAt: row.updated_at,
      });
    }

    return grouped;
  }

  async verifyKnowledge(
    knowledgeId: string,
    userId: string,
    restaurantId: string,
  ) {
    // `maybeSingle`, never `single`, for the reason spelled out on
    // `ProvidersService.getProvider`: `single()` turns "no row" into PGRST116,
    // which a caller cannot tell apart from a database that is down. A fact
    // belonging to another house must answer the same 404 as one that does not
    // exist, and it must not answer 500.
    const { data, error } = await this.databaseService.supabase
      .from("provider_knowledge")
      .update({ verified: true, verified_by: userId })
      .eq("id", knowledgeId)
      .eq("restaurant_id", restaurantId)
      .select("*")
      .maybeSingle();

    if (error && (error as { code?: string }).code !== "PGRST116") {
      this.logger.error("Failed to verify knowledge", {
        knowledgeId,
        error: error.message,
      });
      throw error;
    }

    if (!data) {
      throw new NotFoundException(
        `No knowledge fact with id ${knowledgeId} belongs to this restaurant.`,
      );
    }

    return data;
  }

  async getContradictions(providerId: string, restaurantId: string) {
    await this.assertProviderInHouse(providerId, restaurantId);
    const { data, error } = await this.databaseService.supabase
      .from("provider_knowledge")
      .select("*")
      .eq("provider_id", providerId)
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .not("previous_value", "is", null)
      .order("updated_at", { ascending: false });

    if (error) {
      if (
        error.message?.includes("does not exist") ||
        error.message?.includes("relation") ||
        (error as any).code === "42P01" ||
        (error as any).code === "42703"
      ) {
        this.logger.warn(
          "provider_knowledge table/column not available yet, returning empty",
          {
            providerId,
            errorCode: (error as any).code,
          },
        );
        return [];
      }
      this.logger.error("Failed to fetch contradictions", {
        providerId,
        error: error.message,
      });
      throw error;
    }

    return data || [];
  }

  // =========================================================================
  // PROMOTIONS
  // =========================================================================

  async getPromotions(
    providerId: string,
    restaurantId: string,
    status?: string,
  ) {
    await this.assertProviderInHouse(providerId, restaurantId);
    let query = this.databaseService.supabase
      .from("provider_promotions")
      .select("*")
      .eq("provider_id", providerId)
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false });

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;

    if (error) {
      this.logger.error("Failed to fetch promotions", {
        providerId,
        error: error.message,
      });
      throw error;
    }

    return data || [];
  }

  async getAllActivePromotions(restaurantId: string) {
    const { data, error } = await this.databaseService.supabase
      .from("provider_promotions")
      .select("*, providers(id, name)")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .order("end_date", { ascending: true });

    if (error) {
      this.logger.error("Failed to fetch active promotions", {
        error: error.message,
      });
      throw error;
    }

    return data || [];
  }

  async getExpiringPromotions(restaurantId: string, days: number = 7) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + days);

    const { data, error } = await this.databaseService.supabase
      .from("provider_promotions")
      .select("*, providers(id, name)")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .lte("end_date", cutoff.toISOString().split("T")[0])
      .order("end_date", { ascending: true });

    if (error) {
      this.logger.error("Failed to fetch expiring promotions", {
        error: error.message,
      });
      throw error;
    }

    return data || [];
  }

  async getPromoSavings(restaurantId: string) {
    const { data, error } = await this.databaseService.supabase
      .from("provider_promotions")
      .select("provider_id, savings_realized, times_used, providers(name)")
      .eq("restaurant_id", restaurantId)
      .gt("savings_realized", 0)
      .order("savings_realized", { ascending: false });

    if (error) {
      this.logger.error("Failed to fetch promo savings", {
        error: error.message,
      });
      throw error;
    }

    const totalSavings = (data || []).reduce(
      (sum, p) => sum + (parseFloat(p.savings_realized) || 0),
      0,
    );

    return {
      totalSavings,
      byProvider: data || [],
    };
  }

  async comparePromotions(restaurantId: string) {
    const { data, error } = await this.databaseService.supabase
      .from("provider_promotions")
      .select("*, providers(id, name)")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .order("promo_type")
      .order("provider_id");

    if (error) {
      this.logger.error("Failed to compare promotions", {
        error: error.message,
      });
      throw error;
    }

    const byType: Record<string, any[]> = {};
    for (const promo of data || []) {
      const type = promo.promo_type;
      if (!byType[type]) byType[type] = [];
      byType[type].push(promo);
    }

    return byType;
  }

  // =========================================================================
  // CONVERSATION MEMORY
  // =========================================================================

  async getConversationMemory(
    providerId: string,
    restaurantId: string,
    limit: number = 50,
  ) {
    await this.assertProviderInHouse(providerId, restaurantId);
    const { data, error } = await this.databaseService.supabase
      .from("conversation_embeddings")
      .select(
        "id, message_text, role, channel, importance_score, extracted_entities, language, created_at",
      )
      .eq("provider_id", providerId)
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      this.logger.error("Failed to fetch conversation memory", {
        providerId,
        error: error.message,
      });
      throw error;
    }

    return data || [];
  }

  /**
   * Search a provider's conversation history.
   *
   * OD-99. This used to call an RPC named `search_provider_conversations`
   * first, described in its own comment as "vector similarity search". No
   * CREATE FUNCTION for it exists anywhere in this repository and production
   * does not have it (PGRST202, verified 2026-08-26), so the call has failed
   * on every request and the `catch` below it has been the implementation
   * since the day it was written.
   *
   * The RPC call is deleted and the substring search promoted to the body:
   * same results, one fewer failed round trip per search, and no exception on
   * the happy path. This is honestly a substring search now and is no longer
   * dressed as a semantic one.
   *
   * `conversation_embeddings` really does exist and really does carry
   * embeddings, so a genuine vector search IS buildable here -- it is a
   * feature to build, not a repair to make, and it is filed as OD-104 rather
   * than left implied by a call to a function nobody wrote.
   */
  async searchConversationMemory(
    providerId: string,
    restaurantId: string,
    query: string,
  ) {
    await this.assertProviderInHouse(providerId, restaurantId);
    const { data, error } = await this.databaseService.supabase
      .from("conversation_embeddings")
      .select("id, message_text, role, channel, importance_score, created_at")
      .eq("provider_id", providerId)
      .eq("restaurant_id", restaurantId)
      .ilike("message_text", `%${query}%`)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      // ADR 0020: a failed search is not an empty result set.
      this.logger.error("Conversation memory search failed", {
        providerId,
        error: error.message,
      });
      throw error;
    }

    return data || [];
  }

  // =========================================================================
  // SESSIONS
  // =========================================================================

  async getSessions(
    providerId: string,
    restaurantId: string,
    includeCompleted: boolean = false,
  ) {
    await this.assertProviderInHouse(providerId, restaurantId);
    let query = this.databaseService.supabase
      .from("provider_conversation_sessions")
      .select("*")
      .eq("provider_id", providerId)
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false });

    if (!includeCompleted) {
      query = query.in("status", [
        "active",
        "paused_for_approval",
        "waiting_response",
        "follow_up_scheduled",
      ]);
    }

    const { data, error } = await query.limit(50);

    if (error) {
      this.logger.error("Failed to fetch sessions", {
        providerId,
        error: error.message,
      });
      throw error;
    }

    return data || [];
  }

  async getSessionSummary(sessionId: string, restaurantId: string) {
    // `maybeSingle` for the same reason as `verifyKnowledge`: a session id
    // belonging to another house answers the same 404 as one that does not
    // exist, and neither is a 500. `single()` used to make both a 500.
    const { data, error } = await this.databaseService.supabase
      .from("provider_conversation_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();

    if (error && (error as { code?: string }).code !== "PGRST116") {
      this.logger.error("Failed to fetch session summary", {
        sessionId,
        error: error.message,
      });
      throw error;
    }

    if (!data) {
      throw new NotFoundException(
        `No conversation session with id ${sessionId} belongs to this restaurant.`,
      );
    }

    return data;
  }

  /**
   * The vendor is this house's, or the caller gets the same 404 as for a
   * missing id (ADR 0147). Used by the two routes that WRITE a conversation
   * session against a provider id (`POST :id/outreach`, `POST :id/onboard`).
   * A failed read throws; it is never reported as "not found".
   */
  async assertProviderInHouse(
    providerId: string,
    restaurantId: string,
  ): Promise<void> {
    const { data, error } = await this.databaseService.supabase
      .from("providers")
      .select("id")
      .eq("id", providerId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();

    if (error) {
      this.logger.error("Failed to check the provider's house", {
        providerId,
        error: error.message,
      });
      throw error;
    }
    if (!data) {
      throw new NotFoundException(
        `No provider with id ${providerId} belongs to this restaurant.`,
      );
    }
  }

  // =========================================================================
  // SENTIMENT
  // =========================================================================

  /**
   * `provider_sentiment_history` carries its own `restaurant_id` (NOT NULL,
   * baseline `:4837`) — providers can be shared across houses via the
   * nullable `providers.restaurant_id`, so a provider-only filter here would
   * hand back another house's sentiment history for a shared provider
   * (2026-09-17 finding). `restaurantId` scopes the read the same way every
   * other provider route in this gateway scopes `providers` itself.
   */
  async getSentimentTrend(
    providerId: string,
    restaurantId: string,
    limit: number = 30,
  ) {
    await this.assertProviderInHouse(providerId, restaurantId);
    const { data, error } = await this.databaseService.supabase
      .from("provider_sentiment_history")
      .select(
        "sentiment, sentiment_score, detected_emotions, trigger_context, created_at",
      )
      .eq("provider_id", providerId)
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      this.logger.error("Failed to fetch sentiment trend", {
        providerId,
        error: error.message,
      });
      throw error;
    }

    const scores = (data || [])
      .filter((d) => d.sentiment_score != null)
      .map((d) => d.sentiment_score as number);

    const avgScore =
      scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

    return {
      averageScore: avgScore,
      trend:
        scores.length >= 2
          ? scores[0] > scores[scores.length - 1]
            ? "improving"
            : "declining"
          : "stable",
      dataPoints: data || [],
    };
  }

  // =========================================================================
  // CROSS-VENDOR INTELLIGENCE
  // =========================================================================

  /**
   * Was unscoped: every active provider in every restaurant, with its
   * reliability score, tier and (via the per-provider queries below) promotion,
   * sentiment and knowledge counts. `restaurantId` scopes the provider list and
   * all three per-provider aggregates, since each of those tables carries its
   * own `restaurant_id` independent of the provider row.
   *
   * The provider list is a plain `.eq("restaurant_id", ...)`, NOT the
   * shared-row idiom (`restaurant_id.is.null,restaurant_id.eq.<house>`) that
   * main briefly used here (#391). A `providers` row with a NULL house is not a
   * shared vendor anywhere else in this gateway — `ProvidersService.listProviders`
   * and `getProvider` both filter with `.eq`, so no house can list, open or
   * order from it. Those rows are orphans (bulk import wrote `restaurant_id`
   * NULL for every imported vendor until PR #412), i.e. ONE house's vendors
   * with the house dropped; admitting them here showed their names, tiers and
   * minimum orders to every house (2026-09-25 merge, PR #416).
   *
   * `providerIds` is a filter, not an assertion that each id exists. An id from
   * another house drops out of the result exactly the way an inactive or
   * soft-deleted id of this house already does — the endpoint has never told a
   * caller which of the ids it named were real, and it does not start now.
   * That keeps a foreign id indistinguishable from a missing one (ADR 0147),
   * with no existence oracle bolted onto a list route.
   */
  async compareProviders(restaurantId: string, providerIds?: string[]) {
    let query = this.databaseService.supabase
      .from("providers")
      .select(
        "id, name, reliability_score, tier, minimum_order, lead_time_days",
      )
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .is("deleted_at", null);

    if (providerIds && providerIds.length > 0) {
      query = query.in("id", providerIds);
    }

    const { data: providers, error: pErr } = await query;
    if (pErr) throw pErr;

    // Typed, because a bare `[]` infers `never[]` and every push is then an
    // error under strictNullChecks — the array shape here is heterogeneous by
    // design (provider fields plus computed aggregates).
    const result: Record<string, any>[] = [];
    for (const provider of providers || []) {
      const [promos, sentiment, knowledge] = await Promise.all([
        this.databaseService.supabase
          .from("provider_promotions")
          .select("id")
          .eq("provider_id", provider.id)
          .eq("restaurant_id", restaurantId)
          .eq("is_active", true),
        this.databaseService.supabase
          .from("provider_sentiment_history")
          .select("sentiment_score")
          .eq("provider_id", provider.id)
          .eq("restaurant_id", restaurantId)
          .order("created_at", { ascending: false })
          .limit(5),
        this.databaseService.supabase
          .from("provider_knowledge")
          .select("id")
          .eq("provider_id", provider.id)
          .eq("restaurant_id", restaurantId)
          .eq("is_active", true),
      ]);

      const sentimentScores = (sentiment.data || [])
        .filter((s) => s.sentiment_score != null)
        .map((s) => s.sentiment_score as number);

      result.push({
        ...provider,
        activePromoCount: promos.data?.length || 0,
        avgSentiment:
          sentimentScores.length > 0
            ? sentimentScores.reduce((a, b) => a + b, 0) /
              sentimentScores.length
            : null,
        knowledgeEntries: knowledge.data?.length || 0,
      });
    }

    return result;
  }

  async getLeverageSignals(restaurantId: string) {
    const { data, error } = await this.databaseService.supabase
      .from("provider_knowledge")
      .select("provider_id, label, attributes, providers(name)")
      .eq("restaurant_id", restaurantId)
      .eq("category", "relationship")
      .eq("subcategory", "leverage_signal")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      this.logger.error("Failed to fetch leverage signals", {
        error: error.message,
      });
      throw error;
    }

    return data || [];
  }

  // =========================================================================
  // PHASE 32: PROFILE INTELLIGENCE (D-32-11 / PROVINT-02)
  // =========================================================================

  async getIntelligence(
    providerId: string,
    restaurantId: string,
  ): Promise<{
    profile_foundational: Record<string, any>;
    profile_dynamic: Record<string, any>;
  }> {
    const { data, error } = await this.databaseService.supabase
      .from("providers")
      .select("profile_foundational, profile_dynamic")
      .eq("id", providerId)
      .eq("restaurant_id", restaurantId)
      .single();

    if (error) {
      this.logger.error("getIntelligence failed", {
        providerId,
        error: error.message,
      });
      throw error;
    }

    return {
      profile_foundational: (data as any).profile_foundational ?? {},
      profile_dynamic: (data as any).profile_dynamic ?? {},
    };
  }

  async updateIntelligence(
    providerId: string,
    restaurantId: string,
    dto: UpdateIntelligenceDto,
  ): Promise<{ success: boolean }> {
    // Fetch existing JSONB blobs so we can deep-merge rather than full-replace.
    // A full replace would wipe any fields the caller didn't include in the patch.
    const { data: existing, error: fetchError } =
      await this.databaseService.supabase
        .from("providers")
        .select("profile_foundational, profile_dynamic")
        .eq("id", providerId)
        .eq("restaurant_id", restaurantId)
        .single();

    if (fetchError) {
      this.logger.error("updateIntelligence: fetch failed", {
        providerId,
        error: fetchError.message,
      });
      throw fetchError;
    }

    const updatePayload: Record<string, any> = {};
    if (dto.profile_foundational !== undefined) {
      updatePayload.profile_foundational = {
        ...((existing as any)?.profile_foundational ?? {}),
        ...dto.profile_foundational,
      };
    }
    if (dto.profile_dynamic !== undefined) {
      updatePayload.profile_dynamic = {
        ...((existing as any)?.profile_dynamic ?? {}),
        ...dto.profile_dynamic,
      };
    }

    if (Object.keys(updatePayload).length === 0) {
      return { success: true };
    }

    const { error } = await this.databaseService.supabase
      .from("providers")
      .update(updatePayload)
      .eq("id", providerId)
      .eq("restaurant_id", restaurantId);

    if (error) {
      this.logger.error("updateIntelligence failed", {
        providerId,
        error: error.message,
      });
      throw error;
    }

    return { success: true };
  }

  /**
   * Returns top 3 actionable intelligence badge dimensions for provider card (PROVINT-05).
   * Priority: response_speed > negotiation_style > relationship_tier
   */
  getProfileSummary(
    profileDynamic: Record<string, any>,
  ): Array<{ key: string; label: string; value: string }> {
    const priorityKeys = [
      "response_speed",
      "negotiation_style",
      "relationship_tier",
    ];
    return priorityKeys
      .filter((k) => profileDynamic[k])
      .map((k) => ({
        key: k,
        label: k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        value: String(profileDynamic[k]).slice(0, 20),
      }))
      .slice(0, 3);
  }
}
