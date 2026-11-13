/**
 * r28 menu G1: choosing a menu commits the switch before its prices are
 * carried, so the page must not stop waiting at the client's usual 30 s and
 * then say nothing changed. The call names its own, longer wait.
 */
import { describe, it, expect, vi } from 'vitest'
import { MAKE_CURRENT_TIMEOUT_MS, makeMenuCurrent } from './menus'
import { apiClient } from './client'

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client')
  return {
    ...actual,
    apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
    getActiveRestaurantId: () => 'rest-1',
  }
})

const http = vi.mocked(apiClient) as unknown as { post: ReturnType<typeof vi.fn> }

describe('makeMenuCurrent', () => {
  it('sends the fingerprint and waits two minutes, not the client default', async () => {
    http.post.mockResolvedValue({ data: { outcome: 'made_current' } })
    await makeMenuCurrent('menu-1', 'fp-1')
    expect(http.post).toHaveBeenCalledWith('/menu-versions/menu-1/make-current', { fingerprint: 'fp-1' }, { timeout: 120_000 })
    expect(MAKE_CURRENT_TIMEOUT_MS).toBeGreaterThan(30_000)
  })
})
