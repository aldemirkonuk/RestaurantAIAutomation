/**
 * Who may settle what a delivery cost, on screen (r30, the web half of r28
 * invoices G3). The rule mirrors the gateway's `assertSettlesDeliveryMoney`:
 * owner, manager and admin hold the house's money; staff, an unknown role and
 * no role do not. All data is SYNTHETIC.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const getMock = vi.fn()
vi.mock('../../../services/api/client', () => ({
  apiClient: { get: (...a: unknown[]) => getMock(...a), post: vi.fn() },
}))
import { DeliveryGates, settlesDeliveryMoney } from '../DeliveryGates'
import { ProposalThread } from '../ProposalThread'
import { deliveriesApi, type DeliveryEvent } from '../../../services/api/deliveries'

const base: DeliveryEvent = {
  id: 'del-syn',
  providerId: null,
  orderId: null,
  state: 'RECONCILING',
  provenance: 'ORDERED',
  jurisdiction: 'US-CA',
  deliveredAt: null,
  agreedAt: null,
  agreedRule: null,
  verifiedAt: null,
  verifiedBy: null,
  lapsedAt: null,
  lapseDeemed: null,
  amendedAt: null,
}
const noop = async () => {}

describe('settlesDeliveryMoney', () => {
  it('admits owner, manager and admin, in any case or padding', () => {
    expect(settlesDeliveryMoney('owner')).toBe(true)
    expect(settlesDeliveryMoney('manager')).toBe(true)
    expect(settlesDeliveryMoney('admin')).toBe(true)
    expect(settlesDeliveryMoney(' Manager ')).toBe(true)
  })
  it('refuses staff, an unknown role and no role', () => {
    expect(settlesDeliveryMoney('staff')).toBe(false)
    expect(settlesDeliveryMoney('sommelier')).toBe(false)
    expect(settlesDeliveryMoney('')).toBe(false)
    expect(settlesDeliveryMoney(null)).toBe(false)
    expect(settlesDeliveryMoney(undefined)).toBe(false)
  })
})

describe('DeliveryGates for someone who does not hold the money', () => {
  it('hides Agree and says who agrees', () => {
    render(<DeliveryGates delivery={base} onAgree={noop} onVerify={noop} settlesMoney={false} />)
    expect(screen.queryByTestId('agree-button')).toBeNull()
    expect(screen.getByTestId('gates-need-a-manager').textContent).toMatch(
      /Counting the goods at the door is still yours/,
    )
  })
  it('hides Verify on an agreed delivery', () => {
    render(
      <DeliveryGates
        delivery={{ ...base, agreedAt: '2026-08-12T09:00:00Z', agreedRule: 'both_sides_recorded' }}
        onAgree={noop}
        onVerify={noop}
        settlesMoney={false}
      />,
    )
    expect(screen.queryByTestId('verify-button')).toBeNull()
    expect(screen.getByTestId('gates-need-a-manager')).toBeTruthy()
  })
  it('hides the cost re-check on a verified delivery, and has nothing left to ask of a manager', () => {
    render(
      <DeliveryGates
        delivery={{ ...base, agreedAt: '2026-08-12T09:00:00Z', verifiedAt: '2026-08-12T10:00:00Z' }}
        onRecheck={noop}
        settlesMoney={false}
      />,
    )
    expect(screen.queryByTestId('recheck-cost-button')).toBeNull()
    expect(screen.queryByTestId('gates-need-a-manager')).toBeNull()
  })
  it('a holder sees every button and no sentence about who does them', () => {
    const { unmount } = render(<DeliveryGates delivery={base} onAgree={noop} />)
    expect(screen.getByTestId('agree-button')).toBeTruthy()
    expect(screen.queryByTestId('gates-need-a-manager')).toBeNull()
    unmount()
    render(
      <DeliveryGates
        delivery={{ ...base, agreedAt: '2026-08-12T09:00:00Z' }}
        onVerify={noop}
        settlesMoney
      />,
    )
    expect(screen.getByTestId('verify-button')).toBeTruthy()
  })
  it('a holder sees the re-check on a verified delivery', () => {
    render(
      <DeliveryGates
        delivery={{ ...base, agreedAt: '2026-08-12T09:00:00Z', verifiedAt: '2026-08-12T10:00:00Z' }}
        onRecheck={noop}
        settlesMoney
      />,
    )
    expect(screen.getByTestId('recheck-cost-button')).toBeTruthy()
  })
})

describe('ProposalThread with the amounts withheld', () => {
  const row = {
    id: 'p1',
    delivery_id: 'del-syn',
    document_id: null,
    line_no: 2,
    side: 'restaurant' as const,
    reason: 'DAMAGED' as const,
    qty_proposed: 1,
    unit_price_proposed: null,
    money_at_risk: null,
    evidence: [],
    note: null,
    status: 'open' as const,
    counters_proposal_id: null,
    proposed_by: null,
    proposed_at: '2026-08-12T09:00:00Z',
    responded_at: null,
    responded_by: null,
  }
  it('says the amounts were withheld, once', () => {
    render(<ProposalThread proposals={[row, { ...row, id: 'p2' }]} moneyWithheld />)
    expect(screen.getAllByTestId('thread-money-withheld')).toHaveLength(1)
  })
  it('says nothing about withholding when the amounts came', () => {
    render(<ProposalThread proposals={[row]} />)
    expect(screen.queryByTestId('thread-money-withheld')).toBeNull()
  })
  it('says nothing about withholding on an empty thread', () => {
    render(<ProposalThread proposals={[]} moneyWithheld />)
    expect(screen.queryByTestId('thread-money-withheld')).toBeNull()
    expect(screen.getByTestId('thread-empty')).toBeTruthy()
  })
})

describe('deliveriesApi.proposalThread', () => {
  it('carries the gateway\'s moneyWithheld flag', async () => {
    getMock.mockResolvedValueOnce({ data: { proposals: [{ id: 'p1' }], moneyWithheld: true } })
    const out = await deliveriesApi.proposalThread('del-syn')
    expect(getMock).toHaveBeenCalledWith('/procurement/deliveries/del-syn/proposals')
    expect(out).toEqual({ proposals: [{ id: 'p1' }], moneyWithheld: true })
  })
  it('reads an absent flag as not withheld, and proposals() still returns the rows', async () => {
    getMock.mockResolvedValueOnce({ data: { proposals: [{ id: 'p2' }] } })
    expect((await deliveriesApi.proposalThread('d')).moneyWithheld).toBe(false)
    getMock.mockResolvedValueOnce({ data: { proposals: [{ id: 'p3' }], moneyWithheld: true } })
    expect(await deliveriesApi.proposals('d')).toEqual([{ id: 'p3' }])
  })
})
