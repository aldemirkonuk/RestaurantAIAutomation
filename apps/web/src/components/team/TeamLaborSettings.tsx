/**
 * Team labor & wage visibility preferences (Settings → Team).
 * Persists to Supabase `team_settings` via PATCH /team/:rid/settings.
 */
import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { getTeamSettings, updateTeamSettings, type TeamSettings } from '../../services/api/team'
import { useAuth } from '../../contexts/AuthContext'

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div>
        <div className="text-sm font-medium text-gray-800">{label}</div>
        <div className="text-xs text-gray-400">{hint}</div>
      </div>
      <button
        type="button"
        onClick={() => onChange(!on)}
        className={`relative w-10 h-6 rounded-full transition-colors ${on ? 'bg-wine-600' : 'bg-gray-300'}`}
        aria-pressed={on}
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

  const commitTarget = () => {
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
        label="Labor cost tracking"
        hint="Show labor $ and the labor lens on the schedule. Off = hours only."
      />
      <Toggle
        on={data.wage_visible}
        onChange={(v) => save.mutate({ wageVisible: v })}
        label="Show hourly wages"
        hint="Display wages in member profiles (owner/manager only)."
      />
      {data.labor_tracking_enabled && (
        <div className="flex items-center justify-between gap-4 py-2.5 border-t border-gray-100 mt-1">
          <div>
            <div className="text-sm font-medium text-gray-800">Labor target %</div>
            <div className="text-xs text-gray-400">Saved to Supabase · used on Service Pulse</div>
          </div>
          <input
            type="number"
            min={1}
            max={100}
            step={0.5}
            value={targetPct}
            disabled={save.isPending}
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
