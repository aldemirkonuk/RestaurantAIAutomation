/**
 * r36 onboarding gap 1: making the first menu current puts every drink on
 * the house's list at stock 0, uncounted. The count step used to tick on
 * "on the list", so it ticked itself the moment the menu became current.
 * It now ticks only once a good has been counted, and says why it is open
 * when the menu filled the list.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, within, fireEvent } from '@testing-library/react'
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
  vendor_added: true,
  team_member_invited: false,
  checklist_dismissed: false,
  completed_at: null,
  threshold_configured: true,
  activated: true,
}

const onClose = vi.fn()
const steps = (next: OnboardingProgress['next_steps'], mode: 'get-started' | 'learn' = 'get-started', showNextSteps = false) =>
  render(
    <MemoryRouter>
      <LearnPanel
        progress={{ ...base, next_steps: next }}
        mode={mode}
        anchorRef={{ current: null }}
        onClose={onClose}
        showNextSteps={showNextSteps}
      />
    </MemoryRouter>,
  )

const goods = () => {
  const row = document.querySelector('[data-step="goods"]') as HTMLElement | null
  if (!row) throw new Error('no goods step')
  return row
}
const ticked = () => goods().querySelector('.line-through') !== null

describe('the count step waits for a count, not for the list', () => {
  beforeEach(() => {
    navigate.mockClear()
    onClose.mockClear()
  })

  it('goods the menu put on the list, none counted: the step is open, says why, and leads to the count', () => {
    steps({ goods_listed: true, goods_counted: false, mailbox_connected: false, invoice: 'none' })
    expect(within(goods()).getByText('Count the goods on your list')).toBeInTheDocument()
    expect(
      within(goods()).getByText('Your menu put them on the list. Until one is counted, its stock is not known.'),
    ).toBeInTheDocument()
    expect(ticked()).toBe(false)
    fireEvent.click(within(goods()).getByRole('button', { name: /Count the first goods/ }))
    expect(navigate).toHaveBeenCalledWith('/inventory')
  })

  it('one good counted ticks the step', () => {
    steps({ goods_listed: true, goods_counted: true, mailbox_connected: false, invoice: 'none' })
    expect(within(goods()).getByText('Count your first goods')).toBeInTheDocument()
    expect(ticked()).toBe(true)
    expect(within(goods()).queryByRole('button', { name: /Count the first goods/ })).toBeNull()
  })

  it('nothing on the list and nothing counted: open, said as the first count', () => {
    steps({ goods_listed: false, goods_counted: false, mailbox_connected: false, invoice: 'none' })
    expect(within(goods()).getByText('Count your first goods')).toBeInTheDocument()
    expect(within(goods()).getByText('Stock, and what runs low, are read from the count.')).toBeInTheDocument()
    expect(ticked()).toBe(false)
  })

  it('a count that could not be read is not ticked, even with goods on the list', () => {
    steps({ goods_listed: true, goods_counted: null, mailbox_connected: false, invoice: 'none' })
    expect(ticked()).toBe(false)
    expect(within(goods()).getByRole('button', { name: /Count the first goods/ })).toBeInTheDocument()
  })

  it('an older gateway with no count fact names the list, the one fact it read', () => {
    steps({ goods_listed: true, mailbox_connected: false, invoice: 'none' })
    expect(within(goods()).getByText('Put your first goods on the list')).toBeInTheDocument()
    expect(within(goods()).queryByText(/Count your first goods|Count the goods on your list/)).toBeNull()
    expect(ticked()).toBe(true)
  })

  it('an older gateway with nothing on the list leaves the step open', () => {
    steps({ goods_listed: false, mailbox_connected: false, invoice: 'none' })
    expect(within(goods()).getByText('Put your first goods on the list')).toBeInTheDocument()
    expect(ticked()).toBe(false)
  })

  it('past setup, Learn & Help keeps the steps while the list is uncounted', () => {
    steps({ goods_listed: true, goods_counted: false, mailbox_connected: true, invoice: 'checked' }, 'learn', true)
    expect(within(goods()).getByText('Count the goods on your list')).toBeInTheDocument()
  })
})
