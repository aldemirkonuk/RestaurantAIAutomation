import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Mail, Globe, Shield, AlertCircle, Cookie, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { useUserPreferences } from '../../hooks/useUserPreferences'
import { trackGuidance } from '../../guidance/analytics'
import { cn } from '../../lib/utils'
import { ConsentDialog, type ConsentCopy } from './ConsentDialog'
import { GoogleLinkButton } from '../auth/GoogleLinkButton'
import { profileApi, type LinkedProviders } from '../../services/api/profile'

type ServiceId = 'email' | 'web' | 'privacy_analytics' | 'privacy_sharing'

interface ServiceRow {
  id: ServiceId
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  statusLabel: (enabled: boolean) => string
}

/**
 * Turning these on sends data somewhere it wasn't going before, so they need
 * informed consent rather than a silent toggle. Switching them back off is not
 * gated — withdrawing consent should always be the cheap direction.
 */
const CONSENT_COPY: Partial<Record<ServiceId, ConsentCopy>> = {
  privacy_analytics: {
    title: 'Turn on usage analytics?',
    summary:
      'Mudavym will report how you move through the app so we can find the screens that slow people down.',
    dataCategories: [
      'Which page you are on, by name',
      'Interaction events such as rage clicks and dead clicks',
      'Timings, like how long a page took to become usable',
      'A random session id that resets when you close the tab',
    ],
    exclusions: [
      'Anything you typed into a field',
      'Your wine list, pricing, or order contents',
      'Any advertising or cross-site tracking',
    ],
    acknowledgement:
      'I understand what is collected and that I can turn this off at any time.',
    confirmLabel: 'Turn on analytics',
  },
  privacy_sharing: {
    title: 'Allow data sharing with partners?',
    summary:
      'This lets Mudavym pass operational data to logistics and POS partners you connect. Nothing is shared until you connect a specific partner, and only with that partner.',
    dataCategories: [
      'Order and delivery details for the partner fulfilling them',
      'Product identifiers and quantities needed to match catalogs',
      'Your restaurant name and delivery address',
    ],
    exclusions: [
      'Your pricing, margins, and supplier costs',
      'Staff records and team performance data',
      'Any sale of your data, ever',
    ],
    acknowledgement:
      'I understand data will be shared with partners I connect, and that turning this off stops future sharing.',
    confirmLabel: 'Allow sharing',
  },
}

const SERVICES: ServiceRow[] = [
  {
    id: 'email',
    title: 'Email access',
    description:
      'Allow Mudavym to send operational email (invites, order digests) from your connected sender. Does not grant Wine Agent mailbox access.',
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
      'Anonymous usage signals that help improve Mudavym. Never includes your wine list contents.',
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

type ServicePrefs = Partial<Record<ServiceId, boolean>>

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
  const [linked, setLinked] = useState<LinkedProviders | null>(null)

  useEffect(() => {
    trackGuidance('services_visited', { source: 'settings' })
  }, [])

  useEffect(() => {
    setLocal((prev) => ({ ...prev, ...stored }))
  }, [preferences.servicePermissions])

  useEffect(() => {
    let cancelled = false
    profileApi
      .getLinkedProviders()
      .then((providers) => {
        if (!cancelled) setLinked(providers)
      })
      .catch(() => {
        if (!cancelled) setLinked({ google: false, microsoft: false })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const [pendingConsent, setPendingConsent] = useState<ServiceId | null>(null)

  const apply = (id: ServiceId, value: boolean) => {
    const next = { ...local, [id]: value }
    setLocal(next)
    updatePreferences({ servicePermissions: next })
    toast.success(`${SERVICES.find((s) => s.id === id)?.title} updated`)
  }

  const toggle = (id: ServiceId) => {
    const turningOn = !local[id]
    if (turningOn && CONSENT_COPY[id]) {
      setPendingConsent(id)
      return
    }
    apply(id, turningOn)
  }

  return (
    <div className="space-y-6" data-guidance="services-permissions">
      <div data-tour="services-intro">
        <h2 className="text-lg font-semibold text-gray-900">Services & permissions</h2>
        <p className="text-sm text-gray-500 mt-1 max-w-2xl">
          Control what Mudavym can access. These settings are optional and separate from
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
          const tourAttr =
            svc.id === 'email'
              ? 'services-email'
              : svc.id === 'web'
                ? 'services-web'
                : svc.id === 'privacy_analytics'
                  ? 'services-privacy'
                  : undefined
          return (
            <li
              key={svc.id}
              className="flex flex-col sm:flex-row sm:items-center gap-3 p-4"
              data-tour={tourAttr}
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

        {/* Cookies — informational (Mudavym sets no tracking cookies) */}
        <li className="flex flex-col sm:flex-row sm:items-center gap-3 p-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center flex-shrink-0">
              <Cookie className="w-4 h-4 text-gray-600" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">Cookies</p>
              <p className="text-sm text-gray-500 mt-0.5">
                Mudavym sets no tracking or advertising cookies. Your session lives in local
                storage and clears when you sign out.{' '}
                <Link to="/privacy" className="font-medium text-wine-600 hover:text-wine-700">
                  Privacy notice
                </Link>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className="text-xs font-medium px-2 py-1 rounded-full bg-green-50 text-green-700">
              None set
            </span>
          </div>
        </li>

        {/* Google Sign-in — account link status */}
        <li className="flex flex-col sm:flex-row sm:items-center gap-3 p-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center flex-shrink-0">
              <KeyRound className="w-4 h-4 text-gray-600" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">Google Sign-in</p>
              <p className="text-sm text-gray-500 mt-0.5">
                Sign in with Google for faster access. Grants email and name only — never Gmail
                or Drive. Drive access is a separate authorization under Integrations.
              </p>
            </div>
          </div>
          <div className="flex flex-col items-stretch sm:items-end gap-2 flex-shrink-0 min-w-[160px]">
            <span
              className={cn(
                'self-start sm:self-end text-xs font-medium px-2 py-1 rounded-full',
                linked?.google
                  ? 'bg-green-50 text-green-700'
                  : 'bg-gray-100 text-gray-500',
              )}
            >
              {linked == null ? 'Checking…' : linked.google ? 'Linked' : 'Not linked'}
            </span>
            {linked && (
              <GoogleLinkButton
                isLinked={linked.google}
                onLinked={() => setLinked((prev) => ({ ...(prev ?? { microsoft: false }), google: true }))}
                onError={(message) => toast.error(message)}
              />
            )}
          </div>
        </li>
      </ul>

      <ConsentDialog
        open={pendingConsent !== null}
        copy={pendingConsent ? CONSENT_COPY[pendingConsent] ?? null : null}
        onCancel={() => setPendingConsent(null)}
        onConfirm={() => {
          if (pendingConsent) apply(pendingConsent, true)
          setPendingConsent(null)
        }}
      />
    </div>
  )
}
