/**
 * The client half of ADR 0088's three refusals — asserted on the BODY, not on
 * the call.
 *
 * ADR 0088 (gateway, #256) made `copy-week` 409 without `replaceTarget: true`
 * on a non-empty target week, `publish` 409 without `resetReceipts: true` when
 * read receipts exist, and `broadcast` 400 unless it names exactly one of
 * `memberIds` or `audience: "everyone"`. ADR 0089 (page, #257) shipped the
 * confirmations FIRST and deliberately sent none of the three fields, because
 * the gateway DTO did not know them yet. Both landed on `main` on 2026-09-02
 * with the client half never written, so "Copy last week", "Re-publish" and
 * "Broadcast crew" answered 409/409/400 on every click.
 *
 * These assert the request body because that is the only thing the gateway
 * reads. A component test can only prove this module was called; it cannot see
 * which fields survive into the POST, and the fields were exactly what was
 * missing.
 *
 * The negative cases matter as much as the positive ones: an unconditional
 * `replaceTarget: true` would turn the server-side guard into a formality, and
 * a first publish that claims `resetReceipts` asks to destroy receipts it does
 * not have.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { broadcast, copyWeek, publishSchedule } from './team'
import { apiClient } from './client'

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client')
  return {
    ...actual,
    apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
    getActiveRestaurantId: () => 'r-alpha',
  }
})

const http = vi.mocked(apiClient) as unknown as { post: ReturnType<typeof vi.fn> }

const bodyOf = () => http.post.mock.calls[0][1] as Record<string, unknown>
const pathOf = () => http.post.mock.calls[0][0] as string

beforeEach(() => {
  http.post.mockReset()
  http.post.mockResolvedValue({ data: {} })
})

describe('copy-week carries the replacement consent it was given', () => {
  it('sends replaceTarget when the caller has confirmed the replacement', async () => {
    await copyWeek('2026-08-24', '2026-08-31', { replaceTarget: true })
    expect(pathOf()).toBe('/restaurants/r-alpha/team/schedules/copy-week')
    expect(bodyOf()).toEqual({
      fromWeekStart: '2026-08-24',
      toWeekStart: '2026-08-31',
      replaceTarget: true,
    })
  })

  it('omits replaceTarget entirely when it was not asked for, so the 409 still guards', async () => {
    await copyWeek('2026-08-24', '2026-08-31')
    expect(bodyOf()).toEqual({ fromWeekStart: '2026-08-24', toWeekStart: '2026-08-31' })
    expect(bodyOf()).not.toHaveProperty('replaceTarget')
  })
})

describe('publish only claims the receipts it was told to clear', () => {
  it('sends resetReceipts on a confirmed re-publish', async () => {
    await publishSchedule('sch1', { resetReceipts: true })
    expect(pathOf()).toBe('/restaurants/r-alpha/team/schedules/sch1/publish')
    expect(bodyOf()).toEqual({ resetReceipts: true })
  })

  it('a first publish sends no resetReceipts — it destroys nothing', async () => {
    await publishSchedule('sch1')
    expect(bodyOf()).toEqual({})
    expect(bodyOf()).not.toHaveProperty('resetReceipts')
  })
})

describe('a broadcast names who it is for', () => {
  it('a crew send says audience: everyone out loud, and names no member', async () => {
    await broadcast({ message: 'doors at 5', audience: 'everyone' })
    expect(pathOf()).toBe('/restaurants/r-alpha/team/broadcast')
    expect(bodyOf()).toEqual({ message: 'doors at 5', audience: 'everyone' })
    expect(bodyOf()).not.toHaveProperty('memberIds')
  })

  it('a one-person send names the member and claims no audience', async () => {
    await broadcast({ message: 'you are on bar', memberIds: ['m1'] })
    expect(bodyOf()).toEqual({ message: 'you are on bar', memberIds: ['m1'] })
    expect(bodyOf()).not.toHaveProperty('audience')
  })
})
