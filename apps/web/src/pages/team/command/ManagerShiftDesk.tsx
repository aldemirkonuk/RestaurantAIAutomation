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
  Pencil, Trash2, MessageSquare, Printer, FileSpreadsheet, X,
} from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import { InviteTeamDialog } from '../../../components/team/InviteTeamDialog'
import { ShiftImportModal } from '../../../components/team/ShiftImportModal'
import { RestaurantBranchSwitcher } from '../../../components/layout/RestaurantBranchSwitcher'
import { ExportMenu } from '../../../components/ui/ExportMenu'
import { exportTable, type TableExportColumn, type TableExportFormat } from '../../../lib/tableExport'
import { fetchCalendarEvents } from '../../../services/api/calendar'
import {
  getWeek, getTeamMembers, getCertifications, copyWeek, publishSchedule, createSchedule,
  reportCallout, offerCover, broadcast, createShift, deleteShift,
  type WeekPayload, type Shift, type TeamMember, type Certification,
} from '../../../services/api/team'
import { cn } from '../../../lib/utils'
import {
  mondayOf, addDays, weekDays, DOW, dayNum, fmtWeekRange, fmtTime, shiftClass, shiftHours,
  Avatar, Pill, PulseCell, todayIso,
} from './bits'
import { ShiftEditor, MemberEditor } from './editors'
import { EM } from '../next/tm-format'
import { PerformancePanel } from './PerformancePanel'
import { OpsRulesPanel } from './OpsRulesPanel'

/**
 * The gateway's own words when it has them. The three verbs this is used on are
 * about to start REFUSING unqualified requests (see the TODO in
 * `services/api/team.ts`), and "Could not copy last week" would hide a 409 that
 * says exactly what is missing.
 */
function serverMessage(e: any): string | null {
  const m = e?.response?.data?.message
  if (typeof m === 'string' && m.trim()) return m
  if (Array.isArray(m) && typeof m[0] === 'string') return m[0]
  return null
}

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
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [shiftEditor, setShiftEditor] = useState<{ shift?: Shift; date?: string; memberId?: string } | null>(null)
  const [memberEditor, setMemberEditor] = useState<{ member?: TeamMember | null } | null>(null)
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [opsOpen, setOpsOpen] = useState(false)
  /** NEW-521: right-click a shift chip. */
  const [shiftMenu, setShiftMenu] = useState<{ shift: Shift; x: number; y: number } | null>(null)
  /**
   * Who a message is addressed to, shown before it is sent (P2). The state
   * holds the ADDRESS, not a snapshot of the roster: recipients are resolved
   * at render, so a roster that arrives while the composer is open corrects
   * the list rather than leaving "reaches 0 people" on screen.
   */
  const [composer, setComposer] = useState<{ scope: 'crew' } | { scope: 'one'; memberId: string } | null>(null)
  /** A destructive action names what it destroys and waits for a second click (P7). */
  const [pendingConfirm, setPendingConfirm] = useState<'copy' | 'republish' | null>(null)

  // Honor publish deep-link: /team?week=YYYY-MM-DD
  useEffect(() => {
    const w = params.get('week')
    if (w && /^\d{4}-\d{2}-\d{2}$/.test(w)) setWeekStart(mondayOf(new Date(w + 'T12:00:00')))
  }, [params])

  const days = useMemo(() => weekDays(weekStart), [weekStart])

  const weekQ = useQuery<WeekPayload>({
    queryKey: ['team', 'week', activeRestaurantId, weekStart],
    queryFn: () => getWeek(weekStart),
    enabled: !!activeRestaurantId,
  })
  const membersQ = useQuery<TeamMember[]>({
    queryKey: ['team', 'members', activeRestaurantId],
    queryFn: () => getTeamMembers(),
    enabled: !!activeRestaurantId,
  })
  const certsQ = useQuery<Certification[]>({
    queryKey: ['team', 'certs', activeRestaurantId],
    queryFn: () => getCertifications(),
    enabled: !!activeRestaurantId,
  })
  const calQ = useQuery({
    queryKey: ['team', 'cal', activeRestaurantId, weekStart],
    queryFn: () => fetchCalendarEvents(activeRestaurantId!, { startDate: days[0], endDate: days[6] }),
    enabled: !!activeRestaurantId,
  })

  const week = weekQ.data
  const members = membersQ.data ?? []
  const certs = certsQ.data ?? []
  const calEvents = calQ.data ?? []

  /**
   * A dead gateway is not a healthy, empty restaurant.
   *
   * With no error branch this desk drew a FAILED read as a measured all-clear:
   * "No team members yet", "0 active", an empty task rail under a green tick,
   * and "Publish readiness: Clear" on all three rows — every one of them a
   * `?? 0` standing in for an answer nobody gave. The two sentences below are
   * the pattern the redesigned half already uses (TeamNext.tsx:259-287): a
   * register that answered keeps its answer and says it is stale; a register
   * that did not answer claims nothing (ADR 0051).
   */
  const readFailed = weekQ.isError || membersQ.isError || certsQ.isError
  const weekKnown = weekQ.data !== undefined
  const rosterKnown = membersQ.data !== undefined
  const firstError = [weekQ.error, membersQ.error, certsQ.error].find(Boolean)
  const errorMessage = firstError instanceof Error ? firstError.message : 'unknown error'
  const retryReads = () => {
    void weekQ.refetch()
    void membersQ.refetch()
    void certsQ.refetch()
    void calQ.refetch()
  }

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
  /** null when the roster did not answer — an unknown, never a measured 0. */
  const staffCount = rosterKnown ? members.filter((m) => m.status === 'active').length : null
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
    if (week?.schedule?.status === 'published' && staffCount !== null && staffCount > receiptsSeen) {
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

  /**
   * `resetReceipts` is passed ONLY from the re-publish ConfirmSheet, which
   * names the receipts it destroys. A first publish sends nothing: the gateway
   * clears nothing and answers `receiptsCleared: 0` (ADR 0088 T7).
   */
  const doPublish = useMutation({
    mutationFn: async (opts?: { resetReceipts?: boolean }) => {
      let scheduleId = week?.schedule?.id
      if (!scheduleId) {
        const created = await createSchedule(weekStart)
        scheduleId = created.id
      }
      return publishSchedule(scheduleId, undefined, opts)
    },
    onSuccess: () => { toast.success('Schedule published & team notified'); invalidateWeek() },
    onError: (e: any) => toast.error(serverMessage(e) ?? 'Could not publish schedule'),
  })
  /**
   * `replaceTarget` is passed because the ConfirmSheet below has already told
   * the manager the whole target week is deleted first, and they said yes. The
   * gateway still 409s on any caller that has not (ADR 0088 T7).
   */
  const doCopy = useMutation({
    mutationFn: () =>
      copyWeek(addDays(weekStart, -7), weekStart, undefined, { replaceTarget: true }),
    onSuccess: (r: any) => { toast.success(`Copied ${r?.copied ?? 0} shifts from last week`); invalidateWeek() },
    onError: (e: any) => toast.error(serverMessage(e) ?? 'Could not copy last week'),
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
    onError: () => toast.error('Could not report the call-out — the shift is unchanged'),
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
  /**
   * P2: a message addressed to one person reaches one person.
   *
   * `broadcast` without `memberIds` is a RESTAURANT-WIDE send: the gateway
   * falls back to every active linked member across inbox, push, email and SMS
   * (team.controller.ts:345-347). The right-click "Message {firstName}" item
   * sent exactly that — no targeting, no recipient list, no confirmation, from
   * a `prompt()`. The targeting already existed and the redesigned half used it
   * correctly; this caller simply never passed it.
   */
  const doBroadcast = useMutation({
    mutationFn: ({ message, memberIds }: { message: string; memberIds?: string[] }) =>
      broadcast({
        message,
        title: '📣 Message from your manager',
        // Exactly one of the two, never both and never neither (ADR 0088 T3).
        ...(memberIds?.length ? { memberIds } : { audience: 'everyone' as const }),
      }),
    onSuccess: (r: any) => {
      const parts = [`inbox`]
      if (r?.notified) parts.push(`${r.notified} push`)
      if (r?.emailed) parts.push(`${r.emailed} email`)
      if (r?.texted) parts.push(`${r.texted} SMS`)
      toast.success(`Message sent (${parts.join(' · ')})`)
      setComposer(null)
    },
    onError: (e: any) => toast.error(serverMessage(e) ?? 'Could not send the message'),
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
  // Tonight means tonight: a task about tomorrow's open shift is a task, but
  // it is not on tonight's board. (`group === 'now'` covers every open shift in
  // the week, which is why the old expression was never tonight-scoped.)
  const tonightTasks = tasks.filter(
    (t) =>
      (t.shiftId && tonightShifts.some((s) => s.id === t.shiftId)) ||
      t.id.startsWith(`gap-${today}-`),
  ).length
  /**
   * A wage that is null is not a wage of zero. `sum(labor_cost ?? 0)` printed
   * "$0" for a week nobody had priced, and it will start printing it for every
   * week once wages are nullable. Unknown until the whole night is priced.
   */
  const tonightLabor =
    tonightShifts.length === 0
      ? '$0'
      : tonightShifts.some((s) => s.labor_cost == null)
        ? EM
        : `$${Math.round(tonightShifts.reduce((sum, s) => sum + (s.labor_cost ?? 0), 0)).toLocaleString()}`
  const tonightStaffed = tonightShifts.filter((s) => s.member_id && s.state !== 'callout').length
  const published = week?.schedule?.status === 'published'
  // Exactly the gateway's own fallback set (team.controller.ts:347), computed
  // here so the manager sees WHO before pressing send rather than after.
  const crewRecipients = members.filter((m) => m.status === 'active' && m.accountLinked)
  const composerRecipients =
    composer === null
      ? []
      : composer.scope === 'crew'
        ? crewRecipients
        : members.filter((m) => m.id === composer.memberId)

  return (
    <div className="p-4 md:p-6 max-w-[1500px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Team</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {staffCount === null ? `${EM} active` : `${staffCount} active`} ·{' '}
            <span className="tabular-nums">{fmtWeekRange(weekStart)}</span>
            {!weekKnown ? null : published ? <Pill tone="green">Published</Pill> : <span className="ml-2"><Pill tone="amber">Draft</Pill></span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <RestaurantBranchSwitcher />
          <button onClick={() => setPeopleOpen(true)} className="inline-flex items-center gap-1.5 h-9 px-3 border border-gray-200 bg-white rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-50">
            <Users className="w-3.5 h-3.5" /> People
          </button>
          <button ref={inviteAnchor} onClick={() => setInviteOpen(true)} className="inline-flex items-center gap-1.5 h-9 px-4 bg-wine-600 hover:bg-wine-700 text-white rounded-lg text-xs font-bold shadow-sm">
            <UserPlus className="w-3.5 h-3.5" /> Invite member
          </button>
        </div>
      </div>

      {readFailed && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 mb-3 px-4 py-3 rounded-2xl border border-gray-200 bg-gray-50 text-xs text-gray-700"
        >
          <span>
            {weekKnown
              ? `The desk could not be refreshed (${errorMessage}) — what is below is the last answer, not the present.`
              : `The gateway could not be reached (${errorMessage}). The week, the roster and the credential file are unknown — nothing below is claimed.`}
          </span>
          <button
            onClick={retryReads}
            className="h-8 px-3 shrink-0 border border-gray-200 bg-white rounded-lg text-xs font-bold text-gray-600 hover:bg-gray-100"
          >
            Try again
          </button>
        </div>
      )}

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
          value={laborEnabled ? tonightLabor : `${tonightShifts.reduce((sum, s) => sum + shiftHours(s), 0).toFixed(0)}h`}
          sub={laborEnabled && tonightLabor === EM ? `${tonightShifts.length} shifts, not priced` : `${tonightShifts.length} shifts`}
        />
        {/* This cell sits under a heading that says "Tonight's board", so it
            counts tonight. It used to fall back to the WHOLE WEEK's urgent
            count the moment tonight was clean — the number changed meaning
            without changing its label. The week is still here, in the sub. */}
        <PulseCell
          label="Desk actions"
          value={`${tonightTasks} tonight`}
          sub={`${tasks.length} this week`}
          tone={tonightTasks ? 'danger' : 'default'}
          onClick={() => setDeskTab('all')}
        />
      </div>

      {/* Quick actions */}
      <div className="flex items-center gap-2 flex-wrap mb-3 overflow-x-auto">
        <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mr-1">Quick actions</span>
        <ActionBtn onClick={() => setShiftEditor({ date: today })}><Plus className="w-3.5 h-3.5" /> Add shift</ActionBtn>
        <ActionBtn onClick={() => setImportModalOpen(true)}><FileSpreadsheet className="w-3.5 h-3.5 text-wine-600" /> Import sheet</ActionBtn>
        <ActionBtn onClick={() => setPendingConfirm('copy')}><Copy className="w-3.5 h-3.5" /> Copy last week</ActionBtn>
        <ActionBtn onClick={() => setComposer({ scope: 'crew' })}><Megaphone className="w-3.5 h-3.5" /> Broadcast crew</ActionBtn>
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
        <ActionBtn onClick={() => (published ? setPendingConfirm('republish') : doPublish.mutate(undefined))} primary><Send className="w-3.5 h-3.5" /> {published ? 'Re-publish' : 'Publish week'}</ActionBtn>
      </div>

      <ShiftImportModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImportComplete={() => invalidateWeek()}
      />

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
                  <div className="p-10 text-center text-sm text-gray-400">
                    {rosterKnown
                      ? 'No team members yet. Use “Add staff”.'
                      : 'The roster could not be read — who is on this team is unknown, not empty.'}
                  </div>
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
                {readFailed ? (
                  <>
                    <AlertTriangle className="w-5 h-5 text-gray-400" />
                    <div className="text-xs font-semibold text-gray-500">
                      Nothing could be read, so nothing is listed
                    </div>
                    <div className="text-[10px] text-gray-400 max-w-[220px]">
                      This is a silent rail, not a clear one.
                    </div>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    <div className="text-xs font-semibold text-gray-500">Nothing needs you right now</div>
                  </>
                )}
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
              <span
                className={cn(
                  'text-[9px] font-bold',
                  !weekKnown ? 'text-gray-500' : (week?.coverage.totalGaps ?? 0) > 0 ? 'text-rose-600' : 'text-emerald-600',
                )}
              >
                {!weekKnown
                  ? 'Unknown'
                  : (week?.coverage.totalGaps ?? 0) > 0
                    ? `${week?.coverage.totalGaps} blockers`
                    : 'Clear'}
              </span>
            </div>
            {/* Every row here was `?? 0` — a week the gateway never answered
                read as three green ticks. `known` is the difference between a
                measurement and a silence. */}
            <Readiness known={weekKnown} label="Role coverage" ok={(week?.coverage.totalGaps ?? 0) === 0} bad={`${week?.coverage.totalGaps ?? 0} gap`} />
            <Readiness known={weekKnown} label="Overtime" ok={(week?.labor.overtime?.length ?? 0) === 0} bad={`${week?.labor.overtime?.length ?? 0} over 40h`} />
            <Readiness known={weekKnown} label="Open shifts" ok={!shifts.some((s) => !s.member_id)} bad={`${shifts.filter((s) => !s.member_id).length} open`} />
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
                  {/* Was "Assign first", which assigned members[0] — the first
                      row of an arbitrarily ordered roster, with no regard for
                      role, availability or hours. The editor asks who. */}
                  {selectedShift.state === 'open' && members.length > 0 && (
                    <SmallBtn onClick={() => setShiftEditor({ shift: selectedShift })}>Assign someone</SmallBtn>
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
                  setShiftMenu(null)
                  if (m) setComposer({ scope: 'one', memberId: m.id })
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

      {composer && (
        <MessageComposer
          recipients={composerRecipients}
          scope={composer.scope}
          pending={doBroadcast.isPending}
          onCancel={() => setComposer(null)}
          onSend={(message) =>
            doBroadcast.mutate({
              message,
              // A crew broadcast sends no memberIds and is tagged
              // `audience: 'everyone'` downstream so the gateway uses its own
              // live roster; a one-person message always names its recipient,
              // which is the whole bug this replaces.
              memberIds: composer.scope === 'one' ? [composer.memberId] : undefined,
            })
          }
        />
      )}

      {pendingConfirm === 'copy' && (
        <ConfirmSheet
          title="Copy last week"
          body={`Copying replaces this week first: every shift already on ${fmtWeekRange(weekStart)} is deleted before last week's ${'\u2014'} including anything added by hand. This cannot be undone.`}
          confirmLabel="Replace the week"
          pending={doCopy.isPending}
          onCancel={() => setPendingConfirm(null)}
          onConfirm={() => { setPendingConfirm(null); doCopy.mutate() }}
        />
      )}

      {pendingConfirm === 'republish' && (
        <ConfirmSheet
          title="Re-publish this week"
          body={`Re-publishing clears every read receipt, so the record of who has seen this schedule (${receiptsSeen} so far) is deleted and everyone is notified again. This cannot be undone.`}
          confirmLabel="Re-publish and clear receipts"
          pending={doPublish.isPending}
          onCancel={() => setPendingConfirm(null)}
          onConfirm={() => { setPendingConfirm(null); doPublish.mutate({ resetReceipts: true }) }}
        />
      )}

      {/* Modals */}
      {shiftEditor && (
        <ShiftEditor shift={shiftEditor.shift} defaultDate={shiftEditor.date} defaultMemberId={shiftEditor.memberId} members={members} onClose={() => setShiftEditor(null)} />
      )}
      {memberEditor && (
        <MemberEditor
          member={memberEditor.member}
          wageVisible={week?.settings?.wage_visible ?? true}
          ownerCount={members.filter(m => m.role === 'owner').length}
          onClose={() => setMemberEditor(null)}
        />
      )}
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

/**
 * Sending a message is not an undoable act, so the recipients are on screen
 * before the send control is, and the send control counts them. The previous
 * surface was a `prompt()` whose text said "this member" while the request it
 * produced went to the entire crew across four channels.
 */
function MessageComposer({
  recipients, scope, pending, onCancel, onSend,
}: {
  recipients: TeamMember[]
  scope: 'crew' | 'one'
  pending: boolean
  onCancel: () => void
  onSend: (message: string) => void
}) {
  const [message, setMessage] = useState('')
  const n = recipients.length
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={scope === 'crew' ? 'Message the crew' : 'Message one member'}
        className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-bold text-gray-900">
            {scope === 'crew' ? 'Message the crew' : 'Message one member'}
          </h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <div className="text-[10px] font-extrabold uppercase tracking-wide text-gray-500 mb-1">
              Reaches {n} {n === 1 ? 'person' : 'people'} — inbox, push, email and SMS
            </div>
            {n === 0 ? (
              <p className="text-xs text-gray-500">
                Nobody on this roster has a linked account, so this message would reach nobody.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {recipients.map((r) => (
                  <li key={r.id}>
                    <Pill>{r.display_name}</Pill>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 mb-1">Message</span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-wine-100 focus:border-wine-500 outline-none"
            />
          </label>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button onClick={onCancel} className="h-9 px-3 text-xs font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
              Cancel
            </button>
            <button
              onClick={() => onSend(message)}
              disabled={pending || !message.trim() || n === 0}
              className="h-9 px-4 bg-wine-600 text-white rounded-lg text-xs font-bold hover:bg-wine-700 disabled:opacity-50"
            >
              {pending ? 'Sending…' : `Send to ${n} ${n === 1 ? 'person' : 'people'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Both actions this guards DELETE rows before they write any: copy-week wipes
 * the target week first (schedule.service.ts:202-207) and publish wipes every
 * `schedule_receipts` row (schedule.service.ts:248-251), destroying the record
 * of who has seen the schedule. Member removal on this page has confirmed
 * properly for a while (editors.tsx:265-284); these two were single clicks.
 */
function ConfirmSheet({
  title, body, confirmLabel, pending, onCancel, onConfirm,
}: {
  title: string
  body: string
  confirmLabel: string
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-bold text-gray-900">{title}</h3>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-sm text-gray-700">{body}</p>
          <div className="flex items-center justify-end gap-2">
            <button onClick={onCancel} className="h-9 px-3 text-xs font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={pending}
              className="h-9 px-4 bg-wine-600 text-white rounded-lg text-xs font-bold hover:bg-wine-700 disabled:opacity-50"
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

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
function Readiness({ label, ok, bad, known = true }: { label: string; ok: boolean; bad: string; known?: boolean }) {
  return (
    <div className="flex items-center justify-between mt-1.5 text-[9.5px] font-semibold text-gray-500">
      <span>{label}</span>
      <b className={!known ? 'text-gray-400' : ok ? 'text-emerald-600' : 'text-rose-600'}>
        {!known ? `${EM} not read` : ok ? 'Clear' : bad}
      </b>
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
