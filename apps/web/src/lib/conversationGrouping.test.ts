import { describe, it, expect } from 'vitest'
import {
  groupConversationsByDistributorAndThread,
  groupConversationsByThread,
  conversationWineName,
  conversationOrderNumber,
  conversationSubject,
  conversationThreadKey,
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

describe('conversationThreadKey', () => {
  it('prefers the stored thread_key', () => {
    expect(
      conversationThreadKey(msg({ id: '1', thread_key: 'gm:abc', gmail_thread_id: 'zzz' })),
    ).toBe('gm:abc')
  })

  it('falls back to gmail_thread_id so pre-migration rows still thread', () => {
    expect(conversationThreadKey(msg({ id: '1', gmail_thread_id: 'abc' }))).toBe(
      'gm:abc',
    )
  })

  it('falls back to the References root, then In-Reply-To', () => {
    expect(
      conversationThreadKey(
        msg({ id: '1', email_headers: { references: '<root@x> <later@x>' } }),
      ),
    ).toBe('mid:root@x')
    expect(
      conversationThreadKey(
        msg({ id: '1', email_headers: { in_reply_to: '<solo@x>' } }),
      ),
    ).toBe('mid:solo@x')
  })

  it('never returns a shared bucket for unthreadable rows', () => {
    // The old behaviour collapsed every one of these into a single "unassigned" pile.
    const a = conversationThreadKey(msg({ id: 'a' }))
    const b = conversationThreadKey(msg({ id: 'b' }))
    expect(a).toBe('msg:a')
    expect(b).toBe('msg:b')
    expect(a).not.toBe(b)
  })
})

describe('conversationSubject', () => {
  it('reads headers first, then the Subject line in the body', () => {
    expect(
      conversationSubject(msg({ id: '1', email_headers: { subject: 'Re: Barolo' } })),
    ).toBe('Barolo')
    expect(
      conversationSubject(
        msg({ id: '1', message_text: 'Subject: Re: Order Request: Chianti\n\nHi' }),
      ),
    ).toBe('Order Request: Chianti')
  })

  it('returns null when there is no subject anywhere', () => {
    expect(conversationSubject(msg({ id: '1', message_text: 'Hi there' }))).toBeNull()
  })
})

describe('conversationGrouping', () => {
  it('groups by distributor then thread', () => {
    const rows = [
      msg({
        id: '1',
        provider_id: 'p1',
        providers: { id: 'p1', name: 'Gullit' },
        order_id: 'o1',
        thread_key: 'gm:t1',
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
        thread_key: 'gm:t2',
        created_at: '2026-07-01T00:00:00Z',
      }),
      msg({
        id: '3',
        provider_id: 'p2',
        providers: { id: 'p2', name: 'Other Dist' },
        order_id: 'o2',
        thread_key: 'gm:t3',
        procurement_orders: {
          id: 'o2',
          order_number: 'WO-2',
          wine_name: 'Chianti',
          quantity: 12,
          status: 'open',
        },
      }),
    ]

    const groups = groupConversationsByDistributorAndThread(rows)
    expect(groups).toHaveLength(2)
    expect(groups[0].providerName).toBe('Gullit')
    expect(groups[0].messageCount).toBe(2)
    // Linked thread sorts ahead of the unlinked one.
    expect(groups[0].threads.map((t) => t.key)).toEqual(['gm:t1', 'gm:t2'])
    expect(groups[0].threads[1].isUnlinked).toBe(true)
  })

  it('keeps a multi-message thread together rather than splitting on order linkage', () => {
    // The real-world shape: an outbound offer with no order yet, and the vendor's
    // reply. Both belong to one Gmail thread and must render as one conversation.
    const rows = [
      msg({
        id: 'out',
        provider_id: 'p1',
        gmail_thread_id: 't9',
        message_text: "Hi there,\n\nWe're interested in securing 6 bottles.",
        created_at: '2026-07-05T10:00:00Z',
      }),
      msg({
        id: 'in',
        provider_id: 'p1',
        gmail_thread_id: 't9',
        direction: 'inbound',
        message_text: 'Subject: Re: Order Request: 2010 Barolo\n\nHappy to help.',
        created_at: '2026-07-05T11:00:00Z',
      }),
    ]

    const threads = groupConversationsByThread(rows)
    expect(threads).toHaveLength(1)
    expect(threads[0].key).toBe('gm:t9')
    expect(threads[0].messages).toHaveLength(2)
    expect(threads[0].isUnlinked).toBe(true)
    // Titled from the reply's subject, since no order exists to name it.
    expect(threads[0].title).toBe('2010 Barolo')
    expect(threads[0].firstAt).toBe('2026-07-05T10:00:00Z')
    expect(threads[0].lastAt).toBe('2026-07-05T11:00:00Z')
  })

  it('titles a linked thread with its wine and exposes the order number', () => {
    const rows = [
      msg({
        id: '1',
        provider_id: 'p1',
        order_id: 'o1',
        thread_key: 'gm:t1',
        procurement_orders: {
          id: 'o1',
          order_number: 'WO-9',
          wine_name: 'Nebbiolo',
          quantity: 3,
          status: 'open',
        },
      }),
    ]
    const threads = groupConversationsByThread(rows)
    expect(threads).toHaveLength(1)
    expect(threads[0].title).toBe('Nebbiolo')
    expect(threads[0].orderNumber).toBe('WO-9')
    expect(threads[0].isUnlinked).toBe(false)
    expect(conversationOrderNumber(rows[0])).toBe('WO-9')
    expect(conversationWineName(rows[0])).toBe('Nebbiolo')
  })

  it('names never-sent drafts by their status instead of "Conversation"', () => {
    // These carry no subject and no Gmail id — status is the only honest label.
    const rows = [
      msg({ id: 'a', provider_id: 'p1', status: 'DISCARDED', message_text: 'Hi there' }),
      msg({ id: 'b', provider_id: 'p1', status: 'CANCELLED', message_text: 'Hi there' }),
      msg({ id: 'c', provider_id: 'p1', status: 'APPROVED', message_text: 'Hi there' }),
    ]
    const titles = groupConversationsByThread(rows).map((t) => t.title)
    expect(titles).toContain('Discarded draft')
    expect(titles).toContain('Cancelled draft')
    expect(titles).toContain('Approved, not sent')
    expect(titles).not.toContain('Conversation')
  })

  it('does not call a sent message a draft', () => {
    const rows = [
      msg({ id: 'a', provider_id: 'p1', status: 'SENT', message_text: 'Hi there' }),
    ]
    expect(groupConversationsByThread(rows)[0].title).toBe('Conversation')
  })

  it('prefers a real subject over the status label', () => {
    const rows = [
      msg({
        id: 'a',
        provider_id: 'p1',
        status: 'DISCARDED',
        message_text: 'Subject: Order Request: 2010 Barolo\n\nHi',
      }),
    ]
    expect(groupConversationsByThread(rows)[0].title).toBe('2010 Barolo')
  })

  it('falls back to order_number_snapshot when the order row is gone', () => {
    const row = msg({ id: '1', order_number_snapshot: 'WO-DELETED' })
    expect(conversationOrderNumber(row)).toBe('WO-DELETED')
  })

  it('builds provider initials', () => {
    expect(providerInitials('Gullit Distribution')).toBe('GD')
    expect(providerInitials('Acme')).toBe('AC')
    expect(providerInitials(null)).toBe('?')
  })
})
