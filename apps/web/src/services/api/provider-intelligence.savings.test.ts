/**
 * F-347 tail: the savings read says "nothing measured" as `null`.
 *
 * The gateway's `getPromoSavings` answers `null` because no column records
 * what a promotion saved, and Nest sends a `null` handler result as an empty
 * body — so the client receives `''`. Typed as `PromoSavings`, that empty
 * string would pass for a savings object; it must come back as `null`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchPromoSavings } from './provider-intelligence'
import { apiClient } from './client'

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client')
  return { ...actual, apiClient: { get: vi.fn() } }
})

const get = apiClient.get as unknown as ReturnType<typeof vi.fn>

describe('fetchPromoSavings', () => {
  beforeEach(() => get.mockReset())

  it('reads the empty body Nest sends for a null answer as null', async () => {
    get.mockResolvedValue({ data: '' })
    await expect(fetchPromoSavings()).resolves.toBeNull()
  })

  it('reads a null body as null', async () => {
    get.mockResolvedValue({ data: null })
    await expect(fetchPromoSavings()).resolves.toBeNull()
  })

  it('hands a real savings object through', async () => {
    const savings = { totalSavings: 12.5, byProvider: [] }
    get.mockResolvedValue({ data: savings })
    await expect(fetchPromoSavings()).resolves.toEqual(savings)
  })
})
