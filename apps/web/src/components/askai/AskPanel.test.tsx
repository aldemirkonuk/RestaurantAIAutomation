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
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AskPanel, STAFF_PROPOSE_LINE, type AskPanelProps } from './AskPanel'
import { useAskSession } from './useAskSession'
import { useAskPanel } from './useAskPanel'
import { openAskAi } from './events'
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

/** The panel's session belongs to its owner (`useAskPanel`); here the test is the owner. */
function OwnedPanel(props: Omit<AskPanelProps, 'session'>) {
  const session = useAskSession(null, props.open)
  return <AskPanel {...props} session={session} />
}

type Role = 'owner' | 'manager' | 'staff'
function renderPanel(
  opts: {
    route?: string
    role?: Role
    placement?: 'docked' | 'overlay'
    followUp?: { folioId: string; utterance: string }
    onClose?: () => void
    onDropFollowUp?: () => void
  } = {},
) {
  const { route = '/inventory', role = 'owner', placement = 'overlay', followUp = null, onClose = () => {}, onDropFollowUp = () => {} } = opts
  return render(
    <AuthContext.Provider value={{ activeRole: role, activeRestaurantId: 'r-1' } as never}>
      <MemoryRouter initialEntries={[route]}>
        <div data-testid="page-column">
          <OwnedPanel placement={placement} open onClose={onClose} followUp={followUp} onDropFollowUp={onDropFollowUp} />
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

  // The next three are AskAiBar's, carried over from origin/main
  // AskAiBar.test.tsx:258/289/317 when the bar was folded into this panel.
  it('will not offer to seal a locally impossible quantity', async () => {
    const user = userEvent.setup()
    api.list.mockResolvedValue([reorder])
    renderPanel()
    await screen.findByTestId('askai-proposal-card')

    const qty = screen.getByLabelText(/quantity/i)
    await user.clear(qty)
    await user.type(qty, '0')

    expect(hold()).toBeDisabled()
    expect(api.mint).not.toHaveBeenCalled()
    expect(api.apply).not.toHaveBeenCalled()
  })

  it('gives no control that could change the family or action type', async () => {
    api.list.mockResolvedValue([reorder])
    renderPanel()
    await screen.findByTestId('askai-proposal-card')

    // The gateway rejects such an edit outright; the panel must not invite it.
    for (const field of screen.getAllByRole('textbox')) {
      expect(field).not.toHaveValue('procurement')
      expect(field).not.toHaveValue('reorder')
    }
    expect(screen.queryByLabelText(/family/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/action type/i)).not.toBeInTheDocument()
  })

  it('leaves the ask box and the seal gate working when candidates fail', async () => {
    // A broken candidate query costs the pickers, nothing else.
    api.candidates.mockRejectedValue(new Error('down'))
    api.list.mockResolvedValue([reorder])
    api.apply.mockResolvedValue({ executed: true, actionId: reorder.actionId, executionRef: 'order-9', edited: false })
    renderPanel()

    await screen.findByTestId('askai-proposal-card')
    expect(screen.queryByLabelText('Item')).toBeNull()
    expect(screen.getByLabelText(/your question for the books/i)).toBeEnabled()

    completeHold(hold())
    await waitFor(() => expect(api.apply).toHaveBeenCalledWith(reorder.actionId, 'seal-1', undefined))
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
          <OwnedPanel placement="overlay" open onClose={() => {}} />
        </MemoryRouter>
      </AuthContext.Provider>,
    )
    expect(screen.getByRole('radio', { name: /ask the books/i })).toHaveAttribute('aria-checked', 'true')

    prefsState.isPlaceholderData = false
    prefsState.preferences = { askLastMode: 'propose' }
    view.rerender(
      <AuthContext.Provider value={{ activeRole: 'owner', activeRestaurantId: 'r-1' } as never}>
        <MemoryRouter initialEntries={['/inventory']}>
          <OwnedPanel placement="overlay" open onClose={() => {}} />
        </MemoryRouter>
      </AuthContext.Provider>,
    )
    await waitFor(() => expect(screen.getByRole('radio', { name: /propose an action/i })).toHaveAttribute('aria-checked', 'true'))
  })

  // The hydrate race (PR #475 audit): the switch is live before the account's
  // read resolves, so a choice made in that window must survive the read.
  function renderLoading() {
    const tree = () => (
      <AuthContext.Provider value={{ activeRole: 'owner', activeRestaurantId: 'r-1' } as never}>
        <MemoryRouter initialEntries={['/inventory']}>
          <OwnedPanel placement="overlay" open onClose={() => {}} />
        </MemoryRouter>
      </AuthContext.Provider>
    )
    const view = render(tree())
    return { resolve: () => view.rerender(tree()) }
  }

  it('keeps a Propose chosen while the read was loading, and remembers it over the stored Ask', async () => {
    const user = userEvent.setup()
    prefsState.isPlaceholderData = true
    const { resolve } = renderLoading()
    await user.click(modeRadio(/propose an action/i))

    prefsState.isPlaceholderData = false
    prefsState.preferences = { askLastMode: 'ask' }
    resolve()

    await waitFor(() => expect(prefsState.updatePreferences).toHaveBeenCalledWith({ askLastMode: 'propose' }))
    expect(modeRadio(/propose an action/i)).toHaveAttribute('aria-checked', 'true')
    api.propose.mockResolvedValue({ proposed: true, proposal: reorder })
    await user.type(screen.getByLabelText(/the action to propose/i), 'reorder barolo{Enter}')
    await waitFor(() => expect(api.propose).toHaveBeenCalledTimes(1))
    expect(api.submit).not.toHaveBeenCalled()
  })

  it('keeps an Ask chosen while the read was loading, over a stored Propose', async () => {
    const user = userEvent.setup()
    prefsState.isPlaceholderData = true
    const { resolve } = renderLoading()
    await user.click(modeRadio(/propose an action/i))
    await user.click(modeRadio(/ask the books/i))

    prefsState.isPlaceholderData = false
    prefsState.preferences = { askLastMode: 'propose' }
    resolve()

    await waitFor(() => expect(prefsState.updatePreferences).toHaveBeenCalledWith({ askLastMode: 'ask' }))
    expect(modeRadio(/ask the books/i)).toHaveAttribute('aria-checked', 'true')
  })

  it('writes nothing when the choice made while loading already matches the stored mode', async () => {
    const user = userEvent.setup()
    prefsState.isPlaceholderData = true
    const { resolve } = renderLoading()
    await user.click(modeRadio(/propose an action/i))

    prefsState.isPlaceholderData = false
    prefsState.preferences = { askLastMode: 'propose' }
    resolve()

    await waitFor(() => expect(modeRadio(/propose an action/i)).toHaveAttribute('aria-checked', 'true'))
    expect(prefsState.updatePreferences).not.toHaveBeenCalled()
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

// Founder, 2026-10-01, "Keep answering (Recommended)" (ADR 0145, amendment of
// that date). The body unmounts on close, so before this a question in flight
// was dropped from view, and asking again minted a new request id: a second
// paid answer (PR #575 audit). These render the REAL owner, `useAskPanel`.
describe('closing keeps the question in flight (ADR 0145, 2026-10-01)', () => {
  function Owner() {
    const ask = useAskPanel()
    return (
      <AskPanel
        placement="docked"
        open={ask.open}
        onClose={ask.close}
        followUp={ask.followUp}
        onDropFollowUp={ask.dropFollowUp}
        session={ask.session}
      />
    )
  }
  type Who = { userId: string; house: string }
  const tree = (who: Who | null) => (
    <AuthContext.Provider
      value={{ activeRole: 'owner', activeRestaurantId: who?.house ?? 'r-1', user: who ? { userId: who.userId } : null } as never}
    >
      <MemoryRouter initialEntries={['/inventory']}>
        <Owner />
      </MemoryRouter>
    </AuthContext.Provider>
  )
  /** Renders the owner signed in as `who` and opens the panel; `switchTo` changes the person or the house in place. */
  function renderOwner(who: Who | null = null) {
    const view = render(tree(who))
    act(() => openAskAi())
    return { switchTo: (next: Who) => view.rerender(tree(next)) }
  }
  const panel = () => screen.queryByRole('complementary', { name: 'Ask Mudavym' })
  const box = () => screen.getByLabelText(/your question for the books/i)
  const QUESTION = 'how much house red is left?'
  const TWELVE = { kind: 'model_knowledge', sourceLabel: 'Not from the books', text: 'Twelve.' } as AskFolio['answer']
  const close = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Close' }))
  const reopen = () => act(() => openAskAi())
  const examples = () => screen.queryByRole('button', { name: /how much of the house red do we have/i })
  async function httpError(status: number, message: string) {
    const { AxiosError } = await import('axios')
    return new AxiosError(String(status), 'ERR_BAD_RESPONSE', undefined, undefined, { status, data: { message } } as never)
  }
  async function timeoutError() {
    const { AxiosError } = await import('axios')
    return new AxiosError('timeout of 60000ms exceeded', 'ECONNABORTED')
  }

  async function askThenClose(user: ReturnType<typeof userEvent.setup>) {
    await user.type(box(), `${QUESTION}{Enter}`)
    expect(await screen.findByTestId('askpanel-pending')).toHaveTextContent(`Still answering “${QUESTION}”`)
    await close(user)
    expect(panel()).toBeNull()
  }

  it('an answer that lands after a close is there on reopening, and was paid for once', async () => {
    const user = userEvent.setup()
    const answer = deferred<AskFolio>()
    api.submit.mockReturnValue(answer.promise)
    renderOwner()
    await askThenClose(user)

    await act(async () => answer.resolve(folio({ utterance: QUESTION, answer: TWELVE })))
    reopen()

    expect(await screen.findByTestId('askpanel-folio')).toHaveTextContent('Twelve.')
    expect(screen.queryByTestId('askpanel-pending')).toBeNull()
    expect(box()).toBeEnabled()
    expect(api.submit).toHaveBeenCalledTimes(1)
  })

  it('reopened while still answering, it says so and stays busy, so nothing can buy a second answer', async () => {
    const user = userEvent.setup()
    const answer = deferred<AskFolio>()
    api.submit.mockReturnValue(answer.promise)
    renderOwner()
    await askThenClose(user)

    reopen()
    expect(screen.getByTestId('askpanel-pending')).toHaveTextContent(`Still answering “${QUESTION}”`)
    expect(box()).toBeDisabled()

    await act(async () => answer.resolve(folio({ utterance: QUESTION, answer: TWELVE })))
    expect(await screen.findByTestId('askpanel-folio')).toHaveTextContent('Twelve.')
    expect(box()).toBeEnabled()
    expect(api.submit).toHaveBeenCalledTimes(1)
  })

  it('a question that timed out while closed offers "Check again", which re-sends the same request id', async () => {
    const user = userEvent.setup()
    const answer = deferred<AskFolio>()
    api.submit.mockReturnValueOnce(answer.promise).mockResolvedValueOnce(folio({ utterance: QUESTION, answer: TWELVE }))
    renderOwner()
    await askThenClose(user)

    const timedOut = await timeoutError()
    await act(async () => answer.reject(timedOut))
    reopen()
    const failure = await screen.findByTestId('askpanel-failure')
    expect(failure).toHaveAttribute('data-kind', 'timeout')

    await user.click(screen.getByRole('button', { name: /check again/i }))
    expect(await screen.findByTestId('askpanel-folio')).toHaveTextContent('Twelve.')
    expect(screen.queryByTestId('askpanel-failure')).toBeNull()
    expect(api.submit).toHaveBeenCalledTimes(2)
    expect(api.submit.mock.calls[1][0].requestId).toBe(api.submit.mock.calls[0][0].requestId)
  })

  it('an answer landing after a close does not drop the follow-up a later open carried in', async () => {
    const user = userEvent.setup()
    const answer = deferred<AskFolio>()
    api.submit.mockReturnValue(answer.promise)
    renderOwner()
    await askThenClose(user)

    act(() => openAskAi({ followUp: { folioId: 'f-9', utterance: 'what arrived on Monday' } }))
    expect(screen.getByTestId('askpanel-followup')).toHaveTextContent('what arrived on Monday')
    await act(async () => answer.resolve(folio({ utterance: QUESTION, answer: TWELVE })))
    await screen.findByTestId('askpanel-folio')
    expect(screen.getByTestId('askpanel-followup')).toHaveTextContent('what arrived on Monday')
  })

  it('an action being drafted is kept too: reopened, it says so, stays busy, and the proposal arrives once', async () => {
    const user = userEvent.setup()
    const drafted = deferred<Awaited<ReturnType<typeof proposeAction>>>()
    api.propose.mockReturnValue(drafted.promise)
    renderOwner()
    await user.click(modeRadio(/propose an action/i))
    await user.type(screen.getByLabelText(/the action to propose/i), 'reorder 6 bottles of the Barolo{Enter}')
    expect(await screen.findByTestId('askpanel-pending')).toHaveTextContent('Still drafting “reorder 6 bottles of the Barolo”')
    await close(user)

    reopen()
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('askpanel-pending')).toHaveAttribute('data-kind', 'propose')
    expect(screen.getByRole('textbox')).toBeDisabled()

    await act(async () => drafted.resolve({ proposed: true, proposal: reorder }))
    expect(await screen.findByText(reorder.summary)).toBeInTheDocument()
    expect(api.propose).toHaveBeenCalledTimes(1)
  })

  describe('what a close does not keep', () => {
    it('a failure with nothing to retry is dropped at the close, and the examples come back', async () => {
      const user = userEvent.setup()
      api.submit.mockRejectedValue(await httpError(429, 'Slow down.'))
      renderOwner()
      await user.type(box(), `${QUESTION}{Enter}`)
      expect(await screen.findByTestId('askpanel-failure')).toHaveAttribute('data-kind', 'too_fast')
      expect(screen.queryByRole('button', { name: /check again/i })).toBeNull()
      expect(examples()).toBeNull()

      await close(user)
      reopen()
      expect(screen.queryByTestId('askpanel-failure')).toBeNull()
      expect(examples()).toBeInTheDocument()
    })

    it('a failure that offers "Check again" is kept across a close', async () => {
      const user = userEvent.setup()
      api.submit.mockRejectedValue(await timeoutError())
      renderOwner()
      await user.type(box(), `${QUESTION}{Enter}`)
      expect(await screen.findByTestId('askpanel-failure')).toHaveAttribute('data-kind', 'timeout')

      await close(user)
      reopen()
      expect(screen.getByTestId('askpanel-failure')).toHaveAttribute('data-kind', 'timeout')
      expect(screen.getByRole('button', { name: /check again/i })).toBeEnabled()
    })

    it('a failure with nothing to retry that lands while closed is said once on reopening, then dropped at that close', async () => {
      const user = userEvent.setup()
      const answer = deferred<AskFolio>()
      api.submit.mockReturnValue(answer.promise)
      renderOwner()
      await askThenClose(user)

      const tooFast = await httpError(429, 'Slow down.')
      await act(async () => answer.reject(tooFast))
      reopen()
      expect(screen.getByTestId('askpanel-failure')).toHaveAttribute('data-kind', 'too_fast')

      await close(user)
      reopen()
      expect(screen.queryByTestId('askpanel-failure')).toBeNull()
    })

    // The close keeps a failure only when its alert offers "Check again":
    // that needs the request it re-sends, not just a retryable kind.
    it('a folio re-read that timed out is dropped at the close: it has no request to re-send, and the folio keeps its own "Check again"', async () => {
      const user = userEvent.setup()
      api.submit.mockResolvedValue(folio({ utterance: QUESTION, status: 'pending' }))
      api.folio.mockRejectedValue(await timeoutError())
      renderOwner()
      await user.type(box(), `${QUESTION}{Enter}`)
      await user.click(await screen.findByRole('button', { name: /check again/i }))
      const failure = await screen.findByTestId('askpanel-failure')
      expect(failure).toHaveAttribute('data-kind', 'timeout')
      expect(within(failure).queryByRole('button')).toBeNull()

      await close(user)
      reopen()
      expect(screen.queryByTestId('askpanel-failure')).toBeNull()
      expect(within(screen.getByTestId('askpanel-folio')).getByRole('button', { name: /check again/i })).toBeEnabled()
    })

    it('a re-read’s failure with nothing to retry is dropped at the close, even while an earlier question’s request is still held', async () => {
      const user = userEvent.setup()
      api.submit
        .mockResolvedValueOnce(folio({ utterance: QUESTION, status: 'pending' }))
        .mockRejectedValueOnce(await timeoutError())
      api.folio.mockRejectedValue(await httpError(404, 'That question is not in this house’s book.'))
      renderOwner()
      await user.type(box(), `${QUESTION}{Enter}`)
      const pendingFolio = await screen.findByTestId('askpanel-folio')
      await user.type(box(), 'and the white?{Enter}')
      expect(await screen.findByTestId('askpanel-failure')).toHaveAttribute('data-kind', 'timeout')

      await user.click(within(pendingFolio).getByRole('button', { name: /check again/i }))
      await waitFor(() => expect(screen.getByTestId('askpanel-failure')).toHaveAttribute('data-kind', 'rejected'))
      expect(within(screen.getByTestId('askpanel-failure')).queryByRole('button')).toBeNull()

      await close(user)
      reopen()
      expect(screen.queryByTestId('askpanel-failure')).toBeNull()
    })

    it('the proposer’s transport error is dropped at the close', async () => {
      const user = userEvent.setup()
      api.propose.mockRejectedValue(new Error('Network Error'))
      renderOwner()
      await user.click(modeRadio(/propose an action/i))
      await user.type(screen.getByLabelText(/the action to propose/i), 'reorder the Barolo{Enter}')
      expect(await screen.findByTestId('askai-error')).toHaveTextContent('Network Error')

      await close(user)
      prefsState.preferences = { askLastMode: 'propose' }
      reopen()
      expect(modeRadio(/propose an action/i)).toHaveAttribute('aria-checked', 'true')
      expect(screen.queryByTestId('askai-error')).toBeNull()
    })

    it('the refusal of a drafted action is kept across a close, with the words it declined', async () => {
      const user = userEvent.setup()
      api.propose.mockResolvedValue({ proposed: false, reason: 'Could not resolve which vendor to order from.' })
      renderOwner()
      await user.click(modeRadio(/propose an action/i))
      await user.type(screen.getByLabelText(/the action to propose/i), 'reorder the Barolo{Enter}')
      expect(await screen.findByTestId('askai-refusal')).toHaveTextContent('Could not resolve which vendor')

      await close(user)
      prefsState.preferences = { askLastMode: 'propose' }
      reopen()
      expect(screen.getByTestId('askai-refusal')).toHaveTextContent('Could not resolve which vendor')
      api.submit.mockResolvedValue(folio({ utterance: 'reorder the Barolo' }))
      await user.click(screen.getByTestId('askpanel-offer-ask'))
      await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1))
      expect(api.submit.mock.calls[0][0].utterance).toBe('reorder the Barolo')
    })

    // A card that is done must not come back as a card to seal, even when the
    // on-open re-read fails and the list is all the panel has.
    type Card = ReturnType<typeof within>
    const settle: Array<[string, (user: ReturnType<typeof userEvent.setup>, card: Card) => Promise<void>, RegExp]> = [
      [
        'applied',
        async (_user, card) => {
          api.apply.mockResolvedValue({ executed: true, actionId: reorder.actionId, executionRef: 'order-99', edited: false })
          completeHold(card.getByRole('button', { name: /^hold to apply$/i }))
        },
        /nothing has been sent/i,
      ],
      [
        'already handled at the apply',
        async (_user, card) => {
          api.apply.mockRejectedValue(new AskAiActionError('gone', 'That action is no longer waiting for confirmation.'))
          completeHold(card.getByRole('button', { name: /^hold to apply$/i }))
        },
        /nothing ran twice/i,
      ],
      [
        'failed at the apply',
        async (_user, card) => {
          api.apply.mockRejectedValue(new AskAiActionError('failed', 'The draft order could not be written.'))
          completeHold(card.getByRole('button', { name: /^hold to apply$/i }))
        },
        /the draft order could not be written/i,
      ],
      [
        'already handled at the seal',
        async (_user, card) => {
          api.mint.mockRejectedValue(new AskAiActionError('gone', 'That action is no longer waiting for confirmation.'))
          completeHold(card.getByRole('button', { name: /^hold to apply$/i }))
        },
        /nothing ran twice/i,
      ],
      [
        'discarded',
        async (user, card) => {
          api.discard.mockResolvedValue(undefined)
          await user.click(card.getByRole('button', { name: /discard/i }))
        },
        /discarded\. nothing ran/i,
      ],
      [
        'already handled at the discard',
        async (user, card) => {
          api.discard.mockRejectedValue(new AskAiActionError('gone', 'That action is no longer waiting for confirmation.'))
          await user.click(card.getByRole('button', { name: /discard/i }))
        },
        /nothing ran twice/i,
      ],
    ]
    it.each(settle)('a proposal %s before the close does not come back as a card to seal', async (_, act_, said) => {
      const user = userEvent.setup()
      api.list.mockResolvedValueOnce([reorder, vendorDraft]).mockRejectedValue(new Error('The gateway did not answer.'))
      renderOwner()
      const card = within((await screen.findByText(reorder.summary)).closest('[data-testid="askai-proposal-card"]') as HTMLElement)
      await act_(user, card)
      expect(await screen.findByText(said)).toBeInTheDocument()

      await close(user)
      reopen()
      await screen.findByTestId('askpanel-proposals-unread')
      expect(screen.queryByText(reorder.summary)).toBeNull()
      // The one still waiting stays: a close drops only what is done.
      expect(screen.getByText(vendorDraft.summary)).toBeInTheDocument()
    })

    it('a proposal discarded after the close, its card already gone, does not come back either', async () => {
      const user = userEvent.setup()
      const discarding = deferred<undefined>()
      api.list.mockResolvedValueOnce([reorder]).mockRejectedValue(new Error('The gateway did not answer.'))
      api.discard.mockReturnValue(discarding.promise as never)
      renderOwner()
      await screen.findByText(reorder.summary)
      await user.click(screen.getByRole('button', { name: /discard/i }))
      await close(user)

      await act(async () => discarding.resolve(undefined))
      reopen()
      await screen.findByTestId('askpanel-proposals-unread')
      expect(screen.queryByText(reorder.summary)).toBeNull()
    })

    // An apply still in flight at the close: the card is offered again on
    // reopening (the session holds the proposal, the old card's state went
    // with the body), but the gateway applies one action id at most once. Its
    // claim is a compare-and-swap on `status = 'proposed'`, and a seal is
    // minted only for a row still `proposed` (`ask-ai.service.ts`), so a
    // second hold is refused, at the seal or at the apply.
    const secondHold: Array<[string, () => void]> = [
      [
        'at the seal',
        () => api.mint.mockRejectedValue(new AskAiActionError('gone', 'That action is no longer waiting for confirmation.')),
      ],
      [
        'at the apply',
        () => {
          api.mint.mockResolvedValue('seal-2')
          api.apply.mockRejectedValueOnce(new AskAiActionError('gone', 'That action is no longer waiting for confirmation.'))
        },
      ],
    ]
    it.each(secondHold)('an apply in flight at the close: a second hold is refused %s, and the card says nothing ran twice', async (_, refuse) => {
      const user = userEvent.setup()
      const applying = deferred<Awaited<ReturnType<typeof applyProposalSealed>>>()
      api.list.mockResolvedValue([reorder])
      api.apply.mockReturnValueOnce(applying.promise)
      renderOwner()
      const cardOf = async () =>
        within((await screen.findByText(reorder.summary)).closest('[data-testid="askai-proposal-card"]') as HTMLElement)
      completeHold((await cardOf()).getByRole('button', { name: /^hold to apply$/i }))
      await waitFor(() => expect(api.apply).toHaveBeenCalledTimes(1))
      await close(user)

      refuse()
      reopen()
      await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2))
      const again = await cardOf()
      completeHold(again.getByRole('button', { name: /^hold to apply$/i }))
      expect(await again.findByText(/nothing ran twice/i)).toBeInTheDocument()
      expect(again.queryByRole('alert')).toBeNull()
      expect(again.queryByRole('button', { name: /^hold to apply$/i })).toBeNull()

      // The first apply lands; at the close the card leaves for good.
      await act(async () => applying.resolve({ executed: true, actionId: reorder.actionId, executionRef: 'order-99', edited: false }))
      await close(user)
      api.list.mockRejectedValue(new Error('The gateway did not answer.'))
      reopen()
      await screen.findByTestId('askpanel-proposals-unread')
      expect(screen.queryByText(reorder.summary)).toBeNull()
    })
  })

  // The shell is mounted once and a branch switch happens in place
  // (`RestaurantBranchSwitcher` → `AuthContext.setActiveRestaurantId`). The
  // once-per-id key includes the house, so house A's id re-sent in house B is
  // a new paid call.
  describe('one person in one house: a switch starts the session again', () => {
    const A = { userId: 'u-1', house: 'r-1' }
    const B = { userId: 'u-1', house: 'r-2' }

    it('switched mid-answer: the panel is not busy, and the old answer lands nowhere', async () => {
      const user = userEvent.setup()
      const old = deferred<AskFolio>()
      api.submit.mockReturnValue(old.promise)
      const { switchTo } = renderOwner(A)
      await user.type(box(), `${QUESTION}{Enter}`)
      expect(await screen.findByTestId('askpanel-pending')).toBeInTheDocument()

      switchTo(B)
      expect(screen.queryByTestId('askpanel-pending')).toBeNull()
      expect(box()).toBeEnabled()

      await act(async () => old.resolve(folio({ utterance: QUESTION, answer: TWELVE })))
      expect(screen.queryByTestId('askpanel-folio')).toBeNull()
      expect(api.submit).toHaveBeenCalledTimes(1)
    })

    it('the old answer landing does not let go of the new house’s question in flight', async () => {
      const user = userEvent.setup()
      const old = deferred<AskFolio>()
      const fresh = deferred<AskFolio>()
      api.submit.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
      const { switchTo } = renderOwner(A)
      await user.type(box(), `${QUESTION}{Enter}`)
      await screen.findByTestId('askpanel-pending')
      switchTo(B)
      await user.type(box(), 'what arrives today?{Enter}')
      expect(await screen.findByTestId('askpanel-pending')).toHaveTextContent('Still answering “what arrives today?”')

      await act(async () => old.resolve(folio({ utterance: QUESTION, answer: TWELVE })))
      expect(screen.getByTestId('askpanel-pending')).toHaveTextContent('Still answering “what arrives today?”')
      expect(box()).toBeDisabled()

      await act(async () => fresh.resolve(folio({ id: 'f-2', utterance: 'what arrives today?', answer: TWELVE })))
      expect(await screen.findByTestId('askpanel-folio')).toHaveTextContent('what arrives today?')
      expect(screen.getAllByTestId('askpanel-folio')).toHaveLength(1)
    })

    it('"Check again" is not offered in the new house for the old house’s request id', async () => {
      const user = userEvent.setup()
      api.submit.mockRejectedValue(await timeoutError())
      const { switchTo } = renderOwner(A)
      await user.type(box(), `${QUESTION}{Enter}`)
      expect(await screen.findByRole('button', { name: /check again/i })).toBeInTheDocument()

      switchTo(B)
      expect(screen.queryByTestId('askpanel-failure')).toBeNull()
      expect(screen.queryByRole('button', { name: /check again/i })).toBeNull()
    })

    it('a failure from the old house that lands after the switch is not shown', async () => {
      const user = userEvent.setup()
      const old = deferred<AskFolio>()
      api.submit.mockReturnValue(old.promise)
      const { switchTo } = renderOwner(A)
      await user.type(box(), `${QUESTION}{Enter}`)
      await screen.findByTestId('askpanel-pending')
      switchTo(B)

      const timedOut = await timeoutError()
      await act(async () => old.reject(timedOut))
      expect(screen.queryByTestId('askpanel-failure')).toBeNull()
      expect(screen.queryByRole('button', { name: /check again/i })).toBeNull()
    })

    type Drafted = ReturnType<typeof deferred<Awaited<ReturnType<typeof proposeAction>>>>
    it.each([
      ['a proposal', (old: Drafted) => old.resolve({ proposed: true, proposal: reorder }), () => screen.queryByText(reorder.summary)],
      [
        'a refusal',
        (old: Drafted) => old.resolve({ proposed: false, reason: 'Could not resolve which vendor to order from.' }),
        () => screen.queryByTestId('askai-refusal'),
      ],
      ['an error', (old: Drafted) => old.reject(new Error('Network Error')), () => screen.queryByTestId('askai-error')],
    ] as const)('%s drafted in the old house does not land in the new one', async (_, land, shown) => {
      const user = userEvent.setup()
      const old = deferred<Awaited<ReturnType<typeof proposeAction>>>()
      api.propose.mockReturnValue(old.promise)
      const { switchTo } = renderOwner(A)
      await user.click(modeRadio(/propose an action/i))
      await user.type(screen.getByLabelText(/the action to propose/i), 'reorder the Barolo{Enter}')
      await screen.findByTestId('askpanel-pending')
      switchTo(B)
      await user.click(modeRadio(/propose an action/i))

      await act(async () => land(old))
      expect(shown()).toBeNull()
      expect(screen.getByLabelText(/the action to propose/i)).toBeEnabled()
    })

    it('a folio re-read from the old house that fails after the switch is not shown', async () => {
      const user = userEvent.setup()
      const reread = deferred<AskFolio>()
      api.submit.mockResolvedValue(folio({ utterance: QUESTION }))
      api.folio.mockReturnValue(reread.promise)
      const { switchTo } = renderOwner(A)
      await user.type(box(), `${QUESTION}{Enter}`)
      await user.click(await screen.findByRole('button', { name: /check again/i }))
      expect(box()).toBeDisabled()
      switchTo(B)
      expect(box()).toBeEnabled()

      const timedOut = await timeoutError()
      await act(async () => reread.reject(timedOut))
      expect(screen.queryByTestId('askpanel-failure')).toBeNull()
    })

    it('a new person on the same till starts it again too', async () => {
      const user = userEvent.setup()
      api.submit.mockResolvedValue(folio({ utterance: QUESTION, answer: TWELVE }))
      const { switchTo } = renderOwner(A)
      await user.type(box(), `${QUESTION}{Enter}`)
      await screen.findByTestId('askpanel-folio')

      switchTo({ userId: 'u-2', house: 'r-1' })
      expect(screen.queryByTestId('askpanel-folio')).toBeNull()
    })

    it('the first naming of the sitting keeps what was asked, as "the house said" does', async () => {
      const user = userEvent.setup()
      api.submit.mockResolvedValue(folio({ utterance: QUESTION, answer: TWELVE }))
      const { switchTo } = renderOwner(null)
      await user.type(box(), `${QUESTION}{Enter}`)
      await screen.findByTestId('askpanel-folio')

      switchTo(A)
      expect(screen.getByTestId('askpanel-folio')).toHaveTextContent('Twelve.')
    })

    it('with the panel open, the switch re-reads the new house’s waiting proposals', async () => {
      api.list.mockResolvedValueOnce([reorder]).mockResolvedValueOnce([vendorDraft])
      const { switchTo } = renderOwner(A)
      await screen.findByText(reorder.summary)

      switchTo(B)
      expect(await screen.findByText(vendorDraft.summary)).toBeInTheDocument()
      expect(screen.queryByText(reorder.summary)).toBeNull()
      expect(api.list).toHaveBeenCalledTimes(2)
    })

    it('a switch made while the panel is closed leaves none of the old house’s proposals, even when the re-read fails', async () => {
      const user = userEvent.setup()
      api.list.mockResolvedValueOnce([reorder]).mockRejectedValue(new Error('The gateway did not answer.'))
      const { switchTo } = renderOwner(A)
      await screen.findByText(reorder.summary)
      await close(user)

      switchTo(B)
      reopen()
      await screen.findByTestId('askpanel-proposals-unread')
      expect(screen.queryByText(reorder.summary)).toBeNull()
    })

    it.each([
      ['refusal', () => api.propose.mockResolvedValue({ proposed: false, reason: 'Could not resolve which vendor to order from.' }), 'askai-refusal'],
      ['transport error', () => api.propose.mockRejectedValue(new Error('Network Error')), 'askai-error'],
    ] as const)('the proposer’s %s in the old house is not shown in the new one', async (_, answer, shown) => {
      const user = userEvent.setup()
      answer()
      const { switchTo } = renderOwner(A)
      await user.click(modeRadio(/propose an action/i))
      await user.type(screen.getByLabelText(/the action to propose/i), 'reorder the Barolo{Enter}')
      expect(await screen.findByTestId(shown)).toBeInTheDocument()

      switchTo(B)
      await user.click(modeRadio(/propose an action/i))
      expect(screen.queryByTestId(shown)).toBeNull()
    })

    it('switching back to the first house starts the session again too', async () => {
      const user = userEvent.setup()
      api.submit
        .mockResolvedValueOnce(folio({ id: 'f-a', utterance: 'in A', answer: TWELVE }))
        .mockResolvedValueOnce(folio({ id: 'f-b', utterance: 'in B', answer: TWELVE }))
      const { switchTo } = renderOwner(A)
      await user.type(box(), 'in A{Enter}')
      await screen.findByTestId('askpanel-folio')
      switchTo(B)
      expect(screen.queryByTestId('askpanel-folio')).toBeNull()
      await user.type(box(), 'in B{Enter}')
      expect(await screen.findByTestId('askpanel-folio')).toHaveTextContent('in B')

      switchTo(A)
      expect(screen.queryByTestId('askpanel-folio')).toBeNull()
    })

    it('a sitting named after it began still starts again on the next switch', async () => {
      const user = userEvent.setup()
      api.submit.mockResolvedValue(folio({ utterance: QUESTION, answer: TWELVE }))
      const { switchTo } = renderOwner(null)
      switchTo(A)
      await user.type(box(), `${QUESTION}{Enter}`)
      await screen.findByTestId('askpanel-folio')

      switchTo(B)
      expect(screen.queryByTestId('askpanel-folio')).toBeNull()
    })

    it('a follow-up does not carry into another house', () => {
      const { switchTo } = renderOwner(A)
      act(() => openAskAi({ followUp: { folioId: 'f-9', utterance: 'what arrived on Monday' } }))
      expect(screen.getByTestId('askpanel-followup')).toBeInTheDocument()

      switchTo(B)
      expect(screen.queryByTestId('askpanel-followup')).toBeNull()
    })

    it('the render in which the house changes is given no follow-up from the old one', () => {
      const passes: string[] = []
      function Probe() {
        const ask = useAskPanel()
        passes.push(`${ask.session.scope}|${ask.followUp?.folioId ?? '-'}`)
        return null
      }
      const at = (who: Who) => (
        <AuthContext.Provider value={{ activeRole: 'owner', activeRestaurantId: who.house, user: { userId: who.userId } } as never}>
          <Probe />
        </AuthContext.Provider>
      )
      const view = render(at(A))
      act(() => openAskAi({ followUp: { folioId: 'f-9', utterance: 'what arrived on Monday' } }))
      expect(passes.at(-1)).toBe('u-1@r-1|f-9')

      view.rerender(at(B))
      const underB = passes.filter((p) => p.startsWith('u-1@r-2|'))
      expect(underB.length).toBeGreaterThan(0)
      expect(new Set(underB)).toEqual(new Set(['u-1@r-2|-']))

      // and one carried in after the switch is the new house's own
      act(() => openAskAi({ followUp: { folioId: 'f-10', utterance: 'what is late?' } }))
      expect(passes.at(-1)).toBe('u-1@r-2|f-10')
    })
  })
})

describe('the session’s own gates', () => {
  it('refuses a second ask while one is in flight', async () => {
    const answer = deferred<AskFolio>()
    api.submit.mockReturnValue(answer.promise)
    const { result } = renderHook(() => useAskSession(null, true))
    let first!: Promise<boolean>
    let second!: Promise<boolean>
    act(() => {
      first = result.current.sendAsk({ requestId: 'r-1', utterance: 'how much house red is left?' })
      second = result.current.sendAsk({ requestId: 'r-2', utterance: 'how much house red is left?' })
    })
    expect(await second).toBe(false)
    await act(async () => answer.resolve(folio({})))
    expect(await first).toBe(true)
    expect(api.submit).toHaveBeenCalledTimes(1)
  })

  it('refuses a second draft while one is in flight', async () => {
    const drafted = deferred<Awaited<ReturnType<typeof proposeAction>>>()
    api.propose.mockReturnValue(drafted.promise)
    const { result } = renderHook(() => useAskSession(null, true))
    let first!: Promise<boolean>
    let second!: Promise<boolean>
    act(() => {
      first = result.current.sendPropose('reorder the Barolo', 'reorder the Barolo')
      second = result.current.sendPropose('reorder the Barolo', 'reorder the Barolo')
    })
    expect(await second).toBe(false)
    await act(async () => drafted.resolve({ proposed: true, proposal: reorder }))
    expect(await first).toBe(true)
    expect(api.propose).toHaveBeenCalledTimes(1)
  })

  it('keeps the request only while its failure offers "Check again"', async () => {
    const { AxiosError } = await import('axios')
    api.submit
      .mockRejectedValueOnce(new AxiosError('timeout of 60000ms exceeded', 'ECONNABORTED'))
      .mockRejectedValueOnce(new AxiosError('429', 'ERR_BAD_REQUEST', undefined, undefined, { status: 429, data: {} } as never))
    const { result } = renderHook(() => useAskSession(null, true))
    await act(() => result.current.sendAsk({ requestId: 'r-1', utterance: 'how much house red is left?' }))
    expect(result.current.lastRequest?.requestId).toBe('r-1')
    await act(() => result.current.sendAsk({ requestId: 'r-2', utterance: 'and the white?' }))
    expect(result.current.failure?.kind).toBe('too_fast')
    expect(result.current.lastRequest).toBeNull()
  })

  it('lets go of the request once its answer is in', async () => {
    const { AxiosError } = await import('axios')
    api.submit.mockRejectedValueOnce(new AxiosError('timeout of 60000ms exceeded', 'ECONNABORTED')).mockResolvedValueOnce(folio({}))
    const { result } = renderHook(() => useAskSession(null, true))
    await act(() => result.current.sendAsk({ requestId: 'r-1', utterance: 'how much house red is left?' }))
    expect(result.current.lastRequest?.requestId).toBe('r-1')
    await act(() => result.current.sendAsk({ requestId: 'r-1', utterance: 'how much house red is left?' }))
    expect(result.current.failure).toBeNull()
    expect(result.current.lastRequest).toBeNull()
  })

  it('keeps the last five answers, newest first; the rest are in the book at /ask', async () => {
    const { result } = renderHook(() => useAskSession(null, true))
    for (const n of [1, 2, 3, 4, 5, 6]) {
      api.submit.mockResolvedValueOnce(folio({ id: `f-${n}`, utterance: `question ${n}` }))
      await act(() => result.current.sendAsk({ requestId: `r-${n}`, utterance: `question ${n}` }))
    }
    expect(result.current.folios.map((f) => f.id)).toEqual(['f-6', 'f-5', 'f-4', 'f-3', 'f-2'])
  })

  it('puts the newest proposal first', async () => {
    api.propose.mockResolvedValueOnce({ proposed: true, proposal: reorder }).mockResolvedValueOnce({ proposed: true, proposal: vendorDraft })
    const { result } = renderHook(() => useAskSession(null, true))
    await act(() => result.current.sendPropose('reorder the Barolo', 'reorder the Barolo'))
    await act(() => result.current.sendPropose('chase Acme', 'chase Acme'))
    expect(result.current.proposals.map((p) => p.actionId)).toEqual([vendorDraft.actionId, reorder.actionId])
  })

  it('does not re-read a folio while a question is in flight', async () => {
    const answer = deferred<AskFolio>()
    api.submit.mockReturnValue(answer.promise)
    const { result } = renderHook(() => useAskSession(null, true))
    let asking!: Promise<boolean>
    act(() => {
      asking = result.current.sendAsk({ requestId: 'r-1', utterance: 'how much house red is left?' })
    })
    await act(() => result.current.checkFolio(folio({})))
    expect(api.folio).not.toHaveBeenCalled()
    await act(async () => answer.resolve(folio({})))
    await asking
  })

  /** Every render pass of the hook, as `scope|answers|failure|request|refusal|error|proposals|pending`. */
  function renderPasses(initial: string | null) {
    const passes: string[] = []
    const on = (v: unknown) => (v ? 1 : 0)
    const view = renderHook(
      ({ scope }: { scope: string | null }) => {
        const s = useAskSession(scope, true)
        passes.push([s.scope, s.folios.length, on(s.failure), on(s.lastRequest), on(s.refusal), on(s.error), s.proposals.length, on(s.pending)].join('|'))
        return s
      },
      { initialProps: { scope: initial } },
    )
    return { passes, ...view }
  }

  // PR #584 gate, finding 2: the reset runs in an effect, after the render in
  // which the scope changed, and that render carried house A's sitting.
  it.each([
    ['refusal', () => api.propose.mockResolvedValueOnce({ proposed: false, reason: 'Could not resolve which vendor to order from.' }), '1|0'],
    ['transport error', () => api.propose.mockRejectedValueOnce(new Error('Network Error')), '0|1'],
  ] as const)('the render in which the scope changes is given none of the old sitting (with a %s)', async (_, proposer, refusalError) => {
    const { AxiosError } = await import('axios')
    const reread = deferred<AskFolio>()
    api.submit.mockResolvedValueOnce(folio({})).mockRejectedValueOnce(new AxiosError('timeout of 60000ms exceeded', 'ECONNABORTED'))
    api.folio.mockReturnValueOnce(reread.promise)
    proposer()
    const { passes, result, rerender } = renderPasses('u-1@r-1')
    await act(() => result.current.sendAsk({ requestId: 'r-1', utterance: 'how much house red is left?' }))
    await act(() => result.current.sendPropose('chase Acme', 'chase Acme'))
    act(() => result.current.setProposals([reorder]))
    await act(() => result.current.sendAsk({ requestId: 'r-2', utterance: 'and the white?' }))
    act(() => {
      void result.current.checkFolio(folio({}))
    })
    expect(passes.at(-1)).toBe(`u-1@r-1|1|1|1|${refusalError}|1|1`)

    rerender({ scope: 'u-1@r-2' })
    const underB = passes.filter((p) => p.startsWith('u-1@r-2|'))
    expect(underB.length).toBeGreaterThan(0)
    expect(new Set(underB)).toEqual(new Set(['u-1@r-2|0|0|0|0|0|0|0']))
    await act(async () => reread.resolve(folio({})))
  })

  it('the render that first names the sitting still shows what was asked', async () => {
    api.submit.mockResolvedValueOnce(folio({}))
    const { passes, result, rerender } = renderPasses(null)
    await act(() => result.current.sendAsk({ requestId: 'r-1', utterance: 'how much house red is left?' }))

    rerender({ scope: 'u-1@r-1' })
    const named = passes.filter((p) => p.startsWith('u-1@r-1|'))
    expect(named.length).toBeGreaterThan(0)
    expect(named.filter((p) => !p.startsWith('u-1@r-1|1|'))).toEqual([])
  })
})

describe('what the panel says while it works', () => {
  it('a folio re-read is busy but silent: no "Still answering" line', async () => {
    const user = userEvent.setup()
    const reread = deferred<AskFolio>()
    api.submit.mockResolvedValue(folio({ utterance: 'what arrives today?' }))
    api.folio.mockReturnValue(reread.promise)
    renderPanel()
    await user.type(screen.getByLabelText(/your question for the books/i), 'what arrives today?{Enter}')
    await user.click(await screen.findByRole('button', { name: /check again/i }))

    expect(screen.getByLabelText(/your question for the books/i)).toBeDisabled()
    expect(screen.queryByTestId('askpanel-pending')).toBeNull()
    await act(async () => reread.resolve(folio({ utterance: 'what arrives today?', answer: { kind: 'model_knowledge', sourceLabel: 'Not from the books', text: 'Two cases.' } as AskFolio['answer'] })))
    expect(await screen.findByTestId('askpanel-folio')).toHaveTextContent('Two cases.')
  })

  it('a new draft clears the last refusal the moment it starts', async () => {
    const user = userEvent.setup()
    const second = deferred<Awaited<ReturnType<typeof proposeAction>>>()
    api.propose.mockResolvedValueOnce({ proposed: false, reason: 'Could not resolve which vendor to order from.' }).mockReturnValueOnce(second.promise)
    renderPanel()
    await user.click(modeRadio(/propose an action/i))
    const input = screen.getByLabelText(/the action to propose/i)
    await user.type(input, 'reorder the Barolo{Enter}')
    expect(await screen.findByTestId('askai-refusal')).toBeInTheDocument()

    await user.type(input, ' from Acme{Enter}')
    expect(await screen.findByTestId('askpanel-pending')).toHaveAttribute('data-kind', 'propose')
    expect(screen.queryByTestId('askai-refusal')).toBeNull()
    await act(async () => second.resolve({ proposed: true, proposal: reorder }))
    expect(await screen.findByText(reorder.summary)).toBeInTheDocument()
  })

  it('a new draft clears the last transport error the moment it starts', async () => {
    const user = userEvent.setup()
    const second = deferred<Awaited<ReturnType<typeof proposeAction>>>()
    api.propose.mockRejectedValueOnce(new Error('Network Error')).mockReturnValueOnce(second.promise)
    renderPanel()
    await user.click(modeRadio(/propose an action/i))
    const input = screen.getByLabelText(/the action to propose/i)
    await user.type(input, 'reorder the Barolo{Enter}')
    expect(await screen.findByTestId('askai-error')).toBeInTheDocument()

    await user.type(input, ' from Acme{Enter}')
    expect(await screen.findByTestId('askpanel-pending')).toHaveAttribute('data-kind', 'propose')
    expect(screen.queryByTestId('askai-error')).toBeNull()
    await act(async () => second.resolve({ proposed: true, proposal: reorder }))
    expect(await screen.findByText(reorder.summary)).toBeInTheDocument()
  })

  it('a failed ask keeps the words typed and the follow-up carried in', async () => {
    const user = userEvent.setup()
    const { AxiosError } = await import('axios')
    api.submit.mockRejectedValue(new AxiosError('429', 'ERR_BAD_REQUEST', undefined, undefined, { status: 429, data: {} } as never))
    const onDropFollowUp = vi.fn()
    renderPanel({ followUp: { folioId: 'f-9', utterance: 'what arrived on Monday' }, onDropFollowUp })
    await user.type(screen.getByLabelText(/your question for the books/i), 'and on Tuesday?{Enter}')
    expect(await screen.findByTestId('askpanel-failure')).toHaveAttribute('data-kind', 'too_fast')

    expect(screen.getByLabelText(/your question for the books/i)).toHaveValue('and on Tuesday?')
    expect(onDropFollowUp).not.toHaveBeenCalled()
    expect(api.submit.mock.calls[0][0].previousFolioId).toBe('f-9')
  })
})

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
