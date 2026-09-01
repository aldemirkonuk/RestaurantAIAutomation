/**
 * The deep-link resolver contract.
 *
 * The rule under test is the one ADR 0020 turns on: a link that names a row
 * which is not there must produce a SENTENCE, and it must not produce that
 * sentence while the list is still loading — an empty array mid-fetch is not
 * evidence of absence, and calling it one would be the same fabricated answer
 * in the opposite direction.
 */

import { describe, expect, it } from 'vitest'
import {
  deepLinkMissingMessage,
  resolveDeepLinkChoice,
  resolveDeepLinkTarget,
  splitCsvParam,
} from './deepLink'

interface Row {
  id: string
}
const rows: Row[] = [{ id: 'a' }, { id: 'b' }]
const byId = (row: Row, value: string) => row.id === value

describe('resolveDeepLinkTarget', () => {
  it('is idle when the link carried no parameter', () => {
    expect(
      resolveDeepLinkTarget({ value: null, items: rows, ready: true, match: byId, noun: 'x' }),
    ).toEqual({ status: 'idle' })
  })

  it('treats whitespace as no parameter', () => {
    expect(
      resolveDeepLinkTarget({ value: '   ', items: rows, ready: true, match: byId, noun: 'x' }),
    ).toEqual({ status: 'idle' })
  })

  it('finds the named row', () => {
    const result = resolveDeepLinkTarget({
      value: 'b',
      items: rows,
      ready: true,
      match: byId,
      noun: 'the order',
    })
    expect(result).toEqual({ status: 'found', value: 'b', target: { id: 'b' } })
  })

  it('is PENDING, not missing, while the list has not settled', () => {
    // The whole point: an empty list during the fetch must never be reported
    // as "this order does not exist".
    const result = resolveDeepLinkTarget({
      value: 'zzz',
      items: [],
      ready: false,
      match: byId,
      noun: 'the order',
    })
    expect(result).toEqual({ status: 'pending', value: 'zzz' })
  })

  it('is pending when the list is undefined even if the caller says ready', () => {
    const result = resolveDeepLinkTarget({
      value: 'zzz',
      items: undefined,
      ready: true,
      match: byId,
      noun: 'the order',
    })
    expect(result.status).toBe('pending')
  })

  it('says so in words once the list has settled without the row', () => {
    const result = resolveDeepLinkTarget({
      value: 'zzz',
      items: rows,
      ready: true,
      match: byId,
      noun: 'the order',
    })
    expect(result.status).toBe('missing')
    if (result.status !== 'missing') throw new Error('unreachable')
    // Names the thing asked for…
    expect(result.message).toContain('zzz')
    expect(result.message).toContain('the order')
    // …and states that the page was NOT silently narrowed.
    expect(result.message).toContain('Nothing below has been filtered or hidden')
  })

  it('reports missing against a genuinely empty settled list', () => {
    const result = resolveDeepLinkTarget({
      value: 'a',
      items: [],
      ready: true,
      match: byId,
      noun: 'the order',
    })
    expect(result.status).toBe('missing')
  })
})

describe('resolveDeepLinkChoice', () => {
  const allowed = ['low', 'recon', 'dead'] as const

  it('is idle with no parameter', () => {
    expect(resolveDeepLinkChoice({ value: null, allowed, noun: 'the view' }).status).toBe('idle')
  })

  it('accepts a canonical value', () => {
    expect(resolveDeepLinkChoice({ value: 'low', allowed, noun: 'the view' })).toEqual({
      status: 'found',
      value: 'low',
      target: 'low',
    })
  })

  it('accepts a declared alias and reports the canonical target', () => {
    // Notifications.tsx:1355 spells this `low-stock`; Dashboard.tsx:320 spells
    // it `low`. Both are live, so both must land.
    const result = resolveDeepLinkChoice({
      value: 'low-stock',
      allowed,
      aliases: { 'low-stock': 'low' },
      noun: 'the view',
    })
    expect(result).toEqual({ status: 'found', value: 'low-stock', target: 'low' })
  })

  it('refuses an unknown view in words rather than doing nothing', () => {
    const result = resolveDeepLinkChoice({ value: 'wormhole', allowed, noun: 'the view' })
    expect(result.status).toBe('missing')
    if (result.status !== 'missing') throw new Error('unreachable')
    expect(result.message).toContain('wormhole')
    expect(result.message).toContain('no such view')
  })
})

describe('splitCsvParam', () => {
  it('returns [] for null and empty', () => {
    expect(splitCsvParam(null)).toEqual([])
    expect(splitCsvParam('')).toEqual([])
  })

  it('trims and drops empties', () => {
    expect(splitCsvParam('a, b ,,c')).toEqual(['a', 'b', 'c'])
  })
})

describe('deepLinkMissingMessage', () => {
  it('offers both ordinary explanations without asserting either', () => {
    const message = deepLinkMissingMessage('the wine', 'w-1')
    expect(message).toContain('deleted')
    expect(message).toContain('different restaurant')
  })
})
