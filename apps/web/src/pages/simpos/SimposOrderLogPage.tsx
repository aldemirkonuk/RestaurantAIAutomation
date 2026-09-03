/**
 * SimPOS order log — full-page debugging view over SimPOS's own data only
 * (distinct from the Mudavym /logs correlated timeline). Reached via
 * "Check logs in full page" from the terminal Home tab.
 */
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, FlaskConical, Loader2 } from 'lucide-react'
import { simposApi } from '../../services/api/simpos'
import { cn } from '../../lib/utils'

function fmtMoney(n: number): string {
  return `$${Number(n).toFixed(2)}`
}

export function SimposOrderLogPage() {
  const { restaurantId = '' } = useParams<{ restaurantId: string }>()

  const query = useQuery({
    queryKey: ['simpos-orders', restaurantId],
    queryFn: () => simposApi.listOrders(restaurantId),
    enabled: !!restaurantId,
  })

  const orders = query.data ?? []

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 px-4 py-3 flex items-center gap-3">
        <Link
          to={`/simpos/${restaurantId}`}
          className="flex items-center gap-1.5 text-xs font-bold text-gray-400 hover:text-white"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to terminal
        </Link>
        <span className="text-xs font-bold tracking-widest text-amber-400 uppercase ml-2">
          Order log
        </span>
        <Link
          to={`/simpos/${restaurantId}/scenarios`}
          className="ml-auto flex items-center gap-1.5 text-[11px] font-bold text-gray-500 hover:text-gray-300"
        >
          <FlaskConical className="w-3 h-3" />
          Scenarios
        </Link>
      </header>

      <div className="max-w-4xl mx-auto p-4 space-y-3">
        {query.isLoading ? (
          <div className="flex items-center justify-center h-40 text-gray-600">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center text-xs text-gray-600 py-16">
            No checks yet — close an order from the terminal
          </div>
        ) : (
          orders.map((o) => (
            <article
              key={o.id}
              className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-gray-800 flex flex-wrap items-center gap-3">
                <span className="font-mono text-[11px] text-gray-500">
                  {o.id.slice(0, 8)}
                </span>
                <span
                  className={cn(
                    'text-[10px] font-bold uppercase px-1.5 py-0.5 rounded',
                    o.status === 'closed'
                      ? 'bg-emerald-950 text-emerald-400'
                      : 'bg-amber-950 text-amber-400',
                  )}
                >
                  {o.status}
                </span>
                <span className="text-[11px] text-gray-500">
                  Opened {new Date(o.opened_at).toLocaleString()}
                  {o.closed_at
                    ? ` · Closed ${new Date(o.closed_at).toLocaleString()}`
                    : ''}
                </span>
                <span className="ml-auto text-xs font-bold text-rose-300 tabular-nums">
                  Loss {fmtMoney(o.lossTotal ?? 0)}
                </span>
              </div>

              <ul className="divide-y divide-gray-800 font-mono text-xs">
                {(o.lines ?? []).map((l) => (
                  <li
                    key={l.id}
                    className={cn(
                      'px-4 py-2 flex gap-3',
                      l.status !== 'active' && 'opacity-50',
                    )}
                  >
                    <span className="flex-1 truncate">{l.item_name_snapshot}</span>
                    <span className="text-gray-500 capitalize">{l.status}</span>
                    <span className="tabular-nums w-16 text-right">
                      {fmtMoney(Number(l.unit_price_snapshot) * Number(l.qty))}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="px-4 py-2.5 border-t border-gray-800 text-[11px] text-gray-500 flex gap-4">
                <span>
                  Webhook:{' '}
                  <span
                    className={cn(
                      'font-bold',
                      o.webhook_status === 'sent'
                        ? 'text-emerald-400'
                        : o.webhook_status === 'failed'
                          ? 'text-rose-400'
                          : 'text-gray-400',
                    )}
                  >
                    {o.webhook_status ?? '—'}
                  </span>
                </span>
                {o.webhook_error && (
                  <span className="text-rose-400 truncate">{o.webhook_error}</span>
                )}
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  )
}

export default SimposOrderLogPage
