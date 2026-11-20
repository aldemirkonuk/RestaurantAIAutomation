/**
 * FieldCell tells the contributor what happened to the WINE, not only to the override.
 *
 * QA round 5 (B-1, 2026-11-07): the orchestrator's library insert failed on every
 * promotion, and this cell said "Override saved" and nothing more. The response now
 * carries `library`; a failure must reach the contributor as an error. And an override
 * the server recorded but could not apply (`logged_apply_failed`) must not read as saved.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { FieldCell } from './FieldCell'
import { studioJsonRequest } from './studioApi'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }))
vi.mock('./studioApi', async (importOriginal) => {
  const real = await importOriginal<typeof import('./studioApi')>()
  return { ...real, studioJsonRequest: vi.fn() }
})

function renderCell(onOverrideSuccess = vi.fn()) {
  render(
    <table>
      <tbody>
        <tr>
          <FieldCell
            recordId="rec-1"
            submissionId="sub-1"
            sessionId={null}
            field="grape_variety"
            entry={{ value: 'Nebiolo', confidence: 0.4, source: 'knowledge' }}
            onOverrideSuccess={onOverrideSuccess}
          />
        </tr>
      </tbody>
    </table>,
  )
  fireEvent.click(screen.getByTitle('Click to edit'))
  fireEvent.change(screen.getByDisplayValue('Nebiolo'), { target: { value: 'Nebbiolo' } })
  fireEvent.click(screen.getByText('Save Override'))
  return onOverrideSuccess
}

describe('FieldCell — the wine, not just the override', () => {
  beforeEach(() => vi.clearAllMocks())

  it('says so when the wine did not reach the library', async () => {
    vi.mocked(studioJsonRequest).mockResolvedValue({
      status: 'auto_promoted',
      library: 'failed',
      library_detail: 'Nothing was added.',
    })
    renderCell()
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('The wine did not reach the library', {
        description: 'Nothing was added.',
      }),
    )
  })

  it('says so when the wine went in', async () => {
    vi.mocked(studioJsonRequest).mockResolvedValue({ status: 'auto_promoted', library: 'promoted' })
    renderCell()
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Added to the wine library', { description: undefined }),
    )
  })

  it('does not call a recorded-but-unapplied change saved', async () => {
    vi.mocked(studioJsonRequest).mockResolvedValue({ status: 'logged_apply_failed' })
    const onOverrideSuccess = renderCell()
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(toast.error).toHaveBeenCalledWith('Change not applied', expect.anything())
    expect(toast.success).not.toHaveBeenCalled()
    expect(onOverrideSuccess).not.toHaveBeenCalled()
  })
})
