/**
 * "Never without the seal" — the founder, 2026-09-21, on /ask.
 *
 * The Ask panel's proposal card used to apply a proposal with a click on the
 * unsealed `POST /ask-ai/actions/:id/confirm`. It now applies ONLY through
 * `HoldToApprove` bound to a server seal of its own, minted AFTER any edits.
 * Each case is a way the card could be weaker than that:
 *
 *   1. a click-to-apply control survives beside the hold;
 *   2. the seal is minted late (at the apply) rather than when the hold begins;
 *   3. a seal that could not be minted still applies;
 *   4. an edit the gateway refuses at the mint still reaches the apply;
 *   5. an edit made AFTER the hold began is applied — or the new one is sent
 *      on a seal minted for the old one;
 *   6. a refused seal leaves the card reading "Applied", or strands it.
 *
 * What is mocked is the network under the ceremony (`mintProposalSeal`,
 * `applyProposalSealed`, `discardAction`) — the same seams the counter's seal
 * suite mocks — never the card or the hold under test. The hold is driven the
 * way a keyboard drives it: Enter arms and mints, Enter commits.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ProposalCard } from './ProposalCard'
import {
  AskAiActionError,
  AskAiProposal,
  applyProposalSealed,
  mintProposalSeal,
} from '../../services/api/askAi'
import { beginHold, completeHold } from '../../__tests__/utils/seal'

vi.mock('../../services/api/askAi', async () => {
  const actual =
    await vi.importActual<typeof import('../../services/api/askAi')>(
      '../../services/api/askAi',
    )
  return {
    ...actual,
    mintProposalSeal: vi.fn(),
    applyProposalSealed: vi.fn(),
    discardAction: vi.fn(),
  }
})

const mint = vi.mocked(mintProposalSeal)
const apply = vi.mocked(applyProposalSealed)

const INV = '11111111-1111-4111-8111-111111111111'
const PROV = '22222222-2222-4222-8222-222222222222'

const reorder: AskAiProposal = {
  actionId: 'action-1',
  summary: 'Order 6 bottles of Barolo 2019 from Acme Wines.',
  action: {
    family: 'procurement',
    actionType: 'reorder',
    payload: { inventoryId: INV, providerId: PROV, quantity: 6 },
  },
}

const hold = () => screen.getByRole('button', { name: /hold to apply/i })
const settle = () => new Promise((r) => setTimeout(r, 20))

beforeEach(() => {
  vi.clearAllMocks()
  mint.mockResolvedValue('seal-1')
  apply.mockResolvedValue({
    executed: true,
    actionId: 'action-1',
    executionRef: 'order-9',
    edited: false,
  })
})

describe('the Ask panel applies a proposal only by the seal', () => {
  it('offers no click-to-apply control — the hold is the only one', () => {
    render(<ProposalCard proposal={reorder} candidates={null} />)
    expect(
      screen.queryByRole('button', { name: /^(confirm|confirm edits|apply)$/i }),
    ).toBeNull()
    expect(screen.getAllByRole('button', { name: /hold to apply/i })).toHaveLength(1)
  })

  it('mints the seal when the hold BEGINS, before anything is applied', async () => {
    render(<ProposalCard proposal={reorder} candidates={null} />)
    beginHold(hold())
    await waitFor(() => expect(mint).toHaveBeenCalledWith('action-1', undefined))
    expect(apply).not.toHaveBeenCalled()
  })

  it('applies with the minted seal, and says a draft was made', async () => {
    render(<ProposalCard proposal={reorder} candidates={null} />)
    completeHold(hold())
    await waitFor(() =>
      expect(apply).toHaveBeenCalledWith('action-1', 'seal-1', undefined),
    )
    expect(mint).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/nothing has been sent/i)).toBeTruthy()
  })

  it('applies NOTHING when the seal could not be minted', async () => {
    mint.mockResolvedValue(null)
    render(<ProposalCard proposal={reorder} candidates={null} />)
    completeHold(hold())
    await waitFor(() => expect(mint).toHaveBeenCalled())
    await settle() // every chance to (wrongly) proceed
    expect(apply).not.toHaveBeenCalled()
  })

  it('an edit the gateway refuses at the mint is never applied, and the card says why', async () => {
    mint.mockRejectedValue(
      new AskAiActionError('rejected', 'That vendor is not one of this house’s.'),
    )
    render(<ProposalCard proposal={reorder} candidates={null} />)
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: '8' } })
    completeHold(screen.getByRole('button', { name: /hold to apply your edits/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/not one of this house/)
    await settle()
    expect(apply).not.toHaveBeenCalled()
    // The typing survives and the hold can be taken again.
    expect((screen.getByLabelText(/quantity/i) as HTMLInputElement).value).toBe('8')
    expect(hold()).toBeEnabled()
  })

  it('an edit made AFTER the hold began is not applied — the seal is on what was showing', async () => {
    render(<ProposalCard proposal={reorder} candidates={null} />)
    beginHold(hold()) // armed, and the seal is minted on the untouched proposal
    await waitFor(() => expect(mint).toHaveBeenCalledWith('action-1', undefined))

    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: '80' } })
    // Commit the armed hold.
    fireEvent.keyDown(screen.getByRole('button', { name: /hold to apply/i }), {
      key: 'Enter',
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /changed the proposal after the hold began/i,
    )
    await settle()
    expect(apply).not.toHaveBeenCalled()
  })

  it('a refused seal leaves the card usable and at rest, never reading "Applied"', async () => {
    apply.mockRejectedValue(
      new AskAiActionError(
        'refused',
        'This proposal changed after the seal was issued, so nothing was changed.',
      ),
    )
    render(<ProposalCard proposal={reorder} candidates={null} />)
    completeHold(hold())
    expect(await screen.findByRole('alert')).toHaveTextContent(/changed after the seal/)
    expect(screen.queryByText(/^Applied$/)).toBeNull()
    expect(screen.queryByText(/nothing has been sent/i)).toBeNull()
    expect(hold()).toBeEnabled()

    // And a second hold mints a fresh seal rather than reusing the spent one.
    apply.mockResolvedValue({
      executed: true,
      actionId: 'action-1',
      executionRef: 'order-9',
      edited: false,
    })
    mint.mockResolvedValue('seal-2')
    completeHold(hold())
    await waitFor(() =>
      expect(apply).toHaveBeenLastCalledWith('action-1', 'seal-2', undefined),
    )
    expect(mint).toHaveBeenCalledTimes(2)
  })
})
