import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Copy, ExternalLink, Loader2, Mail, MonitorSmartphone, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { GoogleLinkButton } from '../auth/GoogleLinkButton'
import { InviteTeamDialog } from '../team/InviteTeamDialog'
import { getVendorEmail } from '../../services/api/menus'
import { getIcalToken } from '../../services/api/calendar'
import { profileApi, type LinkedProviders } from '../../services/api/profile'

interface OptionalTailProps {
  restaurantId: string
}

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
  const [icalUrl, setIcalUrl] = useState<string | null>(null)
  const [linked, setLinked] = useState<LinkedProviders | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)

  useEffect(() => {
    getVendorEmail()
      .then((r) => setVendorEmail(r.address))
      .catch(() => setVendorEmail(null))
    getIcalToken()
      .then((r) => setIcalUrl(`${window.location.origin}/api/v1/calendar/feed/${r.token}.ics`))
      .catch(() => setIcalUrl(null))
    profileApi
      .getLinkedProviders()
      .then(setLinked)
      .catch(() => setLinked(null))
  }, [])

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
                className="text-xs text-[#9E4249] hover:text-[#B85055] font-medium flex items-center gap-1"
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
          {icalUrl ? (
            <div className="flex items-center gap-2">
              <code className="text-xs bg-gray-50 border border-gray-100 rounded px-2 py-1 truncate flex-1">
                {icalUrl}
              </code>
              <button
                onClick={() => copy(icalUrl, 'Calendar feed URL')}
                className="text-xs text-[#9E4249] hover:text-[#B85055] font-medium flex items-center gap-1"
              >
                <Copy className="w-3 h-3" /> Copy
              </button>
            </div>
          ) : (
            <p className="text-xs text-gray-400">Loading your calendar feed link…</p>
          )}
          <p className="text-xs text-gray-400 mt-1">
            Add this URL in Google Calendar / Apple Calendar / Outlook as a subscribed calendar —
            no login required.
          </p>
        </OptionalRow>

        <OptionalRow icon={<MonitorSmartphone className="w-4 h-4 text-gray-500" />} title="Connect your POS">
          <button
            onClick={() => navigate('/settings?tab=pos')}
            className="text-xs text-[#9E4249] hover:text-[#B85055] font-medium"
          >
            Browse POS integrations →
          </button>
        </OptionalRow>

        <OptionalRow icon={<UserPlus className="w-4 h-4 text-gray-500" />} title="Invite your team">
          <button
            onClick={() => setInviteOpen(true)}
            className="text-xs text-[#9E4249] hover:text-[#B85055] font-medium"
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
