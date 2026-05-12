/**
 * Onboarding Page — slim redirect
 *
 * The 9-step wizard has been replaced by the /get-started menu import page
 * (Phase 28). This page handles bookmarks and old deep-links gracefully:
 * - Redirects to /get-started if menu not yet uploaded
 * - Shows a "Setup has moved" message with a dashboard link
 * - POS integration is now at Settings → Integrations
 *
 * OnboardingContext and ONBOARDING_STEPS are preserved for any components
 * that import them — they are not deleted, just no longer the primary path.
 */

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Wine } from 'lucide-react'
import { Button } from '../components/ui'
import { useOnboardingProgress } from '../hooks/queries/useOnboardingProgress'

export function Onboarding() {
  const navigate = useNavigate()
  const { progress, isLoading } = useOnboardingProgress()

  // Auto-redirect: no menu yet → /get-started; menu done → /
  useEffect(() => {
    if (isLoading) return
    if (!progress?.menu_uploaded) {
      navigate('/get-started', { replace: true })
    }
  }, [progress, isLoading, navigate])

  // Show "Setup has moved" while redirecting or for users already onboarded
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 bg-gradient-to-br from-gray-50 via-wine-50/30 to-gray-50">
    <motion.div
        initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
        className="text-center max-w-sm"
    >
        <div className="w-16 h-16 bg-gradient-to-br from-wine-500 to-wine-700 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
          <Wine className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Setup has moved</h1>
        <p className="text-gray-500 mb-6 leading-relaxed">
          Your setup checklist is now on the dashboard. To connect your POS system, visit{' '}
          <strong>Settings → Integrations</strong>.
        </p>
        <div className="flex flex-col gap-3">
          <Button
            onClick={() => navigate('/')}
            className="bg-wine-600 hover:bg-wine-700 text-white"
          >
            Go to Dashboard →
          </Button>
          <Button variant="outline" onClick={() => navigate('/get-started')}>
            Set up my wine list
          </Button>
        </div>
    </motion.div>
    </div>
  )
}

// Re-export context types so existing imports don't break
export { OnboardingProvider, useOnboarding, ONBOARDING_STEPS } from '../contexts/OnboardingContext'
export type { WineImportItem } from '../contexts/OnboardingContext'
