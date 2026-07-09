import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { CommsThreadDrawer } from '../CommsThreadDrawer'
import type { OrderConversationDto } from '../../../hooks/queries/useDraftEmailQueries'

vi.mock('../../../contexts/ToastContext', () => ({
  useToast: vi.fn(() => ({ showToast: vi.fn() })),
  ToastProvider: ({ children }: any) => <>{children}</>,
}))

vi.mock('../../../hooks/queries/useDraftEmailQueries', () => ({
  useOrderConversations: vi.fn(),
  useOrderAttachments: vi.fn(() => ({ data: [] })),
  useGenerateAiReply: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useManualReply: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useToggleAiPaused: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useCancelScheduledSend: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useRegenerateDraft: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDealProposal: vi.fn(() => ({ data: null, isLoading: false })),
  useConfirmDeal: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDismissDeal: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useForceFetchReplies: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  orderConversationKeys: { all: ['conversations'] },
  dealProposalKeys: { all: ['deals'] },
}))

import { useOrderConversations } from '../../../hooks/queries/useDraftEmailQueries'

function makeConv(overrides: Partial<OrderConversationDto> = {}): OrderConversationDto {
  return {
    id: 'conv-1',
    orderId: 'order-1',
    status: 'SENT',
    direction: 'OUTBOUND',
    emailType: 'PRICE_INQUIRY',
    roundCount: 1,
    createdAt: new Date().toISOString(),
    sentAt: new Date().toISOString(),
    draftContent: 'Dear Provider, we would like to order 6 bottles.',
    rollingSummary: null,
    orderNumber: 'ORD-001',
    quantity: 6,
    quotedPrice: 45,
    wineName: 'Chateau Margaux 2018',
    providerName: 'Bordeaux Suppliers',
    providerEmail: 'supplier@bordeaux.com',
    ...overrides,
  }
}

function renderDrawer(props?: Partial<React.ComponentProps<typeof CommsThreadDrawer>>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <CommsThreadDrawer
        orderId="order-1"
        orderWineName="Chateau Margaux 2018"
        orderStatus="pending_approval"
        isOpen={true}
        onClose={vi.fn()}
        onOpenDraftPanel={vi.fn()}
        {...props}
      />
    </QueryClientProvider>
  )
}

describe('CommsThreadDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a sent outbound email in the thread', async () => {
    vi.mocked(useOrderConversations).mockReturnValue({
      data: [makeConv()],
      isLoading: false,
    } as any)

    renderDrawer()

    await waitFor(() => {
      expect(screen.getByText('Sent')).toBeInTheDocument()
    })
    expect(screen.getByText('Round 1')).toBeInTheDocument()
  })

  it('shows provider reply (INBOUND) with distinct styling', async () => {
    const outbound = makeConv({ status: 'SENT', direction: 'OUTBOUND' })
    const inbound = makeConv({
      id: 'conv-2',
      status: 'SENT',
      direction: 'INBOUND',
      roundCount: 1,
      draftContent: 'Thank you for your inquiry. We can offer 6 bottles at $42 each.',
      providerName: 'Bordeaux Suppliers',
      providerEmail: 'supplier@bordeaux.com',
    })

    vi.mocked(useOrderConversations).mockReturnValue({
      data: [outbound, inbound],
      isLoading: false,
    } as any)

    renderDrawer()

    await waitFor(() => {
      expect(screen.getByText('Provider Reply')).toBeInTheDocument()
    })
    expect(screen.getByText(/from Bordeaux Suppliers/i)).toBeInTheDocument()
  })

  it('shows provider email address on inbound reply', async () => {
    // Use a unique email not present in any other field
    vi.mocked(useOrderConversations).mockReturnValue({
      data: [
        makeConv({
          id: 'conv-inbound',
          direction: 'INBOUND',
          status: 'SENT',
          draftContent: 'We can offer the wine at $40/bottle.',
          providerName: 'Inbound Winery',
          providerEmail: 'unique-inbound@winery.test',
        }),
      ],
      isLoading: false,
    } as any)

    renderDrawer()

    await waitFor(() => {
      expect(screen.getByText('Provider Reply')).toBeInTheDocument()
    })
    // The email appears in footer area — there may be multiple matches if shown in header too
    const emailEls = screen.getAllByText(/unique-inbound@winery\.test/i)
    expect(emailEls.length).toBeGreaterThanOrEqual(1)
  })

  it('shows empty state when no conversations', () => {
    vi.mocked(useOrderConversations).mockReturnValue({
      data: [],
      isLoading: false,
    } as any)

    renderDrawer()

    expect(screen.getByText('No email activity yet')).toBeInTheDocument()
  })

  it('shows loading state', () => {
    vi.mocked(useOrderConversations).mockReturnValue({
      data: [],
      isLoading: true,
    } as any)

    renderDrawer()

    // Spinner should be present
    expect(document.querySelector('.animate-spin')).toBeTruthy()
  })

  it('shows Review & Approve Draft CTA when PENDING_APPROVAL outbound exists', async () => {
    vi.mocked(useOrderConversations).mockReturnValue({
      data: [makeConv({ status: 'PENDING_APPROVAL', direction: 'OUTBOUND' })],
      isLoading: false,
    } as any)

    renderDrawer()

    await waitFor(() => {
      expect(screen.getByText('Review & Approve Draft')).toBeInTheDocument()
    })
  })

  it('does NOT show Review & Approve CTA for inbound messages', async () => {
    vi.mocked(useOrderConversations).mockReturnValue({
      data: [makeConv({ status: 'PENDING_APPROVAL', direction: 'INBOUND' })],
      isLoading: false,
    } as any)

    renderDrawer()

    await waitFor(() => {
      expect(screen.queryByText('Review & Approve Draft')).not.toBeInTheDocument()
    })
  })

  it('renders multi-round thread with both outbound and inbound entries', async () => {
    vi.mocked(useOrderConversations).mockReturnValue({
      data: [
        makeConv({ id: 'c1', status: 'SENT', direction: 'OUTBOUND', roundCount: 1 }),
        makeConv({ id: 'c2', status: 'SENT', direction: 'INBOUND', roundCount: 1, draftContent: 'Reply from provider' }),
        makeConv({ id: 'c3', status: 'PENDING_APPROVAL', direction: 'OUTBOUND', roundCount: 2 }),
      ],
      isLoading: false,
    } as any)

    renderDrawer()

    await waitFor(() => {
      expect(screen.getByText('Provider Reply')).toBeInTheDocument()
      expect(screen.getByText('Review & Approve Draft')).toBeInTheDocument()
    })
    // Should show 3 rounds badge on Thread tab
    expect(screen.getByText('3')).toBeInTheDocument()
  })
})
