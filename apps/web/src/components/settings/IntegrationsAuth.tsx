/**
 * Excel + Google Drive connection controls shown inside Features → Integrations.
 *
 * Connecting routes through /authorize/:id so the user sees what they are
 * granting before being handed to the provider; the grant itself lives in
 * integration_oauth_connections server-side, not in user preferences.
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FileSpreadsheet, HardDrive, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  integrationsApi,
  type IntegrationCatalogEntry,
  type IntegrationConnection,
  type IntegrationId,
} from '../../services/api/integrations'
import { cn } from '../../lib/utils'

const ICONS: Record<IntegrationId, typeof FileSpreadsheet> = {
  excel: FileSpreadsheet,
  google_drive: HardDrive,
}

const CALLBACK_REASONS: Record<string, string> = {
  denied: 'You declined the request at the provider, so nothing was connected.',
  invalid_state: 'That authorization link expired. Start the connection again.',
  missing_state: 'That authorization link was incomplete. Start again.',
  invalid_callback: 'The provider sent back an unexpected response. Try again.',
  exchange_failed: "We couldn't complete the handshake with the provider. Try again.",
  unknown_integration: 'That integration is no longer available.',
}

export function IntegrationsAuth() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [catalog, setCatalog] = useState<IntegrationCatalogEntry[]>([])
  const [connections, setConnections] = useState<IntegrationConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<IntegrationId | null>(null)

  const load = useCallback(async () => {
    try {
      const [catalogData, connectionData] = await Promise.all([
        integrationsApi.getCatalog(),
        integrationsApi.getConnections(),
      ])
      setCatalog(catalogData)
      setConnections(connectionData)
    } catch {
      // Settings has many panels; a failed integrations fetch should degrade to
      // an empty list rather than take the whole page down with a toast storm.
      setCatalog([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // The OAuth callback redirects back here with its outcome in the query string.
  useEffect(() => {
    const status = searchParams.get('integration_status')
    if (!status) return

    const integration = searchParams.get('integration')
    const label =
      catalog.find((c) => c.id === integration)?.label ?? 'The integration'

    if (status === 'connected') {
      toast.success(`${label} connected`)
      void load()
    } else {
      const reason = searchParams.get('integration_reason') ?? ''
      toast.error(`${label} was not connected`, {
        description: CALLBACK_REASONS[reason] ?? undefined,
      })
    }

    const next = new URLSearchParams(searchParams)
    next.delete('integration_status')
    next.delete('integration')
    next.delete('integration_reason')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams, catalog, load])

  const disconnect = async (id: IntegrationId, label: string) => {
    setBusy(id)
    try {
      await integrationsApi.disconnect(id)
      toast.success(`${label} disconnected`)
      await load()
    } catch (e: any) {
      toast.error(`Could not disconnect ${label}`, {
        description: e?.response?.data?.message || e?.message,
      })
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 border-t border-gray-50 px-6 py-5 text-sm text-gray-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading integrations…
      </div>
    )
  }

  if (catalog.length === 0) {
    return (
      <div className="border-t border-gray-50 px-6 py-5 text-sm text-gray-400">
        Integrations are unavailable right now.
      </div>
    )
  }

  return (
    <div className="divide-y divide-gray-50 border-t border-gray-50">
      {catalog.map((item) => {
        const Icon = ICONS[item.id]
        const connection = connections.find((c) => c.integrationId === item.id)
        const connected = Boolean(connection?.connected)

        return (
          <div
            key={item.id}
            className="flex items-center gap-4 px-6 py-3.5 transition-colors hover:bg-gray-50/60"
          >
            <div
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                connected ? 'bg-wine-50 text-wine-500' : 'bg-gray-50 text-gray-300',
              )}
            >
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-800">{item.label}</p>
              <p className="mt-0.5 truncate text-xs text-gray-400">{item.description}</p>
              {connected ? (
                <p className="mt-0.5 text-xs font-medium text-wine-600">
                  Connected{connection?.account ? ` · ${connection.account}` : ''}
                </p>
              ) : !item.available ? (
                <p className="mt-0.5 text-xs text-gray-400">{item.unavailableReason}</p>
              ) : null}
            </div>
            <button
              type="button"
              disabled={busy === item.id || (!connected && !item.available)}
              onClick={() =>
                connected
                  ? void disconnect(item.id, item.label)
                  : // Integrations live in the "features" section of Settings.
                    navigate(
                      `/authorize/${item.id}?returnPath=${encodeURIComponent('/settings?tab=features')}`,
                    )
              }
              className={cn(
                'shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                connected
                  ? 'border border-red-100 text-red-600 hover:bg-red-50'
                  : 'border border-wine-100 text-wine-700 hover:bg-wine-50',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              {busy === item.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : connected ? (
                'Disconnect'
              ) : (
                `Authorize with ${item.providerLabel}`
              )}
            </button>
          </div>
        )
      })}
    </div>
  )
}
