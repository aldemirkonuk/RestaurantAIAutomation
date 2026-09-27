import { describe, it, expect } from 'vitest'
import { queryKeys } from './query-keys'

/**
 * (D5, 2026-09-19) `notification_preferences` is per (restaurant_id,
 * user_id) since ADR 0149 row 39. The React Query cache key for it used to
 * be userId-only, so switching the active house in the same session kept
 * serving the previous house's cached preferences under the same key.
 */
describe('queryKeys.notifications.preferences', () => {
  it('differs when the restaurant differs, for the same user', () => {
    const houseA = queryKeys.notifications.preferences('user-1', 'rest-a')
    const houseB = queryKeys.notifications.preferences('user-1', 'rest-b')
    expect(houseA).not.toEqual(houseB)
  })

  it('is the same key for the same (user, restaurant) pair', () => {
    const a = queryKeys.notifications.preferences('user-1', 'rest-a')
    const b = queryKeys.notifications.preferences('user-1', 'rest-a')
    expect(a).toEqual(b)
  })

  it('still produces a stable key when the restaurant is not yet known', () => {
    const noRid = queryKeys.notifications.preferences('user-1')
    const nullRid = queryKeys.notifications.preferences('user-1', null)
    expect(noRid).toEqual(nullRid)
  })
})
