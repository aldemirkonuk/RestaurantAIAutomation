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
 */
import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { getTeamSettings, updateTeamSettings, type TeamSettings } from '../../services/api/team'
import { useAuth } from '../../contexts/AuthContext'

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
  const { data, isLoading, isError, error } = useQuery<TeamSettings>({
    queryKey: ['team', 'settings', activeRestaurantId],
    queryFn: () => getTeamSettings(),
    enabled: !!activeRestaurantId,
  })
  const [targetPct, setTargetPct] = useState<string>('28')

  useEffect(() => {
    if (data?.labor_target_pct != null) {
      setTargetPct(String(data.labor_target_pct))
    }
  }, [data?.labor_target_pct])

  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => updateTeamSettings(patch),
    onSuccess: (saved) => {
      toast.success('Team preferences saved')
      if (saved?.labor_target_pct != null) {
        setTargetPct(String(saved.labor_target_pct))
      }
      qc.invalidateQueries({ queryKey: ['team', 'settings'] })
      qc.invalidateQueries({ queryKey: ['team', 'week'] })
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || 'Could not update preferences — check Supabase team_settings'
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
        Couldn’t load labor settings
        {error instanceof Error ? `: ${error.message}` : ''}. Labor target won’t persist until the API can reach{' '}
        <code className="font-mono">team_settings</code>.
      </div>
    )
  }

  // What this viewer may change. An older gateway that does not say gets
  // nothing offered: a switch the gateway refuses is worse than none.
  const may = data.mayChange ?? { trackingOff: false, trackingOn: false, target: false }
  const trackingLocked = data.labor_tracking_enabled ? !may.trackingOff : !may.trackingOn

  const commitTarget = () => {
    if (!may.target) return
    const n = Number(targetPct)
    if (!Number.isFinite(n) || n < 1 || n > 100) {
      toast.error('Labor target must be between 1 and 100')
      setTargetPct(String(data.labor_target_pct))
      return
    }
    if (n === Number(data.labor_target_pct)) return
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
                ? 'Saved to Supabase · used on Service Pulse'
                : 'Only the owner can change the labour target.'}
            </div>
          </div>
          <input
            type="number"
            min={1}
            max={100}
            step={0.5}
            value={targetPct}
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
