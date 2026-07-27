import { useNavigate, useLocation } from 'react-router-dom'
import { Bot } from 'lucide-react'
import { useGuidanceOptional } from '../GuidanceProvider'
import { useOnboardingProgress } from '../../hooks/queries/useOnboardingProgress'
import { trackGuidance } from '../analytics'
import { cn } from '../../lib/utils'

const HIDDEN_PATHS = ['/get-started', '/login', '/register', '/verify-email', '/onboarding']

export function WineAgentFab() {
  const navigate = useNavigate()
  const location = useLocation()
  const guidance = useGuidanceOptional()
  const { progress } = useOnboardingProgress()

  // "Activated" = menu uploaded AND a low-stock threshold explicitly set —
  // completed_at (all 4 checklist tasks done) always implies this too.
  const activated = !!(progress?.activated || progress?.completed_at)
  const unlocked = !!guidance?.state.global.wine_agent_fab_unlocked
  const showFabPref = guidance?.state.global.show_wine_agent_fab !== false
  const onServices =
    location.pathname === '/settings' &&
    new URLSearchParams(location.search).get('tab') === 'services'
  const hiddenRoute = HIDDEN_PATHS.some((p) => location.pathname.startsWith(p))

  if ((!activated && !unlocked) || !showFabPref || hiddenRoute || onServices) {
    return null
  }

  const offsetForTip = guidance?.tipOffsetFab

  return (
    <button
      type="button"
      onClick={() => {
        trackGuidance('wine_agent_fab_clicked')
        // /wineagent is still a placeholder (App.tsx) — Sommelier AI is the
        // real inventory & ordering help surface today.
        navigate('/sommelier')
      }}
      aria-label="Wine Agent — inventory & ordering help"
      title="Wine Agent — inventory & ordering help"
      data-guidance="wine-agent-fab"
      className={cn(
        'fixed z-[40] right-5 w-12 h-12 rounded-full',
        'bg-[#9E4249] text-white shadow-lg shadow-[#9E4249]/25',
        'flex items-center justify-center',
        'hover:bg-[#B85055] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9E4249] focus-visible:ring-offset-2',
        'transition-all duration-200',
        offsetForTip ? 'bottom-24' : 'bottom-5',
        'mb-[env(safe-area-inset-bottom)]',
      )}
    >
      <Bot className="w-5 h-5" aria-hidden="true" />
    </button>
  )
}
