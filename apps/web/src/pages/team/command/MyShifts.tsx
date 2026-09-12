/**
 * Staff view of /team — read-only "My Shifts": my week, open shifts I can
 * claim, and my acknowledgement of the published schedule.
 */
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CalendarDays, ChevronLeft, ChevronRight, Check, Hand } from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import {
  getMyWeek, acknowledgeSchedule, assignCover, createTimeOff,
  type MyWeekPayload,
} from '../../../services/api/team'
import { cn } from '../../../lib/utils'
import { mondayOf, addDays, weekDays, DOW, dayNum, fmtWeekRange, fmtTime, shiftClass } from './bits'

export function MyShifts() {
  const { activeRestaurantId } = useAuth()
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const [weekStart, setWeekStart] = useState(() => mondayOf())

  useEffect(() => {
    const w = params.get('week')
    if (w && /^\d{4}-\d{2}-\d{2}$/.test(w)) setWeekStart(mondayOf(new Date(w + 'T12:00:00')))
  }, [params])

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['team', 'my-week', activeRestaurantId, weekStart],
    queryFn: () => getMyWeek(weekStart),
    enabled: !!activeRestaurantId,
  })

  const payload = data as MyWeekPayload | undefined
  const days = useMemo(() => weekDays(weekStart), [weekStart])
  // A failed fetch rendered seven days of "Off" — a staff member's whole week
  // said to be free because the gateway was down. "Could not be refreshed" and
  // "nothing below is claimed" are different sentences (ADR 0051).
  const weekUnknown = isError && !payload

  const ack = useMutation({
    mutationFn: (scheduleId: string) => acknowledgeSchedule(scheduleId),
    onSuccess: () => {
      toast.success('Schedule acknowledged')
      qc.invalidateQueries({ queryKey: ['team', 'my-week'] })
    },
    onError: () => toast.error('Could not acknowledge the schedule'),
  })
  const claim = useMutation({
    mutationFn: ({ shiftId, memberId }: { shiftId: string; memberId: string }) =>
      assignCover(shiftId, memberId),
    onSuccess: () => {
      toast.success('Shift claimed — see you then!')
      qc.invalidateQueries({ queryKey: ['team', 'my-week'] })
    },
    onError: () => toast.error('Could not claim shift'),
  })

  const requestOff = useMutation({
    mutationFn: (memberId: string) =>
      createTimeOff({ memberId, startDate: days[0], endDate: days[6], reason: 'Requested from My Shifts' }),
    onSuccess: () => toast.success('Time-off request sent to your manager'),
    onError: () => toast.error('Could not send request'),
  })

  const memberId = payload?.member?.id

  return (
    <div className="p-6 max-w-[900px] mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">My Shifts</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {payload?.member?.display_name ?? 'Your'} schedule ·{' '}
            <span className="tabular-nums">{fmtWeekRange(weekStart)}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="w-9 h-9 grid place-items-center border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button onClick={() => setWeekStart(mondayOf())} className="h-9 px-3 border border-gray-200 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-50">
            This week
          </button>
          <button onClick={() => setWeekStart(addDays(weekStart, 7))} className="w-9 h-9 grid place-items-center border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {isError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 mb-4 p-3.5 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-700"
        >
          <span>
            {payload
              ? `Your week could not be refreshed (${error instanceof Error ? error.message : 'unknown error'}) — what is below is the last answer, not the present.`
              : `Your week could not be loaded (${error instanceof Error ? error.message : 'unknown error'}). Nothing below is claimed — this is not a week off.`}
          </span>
          <button
            onClick={() => void refetch()}
            className="h-8 px-3 shrink-0 border border-gray-200 bg-white rounded-lg text-xs font-bold text-gray-600 hover:bg-gray-100"
          >
            Try again
          </button>
        </div>
      )}

      {/* Acknowledge banner */}
      {payload?.schedule?.status === 'published' && !payload.acknowledged && (
        <div className="flex items-center justify-between gap-3 mb-4 p-3.5 rounded-xl border border-wine-100 bg-wine-50/60">
          <div className="flex items-center gap-2 text-sm text-wine-800">
            <CalendarDays className="w-4 h-4" />
            The week of {payload.schedule.week_start} is published.
          </div>
          <button
            onClick={() => payload.schedule && ack.mutate(payload.schedule.id)}
            disabled={ack.isPending}
            className="inline-flex items-center gap-1.5 h-8 px-3 bg-wine-600 text-white rounded-lg text-xs font-bold hover:bg-wine-700"
          >
            <Check className="w-3.5 h-3.5" /> Got it
          </button>
        </div>
      )}
      {payload?.schedule?.status === 'published' && payload.acknowledged && (
        <div className="flex items-center gap-2 mb-4 p-3 rounded-xl border border-emerald-100 bg-emerald-50/60 text-sm text-emerald-800">
          <Check className="w-4 h-4" /> You&apos;ve acknowledged this week&apos;s schedule.
        </div>
      )}

      {isLoading ? (
        <div className="p-10 text-center text-sm text-gray-400">Loading your week…</div>
      ) : (
        <div className="space-y-2.5">
          {days.map((d, i) => {
            const mine = (payload?.mine ?? []).filter((s) => s.shift_date === d)
            return (
              <div key={d} className="flex items-stretch gap-3 rounded-xl border border-gray-100 bg-white p-3">
                <div className="w-14 text-center shrink-0">
                  <div className="text-[10px] font-bold uppercase text-gray-400">{DOW[i]}</div>
                  <div className="text-lg font-extrabold tabular-nums text-gray-900">{dayNum(d)}</div>
                </div>
                <div className="flex-1 flex flex-wrap items-center gap-2">
                  {mine.length === 0 && (
                    <span className="text-xs text-gray-300">
                      {weekUnknown ? '— not known' : 'Off'}
                    </span>
                  )}
                  {mine.map((s) => (
                    <div key={s.id} className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold', shiftClass(s))}>
                      <span className="font-extrabold tabular-nums">
                        {fmtTime(s.start_time)}–{fmtTime(s.end_time)}
                      </span>
                      {s.role && <span className="ml-1.5 opacity-75">{s.role}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Open shifts I can claim */}
      {(payload?.open ?? []).length > 0 && memberId && (
        <div className="mt-6">
          <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">Open shifts you can pick up</h2>
          <div className="space-y-2">
            {payload!.open.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 rounded-xl border border-rose-100 bg-rose-50/50 p-3">
                <div className="text-sm">
                  <span className="font-bold text-gray-900">
                    {new Date(s.shift_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </span>
                  <span className="ml-2 tabular-nums text-gray-600">{fmtTime(s.start_time)}–{fmtTime(s.end_time)}</span>
                  {s.role && <span className="ml-2 text-gray-500">{s.role}</span>}
                </div>
                <button
                  onClick={() => claim.mutate({ shiftId: s.id, memberId })}
                  disabled={claim.isPending}
                  className="inline-flex items-center gap-1.5 h-8 px-3 bg-gray-900 text-white rounded-lg text-xs font-bold hover:bg-gray-800"
                >
                  <Hand className="w-3.5 h-3.5" /> Claim
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {memberId && (
        <div className="mt-6">
          <button
            onClick={() => requestOff.mutate(memberId)}
            disabled={requestOff.isPending}
            className="h-9 px-4 border border-gray-200 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-50"
          >
            Request time off this week
          </button>
        </div>
      )}
    </div>
  )
}
