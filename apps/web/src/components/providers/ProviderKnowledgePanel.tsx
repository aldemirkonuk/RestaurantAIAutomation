import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchProviderKnowledge,
  verifyKnowledge,
  fetchContradictions,
  type KnowledgeGraph,
  type KnowledgeEntry,
} from '../../services/api/provider-intelligence'

const CATEGORY_LABELS: Record<string, string> = {
  company: 'Company Info',
  people: 'Contacts & People',
  wine_portfolio: 'Wine Portfolio',
  promotion: 'Promotions',
  pricing: 'Pricing',
  logistics: 'Logistics & Delivery',
  financial: 'Financial Terms',
  relationship: 'Relationship',
  compliance: 'Compliance',
}

const CATEGORY_COLORS: Record<string, string> = {
  company: 'bg-blue-50 text-blue-700 border-blue-200',
  people: 'bg-purple-50 text-purple-700 border-purple-200',
  wine_portfolio: 'bg-red-50 text-red-700 border-red-200',
  promotion: 'bg-green-50 text-green-700 border-green-200',
  pricing: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  logistics: 'bg-orange-50 text-orange-700 border-orange-200',
  financial: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  relationship: 'bg-pink-50 text-pink-700 border-pink-200',
  compliance: 'bg-gray-50 text-gray-700 border-gray-200',
}

interface Props {
  providerId: string
}

export function ProviderKnowledgePanel({ providerId }: Props) {
  const [activeCategory, setActiveCategory] = useState<string | undefined>()
  const [showContradictions, setShowContradictions] = useState(false)
  const queryClient = useQueryClient()

  const { data: knowledge, isLoading } = useQuery({
    queryKey: ['provider-knowledge', providerId, activeCategory],
    queryFn: () => fetchProviderKnowledge(providerId, activeCategory),
    enabled: !!providerId,
  })

  const { data: contradictions } = useQuery({
    queryKey: ['provider-contradictions', providerId],
    queryFn: () => fetchContradictions(providerId),
    enabled: !!providerId && showContradictions,
  })

  const verifyMutation = useMutation({
    mutationFn: (knowledgeId: string) => verifyKnowledge(providerId, knowledgeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['provider-knowledge', providerId] })
    },
  })

  const categories = knowledge ? Object.keys(knowledge) : []
  const totalEntries = knowledge
    ? Object.values(knowledge).reduce((sum, entries) => sum + entries.length, 0)
    : 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Digital Twin</h3>
          <p className="text-sm text-gray-500">
            {totalEntries} knowledge entries across {categories.length} categories
          </p>
        </div>
        <button
          onClick={() => setShowContradictions(!showContradictions)}
          className="px-3 py-1.5 text-sm rounded-md border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
        >
          {showContradictions ? 'Hide' : 'Show'} Contradictions
        </button>
      </div>

      {/* Category Filter */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setActiveCategory(undefined)}
          className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
            !activeCategory
              ? 'bg-gray-900 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          All
        </button>
        {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveCategory(key === activeCategory ? undefined : key)}
            className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
              activeCategory === key
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Contradictions Alert */}
      {showContradictions && contradictions && contradictions.length > 0 && (
        <div className="border border-amber-200 bg-amber-50 rounded-lg p-4 space-y-3">
          <h4 className="font-medium text-amber-800">
            {contradictions.length} Unresolved Contradictions
          </h4>
          {contradictions.map((c: any) => (
            <div key={c.id} className="bg-white rounded-md p-3 border border-amber-200">
              <p className="text-sm font-medium text-gray-900">{c.label}</p>
              <div className="mt-1 flex gap-4 text-xs text-gray-500">
                <span>Previous: {JSON.stringify(c.previous_value)}</span>
                <span>Current: {JSON.stringify(c.attributes)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Knowledge Entries */}
      {isLoading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin h-6 w-6 border-2 border-gray-300 border-t-gray-900 rounded-full" />
        </div>
      ) : knowledge && categories.length > 0 ? (
        <div className="space-y-4">
          {categories.map((category) => (
            <div key={category} className="space-y-2">
              <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                {CATEGORY_LABELS[category] || category}
                <span className="ml-2 text-gray-400 font-normal">
                  ({(knowledge as KnowledgeGraph)[category].length})
                </span>
              </h4>
              <div className="grid gap-2">
                {(knowledge as KnowledgeGraph)[category].map((entry: KnowledgeEntry) => (
                  <div
                    key={entry.id}
                    className={`border rounded-lg p-3 ${CATEGORY_COLORS[category] || 'bg-gray-50 text-gray-700 border-gray-200'}`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{entry.label}</p>
                        {entry.subcategory && (
                          <p className="text-xs opacity-70">{entry.subcategory}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 ml-2">
                        <span className="text-xs opacity-60">
                          {Math.round(entry.confidence * 100)}%
                        </span>
                        {entry.verified ? (
                          <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                            Verified
                          </span>
                        ) : (
                          <button
                            onClick={() => verifyMutation.mutate(entry.id)}
                            className="text-xs bg-white/50 hover:bg-white px-1.5 py-0.5 rounded border border-current/20 transition-colors"
                          >
                            Verify
                          </button>
                        )}
                      </div>
                    </div>
                    {entry.attributes && Object.keys(entry.attributes).length > 0 && (
                      <div className="mt-2 text-xs opacity-80">
                        {Object.entries(entry.attributes)
                          .slice(0, 4)
                          .map(([key, val]) => (
                            <span key={key} className="inline-block mr-3">
                              <span className="font-medium">{key}:</span>{' '}
                              {String(val)}
                            </span>
                          ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-gray-400">
          <p>No knowledge entries yet.</p>
          <p className="text-sm mt-1">
            Intelligence will be extracted automatically from conversations.
          </p>
        </div>
      )}
    </div>
  )
}
