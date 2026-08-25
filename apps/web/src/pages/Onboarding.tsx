import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthShell, AuthCard } from '../components/brand/AuthShell'
import { Button } from '../components/ui'
import { useOnboardingProgress } from '../hooks/queries/useOnboardingProgress'

export function Onboarding() {
  const navigate = useNavigate()
  const { progress, isLoading } = useOnboardingProgress()

  useEffect(() => {
    if (isLoading) return
    if (!progress?.menu_uploaded) {
      navigate('/get-started', { replace: true })
    }
  }, [progress, isLoading, navigate])

  return (
    <AuthShell
      title="Setup has moved"
      subtitle="Your checklist lives on the dashboard. Connect POS under Settings → Integrations."
    >
      <AuthCard className="flex flex-col gap-3">
        <Button onClick={() => navigate('/')} size="lg" className="w-full">
          Go to Dashboard →
        </Button>
        <Button variant="outline" size="lg" className="w-full" onClick={() => navigate('/get-started')}>
          Set up my wine list
        </Button>
      </AuthCard>
    </AuthShell>
  )
}
// Re-export context types so existing imports don't break
export { OnboardingProvider, useOnboarding, ONBOARDING_STEPS } from '../contexts/OnboardingContext'
export type { WineImportItem } from '../contexts/OnboardingContext'

