/**
 * r28 onboarding gap 3: the Get started panel stopped at a menu, a vendor
 * and an invite. It now goes on to the steps that lead to the house's costs
 * (goods on the list, the house's Gmail, the first invoice checked), read
 * from the house. They are not part of setup's count, and a step whose read
 * failed is said as not read: never ticked, never called not done.
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

const base: OnboardingProgress = {
  id: null,
  user_id: 'u-1',
  restaurant_id: 'rest-A',
  menu_uploaded: true,
  menu_current: true,
  vendor_added: false,
  team_member_invited: false,
  checklist_dismissed: false,
  completed_at: null,
  threshold_configured: true,
  activated: true,
}

const onClose = vi.fn()

function renderPanel(progress: OnboardingProgress | null, mode: 'get-started' | 'learn' = 'get-started') {
  return render(
    <MemoryRouter>
      <LearnPanel progress={progress} mode={mode} anchorRef={{ current: null }} onClose={onClose} />
    </MemoryRouter>,
  )
}

const step = (id: string) => {
  const row = document.querySelector(`[data-step="${id}"]`) as HTMLElement | null
  if (!row) throw new Error(`no step ${id}`)
  return row
}

describe('the Get started panel goes on past the menu', () => {
  beforeEach(() => {
    navigate.mockClear()
    onClose.mockClear()
  })

  it('names the three next steps, each with why and a way there, when none is done', () => {
    renderPanel({
      ...base,
      next_steps: { goods_listed: false, mailbox_connected: false, invoice: 'none' },
    })
    expect(screen.getByText('Then, to see your costs')).toBeInTheDocument()
    expect(within(step('goods')).getByText('Put your first goods on the list')).toBeInTheDocument()
    expect(within(step('goods')).getByText('Stock, and what runs low, are read from it.')).toBeInTheDocument()
    expect(within(step('mailbox')).getByText("Connect the house's Gmail")).toBeInTheDocument()
    expect(within(step('invoice')).getByText('Check your first invoice')).toBeInTheDocument()
    expect(within(step('invoice')).getByText('Costs come from the invoices you check.')).toBeInTheDocument()

    fireEvent.click(within(step('goods')).getByRole('button', { name: /Count the first goods/ }))
    expect(navigate).toHaveBeenLastCalledWith('/inventory')
    fireEvent.click(within(step('mailbox')).getByRole('button', { name: /Set it up/ }))
    expect(navigate).toHaveBeenLastCalledWith('/communications?tab=mail&setup=1')
    fireEvent.click(within(step('invoice')).getByRole('button', { name: /Open Receipts/ }))
    expect(navigate).toHaveBeenLastCalledWith('/receipts')
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('ticks a step the house has done and offers no way there', () => {
    renderPanel({
      ...base,
      next_steps: { goods_listed: true, mailbox_connected: true, invoice: 'checked' },
    })
    for (const id of ['goods', 'mailbox', 'invoice']) {
      expect(within(step(id)).getByLabelText('Done')).toBeInTheDocument()
      expect(within(step(id)).queryByRole('button')).toBeNull()
    }
  })

  it('an invoice that came in and is not checked is named as that one', () => {
    renderPanel({
      ...base,
      next_steps: { goods_listed: true, mailbox_connected: false, invoice: 'waiting' },
    })
    expect(within(step('invoice')).getByText('Check the invoice that came in')).toBeInTheDocument()
    fireEvent.click(within(step('invoice')).getByRole('button', { name: /Check it/ }))
    expect(navigate).toHaveBeenLastCalledWith('/receipts')
    expect(within(step('invoice')).queryByLabelText('Done')).toBeNull()
  })

  it('a step whose read failed is said as not read: no tick, the way there kept', () => {
    renderPanel({
      ...base,
      next_steps: { goods_listed: null, mailbox_connected: false, invoice: null },
    })
    for (const id of ['goods', 'invoice']) {
      expect(within(step(id)).queryByLabelText('Done')).toBeNull()
      expect(
        within(step(id)).getByText('Not read just now, so not shown as done or not done.'),
      ).toBeInTheDocument()
      expect(within(step(id)).getByRole('button')).toBeInTheDocument()
    }
    expect(within(step('mailbox')).queryByText(/Not read just now/)).toBeNull()
  })

  it('the next steps are not in the setup count', () => {
    renderPanel({
      ...base,
      next_steps: { goods_listed: true, mailbox_connected: true, invoice: 'checked' },
    })
    // account + current menu = 2 of the 4 setup steps; three next steps done add nothing.
    expect(screen.getByText('2/4 complete')).toBeInTheDocument()
  })

  it('an older gateway with no next steps shows the setup alone', () => {
    renderPanel(base)
    expect(screen.queryByText('Then, to see your costs')).toBeNull()
    expect(screen.queryByTestId('setup-next-steps')).toBeNull()
  })

  it('Learn & Help (staff, and a house past setup) does not show them', () => {
    renderPanel(
      { ...base, next_steps: { goods_listed: false, mailbox_connected: false, invoice: 'none' } },
      'learn',
    )
    expect(screen.queryByTestId('setup-next-steps')).toBeNull()
  })
})
