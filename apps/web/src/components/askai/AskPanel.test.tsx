/**
 * The Ask panel — ONE panel, two modes (ADR 0145; founder, 2026-09-26, round
 * 6: "One panel, two modes (Recommended)").
 *
 * What these pin, each a way the merge could die quietly:
 *
 *  1. The MODE THAT RUNS IS THE ONE SHOWN. Enter in "Ask the books" calls the
 *     bound ask and never the proposer; in "Propose an action" the reverse.
 *     The words may suggest the other mode — the panel says so and still does
 *     what is selected. It never guesses and acts.
 *  2. The backends' own verdicts are offered as the other mode, a click each:
 *     a folio that matched no reading offers a proposal; a declined proposal
 *     offers the books.
 *  3. A proposal applies ONLY through the hold bound to a server seal —
 *     AskAiBar's seal tests, moved here with its flow.
 *  4. Staff: the gateway's own `not_permitted` line is what is shown, and the
 *     founder's staff line is said in both modes.
 *  5. Where it sits: overlay = a dialog outside the page's tree; docked = a
 *     non-modal region in the page's row.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AskPanel, STAFF_PROPOSE_LINE } from './AskPanel'
import { AuthContext } from '../../contexts/AuthContext'
import { completeHold } from '../../__tests__/utils/seal'
import { STAFF_LINE } from '../../pages/ask/next/ask-format'
import {
  AskAiActionError,
  applyProposalSealed,
  discardAction,
  listCandidates,
  listOpenProposals,
  mintProposalSeal,
  proposeAction,
} from '../../services/api/askAi'
import { askApi, type AskFolio } from '../../services/api/ask'

vi.mock('../../services/api/askAi', async () => {
  const actual = await vi.importActual<typeof import('../../services/api/askAi')>('../../services/api/askAi')
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
vi.mock('../../services/api/ask', async () => {
  const actual = await vi.importActual<typeof import('../../services/api/ask')>('../../services/api/ask')
  return { ...actual, askApi: { ...actual.askApi, submit: vi.fn(), folio: vi.fn() } }
})

// `useUserPreferences` is react-query underneath and this file renders
// `AskPanel` with no `QueryClientProvider` in the tree — mocked the same way
// `GroundChoiceSync.test.tsx` mocks it, so what is under test is the panel's
// hydrate/persist logic, not react-query itself. `prefsState` is mutable so
// each test can steer what the "account" already holds.
const prefsState = {
  preferences: {} as { askLastMode?: 'ask' | 'propose' },
  isPlaceholderData: false,
  updatePreferences: vi.fn(),
}
vi.mock('../../hooks/useUserPreferences', () => ({
  useUserPreferences: () => prefsState,
}))

const api = {
  propose: vi.mocked(proposeAction),
  list: vi.mocked(listOpenProposals),
  candidates: vi.mocked(listCandidates),
  mint: vi.mocked(mintProposalSeal),
  apply: vi.mocked(applyProposalSealed),
  discard: vi.mocked(discardAction),
  submit: vi.mocked(askApi.submit),
  folio: vi.mocked(askApi.folio),
}

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
const CANDIDATES = {
  inventory: [{ id: INVENTORY, label: 'Barolo 2019' }],
  providers: [{ id: PROVIDER, label: 'Acme Wines' }],
  orders: [{ id: ORDER, label: 'Acme Wines · sent', providerId: PROVIDER, providerName: 'Acme Wines', status: 'sent' }],
  limits: { inventory: 60, providers: 30, orders: 20 },
  capped: { inventory: false, providers: false, orders: false },
}

function folio(over: Partial<AskFolio>): AskFolio {
  return {
    id: 'f-1',
    origin: 'panel',
    utterance: 'how much house red',
    status: 'complete',
    reading_id: null,
    reading_version: null,
    reading_args: {},
    reply_kind: null,
    answer: null,
    failure_reason: null,
    previous_folio_id: null,
    created_at: '2026-09-26T10:00:00Z',
    completed_at: '2026-09-26T10:00:02Z',
    reading_chosen_by: null,
    pick_model: null,
    compose_model: null,
    ...over,
  } as AskFolio
}

type Role = 'owner' | 'manager' | 'staff'
function renderPanel(
  opts: { route?: string; role?: Role; placement?: 'docked' | 'overlay'; followUp?: { folioId: string; utterance: string }; onClose?: () => void } = {},
) {
  const { route = '/inventory', role = 'owner', placement = 'overlay', followUp = null, onClose = () => {} } = opts
  return render(
    <AuthContext.Provider value={{ activeRole: role, activeRestaurantId: 'r-1' } as never}>
      <MemoryRouter initialEntries={[route]}>
        <div data-testid="page-column">
          <AskPanel placement={placement} open onClose={onClose} followUp={followUp} onDropFollowUp={() => {}} />
        </div>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

const modeRadio = (name: RegExp) => screen.getByRole('radio', { name })
const hold = (name: RegExp = /hold to apply/i) => screen.getByRole('button', { name })

beforeEach(() => {
  vi.clearAllMocks()
  api.list.mockResolvedValue([])
  api.candidates.mockResolvedValue(CANDIDATES)
  api.mint.mockResolvedValue('seal-1')
  prefsState.preferences = {}
  prefsState.isPlaceholderData = false
  prefsState.updatePreferences = vi.fn()
})

describe('two modes, one box — the mode that runs is the one shown', () => {
  it('opens on Ask the books, and Enter sends a question to the bound ask from the panel, never to the proposer', async () => {
    const user = userEvent.setup()
    api.submit.mockResolvedValue(folio({ utterance: 'how much house red is left?', answer: { kind: 'model_knowledge', sourceLabel: 'Not from the books', text: 'Twelve.' } }))
    renderPanel()

    expect(modeRadio(/ask the books/i)).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('askpanel-contract')).toHaveTextContent(/nothing is written/i)
    await user.type(screen.getByLabelText(/your question for the books/i), 'how much house red is left?{Enter}')

    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1))
    const [req, origin] = api.submit.mock.calls[0]
    expect(req.utterance).toBe('how much house red is left?')
    expect(req.requestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(origin).toBe('panel')
    expect(api.propose).not.toHaveBeenCalled()
    expect(await screen.findByTestId('askpanel-folio')).toHaveTextContent('Twelve.')
    expect(screen.getByRole('link', { name: /open the whole folio/i })).toHaveAttribute('href', '/ask/f/f-1')
  })

  it('in Propose an action, Enter drafts a proposal with the page context and never asks the books', async () => {
    const user = userEvent.setup()
    api.propose.mockResolvedValue({ proposed: true, proposal: reorder })
    renderPanel({ route: `/inventory/${INVENTORY}` })

    await user.click(modeRadio(/propose an action/i))
    expect(screen.getByTestId('askpanel-contract')).toHaveTextContent(/nothing runs until an owner or manager holds to seal it/i)
    await user.type(screen.getByLabelText(/the action to propose/i), 'reorder this{Enter}')

    await waitFor(() => expect(api.propose).toHaveBeenCalledTimes(1))
    const sent = api.propose.mock.calls[0][0]
    expect(sent).toContain('reorder this')
    expect(sent).toContain(INVENTORY)
    expect(api.submit).not.toHaveBeenCalled()
    expect(await screen.findByText(reorder.summary)).toBeInTheDocument()
  })

  it('suggests Propose for a request in Ask mode — and Enter STILL asks the books', async () => {
    const user = userEvent.setup()
    api.submit.mockResolvedValue(folio({ utterance: 'reorder 6 bottles of the Barolo', answer: { kind: 'no_reading_matched', reason: 'no_matching_question' } }))
    renderPanel()

    await user.type(screen.getByLabelText(/your question for the books/i), 'reorder 6 bottles of the Barolo')
    const hint = screen.getByTestId('askpanel-suggestion')
    expect(hint).toHaveAttribute('data-suggests', 'propose')
    expect(hint).toHaveTextContent(/enter still does what is selected/i)

    await user.keyboard('{Enter}')
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1))
    expect(api.propose).not.toHaveBeenCalled()
  })

  it('taking the suggestion switches the mode and sends nothing', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.type(screen.getByLabelText(/your question for the books/i), 'draft a follow-up to Acme')
    await user.click(screen.getByRole('button', { name: /switch to propose an action/i }))

    expect(modeRadio(/propose an action/i)).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByLabelText(/the action to propose/i)).toHaveValue('draft a follow-up to Acme')
    expect(api.propose).not.toHaveBeenCalled()
    expect(api.submit).not.toHaveBeenCalled()
    expect(screen.queryByTestId('askpanel-suggestion')).toBeNull()
  })

  it('suggests the books for a question typed in Propose mode', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(modeRadio(/propose an action/i))
    await user.type(screen.getByLabelText(/the action to propose/i), 'what arrives today?')
    expect(screen.getByTestId('askpanel-suggestion')).toHaveAttribute('data-suggests', 'ask')
  })
})

describe("the backends' own verdicts, offered as the other mode", () => {
  it('a folio that matched no reading offers a proposal, and only the click sends it', async () => {
    const user = userEvent.setup()
    api.submit.mockResolvedValue(folio({ utterance: 'order more Barolo', answer: { kind: 'no_reading_matched', reason: 'no_matching_question' } }))
    api.propose.mockResolvedValue({ proposed: true, proposal: reorder })
    renderPanel()

    await user.type(screen.getByLabelText(/your question for the books/i), 'order more Barolo{Enter}')
    const offer = await screen.findByTestId('askpanel-offer-propose')
    expect(api.propose).not.toHaveBeenCalled()

    await user.click(offer)
    await waitFor(() => expect(api.propose).toHaveBeenCalledTimes(1))
    expect(api.propose.mock.calls[0][0]).toContain('order more Barolo')
    expect(modeRadio(/propose an action/i)).toHaveAttribute('aria-checked', 'true')
  })

  it("a declined proposal shows the gateway's reason and offers the books", async () => {
    const user = userEvent.setup()
    api.propose.mockResolvedValue({ proposed: false, reason: 'Could not resolve which vendor to order from.' })
    api.submit.mockResolvedValue(folio({ utterance: 'order some wine' }))
    renderPanel()

    await user.click(modeRadio(/propose an action/i))
    await user.type(screen.getByLabelText(/the action to propose/i), 'order some wine{Enter}')
    const refusal = await screen.findByTestId('askai-refusal')
    expect(refusal).toHaveTextContent('Could not resolve which vendor to order from.')
    // the typing survives, so a near-miss is a two-word edit
    expect(screen.getByLabelText(/the action to propose/i)).toHaveValue('order some wine')
    expect(api.submit).not.toHaveBeenCalled()

    await user.click(screen.getByTestId('askpanel-offer-ask'))
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1))
    expect(api.submit.mock.calls[0][0].utterance).toBe('order some wine')
  })
})

describe('a proposal applies only through the seal', () => {
  it('a click on the hold applies nothing; the hold mints a seal, then applies with it', async () => {
    api.list.mockResolvedValue([reorder])
    api.apply.mockResolvedValue({ executed: true, actionId: reorder.actionId, executionRef: 'order-99', edited: false })
    renderPanel()
    await screen.findByTestId('askai-proposal-card')

    fireEvent.click(hold(/^hold to apply$/i))
    expect(api.mint).not.toHaveBeenCalled()
    expect(api.apply).not.toHaveBeenCalled()

    completeHold(hold(/^hold to apply$/i))
    await waitFor(() => expect(api.apply).toHaveBeenCalledWith(reorder.actionId, 'seal-1', undefined))
    expect(api.mint).toHaveBeenCalledWith(reorder.actionId, undefined)
    expect(api.mint.mock.invocationCallOrder[0]).toBeLessThan(api.apply.mock.invocationCallOrder[0])
    expect(await screen.findByText(/nothing has been sent/i)).toBeInTheDocument()
  })

  it('a refused seal applies nothing and says why', async () => {
    api.list.mockResolvedValue([reorder])
    api.mint.mockRejectedValue(new Error('Only an owner or a manager may seal this.'))
    renderPanel({ role: 'staff' })
    await screen.findByTestId('askai-proposal-card')

    completeHold(hold(/^hold to apply$/i))
    expect(await screen.findByText(/only an owner or a manager may seal this/i)).toBeInTheDocument()
    expect(api.apply).not.toHaveBeenCalled()
  })

  it('seals the edited payload, whole, and applies that same payload', async () => {
    const user = userEvent.setup()
    api.list.mockResolvedValue([reorder])
    api.apply.mockResolvedValue({ executed: true, actionId: reorder.actionId, executionRef: 'order-99', edited: true })
    renderPanel()
    await screen.findByTestId('askai-proposal-card')

    const qty = screen.getByLabelText(/quantity/i)
    await user.clear(qty)
    await user.type(qty, '8')
    completeHold(hold(/hold to apply your edits/i))

    const whole = { inventoryId: INVENTORY, providerId: PROVIDER, quantity: 8 }
    await waitFor(() => expect(api.apply).toHaveBeenCalledWith(reorder.actionId, 'seal-1', whole))
    expect(api.mint).toHaveBeenCalledWith(reorder.actionId, whole)
  })

  it('keeps the card usable when the gateway refuses an edit', async () => {
    const user = userEvent.setup()
    api.list.mockResolvedValue([vendorDraft])
    api.apply.mockRejectedValue(
      new AskAiActionError('rejected', 'That referred to something I could not find in your inventory, vendors or open orders.'),
    )
    renderPanel()
    await screen.findByTestId('askai-proposal-card')

    const instruction = screen.getByLabelText(/what the reply should say/i)
    await user.clear(instruction)
    await user.type(instruction, 'Ask for a credit note')
    completeHold(hold(/hold to apply your edits/i))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not find/i)
    expect(screen.getByLabelText(/what the reply should say/i)).toHaveValue('Ask for a credit note')
    expect(hold(/hold to apply your edits/i)).toBeEnabled()
  })

  it('treats a lost compare-and-swap as an ordinary outcome', async () => {
    api.list.mockResolvedValue([reorder])
    api.apply.mockRejectedValue(new AskAiActionError('gone', 'That action is no longer waiting for confirmation.'))
    renderPanel()
    await screen.findByTestId('askai-proposal-card')
    completeHold(hold(/^hold to apply$/i))
    expect(await screen.findByText(/nothing ran twice/i)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('discards without executing anything', async () => {
    const user = userEvent.setup()
    api.list.mockResolvedValue([reorder])
    api.discard.mockResolvedValue(undefined)
    renderPanel()
    await screen.findByTestId('askai-proposal-card')
    await user.click(screen.getByRole('button', { name: /discard/i }))
    await waitFor(() => expect(api.discard).toHaveBeenCalledWith(reorder.actionId))
    expect(api.apply).not.toHaveBeenCalled()
  })

  it('shows proposals already waiting, whichever mode it opens in, and fetches candidates once', async () => {
    api.list.mockResolvedValue([reorder, vendorDraft])
    renderPanel()
    await waitFor(() => expect(screen.getAllByTestId('askai-proposal-card')).toHaveLength(2))
    expect(modeRadio(/ask the books/i)).toHaveAttribute('aria-checked', 'true')
    expect(api.candidates).toHaveBeenCalledTimes(1)
  })

  it('a failed read of the waiting proposals is said, never drawn as none waiting (ADR 0145 build task 14)', async () => {
    api.list.mockRejectedValue(new Error('The gateway did not answer.'))
    renderPanel()
    const note = await screen.findByTestId('askpanel-proposals-unread')
    expect(note).toHaveTextContent('The gateway did not answer.')
    expect(note).toHaveTextContent(/does not mean none are waiting/i)
    expect(screen.getByLabelText(/your question for the books/i)).toBeEnabled()
  })

  it('sends only the words when context is switched off', async () => {
    const user = userEvent.setup()
    api.propose.mockResolvedValue({ proposed: true, proposal: reorder })
    renderPanel({ route: '/orders' })
    await user.click(modeRadio(/propose an action/i))
    await user.click(screen.getByRole('button', { name: /^orders$/i }))
    await user.type(screen.getByLabelText(/the action to propose/i), 'reorder barolo{Enter}')
    await waitFor(() => expect(api.propose).toHaveBeenCalledWith('reorder barolo'))
  })
})

describe('staff (ADR 0145 round 6, "Yes, own-work only")', () => {
  it("prints the gateway's own not_permitted line, and the founder's staff line", async () => {
    const user = userEvent.setup()
    const line = 'Supplier prices are not shown to staff.'
    api.submit.mockResolvedValue(
      folio({
        utterance: 'what does Acme charge for Barolo',
        reply_kind: 'not_permitted',
        answer: { kind: 'not_permitted', reason: 'class_not_visible', line, readingId: 'vendors.prices' },
      }),
    )
    renderPanel({ role: 'staff' })
    expect(screen.getByTestId('askpanel-staff-line')).toHaveTextContent(STAFF_LINE)

    await user.type(screen.getByLabelText(/your question for the books/i), 'what does Acme charge for Barolo{Enter}')
    expect(await screen.findByTestId('askpanel-line')).toHaveTextContent(line)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('tells staff in Propose mode that the seal is an owner’s or a manager’s', async () => {
    const user = userEvent.setup()
    renderPanel({ role: 'staff' })
    await user.click(modeRadio(/propose an action/i))
    expect(screen.getByTestId('askpanel-staff-line')).toHaveTextContent(STAFF_PROPOSE_LINE)
  })

  it('says nothing about staff to an owner', () => {
    renderPanel({ role: 'owner' })
    expect(screen.queryByTestId('askpanel-staff-line')).toBeNull()
  })
})

describe('the launch gate and failures, in words', () => {
  it('says Ask has not opened when the gateway is not launched, and spent nothing', async () => {
    const user = userEvent.setup()
    const { AxiosError } = await import('axios')
    const err = new AxiosError('503', 'ERR_BAD_RESPONSE', undefined, undefined, {
      status: 503,
      data: { message: 'Ask has not launched yet.' },
    } as never)
    api.submit.mockRejectedValue(err)
    renderPanel()
    await user.type(screen.getByLabelText(/your question for the books/i), 'what arrives today?{Enter}')
    const f = await screen.findByTestId('askpanel-failure')
    expect(f).toHaveAttribute('data-kind', 'not_open')
    expect(f).toHaveTextContent(/nothing was asked and nothing was spent/i)
  })
})

describe('"Keep asking" carries a folio', () => {
  it('sends the next question as a re-ask of that folio', async () => {
    const user = userEvent.setup()
    api.submit.mockResolvedValue(folio({ id: 'f-2', previous_folio_id: 'f-1' }))
    renderPanel({ followUp: { folioId: 'f-1', utterance: 'how much house red' } })
    expect(screen.getByTestId('askpanel-followup')).toHaveTextContent('how much house red')
    await user.type(screen.getByLabelText(/your question for the books/i), 'and the white?{Enter}')
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1))
    expect(api.submit.mock.calls[0][0].previousFolioId).toBe('f-1')
  })
})

describe('opens on the person’s last used mode (ADR 0145, founder round 7)', () => {
  it('opens on Ask the books when the account has never chosen, and writes nothing back', () => {
    renderPanel()
    expect(modeRadio(/ask the books/i)).toHaveAttribute('aria-checked', 'true')
    expect(prefsState.updatePreferences).not.toHaveBeenCalled()
  })

  it('opens on Propose an action when that is what the account last held', () => {
    prefsState.preferences = { askLastMode: 'propose' }
    renderPanel()
    expect(modeRadio(/propose an action/i)).toHaveAttribute('aria-checked', 'true')
    expect(prefsState.updatePreferences).not.toHaveBeenCalled()
  })

  it('treats a garbage stored value the same as never having chosen (a safe default, never a crash)', () => {
    prefsState.preferences = { askLastMode: 'sing-a-song' as never }
    renderPanel()
    expect(modeRadio(/ask the books/i)).toHaveAttribute('aria-checked', 'true')
  })

  it('does not decide from a still-loading read, and adopts the account’s answer once it resolves', async () => {
    prefsState.isPlaceholderData = true
    const view = render(
      <AuthContext.Provider value={{ activeRole: 'owner', activeRestaurantId: 'r-1' } as never}>
        <MemoryRouter initialEntries={['/inventory']}>
          <AskPanel placement="overlay" open onClose={() => {}} />
        </MemoryRouter>
      </AuthContext.Provider>,
    )
    expect(screen.getByRole('radio', { name: /ask the books/i })).toHaveAttribute('aria-checked', 'true')

    prefsState.isPlaceholderData = false
    prefsState.preferences = { askLastMode: 'propose' }
    view.rerender(
      <AuthContext.Provider value={{ activeRole: 'owner', activeRestaurantId: 'r-1' } as never}>
        <MemoryRouter initialEntries={['/inventory']}>
          <AskPanel placement="overlay" open onClose={() => {}} />
        </MemoryRouter>
      </AuthContext.Provider>,
    )
    await waitFor(() => expect(screen.getByRole('radio', { name: /propose an action/i })).toHaveAttribute('aria-checked', 'true'))
  })

  it('remembers a switch to Propose, for the next open', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(modeRadio(/propose an action/i))
    await waitFor(() => expect(prefsState.updatePreferences).toHaveBeenCalledWith({ askLastMode: 'propose' }))
  })

  it('remembers taking the suggestion into Propose, the same as an explicit switch', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.type(screen.getByLabelText(/your question for the books/i), 'draft a follow-up to Acme')
    await user.click(screen.getByRole('button', { name: /switch to propose an action/i }))
    await waitFor(() => expect(prefsState.updatePreferences).toHaveBeenCalledWith({ askLastMode: 'propose' }))
  })

  it('does not write back a mode that already matches what the account holds', () => {
    prefsState.preferences = { askLastMode: 'ask' }
    renderPanel()
    expect(prefsState.updatePreferences).not.toHaveBeenCalled()
  })
})

describe('where it sits', () => {
  it('overlay: a dialog outside the page’s tree, closed by the person', async () => {
    const onClose = vi.fn()
    renderPanel({ placement: 'overlay', onClose })
    const dialog = await screen.findByRole('dialog', { name: /ask mudavym/i })
    expect(screen.getByTestId('page-column').contains(dialog)).toBe(false)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('docked: a region in the page’s row, not modal, and Escape closes it', async () => {
    const onClose = vi.fn()
    renderPanel({ placement: 'docked', onClose })
    const region = screen.getByRole('complementary', { name: 'Ask Mudavym' })
    expect(screen.getByTestId('page-column').contains(region)).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.keyDown(screen.getByLabelText(/your question for the books/i), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
