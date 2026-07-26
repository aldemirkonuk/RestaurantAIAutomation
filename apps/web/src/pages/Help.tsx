import { useNavigate } from 'react-router-dom'
import { BookOpen, Rocket, Shield, Bot, HelpCircle } from 'lucide-react'
import { Header } from '../components/layout/Header'
import { Button } from '../components/ui/button'
import { trackGuidance } from '../guidance/analytics'

/**
 * Help & Support — recovery entry for Learn, Get Started, Services, and Wine Agent.
 * No product tours auto-fire here; consent stays in Settings → Services.
 */
export default function Help() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen">
      <Header
        title="Help & Support"
        subtitle="Learn WineOps, manage permissions, and find Wine Agent"
      />
      <div className="max-w-3xl mx-auto p-6 space-y-4">
        <div className="rounded-xl border border-gray-200 bg-white p-5 flex gap-4">
          <BookOpen className="w-6 h-6 text-[#722F37] flex-shrink-0" />
          <div className="flex-1">
            <h2 className="font-semibold text-gray-900">Learn & page tours</h2>
            <p className="text-sm text-gray-500 mt-1">
              Open Learn & Help in the sidebar to replay page tours, reset tips, or show the
              Wine Agent button again.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 flex gap-4 items-start">
          <Rocket className="w-6 h-6 text-[#722F37] flex-shrink-0" />
          <div className="flex-1">
            <h2 className="font-semibold text-gray-900">Get started guide</h2>
            <p className="text-sm text-gray-500 mt-1 mb-3">
              Activate your wine list and walk through how to use inventory, orders, and more.
            </p>
            <Button
              onClick={() => {
                trackGuidance('guide_card_clicked', { cardId: 'help-get-started' })
                navigate('/get-started?tab=use')
              }}
            >
              Open app guide
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 flex gap-4 items-start">
          <Shield className="w-6 h-6 text-[#722F37] flex-shrink-0" />
          <div className="flex-1">
            <h2 className="font-semibold text-gray-900">Services & permissions</h2>
            <p className="text-sm text-gray-500 mt-1 mb-3">
              Control email, web, and privacy access. Separate from product tours — Wine Agent
              does not grant email access.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                trackGuidance('services_visited', { source: 'help' })
                navigate('/settings?tab=services')
              }}
            >
              Manage services
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 flex gap-4 items-start">
          <Bot className="w-6 h-6 text-[#722F37] flex-shrink-0" />
          <div className="flex-1">
            <h2 className="font-semibold text-gray-900">Wine Agent</h2>
            <p className="text-sm text-gray-500 mt-1 mb-3">
              Inventory & ordering help entry. After activation, a small circle appears
              bottom-right — or open it here.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                trackGuidance('wine_agent_fab_clicked', { source: 'help' })
                navigate('/wineagent')
              }}
            >
              Open Wine Agent
            </Button>
          </div>
        </div>

        <p className="text-xs text-gray-400 flex items-center gap-1.5 pt-2">
          <HelpCircle className="w-3.5 h-3.5" />
          Prefer no tips? Dismiss them once — recover anytime from Learn & Help.
        </p>
      </div>
    </div>
  )
}
