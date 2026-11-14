/**
 * r36 onboarding gap 6: a house whose money is not set puts no cost on from
 * an invoice that names none and comes with no order. The checklist sent the
 * owner to "Check your first invoice" for their costs and said nothing of it.
 * A "Set the house's money" step now stands before the invoice step, only
 * when the house answered that it states no money.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LearnPanel } from './LearnPanel'
import type { OnboardingProgress } from '../../services/api/menus'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))

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
  vendor_added: true,
  team_member_invited: false,
  checklist_dismissed: false,
  completed_at: null,
  threshold_configured: true,
  activated: true,
}

const steps = { goods_listed: true, goods_counted: true, mailbox_connected: true, mailbox_sends: true, invoice: 'none' as const }

const panel = (next: OnboardingProgress['next_steps']) =>
  render(
    <MemoryRouter>
      <LearnPanel progress={{ ...base, next_steps: next }} mode="get-started" anchorRef={{ current: null }} onClose={vi.fn()} />
    </MemoryRouter>,
  )

const order = () => Array.from(document.querySelectorAll('[data-step]')).map((row) => row.getAttribute('data-step'))

beforeEach(() => navigate.mockReset())

describe('the money step stands before the invoice when no money is set', () => {
  it('names the step, says why, and leads to Settings › Currency', () => {
    panel({ ...steps, money_set: false })
    const row = document.querySelector('[data-step="money"]') as HTMLElement
    expect(row).not.toBeNull()
    expect(row).toHaveTextContent("Set the house's money")
    expect(row).toHaveTextContent('An invoice that names no money waits for it before its costs go on.')
    expect(row.querySelector('.line-through')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Set it →' }))
    expect(navigate).toHaveBeenCalledWith('/settings?tab=currency')
  })

  it('comes right before the invoice step', () => {
    panel({ ...steps, money_set: false })
    expect(order()).toEqual(['goods', 'mailbox', 'money', 'invoice'])
  })

  it('is not shown once the house states its money', () => {
    panel({ ...steps, money_set: true })
    expect(document.querySelector('[data-step="money"]')).toBeNull()
    expect(order()).toEqual(['goods', 'mailbox', 'invoice'])
  })

  it('is not shown when the money read failed', () => {
    panel({ ...steps, money_set: null })
    expect(document.querySelector('[data-step="money"]')).toBeNull()
    expect(order()).toEqual(['goods', 'mailbox', 'invoice'])
  })

  it('is not shown on a gateway that does not send it', () => {
    panel({ ...steps })
    expect(document.querySelector('[data-step="money"]')).toBeNull()
    expect(order()).toEqual(['goods', 'mailbox', 'invoice'])
  })
})
