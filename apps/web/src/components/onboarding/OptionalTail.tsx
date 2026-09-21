import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Copy, ExternalLink, Loader2, Mail, MonitorSmartphone, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { GoogleLinkButton } from '../auth/GoogleLinkButton'
import { InviteTeamDialog } from '../team/InviteTeamDialog'
import { getVendorEmail } from '../../services/api/menus'
import { createIcalToken, getIcalToken } from '../../services/api/calendar'
import { getErrorMessage } from '../../services/api/client'
import { profileApi, type LinkedProviders } from '../../services/api/profile'

interface OptionalTailProps {
  restaurantId: string
}

/**
 * The calendar row's four honest states. `none` and `error` are different
 * sentences: a house with no link is offered one, a read that failed says it
 * failed — it is never rendered as "no link yet", and never as a spinner that
 * waits forever (the pre-2026-09-21 row did exactly that on any error).
 */
type IcalState =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'ready'; url: string }
  | { kind: 'error'; message: string }

const feedUrlFor = (token: string) =>
  `${window.location.origin}/api/v1/calendar/feed/${token}.ics`

function OptionalRow({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-xl border border-gray-100">
      <div className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 mb-1">{title}</p>
        {children}
      </div>
    </div>
  )
}

/**
 * Get-started steps 4-8, rendered as a single skippable "finish anytime"
 * panel rather than five forced full-screen steps (Sketch 050 Variant C).
 * Every row is independently useful and independently skippable.
 */
export function OptionalTail({ restaurantId }: OptionalTailProps) {
  const navigate = useNavigate()
  const [vendorEmail, setVendorEmail] = useState<string | null | undefined>(undefined)
  const [ical, setIcal] = useState<IcalState>({ kind: 'loading' })
  const [creatingIcal, setCreatingIcal] = useState(false)
  const [linked, setLinked] = useState<LinkedProviders | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)

  useEffect(() => {
    getVendorEmail()
      .then((r) => setVendorEmail(r.address))
      .catch(() => setVendorEmail(null))
    // READ only (ADR 0111 §5 bracket, 2026-09-21). This panel mounts on its
    // own the moment a menu import finishes, so a create here would be a
    // screen minting a permanent bearer credential nobody asked for — the
    // exact defect the bracket closes, moved from a GET to a POST. Creating
    // the link is the button below, the same explicit act /connections and
    // /settings ask for.
    getIcalToken()
      .then((r) => setIcal(r.token ? { kind: 'ready', url: feedUrlFor(r.token) } : { kind: 'none' }))
      .catch((e) => setIcal({ kind: 'error', message: getErrorMessage(e) }))
    profileApi
      .getLinkedProviders()
      .then(setLinked)
      .catch(() => setLinked(null))
  }, [])

  const createIcal = async () => {
    setCreatingIcal(true)
    try {
      const r = await createIcalToken()
      if (!r.token) throw new Error('the gateway answered without a link')
      setIcal({ kind: 'ready', url: feedUrlFor(r.token) })
    } catch (e) {
      // Refused (403 for anyone but a manager/owner) or failed: say so, and
      // leave the row offering the act again rather than pretending.
      toast.error(`No calendar link was created — ${getErrorMessage(e)}`)
    } finally {
      setCreatingIcal(false)
    }
  }

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${label} copied`)
    } catch {
      toast.error('Failed to copy')
    }
  }

  return (
    <div className="mt-8 pt-8 border-t border-gray-100">
      <p className="text-center text-sm text-gray-400 mb-4">Optional — finish anytime from Settings</p>
      <div className="space-y-3 max-w-lg mx-auto">
        <OptionalRow icon={<Mail className="w-4 h-4 text-gray-500" />} title="Get your vendor email address">
          {vendorEmail === undefined ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />
          ) : vendorEmail ? (
            <div className="flex items-center gap-2">
              <code className="text-xs bg-gray-50 border border-gray-100 rounded px-2 py-1 truncate flex-1">
                {vendorEmail}
              </code>
              <button
                onClick={() => copy(vendorEmail, 'Vendor email')}
                className="text-xs text-[#1A5E6B] hover:text-[#14515C] font-medium flex items-center gap-1"
              >
                <Copy className="w-3 h-3" /> Copy
              </button>
            </div>
          ) : (
            <p className="text-xs text-gray-400">
              Vendor email forwarding isn&apos;t set up on this deployment yet.
            </p>
          )}
        </OptionalRow>

        <OptionalRow icon={<UserPlus className="w-4 h-4 text-gray-500" />} title="Link Google account">
          <GoogleLinkButton
            isLinked={linked?.google ?? false}
            onLinked={() => {
              profileApi.getLinkedProviders().then(setLinked)
              toast.success('Google linked')
            }}
            onError={(message) => toast.error(message)}
          />
        </OptionalRow>

        <OptionalRow icon={<ExternalLink className="w-4 h-4 text-gray-500" />} title="Subscribe to your calendar">
          {ical.kind === 'ready' ? (
            <div className="flex items-center gap-2">
              <code
                data-secret="credential"
                className="text-xs bg-gray-50 border border-gray-100 rounded px-2 py-1 truncate flex-1"
              >
                {ical.url}
              </code>
              <button
                onClick={() => copy(ical.url, 'Calendar feed URL')}
                className="text-xs text-[#1A5E6B] hover:text-[#14515C] font-medium flex items-center gap-1"
              >
                <Copy className="w-3 h-3" /> Copy
              </button>
            </div>
          ) : ical.kind === 'none' ? (
            <button
              onClick={() => void createIcal()}
              disabled={creatingIcal}
              className="text-xs text-[#1A5E6B] hover:text-[#14515C] font-medium disabled:opacity-50"
            >
              {creatingIcal ? 'Creating…' : 'Create a calendar link'}
            </button>
          ) : ical.kind === 'error' ? (
            <p className="text-xs text-red-700">
              Couldn&apos;t read your calendar link — {ical.message}
            </p>
          ) : (
            <p className="text-xs text-gray-400">Loading your calendar feed link…</p>
          )}
          <p className="text-xs text-gray-400 mt-1">
            {ical.kind === 'none'
              ? 'Creates an address anyone holding it can subscribe to — no login required — so nothing is published until you ask.'
              : 'Add this URL in Google Calendar / Apple Calendar / Outlook as a subscribed calendar — no login required.'}
          </p>
        </OptionalRow>

        <OptionalRow icon={<MonitorSmartphone className="w-4 h-4 text-gray-500" />} title="Connect your POS">
          <button
            onClick={() => navigate('/settings?tab=pos')}
            className="text-xs text-[#1A5E6B] hover:text-[#14515C] font-medium"
          >
            Browse POS integrations →
          </button>
        </OptionalRow>

        <OptionalRow icon={<UserPlus className="w-4 h-4 text-gray-500" />} title="Invite your team">
          <button
            onClick={() => setInviteOpen(true)}
            className="text-xs text-[#1A5E6B] hover:text-[#14515C] font-medium"
          >
            Send an invite →
          </button>
        </OptionalRow>
      </div>

      <InviteTeamDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        restaurantId={restaurantId}
      />
    </div>
  )
}
