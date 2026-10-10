/**
 * F-586: "Add vendors to <new branch>" must add them to the NEW house.
 *
 * It used to post each vendor to `/providers` with an `X-Restaurant-Id`
 * header the gateway never reads, so they landed in the house the owner was
 * standing in, and the toast said the branch. Now it makes one call that
 * names the target house, and shows the server's answer vendor by vendor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BranchProviderTransferModal } from './BranchProviderTransferModal'
import type { Provider } from '../../services/api/providers'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const post = vi.fn()
vi.mock('../../services/api/client', () => ({
  apiClient: { post: (...a: unknown[]) => post(...a) },
}))

const PROVIDERS = [
  { id: 'p1', name: 'Breakthru', catalogueVendorId: 'cat-1' },
  { id: 'p2', name: 'Local Farm' },
] as unknown as Provider[]

function renderModal() {
  return render(
    <BranchProviderTransferModal
      open
      onClose={vi.fn()}
      newBranchName="Uptown"
      newRestaurantId="house-2"
      currentProviders={PROVIDERS}
    />,
  )
}

describe('BranchProviderTransferModal (F-586)', () => {
  beforeEach(() => post.mockReset())

  it('asks the server to copy into the named house, never a header', async () => {
    post.mockResolvedValue({
      data: {
        targetRestaurantId: 'house-2',
        targetName: 'Uptown',
        results: [
          { providerId: 'p1', name: 'Breakthru', outcome: 'added', reason: null, newProviderId: 'n1' },
          {
            providerId: 'p2',
            name: 'Local Farm',
            outcome: 'skipped',
            reason: 'That house already has a vendor by this name.',
            newProviderId: null,
          },
        ],
      },
    })
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 selected' }))

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    expect(post).toHaveBeenCalledWith('/providers/copy-to-house', {
      targetRestaurantId: 'house-2',
      providerIds: ['p1', 'p2'],
    })
    expect(post.mock.calls.some((c) => c[0] === '/providers')).toBe(false)

    const results = await screen.findByTestId('vendor-copy-results')
    expect(results.textContent).toContain('1 vendor added to Uptown.')
    expect(results.textContent).toContain('Breakthru')
    expect(results.textContent).toContain('1 not added')
    expect(results.textContent).toContain(
      'Local Farm — That house already has a vendor by this name.',
    )
  })

  it('says nothing was added when the server refuses the copy', async () => {
    post.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 403'), {
        response: {
          data: { message: 'Only an owner of both houses can copy vendors between them. Nothing was copied.' },
        },
      }),
    )
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 selected' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Only an owner of both houses can copy vendors between them. Nothing was copied.',
    )
    expect(screen.queryByTestId('vendor-copy-results')).toBeNull()
  })
})
