/**
 * Team goals (Settings → Team).
 * Weekly targets for inventory counts and par compliance — separate from labor prefs.
 */
import { useEffect, useState } from 'react'
import { Target } from 'lucide-react'
import { toast } from 'sonner'
import { useUserPreferences } from '../../hooks/useUserPreferences'

type TeamGoals = {
  weeklyCountTarget: number
  parComplianceTargetPct: number
  trainingCompletionTargetPct: number
}

const DEFAULTS: TeamGoals = {
  weeklyCountTarget: 2,
  parComplianceTargetPct: 95,
  trainingCompletionTargetPct: 80,
}

export function TeamGoalsSettings() {
  const { preferences, updatePreferences } = useUserPreferences()
  const stored = (preferences.teamGoals ?? {}) as Partial<TeamGoals>
  const [goals, setGoals] = useState<TeamGoals>({ ...DEFAULTS, ...stored })

  useEffect(() => {
    setGoals((prev) => ({ ...prev, ...stored }))
  }, [preferences.teamGoals])

  const save = (patch: Partial<TeamGoals>) => {
    const next = { ...goals, ...patch }
    setGoals(next)
    updatePreferences({ teamGoals: next })
    toast.success('Team goals updated')
  }

  return (
    <div className="mb-5 p-4 rounded-xl border border-gray-100 bg-gray-50/60">
      <div className="flex items-center gap-1.5 mb-1">
        <Target className="w-3.5 h-3.5 text-wine-500" />
        <div className="text-xs font-bold uppercase tracking-wider text-gray-400">Goals</div>
      </div>
      <p className="text-xs text-gray-400 mb-3">
        Targets shown on the team pulse. Adjust anytime — they do not auto-enforce.
      </p>

      <div className="space-y-3">
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-medium text-gray-800">Weekly inventory counts</span>
            <span className="block text-xs text-gray-400">How many full counts per week</span>
          </span>
          <input
            type="number"
            min={0}
            max={14}
            value={goals.weeklyCountTarget}
            onChange={(e) => setGoals((g) => ({ ...g, weeklyCountTarget: Number(e.target.value) || 0 }))}
            onBlur={() => save({ weeklyCountTarget: goals.weeklyCountTarget })}
            className="w-16 px-2 py-1.5 rounded-lg border border-gray-200 text-sm font-semibold text-gray-900 text-right focus:ring-2 focus:ring-wine-500 outline-none"
          />
        </label>

        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-medium text-gray-800">Par compliance</span>
            <span className="block text-xs text-gray-400">Target % of SKUs at or above par</span>
          </span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              max={100}
              value={goals.parComplianceTargetPct}
              onChange={(e) =>
                setGoals((g) => ({ ...g, parComplianceTargetPct: Number(e.target.value) || 0 }))
              }
              onBlur={() => save({ parComplianceTargetPct: goals.parComplianceTargetPct })}
              className="w-16 px-2 py-1.5 rounded-lg border border-gray-200 text-sm font-semibold text-gray-900 text-right focus:ring-2 focus:ring-wine-500 outline-none"
            />
            <span className="text-xs text-gray-400">%</span>
          </div>
        </label>

        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-medium text-gray-800">Training completion</span>
            <span className="block text-xs text-gray-400">Staff wine-training target</span>
          </span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              max={100}
              value={goals.trainingCompletionTargetPct}
              onChange={(e) =>
                setGoals((g) => ({
                  ...g,
                  trainingCompletionTargetPct: Number(e.target.value) || 0,
                }))
              }
              onBlur={() => save({ trainingCompletionTargetPct: goals.trainingCompletionTargetPct })}
              className="w-16 px-2 py-1.5 rounded-lg border border-gray-200 text-sm font-semibold text-gray-900 text-right focus:ring-2 focus:ring-wine-500 outline-none"
            />
            <span className="text-xs text-gray-400">%</span>
          </div>
        </label>
      </div>
    </div>
  )
}
