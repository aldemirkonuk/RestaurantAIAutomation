import { useEffect, useRef, useState } from 'react'
import { PublicShell } from '../../components/mudavym/PublicShell'
import { integrationsApi } from '../../services/api/integrations'
import { forgetConsentBrowser, readConsentBrowser } from './consent-browser'

export default function CompleteIntegrationConsent() {
  const [error, setError] = useState<string | null>(null)
  const work = useRef<Promise<string> | null>(null)
  useEffect(() => {
    let alive = true
    const fragment = new URLSearchParams(window.location.hash.slice(1))
    const state = fragment.get('state') ?? ''
    const request = fragment.get('request') ?? ''
    const proof = readConsentBrowser(request)
    if (!proof || !/^[A-Za-z0-9_-]{43}$/.test(state)) {
      setError('This tab does not hold the permission you sealed, or it has expired. Return to Connections and start again.')
      return
    }
    // StrictMode's effect replay attaches to the same request. No automatic
    // retry of a consumed OAuth code or one-use browser state.
    work.current ??= integrationsApi.completeConsent(state, proof)
    work.current.then(destination => {
      if (!alive) return
      const url = new URL(destination, window.location.origin)
      if (url.origin !== window.location.origin) throw new Error('The return address could not be verified.')
      forgetConsentBrowser(request)
      window.location.replace(url.toString())
    }).catch(e => {
      if (!alive) return
      forgetConsentBrowser(request)
      setError(e?.response?.data?.message || e?.message || 'The connection outcome could not be established. Check Connections before starting again.')
    })
    return () => { alive = false }
  }, [])
  return <PublicShell title={error ? 'The permission did not finish' : 'Finishing your connection'} eyebrow="Returning from the provider" seal={false} homeHref="/profile">
    {error ? <p role="alert" className="mdv-alert">{error}</p> : <p role="status">Checking this tab’s permission and recording the provider’s answer…</p>}
    {error && <a className="mdv-link" href="/connections">Open Connections</a>}
  </PublicShell>
}
