import { useContext, useEffect, useRef, useState } from 'react'
import { AuthContext } from '../../contexts/AuthContext'
import { integrationsApi, type IntegrationConsentBinding, type IntegrationConsentDisclosure } from '../../services/api/integrations'
import { forgetConsentBrowser, prepareConsentBrowser } from './consent-browser'

function words(error: any) {
  return error?.response?.data?.message || error?.message || 'The permission could not be read. Try again.'
}

/** Both presentations use exactly one consent protocol. */
export function useIntegrationConsent(integrationId: string | undefined, returnPath: string) {
  const auth = useContext(AuthContext)
  const scope = `${auth?.user?.userId ?? ''}:${auth?.user?.restaurantId ?? ''}:${integrationId ?? ''}`
  const [snapshot, setSnapshot] = useState<{ scope: string; value: IntegrationConsentDisclosure } | null>(null)
  const disclosure = snapshot?.scope === scope ? snapshot.value : null
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [redirecting, setRedirecting] = useState(false)
  const [revision, setRevision] = useState(0)
  const binding = useRef<(IntegrationConsentBinding & { scope: string }) | null>(null)
  const currentScope = useRef(scope)
  currentScope.current = scope

  useEffect(() => {
    let alive = true
    if (binding.current) forgetConsentBrowser(binding.current.browserRequestId)
    setSnapshot(null); setError(null); setActionError(null); setRedirecting(false); binding.current = null
    if (!integrationId) { setError('This link does not name an integration.'); return }
    integrationsApi.getConsent(integrationId).then(result => { if (alive) setSnapshot({ scope, value: result }) })
      .catch(e => { if (alive) setError(words(e)) })
    return () => { alive = false }
  }, [scope, revision, integrationId])

  const challenge = async () => {
    setActionError(null)
    if (!disclosure?.integration.available) throw new Error('This permission is not available.')
    const capturedScope = scope
    if (binding.current) forgetConsentBrowser(binding.current.browserRequestId)
    const browser = await prepareConsentBrowser()
    const value = { ...browser, disclosureDigest: disclosure.digest, returnPath, scope: capturedScope }
    if (currentScope.current !== capturedScope) {
      forgetConsentBrowser(browser.browserRequestId)
      throw new Error('The active account or house changed. Read the permission again.')
    }
    binding.current = value
    const { scope: _scope, ...wire } = value
    try { return await integrationsApi.consentChallenge(disclosure.integration.id, wire) }
    catch (e) {
      forgetConsentBrowser(browser.browserRequestId); binding.current = null
      setActionError(words(e)); throw e
    }
  }

  const approve = async (token?: string | null) => {
    const value = binding.current
    if (!token || !value || value.scope !== currentScope.current || !disclosure || value.disclosureDigest !== disclosure.digest) {
      throw new Error('Read this permission and begin the hold again.')
    }
    setRedirecting(true); setActionError(null)
    try {
      const { scope: _scope, ...wire } = value
      const url = await integrationsApi.authorize(disclosure.integration.id, { ...wire, challenge: token })
      if (currentScope.current !== value.scope) throw new Error('The active account or house changed. Start again in the intended house.')
      window.location.assign(url)
    } catch (e) {
      forgetConsentBrowser(value.browserRequestId); binding.current = null
      setActionError(words(e)); setRedirecting(false); throw e
    }
  }

  return { disclosure, error, actionError, redirecting, challenge, approve, reload: () => setRevision(v => v + 1) }
}
