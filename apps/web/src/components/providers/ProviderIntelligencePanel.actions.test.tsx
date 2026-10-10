/**
 * F-568: the vendor sheet's Actions are held while one is on its way, and each
 * tap ends in a line saying what happened, including "already under way".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const triggerOutreach = vi.fn()
const triggerOnboarding = vi.fn()
vi.mock('../../services/api/provider-intelligence', () => ({
  triggerOutreach: (...a: unknown[]) => triggerOutreach(...a),
  triggerOnboarding: (...a: unknown[]) => triggerOnboarding(...a),
}))
vi.mock('./ProviderKnowledgePanel', () => ({ ProviderKnowledgePanel: () => null }))
vi.mock('./ProviderPromotionsPanel', () => ({ ProviderPromotionsPanel: () => null }))
vi.mock('./ProviderConversationMemory', () => ({ ProviderConversationMemory: () => null }))

import { ProviderIntelligencePanel } from './ProviderIntelligencePanel'

function mount() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ProviderIntelligencePanel providerId="p1" providerName="Vinum" />
    </QueryClientProvider>,
  )
}

describe('ProviderIntelligencePanel Actions (F-568)', () => {
  beforeEach(() => {
    triggerOutreach.mockReset()
    triggerOnboarding.mockReset()
  })

  it('holds every action while one is on its way, so a second tap sends nothing', async () => {
    let finish: (v: unknown) => void = () => {}
    triggerOutreach.mockReturnValue(new Promise((r) => (finish = r)))
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: 'Actions' }))
    await user.click(screen.getByRole('button', { name: 'Request Updated Pricing' }))

    const pricing = screen.getByRole('button', { name: 'Request Updated Pricing' })
    await waitFor(() => expect(pricing).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Start Onboarding Flow' })).toBeDisabled()
    await user.click(pricing)
    expect(triggerOutreach).toHaveBeenCalledTimes(1)

    finish({ success: true, alreadyOpen: false })
    expect(await screen.findByTestId('vendor-action-outcome')).toHaveTextContent('Pricing request started.')
  })

  it('says when the request was already under way', async () => {
    triggerOnboarding.mockResolvedValue({ success: true, alreadyOpen: true })
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: 'Actions' }))
    await user.click(screen.getByRole('button', { name: 'Start Onboarding Flow' }))
    expect(await screen.findByTestId('vendor-action-outcome')).toHaveTextContent(
      'Already under way with this vendor. Nothing new was started.',
    )
  })

  it('says a refusal in the gateway’s words', async () => {
    triggerOutreach.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 404'), {
        isAxiosError: true,
        request: {},
        response: { status: 404, data: { message: 'Provider not found' } },
      }),
    )
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: 'Actions' }))
    await user.click(screen.getByRole('button', { name: 'General Check-in' }))
    expect(await screen.findByTestId('vendor-action-outcome')).toHaveTextContent('Not started: Provider not found')
  })
})
