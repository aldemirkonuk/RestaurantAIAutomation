/**
 * Team labor & wage visibility preferences (Settings → Team).
 * Managers can disable labor tracking / hide wages; the Manager Shift Desk
 * reads these flags and switches the labor lens to hours-only when off.
 */
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
  const { data } = useQuery<TeamSettings>({
    queryKey: ['team', 'settings', activeRestaurantId],
    queryFn: () => getTeamSettings(),
    enabled: !!activeRestaurantId,
  })
  const save = useMutation({
    mutationFn: (patch: Record<string, any>) => updateTeamSettings(patch),
    onSuccess: () => {
      toast.success('Team preferences updated')
      qc.invalidateQueries({ queryKey: ['team', 'settings'] })
      qc.invalidateQueries({ queryKey: ['team', 'week'] })
    },
    onError: () => toast.error('Could not update preferences'),
  })

  if (!data) return null
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
    </div>
  )
}
