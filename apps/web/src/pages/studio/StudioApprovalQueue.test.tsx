import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const studioJsonRequest = vi.fn()
vi.mock('./studioApi', () => ({
  studioRequest: () => Promise.resolve({
    queue: [{
      id: 'ov-1', submission_id: 'sub-1', actor_id: 'u-2', field_name: 'vintage',
      old_value: '2018', new_value: '2019', old_confidence: 0.5, reason: null,
      citation_url: null, promotion_status: 'pending', created_at: '2026-10-09T00:00:00Z',
      wine_name: 'Barolo Riserva',
    }],
    total: 1,
  }),
  studioJsonRequest: (...args: unknown[]) => studioJsonRequest(...args),
  studioErrorMessage: (err: unknown) => String(err),
}))
vi.mock('./StudioLayout', () => ({ StudioLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import StudioApprovalQueue from './StudioApprovalQueue'

function renderQueue() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><StudioApprovalQueue /></QueryClientProvider>)
}

describe('StudioApprovalQueue — library outcome after an approval (F-754)', () => {
  beforeEach(() => {
    studioJsonRequest.mockReset()
    Object.values(toast).forEach((fn) => fn.mockReset())
  })

  it('says so when the approved wine did not reach the library', async () => {
    studioJsonRequest.mockResolvedValue({ decision: 'approved', override_id: 'ov-1', library: 'failed' })
    renderQueue()
    fireEvent.click(await screen.findByRole('button', { name: /approve/i }))

    await waitFor(() => expect(toast.warning).toHaveBeenCalled())
    expect(toast.warning.mock.calls[0][0]).toMatch(/not added to the library/)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('keeps the plain confirmation when the library step did not fail', async () => {
    studioJsonRequest.mockResolvedValue({ decision: 'approved', override_id: 'ov-1', library: 'promoted' })
    renderQueue()
    fireEvent.click(await screen.findByRole('button', { name: /approve/i }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Override approved'))
    expect(toast.warning).not.toHaveBeenCalled()
  })
})
