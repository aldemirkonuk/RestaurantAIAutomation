/**
 * F-413 (wave-9 sim): the downloaded file was named `mudavym-<cutting>-<UTC
 * date>` — no house, no window, and the UTC day, so a Los Angeles house writing
 * at 18:00 saved tomorrow's date and a 7-day and a 90-day till export written
 * the same day collided. The gateway now names the file on the house's clock
 * (`fileStem`); the client uses that name, and a UTC fallback says it is UTC.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { downloadReportExport } from './reports'
import { apiClient } from './client'

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client')
  return { ...actual, apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }
})

const http = vi.mocked(apiClient) as unknown as { get: ReturnType<typeof vi.fn> }

beforeEach(() => {
  http.get.mockReset()
  http.get.mockResolvedValue({ data: 'House,Tuzlu\r\n' })
})

describe('an export downloads under the name the gateway gave it', () => {
  it("uses the house's own name, cutting and window", async () => {
    const file = await downloadReportExport(
      {
        id: 'e1',
        cutting: 'till',
        // 01:30 UTC on the 10th is still the 9th in Los Angeles.
        finishedAt: '2026-10-10T01:30:00.000Z',
        fileStem: 'mudavym-tuzlu-ruzgar-till-2026-10-03-to-2026-10-09',
      },
      'csv',
    )
    expect(file.filename).toBe('mudavym-tuzlu-ruzgar-till-2026-10-03-to-2026-10-09.csv')
  })

  it('labels a UTC fallback as UTC when the gateway did not name the file', async () => {
    const file = await downloadReportExport(
      { id: 'e1', cutting: 'ledger', finishedAt: '2026-10-10T01:30:00.000Z', fileStem: null },
      'html',
    )
    expect(file.filename).toBe('mudavym-ledger-2026-10-10-utc.html')
  })
})
