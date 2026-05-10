import { useQuery } from '@tanstack/react-query'
import { fetchSentimentTrend } from '../../services/api/provider-intelligence'

interface Props {
  providerId: string
}

const SENTIMENT_COLORS: Record<string, string> = {
  positive: 'bg-green-400',
  neutral: 'bg-gray-300',
  negative: 'bg-red-400',
}

export function ProviderSentimentChart({ providerId }: Props) {
  const { data: trend, isLoading } = useQuery({
    queryKey: ['provider-sentiment', providerId],
    queryFn: () => fetchSentimentTrend(providerId, 30),
    enabled: !!providerId,
  })

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <div className="animate-spin h-6 w-6 border-2 border-gray-300 border-t-gray-900 rounded-full" />
      </div>
    )
  }

  if (!trend || trend.dataPoints.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400">
        <p>No sentiment data yet.</p>
      </div>
    )
  }

  const trendColor = trend.trend === 'improving'
    ? 'text-green-600'
    : trend.trend === 'declining'
      ? 'text-red-600'
      : 'text-gray-600'

  const trendArrow = trend.trend === 'improving' ? '\u2191' : trend.trend === 'declining' ? '\u2193' : '\u2192'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Sentiment Trend</h3>
          <p className="text-sm text-gray-500">
            Based on {trend.dataPoints.length} interactions
          </p>
        </div>
        <div className="text-right">
          <p className={`text-2xl font-bold ${trendColor}`}>
            {trend.averageScore.toFixed(2)} {trendArrow}
          </p>
          <p className="text-xs text-gray-500 capitalize">{trend.trend}</p>
        </div>
      </div>

      {/* Visual sentiment bar chart */}
      <div className="space-y-1">
        {trend.dataPoints
          .slice()
          .reverse()
          .slice(0, 20)
          .map((dp, i) => {
            const score = dp.sentiment_score ?? 0
            const width = Math.abs(score) * 50
            const isPositive = score >= 0

            return (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="w-16 text-gray-400 text-right shrink-0">
                  {new Date(dp.created_at).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
                <div className="flex-1 flex items-center">
                  <div className="w-1/2 flex justify-end">
                    {!isPositive && (
                      <div
                        className="bg-red-400 h-4 rounded-l transition-all"
                        style={{ width: `${width}%` }}
                      />
                    )}
                  </div>
                  <div className="w-px h-5 bg-gray-300" />
                  <div className="w-1/2">
                    {isPositive && (
                      <div
                        className="bg-green-400 h-4 rounded-r transition-all"
                        style={{ width: `${width}%` }}
                      />
                    )}
                  </div>
                </div>
                <span className="w-12 text-gray-500">{score.toFixed(1)}</span>
              </div>
            )
          })}
      </div>

      {/* Sentiment distribution */}
      <div className="flex gap-3 pt-2 border-t border-gray-100">
        {(['positive', 'neutral', 'negative'] as const).map((sent) => {
          const count = trend.dataPoints.filter((d) => d.sentiment === sent).length
          const pct = trend.dataPoints.length > 0
            ? Math.round((count / trend.dataPoints.length) * 100)
            : 0

          return (
            <div key={sent} className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${SENTIMENT_COLORS[sent]}`} />
              <span className="text-xs text-gray-600 capitalize">
                {sent}: {pct}%
              </span>
            </div>
          )
        })}
      </div>

      {/* Recent emotions */}
      {trend.dataPoints.some((d) => d.detected_emotions && d.detected_emotions.length > 0) && (
        <div className="pt-2 border-t border-gray-100">
          <p className="text-xs text-gray-500 mb-2">Recent emotions detected:</p>
          <div className="flex flex-wrap gap-1">
            {Array.from(
              new Set(
                trend.dataPoints
                  .flatMap((d) => d.detected_emotions || [])
                  .slice(0, 10),
              ),
            ).map((emotion) => (
              <span
                key={emotion}
                className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full"
              >
                {emotion}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
