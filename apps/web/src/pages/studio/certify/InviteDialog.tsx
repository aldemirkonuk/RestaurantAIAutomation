import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion } from 'framer-motion'
import { AlertTriangle, Check, Copy, X } from 'lucide-react'
import { toast } from 'sonner'
import { format, addDays } from 'date-fns'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { studioJsonRequest, studioErrorMessage } from '../studioApi'

interface InviteDialogProps {
  open: boolean
  onClose: () => void
}

export function InviteDialog({ open, onClose }: InviteDialogProps) {
  const [role, setRole] = useState<'certified_contributor' | 'developer' | 'review_admin'>('certified_contributor')
  const [targetEmail, setTargetEmail] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedToken, setGeneratedToken] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // OD-82: this used to render `${APP_URL}/studio/invite/${token}` and offer it as a
  // shareable link. That URL has no route in App.tsx and no page behind it, and the
  // backend it would have called cannot work for its intended audience:
  // POST /api/v1/studio/invite/redeem is gated by
  // require_studio_role("developer", "certified_contributor", "review_admin")
  // (services/agent-orchestrator/api/studio_routes.py:517-521), so only someone who
  // already holds a studio role can redeem an invite that exists to grant one.
  // The dead link is removed rather than reimplemented; the token itself is real
  // (POST /studio/invite does insert into invite_tokens) so it is shown as a token.

  const handleGenerate = async () => {
    setIsGenerating(true)
    try {
      // Orchestrator, not the gateway — see studioApi.ts. Throws on any non-2xx.
      const data = await studioJsonRequest<{ token?: string; expires_at?: string }>(
        '/api/v1/studio/invite',
        'POST',
        { role, target_email: targetEmail || null },
      )
      setGeneratedToken(data.token ?? null)
      setExpiresAt(data.expires_at ?? null)
    } catch (err) {
      toast.error('Invite generation failed', { description: studioErrorMessage(err).slice(0, 160) })
    } finally {
      setIsGenerating(false)
    }
  }

  const handleCopy = () => {
    if (!generatedToken) return
    navigator.clipboard.writeText(generatedToken)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleClose = () => {
    setGeneratedToken(null)
    setTargetEmail('')
    setRole('certified_contributor')
    setCopied(false)
    onClose()
  }

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
                {generatedToken ? 'Invite token generated' : 'Invite a Certified Contributor'}
              </Dialog.Title>
              <button onClick={handleClose} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {!generatedToken ? (
              <>
                <Dialog.Description className="text-sm text-slate-500 mb-5">
                  A single-use invite token will be generated. It expires in 7 days.
                </Dialog.Description>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Email address</label>
                    <Input
                      type="email"
                      value={targetEmail}
                      onChange={(e) => setTargetEmail(e.target.value)}
                      placeholder="contributor@example.com"
                    />
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
                    onClick={handleGenerate}
                    disabled={isGenerating}
                    className="bg-wine-600 text-white hover:bg-wine-700"
                  >
                    {isGenerating ? 'Generating...' : 'Generate Invite Link'}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-slate-500 mb-4">
                  Single-use token, expires{' '}
                  {expiresAt ? format(new Date(expiresAt), 'MMM d, yyyy') : addDays(new Date(), 7).toDateString()}.
                </p>
                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 mb-3">
                  <span className="flex-1 text-sm font-mono text-slate-700 truncate">{generatedToken}</span>
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1 border border-slate-200 rounded-lg px-3 py-2 text-sm hover:bg-slate-100 transition-colors flex-shrink-0"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
                  <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800">
                    There is no self-service redemption yet. The redeem endpoint requires a
                    studio role the invitee does not have, so sending this to a new contributor
                    will not work — an existing developer or review admin has to grant the role.
                  </p>
                </div>
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
