/**
 * F-759: a studio field override only shows its new value once the server says it was
 * applied (`auto_promoted`). A queued change shows as queued; a recorded-but-unapplied
 * one (`logged_apply_failed`) warns and keeps the editor open.
 * F-757: a disabled contributor stays in the table with an Enable action and no Revoke.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { request, toastFns } = vi.hoisted(() => ({
  request: vi.fn(),
  toastFns: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

vi.mock('../../pages/studio/studioApi', () => ({
  studioJsonRequest: request,
  studioErrorMessage: (e: unknown) => String(e),
}))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), toastFns) }))

import { FieldCell, overrideOutcome } from '../../pages/studio/FieldCell'
import { ContributorTable, type Contributor } from '../../pages/studio/certify/ContributorTable'

function renderCell(onOverrideSuccess = vi.fn()) {
  render(
    <table>
      <tbody>
        <tr>
          <FieldCell
            recordId="r1"
            submissionId="s1"
            sessionId={null}
            field="producer"
            entry={{ value: 'Old', confidence: 0.4, source: 'visible' }}
            onOverrideSuccess={onOverrideSuccess}
          />
        </tr>
      </tbody>
    </table>,
  )
  fireEvent.click(screen.getByTitle('Click to edit'))
  fireEvent.change(screen.getByDisplayValue('Old'), { target: { value: 'New' } })
  fireEvent.click(screen.getByText('Save Override'))
  return onOverrideSuccess
}

describe('FieldCell — override outcome (F-759)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('maps only auto_promoted to applied', () => {
    expect(overrideOutcome('auto_promoted')).toBe('applied')
    expect(overrideOutcome('pending')).toBe('queued')
    expect(overrideOutcome('logged_apply_failed')).toBe('not_applied')
    expect(overrideOutcome(undefined)).toBe('not_applied')
  })

  it('applies the value locally when the server applied it', async () => {
    request.mockResolvedValue({ status: 'auto_promoted' })
    const onSuccess = renderCell()
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('producer', 'New'))
    expect(toastFns.success).toHaveBeenCalled()
  })

  it('keeps the old value and shows the queued one for a pending change', async () => {
    request.mockResolvedValue({ status: 'pending' })
    const onSuccess = renderCell()
    await screen.findByText('Queued for review: New')
    expect(onSuccess).not.toHaveBeenCalled()
    expect(screen.getByText('Old')).toBeTruthy()
  })

  it('warns and does not apply when the change was recorded but not applied', async () => {
    request.mockResolvedValue({ status: 'logged_apply_failed' })
    const onSuccess = renderCell()
    await waitFor(() => expect(toastFns.warning).toHaveBeenCalled())
    expect(onSuccess).not.toHaveBeenCalled()
    expect(toastFns.success).not.toHaveBeenCalled()
    // Editor stays open so the save can be retried.
    expect(screen.getByText('Save Override')).toBeTruthy()
  })
})

describe('ContributorTable — disabled contributors (F-757)', () => {
  const base: Contributor = {
    id: 'ur-1',
    user_id: 'user-1234567890',
    role: 'certified_contributor',
    granted_at: '2026-09-01T00:00:00Z',
    revoked_at: '2026-10-01T00:00:00Z',
    consecutive_approved_overrides: 0,
    promotion_policy: 'queue',
    auto_promote_earned_at: null,
    email: 'sam@example.com',
  }

  it('offers Enable access and no Revoke on a disabled row', () => {
    render(<ContributorTable contributors={[base]} onRevoke={vi.fn()} onToggleEnable={vi.fn()} />)
    expect(screen.getByLabelText('Enable sam@example.com')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Contributor actions'))
    expect(screen.getByText('Enable access')).toBeTruthy()
    expect(screen.queryByText('Revoke contributor')).toBeNull()
  })

  it('still offers Revoke on an active row', () => {
    render(
      <ContributorTable
        contributors={[{ ...base, revoked_at: null }]}
        onRevoke={vi.fn()}
        onToggleEnable={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByLabelText('Contributor actions'))
    expect(screen.getByText('Revoke contributor')).toBeTruthy()
  })
})
