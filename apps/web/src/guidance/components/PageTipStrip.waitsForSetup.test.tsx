/**
 * Onboarding walk 2026-11-12: a new owner's first desk stacked four things at
 * once (the terms sheet, the theme question, the finish-setup banner and the
 * dashboard's "Take tour" tip). The tip now waits while the setup banner is
 * up, and it is counted and announced only when it is actually on screen.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PageTipStrip } from './PageTipStrip'

const offerTip = vi.fn()
let nudgeShowing = false

vi.mock('../usePageGuidance', () => ({
  usePageGuidance: () => ({
    showTip: true,
    pageId: 'dashboard',
    tipDef: { title: 'Your desk', body: 'What needs you today.' },
    guidance: {
      offerTip,
      completeTipViaTour: vi.fn(),
      snoozeTip: vi.fn(),
      dismissTip: vi.fn(),
    },
  }),
}))
vi.mock('../useSetupNudge', () => ({
  useSetupNudgeShowing: () => nudgeShowing,
}))

describe('PageTipStrip waits for the setup nudge', () => {
  beforeEach(() => {
    offerTip.mockClear()
    nudgeShowing = false
  })

  it('shows no tip, and offers none, while the setup nudge is up', () => {
    nudgeShowing = true
    render(<PageTipStrip />)
    expect(screen.queryByRole('button', { name: 'Take tour' })).not.toBeInTheDocument()
    expect(screen.queryByText('Your desk')).not.toBeInTheDocument()
    expect(offerTip).not.toHaveBeenCalled()
  })

  it('shows the tip, and offers it once, when no setup nudge is up', () => {
    const { rerender } = render(<PageTipStrip />)
    expect(screen.getByRole('button', { name: 'Take tour' })).toBeInTheDocument()
    expect(screen.getByText('Your desk')).toBeInTheDocument()
    rerender(<PageTipStrip />)
    expect(offerTip).toHaveBeenCalledTimes(1)
    expect(offerTip).toHaveBeenCalledWith('dashboard')
  })

  it('comes back once the nudge is put away', () => {
    nudgeShowing = true
    const { rerender } = render(<PageTipStrip />)
    expect(screen.queryByRole('button', { name: 'Take tour' })).not.toBeInTheDocument()
    nudgeShowing = false
    rerender(<PageTipStrip />)
    expect(screen.getByRole('button', { name: 'Take tour' })).toBeInTheDocument()
    expect(offerTip).toHaveBeenCalledWith('dashboard')
  })
})
