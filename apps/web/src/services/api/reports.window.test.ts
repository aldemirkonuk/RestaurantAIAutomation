/**
 * `GET /reports` became a WINDOW in ADR 0086 (#262) — it used to return the
 * whole table. Two consequences that pass had not carried through:
 *
 *  1. The gateway's `total: count ?? reports.length` was harmless while the read
 *     was unbounded, because the array WAS the table. With a cap it reports the
 *     page size as the count. Fixed server-side; this pins the client so the
 *     same fallback is not reintroduced one layer up.
 *  2. `listReports()` (the legacy half of /documents-reports) inherited the
 *     server's default page without knowing it existed. The cap is now declared
 *     and sent, so the page can say the list is a floor.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listReports, listReportsWithTotal, REPORTS_PAGE_LIMIT } from './reports'
import { apiClient } from './client'

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client')
  return { ...actual, apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }
})

const http = vi.mocked(apiClient) as unknown as { get: ReturnType<typeof vi.fn> }

beforeEach(() => http.get.mockReset())

describe('the report register never reports its page length as its total', () => {
  it('keeps a real total', async () => {
    http.get.mockResolvedValue({ data: { reports: [{ id: 'r1' }], total: 4000 } })
    expect((await listReportsWithTotal({ limit: 100 })).total).toBe(4000)
  })

  it('returns null — not the row count — when the gateway could not count', async () => {
    const reports = Array.from({ length: 100 }, (_, i) => ({ id: `r${i}` }))
    http.get.mockResolvedValue({ data: { reports, total: null } })

    const res = await listReportsWithTotal({ limit: 100 })

    expect(res.reports).toHaveLength(100)
    expect(res.total).toBeNull()
    expect(res.total).not.toBe(100)
  })

  it('returns null for a malformed body too, rather than inventing a count', async () => {
    http.get.mockResolvedValue({ data: { reports: [{ id: 'r1' }] } })
    expect((await listReportsWithTotal()).total).toBeNull()
  })
})

describe('the legacy list declares the window it is asking for', () => {
  it('sends the cap explicitly instead of inheriting the server default', async () => {
    http.get.mockResolvedValue({ data: { reports: [], total: 0 } })

    await listReports()

    expect(http.get.mock.calls[0][0]).toBe('/reports')
    expect(http.get.mock.calls[0][1]).toMatchObject({
      params: { limit: REPORTS_PAGE_LIMIT },
    })
  })
})
