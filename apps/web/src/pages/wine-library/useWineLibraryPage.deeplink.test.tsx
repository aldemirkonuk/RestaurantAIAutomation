/**
 * `/wines?search=` and `/wines?wineId=` receiving side.
 *
 * The QR code printed on every bottle encodes `/wines?wineId=<id>`
 * (QRCodeGenerator.tsx:38), and the dashboard's top-wine rows link with both
 * shapes (Dashboard.tsx:1054, 1814). This page read neither, so a scan landed
 * on the unfiltered library.
 *
 * The subtle rule here is the SOURCE of the answer: `useWines` is capped at
 * 500 rows and is itself narrowed by the search box, so "not in the visible
 * list" is not evidence a wine does not exist. `wineId` is therefore resolved
 * against a direct by-id fetch, and "missing" is only claimed once THAT has
 * settled.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { Wine as ApiWine } from '../../services/api/types'

const q = vi.hoisted(() => ({
  wines: [] as ApiWine[],
  byIds: [] as ApiWine[],
  byIdsPending: false,
  lastByIdsArg: null as string[] | null,
}))

vi.mock('../../hooks/queries', () => ({
  useWines: () => ({ data: q.wines, isLoading: false, error: null }),
  useWinesByIds: (ids: string[]) => {
    q.lastByIdsArg = ids
    return { data: q.byIds, isPending: q.byIdsPending }
  },
  useInventory: () => ({ data: [] }),
  useProviders: () => ({ data: [] }),
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { restaurantId: 'r-1' } }),
}))

import { useWineLibraryPage } from './useWineLibraryPage'

function apiWine(over: Partial<ApiWine> & { id: string }): ApiWine {
  return {
    name: 'A Wine',
    producer: 'A Producer',
    vintage: 2021,
    price: 40,
    category: 'red',
    grapeVariety: 'Chardonnay',
    country: 'France',
    region: 'Burgundy',
    appellation: 'Chablis',
    bottleSizeMl: 750,
    ...over,
  } as ApiWine
}

function at(url: string) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
  )
}

beforeEach(() => {
  q.wines = []
  q.byIds = []
  q.byIdsPending = false
  q.lastByIdsArg = null
})

describe('?search=', () => {
  it('seeds the search box from the URL', () => {
    const { result } = renderHook(() => useWineLibraryPage(), {
      wrapper: at('/wines?search=Chablis%20Premier%20Cru'),
    })
    expect(result.current.searchQuery).toBe('Chablis Premier Cru')
  })

  it('leaves the box empty with no parameter', () => {
    const { result } = renderHook(() => useWineLibraryPage(), { wrapper: at('/wines') })
    expect(result.current.searchQuery).toBe('')
  })

  it('actually narrows the list, not just the input', () => {
    q.wines = [
      apiWine({ id: 'w1', name: 'Chablis Premier Cru' }),
      apiWine({ id: 'w2', name: 'Barolo Riserva' }),
    ]
    const { result } = renderHook(() => useWineLibraryPage(), {
      wrapper: at('/wines?search=Chablis'),
    })
    expect(result.current.filteredWines.map((w) => w.id)).toEqual(['w1'])
  })
})

describe('?wineId=', () => {
  it('is idle without the parameter, and asks for no by-id fetch', () => {
    const { result } = renderHook(() => useWineLibraryPage(), { wrapper: at('/wines') })
    expect(result.current.deepLinkWine).toEqual({ status: 'idle' })
    expect(q.lastByIdsArg).toEqual([])
  })

  it('resolves a wine that is already in the visible library', () => {
    q.wines = [apiWine({ id: 'w1', name: 'Chablis Premier Cru' })]
    const { result } = renderHook(() => useWineLibraryPage(), { wrapper: at('/wines?wineId=w1') })
    expect(result.current.deepLinkWine.status).toBe('found')
    if (result.current.deepLinkWine.status !== 'found') throw new Error('unreachable')
    expect(result.current.deepLinkWine.target.name).toBe('Chablis Premier Cru')
  })

  it('resolves a wine beyond the 500-row page via the by-id fetch', () => {
    // The visible list does NOT contain it — the whole point.
    q.wines = [apiWine({ id: 'other' })]
    q.byIds = [apiWine({ id: 'w-far', name: 'Deep Cut' })]
    const { result } = renderHook(() => useWineLibraryPage(), {
      wrapper: at('/wines?wineId=w-far'),
    })
    expect(q.lastByIdsArg).toEqual(['w-far'])
    expect(result.current.deepLinkWine.status).toBe('found')
    if (result.current.deepLinkWine.status !== 'found') throw new Error('unreachable')
    expect(result.current.deepLinkWine.target.name).toBe('Deep Cut')
  })

  it('does NOT claim missing while the by-id fetch is still in flight', () => {
    q.byIdsPending = true
    const { result } = renderHook(() => useWineLibraryPage(), {
      wrapper: at('/wines?wineId=w-unknown'),
    })
    expect(result.current.deepLinkWine.status).toBe('pending')
  })

  it('says so in words once the by-id fetch comes back empty', () => {
    q.byIds = []
    const { result } = renderHook(() => useWineLibraryPage(), {
      wrapper: at('/wines?wineId=w-deleted'),
    })
    expect(result.current.deepLinkWine.status).toBe('missing')
    if (result.current.deepLinkWine.status !== 'missing') throw new Error('unreachable')
    expect(result.current.deepLinkWine.message).toContain('w-deleted')
    expect(result.current.deepLinkWine.message).toContain('the wine')
  })
})
