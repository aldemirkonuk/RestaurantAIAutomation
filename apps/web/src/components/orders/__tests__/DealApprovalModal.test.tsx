/**
 * The deal modal's two holds (ADR 0175 D9/D10; founder answer 3, 2026-09-21):
 * a person who may confirm holds under a seal minted over the terms; a staff
 * member's hold ASKS a manager, keeping the exact terms, with no seal and no
 * commitment. A waiting request is shown to whoever opens the deal, and a
 * releaser opens it on the terms that were asked for.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DealApprovalModal, dealRequestWords } from '../DealApprovalModal'
import type { DealProposalDto, VendorSendRequestDto } from '../../../hooks/queries/useDraftEmailQueries'

const DEAL: DealProposalDto = {
  orderId: 'order-1',
  conversationId: 'conv-1',
  providerName: 'Kavaklidere',
  wineName: 'Yakut 2020',
  quantity: 6,
  proposedPrice: 200,
  finalPrice: 190,
  deliveryEstimate: 'Tuesday',
  conditions: '',
  specialConditions: [],
  commercialTerms: null,
  sourceQuote: '',
  conversationSummary: '',
  dealKind: 'offer',
  urgency: 'normal',
  confidence: 0.9,
  timestamp: '2026-09-21T10:00:00.000Z',
  trust: { score: 1, eligible: false, completedOrders: 0 },
}

const REQUEST: VendorSendRequestDto = {
  id: 'req-1',
  kind: 'confirm_deal',
  orderId: 'order-1',
  providerId: 'prov-1',
  requestedBy: { userId: 'u-staff', name: 'Ayşe' },
  requestedAt: '2026-09-21T09:00:00.000Z',
  payload: { finalPrice: 185, quantity: 6, sendConfirmation: true },
  state: 'waiting',
  releasedBy: null,
  releasedAt: null,
  releasedAsWritten: null,
  conversationId: null,
}

function draw(over: Partial<React.ComponentProps<typeof DealApprovalModal>> = {}) {
  const props = {
    isOpen: true,
    deal: DEAL,
    onConfirm: vi.fn(async () => undefined),
    onChallenge: vi.fn(async () => 'seal-1'),
    onDismiss: vi.fn(),
    onAskForMore: vi.fn(),
    onClose: vi.fn(),
    ...over,
  }
  render(<DealApprovalModal {...props} />)
  return props
}

function hold(el: HTMLElement) {
  fireEvent.keyDown(el, { key: 'Enter' })
  fireEvent.keyDown(el, { key: 'Enter' })
}

describe('the deal modal', () => {
  it("a staff member's hold asks a manager on the terms shown, with no seal and nothing confirmed", async () => {
    const onAsk = vi.fn(async () => ({ says: 'Asked. Your terms are saved exactly.' }))
    const p = draw({
      onAsk,
      confirmBlockedReason: 'Your hold will ask a manager to confirm this deal; your version is kept exactly as you wrote it.',
    })
    hold(screen.getByRole('button', { name: /Hold to ask a manager/ }))
    await waitFor(() => expect(onAsk).toHaveBeenCalledWith(190, 6))
    expect(p.onChallenge).not.toHaveBeenCalled()
    expect(p.onConfirm).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByTestId('deal-asked')).toHaveTextContent(/Asked\. Your terms are saved exactly/))
    expect(screen.queryByTestId('deal-confirm-seal')).toBeNull()
  })

  it('a second ask is not offered while one waits', () => {
    draw({ onAsk: vi.fn(), waitingRequest: REQUEST })
    expect(screen.getByRole('button', { name: /Hold to ask a manager/ })).toBeDisabled()
    expect(screen.getByTestId('deal-request-waiting')).toHaveTextContent(/Ayşe asked for this deal to be confirmed/)
  })

  it('a releaser opens a waiting request on the terms that were asked for, and one hold confirms exactly them', async () => {
    const p = draw({ waitingRequest: REQUEST })
    expect(screen.getByTestId('deal-request-waiting')).toHaveTextContent('Ayşe asked for this deal to be confirmed (6 at 185.00 each)')
    hold(screen.getByRole('button', { name: /Hold to accept & confirm/ }))
    await waitFor(() => expect(p.onChallenge).toHaveBeenCalledWith(185, 6))
    await waitFor(() => expect(p.onConfirm).toHaveBeenCalledWith(185, 6, 'seal-1'))
  })

  it('says a request in one sentence even when the name could not be read', () => {
    expect(dealRequestWords({ ...REQUEST, requestedBy: { userId: 'u', name: null }, payload: { quantity: 3, finalPrice: null } })).toBe(
      'A member whose name could not be read asked for this deal to be confirmed (3 at the price offered). It waits for one hold; nothing has been confirmed.',
    )
  })
})
