import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion } from 'framer-motion'
import { AlertTriangle, Check, Copy, Mail, X } from 'lucide-react'
import { toast } from 'sonner'
import { format, addDays } from 'date-fns'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { studioJsonRequest, studioErrorMessage } from '../studioApi'

interface InviteDialogProps {
  open: boolean
  onClose: () => void
}

interface SendInviteResponse {
  sent?: boolean
  email?: string
  role?: string
  expires_at?: string
  /** Present only when the invite was minted but delivery failed — a recovery path. */
  invite_url?: string
  delivery_error?: string
}

/**
 * The invite is SENT, not handed back as a link (ADR 0021).
 *
 * OD-82 removed the old `${APP_URL}/studio/invite/${token}` link because the route did not
 * exist and `redeem_invite` required a studio role the invitee cannot hold. Both halves are
 * now fixed: the route exists, and redemption is bound to the invited email instead of a
 * pre-existing role. So the link is back — but it goes out by email from the gateway rather
 * than through this dialog, and the token never reaches this browser, which also means it
 * cannot be pasted into the wrong window.
 *
 * The one exception is a delivery failure: the invite row exists by then, so the server
 * returns the URL so the admin can still hand it over rather than orphaning the invite.
 */
export function InviteDialog({ open, onClose }: InviteDialogProps) {
  const [role, setRole] = useState<'certified_contributor' | 'developer' | 'review_admin'>('certified_contributor')
  const [targetEmail, setTargetEmail] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // The address is not a label — the server binds redemption to it (ADR 0021), so an invite
  // cannot be minted without one and a typo here means the invite is unredeemable.
  const emailIsValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(targetEmail.trim())

  const handleSend = async () => {
    setIsSending(true)
    setFallbackUrl(null)
    try {
      // Throws on any non-2xx, so a failed mint can never render as a sent invite.
      const data = await studioJsonRequest<SendInviteResponse>(
        '/api/v1/studio/invite',
        'POST',
        { role, target_email: targetEmail.trim() },
      )

      const recipient = data.email ?? targetEmail.trim()
      setSentTo(recipient)
      setExpiresAt(data.expires_at ?? null)

      if (data.sent === false) {
        // Minted but not delivered — show the link so the admin can still hand it over.
        setFallbackUrl(data.invite_url ?? null)
        toast.error('Invite created, but the email could not be sent.', {
          description: (data.delivery_error ?? '').slice(0, 160),
        })
      } else {
        toast.success(`Invite sent to ${recipient}`)
      }
    } catch (err) {
      toast.error('Invite failed', { description: studioErrorMessage(err).slice(0, 160) })
    } finally {
      setIsSending(false)
    }
  }

  const handleCopy = () => {
    if (!fallbackUrl) return
    navigator.clipboard.writeText(fallbackUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleClose = () => {
    setSentTo(null)
    setTargetEmail('')
    setRole('certified_contributor')
    setFallbackUrl(null)
    setCopied(false)
    onClose()
  }

  const expiryLabel = expiresAt
    ? format(new Date(expiresAt), 'MMM d, yyyy')
    : addDays(new Date(), 7).toDateString()

  return (
    <Dialog.Root open={open} onOpenChange={(open) => !open && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50"
          onClick={handleClose} />
        <Dialog.Content asChild>
          <motion.div
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl shadow-xl p-6 w-full max-w-md"
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          >
            <div className="flex items-center justify-between mb-4">
              <Dialog.Title className="text-lg font-semibold text-slate-900">
                {sentTo
                  ? fallbackUrl
                    ? 'Invite created — not sent'
                    : 'Invite sent'
                  : 'Invite a Certified Contributor'}
              </Dialog.Title>
              <button onClick={handleClose} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {!sentTo ? (
              <>
                <Dialog.Description className="text-sm text-slate-500 mb-5">
                  We'll email a single-use invite to the address below. It expires in 7 days
                  and can only be accepted by the account registered to that address.
                </Dialog.Description>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Email address</label>
                    <Input
                      type="email"
                      value={targetEmail}
                      onChange={(e) => setTargetEmail(e.target.value)}
                      placeholder="contributor@example.com"
                      required
                    />
                    <p className="text-xs text-slate-400 mt-1">
                      Must match an existing Mudavym account — the invite grants a studio role, it
                      does not create an account.
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value as typeof role)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-wine-500 focus:outline-none"
                    >
                      <option value="certified_contributor">Certified Contributor</option>
                      <option value="developer">Developer</option>
                      <option value="review_admin">Review Admin</option>
                    </select>
                  </div>
                  <p className="text-xs text-slate-400">Expiry: 7 days (standard)</p>
                </div>
                <div className="flex items-center justify-end gap-3 mt-6">
                  <Button variant="ghost" onClick={handleClose}>Cancel</Button>
                  <Button
                    onClick={handleSend}
                    disabled={isSending || !emailIsValid}
                    className="bg-wine-600 text-white hover:bg-wine-700"
                  >
                    <Mail className="w-4 h-4" />
                    {isSending ? 'Sending...' : 'Send invite'}
                  </Button>
                </div>
              </>
            ) : fallbackUrl ? (
              <>
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
                  <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-800">
                    The invite for <span className="font-medium">{sentTo}</span> was created, but
                    we couldn't email it. Send them this link yourself — it expires {expiryLabel}{' '}
                    and works once.
                  </p>
                </div>
                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 mb-4">
                  <span className="flex-1 text-sm font-mono text-slate-700 truncate">{fallbackUrl}</span>
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1 border border-slate-200 rounded-lg px-3 py-2 text-sm hover:bg-slate-100 transition-colors flex-shrink-0"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <div className="flex justify-end">
                  <Button onClick={handleClose}>Done</Button>
                </div>
              </>
            ) : (
              <>
                <div className="w-14 h-14 mb-5 bg-emerald-100 rounded-2xl flex items-center justify-center">
                  <Check className="w-7 h-7 text-emerald-600" />
                </div>
                <p className="text-sm text-slate-500 mb-6">
                  We emailed the invite to{' '}
                  <span className="font-medium text-slate-700">{sentTo}</span>. It expires{' '}
                  {expiryLabel} and can only be accepted from that account.
                </p>
                <div className="flex justify-end">
                  <Button onClick={handleClose}>Done</Button>
                </div>
              </>
            )}
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
