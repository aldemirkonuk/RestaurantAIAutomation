/**
 * The decision log's wire mapping, asserted on the three shapes the gateway can
 * send (ADR 0149 answer 17, 2026-09-17).
 *
 * The page test mocks `fetchIdentityDecisions` whole, so the place a withheld
 * person could turn back into a blank name — or an older gateway's row into a
 * "withheld" one — is this mapping, and it is tested here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchIdentityDecisions } from './vendorIntel'
import { apiClient } from './client'

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client')
  return {
    ...actual,
    apiClient: { get: vi.fn(), put: vi.fn(), post: vi.fn() },
  }
})

const http = vi.mocked(apiClient) as unknown as { get: ReturnType<typeof vi.fn> }

const BASE = {
  id: 'd1',
  candidate_id: 'c1',
  restaurant_id: null,
  action: 'confirmed',
  decided_at: '2026-09-17T10:00:00.000Z',
  evidence_shown: {},
  link_written: 'price_index_postings.identity_id',
  undoes_decision_id: null,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('fetchIdentityDecisions', () => {
  it('keeps the person on a row this house took', async () => {
    http.get.mockResolvedValue({
      data: {
        items: [
          {
            ...BASE,
            decided_by: 'u1',
            decided_by_label: 'Aylin',
            decided_by_role: 'staff',
            note: 'checked',
            decided_in: 'this_house',
            person_shown: true,
            undo_refusal: null,
          },
        ],
        scope: 's',
        limit: 50,
        complete: true,
      },
    })
    const [row] = (await fetchIdentityDecisions()).items
    expect(row.decidedByLabel).toBe('Aylin')
    expect(row.personShown).toBe(true)
    expect(row.decidedIn).toBe('this_house')
    expect(row.undoRefusal).toBeNull()
  })

  it('carries a withheld person as withheld, with the refusal, never as a blank name', async () => {
    http.get.mockResolvedValue({
      data: {
        items: [
          {
            ...BASE,
            decided_by: null,
            decided_by_label: null,
            decided_by_role: null,
            note: null,
            decided_in: 'another_house',
            person_shown: false,
            undo_refusal: 'That decision on a shared register was taken in another house.',
          },
        ],
        complete: true,
      },
    })
    const [row] = (await fetchIdentityDecisions()).items
    expect(row.decidedByLabel).toBeNull()
    expect(row.decidedByRole).toBeNull()
    expect(row.personShown).toBe(false)
    expect(row.decidedIn).toBe('another_house')
    expect(row.undoRefusal).toMatch(/another house/)
  })

  it('reads a row from a gateway older than the deciding house as shown, with the house unknown rather than "this house"', async () => {
    http.get.mockResolvedValue({
      data: {
        items: [{ ...BASE, decided_by: 'u1', decided_by_label: 'Aylin', decided_by_role: 'staff' }],
        complete: true,
      },
    })
    const [row] = (await fetchIdentityDecisions()).items
    expect(row.personShown).toBe(true)
    expect(row.decidedIn).toBeNull()
    expect(row.undoRefusal).toBeNull()
  })
})
