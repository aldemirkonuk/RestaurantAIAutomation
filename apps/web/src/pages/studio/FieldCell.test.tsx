import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const studioJsonRequest = vi.fn()
vi.mock('./studioApi', () => ({
  studioJsonRequest: (...args: unknown[]) => studioJsonRequest(...args),
  studioErrorMessage: (err: unknown) => String(err),
}))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import { FieldCell } from './FieldCell'

async function saveProducer() {
  render(
    <table><tbody><tr>
      <FieldCell
        recordId="r-1"
        submissionId="sub-1"
        sessionId="sess-1"
        field="producer"
        entry={{ value: null, confidence: null, source: null }}
        onOverrideSuccess={() => undefined}
      />
    </tr></tbody></table>,
  )
  fireEvent.click(screen.getByTitle('Click to edit'))
  fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Fontodi' } })
  fireEvent.click(screen.getByRole('button', { name: /save override/i }))
}

describe('FieldCell — what a save did to the library (F-810)', () => {
  beforeEach(() => {
    studioJsonRequest.mockReset()
    Object.values(toast).forEach((fn) => fn.mockReset())
  })

  it('says the wine was added to the library', async () => {
    studioJsonRequest.mockResolvedValue({ status: 'auto_promoted', library: 'promoted' })
    await saveProducer()
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(toast.success.mock.calls[0][0]).toMatch(/added to the library/)
  })

  it('says a generically named wine was kept as a draft', async () => {
    studioJsonRequest.mockResolvedValue({ status: 'auto_promoted', library: 'not_specific' })
    await saveProducer()
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(toast.success.mock.calls[0][0]).toMatch(/kept as a draft, not in the library yet/)
  })

  it('warns when the library step failed', async () => {
    studioJsonRequest.mockResolvedValue({ status: 'auto_promoted', library: 'failed' })
    await saveProducer()
    await waitFor(() => expect(toast.warning).toHaveBeenCalled())
    expect(toast.success).not.toHaveBeenCalled()
  })
})
