import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { UpdateIntelligenceDto } from "./dto/update-intelligence.dto";
import { RetroactiveOrderDto } from "./dto/retroactive-order.dto";

@Injectable()
export class ProviderIntelligenceService {
  private readonly logger = new Logger(ProviderIntelligenceService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  // =========================================================================
  // DIGITAL TWIN (Knowledge Graph)
  // =========================================================================

  async getKnowledge(providerId: string, category?: string) {
    let query = this.databaseService.supabase
      .from("provider_knowledge")
      .select("*")
      .eq("provider_id", providerId)
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

  async verifyKnowledge(knowledgeId: string, userId: string) {
    const { data, error } = await this.databaseService.supabase
      .from("provider_knowledge")
      .update({ verified: true, verified_by: userId })
      .eq("id", knowledgeId)
      .select("*")
      .single();

    if (error) {
      this.logger.error("Failed to verify knowledge", {
        knowledgeId,
        error: error.message,
      });
      throw error;
    }

    return data;
  }

  async getContradictions(providerId: string) {
    const { data, error } = await this.databaseService.supabase
      .from("provider_knowledge")
      .select("*")
      .eq("provider_id", providerId)
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

  async getPromotions(providerId: string, status?: string) {
    let query = this.databaseService.supabase
      .from("provider_promotions")
      .select("*")
      .eq("provider_id", providerId)
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

  async getAllActivePromotions() {
    const { data, error } = await this.databaseService.supabase
      .from("provider_promotions")
      .select("*, providers(id, name)")
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

  async getExpiringPromotions(days: number = 7) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + days);

    const { data, error } = await this.databaseService.supabase
      .from("provider_promotions")
      .select("*, providers(id, name)")
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

  async getPromoSavings() {
    const { data, error } = await this.databaseService.supabase
      .from("provider_promotions")
      .select("provider_id, savings_realized, times_used, providers(name)")
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

  async comparePromotions() {
    const { data, error } = await this.databaseService.supabase
      .from("provider_promotions")
      .select("*, providers(id, name)")
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

  async getConversationMemory(providerId: string, limit: number = 50) {
    const { data, error } = await this.databaseService.supabase
      .from("conversation_embeddings")
      .select(
        "id, message_text, role, channel, importance_score, extracted_entities, language, created_at",
      )
      .eq("provider_id", providerId)
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
  async searchConversationMemory(providerId: string, query: string) {
    const { data, error } = await this.databaseService.supabase
      .from("conversation_embeddings")
      .select("id, message_text, role, channel, importance_score, created_at")
      .eq("provider_id", providerId)
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

  async getSessions(providerId: string, includeCompleted: boolean = false) {
    let query = this.databaseService.supabase
      .from("provider_conversation_sessions")
      .select("*")
      .eq("provider_id", providerId)
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

  async getSessionSummary(sessionId: string) {
    const { data, error } = await this.databaseService.supabase
      .from("provider_conversation_sessions")
      .select("*")
      .eq("id", sessionId)
      .single();

    if (error) {
      this.logger.error("Failed to fetch session summary", {
        sessionId,
        error: error.message,
      });
      throw error;
    }

    return data;
  }

  // =========================================================================
  // SENTIMENT
  // =========================================================================

  async getSentimentTrend(providerId: string, limit: number = 30) {
    const { data, error } = await this.databaseService.supabase
      .from("provider_sentiment_history")
      .select(
        "sentiment, sentiment_score, detected_emotions, trigger_context, created_at",
      )
      .eq("provider_id", providerId)
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

  async compareProviders(providerIds?: string[]) {
    let query = this.databaseService.supabase
      .from("providers")
      .select(
        "id, name, reliability_score, tier, minimum_order, lead_time_days",
      )
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
          .eq("is_active", true),
        this.databaseService.supabase
          .from("provider_sentiment_history")
          .select("sentiment_score")
          .eq("provider_id", provider.id)
          .order("created_at", { ascending: false })
          .limit(5),
        this.databaseService.supabase
          .from("provider_knowledge")
          .select("id")
          .eq("provider_id", provider.id)
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

  async getLeverageSignals() {
    const { data, error } = await this.databaseService.supabase
      .from("provider_knowledge")
      .select("provider_id, label, attributes, providers(name)")
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

  /**
   * D-32-15 Scenario C: Create retroactive order from off-app invoice.
   * Inserts procurement_orders (status=delivered, source=retroactive),
   * procurement_conversations (direction=INBOUND), order_interactions (invoice_received).
   */
  async createRetroactiveOrder(
    providerId: string,
    restaurantId: string,
    dto: RetroactiveOrderDto,
  ): Promise<{
    orderId: string;
    conversationId: string;
    interactionId: string;
  }> {
    // 1. Insert retroactive procurement_order
    const retroOrderNumber = `RETRO-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

    const { data: orderData, error: orderError } =
      await this.databaseService.supabase
        .from("procurement_orders")
        .insert({
          restaurant_id: restaurantId,
          provider_id: providerId,
          order_number: retroOrderNumber,
          wine_name: dto.wineName,
          quantity: dto.quantity ?? null,
          final_confirmed_cost: dto.finalConfirmedCost ?? null,
          actual_delivery: dto.invoiceDate ?? null,
          status: "delivered",
          source: "retroactive",
        })
        .select("id")
        .single();

    if (orderError) {
      this.logger.error("createRetroactiveOrder: order insert failed", {
        error: orderError.message,
      });
      throw orderError;
    }

    const orderId = (orderData as any).id as string;

    // 2. Insert procurement_conversation (direction=INBOUND, contains email body)
    const { data: convData, error: convError } =
      await this.databaseService.supabase
        .from("procurement_conversations")
        .insert({
          order_id: orderId,
          provider_id: providerId,
          restaurant_id: restaurantId,
          direction: "INBOUND",
          channel: "email",
          content: dto.rawInvoiceContent ?? "",
          status: "DELIVERED",
          ai_summary: `Retroactive order created from off-app invoice ${dto.invoiceNumber ?? ""}.`,
        })
        .select("id")
        .single();

    if (convError) {
      this.logger.warn("createRetroactiveOrder: conversation insert failed", {
        error: convError.message,
      });
    }

    const conversationId = convData ? ((convData as any).id as string) : "";

    // 3. Insert order_interaction (interaction_type=invoice_received)
    const { data: intData, error: intError } =
      await this.databaseService.supabase
        .from("order_interactions")
        .insert({
          order_id: orderId,
          interaction_type: "invoice_received",
          channel: "email",
          content: dto.rawInvoiceContent ?? "",
          ai_summary: `Invoice ${dto.invoiceNumber ?? "unknown"} received; retroactive order created.`,
        })
        .select("id")
        .single();

    if (intError) {
      this.logger.warn("createRetroactiveOrder: interaction insert failed", {
        error: intError.message,
      });
    }

    return {
      orderId,
      conversationId,
      interactionId: intData ? ((intData as any).id as string) : "",
    };
  }
}
