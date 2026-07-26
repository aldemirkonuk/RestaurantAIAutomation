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

  const activated = !!(
    progress?.menu_uploaded ||
    progress?.completed_at
  )
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
        navigate('/wineagent')
      }}
      aria-label="Wine Agent — inventory & ordering help"
      title="Wine Agent — inventory & ordering help"
      data-guidance="wine-agent-fab"
      className={cn(
        'fixed z-[40] right-5 w-12 h-12 rounded-full',
        'bg-[#722F37] text-white shadow-lg shadow-[#722F37]/25',
        'flex items-center justify-center',
        'hover:bg-[#8B3A44] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#722F37] focus-visible:ring-offset-2',
        'transition-all duration-200',
        offsetForTip ? 'bottom-24' : 'bottom-5',
        'mb-[env(safe-area-inset-bottom)]',
      )}
    >
      <Bot className="w-5 h-5" aria-hidden="true" />
    </button>
  )
}
