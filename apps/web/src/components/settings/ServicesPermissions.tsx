import { useEffect, useState } from 'react'
import { Mail, Globe, Shield, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useUserPreferences } from '../../hooks/useUserPreferences'
import { trackGuidance } from '../../guidance/analytics'
import { cn } from '../../lib/utils'

interface ServiceRow {
  id: 'email' | 'web' | 'privacy_analytics' | 'privacy_sharing'
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  statusLabel: (enabled: boolean) => string
}

const SERVICES: ServiceRow[] = [
  {
    id: 'email',
    title: 'Email access',
    description:
      'Allow WineOps to send operational email (invites, order digests) from your connected sender. Does not grant Wine Agent mailbox access.',
    icon: Mail,
    statusLabel: (e) => (e ? 'Enabled' : 'Off'),
  },
  {
    id: 'web',
    title: 'Web / connected apps',
    description:
      'Browser and connected-site permissions used for calendar feeds and vendor links. Manage or revoke anytime.',
    icon: Globe,
    statusLabel: (e) => (e ? 'Allowed' : 'Restricted'),
  },
  {
    id: 'privacy_analytics',
    title: 'Product analytics',
    description:
      'Anonymous usage signals that help improve WineOps. Never includes your wine list contents.',
    icon: Shield,
    statusLabel: (e) => (e ? 'On' : 'Off'),
  },
  {
    id: 'privacy_sharing',
    title: 'Data sharing with partners',
    description:
      'Optional sharing with logistics or POS partners. Off by default — enable only when you connect a partner.',
    icon: Shield,
    statusLabel: (e) => (e ? 'Sharing' : 'Not sharing'),
  },
]

type ServicePrefs = Partial<Record<ServiceRow['id'], boolean>>

/**
 * Services & permissions — grant/revoke/status only.
 * No tours, checklist tasks, or Wine Agent marketing.
 */
export function ServicesPermissions() {
  const { preferences, updatePreferences } = useUserPreferences()
  const stored = (preferences.servicePermissions ?? {}) as ServicePrefs
  const [local, setLocal] = useState<ServicePrefs>({
    email: true,
    web: true,
    privacy_analytics: true,
    privacy_sharing: false,
    ...stored,
  })

  useEffect(() => {
    trackGuidance('services_visited', { source: 'settings' })
  }, [])

  useEffect(() => {
    setLocal((prev) => ({ ...prev, ...stored }))
  }, [preferences.servicePermissions])

  const toggle = (id: ServiceRow['id']) => {
    const next = { ...local, [id]: !local[id] }
    setLocal(next)
    updatePreferences({ servicePermissions: next })
    toast.success(`${SERVICES.find((s) => s.id === id)?.title} updated`)
  }

  return (
    <div className="space-y-6" data-guidance="services-permissions">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Services & permissions</h2>
        <p className="text-sm text-gray-500 mt-1 max-w-2xl">
          Control what WineOps can access. These settings are optional and separate from
          product tours. Wine Agent is a navigation shortcut for inventory & ordering help —
          it does not grant email access.
        </p>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex gap-3">
        <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-amber-900">
          Enabling a service here never starts a product tour. Manage learning tips from
          Learn & Help in the sidebar.
        </p>
      </div>

      <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
        {SERVICES.map((svc) => {
          const enabled = !!local[svc.id]
          const Icon = svc.icon
          return (
            <li
              key={svc.id}
              className="flex flex-col sm:flex-row sm:items-center gap-3 p-4"
            >
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4 h-4 text-gray-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{svc.title}</p>
                  <p className="text-sm text-gray-500 mt-0.5">{svc.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span
                  className={cn(
                    'text-xs font-medium px-2 py-1 rounded-full',
                    enabled
                      ? 'bg-green-50 text-green-700'
                      : 'bg-gray-100 text-gray-500',
                  )}
                >
                  {svc.statusLabel(enabled)}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  onClick={() => toggle(svc.id)}
                  className={cn(
                    'relative w-11 h-6 rounded-full transition-colors',
                    enabled ? 'bg-wine-600' : 'bg-gray-200',
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform',
                      enabled && 'translate-x-5',
                    )}
                  />
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
