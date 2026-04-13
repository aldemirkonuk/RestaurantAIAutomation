import { apiClient } from './client'

// ============================================================================
// Types
// ============================================================================

export interface KnowledgeEntry {
  id: string
  subcategory: string | null
  label: string
  attributes: Record<string, unknown>
  confidence: number
  verified: boolean
  version: number
  expiresAt: string | null
  updatedAt: string
}

export type KnowledgeGraph = Record<string, KnowledgeEntry[]>

export interface Promotion {
  id: string
  provider_id: string
  name: string
  promo_type: string
  description: string | null
  conditions: Record<string, unknown>
  discount_value: Record<string, unknown>
  applicable_wines: unknown[]
  applicable_categories: string[] | null
  start_date: string | null
  end_date: string | null
  is_recurring: boolean
  status: string
  times_used: number
  savings_realized: number
  created_at: string
  providers?: { id: string; name: string }
}

export interface ConversationMemoryEntry {
  id: string
  message_text: string
  role: 'provider' | 'restaurant' | 'system'
  channel: string | null
  importance_score: number
  extracted_entities: Record<string, unknown>
  language: string
  created_at: string
}

export interface ConversationSession {
  id: string
  provider_id: string
  session_type: string
  status: string
  initiated_by: string
  intent: Record<string, unknown>
  topic_stack: string[]
  turn_count: number
  summary: string | null
  created_at: string
  completed_at: string | null
}

export interface SentimentTrend {
  averageScore: number
  trend: 'improving' | 'declining' | 'stable'
  dataPoints: {
    sentiment: string
    sentiment_score: number | null
    detected_emotions: string[] | null
    trigger_context: string | null
    created_at: string
  }[]
}

export interface ProviderComparison {
  id: string
  name: string
  reliability_score: number | null
  tier: string | null
  minimum_order: number | null
  lead_time_days: number | null
  activePromoCount: number
  avgSentiment: number | null
  knowledgeEntries: number
}

export interface PromoSavings {
  totalSavings: number
  byProvider: {
    provider_id: string
    savings_realized: string
    times_used: number
    providers: { name: string }
  }[]
}

// ============================================================================
// Knowledge Graph (Digital Twin)
// ============================================================================

export async function fetchProviderKnowledge(
  providerId: string,
  category?: string,
): Promise<KnowledgeGraph> {
  const params = category ? `?category=${category}` : ''
  const { data } = await apiClient.get(`/providers/${providerId}/knowledge${params}`)
  return data
}

export async function verifyKnowledge(
  providerId: string,
  knowledgeId: string,
): Promise<KnowledgeEntry> {
  const { data } = await apiClient.put(
    `/providers/${providerId}/knowledge/${knowledgeId}/verify`,
  )
  return data
}

export async function fetchContradictions(providerId: string) {
  const { data } = await apiClient.get(`/providers/${providerId}/knowledge/contradictions`)
  return data
}

// ============================================================================
// Promotions
// ============================================================================

export async function fetchProviderPromotions(
  providerId: string,
  status?: string,
): Promise<Promotion[]> {
  const params = status ? `?status=${status}` : ''
  const { data } = await apiClient.get(`/providers/${providerId}/promotions${params}`)
  return data
}

export async function fetchAllActivePromotions(): Promise<Promotion[]> {
  const { data } = await apiClient.get('/providers/promotions/active')
  return data
}

export async function fetchExpiringPromotions(days?: number): Promise<Promotion[]> {
  const params = days ? `?days=${days}` : ''
  const { data } = await apiClient.get(`/providers/promotions/expiring${params}`)
  return data
}

export async function fetchPromoComparison(): Promise<Record<string, Promotion[]>> {
  const { data } = await apiClient.get('/providers/promotions/compare')
  return data
}

export async function fetchPromoSavings(): Promise<PromoSavings> {
  const { data } = await apiClient.get('/providers/promotions/savings')
  return data
}

// ============================================================================
// Conversation Memory
// ============================================================================

export async function fetchConversationMemory(
  providerId: string,
  limit?: number,
): Promise<ConversationMemoryEntry[]> {
  const params = limit ? `?limit=${limit}` : ''
  const { data } = await apiClient.get(
    `/providers/${providerId}/conversation-memory${params}`,
  )
  return data
}

export async function searchConversationMemory(
  providerId: string,
  query: string,
): Promise<ConversationMemoryEntry[]> {
  const { data } = await apiClient.post(
    `/providers/${providerId}/conversation-memory/search`,
    { query },
  )
  return data
}

// ============================================================================
// Sessions
// ============================================================================

export async function fetchProviderSessions(
  providerId: string,
  includeCompleted?: boolean,
): Promise<ConversationSession[]> {
  const params = includeCompleted ? '?includeCompleted=true' : ''
  const { data } = await apiClient.get(`/providers/${providerId}/sessions${params}`)
  return data
}

export async function fetchSessionSummary(
  providerId: string,
  sessionId: string,
): Promise<ConversationSession> {
  const { data } = await apiClient.get(
    `/providers/${providerId}/sessions/${sessionId}/summary`,
  )
  return data
}

// ============================================================================
// Sentiment
// ============================================================================

export async function fetchSentimentTrend(
  providerId: string,
  limit?: number,
): Promise<SentimentTrend> {
  const params = limit ? `?limit=${limit}` : ''
  const { data } = await apiClient.get(`/providers/${providerId}/sentiment${params}`)
  return data
}

// ============================================================================
// Proactive Actions
// ============================================================================

export async function triggerOutreach(
  providerId: string,
  outreachType?: string,
  topic?: string,
) {
  const { data } = await apiClient.post(`/providers/${providerId}/outreach`, {
    outreachType,
    topic,
  })
  return data
}

export async function triggerOnboarding(providerId: string) {
  const { data } = await apiClient.post(`/providers/${providerId}/onboard`)
  return data
}

// ============================================================================
// Cross-Vendor Intelligence
// ============================================================================

export async function fetchProviderComparison(
  providerIds?: string[],
): Promise<ProviderComparison[]> {
  const params = providerIds?.length ? `?providerIds=${providerIds.join(',')}` : ''
  const { data } = await apiClient.get(`/providers/intelligence/compare${params}`)
  return data
}

export async function fetchLeverageSignals() {
  const { data } = await apiClient.get('/providers/intelligence/leverage')
  return data
}
