/**
 * r36 onboarding gap 2: the mailbox step says orders leave from the house's
 * own address, and it ticked on any Gmail grant, a reading one included. A
 * reading grant sends nothing. The step now ticks on a grant to send.
 */
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LearnPanel } from './LearnPanel'
import type { OnboardingProgress } from '../../services/api/menus'

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn() }
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

const mailbox = (next: OnboardingProgress['next_steps']) => {
  render(
    <MemoryRouter>
      <LearnPanel progress={{ ...base, next_steps: next }} mode="get-started" anchorRef={{ current: null }} onClose={vi.fn()} />
    </MemoryRouter>,
  )
  const row = document.querySelector('[data-step="mailbox"]') as HTMLElement
  return {
    ticked: row.querySelector('.line-through') !== null,
    unread: /Not read just now/.test(row.textContent ?? ''),
  }
}

describe('the mailbox step ticks on a grant to send', () => {
  it('a reading grant alone leaves the step open', () => {
    expect(mailbox({ goods_listed: true, mailbox_connected: true, mailbox_sends: false, invoice: 'none' }).ticked).toBe(false)
  })

  it('a grant to send ticks it', () => {
    expect(mailbox({ goods_listed: true, mailbox_connected: true, mailbox_sends: true, invoice: 'none' }).ticked).toBe(true)
  })

  it('a send read that failed is said as not read, never ticked', () => {
    const step = mailbox({ goods_listed: true, mailbox_connected: true, mailbox_sends: null, invoice: 'none' })
    expect(step.ticked).toBe(false)
    expect(step.unread).toBe(true)
  })

  it('an older gateway (no send fact) reads the one grant fact it has', () => {
    expect(mailbox({ goods_listed: true, mailbox_connected: true, invoice: 'none' }).ticked).toBe(true)
  })

  it('an older gateway whose grant read failed is not read', () => {
    expect(mailbox({ goods_listed: true, mailbox_connected: null, invoice: 'none' }).unread).toBe(true)
  })
})
