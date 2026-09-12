import { describe, expect, it } from 'vitest'
import { DEFAULT_SETUP_NUDGE, isSetupNudgeDue } from './types'

describe('isSetupNudgeDue', () => {
  it('returns false when dismissed forever', () => {
    expect(
      isSetupNudgeDue({ ...DEFAULT_SETUP_NUDGE, dismissed_forever: true, last_shown_at: '2020-01-01' }),
    ).toBe(false)
  })

  it('returns true when never shown', () => {
    expect(isSetupNudgeDue(DEFAULT_SETUP_NUDGE)).toBe(true)
  })

  it('respects Later snooze backoff (1 day after first snooze)', () => {
    const now = Date.parse('2026-07-30T12:00:00Z')
    const nudge = {
      ...DEFAULT_SETUP_NUDGE,
      snooze_count: 1,
      last_shown_at: '2026-07-30T11:00:00Z',
      session_count: 1,
    }
    expect(isSetupNudgeDue(nudge, now)).toBe(false)
    expect(isSetupNudgeDue(nudge, now + 25 * 60 * 60 * 1000)).toBe(true)
  })
})
