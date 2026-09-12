import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { useAuth } from '../../contexts/AuthContext'

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
  /** Durable thread identity set by a DB trigger — never null on stored rows. */
  thread_key?: string | null
  gmail_thread_id?: string | null
  email_headers?: {
    subject?: string
    in_reply_to?: string
    references?: string
  } | null
  conversation_summary: string | null
  summary_updated_at: string | null
  order_id: string | null
  /** Order number captured at write time, so history survives deleting the order. */
  order_number_snapshot?: string | null
  /** Lifecycle of an outbound message: DRAFT / PENDING_APPROVAL / APPROVED / SENT / DISCARDED / CANCELLED. */
  status?: string | null
  delivery_status?: string | null
  provider_id: string | null
  restaurant_id: string | null
  manager_approval_status: string | null
  providers?: { id: string; name: string; primary_contact?: unknown } | null
  procurement_orders?: {
    id: string
    order_number: string | null
    wine_name: string | null
    quantity: number
    status: string
    negotiated_price?: number | null
    final_price?: number | null
    negotiated_price_per_bottle?: number | null
    inventory?: { wine_name: string | null } | null
  } | null
}

export interface ConversationThreadSummary {
  key: string
  messageCount: number
  firstAt: string | null
  lastAt: string | null
  orderId: string | null
  orderNumber: string | null
  providerId: string | null
}

/** Thread-paginated response: `total` counts threads, not messages. */
export interface ConversationThreadListResponse {
  conversations: ConversationMessage[]
  threads: ConversationThreadSummary[]
  total: number
  page: number
  limit: number
  totalPages: number
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
  /** Filter by human-readable procurement order number (ilike). */
  orderNumber?: string
  /** Fetch one conversation thread whole, regardless of order linkage. */
  threadKey?: string
  channel?: string
  direction?: string
  /** positive | neutral | negative | unclassified */
  sentiment?: string
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
 * List conversations paginated BY THREAD, so a thread is never split across pages.
 * Prefer this over `useConversations` for any grouped view.
 *
 * Keyed by the active restaurant: the request is scoped by the
 * X-Restaurant-Id header (interceptor above), so an unkeyed cache would keep
 * serving the previous tenant's threads after a restaurant switch while the
 * consuming page stays mounted.
 */
export function useConversationThreads(filters: ConversationFilters = {}) {
  const { user, activeRestaurantId } = useAuth()
  const restaurantId = activeRestaurantId ?? user?.restaurantId ?? ''
  return useQuery<ConversationThreadListResponse>({
    queryKey: [...conversationKeys.lists(), 'byThread', restaurantId, filters],
    queryFn: async () => {
      const params = new URLSearchParams()
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          params.append(key, String(value))
        }
      })
      const { data } = await api.get(
        `/api/v1/conversations/threads?${params.toString()}`,
      )
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

// ── Phase 34: Procurement Conversation History ─────────────────────────────

export interface ProcurementHistoryItem {
  id: string
  /**
   * NULL on 25 of production's 27 rows — which is why ADR 0084 had to turn the
   * `procurement_orders!inner` embed into a `!left` one to see them at all.
   */
  orderId: string | null
  providerId: string
  /**
   * Uppercased by the gateway (`procurement.service.ts` `getConversationHistory`,
   * whose spec asserts "normalises direction to the casing the UI compares
   * against"). It was sent but not declared here, so no consumer could read it
   * — and `/communications` rendered every inbound vendor reply as an outbound
   * AI draft, because `status` on an inbound row is the column DEFAULT `'DRAFT'`
   * that the inbound writer never sets.
   */
  direction: 'OUTBOUND' | 'INBOUND'
  /** NULL on every inbound row — `outbound_email_type` is an outbound concept. */
  emailType: string | null
  /** `procurement_conversations.status` is nullable; ADR 0084 admits null rows. */
  status: string | null
  roundCount: number
  createdAt: string
  sentAt: string
  /** `content ?? message_text ?? null` — the gateway may genuinely have none. */
  draftContent: string | null
  constraintFlags: {
    hard: string[]
    annotating: string[]
    soft_warnings: string[]
    is_sensitive: boolean
  } | null
  rollingSummary: string | null
  orderNumber: string | null
  quantity: number | null
  wineName: string | null
  providerName: string | null
}

export const procurementHistoryKeys = {
  /** Invalidation PREFIX only — never a bucket anything is stored under. */
  all: ['procurement', 'history'] as const,
  forRestaurant: (restaurantId: string) =>
    ['procurement', 'history', restaurantId] as const,
}

/**
 * Keyed by the active restaurant, for the same reason `useConversationThreads`
 * above is — and more sharply here.
 *
 * `GET /procurement/conversations/history` is scoped ENTIRELY from the JWT:
 * `procurement.controller.ts:737` reads `user.restaurantId` and the gateway
 * never reads the `X-Restaurant-Id` header this client stamps (a repo-wide
 * grep finds that header only in test fixtures). So the token is re-minted on
 * a restaurant switch — and `AuthContext.tsx` catches a FAILED switch and
 * proceeds, logging that it will continue "with X-Restaurant-Id header only",
 * a fallback the gateway does not implement. A failed switch plus a constant
 * cache key therefore renders the PREVIOUS tenant's conversation book under
 * the new tenant's name, with no banner. The key literal is the only thing
 * separating the two.
 */
export function useProcurementConversationHistory() {
  const { user, activeRestaurantId } = useAuth()
  // Prefer the runtime-updated activeRestaurantId: user.restaurantId comes
  // from the JWT and is stale for the whole window between a switch and a
  // re-mint.
  const restaurantId = activeRestaurantId ?? user?.restaurantId ?? ''
  return useQuery({
    queryKey: procurementHistoryKeys.forRestaurant(restaurantId),
    queryFn: () =>
      api
        .get<ProcurementHistoryItem[]>('/procurement/conversations/history')
        .then((r) => r.data),
    staleTime: 30_000,
  })
}
