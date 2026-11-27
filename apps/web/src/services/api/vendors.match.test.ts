/**
 * r109: a failed catalogue read is `null`, not `[]` (ADR 0020). `[]` is a real
 * answer ("no match"); the page must be able to tell the two apart.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const answer = vi.hoisted(() => ({ next: 'fail' as 'fail' | 'none' }))
vi.mock('./client', () => ({
  apiClient: {
    get: async () => {
      if (answer.next === 'fail') throw new Error('503')
      return { data: [] }
    },
  },
}))

import { matchVendorCatalogue } from './vendors'

beforeEach(() => {
  answer.next = 'fail'
})

describe('matchVendorCatalogue', () => {
  it('answers null when the read failed, never an empty list', async () => {
    expect(await matchVendorCatalogue('Suvla', undefined, 'TR')).toBeNull()
  })

  it('answers [] when the catalogue was asked and knows no match', async () => {
    answer.next = 'none'
    expect(await matchVendorCatalogue('Suvla')).toEqual([])
  })
})
