/**
 * r41 onboarding gap 5: the shell, its setup banner and its page tip asked
 * the house's setup read (8 gateway reads, one fanning out into 7 more) on
 * every boot for every role, and again on every return to the window after
 * 30 s, even once setup was finished or put away.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getOnboardingProgress } = vi.hoisted(() => ({ getOnboardingProgress: vi.fn() }))
vi.mock('../../services/api/menus', () => ({ getOnboardingProgress, updateOnboardingProgress: vi.fn() }))

import { AuthContext } from '../../contexts/AuthContext'
import { readsSetup, setupSettled, useOnboardingProgress } from './useOnboardingProgress'

const open = { completed_at: null, checklist_dismissed: false, activated: false, menu_current: false }
const finished = { completed_at: '2026-11-01T10:00:00Z', checklist_dismissed: false, activated: true, menu_current: true }

function mount(auth: { activeRole?: string | null; user?: { role?: string } | null } | undefined, client?: QueryClient) {
  // The app's own defaults (App.tsx): refetch on every mount, 5 s fresh.
  const qc = client ?? new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, refetchOnMount: 'always', retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      {auth === undefined ? children : <AuthContext.Provider value={auth as never}>{children}</AuthContext.Provider>}
    </QueryClientProvider>
  )
  return { ...renderHook(() => useOnboardingProgress(), { wrapper }), qc }
}

const settle = () => new Promise((done) => setTimeout(done, 0))

beforeEach(() => {
  vi.clearAllMocks()
  getOnboardingProgress.mockResolvedValue(open)
})
afterEach(() => {
  vi.useRealTimers()
  focusManager.setFocused(undefined)
})

describe('who the setup read is for', () => {
  it('a person who is staff in this house is never asked for it', async () => {
    const { result } = mount({ activeRole: 'staff', user: { role: 'staff' } })
    await settle()
    expect(getOnboardingProgress).not.toHaveBeenCalled()
    expect(result.current.progress).toBeNull()
    expect(result.current.isLoading).toBe(false)
    expect(result.current.isError).toBe(false)
  })

  it('the role in this house decides, not the account role', async () => {
    mount({ activeRole: 'owner', user: { role: 'staff' } })
    await waitFor(() => expect(getOnboardingProgress).toHaveBeenCalledTimes(1))
    vi.clearAllMocks()
    mount({ activeRole: null, user: { role: 'staff' } })
    await settle()
    expect(getOnboardingProgress).not.toHaveBeenCalled()
  })

  it('an owner, a manager, and a role not known yet are read as before', async () => {
    for (const auth of [{ activeRole: 'owner' }, { activeRole: 'manager' }, { activeRole: null, user: null }, undefined]) {
      vi.clearAllMocks()
      const { result } = mount(auth)
      await waitFor(() => expect(result.current.progress).toEqual(open))
      expect(getOnboardingProgress).toHaveBeenCalledTimes(1)
    }
  })

  it('readsSetup is false for staff only', () => {
    expect(readsSetup('staff')).toBe(false)
    for (const role of ['owner', 'manager', null, undefined]) expect(readsSetup(role)).toBe(true)
  })
})

describe('a settled setup is not asked again on every return to the window', () => {
  it('settled: finished or put away, with a current menu', () => {
    expect(setupSettled(finished as never)).toBe(true)
    expect(setupSettled({ ...open, checklist_dismissed: true, activated: true } as never)).toBe(true)
    expect(setupSettled({ ...finished, activated: false } as never)).toBe(false)
    expect(setupSettled({ ...open, checklist_dismissed: true } as never)).toBe(false)
    expect(setupSettled(open as never)).toBe(false)
    expect(setupSettled(null)).toBe(false)
  })

  async function focusAfter(minutes: number) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + minutes * 60_000)
    act(() => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })
    await settle()
  }

  it('a finished house: no read on return to the window, even an hour later', async () => {
    getOnboardingProgress.mockResolvedValue(finished)
    const { result } = mount({ activeRole: 'owner' })
    await waitFor(() => expect(result.current.progress).toEqual(finished))
    await focusAfter(60)
    expect(getOnboardingProgress).toHaveBeenCalledTimes(1)
  })

  it('a house still in setup is read again on return after 30 s', async () => {
    const { result } = mount({ activeRole: 'owner' })
    await waitFor(() => expect(result.current.progress).toEqual(open))
    await focusAfter(1)
    await waitFor(() => expect(getOnboardingProgress).toHaveBeenCalledTimes(2))
  })

  it('a second reader mounting while the read is fresh asks nothing new', async () => {
    const first = mount({ activeRole: 'owner' })
    await waitFor(() => expect(first.result.current.progress).toEqual(open))
    mount({ activeRole: 'owner' }, first.qc)
    await settle()
    expect(getOnboardingProgress).toHaveBeenCalledTimes(1)
  })
})
