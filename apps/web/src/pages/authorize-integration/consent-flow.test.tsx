import { StrictMode } from 'react'
import { webcrypto } from 'node:crypto'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthContext } from '../../contexts/AuthContext'
import { integrationsApi } from '../../services/api/integrations'
import { consentFixture } from './__tests__/consent-fixture'
import { prepareConsentBrowser } from './consent-browser'
import CompleteIntegrationConsent from './CompleteIntegrationConsent'
import { IntegrationReturnNotice } from './IntegrationReturnNotice'
import AuthorizeIntegrationNext from './next/AuthorizeIntegrationNext'

vi.mock('../../services/api/integrations', () => ({ integrationsApi: {
  getConsent: vi.fn(), consentChallenge: vi.fn(), authorize: vi.fn(), completeConsent: vi.fn(), getConnections: vi.fn(),
} }))

const disclosure = consentFixture({
  id: 'gmail_send', label: 'Gmail — sending only', provider: 'google', providerLabel: 'Google',
  description: 'Sending a letter from your own account.', available: true, unavailableReason: null,
  scopes: [{ scope: 'gmail.send', label: 'Send a letter', reason: 'Only when you choose to send.' }],
  notRequested: ['Reading your mailbox'], mirrorsMail: false,
})

const auth = (house: string) => ({ user: { userId: 'person', restaurantId: house } }) as never
function consentPage(house = 'one') {
  return <AuthContext.Provider value={auth(house)}><MemoryRouter initialEntries={['/authorize/gmail_send?returnPath=/profile']}>
    <Routes><Route path="/authorize/:integrationId" element={<AuthorizeIntegrationNext />} /></Routes>
  </MemoryRouter></AuthContext.Provider>
}

describe('sealed consent presentation', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubGlobal('crypto', webcrypto); sessionStorage.clear()
    vi.mocked(integrationsApi.getConsent).mockResolvedValue(disclosure)
    vi.mocked(integrationsApi.consentChallenge).mockResolvedValue('one-use-token')
  })
  afterEach(() => vi.unstubAllGlobals())

  it('requests a challenge at arm, binds displayed words, and does not authorize on a tap', async () => {
    render(consentPage())
    const hold = await screen.findByRole('button', { name: /Hold to continue to Google/ })
    fireEvent.click(hold)
    expect(integrationsApi.consentChallenge).not.toHaveBeenCalled()
    fireEvent.keyDown(hold, { key: 'Enter' })
    await waitFor(() => expect(integrationsApi.consentChallenge).toHaveBeenCalledTimes(1))
    expect(integrationsApi.authorize).not.toHaveBeenCalled()
    expect(integrationsApi.consentChallenge).toHaveBeenCalledWith('gmail_send', expect.objectContaining({
      disclosureDigest: disclosure.digest, returnPath: '/profile', browserProofHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }))
    const binding = vi.mocked(integrationsApi.consentChallenge).mock.calls[0][1]
    expect(binding).not.toHaveProperty('scope')
    expect(binding).not.toHaveProperty('proof')
  })

  it('shows a refusal and never stamps success after an authorize conflict', async () => {
    vi.mocked(integrationsApi.authorize).mockRejectedValue(new Error('The permission words changed.'))
    render(consentPage())
    const hold = await screen.findByRole('button', { name: /Hold to continue to Google/ })
    fireEvent.keyDown(hold, { key: 'Enter' }); fireEvent.keyDown(hold, { key: 'Enter' })
    expect(await screen.findByText('The permission words changed.')).toBeInTheDocument()
    expect(screen.queryByText('Opening Google')).toBeNull()
    expect(sessionStorage.length).toBe(0)
    expect(integrationsApi.authorize).toHaveBeenCalledWith('gmail_send', expect.objectContaining({ challenge: 'one-use-token' }))
  })

  it('clears a held browser proof and the prior disclosure when the house changes', async () => {
    const view = render(consentPage())
    const hold = await screen.findByRole('button', { name: /Hold to continue to Google/ })
    fireEvent.keyDown(hold, { key: 'Enter' })
    await waitFor(() => expect(integrationsApi.consentChallenge).toHaveBeenCalledTimes(1))
    vi.mocked(integrationsApi.getConsent).mockImplementation(() => new Promise(() => {}))
    view.rerender(consentPage('two'))
    expect(screen.queryByRole('button', { name: /Hold to continue/ })).toBeNull()
    expect(sessionStorage.length).toBe(0)
    expect(integrationsApi.authorize).not.toHaveBeenCalled()
  })
})

describe('completion and return status', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('crypto', webcrypto); sessionStorage.clear() })
  afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState(null, '', '/') })

  it('does not exchange a URL pasted into a browser without the sealed proof', async () => {
    window.history.replaceState(null, '', '/authorize/complete#state=' + 's'.repeat(43) + '&request=33333333-3333-4333-8333-333333333333')
    render(<MemoryRouter><CompleteIntegrationConsent /></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent('This tab does not hold')
    expect(integrationsApi.completeConsent).not.toHaveBeenCalled()
  })

  it('deduplicates StrictMode completion and refuses a foreign return address', async () => {
    const request = await prepareConsentBrowser()
    const delivery = 'f'.repeat(64)
    window.history.replaceState(null, '', '/authorize/complete#state=' + 's'.repeat(43) + '&request=' + request.browserRequestId + '&delivery=' + delivery)
    vi.mocked(integrationsApi.completeConsent).mockResolvedValue('https://other.test/profile')
    render(<StrictMode><MemoryRouter><CompleteIntegrationConsent /></MemoryRouter></StrictMode>)
    expect(await screen.findByRole('alert')).toHaveTextContent('return address could not be verified')
    expect(integrationsApi.completeConsent).toHaveBeenCalledTimes(1)
    expect(integrationsApi.completeConsent).toHaveBeenCalledWith('s'.repeat(43), expect.stringMatching(/^[a-f0-9]{64}$/), delivery)
    expect(sessionStorage.length).toBe(0)
  })

  it('refuses to complete when the redirect carries no delivery secret', async () => {
    const request = await prepareConsentBrowser()
    window.history.replaceState(null, '', '/authorize/complete#state=' + 's'.repeat(43) + '&request=' + request.browserRequestId)
    render(<MemoryRouter><CompleteIntegrationConsent /></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent('This tab does not hold')
    expect(integrationsApi.completeConsent).not.toHaveBeenCalled()
  })

  it('does not believe a forged connected query parameter', async () => {
    vi.mocked(integrationsApi.getConnections).mockResolvedValue([])
    render(<MemoryRouter initialEntries={['/profile?integration_status=connected&integration=gmail_send']}><IntegrationReturnNotice /></MemoryRouter>)
    expect(await screen.findByText(/No active connection was found/)).toBeInTheDocument()
    expect(screen.queryByText(/connection is confirmed/)).toBeNull()
  })

  it('drops a confirmed status immediately when the active house changes', async () => {
    vi.mocked(integrationsApi.getConnections).mockResolvedValue([{ integrationId: 'gmail_send', connected: true }] as never)
    const content = (house: string) => <AuthContext.Provider value={auth(house)}><MemoryRouter initialEntries={['/profile?integration_status=connected&integration=gmail_send']}><IntegrationReturnNotice /></MemoryRouter></AuthContext.Provider>
    const view = render(content('one'))
    expect(await screen.findByText(/connection is confirmed/)).toBeInTheDocument()
    vi.mocked(integrationsApi.getConnections).mockRejectedValue(new Error('unreadable'))
    await act(async () => view.rerender(content('two')))
    expect(await screen.findByText(/current status is unknown/)).toBeInTheDocument()
    expect(screen.queryByText(/connection is confirmed/)).toBeNull()
  })
})
