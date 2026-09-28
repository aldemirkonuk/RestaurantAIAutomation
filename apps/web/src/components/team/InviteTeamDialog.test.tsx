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
import { claimMudavymShell, resetMudavymShell } from '../../lib/mudavym/shellGround'

vi.mock('../../services/api/client', () => ({
  apiClient: { post: vi.fn() },
  getErrorMessage: (e: unknown) => String(e),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const LEGACY_OVERLAY = 'fixed inset-0 bg-black/30 z-50'
const LEGACY_CENTERED =
  'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl shadow-xl p-6 w-full max-w-md max-h-[min(90vh,calc(100vh-5rem))] overflow-y-auto'

const INVITE = {
  code: 'AB12CD34',
  // A fixed instant, so the words in the copy are the same words every day.
  expiresAt: '2026-09-11T18:00:00.000Z',
  inviteUrl: 'https://app.mudavym.com/invite/AB12CD34',
}

function draw(shellOn: boolean, opts: { anchored?: boolean } = {}) {
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

  it('states the expiry in words once a link is generated, on both branches', async () => {
    // The code and the URL are useless without the date the recipient is racing;
    // "single-use, 7 days" before, an actual day after.
    draw(true, { anchored: true })
    expect(screen.getByText(/expires in 7 days/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Generate Invite Link' }))
    await waitFor(() => expect(screen.getByText('AB12CD34')).toBeInTheDocument())
    expect(screen.getByText(/It expires Sep 11, 2026\./)).toBeInTheDocument()

    resetMudavymShell()
    draw(false)
    fireEvent.click(screen.getAllByRole('button', { name: 'Generate Invite Link' })[0])
    await waitFor(() => expect(screen.getAllByText('AB12CD34').length).toBeGreaterThan(0))
    expect(screen.getAllByText(/It expires Sep 11, 2026\./).length).toBeGreaterThan(0)
  })
})
