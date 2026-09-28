/**
 * Item 62 (2026-09-27), founder verbatim: "Browser zone, else none
 * (Recommended)". A sign-up request must carry the browser's own zone when
 * `Intl` can produce one, and must omit the field — never throw, never
 * substitute a default — when it cannot.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { getBrowserTimezone } from './browserTimezone'

describe('getBrowserTimezone', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the zone Intl resolves in this environment', () => {
    const zone = getBrowserTimezone()
    expect(typeof zone).toBe('string')
    expect(zone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })

  it('returns undefined, not a throw, when Intl.DateTimeFormat itself throws', () => {
    const original = Intl.DateTimeFormat
    // Simulates a runtime whose Intl implementation cannot resolve a zone —
    // the case that used to crash `GetStarted.tsx`'s render and abort
    // `Register.tsx` / `AuthContext.tsx`'s submit before this fix.
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
      throw new Error('Intl unavailable in this runtime')
    })
    expect(() => getBrowserTimezone()).not.toThrow()
    expect(getBrowserTimezone()).toBeUndefined()
    expect(Intl.DateTimeFormat).not.toBe(original)
  })

  it('returns undefined when resolvedOptions().timeZone is empty', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
      () => ({ resolvedOptions: () => ({ timeZone: '' }) }) as any,
    )
    expect(getBrowserTimezone()).toBeUndefined()
  })
})
