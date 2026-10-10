/**
 * The invite dialog is the one shared legacy dialog a rebuilt page opens, and
 * ADR 0112's one documented exception: it is ANCHORED like a popover (operators
 * know it under its button) but MODAL like a sheet, because it is a form that
 * commits rather than a picker. An exception nobody tests is just an
 * inconsistency, so this file pins both halves of it — and pins that with the
 * gate off, the Radix dialog it always was renders unchanged, class string for
 * class string.
 *
 * Legacy class strings below are the ones on `origin/main` at ff62668c; the
 * last test re-reads that file and fails if they drift apart.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { InviteTeamDialog } from './InviteTeamDialog'
import { apiClient } from '../../services/api/client'
import { toast } from 'sonner'
import { claimMudavymShell, resetMudavymShell } from '../../lib/mudavym/shellGround'
import { forgetHouseZones } from '../../lib/houseZone'
import { fmtExpiry } from '../../pages/settings/next/st-format'

vi.mock('../../services/api/client', () => ({
  apiClient: { post: vi.fn() },
  getErrorMessage: (e: unknown) => String(e),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
// F-997: the expiry is worded on the house's clock; the zone is read once per house.
const houseZoneSaid = vi.hoisted(() => ({ zone: null as string | null }))
vi.mock('../../services/api/restaurants', () => ({
  restaurantsApi: { getOperatingHours: vi.fn(async () => ({ timezone: houseZoneSaid.zone })) },
}))

const LEGACY_OVERLAY = 'fixed inset-0 bg-black/30 z-50'
const LEGACY_CENTERED =
  'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl shadow-xl p-6 w-full max-w-md max-h-[min(90vh,calc(100vh-5rem))] overflow-y-auto'

const INVITE = {
  code: 'AB12CD34',
  // A fixed instant, so the words in the copy are the same words every day.
  expiresAt: '2026-09-11T18:00:00.000Z',
  inviteUrl: 'https://app.mudavym.com/invite/AB12CD34',
}

function draw(shellOn: boolean, opts: { anchored?: boolean; inviterIsOwner?: boolean } = {}) {
  if (shellOn) claimMudavymShell(Symbol('page'), 'paper')
  const anchor = document.createElement('button')
  document.body.appendChild(anchor)
  const onClose = vi.fn()
  const view = render(
    <InviteTeamDialog
      open
      onClose={onClose}
      restaurantId="rest-1"
      anchorRef={opts.anchored ? { current: anchor } : undefined}
      inviterIsOwner={opts.inviterIsOwner}
    />,
  )
  return { ...view, onClose }
}

beforeEach(() => {
  resetMudavymShell()
  vi.mocked(apiClient.post).mockReset()
  vi.mocked(apiClient.post).mockResolvedValue({ data: INVITE } as never)
})

describe('with no Mudavym page on screen', () => {
  it('renders the Radix dialog it always did, class string for class string', () => {
    draw(false)
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('class')).toBe(LEGACY_CENTERED)
    expect(document.querySelector(`.${CSS.escape('bg-black/30')}`)?.getAttribute('class')).toBe(
      LEGACY_OVERLAY,
    )
    // Radix owns the modal semantics on this branch, and in jsdom it leaves
    // `aria-modal` off the content node (it manages focus and inertness on the
    // body instead) — recorded here rather than asserted as a promise.
    expect(dialog.hasAttribute('aria-modal')).toBe(false)
    expect(document.querySelector('.mdv-ovl')).toBeNull()
    expect(screen.getByText('Invite a Team Member')).toBeInTheDocument()
  })
})

describe('with a Mudavym page on screen', () => {
  it('is the house Popover when it has an anchor — and keeps aria-modal, the documented exception', () => {
    draw(true, { anchored: true })
    const root = document.querySelector('.mdv-ovl') as HTMLElement
    expect(root).not.toBeNull()
    expect(root.parentElement).toBe(document.body) // portalled
    expect(root).toHaveClass('mdv-ovl--popover', 'mudavym')
    // NOT the popover default: this is a form that commits, so it traps focus
    // and announces itself modal (Sheet.tsx, the `modal` prop's note).
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    expect(root.getAttribute('data-modal')).toBe('true')
    expect(document.querySelector('.bg-white.rounded-2xl')).toBeNull()
  })

  it('is the house Panel when it has no anchor', () => {
    draw(true)
    expect(document.querySelector('.mdv-ovl--panel')).not.toBeNull()
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
  })

  it('closes on Escape', () => {
    const { onClose } = draw(true, { anchored: true })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('says the invite was emailed, on both branches (ADR 0229 fork 9, item 77)', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { ...INVITE, invitationEmail: 'sent' },
    } as never)
    draw(true, { anchored: true })
    fireEvent.change(screen.getByLabelText('Email address (optional)'), {
      target: { value: 'ana@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Generate Invite Link' }))
    await waitFor(() =>
      expect(screen.getByText(/We emailed this invite to ana@example\.com\./)).toBeInTheDocument(),
    )
    expect(vi.mocked(apiClient.post).mock.calls[0][1]).toMatchObject({
      targetEmail: 'ana@example.com',
    })

    resetMudavymShell()
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { ...INVITE, invitationEmail: 'rate_limited' },
    } as never)
    draw(false)
    fireEvent.click(screen.getAllByRole('button', { name: 'Generate Invite Link' })[0])
    await waitFor(() => expect(screen.getByText(/^Not emailed:/)).toBeInTheDocument())
  })

  it('says copied only once the browser took the link, and says so when it refused (F-600)', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    vi.mocked(toast.success).mockClear()
    vi.mocked(toast.error).mockClear()
    try {
      draw(true, { anchored: true })
      fireEvent.click(screen.getByRole('button', { name: 'Generate Invite Link' }))
      await waitFor(() => expect(screen.getByText('AB12CD34')).toBeInTheDocument())
      fireEvent.click(screen.getByRole('button', { name: /^Copy$/ }))
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/would not copy/)))
      expect(toast.success).not.toHaveBeenCalled()
      expect(screen.queryByText('Copied!')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: /^Copy$/ }))
      await waitFor(() => expect(screen.getByText('Copied!')).toBeInTheDocument())
      expect(writeText).toHaveBeenLastCalledWith(INVITE.inviteUrl)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('states the expiry in words once a link is generated, on both branches', async () => {
    // The code and the URL are useless without the time the recipient is racing;
    // "single-use, 7 days" before, the invite's own expiry after.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-04T18:00:00.000Z'))
    try {
      draw(true, { anchored: true })
      expect(screen.getByText(/expires in 7 days/)).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Generate Invite Link' }))
      await waitFor(() => expect(screen.getByText('AB12CD34')).toBeInTheDocument())
      expect(screen.getByText(/member\. Expires in 7 days\./)).toBeInTheDocument()

      resetMudavymShell()
      draw(false)
      fireEvent.click(screen.getAllByRole('button', { name: 'Generate Invite Link' })[0])
      await waitFor(() => expect(screen.getAllByText('AB12CD34').length).toBeGreaterThan(0))
      expect(screen.getAllByText(/member\. Expires in 7 days\./).length).toBeGreaterThan(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("dates the expiry on the house's clock, the way Settings › Team does (F-997)", async () => {
    // Device: New York (the suite's zone). House: Tokyo. 28 hours to go is
    // "tomorrow" on the device and two days off on the house's calendar.
    const now = new Date('2026-10-10T12:00:00.000Z')
    const expiresAt = '2026-10-11T16:00:00.000Z'
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    forgetHouseZones()
    houseZoneSaid.zone = 'Asia/Tokyo'
    localStorage.setItem('activeRestaurantId', 'rest-1')
    vi.mocked(apiClient.post).mockResolvedValue({ data: { ...INVITE, expiresAt } } as never)
    try {
      draw(true, { anchored: true })
      fireEvent.click(screen.getByRole('button', { name: 'Generate Invite Link' }))
      const house = fmtExpiry(expiresAt, 'Asia/Tokyo', now.getTime())
      expect(house).toMatch(/^Expires in 2 days/)
      await waitFor(() => expect(screen.getByText(`Share this link with your team member. ${house}.`)).toBeInTheDocument())
      expect(screen.queryByText(/Expires tomorrow/)).toBeNull()
    } finally {
      localStorage.removeItem('activeRestaurantId')
      houseZoneSaid.zone = null
      forgetHouseZones()
      vi.useRealTimers()
    }
  })
})

// F-934: only an owner changes a role afterwards, so a manager inviting is not
// told they can; they are told who can.
describe('who can change the role later', () => {
  for (const shellOn of [true, false]) {
    it(`tells a manager an owner can, and an owner they can (${shellOn ? 'Mudavym' : 'legacy'})`, () => {
      const manager = draw(shellOn)
      expect(screen.getByText('An owner can change their role later in Settings → Team.')).toBeInTheDocument()
      expect(screen.queryByText('You can change their role later in Settings → Team.')).toBeNull()
      manager.unmount()
      resetMudavymShell()
      draw(shellOn, { inviterIsOwner: true })
      expect(screen.getByText('You can change their role later in Settings → Team.')).toBeInTheDocument()
      expect(screen.queryByText('An owner can change their role later in Settings → Team.')).toBeNull()
    })
  }
})
