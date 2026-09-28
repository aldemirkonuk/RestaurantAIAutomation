import { useContext, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AuthContext } from '../../contexts/AuthContext'
import { integrationsApi } from '../../services/api/integrations'

const REASONS: Record<string, string> = {
  denied: 'The provider returned a declined permission.',
  provider_error: 'The provider could not finish the permission.',
  missing_state: 'The return did not contain a permission reference.',
  invalid_state: 'The permission expired, was already used, or could not be verified.',
  invalid_callback: 'The provider return did not match this permission.',
  invalid_browser_origin: 'The original app address is no longer configured.',
  exchange_failed: 'The connection outcome could not be established. Check the connection below before starting again.',
}

/** Query parameters trigger a status read; they are not proof of a connection. */
export function IntegrationReturnNotice() {
  const [params, setParams] = useSearchParams()
  const status = params.get('integration_status')
  const integration = params.get('integration')
  const reason = params.get('integration_reason')
  const auth = useContext(AuthContext)
  const scope = `${auth?.user?.userId ?? ''}:${auth?.user?.restaurantId ?? ''}:${integration ?? ''}`
  const [result, setResult] = useState<{ scope: string; status: 'waiting' | 'connected' | 'absent' | 'error' }>({ scope: '', status: 'waiting' })
  const read = result.scope === scope ? result.status : 'waiting'
  useEffect(() => {
    let alive = true
    if (status !== 'connected' || !integration) return
    setResult({ scope, status: 'waiting' })
    integrationsApi.getConnections().then(rows => {
      if (alive) setResult({ scope, status: rows.some(row => row.integrationId === integration && row.connected) ? 'connected' : 'absent' })
    }).catch(() => { if (alive) setResult({ scope, status: 'error' }) })
    return () => { alive = false }
  }, [status, integration, scope])
  if (!status) return null
  const sentence = status === 'connected' && integration
    ? read === 'connected' ? 'The account’s current connection is confirmed in this house.'
      : read === 'absent' ? 'No active connection was found in this house. The return link alone does not confirm a connection.'
      : read === 'error' ? 'The connection could not be read, so its current status is unknown.'
      : 'Reading the account’s current connection…'
    : REASONS[reason ?? ''] ?? 'The provider flow returned without a confirmed connection.'
  return <div className="mdv-alert" role="status" style={{ marginBlock: 16 }}>
    <p>{sentence}</p>
    <button className="mdv-btn" onClick={() => {
      const next = new URLSearchParams(params)
      for (const key of ['integration_status', 'integration', 'integration_reason']) next.delete(key)
      setParams(next, { replace: true })
    }}>Dismiss</button>
  </div>
}
