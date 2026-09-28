import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DraftEmailApprovalPanel } from '../DraftEmailApprovalPanel'
vi.mock('@/hooks/queries/useDraftEmailQueries', () => ({ issueDraftSendChallenge: vi.fn().mockResolvedValue('draft-proof') }))

/** The gateway's `sendOrAsk` for a manager (founder, 2026-09-21: send or ask). */
const AS_MANAGER = {
  readable: true,
  maySend: true,
  mode: 'send' as const,
  basis: 'manager' as const,
  grant: null,
  sentence: null,
}

function makeDraft(overrides = {}) {
  return {
    conversationId: 'conv-abc',
    orderId: 'order-123',
    orderNumber: 'ORD-001',
    restaurantName: 'La Maison',
    wineName: 'Penfolds Grange 2019',
    quantity: 12,
    providerName: 'Aussie Wines Co.',
    providerEmail: 'orders@aussiewines.com',
    emailType: 'PRICE_INQUIRY' as const,
    draftContent: 'Dear Aussie Wines, we would like to order 12 bottles of Penfolds Grange 2019.',
    disclaimer: 'This email was drafted by Mudavym.',
    constraintWarnings: [],
    roundCount: 1,
    timestamp: new Date().toISOString(),
    ...overrides,
  }
}

describe('DraftEmailApprovalPanel', () => {
  const onApprove = vi.fn()
  const onDiscard = vi.fn()
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders with provider email in metadata', () => {
    render(
      <DraftEmailApprovalPanel
        isOpen={true}
        sendOrAsk={AS_MANAGER}
        draftData={makeDraft()}
        onApprove={onApprove}
        onDiscard={onDiscard}
        onClose={onClose}
      />
    )

    expect(screen.getByText('orders@aussiewines.com')).toBeInTheDocument()
    expect(screen.getByText('Penfolds Grange 2019')).toBeInTheDocument()
  })

  it('holds over the displayed body and passes its one-use challenge', async () => {
    render(
      <DraftEmailApprovalPanel
        isOpen={true}
        sendOrAsk={AS_MANAGER}
        draftData={makeDraft()}
        onApprove={onApprove}
        onDiscard={onDiscard}
        onClose={onClose}
      />
    )

    const sendBtn = screen.getByRole('button', { name: /send draft/i })
    fireEvent.keyDown(sendBtn, { key: 'Enter' })
    fireEvent.keyDown(sendBtn, { key: 'Enter' })
    await waitFor(() => expect(onApprove).toHaveBeenCalledOnce(), { timeout: 1500 })

    expect(onApprove).toHaveBeenCalledOnce()
    // Not dirty → undefined for content/notes; no CC → undefined for ccEmails
    expect(onApprove).toHaveBeenCalledWith(makeDraft().draftContent, undefined, undefined, 'draft-proof')
  })

  it('calls onApprove with edited content when Send Edited is clicked', async () => {
    const user = userEvent.setup()
    render(
      <DraftEmailApprovalPanel
        isOpen={true}
        sendOrAsk={AS_MANAGER}
        draftData={makeDraft()}
        onApprove={onApprove}
        onDiscard={onDiscard}
        onClose={onClose}
      />
    )

    // Toggle edit mode
    const editBtn = screen.getByRole('button', { name: /edit/i })
    await user.click(editBtn)

    // Edit the content
    const textarea = screen.getByRole('textbox', { name: /email body/i })
    await user.clear(textarea)
    await user.type(textarea, 'Custom edited email content for the provider.')

    // Send the edited draft
    const sendBtn = screen.getByRole('button', { name: /send edited/i })
    fireEvent.keyDown(sendBtn, { key: 'Enter' })
    fireEvent.keyDown(sendBtn, { key: 'Enter' })
    await waitFor(() => expect(onApprove).toHaveBeenCalledOnce(), { timeout: 1500 })

    expect(onApprove).toHaveBeenCalledOnce()
    expect(onApprove.mock.calls[0][0]).toContain('Custom edited email content')
  })

  it('calls onDiscard when Discard is clicked', async () => {
    const user = userEvent.setup()
    render(
      <DraftEmailApprovalPanel
        isOpen={true}
        sendOrAsk={AS_MANAGER}
        draftData={makeDraft()}
        onApprove={onApprove}
        onDiscard={onDiscard}
        onClose={onClose}
      />
    )

    const discardBtn = screen.getByRole('button', { name: /discard/i })
    await user.click(discardBtn)

    expect(onDiscard).toHaveBeenCalledOnce()
  })

  it('allows adding CC email addresses', async () => {
    const user = userEvent.setup()
    render(
      <DraftEmailApprovalPanel
        isOpen={true}
        sendOrAsk={AS_MANAGER}
        draftData={makeDraft()}
        onApprove={onApprove}
        onDiscard={onDiscard}
        onClose={onClose}
      />
    )

    // Placeholder is "Add email…"
    const ccInput = screen.getByPlaceholderText('Add email…')
    await user.type(ccInput, 'manager@restaurant.com')
    await user.keyboard('{Enter}')

    // CC pill should appear
    expect(screen.getByText('manager@restaurant.com')).toBeInTheDocument()

    // Approve with CC — ccEmails non-empty so passed as array
    const sendBtn = screen.getByRole('button', { name: /send draft/i })
    fireEvent.keyDown(sendBtn, { key: 'Enter' })
    fireEvent.keyDown(sendBtn, { key: 'Enter' })
    await waitFor(() => expect(onApprove).toHaveBeenCalledOnce(), { timeout: 1500 })

    expect(onApprove).toHaveBeenCalledWith(makeDraft().draftContent, undefined, ['manager@restaurant.com'], 'draft-proof')
  })

  it('rejects invalid CC email addresses', async () => {
    const user = userEvent.setup()
    render(
      <DraftEmailApprovalPanel
        isOpen={true}
        sendOrAsk={AS_MANAGER}
        draftData={makeDraft()}
        onApprove={onApprove}
        onDiscard={onDiscard}
        onClose={onClose}
      />
    )

    const ccInput = screen.getByPlaceholderText('Add email…')
    await user.type(ccInput, 'not-a-valid-email')
    await user.keyboard('{Enter}')

    // Invalid email should not be added as a pill
    expect(screen.queryByText('not-a-valid-email')).not.toBeInTheDocument()
  })

  it('renders nothing when panel is closed', () => {
    const { container } = render(
      <DraftEmailApprovalPanel
        isOpen={false}
        draftData={null}
        onApprove={onApprove}
        onDiscard={onDiscard}
        onClose={onClose}
      />
    )

    expect(container.firstChild).toBeNull()
  })

  it('shows disabled send button while submitting', () => {
    render(
      <DraftEmailApprovalPanel
        isOpen={true}
        sendOrAsk={AS_MANAGER}
        draftData={makeDraft()}
        onApprove={onApprove}
        onDiscard={onDiscard}
        onClose={onClose}
        isSubmitting={true}
      />
    )

    // Button label stays "Send Draft" but becomes disabled when isSubmitting=true
    const sendBtn = screen.getByRole('button', { name: /send draft/i })
    expect(sendBtn).toBeDisabled()
  })

  it('sends to the provider designated email from the draft metadata', () => {
    render(
      <DraftEmailApprovalPanel
        isOpen={true}
        sendOrAsk={AS_MANAGER}
        draftData={makeDraft({ providerEmail: 'specific@provider.com' })}
        onApprove={onApprove}
        onDiscard={onDiscard}
        onClose={onClose}
      />
    )

    // The designated email should be visible in the To field
    expect(screen.getByText('specific@provider.com')).toBeInTheDocument()
  })
})

describe('DraftEmailApprovalPanel — send or ask (founder, 2026-09-21)', () => {
  it('a staff member holds to ASK: onAsk gets the exact words and copies, no seal is minted, onApprove never runs', async () => {
    const onApprove = vi.fn()
    const onAsk = vi.fn().mockResolvedValue('Asked. Your version is saved exactly as you wrote it.')
    render(
      <DraftEmailApprovalPanel
        isOpen={true}
        sendOrAsk={{
          readable: true,
          maySend: false,
          mode: 'ask',
          basis: null,
          grant: null,
          sentence: 'Your hold will ask a manager to send it; your version is kept exactly as you wrote it.',
        }}
        draftData={makeDraft()}
        onApprove={onApprove}
        onDiscard={vi.fn()}
        onClose={vi.fn()}
        onAsk={onAsk}
      />
    )
    expect(screen.getByTestId('legacy-draft-standing')).toHaveTextContent(/Your hold will ask a manager/)
    const die = screen.getByRole('button', { name: /Hold to ask a manager to send it/ })
    fireEvent.keyDown(die, { key: 'Enter' })
    fireEvent.keyDown(die, { key: 'Enter' })
    await waitFor(() => expect(onAsk).toHaveBeenCalledOnce(), { timeout: 1500 })
    expect(onAsk).toHaveBeenCalledWith(makeDraft().draftContent, [])
    await waitFor(() => expect(screen.getByTestId('legacy-draft-asked')).toHaveTextContent(/saved exactly/))
    expect(onApprove).not.toHaveBeenCalled()
  })

  it('with no standing known yet, the hold stays disabled — the panel never guesses "send"', () => {
    render(
      <DraftEmailApprovalPanel
        isOpen={true}
        draftData={makeDraft()}
        onApprove={vi.fn()}
        onDiscard={vi.fn()}
        onClose={vi.fn()}
        standingLoading
      />
    )
    expect(screen.getByRole('button', { name: /send draft/i })).toBeDisabled()
    expect(screen.getByTestId('legacy-draft-standing')).toHaveTextContent(/Reading whether your hold sends/)
  })

  it('shows who asked, to the manager who will release it', () => {
    render(
      <DraftEmailApprovalPanel
        isOpen={true}
        sendOrAsk={AS_MANAGER}
        sendRequest={{ requestedBy: 'u-staff', requestedByName: 'Ayşe', requestedAt: '2026-09-21T11:00:00.000Z', current: true, ccEmails: [] }}
        draftData={makeDraft()}
        onApprove={vi.fn()}
        onDiscard={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByTestId('legacy-draft-standing')).toHaveTextContent(/Ayşe asked for this to be sent/)
  })
})
