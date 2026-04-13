import { useQuery } from '@tanstack/react-query'
import {
  fetchProviderPromotions,
  fetchAllActivePromotions,
  fetchExpiringPromotions,
  fetchPromoSavings,
  type Promotion,
} from '../../services/api/provider-intelligence'

const PROMO_TYPE_COLORS: Record<string, string> = {
  volume_discount: 'bg-green-100 text-green-700',
  seasonal: 'bg-amber-100 text-amber-700',
  bundle: 'bg-blue-100 text-blue-700',
  loyalty: 'bg-purple-100 text-purple-700',
  closeout: 'bg-red-100 text-red-700',
  new_vintage: 'bg-indigo-100 text-indigo-700',
  free_shipping: 'bg-teal-100 text-teal-700',
  sample: 'bg-pink-100 text-pink-700',
  early_payment: 'bg-cyan-100 text-cyan-700',
  referral: 'bg-orange-100 text-orange-700',
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  expired: 'bg-gray-100 text-gray-500',
  upcoming: 'bg-blue-100 text-blue-700',
  used: 'bg-purple-100 text-purple-600',
  cancelled: 'bg-red-100 text-red-600',
}

interface Props {
  providerId?: string
  mode?: 'provider' | 'dashboard'
}

export function ProviderPromotionsPanel({ providerId, mode = 'provider' }: Props) {
  const { data: providerPromos, isLoading: providerLoading } = useQuery({
    queryKey: ['provider-promotions', providerId],
    queryFn: () => fetchProviderPromotions(providerId!),
    enabled: !!providerId && mode === 'provider',
  })

  const { data: allActive, isLoading: activeLoading } = useQuery({
    queryKey: ['all-active-promotions'],
    queryFn: fetchAllActivePromotions,
    enabled: mode === 'dashboard',
  })

  const { data: expiring } = useQuery({
    queryKey: ['expiring-promotions'],
    queryFn: () => fetchExpiringPromotions(7),
    enabled: mode === 'dashboard',
  })

  const { data: savings } = useQuery({
    queryKey: ['promo-savings'],
    queryFn: fetchPromoSavings,
    enabled: mode === 'dashboard',
  })

  const promos = mode === 'provider' ? providerPromos : allActive
  const isLoading = mode === 'provider' ? providerLoading : activeLoading

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            {mode === 'dashboard' ? 'Promotion Dashboard' : 'Promotions'}
          </h3>
          <p className="text-sm text-gray-500">
            {promos?.length || 0} promotions
          </p>
        </div>
        {mode === 'dashboard' && savings && (
          <div className="text-right">
            <p className="text-2xl font-bold text-green-600">
              ${savings.totalSavings.toFixed(2)}
            </p>
            <p className="text-xs text-gray-500">Total Savings</p>
          </div>
        )}
      </div>

      {/* Expiring Promos Warning */}
      {mode === 'dashboard' && expiring && expiring.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-sm font-medium text-amber-800">
            {expiring.length} promotion{expiring.length > 1 ? 's' : ''} expiring within 7 days
          </p>
          <div className="mt-2 space-y-1">
            {expiring.slice(0, 3).map((p: Promotion) => (
              <p key={p.id} className="text-xs text-amber-700">
                {p.name} — expires {p.end_date}
                {p.providers && ` (${p.providers.name})`}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Promo List */}
      {isLoading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin h-6 w-6 border-2 border-gray-300 border-t-gray-900 rounded-full" />
        </div>
      ) : promos && promos.length > 0 ? (
        <div className="space-y-3">
          {promos.map((promo: Promotion) => (
            <div
              key={promo.id}
              className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium text-gray-900">{promo.name}</h4>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        PROMO_TYPE_COLORS[promo.promo_type] || 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {promo.promo_type.replace(/_/g, ' ')}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        STATUS_COLORS[promo.status] || 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {promo.status}
                    </span>
                  </div>
                  {promo.description && (
                    <p className="text-sm text-gray-500 mt-1">{promo.description}</p>
                  )}
                  {mode === 'dashboard' && promo.providers && (
                    <p className="text-xs text-gray-400 mt-1">
                      Provider: {promo.providers.name}
                    </p>
                  )}
                </div>
                <div className="text-right text-sm">
                  {promo.discount_value && (
                    <p className="font-semibold text-green-600">
                      {(promo.discount_value as any).value
                        ? `${(promo.discount_value as any).type === 'percentage' ? '' : '$'}${(promo.discount_value as any).value}${(promo.discount_value as any).type === 'percentage' ? '%' : ''} off`
                        : ''}
                    </p>
                  )}
                  {promo.savings_realized > 0 && (
                    <p className="text-xs text-gray-500">
                      Saved: ${promo.savings_realized}
                    </p>
                  )}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500">
                {promo.start_date && <span>Start: {promo.start_date}</span>}
                {promo.end_date && <span>End: {promo.end_date}</span>}
                {promo.times_used > 0 && <span>Used: {promo.times_used}x</span>}
                {promo.is_recurring && <span>Recurring</span>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-gray-400">
          <p>No promotions found.</p>
        </div>
      )}
    </div>
  )
}
