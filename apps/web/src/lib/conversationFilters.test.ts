import { describe, it, expect } from 'vitest'
import {
  SENTIMENTS,
  normalizeSentiment,
  sentimentBadgeClass,
  sentimentLabel,
  normalizeDirection,
  filtersToSearchParams,
  searchParamsToFilters,
  hasActiveConversationFilters,
  EMPTY_CONVERSATION_FILTERS,
  FILTER_OPTIONS,
} from './conversationFilters'

describe('sentiment vocabulary', () => {
  it('exposes exactly the three canonical sentiment values', () => {
    expect([...SENTIMENTS]).toEqual(['positive', 'neutral', 'negative'])
  })

  it('FILTER_OPTIONS.sentiment includes All + three + unclassified', () => {
    const values = FILTER_OPTIONS.sentiment.map((o) => o.value)
    expect(values).toEqual(['', 'positive', 'neutral', 'negative', 'unclassified'])
  })
})

describe('normalizeSentiment', () => {
  it.each([
    ['positive', 'positive'],
    ['NEGATIVE', 'negative'],
    [' Neutral ', 'neutral'],
    [null, 'unclassified'],
    [undefined, 'unclassified'],
    ['', 'unclassified'],
    ['   ', 'unclassified'],
    ['angry', 'unclassified'],
    ['POSITIVE', 'positive'],
  ] as const)('maps %j → %j', (input, expected) => {
    expect(normalizeSentiment(input)).toBe(expected)
  })
})

describe('sentimentBadgeClass', () => {
  it('maps each bucket to a distinct wine-theme badge class', () => {
    expect(sentimentBadgeClass('positive')).toContain('emerald')
    expect(sentimentBadgeClass('negative')).toContain('red')
    expect(sentimentBadgeClass('neutral')).toContain('gray')
    expect(sentimentBadgeClass('unclassified')).toContain('amber')
  })

  it('never returns empty class for any known bucket', () => {
    for (const s of [...SENTIMENTS, 'unclassified'] as const) {
      expect(sentimentBadgeClass(s).length).toBeGreaterThan(0)
      expect(sentimentLabel(s).length).toBeGreaterThan(0)
    }
  })
})

describe('normalizeDirection', () => {
  it.each([
    ['inbound', 'inbound'],
    ['OUTBOUND', 'outbound'],
    [' Inbound ', 'inbound'],
    [null, 'unknown'],
    ['sideways', 'unknown'],
  ] as const)('maps %j → %j', (input, expected) => {
    expect(normalizeDirection(input)).toBe(expected)
  })
})

describe('URL serialization', () => {
  it('omits empty defaults from search params', () => {
    const p = filtersToSearchParams(EMPTY_CONVERSATION_FILTERS)
    expect(p.toString()).toBe('')
  })

  it('writes sentiment into the query string for deep links', () => {
    const p = filtersToSearchParams({
      ...EMPTY_CONVERSATION_FILTERS,
      sentiment: 'negative',
      direction: 'inbound',
      page: 2,
    })
    expect(p.get('sentiment')).toBe('negative')
    expect(p.get('direction')).toBe('inbound')
    expect(p.get('page')).toBe('2')
  })

  it('round-trips filters through URLSearchParams', () => {
    const original = {
      ...EMPTY_CONVERSATION_FILTERS,
      channel: 'email',
      sentiment: 'positive',
      search: 'cabernet',
      page: 3,
    }
    const restored = searchParamsToFilters(filtersToSearchParams(original))
    expect(restored).toEqual(original)
  })

  it('detects active filters', () => {
    expect(hasActiveConversationFilters(EMPTY_CONVERSATION_FILTERS)).toBe(false)
    expect(
      hasActiveConversationFilters({
        ...EMPTY_CONVERSATION_FILTERS,
        sentiment: 'neutral',
      }),
    ).toBe(true)
  })
})
