/**
 * Client-side Distributor → Thread grouping for conversation list pages.
 * Server still filters/paginates; this only structures the current page.
 *
 * Threads are keyed on `thread_key` (durable, set by a DB trigger), NOT on order_id.
 * A negotiation exists before an order does, so bucketing on order_id strands every
 * pre-order message in one shared "Unassigned" pile. See
 * .planning/CONVERSATION_THREADING_PLAN.md.
 */

import type { ConversationMessage } from '../hooks/queries/useConversationQueries'

export interface ThreadGroup {
  /** Durable thread identity — safe to pass to the thread endpoint. */
  key: string
  orderId: string | null
  orderNumber: string | null
  wineName: string | null
  /** Best available human label: wine → subject → order number. */
  title: string
  /** No order attached to any message in the thread. */
  isUnlinked: boolean
  firstAt: string | null
  lastAt: string | null
  messages: ConversationMessage[]
}

export interface DistributorGroup {
  providerId: string
  providerName: string
  threads: ThreadGroup[]
  messageCount: number
}

export function conversationWineName(
  conv: ConversationMessage,
): string | null {
  const order = conv.procurement_orders
  if (!order) return null
  if (order.wine_name) return order.wine_name
  if (order.inventory?.wine_name) return order.inventory.wine_name
  return null
}

export function conversationOrderNumber(
  conv: ConversationMessage,
): string | null {
  return (
    conv.procurement_orders?.order_number ?? conv.order_number_snapshot ?? null
  )
}

/**
 * Mirrors public.conversation_thread_key() in SQL, so grouping stays correct for rows
 * written before the migration and for any payload where the server has not supplied
 * thread_key yet.
 */
export function conversationThreadKey(conv: ConversationMessage): string {
  const stored = conv.thread_key?.trim()
  if (stored) return stored

  const gmail = conv.gmail_thread_id?.trim()
  if (gmail) return `gm:${gmail}`

  const headers = conv.email_headers ?? undefined
  const root =
    headers?.references?.trim().split(/\s+/)[0] || headers?.in_reply_to?.trim()
  if (root) return `mid:${root.replace(/^<|>$/g, '')}`

  const orderId = conv.order_id?.trim()
  if (orderId) return `order:${orderId}`

  const subject = conversationSubject(conv)
  if (subject && conv.provider_id) {
    return `subj:${conv.provider_id}:${subject.toLowerCase()}`
  }

  return `msg:${conv.id}`
}

const REPLY_PREFIX = /^((re|fwd|fw|aw|sv)\s*:\s*)+/i
/** Prefixes that carry no information once the row is already a conversation. */
const NOISE_PREFIX = /^(order request|wine order inquiry|order inquiry)\s*:\s*/i

/** Subject from headers, else the leading `Subject:` line of the message body. */
export function conversationSubject(
  conv: ConversationMessage,
): string | null {
  const raw =
    conv.email_headers?.subject?.trim() ||
    conv.message_text?.match(/^[ \t]*Subject:[ \t]*(.+)$/m)?.[1]?.trim()
  if (!raw) return null
  const normalized = raw.replace(REPLY_PREFIX, '').replace(/\s+/g, ' ').trim()
  return normalized || null
}

/**
 * A message that never left the building has no subject and no Gmail id to name it
 * by. Its lifecycle status is the only honest label available — "Conversation" made
 * five distinct drafts look like five identical mystery rows.
 */
const DRAFT_STATUS_LABEL: Record<string, string> = {
  DISCARDED: 'Discarded draft',
  CANCELLED: 'Cancelled draft',
  REJECTED: 'Rejected draft',
  FAILED: 'Failed send',
  DRAFT: 'Unsent draft',
  PENDING_APPROVAL: 'Draft awaiting approval',
  APPROVED: 'Approved, not sent',
}

export function draftStatusLabel(
  conv: ConversationMessage,
): string | null {
  const status = conv.status?.trim().toUpperCase()
  if (!status) return null
  // A sent message is not a draft; it simply lacks a subject.
  if (status === 'SENT' || status === 'AUTO_SENT') return null
  return DRAFT_STATUS_LABEL[status] ?? null
}

function threadTitle(
  messages: ConversationMessage[],
  orderNumber: string | null,
  wineName: string | null,
): string {
  if (wineName) return wineName
  for (const msg of messages) {
    const subject = conversationSubject(msg)
    if (subject) {
      const stripped = subject.replace(NOISE_PREFIX, '').trim()
      if (stripped) return stripped
    }
  }
  if (orderNumber) return orderNumber
  for (const msg of messages) {
    const label = draftStatusLabel(msg)
    if (label) return label
  }
  return 'Conversation'
}

function buildThreadGroups(
  messages: ConversationMessage[],
): ThreadGroup[] {
  const map = new Map<string, ConversationMessage[]>()

  for (const msg of messages) {
    const key = conversationThreadKey(msg)
    const bucket = map.get(key)
    if (bucket) bucket.push(msg)
    else map.set(key, [msg])
  }

  const groups: ThreadGroup[] = []
  for (const [key, msgs] of map) {
    const orderId = msgs.find((m) => m.order_id)?.order_id ?? null
    const orderNumber = msgs.map(conversationOrderNumber).find((n) => n) ?? null
    const wineName = msgs.map(conversationWineName).find((n) => n) ?? null
    const times = msgs
      .map((m) => m.created_at)
      .filter(Boolean)
      .sort()

    groups.push({
      key,
      orderId,
      orderNumber,
      wineName,
      title: threadTitle(msgs, orderNumber, wineName),
      isUnlinked: !orderId,
      firstAt: times[0] ?? null,
      lastAt: times[times.length - 1] ?? null,
      messages: msgs,
    })
  }

  // Linked threads first, then most recent activity.
  return groups.sort((a, b) => {
    if (a.isUnlinked !== b.isUnlinked) return a.isUnlinked ? 1 : -1
    return (b.lastAt ?? '').localeCompare(a.lastAt ?? '')
  })
}

/**
 * Group conversations by distributor, then by thread within each distributor.
 * Providers with no id collapse into "Unknown vendor".
 */
export function groupConversationsByDistributorAndThread(
  conversations: ConversationMessage[],
): DistributorGroup[] {
  const byProvider = new Map<string, ConversationMessage[]>()
  const names = new Map<string, string>()

  for (const conv of conversations) {
    const pid = conv.provider_id || conv.providers?.id || 'unknown'
    const name = conv.providers?.name || 'Unknown vendor'
    if (!byProvider.has(pid)) byProvider.set(pid, [])
    byProvider.get(pid)!.push(conv)
    if (!names.has(pid)) names.set(pid, name)
  }

  const groups: DistributorGroup[] = []
  for (const [providerId, messages] of byProvider) {
    groups.push({
      providerId,
      providerName: names.get(providerId) || 'Unknown vendor',
      threads: buildThreadGroups(messages),
      messageCount: messages.length,
    })
  }

  return groups.sort((a, b) => b.messageCount - a.messageCount)
}

/** Flat thread groups when distributor level is collapsed (single provider scoped). */
export function groupConversationsByThread(
  conversations: ConversationMessage[],
): ThreadGroup[] {
  return buildThreadGroups(conversations)
}

export function providerInitials(name?: string | null): string {
  if (!name?.trim()) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
