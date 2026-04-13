import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion } from 'framer-motion'
import { Check, Copy, X } from 'lucide-react'
import { toast } from 'sonner'
import { format, addDays } from 'date-fns'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'

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

  const APP_URL = import.meta.env.VITE_APP_URL || window.location.origin
  // Token in path param, not query string (Pitfall 2 from RESEARCH.md — prevents server log and Referer header leakage)
  const inviteUrl = generatedToken ? `${APP_URL}/studio/invite/${generatedToken}` : ''

  const handleGenerate = async () => {
    setIsGenerating(true)
    try {
      const token = localStorage.getItem('accessToken')
      const resp = await fetch(`/api/v1/studio/invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ role, target_email: targetEmail || null }),
      })
      if (!resp.ok) throw new Error('Invite generation failed')
      const data = await resp.json()
      setGeneratedToken(data.token)
      setExpiresAt(data.expires_at)
    } catch {
      toast.error('Invite link generation failed. Please try again.')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(inviteUrl)
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
                {generatedToken ? 'Invite link generated' : 'Invite a Certified Contributor'}
              </Dialog.Title>
              <button onClick={handleClose} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {!generatedToken ? (
              <>
                <Dialog.Description className="text-sm text-slate-500 mb-5">
                  A single-use invite link will be generated. It expires in 7 days.
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
                  Share this link with the contributor. It expires{' '}
                  {expiresAt ? format(new Date(expiresAt), 'MMM d, yyyy') : addDays(new Date(), 7).toDateString()}.
                </p>
                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 mb-4">
                  <span className="flex-1 text-sm font-mono text-slate-700 truncate">{inviteUrl}</span>
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
            )}
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
