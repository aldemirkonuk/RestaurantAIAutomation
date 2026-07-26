import { describe, it, expect } from 'vitest'
import {
  groupConversationsByDistributorAndOrder,
  groupConversationsByOrder,
  conversationWineName,
  conversationOrderNumber,
  providerInitials,
} from './conversationGrouping'
import type { ConversationMessage } from '../hooks/queries/useConversationQueries'

function msg(
  partial: Partial<ConversationMessage> & { id: string },
): ConversationMessage {
  return {
    direction: 'outbound',
    channel: 'email',
    message_text: 'hello',
    ai_generated: false,
    detected_intent: '',
    detected_sentiment: 'neutral',
    sent_at: null,
    received_at: null,
    created_at: '2026-07-01T00:00:00Z',
    confidence_score: null,
    thread_id: null,
    conversation_summary: null,
    summary_updated_at: null,
    order_id: null,
    provider_id: null,
    restaurant_id: null,
    manager_approval_status: null,
    ...partial,
  }
}

describe('conversationGrouping', () => {
  it('groups by distributor then order, with Unassigned bucket', () => {
    const rows = [
      msg({
        id: '1',
        provider_id: 'p1',
        providers: { id: 'p1', name: 'Gullit' },
        order_id: 'o1',
        procurement_orders: {
          id: 'o1',
          order_number: 'WO-1',
          wine_name: 'Barolo',
          quantity: 6,
          status: 'open',
        },
        created_at: '2026-07-02T00:00:00Z',
      }),
      msg({
        id: '2',
        provider_id: 'p1',
        providers: { id: 'p1', name: 'Gullit' },
        order_id: null,
        created_at: '2026-07-01T00:00:00Z',
      }),
      msg({
        id: '3',
        provider_id: 'p2',
        providers: { id: 'p2', name: 'Other Dist' },
        order_id: 'o2',
        procurement_orders: {
          id: 'o2',
          order_number: 'WO-2',
          wine_name: 'Chianti',
          quantity: 12,
          status: 'open',
        },
      }),
    ]

    const groups = groupConversationsByDistributorAndOrder(rows)
    expect(groups).toHaveLength(2)
    expect(groups[0].providerName).toBe('Gullit')
    expect(groups[0].messageCount).toBe(2)
    expect(groups[0].orders.map((o) => o.key)).toEqual(['o1', 'unassigned'])
    expect(groups[0].orders[1].isUnassigned).toBe(true)
  })

  it('flattens to order groups when distributor is collapsed', () => {
    const rows = [
      msg({
        id: '1',
        provider_id: 'p1',
        order_id: 'o1',
        procurement_orders: {
          id: 'o1',
          order_number: 'WO-9',
          wine_name: 'Nebbiolo',
          quantity: 3,
          status: 'open',
        },
      }),
      msg({ id: '2', provider_id: 'p1', order_id: null }),
    ]
    const orders = groupConversationsByOrder(rows)
    expect(orders).toHaveLength(2)
    expect(conversationOrderNumber(rows[0])).toBe('WO-9')
    expect(conversationWineName(rows[0])).toBe('Nebbiolo')
  })

  it('builds provider initials', () => {
    expect(providerInitials('Gullit Distribution')).toBe('GD')
    expect(providerInitials('Acme')).toBe('AC')
    expect(providerInitials(null)).toBe('?')
  })
})
