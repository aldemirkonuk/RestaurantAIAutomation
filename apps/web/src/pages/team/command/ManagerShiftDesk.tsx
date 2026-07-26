/**
 * Manager Shift Desk — production port of sketch 038.
 * Service Pulse + quick actions + editable week grid with lenses + persistent
 * Manager Desk task rail + shift inspector + per-server performance.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Plus, Copy, Send, Megaphone, ChevronLeft, ChevronRight, UserPlus,
  Users, ClipboardCheck, AlertTriangle, CheckCircle2, Sparkles, SlidersHorizontal,
  Pencil, Trash2, MessageSquare, Printer,
} from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import { InviteTeamDialog } from '../../../components/team/InviteTeamDialog'
import { ExportMenu } from '../../../components/ui/ExportMenu'
import { exportTable, type TableExportColumn, type TableExportFormat } from '../../../lib/tableExport'
import { fetchCalendarEvents } from '../../../services/api/calendar'
import {
  getWeek, getTeamMembers, getCertifications, copyWeek, publishSchedule, createSchedule,
  reportCallout, offerCover, assignCover, broadcast, createShift, deleteShift,
  type WeekPayload, type Shift, type TeamMember, type Certification,
} from '../../../services/api/team'
import { cn } from '../../../lib/utils'
import {
  mondayOf, addDays, weekDays, DOW, dayNum, fmtWeekRange, fmtTime, shiftClass, shiftHours,
  Avatar, Pill, PulseCell, todayIso,
} from './bits'
import { ShiftEditor, MemberEditor } from './editors'
import { PerformancePanel } from './PerformancePanel'
import { OpsRulesPanel } from './OpsRulesPanel'

type Lens = 'coverage' | 'labor' | 'fairness' | 'compliance'
type DeskTab = 'all' | 'now' | 'publish' | 'people'

export function ManagerShiftDesk() {
  const { activeRestaurantId } = useAuth()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const inviteAnchor = useRef<HTMLButtonElement>(null)

  const [weekStart, setWeekStart] = useState(() => mondayOf())
  const [lens, setLens] = useState<Lens>('coverage')
  const [deskTab, setDeskTab] = useState<DeskTab>('all')
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [shiftEditor, setShiftEditor] = useState<{ shift?: Shift; date?: string; memberId?: string } | null>(null)
  const [memberEditor, setMemberEditor] = useState<{ member?: TeamMember | null } | null>(null)
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [opsOpen, setOpsOpen] = useState(false)
  /** NEW-521: right-click a shift chip. */
  const [shiftMenu, setShiftMenu] = useState<{ shift: Shift; x: number; y: number } | null>(null)

  // Honor publish deep-link: /team?week=YYYY-MM-DD
  useEffect(() => {
    const w = params.get('week')
    if (w && /^\d{4}-\d{2}-\d{2}$/.test(w)) setWeekStart(mondayOf(new Date(w + 'T12:00:00')))
  }, [params])

  const days = useMemo(() => weekDays(weekStart), [weekStart])

  const { data: week } = useQuery<WeekPayload>({
    queryKey: ['team', 'week', activeRestaurantId, weekStart],
    queryFn: () => getWeek(weekStart),
    enabled: !!activeRestaurantId,
  })
  const { data: members = [] } = useQuery<TeamMember[]>({
    queryKey: ['team', 'members', activeRestaurantId],
    queryFn: () => getTeamMembers(),
    enabled: !!activeRestaurantId,
  })
  const { data: certs = [] } = useQuery<Certification[]>({
    queryKey: ['team', 'certs', activeRestaurantId],
    queryFn: () => getCertifications(),
    enabled: !!activeRestaurantId,
  })
  const { data: calEvents = [] } = useQuery({
    queryKey: ['team', 'cal', activeRestaurantId, weekStart],
    queryFn: () => fetchCalendarEvents(activeRestaurantId!, { startDate: days[0], endDate: days[6] }),
    enabled: !!activeRestaurantId,
  })

  const shifts = week?.shifts ?? []
  const membersById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])
  const selectedShift = shifts.find((s) => s.id === selectedShiftId) ?? null
  const selectedMember = selectedShift?.member_id ? membersById.get(selectedShift.member_id) ?? null : null

  // Deep-link: ?shift= / ?member= / ?schedule= / ?people=1
  useEffect(() => {
    const sid = params.get('shift')
    if (sid && shifts.some((s) => s.id === sid)) setSelectedShiftId(sid)
    if (params.get('people') === '1') setPeopleOpen(true)
    const mid = params.get('member')
    if (mid) {
      const m = members.find((x) => x.id === mid)
      if (m) setMemberEditor({ member: m })
    }
    const scheduleId = params.get('schedule')
    if (scheduleId && week?.schedule?.id === scheduleId) {
      // Ensure we're on the published week; week query already keyed by weekStart
      // so just acknowledge context by selecting nothing extra.
    }
  }, [params, shifts, members, week?.schedule?.id])

  const weeklyHours = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of shifts) {
      if (!s.member_id) continue
      map.set(s.member_id, (map.get(s.member_id) ?? 0) + shiftHours(s))
    }
    return map
  }, [shifts])

  const receiptsSeen = week?.receipts.length ?? 0
  const staffCount = members.filter((m) => m.status === 'active').length
  const today = todayIso()
  const tonightShifts = useMemo(() => shifts.filter((s) => s.shift_date === today), [shifts, today])
  const tonightOpen = tonightShifts.filter((s) => s.state === 'open' || !s.member_id).length
  const tonightCov = week?.coverage.days.find((d) => d.date === today)
  const tonightGaps = tonightCov?.gaps.length ?? 0
  const weekendCloses = useMemo(() => {
    // Fairness: count Sat/Sun closes (end >= 22:00) per member this week.
    const map = new Map<string, number>()
    for (const s of shifts) {
      if (!s.member_id || s.state === 'callout') continue
      const dow = new Date(s.shift_date + 'T12:00:00').getDay()
      if (dow !== 0 && dow !== 6) continue
      const endH = Number(s.end_time.split(':')[0] || 0)
      if (endH < 22 && endH !== 0) continue
      map.set(s.member_id, (map.get(s.member_id) ?? 0) + 1)
    }
    return map
  }, [shifts])

  function shiftRiskFlags(s: Shift, memberId: string | null | undefined) {
    const hrs = memberId ? (weeklyHours.get(memberId) ?? 0) : 0
    const fair =
      hrs > 40 ||
      (memberId ? (weekendCloses.get(memberId) ?? 0) >= 2 : false)
    const longShift = shiftHours(s) >= 6
    const missingBreak = longShift && !(s.shift_breaks?.length)
    const certFlag = memberId
      ? certs.some((c) => c.member_id === memberId && (c.status === 'expiring' || c.status === 'expired'))
      : false
    const compliance = missingBreak || certFlag || s.state === 'callout'
    return { fair, compliance }
  }

  // ── Manager Desk tasks (generated from real data) ─────────────────────────
  const tasks = useMemo(() => {
    const list: Array<{ id: string; group: DeskTab; priority: 'urgent' | 'soon' | 'normal'; title: string; meta: string; shiftId?: string }> = []
    for (const s of shifts) {
      if (s.state === 'callout') continue // cover slot is a separate open shift
      if (s.state === 'open' || !s.member_id) {
        list.push({
          id: `open-${s.id}`, group: 'now', priority: 'urgent',
          title: `Cover ${s.role ?? 'shift'} on ${new Date(s.shift_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' })}`,
          meta: `${fmtTime(s.start_time)}–${fmtTime(s.end_time)} needs a qualified, available person.`,
          shiftId: s.id,
        })
      }
    }
    for (const ot of week?.labor.overtime ?? []) {
      const m = membersById.get(ot.memberId)
      list.push({ id: `ot-${ot.memberId}`, group: 'publish', priority: 'soon', title: `${m?.display_name ?? 'A member'} reaches ${ot.hours}h`, meta: 'Crosses 40h — review before publishing to control overtime.' })
    }
    for (const d of week?.coverage.days ?? []) {
      for (const g of d.gaps) {
        list.push({ id: `gap-${d.date}-${g.role}-${g.period}`, group: 'publish', priority: 'soon', title: `${g.role} short on ${new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' })}`, meta: `${g.staffed}/${g.required} staffed for ${g.period} service.` })
      }
    }
    if (week?.schedule?.status === 'published' && staffCount > receiptsSeen) {
      list.push({ id: 'receipts', group: 'publish', priority: 'normal', title: `${staffCount - receiptsSeen} haven’t opened the schedule`, meta: `${receiptsSeen} of ${staffCount} have seen the published week.` })
    }
    for (const c of certs) {
      if (c.status === 'expiring' || c.status === 'expired') {
        const m = membersById.get(c.member_id)
        list.push({ id: `cert-${c.id}`, group: 'people', priority: c.status === 'expired' ? 'urgent' : 'soon', title: `${m?.display_name ?? 'A member'}: ${c.cert_type} ${c.status}`, meta: c.expires_at ? `Expires ${c.expires_at}.` : 'Needs review.' })
      }
    }
    return list
  }, [shifts, week, certs, membersById, staffCount, receiptsSeen])

  const visibleTasks = tasks.filter((t) => deskTab === 'all' || t.group === deskTab)
  const laborEnabled = week?.labor.enabled ?? false

  // ── Mutations ──────────────────────────────────────────────────────────
  const invalidateWeek = () => qc.invalidateQueries({ queryKey: ['team', 'week'] })

  const doPublish = useMutation({
    mutationFn: async () => {
      let scheduleId = week?.schedule?.id
      if (!scheduleId) {
        const created = await createSchedule(weekStart)
        scheduleId = created.id
      }
      return publishSchedule(scheduleId)
    },
    onSuccess: () => { toast.success('Schedule published & team notified'); invalidateWeek() },
    onError: () => toast.error('Could not publish schedule'),
  })
  const doCopy = useMutation({
    mutationFn: () => copyWeek(addDays(weekStart, -7), weekStart),
    onSuccess: (r: any) => { toast.success(`Copied ${r?.copied ?? 0} shifts from last week`); invalidateWeek() },
    onError: () => toast.error('Could not copy last week'),
  })
  /** NEW-529: export the visible week in shared formats. */
  const exportWeek = async (format: TableExportFormat) => {
    const sorted = [...shifts].sort(
      (a, b) => a.shift_date.localeCompare(b.shift_date) || a.start_time.localeCompare(b.start_time),
    )
    const columns: TableExportColumn<(typeof shifts)[number]>[] = [
      { header: 'Date', value: (sh) => sh.shift_date },
      {
        header: 'Member',
        value: (sh) => (sh.member_id ? membersById.get(sh.member_id)?.display_name : '') ?? '',
      },
      {
        header: 'Position',
        value: (sh) => {
          const m = sh.member_id ? membersById.get(sh.member_id) : undefined
          return m?.position ?? m?.employment_type ?? ''
        },
      },
      { header: 'Start', value: (sh) => sh.start_time },
      { header: 'End', value: (sh) => sh.end_time },
      { header: 'Role', value: (sh) => sh.role ?? '' },
      { header: 'Type', value: (sh) => sh.shift_type ?? '' },
      { header: 'State', value: (sh) => sh.state ?? '' },
      { header: 'Labor cost', value: (sh) => sh.labor_cost ?? '' },
    ]
    try {
      await exportTable({
        format,
        rows: sorted,
        columns,
        filename: `schedule-${weekStart}`,
        title: `Schedule — week of ${weekStart}`,
      })
      toast.success(
        format === 'clipboard'
          ? `Copied ${sorted.length} shifts`
          : format === 'print'
            ? 'Opening print view'
            : `Exported ${sorted.length} shifts`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed')
    }
  }

  /** NEW-538: printable week sheet for the floor (own window so the desk UI isn't printed). */
  const printWeek = () => {
    const rows = [...shifts]
      .sort((a, b) => a.shift_date.localeCompare(b.shift_date) || a.start_time.localeCompare(b.start_time))
      .map((sh) => {
        const m = sh.member_id ? membersById.get(sh.member_id) : undefined
        return `<tr><td>${sh.shift_date}</td><td>${m?.display_name ?? ''}</td><td>${fmtTime(sh.start_time)}–${fmtTime(sh.end_time)}</td><td>${sh.role ?? sh.shift_type ?? ''}</td></tr>`
      })
      .join('')
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(`<!doctype html><html><head><title>Schedule ${weekStart}</title>
      <style>
        body{font-family:ui-sans-serif,system-ui,sans-serif;padding:24px;color:#111}
        h1{font-size:18px;margin:0 0 4px} p{color:#666;font-size:12px;margin:0 0 16px}
        table{width:100%;border-collapse:collapse;font-size:12px}
        th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e5e7eb}
        th{background:#f9fafb;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280}
      </style></head><body>
      <h1>Schedule — week of ${weekStart}</h1>
      <p>${shifts.length} shifts · generated ${new Date().toLocaleString()}</p>
      <table><thead><tr><th>Date</th><th>Member</th><th>Time</th><th>Role</th></tr></thead><tbody>${rows}</tbody></table>
      </body></html>`)
    w.document.close()
    w.print()
  }

  /** NEW-521: duplicate a shift onto the same member+day. */
  const doDuplicateShift = useMutation({
    mutationFn: (sh: Shift) => createShift({
      scheduleId: week?.schedule?.id,
      memberId: sh.member_id ?? undefined,
      shiftDate: sh.shift_date,
      startTime: sh.start_time,
      endTime: sh.end_time,
      role: sh.role,
      shiftType: sh.shift_type,
    }),
    onSuccess: () => { toast.success('Shift duplicated'); invalidateWeek() },
    onError: () => toast.error('Could not duplicate the shift'),
  })
  const doDeleteShift = useMutation({
    mutationFn: (shiftId: string) => deleteShift(shiftId),
    onSuccess: () => { toast.success('Shift deleted'); setSelectedShiftId(null); invalidateWeek() },
    onError: () => toast.error('Could not delete the shift'),
  })

  const doCallout = useMutation({
    mutationFn: (shiftId: string) => reportCallout(shiftId),
    onSuccess: () => { toast.success('Call-out reported — shift opened'); invalidateWeek() },
  })
  const doOffer = useMutation({
    mutationFn: (shiftId: string) => {
      const s = shifts.find((x) => x.id === shiftId)
      // Prefer same position / overlapping skills, then anyone active & free that day.
      const dayBusy = new Set(
        shifts.filter((x) => x.shift_date === s?.shift_date && x.member_id && x.state !== 'callout').map((x) => x.member_id!),
      )
      const scored = members
        .filter((m) => m.status === 'active' && m.id !== s?.member_id && !dayBusy.has(m.id))
        .map((m) => {
          let score = 0
          if (s?.role && m.position && m.position.toLowerCase().includes(s.role.toLowerCase().split(' ')[0])) score += 3
          if (s?.role && m.skills?.some((sk) => s.role!.toLowerCase().includes(sk.toLowerCase()))) score += 2
          if (m.accountLinked) score += 1
          return { m, score }
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((x) => x.m.id)
      return offerCover(shiftId, scored)
    },
    onSuccess: (r: any) => toast.success(`Offered to ${r?.offered ?? 0}, notified ${r?.notified ?? 0}`),
    onError: () => toast.error('Could not offer cover'),
  })
  const doAssign = useMutation({
    mutationFn: ({ shiftId, memberId }: { shiftId: string; memberId: string }) => assignCover(shiftId, memberId),
    onSuccess: () => { toast.success('Cover assigned'); invalidateWeek() },
  })
  const doBroadcast = useMutation({
    mutationFn: (message: string) => broadcast({ message, title: '📣 Message from your manager' }),
    onSuccess: (r: any) => {
      const parts = [`inbox`]
      if (r?.notified) parts.push(`${r.notified} push`)
      if (r?.emailed) parts.push(`${r.emailed} email`)
      if (r?.texted) parts.push(`${r.texted} SMS`)
      toast.success(`Broadcast sent (${parts.join(' · ')})`)
    },
    onError: () => toast.error('Could not send broadcast'),
  })

  const openInspector = (shiftId: string) => {
    setSelectedShiftId(shiftId)
    const next = new URLSearchParams(params)
    next.set('shift', shiftId)
    setParams(next, { replace: true })
  }

  const eventsByDay = useMemo(() => {
    const map = new Map<string, any[]>()
    for (const e of calEvents as any[]) {
      const d = (e.date ?? '').slice(0, 10)
      if (!map.has(d)) map.set(d, [])
      map.get(d)!.push(e)
    }
    return map
  }, [calEvents])

  const tonightEvents = eventsByDay.get(today) ?? []
  const tonightTasks = tasks.filter((t) => t.group === 'now' || (t.shiftId && tonightShifts.some((s) => s.id === t.shiftId))).length
  const tonightStaffed = tonightShifts.filter((s) => s.member_id && s.state !== 'callout').length
  const published = week?.schedule?.status === 'published'

  return (
    <div className="p-4 md:p-6 max-w-[1500px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Team</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {staffCount} active · <span className="tabular-nums">{fmtWeekRange(weekStart)}</span>
            {published ? <Pill tone="green">Published</Pill> : <span className="ml-2"><Pill tone="amber">Draft</Pill></span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setPeopleOpen(true)} className="inline-flex items-center gap-1.5 h-9 px-3 border border-gray-200 bg-white rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-50">
            <Users className="w-3.5 h-3.5" /> People
          </button>
          <button ref={inviteAnchor} onClick={() => setInviteOpen(true)} className="inline-flex items-center gap-1.5 h-9 px-4 bg-wine-600 hover:bg-wine-700 text-white rounded-lg text-xs font-bold shadow-sm">
            <UserPlus className="w-3.5 h-3.5" /> Invite member
          </button>
        </div>
      </div>

      {/* Service Pulse — tonight board */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 rounded-2xl border border-gray-100 bg-white overflow-hidden mb-3 shadow-sm">
        <div className="flex items-center gap-2.5 px-3.5 py-3 bg-gray-50 border-r border-gray-100 col-span-2 md:col-span-1">
          <div className="text-center min-w-[36px]">
            <div className="text-xl font-extrabold tabular-nums text-wine-700 leading-none">{dayNum(today)}</div>
            <div className="text-[9px] font-bold uppercase text-gray-400">
              {new Date(today + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-xs font-extrabold text-gray-900">Service pulse</div>
            <div className="text-[10px] text-gray-400">Tonight&apos;s board</div>
          </div>
        </div>
        <PulseCell
          label="Coverage gaps"
          value={tonightGaps}
          sub={tonightGaps ? 'Tonight' : 'Roles met'}
          tone={tonightGaps ? 'danger' : 'default'}
          onClick={() => setDeskTab('publish')}
        />
        <PulseCell
          label="Open covers"
          value={tonightOpen}
          sub={`${tonightStaffed} staffed`}
          tone={tonightOpen ? 'warn' : 'default'}
          onClick={() => setDeskTab('now')}
        />
        <PulseCell
          label="Events"
          value={tonightEvents.length}
          sub={tonightEvents[0]?.title ?? 'None on calendar'}
          tone={tonightEvents.length ? 'warn' : 'default'}
        />
        <PulseCell
          label={laborEnabled ? 'Tonight labor' : 'Tonight hours'}
          value={
            laborEnabled
              ? `$${Math.round(tonightShifts.reduce((sum, s) => sum + (s.labor_cost ?? 0), 0)).toLocaleString()}`
              : `${tonightShifts.reduce((sum, s) => sum + shiftHours(s), 0).toFixed(0)}h`
          }
          sub={`${tonightShifts.length} shifts`}
        />
        <PulseCell
          label="Desk actions"
          value={`${tonightTasks || tasks.filter((t) => t.priority === 'urgent').length} open`}
          sub="Needs you"
          tone={(tonightTasks || tasks.some((t) => t.priority === 'urgent')) ? 'danger' : 'default'}
          onClick={() => setDeskTab('all')}
        />
      </div>

      {/* Quick actions */}
      <div className="flex items-center gap-2 flex-wrap mb-3 overflow-x-auto">
        <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mr-1">Quick actions</span>
        <ActionBtn onClick={() => setShiftEditor({ date: today })}><Plus className="w-3.5 h-3.5" /> Add shift</ActionBtn>
        <ActionBtn onClick={() => doCopy.mutate()}><Copy className="w-3.5 h-3.5" /> Copy last week</ActionBtn>
        <ActionBtn onClick={() => { const m = prompt('Broadcast to the crew (inbox + push + email/SMS):'); if (m) doBroadcast.mutate(m) }}><Megaphone className="w-3.5 h-3.5" /> Broadcast crew</ActionBtn>
        <ActionBtn onClick={() => setInviteOpen(true)}><UserPlus className="w-3.5 h-3.5" /> Add staff</ActionBtn>
        <ActionBtn onClick={() => setOpsOpen(true)}><SlidersHorizontal className="w-3.5 h-3.5" /> Ops rules</ActionBtn>
        <ExportMenu
          variant="soft"
          size="sm"
          label="Export week"
          count={shifts.length}
          onExport={exportWeek}
          title="Export this week's schedule"
        />
        <ActionBtn onClick={printWeek}><Printer className="w-3.5 h-3.5" /> Print sheet</ActionBtn>
        <ActionBtn onClick={() => doPublish.mutate()} primary><Send className="w-3.5 h-3.5" /> {published ? 'Re-publish' : 'Publish week'}</ActionBtn>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_330px] gap-4">
        {/* Schedule area */}
        <section>
          {/* Toolbar */}
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <div className="flex items-center gap-2">
              <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="w-8 h-8 grid place-items-center border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50"><ChevronLeft className="w-4 h-4" /></button>
              <div className="text-sm font-extrabold tabular-nums text-gray-900">{fmtWeekRange(weekStart)}</div>
              <button onClick={() => setWeekStart(addDays(weekStart, 7))} className="w-8 h-8 grid place-items-center border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50"><ChevronRight className="w-4 h-4" /></button>
              <button onClick={() => setWeekStart(mondayOf())} className="h-8 px-2.5 border border-gray-200 rounded-lg text-[11px] font-semibold text-gray-500 hover:bg-gray-50">Today</button>
            </div>
            <div className="flex gap-0.5 p-0.5 rounded-lg bg-gray-100">
              {(['coverage', 'labor', 'fairness', 'compliance'] as Lens[]).map((l) => (
                <button key={l} onClick={() => setLens(l)} className={cn('px-2.5 py-1.5 rounded-md text-[11px] font-bold capitalize', lens === l ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500')}>{l}</button>
              ))}
            </div>
          </div>

          {/* Grid */}
          <div
            data-lens={lens}
            className={cn(
              'bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm',
              '[&_[data-fair-risk=true]]:outline [&_[data-fair-risk=true]]:outline-2 [&_[data-fair-risk=true]]:outline-transparent',
              '[&_[data-compliance-risk=true]]:outline [&_[data-compliance-risk=true]]:outline-2 [&_[data-compliance-risk=true]]:outline-transparent',
              'data-[lens=fairness]:[&_[data-fair-risk=true]]:outline-amber-500',
              'data-[lens=compliance]:[&_[data-compliance-risk=true]]:outline-rose-500',
            )}
          >
            <div className="overflow-x-auto">
              <div className="min-w-[860px]">
                {/* header row */}
                <div className="grid" style={{ gridTemplateColumns: '150px repeat(7, minmax(96px,1fr))' }}>
                  <div className="px-3 py-2 bg-gray-50 border-b border-r border-gray-100 text-[10px] font-bold uppercase text-gray-500">Team member</div>
                  {days.map((d, i) => {
                    const cov = week?.coverage.days.find((c) => c.date === d)
                    const evs = eventsByDay.get(d) ?? []
                    return (
                      <div key={d} className="px-2 py-2 bg-gray-50 border-b border-r border-gray-100 text-center">
                        <div className="text-[10px] font-extrabold uppercase text-gray-700">{DOW[i]} {dayNum(d)}</div>
                        <div className={cn('text-[8px] font-semibold mt-0.5 truncate', cov?.status === 'gap' ? 'text-rose-500' : cov?.status === 'warn' ? 'text-amber-600' : 'text-gray-400')}>
                          {evs[0]?.title ? evs[0].title : cov?.status === 'gap' ? `${cov.gaps.length} gap` : `${cov?.staffed ?? 0} on`}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* member rows */}
                {members.length === 0 && (
                  <div className="p-10 text-center text-sm text-gray-400">No team members yet. Use “Add staff”.</div>
                )}
                {members.map((m) => {
                  const hrs = weeklyHours.get(m.id) ?? 0
                  const ot = hrs > 40
                  return (
                    <div key={m.id} className="grid" style={{ gridTemplateColumns: '150px repeat(7, minmax(96px,1fr))' }}>
                      <button onClick={() => setMemberEditor({ member: m })} className="flex items-center gap-2 px-2.5 py-2 bg-gray-50/50 border-b border-r border-gray-100 text-left hover:bg-gray-100 min-h-[52px]">
                        <Avatar member={m} owner={m.role === 'owner'} />
                        <div className="min-w-0">
                          <div className="text-[11px] font-bold text-gray-900 truncate">{m.display_name}</div>
                          <div className="text-[8.5px] text-gray-400 truncate">{m.position ?? m.employment_type}</div>
                        </div>
                        <span className={cn('ml-auto text-[8px] font-bold tabular-nums', ot ? 'text-amber-600' : 'text-gray-400')}>{hrs ? `${hrs.toFixed(0)}h` : ''}</span>
                      </button>
                      {days.map((d) => {
                        const cell = shifts.filter((s) => s.member_id === m.id && s.shift_date === d)
                        return (
                          <div key={d} className="border-b border-r border-gray-100 p-1 min-h-[52px] flex items-stretch">
                            {cell.length === 0 ? (
                              <button onClick={() => setShiftEditor({ date: d, memberId: m.id })} className="w-full rounded-md text-gray-200 hover:text-wine-400 hover:bg-wine-50/40 transition-colors grid place-items-center">
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <div className="w-full flex flex-col gap-1">
                                {cell.map((s) => {
                                  const risk = shiftRiskFlags(s, m.id)
                                  return (
                                  <button
                                    key={s.id}
                                    data-fair-risk={risk.fair || undefined}
                                    data-compliance-risk={risk.compliance || undefined}
                                    onClick={() => openInspector(s.id)}
                                    onContextMenu={(e) => { e.preventDefault(); setShiftMenu({ shift: s, x: e.clientX, y: e.clientY }) }}
                                    className={cn(
                                      'w-full px-1.5 py-1 rounded-md text-center transition-transform hover:-translate-y-px outline-offset-1',
                                      shiftClass(s),
                                      selectedShiftId === s.id && 'ring-2 ring-wine-500',
                                    )}
                                  >
                                    <span className="block text-[9.5px] font-extrabold tabular-nums leading-tight">{fmtTime(s.start_time)}-{fmtTime(s.end_time)}</span>
                                    <span className="block text-[7.5px] font-semibold opacity-75 truncate">
                                      {lens === 'labor' && laborEnabled && s.labor_cost != null
                                        ? `$${Math.round(s.labor_cost)}`
                                        : lens === 'fairness' && risk.fair
                                          ? ((weeklyHours.get(m.id) ?? 0) > 40 ? 'OT risk' : 'Fairness risk')
                                          : lens === 'compliance' && risk.compliance
                                            ? (s.state === 'callout' ? 'call-out' : (s.shift_breaks?.length ? 'cert' : 'break plan'))
                                            : s.role ?? s.shift_type}
                                    </span>
                                  </button>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Open-shift cells for days (open shifts not tied to a member) */}
          {shifts.some((s) => !s.member_id) && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase text-gray-400">Open shifts</span>
              {shifts.filter((s) => !s.member_id).map((s) => (
                <button key={s.id} onClick={() => openInspector(s.id)} className={cn('px-2.5 py-1 rounded-lg text-[11px] font-semibold', shiftClass(s))}>
                  {new Date(s.shift_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' })} {fmtTime(s.start_time)} · {s.role ?? 'open'}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Manager Desk rail */}
        <aside className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm self-start">
          <div className="px-3.5 py-3 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <strong className="text-sm font-extrabold text-gray-900">Manager Desk</strong>
              <span className="px-2 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-extrabold tabular-nums">{tasks.length}</span>
            </div>
            <div className="flex gap-1 mt-2">
              {(['all', 'now', 'publish', 'people'] as DeskTab[]).map((t) => (
                <button key={t} onClick={() => setDeskTab(t)} className={cn('px-2 py-1 rounded-md text-[10px] font-bold capitalize', deskTab === t ? 'bg-gray-100 text-gray-900' : 'text-gray-500')}>{t === 'publish' ? 'Before publish' : t}</button>
              ))}
            </div>
          </div>

          <div className="max-h-[360px] overflow-y-auto divide-y divide-gray-50">
            {visibleTasks.length === 0 && (
              <div className="flex flex-col items-center gap-1.5 py-8 text-center">
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                <div className="text-xs font-semibold text-gray-500">Nothing needs you right now</div>
              </div>
            )}
            {visibleTasks.map((t) => (
              <div key={t.id} className="grid grid-cols-[7px_1fr] gap-2 px-3 py-2.5">
                <span className={cn('w-1.5 h-1.5 mt-1.5 rounded-full', t.priority === 'urgent' ? 'bg-rose-500' : t.priority === 'soon' ? 'bg-amber-500' : 'bg-blue-500')} />
                <div>
                  <div className="text-[11px] font-bold text-gray-900 leading-snug">{t.title}</div>
                  <div className="mt-0.5 text-[9.5px] text-gray-500 leading-snug">{t.meta}</div>
                  {t.shiftId && (
                    <div className="flex gap-1.5 mt-1.5">
                      <button onClick={() => doOffer.mutate(t.shiftId!)} className="h-6 px-2 rounded-md bg-rose-50 text-rose-600 text-[9px] font-bold border border-rose-100">Offer to 3</button>
                      <button onClick={() => openInspector(t.shiftId!)} className="h-6 px-2 rounded-md bg-gray-50 text-gray-700 text-[9px] font-bold border border-gray-100">Open</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Publish readiness */}
          <div className="m-2 p-2.5 rounded-xl border border-gray-100">
            <div className="flex items-center justify-between">
              <strong className="text-[10px] font-extrabold text-gray-900 uppercase tracking-wide">Publish readiness</strong>
              <span className={cn('text-[9px] font-bold', (week?.coverage.totalGaps ?? 0) > 0 ? 'text-rose-600' : 'text-emerald-600')}>{(week?.coverage.totalGaps ?? 0) > 0 ? `${week?.coverage.totalGaps} blockers` : 'Clear'}</span>
            </div>
            <Readiness label="Role coverage" ok={(week?.coverage.totalGaps ?? 0) === 0} bad={`${week?.coverage.totalGaps ?? 0} gap`} />
            <Readiness label="Overtime" ok={(week?.labor.overtime?.length ?? 0) === 0} bad={`${week?.labor.overtime?.length ?? 0} over 40h`} />
            <Readiness label="Open shifts" ok={!shifts.some((s) => !s.member_id)} bad={`${shifts.filter((s) => !s.member_id).length} open`} />
          </div>

          {/* Shift inspector */}
          <div className="border-t border-gray-100">
            <div className="px-4 pt-3.5 pb-1">
              <div className="text-[9px] font-bold uppercase tracking-wider text-wine-700 flex items-center gap-1"><ClipboardCheck className="w-3 h-3" /> Shift inspector</div>
              <div className="text-sm font-extrabold text-gray-900 mt-1">{selectedShift ? (selectedMember?.display_name ?? 'Open shift') : 'Select any shift'}</div>
              <div className="text-[10px] text-gray-500">{selectedShift ? `${new Date(selectedShift.shift_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${fmtTime(selectedShift.start_time)}–${fmtTime(selectedShift.end_time)}` : 'Details and actions appear here.'}</div>
            </div>
            {selectedShift && (
              <div className="px-4 pb-3">
                <Detail label="Station" value={selectedShift.role ?? '—'} />
                <Detail label="Type" value={selectedShift.shift_type} />
                {selectedShift.note && <Detail label="Note" value={selectedShift.note} />}
                <div className="grid grid-cols-2 gap-1.5 mt-2">
                  <SmallBtn onClick={() => setShiftEditor({ shift: selectedShift })}>Edit shift</SmallBtn>
                  <SmallBtn onClick={() => doCallout.mutate(selectedShift.id)}>Report call-out</SmallBtn>
                  <SmallBtn onClick={() => doOffer.mutate(selectedShift.id)} tone="wine">Find cover</SmallBtn>
                  {selectedShift.state === 'open' && members[0] && (
                    <SmallBtn onClick={() => doAssign.mutate({ shiftId: selectedShift.id, memberId: members[0].id })}>Assign first</SmallBtn>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Performance */}
          <PerformancePanel member={selectedMember} />
        </aside>
      </div>

      {/* People sheet */}
      {peopleOpen && (
        <PeopleSheet
          members={members}
          certs={certs}
          onClose={() => setPeopleOpen(false)}
          onEdit={(m) => { setPeopleOpen(false); setMemberEditor({ member: m }) }}
          onAdd={() => { setPeopleOpen(false); setInviteOpen(true) }}
          onOps={() => { setPeopleOpen(false); setOpsOpen(true) }}
        />
      )}
      {opsOpen && <OpsRulesPanel members={members} onClose={() => setOpsOpen(false)} />}

      {/* Right-click shift menu (NEW-521) */}
      {shiftMenu && (() => {
        const sh = shiftMenu.shift
        const m = sh.member_id ? membersById.get(sh.member_id) : undefined
        const Item = ({ icon: Icon, label, danger, onClick }: { icon: any; label: string; danger?: boolean; onClick: () => void }) => (
          <button
            onClick={onClick}
            className={cn('flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm rounded-lg hover:bg-gray-50', danger ? 'text-rose-600' : 'text-gray-700')}
          >
            <Icon className={cn('w-4 h-4', danger ? 'text-rose-500' : 'text-gray-400')} /> {label}
          </button>
        )
        return (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShiftMenu(null)} />
            <div
              className="fixed z-50 w-52 bg-white border border-gray-200 rounded-xl shadow-xl p-1"
              style={{ top: Math.min(shiftMenu.y, window.innerHeight - 220), left: Math.min(shiftMenu.x, window.innerWidth - 220) }}
            >
              <Item icon={Pencil} label="Edit shift" onClick={() => { setShiftEditor({ shift: sh }); setShiftMenu(null) }} />
              <Item icon={Copy} label="Duplicate" onClick={() => { doDuplicateShift.mutate(sh); setShiftMenu(null) }} />
              <Item
                icon={MessageSquare}
                label={`Message ${m?.display_name?.split(' ')[0] ?? 'staff'}`}
                onClick={() => {
                  const msg = prompt(`Message to ${m?.display_name ?? 'this member'}:`)
                  if (msg) doBroadcast.mutate(msg)
                  setShiftMenu(null)
                }}
              />
              <Item
                icon={Trash2}
                label="Delete shift"
                danger
                onClick={() => {
                  setShiftMenu(null)
                  if (confirm(`Delete ${m?.display_name ?? 'this'} shift on ${sh.shift_date}?`)) doDeleteShift.mutate(sh.id)
                }}
              />
            </div>
          </>
        )
      })()}

      {/* Modals */}
      {shiftEditor && (
        <ShiftEditor shift={shiftEditor.shift} defaultDate={shiftEditor.date} defaultMemberId={shiftEditor.memberId} members={members} onClose={() => setShiftEditor(null)} />
      )}
      {memberEditor && <MemberEditor member={memberEditor.member} wageVisible={week?.settings?.wage_visible ?? true} onClose={() => setMemberEditor(null)} />}
      <InviteTeamDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        restaurantId={activeRestaurantId ?? ''}
        anchorRef={inviteAnchor}
        onRosterOnly={() => setMemberEditor({ member: null })}
      />
    </div>
  )
}

// ── Small presentational helpers ──────────────────────────────────────────
function ActionBtn({ children, onClick, primary }: { children: React.ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <button onClick={onClick} className={cn('inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[11px] font-bold border shrink-0', primary ? 'bg-gray-900 border-gray-900 text-white hover:bg-gray-800' : 'bg-white border-gray-200 text-gray-600 hover:border-wine-300 hover:text-wine-700')}>
      {children}
    </button>
  )
}
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 border-t border-gray-50 text-[10px]">
      <span className="text-gray-500 font-semibold">{label}</span>
      <b className="text-gray-800 font-bold text-right">{value}</b>
    </div>
  )
}
function SmallBtn({ children, onClick, tone }: { children: React.ReactNode; onClick: () => void; tone?: 'wine' }) {
  return (
    <button onClick={onClick} className={cn('h-7 rounded-md text-[9.5px] font-bold border', tone === 'wine' ? 'bg-wine-50 border-wine-200 text-wine-700' : 'bg-gray-50 border-gray-100 text-gray-700 hover:bg-gray-100')}>{children}</button>
  )
}
function Readiness({ label, ok, bad }: { label: string; ok: boolean; bad: string }) {
  return (
    <div className="flex items-center justify-between mt-1.5 text-[9.5px] font-semibold text-gray-500">
      <span>{label}</span>
      <b className={ok ? 'text-emerald-600' : 'text-rose-600'}>{ok ? 'Clear' : bad}</b>
    </div>
  )
}

function PeopleSheet({ members, certs, onClose, onEdit, onAdd, onOps }: {
  members: TeamMember[]; certs: Certification[]; onClose: () => void; onEdit: (m: TeamMember) => void; onAdd: () => void; onOps: () => void
}) {
  const certsByMember = useMemo(() => {
    const map = new Map<string, Certification[]>()
    for (const c of certs) { if (!map.has(c.member_id)) map.set(c.member_id, []); map.get(c.member_id)!.push(c) }
    return map
  }, [certs])
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="bg-white w-full max-w-md h-full overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white flex items-center justify-between px-5 py-4 border-b border-gray-100 gap-2">
          <h3 className="text-base font-bold text-gray-900">People</h3>
          <div className="flex items-center gap-2">
            <button onClick={onOps} className="inline-flex items-center gap-1.5 h-8 px-3 border border-gray-200 rounded-lg text-xs font-bold text-gray-600 hover:bg-gray-50"><SlidersHorizontal className="w-3.5 h-3.5" /> Rules</button>
            <button onClick={onAdd} className="inline-flex items-center gap-1.5 h-8 px-3 bg-wine-600 text-white rounded-lg text-xs font-bold"><Plus className="w-3.5 h-3.5" /> Add</button>
          </div>
        </div>
        <div className="p-4 space-y-2">
          {members.map((m) => {
            const mc = certsByMember.get(m.id) ?? []
            const flag = mc.find((c) => c.status === 'expiring' || c.status === 'expired')
            return (
              <button key={m.id} onClick={() => onEdit(m)} className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:bg-gray-50 text-left">
                <Avatar member={m} owner={m.role === 'owner'} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-gray-900 truncate">{m.display_name}</div>
                  <div className="text-[11px] text-gray-400 truncate">{m.position ?? m.employment_type}{m.role ? ` · ${m.role}` : ''}{!m.accountLinked && ' · no account yet'}</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {m.skills.slice(0, 3).map((s) => <Pill key={s}>{s}</Pill>)}
                    {flag && <Pill tone={flag.status === 'expired' ? 'red' : 'amber'}><AlertTriangle className="w-2.5 h-2.5" /> {flag.cert_type}</Pill>}
                  </div>
                </div>
                <Sparkles className="w-4 h-4 text-gray-300" />
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
