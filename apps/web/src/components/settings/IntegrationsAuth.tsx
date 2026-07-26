/**
 * Excel + Google Drive connection controls shown inside Features → Integrations.
 * Auth status lives in user preferences until full OAuth popups are wired.
 */
import { useEffect, useState } from 'react'
import { FileSpreadsheet, HardDrive, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useUserPreferences } from '../../hooks/useUserPreferences'
import { cn } from '../../lib/utils'

type IntegrationId = 'excel' | 'google_drive'

type AuthState = Partial<
  Record<IntegrationId, { connected: boolean; account?: string }>
>

const INTEGRATIONS: {
  id: IntegrationId
  label: string
  description: string
  icon: typeof FileSpreadsheet
  provider: string
}[] = [
  {
    id: 'excel',
    label: 'Microsoft Excel',
    description: 'Export inventory and reports to Excel / OneDrive.',
    icon: FileSpreadsheet,
    provider: 'Microsoft',
  },
  {
    id: 'google_drive',
    label: 'Google Drive',
    description: 'Save exports and menu scans to Drive folders.',
    icon: HardDrive,
    provider: 'Google',
  },
]

export function IntegrationsAuth() {
  const { preferences, updatePreferences } = useUserPreferences()
  const stored = (preferences.integrationsAuth ?? {}) as AuthState
  const [auth, setAuth] = useState<AuthState>(stored)
  const [busy, setBusy] = useState<IntegrationId | null>(null)

  useEffect(() => {
    setAuth((prev) => ({ ...prev, ...stored }))
  }, [preferences.integrationsAuth])

  const connect = async (id: IntegrationId) => {
    setBusy(id)
    try {
      // Placeholder until OAuth popup → token handoff is wired (same pattern as linked accounts).
      const next: AuthState = {
        ...auth,
        [id]: {
          connected: true,
          account: id === 'excel' ? 'Excel / OneDrive' : 'Google Drive',
        },
      }
      setAuth(next)
      updatePreferences({ integrationsAuth: next })
      toast.success(
        `${INTEGRATIONS.find((i) => i.id === id)?.label} connected`,
        {
          description: 'Auth handshake will use your Microsoft / Google account when OAuth is enabled.',
        },
      )
    } finally {
      setBusy(null)
    }
  }

  const disconnect = (id: IntegrationId) => {
    const next: AuthState = { ...auth, [id]: { connected: false } }
    setAuth(next)
    updatePreferences({ integrationsAuth: next })
    toast.success(`${INTEGRATIONS.find((i) => i.id === id)?.label} disconnected`)
  }

  return (
    <div className="divide-y divide-gray-50 border-t border-gray-50">
      {INTEGRATIONS.map((item) => {
        const Icon = item.icon
        const connected = !!auth[item.id]?.connected
        return (
          <div
            key={item.id}
            className="px-6 py-3.5 flex items-center gap-4 hover:bg-gray-50/60 transition-colors"
          >
            <div
              className={cn(
                'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                connected ? 'bg-wine-50 text-wine-500' : 'bg-gray-50 text-gray-300',
              )}
            >
              <Icon className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800">{item.label}</p>
              <p className="text-xs text-gray-400 mt-0.5 truncate">{item.description}</p>
              {connected && auth[item.id]?.account ? (
                <p className="text-xs text-wine-600 mt-0.5 font-medium">
                  Connected · {auth[item.id]?.account}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              disabled={busy === item.id}
              onClick={() => void (connected ? disconnect(item.id) : connect(item.id))}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors shrink-0',
                connected
                  ? 'text-red-600 hover:bg-red-50 border border-red-100'
                  : 'text-wine-700 hover:bg-wine-50 border border-wine-100',
              )}
            >
              {busy === item.id ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : connected ? (
                'Disconnect'
              ) : (
                `Connect ${item.provider}`
              )}
            </button>
          </div>
        )
      })}
    </div>
  )
}
