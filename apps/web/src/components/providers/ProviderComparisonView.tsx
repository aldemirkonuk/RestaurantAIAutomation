import { useQuery } from '@tanstack/react-query'
import {
  fetchProviderComparison,
  fetchLeverageSignals,
  type ProviderComparison,
} from '../../services/api/provider-intelligence'

export function ProviderComparisonView() {
  const { data: providers, isLoading } = useQuery({
    queryKey: ['provider-comparison'],
    queryFn: () => fetchProviderComparison(),
  })

  const { data: leverageSignals } = useQuery({
    queryKey: ['leverage-signals'],
    queryFn: fetchLeverageSignals,
  })

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin h-8 w-8 border-2 border-gray-300 border-t-gray-900 rounded-full" />
      </div>
    )
  }

  const sorted = [...(providers || [])].sort(
    (a, b) => (b.avgSentiment ?? 0) - (a.avgSentiment ?? 0),
  )

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Provider Comparison</h3>
        <p className="text-sm text-gray-500">
          Side-by-side comparison across {sorted.length} providers
        </p>
      </div>

      {/* Comparison Table */}
      {sorted.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-4 font-medium text-gray-500">Provider</th>
                <th className="text-center py-3 px-4 font-medium text-gray-500">Tier</th>
                <th className="text-center py-3 px-4 font-medium text-gray-500">Reliability</th>
                <th className="text-center py-3 px-4 font-medium text-gray-500">Sentiment</th>
                <th className="text-center py-3 px-4 font-medium text-gray-500">Active Promos</th>
                <th className="text-center py-3 px-4 font-medium text-gray-500">Lead Time</th>
                <th className="text-center py-3 px-4 font-medium text-gray-500">Min Order</th>
                <th className="text-center py-3 px-4 font-medium text-gray-500">Knowledge</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((provider: ProviderComparison) => (
                <tr key={provider.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-3 px-4">
                    <p className="font-medium text-gray-900">{provider.name}</p>
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      provider.tier === 'gold' ? 'bg-amber-100 text-amber-700' :
                      provider.tier === 'silver' ? 'bg-gray-200 text-gray-700' :
                      provider.tier === 'platinum' ? 'bg-indigo-100 text-indigo-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {provider.tier || 'N/A'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center">
                    {provider.reliability_score != null ? (
                      <div className="flex items-center justify-center gap-1">
                        <div className="w-16 bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-green-500 h-2 rounded-full"
                            style={{ width: `${provider.reliability_score}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-500">
                          {provider.reliability_score}%
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">N/A</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-center">
                    {provider.avgSentiment != null ? (
                      <span className={`font-medium ${
                        provider.avgSentiment > 0.2 ? 'text-green-600' :
                        provider.avgSentiment < -0.2 ? 'text-red-600' :
                        'text-gray-600'
                      }`}>
                        {provider.avgSentiment.toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">N/A</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-center">
                    {provider.activePromoCount > 0 ? (
                      <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full text-xs font-medium">
                        {provider.activePromoCount}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">0</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-center text-gray-700">
                    {provider.lead_time_days != null
                      ? `${provider.lead_time_days}d`
                      : 'N/A'}
                  </td>
                  <td className="py-3 px-4 text-center text-gray-700">
                    {provider.minimum_order != null
                      ? `$${provider.minimum_order}`
                      : 'N/A'}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span className="text-xs text-gray-500">
                      {provider.knowledgeEntries} entries
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-8 text-gray-400">
          <p>No providers to compare.</p>
        </div>
      )}

      {/* Leverage Signals */}
      {leverageSignals && leverageSignals.length > 0 && (
        <div className="border border-indigo-200 bg-indigo-50 rounded-lg p-4">
          <h4 className="font-medium text-indigo-800 mb-3">
            Negotiation Leverage Signals
          </h4>
          <div className="space-y-2">
            {leverageSignals.map((signal: any, i: number) => (
              <div key={i} className="bg-white rounded-md p-3 border border-indigo-200">
                <p className="text-sm text-gray-900">{signal.label}</p>
                {signal.providers && (
                  <p className="text-xs text-gray-500 mt-1">
                    Provider: {signal.providers.name}
                  </p>
                )}
                {signal.attributes && (
                  <p className="text-xs text-indigo-600 mt-1">
                    {JSON.stringify(signal.attributes)}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
