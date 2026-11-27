/**
 * r109: a failed catalogue read is `null`, not `[]` (ADR 0020). `[]` is a real
 * answer ("no match"); the page must be able to tell the two apart.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { get } = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('./client', () => ({ apiClient: { get } }))

import { matchVendorCatalogue } from './vendors'

beforeEach(() => get.mockReset())

describe('matchVendorCatalogue', () => {
  it('answers null when the read failed, never an empty list', async () => {
    get.mockRejectedValue(new Error('503'))
    expect(await matchVendorCatalogue('Suvla', undefined, 'TR')).toBeNull()
  })

  it('answers [] when the catalogue was asked and knows no match', async () => {
    get.mockResolvedValue({ data: [] })
    expect(await matchVendorCatalogue('Suvla')).toEqual([])
  })
})
