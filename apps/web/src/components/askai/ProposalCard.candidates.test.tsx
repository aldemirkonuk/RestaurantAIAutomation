/**
 * The id pickers on the proposal card.
 *
 * Editable ids are the part of this card that can quietly do the WRONG thing,
 * so each test here is one way that happens:
 *
 *  1. Changing the vendor must send the WHOLE payload with the new id. The
 *     gateway re-validates the complete payload — there is no partial patch —
 *     so a picker that mutated state without reaching `confirm` correctly
 *     would confirm the old vendor while showing the new one.
 *  2. An UNTOUCHED card must still send no payload. The pickers make every id
 *     a controlled input; if one of them normalises or re-orders on mount, an
 *     untouched confirm silently becomes `edited: true` and the P3.0 ledger
 *     stops meaning anything.
 *  3. A proposed id OUTSIDE the candidate set must stay selected. It happens
 *     (capped out, vendor deactivated), and a select that fell through to its
 *     first option would rewrite what the operator is about to confirm without
 *     telling them.
 *  4. No candidates → read-only ids, NOT an empty dropdown. An empty select
 *     says "you have no vendors", which is a claim, not a loading state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProposalCard } from './ProposalCard'
import {
  AskAiCandidates,
  AskAiProposal,
  confirmAction,
} from '../../services/api/askAi'

vi.mock('../../services/api/askAi', async () => {
  const actual =
    await vi.importActual<typeof import('../../services/api/askAi')>(
      '../../services/api/askAi',
    )
  return { ...actual, confirmAction: vi.fn(), discardAction: vi.fn() }
})

const confirm = vi.mocked(confirmAction)

const INV = '11111111-1111-4111-8111-111111111111'
const INV_OTHER = '11111111-1111-4111-8111-1111111111aa'
const PROV = '22222222-2222-4222-8222-222222222222'
const PROV_OTHER = '22222222-2222-4222-8222-2222222222bb'
const ORDER = '33333333-3333-4333-8333-333333333333'

const reorder: AskAiProposal = {
  actionId: 'action-1',
  summary: 'Order 6 bottles of Barolo 2019 from Acme Wines.',
  action: {
    family: 'procurement',
    actionType: 'reorder',
    payload: { inventoryId: INV, providerId: PROV, quantity: 6 },
  },
}

const candidates: AskAiCandidates = {
  inventory: [
    { id: INV, label: 'Barolo 2019' },
    { id: INV_OTHER, label: 'Chablis 2021' },
  ],
  providers: [
    { id: PROV, label: 'Acme Wines' },
    { id: PROV_OTHER, label: 'Beta Cellars' },
  ],
  orders: [
    {
      id: ORDER,
      label: 'Acme Wines · sent',
      providerId: PROV,
      providerName: 'Acme Wines',
      status: 'sent',
    },
  ],
  limits: { inventory: 60, providers: 30, orders: 20 },
  capped: { inventory: false, providers: false, orders: false },
}

beforeEach(() => {
  vi.clearAllMocks()
  confirm.mockResolvedValue({
    executed: true,
    actionId: 'action-1',
    executionRef: 'order-9',
    edited: true,
  })
})

describe('ProposalCard id pickers', () => {
  it('renders labels, not uuids, and preselects what was proposed', () => {
    render(<ProposalCard proposal={reorder} candidates={candidates} />)

    const item = screen.getByLabelText('Item') as HTMLSelectElement
    const vendor = screen.getByLabelText('Vendor') as HTMLSelectElement

    expect(item.value).toBe(INV)
    expect(vendor.value).toBe(PROV)
    expect(screen.getByRole('option', { name: 'Beta Cellars' })).toBeTruthy()
  })

  it('sends the whole payload with the new id when the vendor is changed', async () => {
    const user = userEvent.setup()
    render(<ProposalCard proposal={reorder} candidates={candidates} />)

    await user.selectOptions(screen.getByLabelText('Vendor'), PROV_OTHER)
    await user.click(screen.getByRole('button', { name: /confirm/i }))

    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(confirm).toHaveBeenCalledWith('action-1', {
      inventoryId: INV,
      providerId: PROV_OTHER,
      quantity: 6,
    })
  })

  it('still sends NO payload when nothing is touched', async () => {
    const user = userEvent.setup()
    render(<ProposalCard proposal={reorder} candidates={candidates} />)

    await user.click(screen.getByRole('button', { name: /confirm/i }))

    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(confirm).toHaveBeenCalledWith('action-1', undefined)
  })

  it('keeps a proposed id that is not in the candidate set selected', async () => {
    // The vendor went inactive between propose and now. The row still points
    // at it, so the card must still show it — and an untouched confirm must
    // still be an untouched confirm.
    const user = userEvent.setup()
    render(
      <ProposalCard
        proposal={reorder}
        candidates={{
          ...candidates,
          providers: [{ id: PROV_OTHER, label: 'Beta Cellars' }],
        }}
      />,
    )

    const vendor = screen.getByLabelText('Vendor') as HTMLSelectElement
    expect(vendor.value).toBe(PROV)
    expect(screen.getByRole('option', { name: /As proposed/ })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(confirm).toHaveBeenCalledWith('action-1', undefined))
  })

  it('a card restored from the database is NOT reported as edited', async () => {
    // `GET /ask-ai/actions` returns a jsonb column, and Postgres normalises
    // jsonb key order rather than preserving it. A stringify-based change
    // detector called every restored reorder edited, which sent a payload the
    // operator never typed and filed it in the ledger as a human correction.
    const user = userEvent.setup()
    const restored: AskAiProposal = {
      ...reorder,
      action: {
        ...reorder.action,
        // Same payload, jsonb key order: length, then bytewise.
        payload: { quantity: 6, providerId: PROV, inventoryId: INV } as never,
      },
    }
    render(<ProposalCard proposal={restored} candidates={candidates} />)

    expect(screen.getByRole('button', { name: /^Confirm$/ })).toBeTruthy()
    expect(screen.queryByText(/Edited — your version/)).toBeNull()

    await user.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(confirm).toHaveBeenCalledWith('action-1', undefined))
  })

  it('still reports a real edit on a restored card', async () => {
    const user = userEvent.setup()
    const restored: AskAiProposal = {
      ...reorder,
      action: {
        ...reorder.action,
        payload: { quantity: 6, providerId: PROV, inventoryId: INV } as never,
      },
    }
    render(<ProposalCard proposal={restored} candidates={candidates} />)

    await user.selectOptions(screen.getByLabelText('Vendor'), PROV_OTHER)
    await waitFor(() => expect(screen.getByText(/Edited — your version/)).toBeTruthy())
    await user.click(screen.getByRole('button', { name: /confirm edits/i }))
    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith('action-1', {
        inventoryId: INV,
        providerId: PROV_OTHER,
        quantity: 6,
      }),
    )
  })

  it('says a capped list is a ceiling, not a first page', () => {
    render(
      <ProposalCard
        proposal={reorder}
        candidates={{
          ...candidates,
          capped: { ...candidates.capped, inventory: true },
        }}
      />,
    )

    expect(screen.getByText(/cannot act on more than this/i)).toBeTruthy()
  })

  it('falls back to read-only ids when there are no candidates at all', () => {
    render(<ProposalCard proposal={reorder} candidates={null} />)

    expect(screen.queryByLabelText('Item')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    // The id is still shown — shortened, as it was before pickers existed.
    expect(screen.getByTitle(INV)).toBeTruthy()
    // And the card is still confirmable.
    expect(
      (screen.getByRole('button', { name: /confirm/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
  })
})
