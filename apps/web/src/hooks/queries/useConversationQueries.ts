import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'

const API_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'

const api = axios.create({
  baseURL: API_URL,
  timeout: 15000,
})

// Attach auth token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  const restaurantId = localStorage.getItem('activeRestaurantId')
  if (restaurantId) {
    config.headers['X-Restaurant-Id'] = restaurantId
  }
  return config
})

// ── Types ─────────────────────────────────────────────────────────

export interface ConversationMessage {
  id: string
  direction: 'inbound' | 'outbound'
  channel: 'email' | 'sms' | 'voice' | 'whatsapp'
  message_text: string
  ai_generated: boolean
  detected_intent: string
  detected_sentiment: string
  sent_at: string | null
  received_at: string | null
  created_at: string
  confidence_score: number | null
  thread_id: string | null
  conversation_summary: string | null
  summary_updated_at: string | null
  order_id: string | null
  provider_id: string | null
  restaurant_id: string | null
  manager_approval_status: string | null
  providers?: { id: string; name: string; primary_contact: any } | null
  procurement_orders?: {
    id: string
    wine_name: string
    quantity: number
    status: string
    negotiated_price_per_bottle: number | null
  } | null
}

export interface ConversationListResponse {
  conversations: ConversationMessage[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface ConversationThread {
  thread_id: string
  message_count: number
  first_message_at: string | null
  last_message_at: string | null
  summary: string | null
  summary_updated_at: string | null
  provider: any
  order: any
  messages: ConversationMessage[]
}

export interface ConversationStats {
  total: number
  byChannel: Record<string, number>
  byDirection: Record<string, number>
  byProvider: Record<string, number>
  bySentiment: Record<string, number>
  byMonth: Record<string, number>
}

export interface ConversationFilters {
  restaurantId?: string
  providerId?: string
  orderId?: string
  channel?: string
  direction?: string
  dateFrom?: string
  dateTo?: string
  quarter?: string
  year?: string
  month?: string
  search?: string
  status?: string
  page?: number
  limit?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

// ── Query Keys ────────────────────────────────────────────────────

export const conversationKeys = {
  all: ['conversations'] as const,
  lists: () => [...conversationKeys.all, 'list'] as const,
  list: (filters: ConversationFilters) => [...conversationKeys.lists(), filters] as const,
  threads: () => [...conversationKeys.all, 'thread'] as const,
  thread: (threadId: string) => [...conversationKeys.threads(), threadId] as const,
  stats: (restaurantId?: string) => [...conversationKeys.all, 'stats', restaurantId] as const,
}

// ── Hooks ─────────────────────────────────────────────────────────

/**
 * List conversations with comprehensive filtering
 */
export function useConversations(filters: ConversationFilters = {}) {
  return useQuery<ConversationListResponse>({
    queryKey: conversationKeys.list(filters),
    queryFn: async () => {
      const params = new URLSearchParams()
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          params.append(key, String(value))
        }
      })
      const { data } = await api.get(`/api/v1/conversations?${params.toString()}`)
      return data
    },
    staleTime: 30_000,
  })
}

/**
 * Get a full conversation thread
 */
export function useConversationThread(threadId: string | null) {
  return useQuery<ConversationThread>({
    queryKey: conversationKeys.thread(threadId || ''),
    queryFn: async () => {
      const { data } = await api.get(`/api/v1/conversations/thread/${threadId}`)
      return data
    },
    enabled: !!threadId,
    staleTime: 15_000,
  })
}

/**
 * Get conversation statistics
 */
export function useConversationStats(restaurantId?: string) {
  return useQuery<ConversationStats>({
    queryKey: conversationKeys.stats(restaurantId),
    queryFn: async () => {
      const params = restaurantId ? `?restaurantId=${restaurantId}` : ''
      const { data } = await api.get(`/api/v1/conversations/stats/overview${params}`)
      return data
    },
    staleTime: 60_000,
  })
}

/**
 * Regenerate thread summary
 */
export function useRegenerateSummary() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (conversationId: string) => {
      const { data } = await api.post(`/api/v1/conversations/${conversationId}/summarize`)
      return data
    },
    onSuccess: () => {
      // Invalidate thread and list queries so they refetch with new summary
      queryClient.invalidateQueries({ queryKey: conversationKeys.all })
    },
  })
}
