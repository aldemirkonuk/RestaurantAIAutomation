import { useState, useLayoutEffect, type RefObject } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion } from 'framer-motion'
import { Check, Copy, X, Users } from 'lucide-react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { Button } from '../ui/button'

interface InviteTeamDialogProps {
  open: boolean
  onClose: () => void
  restaurantId: string
  /** When set, the dialog is fixed below this element, right-aligned to it (e.g. Invite Member button). Otherwise centered in the viewport. */
  anchorRef?: RefObject<HTMLElement | null>
}

interface GeneratedInvite {
  code: string
  expiresAt: string
  inviteUrl: string
}

const MODAL_MAX_W = 448 // matches max-w-md

export function InviteTeamDialog({ open, onClose, restaurantId, anchorRef }: InviteTeamDialogProps) {
  const [targetEmail, setTargetEmail] = useState('')
  const [role, setRole] = useState<'manager' | 'staff'>('manager')
  const [isGenerating, setIsGenerating] = useState(false)
  const [invite, setInvite] = useState<GeneratedInvite | null>(null)
  const [copied, setCopied] = useState(false)
  const [anchorPos, setAnchorPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!open || !anchorRef?.current) {
      setAnchorPos(null)
      return
    }
    const update = () => {
      const el = anchorRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const top = r.bottom + 10
      // Right-align modal with the Invite button (same right edge)
      let left = r.right - MODAL_MAX_W
      left = Math.max(16, left)
      if (left + MODAL_MAX_W > window.innerWidth - 16) {
        left = Math.max(16, window.innerWidth - MODAL_MAX_W - 16)
      }
      setAnchorPos({ top, left })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, anchorRef])

  const API_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'

  const handleGenerate = async () => {
    setIsGenerating(true)
    try {
      const token = localStorage.getItem('accessToken')
      const resp = await fetch(`${API_URL}/api/v1/auth/invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          restaurantId,
          targetEmail: targetEmail || undefined,
          role,
        }),
      })
      if (!resp.ok) {
        const data = await resp.json()
        throw new Error(data.message || 'Failed to generate invite')
      }
      const data = await resp.json()
      setInvite({ code: data.code, expiresAt: data.expiresAt, inviteUrl: data.inviteUrl })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to generate invite. Please try again.'
      toast.error(message)
    } finally {
      setIsGenerating(false)
    }
  }

  // Copy-able invite URL per D-04: copies /register?invite=XXXXXXXX (not just the code)
  const handleCopy = () => {
    if (!invite) return
    navigator.clipboard.writeText(invite.inviteUrl)
    setCopied(true)
    toast.success('Invite URL copied to clipboard!')
    setTimeout(() => setCopied(false), 2000)
  }

  const handleClose = () => {
    setInvite(null)
    setTargetEmail('')
    setRole('manager')
    setCopied(false)
    onClose()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" onClick={handleClose} />
        <Dialog.Content asChild>
          <motion.div
            className={
              anchorPos
                ? 'fixed z-50 bg-white rounded-2xl shadow-xl p-6 w-full max-w-md max-h-[min(90vh,calc(100vh-5rem))] overflow-y-auto'
                : 'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl shadow-xl p-6 w-full max-w-md max-h-[min(90vh,calc(100vh-5rem))] overflow-y-auto'
            }
            style={anchorPos ? { top: anchorPos.top, left: anchorPos.left } : undefined}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          >
            <div className="flex items-center justify-between mb-4">
              <Dialog.Title className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Users className="w-5 h-5 text-wine-500" />
                {invite ? 'Invite link generated' : 'Invite a Team Member'}
              </Dialog.Title>
              <button type="button" onClick={handleClose} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {!invite ? (
              <>
                <Dialog.Description className="text-sm text-gray-500 mb-5">
                  Generate a single-use invite link that expires in 7 days. Share it with your new team member.
                </Dialog.Description>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email address (optional)</label>
                    <input
                      type="email"
                      value={targetEmail}
                      onChange={(e) => setTargetEmail(e.target.value)}
                      placeholder="colleague@restaurant.com"
                      className="block w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-wine-500 focus:outline-none"
                    />
                    <p className="text-xs text-gray-400 mt-1">Optional — for your own tracking. Anyone with the link can use it.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value as 'manager' | 'staff')}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-wine-500 focus:outline-none"
                    >
                      <option value="manager">Manager</option>
                      <option value="staff">Staff</option>
                    </select>
                    <p className="text-xs text-gray-400 mt-1">You can change their role later in Settings → Team.</p>
                  </div>
                  <p className="text-xs text-gray-400">Expires: 7 days from generation · Single-use</p>
                </div>
                <div className="flex items-center justify-end gap-3 mt-6">
                  <Button variant="ghost" onClick={handleClose}>Cancel</Button>
                  <Button onClick={handleGenerate} disabled={isGenerating} className="bg-wine-600 text-white hover:bg-wine-700">
                    {isGenerating ? 'Generating...' : 'Generate Invite Link'}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-500 mb-4">
                  Share this link with your team member. It expires{' '}
                  {format(new Date(invite.expiresAt), 'MMM d, yyyy')}.
                </p>

                {/* Invite code display */}
                <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-xl">
                  <p className="text-xs text-gray-400 mb-1">Invite Code</p>
                  <p className="text-2xl font-mono font-bold text-gray-900 tracking-widest">{invite.code}</p>
                </div>

                {/* Copy-able invite URL (D-04 mandate: /register?invite=XXXXXXXX) */}
                <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 mb-4">
                  <span className="flex-1 text-sm font-mono text-gray-700 truncate">{invite.inviteUrl}</span>
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1 border border-gray-200 rounded-lg px-3 py-2 text-sm hover:bg-gray-100 transition-colors flex-shrink-0"
                  >
                    {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>

                <p className="text-xs text-gray-400 mb-4">
                  The link above includes the invite code. Your team member can paste it directly into their browser.
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
