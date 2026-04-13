import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ProviderKnowledgePanel } from './ProviderKnowledgePanel'
import { ProviderPromotionsPanel } from './ProviderPromotionsPanel'
import { ProviderConversationMemory } from './ProviderConversationMemory'
import { ProviderSentimentChart } from './ProviderSentimentChart'
import {
  triggerOutreach,
  triggerOnboarding,
} from '../../services/api/provider-intelligence'

type Tab = 'knowledge' | 'promotions' | 'conversations' | 'sentiment'

const TABS: { key: Tab; label: string }[] = [
  { key: 'knowledge', label: 'Digital Twin' },
  { key: 'promotions', label: 'Promotions' },
  { key: 'conversations', label: 'Conversations' },
  { key: 'sentiment', label: 'Sentiment' },
]

interface Props {
  providerId: string
  providerName?: string
}

export function ProviderIntelligencePanel({ providerId, providerName }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('knowledge')
  const [showActions, setShowActions] = useState(false)

  const outreachMutation = useMutation({
    mutationFn: (params: { type: string; topic?: string }) =>
      triggerOutreach(providerId, params.type, params.topic),
    onSuccess: () => setShowActions(false),
  })

  const onboardMutation = useMutation({
    mutationFn: () => triggerOnboarding(providerId),
    onSuccess: () => setShowActions(false),
  })

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
                onClick={() => outreachMutation.mutate({ type: 'relationship_building', topic: 'general check-in' })}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors"
              >
                General Check-in
              </button>
              <button
                onClick={() => outreachMutation.mutate({ type: 'promo_discovery', topic: 'current promotions' })}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors"
              >
                Ask About Promos
              </button>
              <button
                onClick={() => outreachMutation.mutate({ type: 'price_check', topic: 'updated pricing' })}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors"
              >
                Request Updated Pricing
              </button>
              <hr className="border-gray-100" />
              <button
                onClick={() => onboardMutation.mutate()}
                className="w-full text-left px-4 py-2.5 text-sm text-blue-600 hover:bg-blue-50 transition-colors"
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
        {activeTab === 'sentiment' && <ProviderSentimentChart providerId={providerId} />}
      </div>
    </div>
  )
}
