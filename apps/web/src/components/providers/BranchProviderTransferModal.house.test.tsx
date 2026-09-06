/**
 * "Carry your vendors to the new location?" — both branches.
 *
 * Flag off, the legacy Radix dialog renders byte for byte as it shipped; the
 * pinned literal class string is asserted against `git show origin/main:<path>`
 * so a drift fails rather than skips.
 *
 * The regression: the loop's `catch {}` discarded the server's answer, so three
 * refusals became "(3 skipped)" — no names, no reasons, and a word that reads
 * like a choice. Both outcome tests below fail against a copy of the pre-fix
 * file.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { execFileSync } from 'node:child_process'
import { BranchProviderTransferModal } from './BranchProviderTransferModal'
import { claimMudavymShell, resetMudavymShell } from '../../lib/mudavym/shellGround'
import type { Provider } from '../../services/api/providers'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
const post = vi.fn()
vi.mock('../../services/api/client', () => ({
  apiClient: { post: (...a: unknown[]) => post(...a) },
}))

const LEGACY_CARD =
  'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl shadow-xl p-6 w-full max-w-md max-h-[80vh] flex flex-col'

const PROVIDERS = [
  { id: 'p1', name: 'Selim Şarap', catalogueVendorId: 'cv1' },
  { id: 'p2', name: 'Ankara Bira', primaryBusinessType: 'Beer' },
] as unknown as Provider[]

function modal(providers = PROVIDERS) {
  return render(
    <BranchProviderTransferModal
      open
      onClose={() => {}}
      newBranchName="Kadıköy"
      newRestaurantId="r2"
      currentProviders={providers}
    />,
  )
}

beforeEach(() => {
  resetMudavymShell()
  post.mockResolvedValue({ data: {} })
})
afterEach(() => vi.clearAllMocks())

describe('the pinned legacy string is the one the committed source ships', () => {
  it('BranchProviderTransferModal', () => {
    const src = execFileSync(
      'git',
      ['show', 'origin/main:apps/web/src/components/providers/BranchProviderTransferModal.tsx'],
      { encoding: 'utf8', cwd: process.cwd() },
    )
    expect(src).toContain(LEGACY_CARD)
  })
})

describe('flag off — the legacy dialog, class string for class string', () => {
  it('renders the legacy card and no house overlay', () => {
    modal()
    expect(document.querySelector(`[class="${LEGACY_CARD}"]`)).not.toBeNull()
    expect(document.querySelector('.mdv-ovl')).toBeNull()
  })
})

describe('flag on — the house panel', () => {
  beforeEach(() => claimMudavymShell(Symbol('settings-page'), 'paper'))

  it('is a Panel on the primitive, motion `settle`, closed in words', () => {
    modal()
    expect(document.querySelector('.mdv-ovl')?.getAttribute('data-shape')).toBe('panel')
    expect(document.querySelector('[data-motion="settle"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
    expect(document.querySelector(`[class="${LEGACY_CARD}"]`)).toBeNull()
  })

  it('carries no seal — copying a vendor row is additive and reversible', () => {
    modal()
    expect(screen.getByRole('button', { name: 'Carry 2 vendors' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Hold to/ })).toBeNull()
  })

  it('states its contract', () => {
    modal()
    expect(
      screen.getByText(
        /nothing at your current location changes, and leaving writes nothing\./,
      ),
    ).toBeTruthy()
  })

  /* THE REGRESSION — the server's answer is kept, per vendor. */
  it('names the vendors that were not carried, with what the server said', async () => {
    post
      .mockResolvedValueOnce({ data: {} })
      .mockRejectedValueOnce({ response: { status: 500, data: { message: 'upstream down' } } })
    modal()
    fireEvent.click(screen.getByRole('button', { name: 'Carry 2 vendors' }))

    await screen.findByText('Not carried')
    expect(screen.getByText('Carried')).toBeTruthy()
    expect(screen.getByText('1')).toBeTruthy()
    expect(document.querySelector('.mdv-panelbox .mdv-prov')?.textContent).toContain('of 2 chosen')
    expect(screen.getByText(/Ankara Bira — upstream down/)).toBeTruthy()
    expect(screen.getByText(/you can add it there by hand\./)).toBeTruthy()
  })

  it('a vendor the location already has is a different fact from a failure', async () => {
    post
      .mockRejectedValueOnce({ response: { status: 409, data: { message: 'already added' } } })
      .mockResolvedValueOnce({ data: {} })
    modal()
    fireEvent.click(screen.getByRole('button', { name: 'Carry 2 vendors' }))

    await screen.findByText('Already there')
    expect(
      screen.getByText(/nothing was written for Selim Şarap\. There is nothing to do about it\./),
    ).toBeTruthy()
    expect(screen.queryByText('Not carried')).toBeNull()
  })

  it('a refusal is its own state', async () => {
    post.mockRejectedValue({ response: { status: 403, data: { message: 'forbidden' } } })
    modal()
    fireEvent.click(screen.getByRole('button', { name: 'Carry 2 vendors' }))

    await screen.findByText('Not permitted')
    expect(
      screen.getByText(/your current location is unchanged\./),
    ).toBeTruthy()
  })

  it('no vendors is said in words, and offers nothing to press', () => {
    modal([])
    expect(
      screen.getByText('You have no vendors at this location, so there is nothing to carry.'),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Carry \d/ })).toBeNull()
  })

  it('wears the page ground the portal was handed', () => {
    resetMudavymShell()
    claimMudavymShell(Symbol('settings-charcoal'), 'charcoal')
    modal()
    expect(document.querySelector('.mdv-ovl')?.getAttribute('data-ground')).toBe('charcoal')
  })
})
