/**
 * Client-side Distributor → Order grouping for conversation list pages.
 * Server still filters/paginates; this only structures the current page.
 */

import type { ConversationMessage } from '../hooks/queries/useConversationQueries'
import {
  normalizeOrderKey,
  isUnassignedOrder,
  type OrderBucket,
} from './conversationFilters'

export interface OrderGroup {
  key: OrderBucket
  orderNumber: string | null
  wineName: string | null
  isUnassigned: boolean
  messages: ConversationMessage[]
}

export interface DistributorGroup {
  providerId: string
  providerName: string
  orders: OrderGroup[]
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
  return conv.procurement_orders?.order_number ?? null
}

function buildOrderGroups(
  messages: ConversationMessage[],
): OrderGroup[] {
  const map = new Map<string, OrderGroup>()

  for (const msg of messages) {
    const key = normalizeOrderKey(msg.order_id)
    let group = map.get(key)
    if (!group) {
      group = {
        key,
        orderNumber: conversationOrderNumber(msg),
        wineName: conversationWineName(msg),
        isUnassigned: isUnassignedOrder(key),
        messages: [],
      }
      map.set(key, group)
    } else {
      if (!group.orderNumber) {
        group.orderNumber = conversationOrderNumber(msg)
      }
      if (!group.wineName) {
        group.wineName = conversationWineName(msg)
      }
    }
    group.messages.push(msg)
  }

  // Unassigned last; otherwise by most recent message
  return Array.from(map.values()).sort((a, b) => {
    if (a.isUnassigned && !b.isUnassigned) return 1
    if (!a.isUnassigned && b.isUnassigned) return -1
    const aTime = a.messages[0]?.created_at ?? ''
    const bTime = b.messages[0]?.created_at ?? ''
    return bTime.localeCompare(aTime)
  })
}

/**
 * Group conversations by distributor, then by order within each distributor.
 * Providers with no id collapse into "Unknown vendor".
 */
export function groupConversationsByDistributorAndOrder(
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
      orders: buildOrderGroups(messages),
      messageCount: messages.length,
    })
  }

  return groups.sort((a, b) => b.messageCount - a.messageCount)
}

/** Flat order groups when distributor level is collapsed (single provider scoped). */
export function groupConversationsByOrder(
  conversations: ConversationMessage[],
): OrderGroup[] {
  return buildOrderGroups(conversations)
}

export function providerInitials(name?: string | null): string {
  if (!name?.trim()) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
