import { StrictMode } from 'react'
import { webcrypto } from 'node:crypto'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthContext } from '../../contexts/AuthContext'
import { PageGate } from '../../components/mudavym/PageGate'
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

// Founder, batch 4, 2026-09-19, ADR 0144's "Still open" bullet 3: `/authorize`
// and `/authorize/complete` rendered on PublicShell, which "ignores the
// house's design flag and the ADR 0133 public-door switch." This is that
// regression, proven at the actual PAGE component (not just at AuthorizeShell
// in isolation, which AuthorizeShell.test.tsx already covers) -- so this
// stays proof the two are actually wired together.
//
// FAILING BEFORE THIS FIX: `CompleteIntegrationConsent.tsx` imported and
// rendered `PublicShell` directly, calling neither `useMudavymDesign` nor
// `usePublicDesign` anywhere -- the public-door switch had no effect on this
// page at all. Reverting this file's import back to `PublicShell` (undoing
// this change alone) reproduces that: the assertion below fails, because
// nothing on the page would then produce a `.mdv-auth-shell` marker
// regardless of the switch.
vi.mock('../../lib/mudavym/publicDesign', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/mudavym/publicDesign')>()
  return { ...actual, usePublicDesign: () => true }
})

describe('CompleteIntegrationConsent honours the ADR 0133 public-door switch (founder, batch 4, 2026-09-19)', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('crypto', webcrypto); sessionStorage.clear() })
  afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState(null, '', '/') })

  it('with the public-door switch ON and no house context, the page renders through the signed-in-capable frame, not always-PublicShell', async () => {
    render(<MemoryRouter><CompleteIntegrationConsent /></MemoryRouter>)
    // No hash carries a sealed proof, so this lands on the page's error
    // branch -- irrelevant to what is under test here, which is the SHELL
    // wrapping either branch, not which branch renders.
    expect(await screen.findByRole('alert')).toHaveTextContent('This tab does not hold')
    // `.mdv-auth-shell` only exists on AuthorizeShell's own ON path (see
    // AuthorizeShell.tsx) -- PublicShell's root never carries it. Before
    // this fix, this page rendered PublicShell unconditionally and this
    // assertion could never pass no matter how the switch was set.
    expect(document.querySelector('.mudavym')).toHaveClass('mdv-auth-shell')
  })
})

// Round 5, 2026-09-21 -- the regression the round-4 review found and this
// test is written to catch again. `AuthorizeIntegrationNext` used to pass
// `chrome="ambient"` to `AuthorizeShell` on the belief that `PageGate`
// (mounted here, exactly as `App.tsx` mounts it for the real route) already
// wraps this page in a working `HouseHeader`. It does not: `authorize_
// integration` is in `NO_CHROME` (`lib/mudavym/pageNames.ts`), so
// `HouseHeader` returns `null` for it (`HouseHeader.tsx`) -- the flag-on page
// had no frame at all: no wordmark, no skip link, no exit link.
//
// FAILING BEFORE THIS FIX: re-adding `chrome="ambient"` to
// `AuthorizeIntegrationNext`'s `<AuthorizeShell>` call reproduces it --
// both assertions below fail (zero level-1 headings, no link to /profile).
vi.mock('../../lib/mudavym/useMudavymDesign', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/mudavym/useMudavymDesign')>()
  return { ...actual, useMudavymDesign: () => true }
})

describe('AuthorizeIntegrationNext through PageGate, design flag ON (round-5 regression, KL must-fix 1)', () => {
  const houseAuth = {
    user: { userId: 'person', restaurantId: 'house-1', name: 'Jordan Rivera' },
    activeRestaurantId: 'house-1',
    availableRestaurants: [{ id: 'house-1', name: 'The Anchor', city: null, chain_id: null, chain_name: null }],
  } as never

  beforeEach(() => {
    vi.clearAllMocks(); vi.stubGlobal('crypto', webcrypto); sessionStorage.clear()
    vi.mocked(integrationsApi.getConsent).mockResolvedValue(disclosure)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('PageGate mounts a masthead and an exit link for this NO_CHROME page -- neither comes from HouseHeader', async () => {
    render(
      <AuthContext.Provider value={houseAuth}>
        <MemoryRouter initialEntries={['/authorize/gmail_send?returnPath=/profile']}>
          <Routes>
            <Route
              path="/authorize/:integrationId"
              element={<PageGate page="authorize_integration" legacy={<div />} next={<AuthorizeIntegrationNext />} />}
            />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    )
    await screen.findByRole('button', { name: /Hold to continue to Google/ })
    expect(screen.getAllByRole('heading', { level: 1 }).length).toBeGreaterThan(0)
    const links = screen.getAllByRole('link')
    expect(links.some((link) => link.getAttribute('href') === '/profile')).toBe(true)
  })
})
