import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ProviderKnowledgePanel } from './ProviderKnowledgePanel'
import { ProviderPromotionsPanel } from './ProviderPromotionsPanel'
import { ProviderConversationMemory } from './ProviderConversationMemory'
import {
  triggerOutreach,
  triggerOnboarding,
} from '../../services/api/provider-intelligence'
import { getErrorMessage, isUnconfirmedWrite } from '../../services/api/client'

// The Sentiment tab retired on 2026-09-21 (ADR 0207, round 3). The founder:
// "sentiments are a must in our new page but not as in this design, the
// feature must stay, the current design can go" — and then, choosing its
// replacement, "A, Plus C's lines", on the vendor sheet only. The reading now
// lives in `pages/providers/next/scorecard/MailTone.tsx`, for owners and
// managers; the score-to-two-decimals, the arrow and the first-against-last
// trend it drew are gone with it.
type Tab = 'knowledge' | 'promotions' | 'conversations'

const TABS: { key: Tab; label: string }[] = [
  { key: 'knowledge', label: 'Digital Twin' },
  { key: 'promotions', label: 'Promotions' },
  { key: 'conversations', label: 'Conversations' },
]

interface Props {
  providerId: string
  providerName?: string
}

/** What one Actions tap did, in a line (F-568). */
function actionOutcome(result: { alreadyOpen?: boolean } | undefined, started: string): string {
  return result?.alreadyOpen ? 'Already under way with this vendor. Nothing new was started.' : started
}

function actionRefusal(error: unknown): string {
  // The gateway keeps one open request per kind, so asking again is safe.
  if (isUnconfirmedWrite(error)) return 'No answer came back. It may have started anyway; asking again will not start a second one.'
  return `Not started: ${getErrorMessage(error)}`
}

export function ProviderIntelligencePanel({ providerId, providerName }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('knowledge')
  const [showActions, setShowActions] = useState(false)
  const [outcome, setOutcome] = useState<string | null>(null)

  const outreachMutation = useMutation({
    mutationFn: (params: { type: string; topic?: string; label: string }) =>
      triggerOutreach(providerId, params.type, params.topic),
    onMutate: () => setOutcome(null),
    onSuccess: (result, params) => {
      setShowActions(false)
      setOutcome(actionOutcome(result, `${params.label} started.`))
    },
    onError: (error) => setOutcome(actionRefusal(error)),
  })

  const onboardMutation = useMutation({
    mutationFn: () => triggerOnboarding(providerId),
    onMutate: () => setOutcome(null),
    onSuccess: (result) => {
      setShowActions(false)
      setOutcome(actionOutcome(result, 'Onboarding started.'))
    },
    onError: (error) => setOutcome(actionRefusal(error)),
  })

  const actionPending = outreachMutation.isPending || onboardMutation.isPending

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">
            Provider Intelligence
          </h2>
          {providerName && (
            <p className="text-sm text-gray-500">{providerName}</p>
          )}
          {outcome && (
            <p role="status" className="text-sm text-gray-700 mt-1" data-testid="vendor-action-outcome">
              {outcome}
            </p>
          )}
        </div>
        <div className="relative">
          <button
            onClick={() => setShowActions(!showActions)}
            className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 transition-colors"
          >
            Actions
          </button>
          {showActions && (
            <div className="absolute right-0 mt-2 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
              <button
                onClick={() => outreachMutation.mutate({ type: 'relationship_building', topic: 'general check-in', label: 'Check-in' })}
                disabled={actionPending}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                General Check-in
              </button>
              <button
                onClick={() => outreachMutation.mutate({ type: 'promo_discovery', topic: 'current promotions', label: 'Promotions question' })}
                disabled={actionPending}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Ask About Promos
              </button>
              <button
                onClick={() => outreachMutation.mutate({ type: 'price_check', topic: 'updated pricing', label: 'Pricing request' })}
                disabled={actionPending}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Request Updated Pricing
              </button>
              <hr className="border-gray-100" />
              <button
                onClick={() => onboardMutation.mutate()}
                disabled={actionPending}
                className="w-full text-left px-4 py-2.5 text-sm text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-50"
              >
                Start Onboarding Flow
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="px-6 border-b border-gray-200">
        <nav className="flex gap-6">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="p-6">
        {activeTab === 'knowledge' && <ProviderKnowledgePanel providerId={providerId} />}
        {activeTab === 'promotions' && <ProviderPromotionsPanel providerId={providerId} mode="provider" />}
        {activeTab === 'conversations' && <ProviderConversationMemory providerId={providerId} />}
      </div>
    </div>
  )
}
