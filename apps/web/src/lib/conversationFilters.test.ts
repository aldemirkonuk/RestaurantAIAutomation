import { describe, it, expect } from 'vitest'
import {
  SENTIMENTS,
  normalizeSentiment,
  sentimentBadgeClass,
  sentimentLabel,
  normalizeDirection,
  threadBadgeLabel,
  threadBadgeClass,
  filtersToSearchParams,
  searchParamsToFilters,
  hasActiveConversationFilters,
  EMPTY_CONVERSATION_FILTERS,
  EMPTY_TIME_FILTER,
  FILTER_OPTIONS,
  MONTHS,
  hasTimeFilter,
  recentYearOptions,
  resolveTimePreset,
  timeFilterLabel,
  timeFilterMode,
  toApiDateRange,
  toCalendarDay,
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

describe('thread badges', () => {
  it('labels an order-less thread truthfully, with amber badge', () => {
    // Not "Unassigned" — the thread is a real negotiation that has not produced a
    // purchase order yet, which is the normal state for an inquiry.
    expect(threadBadgeLabel(null)).toBe('No order yet')
    expect(threadBadgeLabel('   ')).toBe('No order yet')
    expect(threadBadgeClass(null)).toContain('amber')
  })

  it('labels linked threads with the order number and a mono badge', () => {
    expect(threadBadgeLabel('WO-1234')).toBe('WO-1234')
    expect(threadBadgeClass('WO-1234')).toContain('font-mono')
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

  it('round-trips filters through URLSearchParams including distributor, order and dates', () => {
    const original = {
      ...EMPTY_CONVERSATION_FILTERS,
      channel: 'email',
      sentiment: 'positive',
      search: 'cabernet',
      providerId: 'prov-1',
      orderNumber: 'WO-99',
      dateFrom: '2026-03-01',
      dateTo: '2026-03-31',
      page: 3,
    }
    const restored = searchParamsToFilters(filtersToSearchParams(original))
    expect(restored).toEqual(original)
  })

  it('detects active filters including provider and order', () => {
    expect(hasActiveConversationFilters(EMPTY_CONVERSATION_FILTERS)).toBe(false)
    expect(
      hasActiveConversationFilters({
        ...EMPTY_CONVERSATION_FILTERS,
        sentiment: 'neutral',
      }),
    ).toBe(true)
    expect(
      hasActiveConversationFilters({
        ...EMPTY_CONVERSATION_FILTERS,
        providerId: 'p1',
      }),
    ).toBe(true)
    expect(
      hasActiveConversationFilters({
        ...EMPTY_CONVERSATION_FILTERS,
        orderNumber: 'WO-1',
      }),
    ).toBe(true)
  })

  it('treats a custom date range as an active filter', () => {
    expect(
      hasActiveConversationFilters({
        ...EMPTY_CONVERSATION_FILTERS,
        dateFrom: '2026-01-01',
      }),
    ).toBe(true)
    expect(
      hasActiveConversationFilters({
        ...EMPTY_CONVERSATION_FILTERS,
        dateTo: '2026-01-31',
      }),
    ).toBe(true)
  })
})

describe('time filter modes', () => {
  it('reports "all" for the empty time filter', () => {
    expect(timeFilterMode(EMPTY_TIME_FILTER)).toBe('all')
    expect(hasTimeFilter(EMPTY_TIME_FILTER)).toBe(false)
    expect(timeFilterLabel(EMPTY_TIME_FILTER)).toBe('All time')
  })

  it('prefers an explicit day range over month and quarter', () => {
    const f = {
      ...EMPTY_TIME_FILTER,
      dateFrom: '2026-02-01',
      dateTo: '2026-02-28',
      month: '7',
      quarter: 'Q3',
      year: '2026',
    }
    expect(timeFilterMode(f)).toBe('range')
    expect(timeFilterLabel(f)).toBe('2026-02-01 → 2026-02-28')
  })

  it('labels open-ended and single-day ranges', () => {
    expect(
      timeFilterLabel({ ...EMPTY_TIME_FILTER, dateFrom: '2026-05-04' }),
    ).toBe('From 2026-05-04')
    expect(timeFilterLabel({ ...EMPTY_TIME_FILTER, dateTo: '2026-05-04' })).toBe(
      'Until 2026-05-04',
    )
    expect(
      timeFilterLabel({
        ...EMPTY_TIME_FILTER,
        dateFrom: '2026-05-04',
        dateTo: '2026-05-04',
      }),
    ).toBe('2026-05-04')
  })

  it('detects month mode only when year and month are both set', () => {
    expect(timeFilterMode({ ...EMPTY_TIME_FILTER, month: '7' })).toBe('all')
    const f = { ...EMPTY_TIME_FILTER, month: '7', year: '2026' }
    expect(timeFilterMode(f)).toBe('month')
    expect(timeFilterLabel(f)).toBe('July 2026')
  })

  it('detects quarter mode and labels it with the year', () => {
    const f = { ...EMPTY_TIME_FILTER, quarter: 'Q3', year: '2026' }
    expect(timeFilterMode(f)).toBe('quarter')
    expect(timeFilterLabel(f)).toBe('Q3 2026')
  })
})

describe('resolveTimePreset', () => {
  const now = new Date(2026, 6, 26) // 26 Jul 2026, local time

  it('makes rolling day windows inclusive of today', () => {
    expect(resolveTimePreset('last7', now)).toEqual({
      ...EMPTY_TIME_FILTER,
      dateFrom: '2026-07-20',
      dateTo: '2026-07-26',
    })
    expect(resolveTimePreset('last30', now).dateFrom).toBe('2026-06-27')
    expect(resolveTimePreset('last90', now).dateFrom).toBe('2026-04-28')
  })

  it('resolves month presets to year + month, not a raw range', () => {
    expect(resolveTimePreset('thisMonth', now)).toEqual({
      ...EMPTY_TIME_FILTER,
      year: '2026',
      month: '7',
    })
    expect(resolveTimePreset('lastMonth', now)).toEqual({
      ...EMPTY_TIME_FILTER,
      year: '2026',
      month: '6',
    })
  })

  it('rolls lastMonth back across the year boundary', () => {
    expect(resolveTimePreset('lastMonth', new Date(2026, 0, 15))).toEqual({
      ...EMPTY_TIME_FILTER,
      year: '2025',
      month: '12',
    })
  })

  it('spans the full calendar year for thisYear', () => {
    expect(resolveTimePreset('thisYear', now)).toEqual({
      ...EMPTY_TIME_FILTER,
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
    })
  })

  it('never emits two overlapping windows', () => {
    for (const preset of [
      'last7',
      'last30',
      'last90',
      'thisMonth',
      'lastMonth',
      'thisYear',
    ] as const) {
      const f = resolveTimePreset(preset, now)
      const isRange = Boolean(f.dateFrom || f.dateTo)
      expect(isRange && Boolean(f.month || f.quarter)).toBe(false)
    }
  })
})

describe('toApiDateRange', () => {
  it('widens dateTo to the end of its day so single days match', () => {
    expect(
      toApiDateRange({ ...EMPTY_TIME_FILTER, dateFrom: '2026-07-01', dateTo: '2026-07-01' }),
    ).toEqual({
      dateFrom: '2026-07-01T00:00:00.000Z',
      dateTo: '2026-07-01T23:59:59.999Z',
    })
  })

  it('omits unset bounds instead of sending empty strings', () => {
    expect(toApiDateRange(EMPTY_TIME_FILTER)).toEqual({
      dateFrom: undefined,
      dateTo: undefined,
    })
  })
})

describe('calendar helpers', () => {
  it('formats local calendar days without UTC drift', () => {
    expect(toCalendarDay(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(toCalendarDay(new Date(2026, 11, 31, 23, 30))).toBe('2026-12-31')
  })

  it('offers twelve months and descending recent years', () => {
    expect(MONTHS).toHaveLength(12)
    expect(FILTER_OPTIONS.month.map((o) => o.value)[0]).toBe('')
    const years = recentYearOptions(3, new Date(2026, 6, 1)).map((o) => o.value)
    expect(years).toEqual(['2026', '2025', '2024'])
  })
})
