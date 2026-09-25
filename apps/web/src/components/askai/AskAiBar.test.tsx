/**
 * The Ask AI surface, tested on the four behaviours the backend contract makes
 * load-bearing. Each of these is a way the feature dies quietly if it is wrong:
 *
 *  1. A refusal shows its REASON. `ask-ai-actions.ts` returns a reason on every
 *     branch specifically so the UI can; a card that says "could not do that"
 *     and stops is the dead end that teaches operators to stop asking.
 *  2. An untouched apply seals and sends NO payload — that is the difference
 *     between `edited: false` and `edited: true` in the ledger, and the ledger
 *     is what P3.0 grades the model on.
 *  3. A REJECTED EDIT keeps the card alive. The gateway rolls the row back to
 *     `proposed` on a failed `validateEdit`, so a card that unmounted itself
 *     would strand a still-applicable action and throw away the typing.
 *  4. A lost compare-and-swap is an ORDINARY OUTCOME. A second hold must not
 *     look like a crash; exactly one order was created, which is what the CAS
 *     is for.
 *
 * Applying is a HOLD bound to a server seal, never a click ("Never without
 * the seal", the founder, 2026-09-21): the network under the ceremony is
 * mocked (`mintProposalSeal`, `applyProposalSealed`), never the card.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AskAiBar } from './AskAiBar'
import { completeHold } from '../../__tests__/utils/seal'
import {
  AskAiActionError,
  applyProposalSealed,
  discardAction,
  mintProposalSeal,
  listCandidates,
  listOpenProposals,
  proposeAction,
} from '../../services/api/askAi'

vi.mock('../../services/api/askAi', async () => {
  const actual =
    await vi.importActual<typeof import('../../services/api/askAi')>(
      '../../services/api/askAi',
    )
  return {
    ...actual,
    proposeAction: vi.fn(),
    listOpenProposals: vi.fn(),
    listCandidates: vi.fn(),
    mintProposalSeal: vi.fn(),
    applyProposalSealed: vi.fn(),
    discardAction: vi.fn(),
  }
})

const api = {
  propose: vi.mocked(proposeAction),
  list: vi.mocked(listOpenProposals),
  candidates: vi.mocked(listCandidates),
  mint: vi.mocked(mintProposalSeal),
  apply: vi.mocked(applyProposalSealed),
  discard: vi.mocked(discardAction),
}

const hold = (name: RegExp = /hold to apply/i) => screen.getByRole('button', { name })

const INVENTORY = '11111111-1111-4111-8111-111111111111'
const PROVIDER = '22222222-2222-4222-8222-222222222222'
const ORDER = '33333333-3333-4333-8333-333333333333'

const reorder = {
  actionId: 'action-1',
  summary: 'Order 6 bottles of Barolo 2019 from Acme Wines.',
  action: {
    family: 'procurement' as const,
    actionType: 'reorder' as const,
    payload: { inventoryId: INVENTORY, providerId: PROVIDER, quantity: 6 },
  },
}

const vendorDraft = {
  actionId: 'action-2',
  summary: 'Draft a follow-up to Acme about the late delivery.',
  action: {
    family: 'communications' as const,
    actionType: 'vendor_draft' as const,
    payload: { orderId: ORDER, instruction: 'Chase the late delivery.' },
  },
}

function renderBar(route = '/inventory') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AskAiBar open onClose={() => {}} />
    </MemoryRouter>,
  )
}

/** The candidate set the cards' id pickers are built from. */
const CANDIDATES = {
  inventory: [{ id: INVENTORY, label: 'Barolo 2019' }],
  providers: [{ id: PROVIDER, label: 'Acme Wines' }],
  orders: [
    {
      id: ORDER,
      label: 'Acme Wines · sent',
      providerId: PROVIDER,
      providerName: 'Acme Wines',
      status: 'sent',
    },
  ],
  limits: { inventory: 60, providers: 30, orders: 20 },
  capped: { inventory: false, providers: false, orders: false },
}

beforeEach(() => {
  vi.clearAllMocks()
  api.list.mockResolvedValue([])
  api.candidates.mockResolvedValue(CANDIDATES)
  api.mint.mockResolvedValue('seal-1')
})

describe('asking', () => {
  it('sends the page context with the ask so "this" can resolve', async () => {
    const user = userEvent.setup()
    api.propose.mockResolvedValue({ proposed: true, proposal: reorder })
    renderBar(`/inventory/${INVENTORY}`)

    await user.type(screen.getByLabelText(/ask ai for an action/i), 'reorder this{Enter}')

    await waitFor(() => expect(api.propose).toHaveBeenCalled())
    const sent = api.propose.mock.calls[0][0]
    expect(sent).toContain('reorder this')
    expect(sent).toContain('Inventory')
    // The id the route already names — the whole point of context injection.
    expect(sent).toContain(INVENTORY)
  })

  it('sends only the words when the operator switches context off', async () => {
    const user = userEvent.setup()
    api.propose.mockResolvedValue({ proposed: true, proposal: reorder })
    renderBar('/orders')

    await user.click(screen.getByRole('button', { name: /orders/i }))
    await user.type(screen.getByLabelText(/ask ai for an action/i), 'reorder barolo{Enter}')

    await waitFor(() => expect(api.propose).toHaveBeenCalledWith('reorder barolo'))
  })

  it('shows the refusal REASON, not a bare "could not do that"', async () => {
    const user = userEvent.setup()
    api.propose.mockResolvedValue({
      proposed: false,
      reason: 'Could not resolve which vendor to order from.',
    })
    renderBar()

    await user.type(screen.getByLabelText(/ask ai for an action/i), 'order some wine{Enter}')

    const refusal = await screen.findByTestId('askai-refusal')
    expect(refusal).toHaveTextContent('Could not resolve which vendor to order from.')
    // and the typing survives, so a near-miss is a two-word edit
    expect(screen.getByLabelText(/ask ai for an action/i)).toHaveValue('order some wine')
  })

  it('renders proposals that were already waiting before this session', async () => {
    api.list.mockResolvedValue([vendorDraft])
    renderBar()
    expect(await screen.findByText(vendorDraft.summary)).toBeInTheDocument()
  })
})

describe('the seal gate', () => {
  it('seals and applies as proposed with NO payload when nothing was touched', async () => {
    api.list.mockResolvedValue([reorder])
    api.apply.mockResolvedValue({
      executed: true,
      actionId: reorder.actionId,
      executionRef: 'order-99',
      edited: false,
    })
    renderBar()
    await screen.findByTestId('askai-proposal-card')

    completeHold(hold(/^hold to apply$/i))

    await waitFor(() =>
      expect(api.apply).toHaveBeenCalledWith(reorder.actionId, 'seal-1', undefined),
    )
    expect(api.mint).toHaveBeenCalledWith(reorder.actionId, undefined)
    // Both executors produce a DRAFT — the card must not imply a send.
    expect(await screen.findByText(/nothing has been sent/i)).toBeInTheDocument()
  })

  it('seals the operator’s edited payload, whole, and applies that same payload', async () => {
    const user = userEvent.setup()
    api.list.mockResolvedValue([reorder])
    api.apply.mockResolvedValue({
      executed: true,
      actionId: reorder.actionId,
      executionRef: 'order-99',
      edited: true,
    })
    renderBar()
    await screen.findByTestId('askai-proposal-card')

    const qty = screen.getByLabelText(/quantity/i)
    await user.clear(qty)
    await user.type(qty, '8')
    completeHold(hold(/hold to apply your edits/i))

    const whole = { inventoryId: INVENTORY, providerId: PROVIDER, quantity: 8 }
    await waitFor(() => expect(api.apply).toHaveBeenCalledWith(reorder.actionId, 'seal-1', whole))
    expect(api.mint).toHaveBeenCalledWith(reorder.actionId, whole)
    expect(await screen.findByText(/from your edits/i)).toBeInTheDocument()
  })

  it('keeps the card usable and says why when the gateway refuses an edit', async () => {
    const user = userEvent.setup()
    api.list.mockResolvedValue([vendorDraft])
    api.apply.mockRejectedValue(
      new AskAiActionError(
        'rejected',
        'That referred to something I could not find in your inventory, vendors or open orders.',
      ),
    )
    renderBar()
    await screen.findByTestId('askai-proposal-card')

    const instruction = screen.getByLabelText(/what the reply should say/i)
    await user.clear(instruction)
    await user.type(instruction, 'Ask for a credit note')
    completeHold(hold(/hold to apply your edits/i))

    // The row rolled back to `proposed` server-side, so the card must not vanish.
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not find/i)
    expect(screen.getByLabelText(/what the reply should say/i)).toHaveValue(
      'Ask for a credit note',
    )
    expect(hold(/hold to apply your edits/i)).toBeEnabled()
  })

  it('treats a lost compare-and-swap as an ordinary outcome, not an error', async () => {
    api.list.mockResolvedValue([reorder])
    api.apply.mockRejectedValue(
      new AskAiActionError('gone', 'That action is no longer waiting for confirmation.'),
    )
    renderBar()
    await screen.findByTestId('askai-proposal-card')

    completeHold(hold(/^hold to apply$/i))

    const note = await screen.findByText(/nothing ran twice/i)
    expect(note).toBeInTheDocument()
    // `role="alert"` is reserved for things that actually went wrong.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('will not offer to seal a locally impossible quantity', async () => {
    const user = userEvent.setup()
    api.list.mockResolvedValue([reorder])
    renderBar()
    await screen.findByTestId('askai-proposal-card')

    const qty = screen.getByLabelText(/quantity/i)
    await user.clear(qty)
    await user.type(qty, '0')

    expect(hold()).toBeDisabled()
    expect(api.mint).not.toHaveBeenCalled()
    expect(api.apply).not.toHaveBeenCalled()
  })

  it('discards without executing anything', async () => {
    const user = userEvent.setup()
    api.list.mockResolvedValue([reorder])
    api.discard.mockResolvedValue(undefined)
    renderBar()
    await screen.findByTestId('askai-proposal-card')

    await user.click(screen.getByRole('button', { name: /discard/i }))

    await waitFor(() => expect(api.discard).toHaveBeenCalledWith(reorder.actionId))
    expect(api.apply).not.toHaveBeenCalled()
    expect(await screen.findByText(/discarded\. nothing ran\./i)).toBeInTheDocument()
  })
})

describe('what the card refuses to offer', () => {
  it('gives no control that could change the family or action type', async () => {
    api.list.mockResolvedValue([reorder])
    renderBar()
    await screen.findByTestId('askai-proposal-card')

    // The gateway rejects such an edit outright; the UI must not invite it.
    for (const field of screen.getAllByRole('textbox')) {
      expect(field).not.toHaveValue('procurement')
      expect(field).not.toHaveValue('reorder')
    }
    expect(screen.queryByLabelText(/family/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/action type/i)).not.toBeInTheDocument()
  })
})

describe('candidates', () => {
  it('fetches the candidate set ONCE and shares it across every card', async () => {
    // The set is per-restaurant, not per-proposal. A fetch per card would be
    // N identical requests every time the bar opens.
    api.list.mockResolvedValue([reorder, vendorDraft])
    renderBar()

    await waitFor(() => expect(screen.getAllByTestId('askai-proposal-card')).toHaveLength(2))
    expect(api.candidates).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Item')).toBeTruthy()
    expect(screen.getByLabelText('Order')).toBeTruthy()
  })

  it('leaves the ask box and the seal gate working when candidates fail', async () => {
    // A broken candidate query costs the pickers, nothing else. Degrading the
    // whole surface because a dropdown could not be filled would be worse than
    // the read-only ids this feature replaced.
    api.candidates.mockRejectedValue(new Error('down'))
    api.list.mockResolvedValue([reorder])
    api.apply.mockResolvedValue({
      executed: true,
      actionId: reorder.actionId,
      executionRef: 'order-9',
      edited: false,
    })
    renderBar()

    await waitFor(() => expect(screen.getByTestId('askai-proposal-card')).toBeTruthy())
    expect(screen.queryByLabelText('Item')).toBeNull()

    completeHold(hold())
    await waitFor(() =>
      expect(api.apply).toHaveBeenCalledWith(reorder.actionId, 'seal-1', undefined),
    )
  })
})
