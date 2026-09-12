import { useEffect, useState } from 'react'
import { MoreHorizontal, UserX, Power, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { Badge } from '../../../components/ui/badge'
import { TrustProgress } from '../queue/TrustProgress'

export interface Contributor {
  id: string
  user_id: string
  role: string
  granted_at: string
  revoked_at: string | null
  consecutive_approved_overrides: number
  promotion_policy: 'queue' | 'auto_promote'
  auto_promote_earned_at: string | null
  email?: string
  name?: string
  scopes?: string[]
}

interface ContributorTableProps {
  contributors: Contributor[]
  onRevoke: (userId: string) => Promise<void>
  onToggleEnable: (userId: string, enabled: boolean) => Promise<void>
}

export function ContributorTable({ contributors, onRevoke, onToggleEnable }: ContributorTableProps) {
  const [loadingId, setLoadingId] = useState<string | null>(null)
  /** NEW-564: the ⋮ button had no handler and onRevoke was destructured unused. */
  const [menuFor, setMenuFor] = useState<string | null>(null)

  useEffect(() => {
    if (!menuFor) return
    const close = () => setMenuFor(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menuFor])

  /** NEW-565: revoke end-to-end, with a confirm step before the destructive call. */
  const handleRevoke = (c: Contributor) => {
    setMenuFor(null)
    toast(`Revoke ${c.email ?? c.user_id.slice(0, 8)}'s contributor access?`, {
      description: 'They lose submit and override rights immediately.',
      action: {
        label: 'Revoke',
        onClick: async () => {
          setLoadingId(c.user_id)
          try {
            // onRevoke throws on any non-2xx (StudioCertify → studioApi.ts), so this
            // success toast can only follow a revoke the server actually performed.
            await onRevoke(c.user_id)
            toast.success('Contributor revoked')
          } catch (err) {
            toast.error('Could not revoke this contributor', {
              description: err instanceof Error ? err.message.slice(0, 160) : undefined,
            })
          } finally {
            setLoadingId(null)
          }
        },
      },
      cancel: { label: 'Cancel', onClick: () => {} },
    })
  }

  const handleToggle = async (c: Contributor) => {
    const enable = !!c.revoked_at
    const label = enable ? 'Enable' : 'Disable'
    toast(`${label} ${c.email ?? c.user_id.slice(0, 8)}'s access?`, {
      action: {
        label: 'Confirm',
        onClick: async () => {
          setLoadingId(c.user_id)
          try {
            await onToggleEnable(c.user_id, enable)
            toast.success(enable ? 'Access enabled' : 'Access disabled')
          } catch (err) {
            // Previously there was no catch at all: a failed toggle produced an
            // unhandled rejection and the toggle silently sprang back on the next poll.
            toast.error(`Could not ${label.toLowerCase()} this contributor`, {
              description: err instanceof Error ? err.message.slice(0, 160) : undefined,
            })
          } finally {
            setLoadingId(null)
          }
        },
      },
      cancel: { label: 'Cancel', onClick: () => {} },
    })
  }

  if (contributors.length === 0) return null

  return (
    <div className="rounded-xl border border-slate-200 shadow-xs bg-white overflow-hidden">
      <table className="w-full border-collapse">
        <thead className="bg-[#F1F3F5]">
          <tr>
            {['Contributor', 'Trust Level', 'Dataset Scopes', 'Status', 'Joined', 'Actions'].map((col) => (
              <th key={col} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 text-left">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {contributors.map((c) => {
            const isActive = !c.revoked_at
            return (
              <tr key={c.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50 transition-colors">
                <td className="px-4 py-3 min-w-[240px]">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-full bg-wine-100 text-wine-600 text-sm font-semibold flex items-center justify-center flex-shrink-0">
                      {(c.name ?? c.email ?? 'U').slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-slate-900">{c.name ?? 'Unknown'}</div>
                      <div className="text-xs text-slate-400">{c.email ?? c.user_id.slice(0, 16)}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 min-w-[100px]">
                  {c.promotion_policy === 'auto_promote' ? (
                    <Badge variant="success" size="sm">Auto-promote</Badge>
                  ) : c.consecutive_approved_overrides > 0 ? (
                    <TrustProgress approved={c.consecutive_approved_overrides} threshold={5} />
                  ) : (
                    <Badge variant="secondary" size="sm">New</Badge>
                  )}
                </td>
                <td className="px-4 py-3 min-w-[200px]">
                  <div className="flex flex-wrap gap-1">
                    {(c.scopes ?? ['wine_library']).map((scope) => (
                      <Badge key={scope} variant="outline" size="sm">{scope}</Badge>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 min-w-[80px]">
                  <button
                    onClick={() => handleToggle(c)}
                    disabled={loadingId === c.user_id}
                    aria-label={`${isActive ? 'Disable' : 'Enable'} ${c.name ?? c.email}`}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-500 ${
                      isActive ? 'bg-emerald-600' : 'bg-slate-200'
                    }`}
                  >
                    <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                      isActive ? 'translate-x-5' : 'translate-x-1'
                    }`} />
                  </button>
                </td>
                <td className="px-4 py-3 min-w-[100px]">
                  <span className="text-xs text-slate-500">
                    {format(new Date(c.granted_at), 'MMM d, yyyy')}
                  </span>
                </td>
                <td className="px-4 py-3 w-[80px] relative">
                  <button
                    onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === c.user_id ? null : c.user_id) }}
                    disabled={loadingId === c.user_id}
                    className="text-slate-400 hover:text-slate-600 p-1 rounded disabled:opacity-40"
                    aria-label="Contributor actions"
                    aria-haspopup="menu"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                  {menuFor === c.user_id && (
                    <div
                      role="menu"
                      className="absolute right-2 top-10 z-30 w-48 bg-white border border-slate-200 rounded-xl shadow-xl p-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => { setMenuFor(null); handleToggle(c) }}
                        className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 rounded-lg"
                      >
                        <Power className="w-4 h-4 text-slate-400" />
                        {isActive ? 'Disable access' : 'Enable access'}
                      </button>
                      <button
                        onClick={() => {
                          navigator.clipboard?.writeText(c.email ?? c.user_id)
                          setMenuFor(null)
                        }}
                        className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 rounded-lg"
                      >
                        <Copy className="w-4 h-4 text-slate-400" />
                        Copy {c.email ? 'email' : 'user id'}
                      </button>
                      <button
                        onClick={() => handleRevoke(c)}
                        className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm text-rose-600 hover:bg-rose-50 rounded-lg"
                      >
                        <UserX className="w-4 h-4 text-rose-500" />
                        Revoke contributor
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
