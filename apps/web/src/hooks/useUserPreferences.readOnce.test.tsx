/**
 * The preferences blob is read by the shell (GroundChoiceSync, the guidance
 * provider) and again by whatever the page mounts a moment later. Under
 * App.tsx's `refetchOnMount: 'always'` default the second reader fetched it
 * again: two GETs of `/users/:id/preferences` on every page load (r18 walk,
 * production build). A reader that mounts while the answer is still fresh
 * must use it.
 */
import { act, render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const get = vi.hoisted(() => vi.fn())

vi.mock('../services/api/client', () => ({
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    patch: vi.fn(),
  },
}))
vi.mock('../stores', () => ({
  useAuthStore: (pick: (s: { user: { userId: string } }) => unknown) =>
    pick({ user: { userId: 'u-1' } }),
}))

import { useUserPreferences } from './useUserPreferences'

/** App.tsx's query defaults (module-private there), copied as they stand. */
function appClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        refetchOnWindowFocus: true,
        refetchOnMount: 'always',
        retry: 1,
        throwOnError: false,
      },
    },
  })
}

function Reader({ label }: { label: string }) {
  const { preferences } = useUserPreferences()
  return <p data-testid={label}>{String(preferences.ground ?? 'none')}</p>
}

let mountPage: () => void = () => {}
function Shell({ children }: { children?: ReactNode }) {
  const [page, setPage] = useState(false)
  mountPage = () => setPage(true)
  return (
    <>
      <Reader label="shell" />
      {page ? <Reader label="page" /> : null}
      {children}
    </>
  )
}

beforeEach(() => {
  get.mockReset()
  get.mockResolvedValue({ data: { preferences: { ground: 'paper' } } })
})

describe('useUserPreferences', () => {
  it('reads the blob once when a second reader mounts while it is fresh', async () => {
    const client = appClient()
    const view = render(
      <QueryClientProvider client={client}>
        <Shell />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(view.getByTestId('shell').textContent).toBe('paper'))
    act(() => mountPage())
    expect(view.getByTestId('page').textContent).toBe('paper')
    // Give a mount-time refetch the chance to start before counting.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(get).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledWith('/users/u-1/preferences')
  })

  it('still reads it again when a reader mounts after the answer went stale', async () => {
    const client = appClient()
    const view = render(
      <QueryClientProvider client={client}>
        <Shell />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(view.getByTestId('shell').textContent).toBe('paper'))
    get.mockClear()
    // Stale without refetching now, as after 30 s or a write elsewhere.
    client.getQueryCache().find({ queryKey: ['user', 'preferences', 'u-1'] })?.invalidate()
    act(() => mountPage())
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
  })
})
