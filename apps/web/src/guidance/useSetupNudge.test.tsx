/** One answer for the setup banner and the page tip: who sees the nudge, and where. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useSetupNudgeShowing } from './useSetupNudge'

let role: string | null = 'owner'
let progress: Record<string, unknown> | null = null
let guidance: Record<string, unknown> | null = null

vi.mock('./GuidanceProvider', () => ({ useGuidanceOptional: () => guidance }))
vi.mock('../hooks/queries/useOnboardingProgress', () => ({ useOnboardingProgress: () => ({ progress }) }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: role ? { userId: 'u-1', role } : null }) }))

function at(path: string) {
  return ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
}

describe('useSetupNudgeShowing', () => {
  beforeEach(() => {
    role = 'owner'
    progress = { activated: false }
    guidance = { setupNudgeDismissedThisSession: false, isSetupNudgeDue: true }
  })

  it('is true for an owner of a house not yet activated, on the desk', () => {
    expect(renderHook(useSetupNudgeShowing, { wrapper: at('/dashboard') }).result.current).toBe(true)
  })

  it('is false on the setup flow itself', () => {
    expect(renderHook(useSetupNudgeShowing, { wrapper: at('/get-started') }).result.current).toBe(false)
  })

  it('is false for staff, once activated, once put away, and when not due', () => {
    role = 'staff'
    expect(renderHook(useSetupNudgeShowing, { wrapper: at('/dashboard') }).result.current).toBe(false)
    role = 'owner'
    progress = { activated: true }
    expect(renderHook(useSetupNudgeShowing, { wrapper: at('/dashboard') }).result.current).toBe(false)
    progress = { activated: false }
    guidance = { setupNudgeDismissedThisSession: true, isSetupNudgeDue: true }
    expect(renderHook(useSetupNudgeShowing, { wrapper: at('/dashboard') }).result.current).toBe(false)
    guidance = { setupNudgeDismissedThisSession: false, isSetupNudgeDue: false }
    expect(renderHook(useSetupNudgeShowing, { wrapper: at('/dashboard') }).result.current).toBe(false)
  })

  it('is false while the progress has not been read', () => {
    progress = null
    expect(renderHook(useSetupNudgeShowing, { wrapper: at('/dashboard') }).result.current).toBe(false)
  })
})
