/**
 * F-947: a Turkish house's menu CSV prices "1.250" (#.##0). The gateway reads
 * that as 1250 only when it is told the house groups thousands by "."; the
 * upload never said so, and the whole file was refused.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { importMenu } from './menus'
import { apiClient } from './client'

const houseGroupMark = vi.hoisted(() => vi.fn())
vi.mock('../../hooks/useHouseGroupMark', () => ({ houseGroupMark }))
vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client')
  return { ...actual, apiClient: { post: vi.fn() } }
})

const post = vi.mocked(apiClient.post)

beforeEach(() => {
  vi.clearAllMocks()
  post.mockResolvedValue({ data: { menuId: 'm1', items: [] } } as never)
})

describe('importMenu sends the house mark with a file (F-947)', () => {
  it("sends the house's mark with a CSV", async () => {
    houseGroupMark.mockResolvedValue('.')
    await importMenu('csv', { csvContent: 'name,bottle_price\nMalbec,1.250\n' })
    expect(post.mock.calls[0][1]).toMatchObject({ method: 'csv', groupMark: '.' })
  })

  it('sends no mark when the house mark is unknown', async () => {
    houseGroupMark.mockResolvedValue(null)
    await importMenu('csv', { fileBase64: 'UEsDBA==' })
    expect(post.mock.calls[0][1]).not.toHaveProperty('groupMark')
  })

  it('sends no mark with a scan, which has no file cells to read', async () => {
    houseGroupMark.mockResolvedValue('.')
    await importMenu('scan', { imageBase64: 'iVBORw0KGgo=' })
    expect(houseGroupMark).not.toHaveBeenCalled()
    expect(post.mock.calls[0][1]).not.toHaveProperty('groupMark')
  })
})
