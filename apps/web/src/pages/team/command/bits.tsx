/**
 * Shared building blocks for the Team command surface (sketch 038 port).
 * Week math, shift-state styling, and small presentational atoms.
 */
import { cn } from '../../../lib/utils'
import type { Shift, TeamMember } from '../../../services/api/team'

// ── Week math ──────────────────────────────────────────────────────────────
// Timezone-safe: we format from LOCAL y/m/d and anchor parsing at local noon,
// so a date never rolls to the previous/next day via a UTC round-trip
// (toISOString) in zones east or west of UTC.
const pad = (n: number) => String(n).padStart(2, '0')
function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
export function mondayOf(date = new Date()): string {
  const d = new Date(date)
  d.setHours(12, 0, 0, 0)
  const dow = d.getDay()
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow))
  return ymd(d)
}
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return ymd(d)
}
export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
}
export const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export function dayNum(iso: string): string {
  return String(new Date(iso + 'T12:00:00').getDate())
}
export function todayIso(): string {
  return ymd(new Date())
}
export function fmtWeekRange(weekStart: string): string {
  const end = addDays(weekStart, 6)
  const f = (iso: string) =>
    new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${f(weekStart)} – ${f(end)}`
}
export function fmtTime(t: string): string {
  const [h, m] = t.split(':').map((n) => parseInt(n, 10))
  const ampm = h >= 12 ? 'p' : 'a'
  const hh = h % 12 === 0 ? 12 : h % 12
  return m ? `${hh}:${String(m).padStart(2, '0')}${ampm}` : `${hh}${ampm}`
}
export function shiftHours(s: Shift): number {
  const [sh, sm] = s.start_time.split(':').map(Number)
  const [eh, em] = s.end_time.split(':').map(Number)
  let diff = eh * 60 + em - (sh * 60 + sm)
  if (diff < 0) diff += 1440
  return diff / 60
}

// ── Shift styling (matches sketch semantic states) ───────────────────────────
export const SHIFT_STYLES: Record<string, string> = {
  am: 'bg-blue-50 text-blue-700',
  pm: 'bg-wine-50 text-wine-700',
  double: 'bg-violet-50 text-violet-700',
  split: 'bg-amber-50 text-amber-700',
  training: 'bg-gray-100 text-gray-600 border border-dashed border-gray-300',
  borrowed: 'bg-emerald-50 text-emerald-700 border border-dashed border-emerald-300',
  open: 'bg-rose-50 text-rose-600 border border-dashed border-rose-300',
}
export function shiftClass(s: Shift): string {
  if (s.state === 'callout') return 'bg-rose-50 text-rose-600 line-through opacity-80'
  if (s.state === 'open' || !s.member_id) return SHIFT_STYLES.open
  return SHIFT_STYLES[s.shift_type] ?? SHIFT_STYLES.pm
}

// ── Atoms ────────────────────────────────────────────────────────────────
export function Avatar({ member, owner }: { member?: Pick<TeamMember, 'display_name' | 'avatar_url'>; owner?: boolean }) {
  const initials = (member?.display_name ?? '?')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return (
    <div
      className={cn(
        'grid place-items-center w-7 h-7 shrink-0 rounded-full border text-[10px] font-extrabold',
        owner ? 'border-wine-200 bg-wine-50 text-wine-700' : 'border-gray-200 bg-gray-100 text-gray-600',
      )}
    >
      {member?.avatar_url ? (
        <img src={member.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
      ) : (
        initials
      )}
    </div>
  )
}

export function Pill({
  children,
  tone = 'gray',
}: {
  children: React.ReactNode
  tone?: 'gray' | 'wine' | 'green' | 'amber' | 'red' | 'blue' | 'violet'
}) {
  const tones: Record<string, string> = {
    gray: 'bg-gray-100 text-gray-600',
    wine: 'bg-wine-50 text-wine-700',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-rose-50 text-rose-600',
    blue: 'bg-blue-50 text-blue-700',
    violet: 'bg-violet-50 text-violet-700',
  }
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold', tones[tone])}>
      {children}
    </span>
  )
}

export function PulseCell({
  label,
  value,
  sub,
  tone = 'default',
  onClick,
}: {
  label: string
  value: React.ReactNode
  sub?: string
  tone?: 'default' | 'warn' | 'danger'
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left px-3.5 py-3 border-r border-gray-100 last:border-r-0 hover:bg-gray-50 transition-colors min-w-0"
    >
      <div className="text-[9px] font-bold uppercase tracking-wider text-gray-400">{label}</div>
      <div
        className={cn(
          'mt-1 text-sm font-extrabold tabular-nums tracking-tight',
          tone === 'warn' && 'text-amber-600',
          tone === 'danger' && 'text-rose-600',
          tone === 'default' && 'text-gray-900',
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[9px] font-semibold text-gray-400 truncate">{sub}</div>}
    </button>
  )
}
