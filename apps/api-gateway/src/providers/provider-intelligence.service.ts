import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class ProviderIntelligenceService {
  private readonly logger = new Logger(ProviderIntelligenceService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  // =========================================================================
  // DIGITAL TWIN (Knowledge Graph)
  // =========================================================================

  async getKnowledge(providerId: string, category?: string) {
    let query = this.databaseService.supabase
      .from('provider_knowledge')
      .select('*')
      .eq('provider_id', providerId)
      .eq('is_active', true)
      .order('category')
      .order('updated_at', { ascending: false });

    if (category) {
      query = query.eq('category', category);
    }

    const { data, error } = await query;

    if (error) {
      this.logger.error('Failed to fetch provider knowledge', { providerId, error: error.message });
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
      .from('provider_knowledge')
      .update({ verified: true, verified_by: userId })
      .eq('id', knowledgeId)
      .select('*')
      .single();

    if (error) {
      this.logger.error('Failed to verify knowledge', { knowledgeId, error: error.message });
      throw error;
    }

    return data;
  }

  async getContradictions(providerId: string) {
    const { data, error } = await this.databaseService.supabase
      .from('provider_knowledge')
      .select('*')
      .eq('provider_id', providerId)
      .eq('is_active', true)
      .not('previous_value', 'is', null)
      .order('updated_at', { ascending: false });

    if (error) {
      this.logger.error('Failed to fetch contradictions', { providerId, error: error.message });
      throw error;
    }

    return data || [];
  }

  // =========================================================================
  // PROMOTIONS
  // =========================================================================

  async getPromotions(providerId: string, status?: string) {
    let query = this.databaseService.supabase
      .from('provider_promotions')
      .select('*')
      .eq('provider_id', providerId)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      this.logger.error('Failed to fetch promotions', { providerId, error: error.message });
      throw error;
    }

    return data || [];
  }

  async getAllActivePromotions() {
    const { data, error } = await this.databaseService.supabase
      .from('provider_promotions')
      .select('*, providers(id, name)')
      .eq('status', 'active')
      .order('end_date', { ascending: true });

    if (error) {
      this.logger.error('Failed to fetch active promotions', { error: error.message });
      throw error;
    }

    return data || [];
  }

  async getExpiringPromotions(days: number = 7) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + days);

    const { data, error } = await this.databaseService.supabase
      .from('provider_promotions')
      .select('*, providers(id, name)')
      .eq('status', 'active')
      .lte('end_date', cutoff.toISOString().split('T')[0])
      .order('end_date', { ascending: true });

    if (error) {
      this.logger.error('Failed to fetch expiring promotions', { error: error.message });
      throw error;
    }

    return data || [];
  }

  async getPromoSavings() {
    const { data, error } = await this.databaseService.supabase
      .from('provider_promotions')
      .select('provider_id, savings_realized, times_used, providers(name)')
      .gt('savings_realized', 0)
      .order('savings_realized', { ascending: false });

    if (error) {
      this.logger.error('Failed to fetch promo savings', { error: error.message });
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
      .from('provider_promotions')
      .select('*, providers(id, name)')
      .eq('status', 'active')
      .order('promo_type')
      .order('provider_id');

    if (error) {
      this.logger.error('Failed to compare promotions', { error: error.message });
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
      .from('conversation_embeddings')
      .select('id, message_text, role, channel, importance_score, extracted_entities, language, created_at')
      .eq('provider_id', providerId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      this.logger.error('Failed to fetch conversation memory', { providerId, error: error.message });
      throw error;
    }

    return data || [];
  }

  async searchConversationMemory(providerId: string, query: string) {
    // Uses the Supabase RPC for vector similarity search
    try {
      const { data, error } = await this.databaseService.supabase
        .rpc('search_provider_conversations', {
          search_provider_id: providerId,
          search_query: query,
          match_count: 20,
        });

      if (error) throw error;
      return data || [];
    } catch {
      // Fallback: text search
      const { data } = await this.databaseService.supabase
        .from('conversation_embeddings')
        .select('id, message_text, role, channel, importance_score, created_at')
        .eq('provider_id', providerId)
        .ilike('message_text', `%${query}%`)
        .order('created_at', { ascending: false })
        .limit(20);

      return data || [];
    }
  }

  // =========================================================================
  // SESSIONS
  // =========================================================================

  async getSessions(providerId: string, includeCompleted: boolean = false) {
    let query = this.databaseService.supabase
      .from('provider_conversation_sessions')
      .select('*')
      .eq('provider_id', providerId)
      .order('created_at', { ascending: false });

    if (!includeCompleted) {
      query = query.in('status', ['active', 'paused_for_approval', 'waiting_response', 'follow_up_scheduled']);
    }

    const { data, error } = await query.limit(50);

    if (error) {
      this.logger.error('Failed to fetch sessions', { providerId, error: error.message });
      throw error;
    }

    return data || [];
  }

  async getSessionSummary(sessionId: string) {
    const { data, error } = await this.databaseService.supabase
      .from('provider_conversation_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (error) {
      this.logger.error('Failed to fetch session summary', { sessionId, error: error.message });
      throw error;
    }

    return data;
  }

  // =========================================================================
  // SENTIMENT
  // =========================================================================

  async getSentimentTrend(providerId: string, limit: number = 30) {
    const { data, error } = await this.databaseService.supabase
      .from('provider_sentiment_history')
      .select('sentiment, sentiment_score, detected_emotions, trigger_context, created_at')
      .eq('provider_id', providerId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      this.logger.error('Failed to fetch sentiment trend', { providerId, error: error.message });
      throw error;
    }

    const scores = (data || [])
      .filter((d) => d.sentiment_score != null)
      .map((d) => d.sentiment_score as number);

    const avgScore = scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 0;

    return {
      averageScore: avgScore,
      trend: scores.length >= 2
        ? scores[0] > scores[scores.length - 1] ? 'improving' : 'declining'
        : 'stable',
      dataPoints: data || [],
    };
  }

  // =========================================================================
  // CROSS-VENDOR INTELLIGENCE
  // =========================================================================

  async compareProviders(providerIds?: string[]) {
    let query = this.databaseService.supabase
      .from('providers')
      .select('id, name, reliability_score, tier, minimum_order, lead_time_days')
      .eq('is_active', true)
      .is('deleted_at', null);

    if (providerIds && providerIds.length > 0) {
      query = query.in('id', providerIds);
    }

    const { data: providers, error: pErr } = await query;
    if (pErr) throw pErr;

    const result = [];
    for (const provider of providers || []) {
      const [promos, sentiment, knowledge] = await Promise.all([
        this.databaseService.supabase
          .from('provider_promotions')
          .select('id')
          .eq('provider_id', provider.id)
          .eq('status', 'active'),
        this.databaseService.supabase
          .from('provider_sentiment_history')
          .select('sentiment_score')
          .eq('provider_id', provider.id)
          .order('created_at', { ascending: false })
          .limit(5),
        this.databaseService.supabase
          .from('provider_knowledge')
          .select('id')
          .eq('provider_id', provider.id)
          .eq('is_active', true),
      ]);

      const sentimentScores = (sentiment.data || [])
        .filter((s) => s.sentiment_score != null)
        .map((s) => s.sentiment_score as number);

      result.push({
        ...provider,
        activePromoCount: promos.data?.length || 0,
        avgSentiment: sentimentScores.length > 0
          ? sentimentScores.reduce((a, b) => a + b, 0) / sentimentScores.length
          : null,
        knowledgeEntries: knowledge.data?.length || 0,
      });
    }

    return result;
  }

  async getLeverageSignals() {
    const { data, error } = await this.databaseService.supabase
      .from('provider_knowledge')
      .select('provider_id, label, attributes, providers(name)')
      .eq('category', 'relationship')
      .eq('subcategory', 'leverage_signal')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      this.logger.error('Failed to fetch leverage signals', { error: error.message });
      throw error;
    }

    return data || [];
  }
}
