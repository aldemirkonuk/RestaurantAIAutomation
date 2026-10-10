/**
 * Team labor preferences (Settings → Team).
 * Persists to Supabase `team_settings` via PATCH /team/:rid/settings.
 *
 * The "Show hourly wages" switch is gone (ADR 0215). Wages and labour cost are
 * the owner's by role — founder, 2026-09-21: "Owner only" — so there is nothing
 * to switch, and the gateway refuses the old field in words.
 *
 * Only the owner switches labour-cost tracking off or changes the labour target
 * (ADR 0215; founder 2026-09-21, "Take all five"). The gateway refuses a
 * manager's attempt before it writes; this page reads `mayChange` from the
 * settings reply and does not offer what would be refused, and says why.
 *
 * Double booking (ADR 0215 item 27; founder 2026-09-28: "owner has a say to
 * change it into warn all four to allow double booking"): the owner's switch,
 * off by default. Off, "Replace with" on the remove dialog refuses a shift
 * that overlaps one the chosen person already has; on, it only warns.
 *
 * The labour target box starts EMPTY when nobody has set a target (F-352). It
 * started at '28', so Settings showed a figure nobody chose while /team said
 * none was on file, and focusing the box and leaving it saved that 28. A
 * stored 28 nobody chose (the column default) is shown empty too, by the same
 * rule /team reads it with, and leaving the box untouched sends nothing.
 */
import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { getTeamSettings, updateTeamSettings, type TeamSettings as SharedTeamSettings } from '../../services/api/team'
import { useAuth } from '../../contexts/AuthContext'
import { readLabourTarget } from '../../pages/team/next/useTeamNextData'

/**
 * The settings as the gateway answers them, with `labor_target_chosen`: whether
 * anyone ever set the target (F-352); `null` when that could not be read.
 */
type TeamSettings = SharedTeamSettings & { labor_target_chosen?: boolean | null }

/** The target as the box shows it: '' when there is none to speak of. */
function shownTarget(s: Pick<TeamSettings, 'labor_target_pct' | 'labor_target_chosen'> | undefined): string {
  const raw = s?.labor_target_pct
  const pct = readLabourTarget(raw == null ? null : Number(raw), s?.labor_target_chosen === true).pct
  return pct === null ? '' : String(pct)
}

function Toggle({
  on,
  onChange,
  label,
  hint,
  disabled = false,
}: {
  on: boolean
  onChange: (v: boolean) => void
  label: string
  hint: string
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div>
        <div className="text-sm font-medium text-gray-800">{label}</div>
        <div className="text-xs text-gray-400">{hint}</div>
      </div>
      <button
        type="button"
        onClick={() => onChange(!on)}
        disabled={disabled}
        className={`relative w-10 h-6 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-wine-600' : 'bg-gray-300'}`}
        aria-pressed={on}
        aria-label={label}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${on ? 'translate-x-4' : ''}`} />
      </button>
    </div>
  )
}

export function TeamLaborSettings() {
  const { activeRestaurantId } = useAuth()
  const qc = useQueryClient()
  const { data, isLoading, isError } = useQuery<TeamSettings>({
    queryKey: ['team', 'settings', activeRestaurantId],
    queryFn: () => getTeamSettings(),
    enabled: !!activeRestaurantId,
  })
  const [targetPct, setTargetPct] = useState<string>('')

  useEffect(() => {
    setTargetPct(shownTarget(data))
  }, [data?.labor_target_pct, data?.labor_target_chosen])

  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => updateTeamSettings(patch),
    onSuccess: (saved) => {
      toast.success('Team preferences saved')
      if (saved) setTargetPct(shownTarget(saved))
      qc.invalidateQueries({ queryKey: ['team', 'settings'] })
      qc.invalidateQueries({ queryKey: ['team', 'week'] })
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || 'Your team preferences could not be saved. Please try again.'
      toast.error(msg)
    },
  })

  if (!activeRestaurantId) return null
  if (isLoading) {
    return (
      <div className="mb-5 p-4 rounded-xl border border-gray-100 bg-gray-50/60 text-xs text-gray-400">
        Loading labor settings…
      </div>
    )
  }
  if (isError || !data) {
    return (
      <div className="mb-5 p-4 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-800">
        Your labour settings could not be loaded, so they cannot be changed right now. Please try again
        in a moment.
      </div>
    )
  }

  // What this viewer may change. An older gateway that does not say gets
  // nothing offered: a switch the gateway refuses is worse than none.
  const may = data.mayChange ?? { trackingOff: false, trackingOn: false, target: false, doubleBooking: false }
  const trackingLocked = data.labor_tracking_enabled ? !may.trackingOff : !may.trackingOn

  const commitTarget = () => {
    if (!may.target) return
    const shown = shownTarget(data)
    // Left empty, or left as it was: nothing was chosen, so nothing is sent.
    if (targetPct.trim() === '' || targetPct === shown) {
      setTargetPct(shown)
      return
    }
    const n = Number(targetPct)
    if (!Number.isFinite(n) || n < 1 || n > 100) {
      toast.error('Labor target must be between 1 and 100')
      setTargetPct(shown)
      return
    }
    if (shown !== '' && n === Number(shown)) return
    save.mutate({ laborTargetPct: n })
  }

  return (
    <div className="mb-5 p-4 rounded-xl border border-gray-100 bg-gray-50/60">
      <div className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">Labor & scheduling</div>
      <Toggle
        on={data.labor_tracking_enabled}
        onChange={(v) => save.mutate({ laborTrackingEnabled: v })}
        disabled={trackingLocked || save.isPending}
        label="Labor cost tracking"
        hint={
          trackingLocked && data.labor_tracking_enabled
            ? 'Only the owner can switch labour-cost tracking off.'
            : "Show the week's labour cost and the labour lens to the owner. Off = hours only."
        }
      />
      <Toggle
        on={data.allow_double_booking === true}
        onChange={(v) => save.mutate({ allowDoubleBooking: v })}
        disabled={!may.doubleBooking || save.isPending}
        label="Allow double booking"
        hint={
          may.doubleBooking
            ? 'When someone leaves and their shifts go to a colleague, a shift that overlaps one the colleague already has is refused while this is off, and only warned about while it is on.'
            : 'Only the owner can change this. Off: a hand-over that would double-book someone is refused.'
        }
      />
      <div className="py-2.5 text-xs text-gray-500">
        Wages and labour cost are shown to the owner only, and only an owner can change a
        wage. Managers see hours.
      </div>
      {data.labor_tracking_enabled && (
        <div className="flex items-center justify-between gap-4 py-2.5 border-t border-gray-100 mt-1">
          <div>
            <div className="text-sm font-medium text-gray-800">Labor target %</div>
            <div className="text-xs text-gray-400">
              {may.target
                ? shownTarget(data) === ''
                  ? 'No target set. Type the share of sales you aim to spend on staff.'
                  : 'The share of sales you aim to spend on staff.'
                : 'Only the owner can change the labour target.'}
            </div>
          </div>
          <input
            type="number"
            min={1}
            max={100}
            step={0.5}
            value={targetPct}
            placeholder="—"
            disabled={save.isPending || !may.target}
            onChange={(e) => setTargetPct(e.target.value)}
            onBlur={commitTarget}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur()
              }
            }}
            aria-label="Labor target percent"
            className="w-20 h-8 px-2 border border-gray-200 rounded-lg text-sm tabular-nums text-right focus:ring-2 focus:ring-wine-500 outline-none disabled:opacity-50"
          />
        </div>
      )}
    </div>
  )
}
