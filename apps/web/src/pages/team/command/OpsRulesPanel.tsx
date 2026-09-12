/**
 * Coverage rules + certification CRUD.
 * Coverage engine stays idle until templates exist; certs drive compliance lens.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Trash2, X, ShieldCheck, LayoutGrid } from 'lucide-react'
import { cn } from '../../../lib/utils'
import { useAuth } from '../../../contexts/AuthContext'
import {
  getCoverageTemplates,
  createCoverageTemplate,
  deleteCoverageTemplate,
  getCertifications,
  createCertification,
  updateCertification,
  deleteCertification,
  type TeamMember,
  type Certification,
} from '../../../services/api/team'
const DOW_JS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] // matches Date.getDay()
const inputCls = 'w-full h-9 px-3 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-wine-100 focus:border-wine-500 outline-none'
const labelCls = 'block text-xs font-semibold text-gray-600 mb-1'

type Tab = 'coverage' | 'certs'

export function OpsRulesPanel({
  members,
  onClose,
}: {
  members: TeamMember[]
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('coverage')
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="bg-white w-full max-w-lg h-full overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white z-10 flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-base font-bold text-gray-900">Ops rules</h3>
            <p className="text-[11px] text-gray-400 mt-0.5">Coverage templates wake the staffing engine. Certs drive compliance.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex gap-1 p-3 border-b border-gray-50">
          {([
            { id: 'coverage' as const, label: 'Coverage', icon: LayoutGrid },
            { id: 'certs' as const, label: 'Certifications', icon: ShieldCheck },
          ]).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-bold',
                tab === id ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-600 hover:bg-gray-100',
              )}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>
        {tab === 'coverage' ? <CoverageRules /> : <CertRules members={members} />}
      </div>
    </div>
  )
}

function CoverageRules() {
  const qc = useQueryClient()
  // Tenant-keyed like every other query on this page. Unkeyed, a branch switch
  // left the previous restaurant's rules on screen and a delete then fired with
  // the old tenant's id — a no-op server-side that still toasted "Rule removed".
  const { activeRestaurantId } = useAuth()
  const { data: templates = [] } = useQuery({
    queryKey: ['team', 'coverage-templates', activeRestaurantId],
    queryFn: () => getCoverageTemplates(),
    enabled: !!activeRestaurantId,
  })
  const [form, setForm] = useState({
    dayOfWeek: '' as string,
    shiftPeriod: 'pm' as 'am' | 'pm',
    role: '',
    minStaff: '1',
  })

  const create = useMutation({
    mutationFn: () =>
      createCoverageTemplate({
        dayOfWeek: form.dayOfWeek === '' ? undefined : Number(form.dayOfWeek),
        shiftPeriod: form.shiftPeriod,
        role: form.role.trim(),
        minStaff: Math.max(0, Number(form.minStaff) || 0),
      }),
    onSuccess: () => {
      toast.success('Coverage rule added')
      setForm({ dayOfWeek: '', shiftPeriod: 'pm', role: '', minStaff: '1' })
      qc.invalidateQueries({ queryKey: ['team', 'coverage-templates'] })
      qc.invalidateQueries({ queryKey: ['team', 'week'] })
      qc.invalidateQueries({ queryKey: ['team-next-coverage-rules'] })
      qc.invalidateQueries({ queryKey: ['team-next-week'] })
    },
    onError: () => toast.error('Could not add rule'),
  })
  const remove = useMutation({
    mutationFn: (id: string) => deleteCoverageTemplate(id),
    onSuccess: () => {
      toast.success('Rule removed')
      qc.invalidateQueries({ queryKey: ['team', 'coverage-templates'] })
      qc.invalidateQueries({ queryKey: ['team', 'week'] })
      qc.invalidateQueries({ queryKey: ['team-next-coverage-rules'] })
      qc.invalidateQueries({ queryKey: ['team-next-week'] })
    },
    onError: () => toast.error('Could not remove the rule — it is still in force'),
  })

  return (
    <div className="p-4 space-y-4">
      {templates.length === 0 && (
        <div className="rounded-xl border border-dashed border-amber-200 bg-amber-50/60 px-4 py-3 text-[11px] text-amber-800">
          No coverage rules yet — the staffing engine stays idle and gaps stay empty until you add min-staff rules per role/period.
        </div>
      )}

      <div className="rounded-xl border border-gray-100 p-3 space-y-2.5">
        <div className="text-[10px] font-extrabold uppercase tracking-wide text-gray-500">Add rule</div>
        <div>
          <label className={labelCls}>Day</label>
          <select value={form.dayOfWeek} onChange={(e) => setForm({ ...form, dayOfWeek: e.target.value })} className={inputCls}>
            <option value="">Every day</option>
            {DOW_JS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>Period</label>
            <select value={form.shiftPeriod} onChange={(e) => setForm({ ...form, shiftPeriod: e.target.value as 'am' | 'pm' })} className={inputCls}>
              <option value="am">AM</option>
              <option value="pm">PM</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Min staff</label>
            <input type="number" min={0} value={form.minStaff} onChange={(e) => setForm({ ...form, minStaff: e.target.value })} className={inputCls} />
          </div>
        </div>
        <div>
          <label className={labelCls}>Role</label>
          <input placeholder="e.g. Floor, Bar, Host" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={inputCls} />
        </div>
        <button
          disabled={!form.role.trim() || create.isPending}
          onClick={() => create.mutate()}
          className="w-full h-9 inline-flex items-center justify-center gap-1.5 rounded-lg bg-wine-600 text-white text-xs font-bold hover:bg-wine-700 disabled:opacity-50"
        >
          <Plus className="w-3.5 h-3.5" /> Add coverage rule
        </button>
      </div>

      <div className="space-y-2">
        {templates.map((t: any) => (
          <div key={t.id} className="flex items-center gap-3 rounded-xl border border-gray-100 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-gray-900 truncate">{t.role}</div>
              <div className="text-[11px] text-gray-400">
                {t.day_of_week == null ? 'Every day' : DOW_JS[t.day_of_week]} · {String(t.shift_period).toUpperCase()} · min {t.min_staff}
              </div>
            </div>
            <button onClick={() => remove.mutate(t.id)} className="p-1.5 text-gray-300 hover:text-rose-500" aria-label="Delete rule">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function CertRules({ members }: { members: TeamMember[] }) {
  const qc = useQueryClient()
  const { activeRestaurantId } = useAuth()
  const { data: certs = [] } = useQuery({
    queryKey: ['team', 'certs', activeRestaurantId],
    queryFn: () => getCertifications(),
    enabled: !!activeRestaurantId,
  })
  const membersById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])
  const [form, setForm] = useState({
    memberId: members[0]?.id ?? '',
    certType: '',
    issuedAt: '',
    expiresAt: '',
  })
  const [editing, setEditing] = useState<Certification | null>(null)

  const create = useMutation({
    mutationFn: () =>
      createCertification({
        memberId: form.memberId,
        certType: form.certType.trim(),
        issuedAt: form.issuedAt || undefined,
        expiresAt: form.expiresAt || undefined,
      }),
    onSuccess: () => {
      toast.success('Certification added')
      setForm({ ...form, certType: '', issuedAt: '', expiresAt: '' })
      qc.invalidateQueries({ queryKey: ['team', 'certs'] })
      qc.invalidateQueries({ queryKey: ['team-next-certs'] })
    },
    onError: () => toast.error('Could not add certification'),
  })
  const update = useMutation({
    mutationFn: () =>
      updateCertification(editing!.id, {
        certType: editing!.cert_type,
        issuedAt: editing!.issued_at || undefined,
        expiresAt: editing!.expires_at || undefined,
      }),
    onSuccess: () => {
      toast.success('Certification updated')
      setEditing(null)
      qc.invalidateQueries({ queryKey: ['team', 'certs'] })
    },
    onError: () => toast.error('Could not update certification'),
  })
  const remove = useMutation({
    mutationFn: (id: string) => deleteCertification(id),
    onSuccess: () => {
      toast.success('Certification removed')
      qc.invalidateQueries({ queryKey: ['team', 'certs'] })
      qc.invalidateQueries({ queryKey: ['team-next-certs'] })
    },
    onError: () => toast.error('Could not remove the certification — it is still on file'),
  })

  return (
    <div className="p-4 space-y-4">
      <div className="rounded-xl border border-gray-100 p-3 space-y-2.5">
        <div className="text-[10px] font-extrabold uppercase tracking-wide text-gray-500">Add certification</div>
        <div>
          <label className={labelCls}>Team member</label>
          <select value={form.memberId} onChange={(e) => setForm({ ...form, memberId: e.target.value })} className={inputCls}>
            {members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Type</label>
          <input placeholder="e.g. Alcohol service, Food handler" value={form.certType} onChange={(e) => setForm({ ...form, certType: e.target.value })} className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>Issued</label>
            <input type="date" value={form.issuedAt} onChange={(e) => setForm({ ...form, issuedAt: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Expires</label>
            <input type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} className={inputCls} />
          </div>
        </div>
        <button
          disabled={!form.memberId || !form.certType.trim() || create.isPending}
          onClick={() => create.mutate()}
          className="w-full h-9 inline-flex items-center justify-center gap-1.5 rounded-lg bg-wine-600 text-white text-xs font-bold hover:bg-wine-700 disabled:opacity-50"
        >
          <Plus className="w-3.5 h-3.5" /> Add certification
        </button>
      </div>

      <div className="space-y-2">
        {certs.length === 0 && (
          <div className="text-center text-xs text-gray-400 py-6">No certifications on file yet.</div>
        )}
        {certs.map((c) => {
          const m = membersById.get(c.member_id)
          const isEdit = editing?.id === c.id
          return (
            <div key={c.id} className="rounded-xl border border-gray-100 px-3 py-2.5">
              {isEdit ? (
                <div className="space-y-2">
                  <input value={editing.cert_type} onChange={(e) => setEditing({ ...editing, cert_type: e.target.value })} className={inputCls} />
                  <div className="grid grid-cols-2 gap-2">
                    <input type="date" value={editing.issued_at?.slice(0, 10) ?? ''} onChange={(e) => setEditing({ ...editing, issued_at: e.target.value || null })} className={inputCls} />
                    <input type="date" value={editing.expires_at?.slice(0, 10) ?? ''} onChange={(e) => setEditing({ ...editing, expires_at: e.target.value || null })} className={inputCls} />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => update.mutate()} className="h-8 px-3 rounded-lg bg-gray-900 text-white text-xs font-bold">Save</button>
                    <button onClick={() => setEditing(null)} className="h-8 px-3 rounded-lg border border-gray-200 text-xs font-bold text-gray-600">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-gray-900">{c.cert_type}</div>
                    <div className="text-[11px] text-gray-400">{m?.display_name ?? 'Unknown'} · {c.status}{c.expires_at ? ` · exp ${c.expires_at.slice(0, 10)}` : ''}</div>
                  </div>
                  <button onClick={() => setEditing(c)} className="text-[10px] font-bold text-gray-500 hover:text-wine-700">Edit</button>
                  <button onClick={() => remove.mutate(c.id)} className="p-1 text-gray-300 hover:text-rose-500" aria-label="Delete cert">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
