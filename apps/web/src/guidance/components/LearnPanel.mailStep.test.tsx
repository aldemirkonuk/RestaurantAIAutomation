/**
 * The mailbox step (r36 onboarding gap 2, r36 mail gap 4).
 *
 * It used to say "Orders to vendors leave from the house's own address".
 * They do not: an order leaves from Mudavym's mailbox in the house's name.
 * The house's own Gmail does two things, each with its own grant: a letter
 * written in Mail leaves from it (sending), and what the house's vendors send
 * to it comes into Mail (reading, which also needs the house's switch). The
 * step is done when both hold, names the half that is missing, and leads to
 * Mail setup. An older gateway (no reading fact) keeps the sending-only step.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, within } from '@testing-library/react'
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

const mailbox = (next: OnboardingProgress['next_steps']) => {
  render(
    <MemoryRouter>
      <LearnPanel progress={{ ...base, next_steps: next }} mode="get-started" anchorRef={{ current: null }} onClose={vi.fn()} />
    </MemoryRouter>,
  )
  const row = document.querySelector('[data-step="mailbox"]') as HTMLElement
  return {
    row,
    text: row.textContent ?? '',
    ticked: row.querySelector('.line-through') !== null,
    unread: /Not read just now/.test(row.textContent ?? ''),
  }
}

const facts = (sends: boolean | null, reads: boolean | null | undefined) => ({
  goods_listed: true,
  mailbox_connected: sends === true || reads === true,
  mailbox_sends: sends,
  ...(reads === undefined ? {} : { mailbox_reads: reads }),
  invoice: 'none' as const,
})

describe('the mailbox step says what the house\'s Gmail does', () => {
  beforeEach(() => navigate.mockClear())

  it('never says orders leave from the house\'s address', () => {
    for (const [s, r] of [[false, false], [true, false], [false, true], [true, undefined], [false, undefined]] as const) {
      const step = mailbox(facts(s, r))
      expect(step.text).not.toMatch(/Orders/i)
      step.row.remove()
    }
  })

  it('with neither half, names both and leads to Mail setup', () => {
    const step = mailbox(facts(false, false))
    expect(step.ticked).toBe(false)
    expect(within(step.row).getByText("Connect the house's Gmail")).toBeInTheDocument()
    expect(step.text).toContain(
      "Then letters you write to vendors in Mail leave from the house's address, and what they send to it comes into Mail.",
    )
    fireEvent.click(within(step.row).getByRole('button', { name: /Set it up/ }))
    expect(navigate).toHaveBeenLastCalledWith('/communications?tab=mail&setup=1')
  })

  it('sending alone is not done: it names the reading half', () => {
    const step = mailbox(facts(true, false))
    expect(step.ticked).toBe(false)
    expect(within(step.row).getByText("Let Mail read the house's Gmail")).toBeInTheDocument()
    expect(step.text).toContain('their answers do not come into Mail')
  })

  it('reading alone is not done: it names the sending half', () => {
    const step = mailbox(facts(false, true))
    expect(step.ticked).toBe(false)
    expect(within(step.row).getByText("Let letters leave from the house's Gmail")).toBeInTheDocument()
    expect(step.text).toContain('cannot leave from it yet')
  })

  it('both halves tick it, with no way there', () => {
    const step = mailbox(facts(true, true))
    expect(step.ticked).toBe(true)
    expect(within(step.row).queryByRole('button')).toBeNull()
  })

  it('a half whose read failed is said as not read, never ticked and never called missing', () => {
    for (const [s, r] of [[true, null], [null, true], [null, false]] as const) {
      const step = mailbox(facts(s, r))
      expect(step.ticked).toBe(false)
      expect(step.unread).toBe(true)
      expect(step.text).not.toMatch(/Let Mail read|Let letters leave/)
      step.row.remove()
    }
  })

  it('an older gateway (no reading fact) keeps the sending-only step and ticks on sending', () => {
    const open = mailbox(facts(false, undefined))
    expect(open.ticked).toBe(false)
    expect(open.text).toContain("Letters you write to vendors in Mail leave from the house's own address.")
    open.row.remove()
    expect(mailbox(facts(true, undefined)).ticked).toBe(true)
  })

  it('a gateway older still (no send fact) reads the one grant fact it has', () => {
    expect(mailbox({ goods_listed: true, mailbox_connected: true, invoice: 'none' }).ticked).toBe(true)
  })

  it('an older gateway whose grant read failed is not read', () => {
    expect(mailbox({ goods_listed: true, mailbox_connected: null, invoice: 'none' }).unread).toBe(true)
  })
})
