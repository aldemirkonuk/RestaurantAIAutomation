import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Copy, ExternalLink, Loader2, Mail, MonitorSmartphone, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { GoogleLinkButton } from '../auth/GoogleLinkButton'
import { InviteTeamDialog } from '../team/InviteTeamDialog'
import { getVendorEmail } from '../../services/api/menus'
import { useMyCalendarLink } from '../calendar-link/useMyCalendarLink'
import { SHOWN_ONCE } from '../calendar-link/calendar-link-copy'
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
  // The reader's OWN calendar link (ADR 0111, review trail 2026-09-21: "they
  // can connect their own"). The hook READS on mount and never makes a link:
  // this panel mounts on its own the moment a menu import finishes, so a
  // create here would be a screen minting a credential nobody asked for.
  // Connecting is the button below, the same act /calendar and /settings ask
  // for, and the address is shown once, on the answer to that click.
  const cal = useMyCalendarLink()
  const [linked, setLinked] = useState<LinkedProviders | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)

  useEffect(() => {
    getVendorEmail()
      .then((r) => setVendorEmail(r.address))
      .catch(() => setVendorEmail(null))
    profileApi
      .getLinkedProviders()
      .then(setLinked)
      .catch(() => setLinked(null))
  }, [])

  // A refused or failed connect is said, and the row still offers the act.
  useEffect(() => {
    if (cal.actError) toast.error(`Your calendar was not connected — ${cal.actError}`)
  }, [cal.actError])

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

        <OptionalRow icon={<ExternalLink className="w-4 h-4 text-gray-500" />} title="Connect my calendar">
          {cal.justIssued ? (
            <>
              <div className="flex items-center gap-2">
                <code
                  data-secret="credential"
                  className="text-xs bg-gray-50 border border-gray-100 rounded px-2 py-1 truncate flex-1"
                >
                  {cal.justIssued.address}
                </code>
                <button
                  onClick={() => copy(cal.justIssued!.address, 'Calendar link')}
                  className="text-xs text-[#1A5E6B] hover:text-[#14515C] font-medium flex items-center gap-1"
                >
                  <Copy className="w-3 h-3" /> Copy
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Copy it now. {SHOWN_ONCE} Paste it into Google Calendar, Apple Calendar or Outlook
                as a subscribed calendar.
              </p>
            </>
          ) : cal.readError ? (
            <p className="text-xs text-red-700">
              Couldn&apos;t read your calendar link — {cal.readError}
            </p>
          ) : cal.loading || !cal.link ? (
            <p className="text-xs text-gray-400">Reading your calendar link…</p>
          ) : cal.link.connected ? (
            <>
              <p className="text-xs text-gray-600">Your calendar is connected. {SHOWN_ONCE}</p>
              <button
                onClick={() => navigate('/calendar?connect=1')}
                className="text-xs text-[#1A5E6B] hover:text-[#14515C] font-medium mt-1"
              >
                Manage my calendar link →
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-gray-600">{cal.link.scope}</p>
              <button
                onClick={() => void cal.connect()}
                disabled={cal.busy !== null}
                className="text-xs text-[#1A5E6B] hover:text-[#14515C] font-medium disabled:opacity-50 mt-1"
              >
                {cal.busy === 'connect' ? 'Connecting…' : 'Connect my calendar'}
              </button>
              <p className="text-xs text-gray-400 mt-1">
                Makes a link only you use. It needs no login, so treat it like a key. Nothing is
                made until you press the button.
              </p>
            </>
          )}
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
