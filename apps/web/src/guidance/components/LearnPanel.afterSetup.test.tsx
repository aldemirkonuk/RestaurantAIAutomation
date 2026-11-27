/**
 * After setup (r32 onboarding, the rest of r28 gap 3): once the menu, a vendor
 * and an invite are in, or the checklist is put away, the panel is Learn &
 * Help, and the steps to the house's costs used to go with the checklist.
 * An owner or a manager keeps them there until each is done; staff never see
 * them. "App usage guide" opens the guides on /help, not the first-house form.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LearnPanel } from './LearnPanel'
import type { OnboardingProgress } from '../../services/api/menus'

const navigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})
vi.mock('../GuidanceProvider', () => ({ useGuidanceOptional: () => null }))
vi.mock('../analytics', () => ({ trackGuidance: vi.fn() }))

const done: OnboardingProgress = {
  id: null,
  user_id: 'u-1',
  restaurant_id: 'rest-A',
  menu_uploaded: true,
  menu_current: true,
  vendor_added: true,
  team_member_invited: true,
  checklist_dismissed: false,
  completed_at: '2026-11-13T09:00:00Z',
  threshold_configured: true,
  activated: true,
}
const onClose = vi.fn()

function renderLearn(progress: OnboardingProgress | null, showNextSteps?: boolean) {
  return render(
    <MemoryRouter>
      <LearnPanel
        progress={progress}
        mode="learn"
        anchorRef={{ current: null }}
        onClose={onClose}
        showNextSteps={showNextSteps}
      />
    </MemoryRouter>,
  )
}
const section = () => screen.queryByTestId('setup-next-steps')

beforeEach(() => {
  navigate.mockClear()
  onClose.mockClear()
})

describe('Learn & Help keeps the steps to the costs', () => {
  it('an owner or manager past setup sees the steps not done yet, with the way there', () => {
    renderLearn({ ...done, next_steps: { goods_listed: true, mailbox_connected: false, invoice: 'none' } }, true)
    const box = section()
    expect(box).not.toBeNull()
    expect(within(box!).getByText('To see your costs')).toBeInTheDocument()
    expect(screen.queryByText('Then, to see your costs')).toBeNull()
    expect(within(box!).getByText("Connect the house's Gmail")).toBeInTheDocument()
    fireEvent.click(within(box!).getByRole('button', { name: /Open Receipts/ }))
    expect(navigate).toHaveBeenLastCalledWith('/receipts')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('once every step is done, Learn & Help says nothing more about them', () => {
    renderLearn({ ...done, next_steps: { goods_listed: true, mailbox_connected: true, invoice: 'checked' } }, true)
    expect(section()).toBeNull()
  })

  it('a step whose read failed is not done, so the steps stay', () => {
    renderLearn({ ...done, next_steps: { goods_listed: true, mailbox_connected: true, invoice: null } }, true)
    expect(section()).not.toBeNull()
    expect(screen.getByText('Not read just now, so not shown as done or not done.')).toBeInTheDocument()
  })

  it('staff (no showNextSteps) never see them', () => {
    renderLearn({ ...done, next_steps: { goods_listed: false, mailbox_connected: false, invoice: 'none' } })
    expect(section()).toBeNull()
  })

  it('an older gateway with no next steps shows none', () => {
    renderLearn(done, true)
    expect(section()).toBeNull()
  })
})

describe('the app usage guide', () => {
  it('opens the guides on /help, not the first-house form', () => {
    renderLearn(done)
    fireEvent.click(screen.getByRole('button', { name: 'App usage guide' }))
    expect(navigate).toHaveBeenCalledWith('/help')
    expect(navigate).not.toHaveBeenCalledWith('/get-started?tab=use')
    expect(onClose).toHaveBeenCalled()
  })
})
