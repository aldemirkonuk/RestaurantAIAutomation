/**
 * Editors for the Manager Shift Desk: add/edit a shift, add/edit a staff
 * member (manager can view & edit staff details from /team).
 */
import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { X, Trash2 } from 'lucide-react'
import {
  createShift, updateShift, deleteShift,
  createTeamMember, updateTeamMember, deleteTeamMember,
  type Shift, type TeamMember,
} from '../../../services/api/team'

const SHIFT_TYPES = ['am', 'pm', 'double', 'split', 'training', 'borrowed']
const EMP_TYPES = ['full_time', 'part_time', 'trial', 'borrowed']

import { createPortal } from 'react-dom'

function Overlay({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  const content = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-bold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-3">{children}</div>
      </div>
    </div>
  )
  
  if (typeof document !== 'undefined') {
    return createPortal(content, document.body)
  }
  return content
}

const inputCls = 'w-full h-9 px-3 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-wine-100 focus:border-wine-500 outline-none'
const labelCls = 'block text-xs font-semibold text-gray-600 mb-1'

export function ShiftEditor({
  shift, defaultDate, defaultMemberId, members, onClose,
}: {
  shift?: Shift | null
  defaultDate?: string
  defaultMemberId?: string
  members: TeamMember[]
  onClose: () => void
}) {
  const qc = useQueryClient()
  const editing = !!shift
  const [form, setForm] = useState({
    memberId: shift?.member_id ?? defaultMemberId ?? '',
    shiftDate: shift?.shift_date ?? defaultDate ?? new Date().toISOString().slice(0, 10),
    startTime: shift?.start_time ?? '17:00',
    endTime: shift?.end_time ?? '22:00',
    role: shift?.role ?? '',
    shiftType: shift?.shift_type ?? 'pm',
    note: shift?.note ?? '',
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['team', 'week'] })

  const save = useMutation({
    mutationFn: () => {
      const body = {
        memberId: form.memberId || undefined,
        shiftDate: form.shiftDate,
        startTime: form.startTime,
        endTime: form.endTime,
        role: form.role || undefined,
        shiftType: form.shiftType,
        note: form.note || undefined,
      }
      return editing ? updateShift(shift!.id, body) : createShift(body)
    },
    onSuccess: () => { toast.success(editing ? 'Shift updated' : 'Shift added'); invalidate(); onClose() },
    onError: () => toast.error('Could not save shift'),
  })
  const remove = useMutation({
    mutationFn: () => deleteShift(shift!.id),
    onSuccess: () => { toast.success('Shift removed'); invalidate(); onClose() },
    onError: () => toast.error('Could not remove the shift — it is still on the schedule'),
  })

  return (
    <Overlay title={editing ? 'Edit shift' : 'Add shift'} onClose={onClose}>
      <div>
        <label className={labelCls}>Team member (leave blank for an open shift)</label>
        <select value={form.memberId} onChange={(e) => setForm({ ...form, memberId: e.target.value })} className={inputCls}>
          <option value="">Open shift</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.display_name}{m.position ? ` · ${m.position}` : ''}</option>)}
        </select>
      </div>
      <div>
        <label className={labelCls}>Date</label>
        <input type="date" value={form.shiftDate} onChange={(e) => setForm({ ...form, shiftDate: e.target.value })} className={inputCls} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Start</label>
          <input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>End</label>
          <input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} className={inputCls} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Station / role</label>
          <input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="Floor 1, Main bar…" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Type</label>
          <select value={form.shiftType} onChange={(e) => setForm({ ...form, shiftType: e.target.value })} className={inputCls}>
            {SHIFT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className={labelCls}>Note</label>
        <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className={inputCls} />
      </div>
      <div className="flex items-center justify-between pt-2">
        {editing ? (
          <button onClick={() => remove.mutate()} className="inline-flex items-center gap-1.5 h-9 px-3 text-rose-600 text-sm font-semibold hover:bg-rose-50 rounded-lg">
            <Trash2 className="w-4 h-4" /> Delete
          </button>
        ) : <span />}
        <button onClick={() => save.mutate()} disabled={save.isPending} className="h-9 px-5 bg-wine-600 text-white rounded-lg text-sm font-bold hover:bg-wine-700">
          {editing ? 'Save' : 'Add shift'}
        </button>
      </div>
    </Overlay>
  )
}

export function MemberEditor({ member, wageVisible = true, ownerCount = 1, onClose }: { member?: TeamMember | null; wageVisible?: boolean; ownerCount?: number; onClose: () => void }) {
  const qc = useQueryClient()
  const editing = !!member
  const isSoleOwner = member?.role === 'owner' && ownerCount <= 1;
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [form, setForm] = useState({
    displayName: member?.display_name ?? '',
    email: member?.email ?? '',
    phone: member?.phone ?? '',
    position: member?.position ?? '',
    employmentType: member?.employment_type ?? 'full_time',
    homeLocation: member?.home_location ?? '',
    hourlyWage: member?.hourly_wage != null ? String(member.hourly_wage) : '',
    skills: (member?.skills ?? []).join(', '),
    status: member?.status ?? 'active',
    notes: member?.notes ?? '',
  })
  useEffect(() => {
    if (!member) {
      setForm({
        displayName: '', email: '', phone: '', position: '', employmentType: 'full_time',
        homeLocation: '', hourlyWage: '', skills: '', status: 'active', notes: '',
      })
      return
    }
    setForm({
      displayName: member.display_name ?? '',
      email: member.email ?? '',
      phone: member.phone ?? '',
      position: member.position ?? '',
      employmentType: member.employment_type ?? 'full_time',
      homeLocation: member.home_location ?? '',
      hourlyWage: member.hourly_wage != null ? String(member.hourly_wage) : '',
      skills: (member.skills ?? []).join(', '),
      status: member.status ?? 'active',
      notes: member.notes ?? '',
    })
  }, [member])

  const invalidate = () => qc.invalidateQueries({ queryKey: ['team'] })

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, any> = {
        displayName: form.displayName,
        email: form.email || undefined,
        phone: form.phone || undefined,
        position: form.position || undefined,
        employmentType: form.employmentType,
        homeLocation: form.homeLocation || undefined,
        hourlyWage: form.hourlyWage ? Number(form.hourlyWage) : undefined,
        skills: form.skills ? form.skills.split(',').map((s) => s.trim()).filter(Boolean) : [],
        notes: form.notes || undefined,
      }
      if (editing) body.status = form.status
      return editing ? updateTeamMember(member!.id, body) : createTeamMember(body as any)
    },
    onSuccess: () => { toast.success(editing ? 'Member updated' : 'Member added'); invalidate(); onClose() },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save member'),
  })
  const remove = useMutation({
    mutationFn: () => deleteTeamMember(member!.id),
    onSuccess: () => { toast.success('Member removed'); invalidate(); onClose() },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Could not remove the member — they are still on the roster'),
  })

  return (
    <Overlay title={editing ? `Edit ${member!.display_name}` : 'Add team member'} onClose={onClose}>
      <div>
        <label className={labelCls}>Name</label>
        <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} className={inputCls} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Email</label>
          <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="links account on signup" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Phone</label>
          <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Position</label>
          <input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} placeholder="Server, Sommelier…" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Employment</label>
          <select value={form.employmentType} onChange={(e) => setForm({ ...form, employmentType: e.target.value })} className={inputCls}>
            {EMP_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Home location</label>
          <input value={form.homeLocation} onChange={(e) => setForm({ ...form, homeLocation: e.target.value })} className={inputCls} />
        </div>
        {wageVisible && (
          <div>
            <label className={labelCls}>Hourly wage ($)</label>
            <input type="number" min={0} value={form.hourlyWage} onChange={(e) => setForm({ ...form, hourlyWage: e.target.value })} placeholder="private" className={inputCls} />
          </div>
        )}
      </div>
      <div>
        <label className={labelCls}>Skills / qualifications (comma-separated)</label>
        <input value={form.skills} onChange={(e) => setForm({ ...form, skills: e.target.value })} placeholder="bar_trained, somm_l3, closer" className={inputCls} />
      </div>
      {editing && (
        <div>
          <label className={labelCls}>Status</label>
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={inputCls}>
            <option value="active">Active</option>
            <option value="trial">Trial</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      )}
      <div>
        <label className={labelCls}>Notes</label>
        <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputCls} />
      </div>
      {showDeleteConfirm && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3.5 space-y-2">
          <p className="text-sm font-semibold text-gray-900">Are you sure you want to remove <span className="font-bold">{member?.display_name}</span>?</p>
          <p className="text-xs text-gray-500">This will permanently remove the member from your team. This cannot be undone.</p>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="h-8 px-3 text-xs font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              className="h-8 px-3 text-xs font-semibold text-white bg-wine-600 hover:bg-wine-700 rounded-lg transition-colors disabled:opacity-60"
            >
              {remove.isPending ? 'Removing…' : 'Yes, Remove'}
            </button>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between pt-2">
        {editing && !isSoleOwner ? (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="inline-flex items-center gap-1.5 h-9 px-3 text-rose-600 text-sm font-semibold hover:bg-rose-50 rounded-lg"
          >
            <Trash2 className="w-4 h-4" /> Remove
          </button>
        ) : <span />}
        <button onClick={() => save.mutate()} disabled={save.isPending || !form.displayName} className="h-9 px-5 bg-wine-600 text-white rounded-lg text-sm font-bold hover:bg-wine-700">
          {editing ? 'Save' : 'Add member'}
        </button>
      </div>
    </Overlay>
  )
}
