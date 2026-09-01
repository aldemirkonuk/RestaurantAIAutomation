/**
 * Expanded row detail — the 3a "reconcile-first" panel.
 * Cards: Live vs Shadow, Par & Reorder, Market price, Velocity 14d,
 * Busy-hours heatmap, Order history. Action bar: manual adjust (ledger
 * reconcile), transfer between locations, ledger link.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getItemActivity, recordPour, reconcileItem, transferStock } from '../../../services/api/inventory'
import { getOrders } from '../../../services/api/orders'
import type { StorageLocation } from '../../../hooks/useStorageLocations'
import { useNotificationStore } from '../../../stores'
import { ThemedSelect } from '../../../components/ui/ThemedSelect'
import { MultiLocationCell } from '../../../components/inventory/MultiLocationCell'
import { formatVolume } from '../../../utils/volumeUtils'
import { useRestaurantSettingsStore } from '../../../stores/restaurantSettingsStore'
import { cn } from '../../../lib/utils'
import type { InventoryItem } from '../useInventoryPage'
import { useMudavymDesign } from '../../../lib/mudavym/useMudavymDesign'
import { fmtMoneyExact, marketDeltaPct, daysSinceCounted, HoursHeatmap, runwayDays } from './bits'
import { ReceiptDepth } from './ReceiptDepth'
import { SpotCountPanel } from './SpotCountPanel'

function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4">
      <h5 className="flex items-center justify-between text-[10.5px] font-bold uppercase tracking-wider text-gray-400 mb-3">
        {title}
        {right}
      </h5>
      {children}
    </div>
  )
}

function KV({ k, v, tone }: { k: string; v: React.ReactNode; tone?: 'green' | 'amber' | 'blue' }) {
  const tones = { green: 'text-emerald-600', amber: 'text-amber-600', blue: 'text-blue-600' }
  return (
    <div className="flex items-center justify-between py-1.5 text-xs">
      <span className="text-gray-500">{k}</span>
      <span className={cn('font-mono font-semibold', tone ? tones[tone] : 'text-gray-700')}>{v}</span>
    </div>
  )
}

const ADJUST_REASONS = [
  { value: 'Count correction', label: 'Count correction' },
  { value: 'Breakage', label: 'Breakage' },
  { value: 'Comp / gift', label: 'Comp / gift' },
  { value: 'Staff pour', label: 'Staff pour' },
  { value: 'Return to vendor', label: 'Return to vendor' },
]

export function RowExpansion({
  item,
  locations,
}: {
  item: InventoryItem
  locations: StorageLocation[]
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useNotificationStore()
  // Volumes render in the unit the restaurant chose in Settings. `/inventory-legacy`
  // honoured this setting and `/inventory` did not, so retiring that page silently
  // pinned an oz restaurant back to ml. Restored with the retirement (ADR 0019 §B).
  const measurementUnit = useRestaurantSettingsStore((s) => s.measurementUnit)
  const inventoryId = item.inventoryId || ''
  // The founder's named gap: receipt/invoice depth in the dropdown, gated so
  // the kept page renders byte-identically until the flag flips (ADR 0045 §5).
  const receiptDepthOn = useMudavymDesign('inventory')

  const [delta, setDelta] = useState(0)
  const [reason, setReason] = useState('Count correction')
  const [showSpotCount, setShowSpotCount] = useState(false)
  const [pouring, setPouring] = useState(false)

  const { data: activity } = useQuery({
    queryKey: ['inventory', 'activity', inventoryId],
    queryFn: () => getItemActivity(inventoryId),
    enabled: !!inventoryId,
    staleTime: 5 * 60_000,
  })

  const { data: orders = [] } = useQuery({
    queryKey: ['orders', 'for-item', inventoryId],
    queryFn: () => getOrders(),
    enabled: !!inventoryId,
    staleTime: 60_000,
    select: (all) => (all || []).filter((o: any) => o.inventoryId === inventoryId).slice(0, 4),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['inventory'] })
  }

  const reconcile = useMutation({
    mutationFn: (p: { actualCount: number; notes: string }) =>
      reconcileItem(inventoryId, { wineId: item.id, actualCount: p.actualCount, notes: p.notes }),
    onSuccess: () => {
      invalidate()
      toast.success('Ledger updated')
      setDelta(0)
    },
    onError: (e: any) => toast.error('Adjustment failed', e?.response?.data?.message || e?.message),
  })

  /**
   * A wine can sit in several locations at once (lots are the source of truth), so a
   * move has to name where the bottles are leaving from. This used to hard-code
   * `fromLocationId: null`, which told the server "take them from unassigned stock"
   * no matter which shelf the manager meant.
   */
  const doTransfer = async (fromLocationId: string | null, toLocationId: string, qty: number) => {
    try {
      await transferStock(inventoryId, { fromLocationId, toLocationId, qty, reason: 'manual transfer' })
      invalidate()
      toast.success(`Moved ${qty} bottle${qty === 1 ? '' : 's'}`)
    } catch (e: any) {
      toast.error('Transfer failed', e?.response?.data?.message || e?.message)
      throw e
    }
  }

  const pour = async () => {
    setPouring(true)
    try {
      await recordPour(inventoryId, { pours: 1, source: 'manual', reason: 'manual pour' })
      invalidate()
      toast.success('Pour recorded')
    } catch (e: any) {
      toast.error('Pour failed', e?.response?.data?.message || e?.message)
    } finally {
      setPouring(false)
    }
  }

  const live = item.liveStock ?? 0
  const shadow = item.shadowStock ?? 0
  const paid = item.wac ?? item.price
  const delta$ = marketDeltaPct(item)
  const counted = daysSinceCounted(item)
  const run = runwayDays(item)
  const velocity = item.velocityPerDay ?? 0
  const leadDays = 6 // avg supplier lead; per-supplier value when supplier analytics land
  const parGap = Math.max(0, item.threshold - live)
  const suggested = Math.max(parGap, Math.ceil(velocity * (leadDays + 14)) - live, 0)

  const daily = activity?.daily ?? []
  const maxDaily = Math.max(1, ...daily.map((d) => d.out))

  return (
    <div className="bg-gray-50/70 border-b border-gray-100 px-6 py-4">
      {/* info strip */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pb-3.5 mb-3.5 border-b border-gray-100">
        {[
          ['Grape', item.grape || 'Unknown'],
          ['Region', item.region || 'Unknown'],
          ['Format', formatVolume(item.bottleSizeMl ?? 750, measurementUnit)],
          ['Vintage', item.vintage || 'NV'],
        ].map(([k, v]) => (
          <div key={k as string} className="text-[11px] text-gray-400">
            {k}
            <b className="block text-xs text-gray-700 font-semibold mt-px">{v}</b>
          </div>
        ))}
        <div className="text-[11px] text-gray-400">
          Last counted
          <b className={cn('block text-xs font-semibold mt-px', counted != null && counted <= 21 ? 'text-gray-700' : 'text-amber-600')}>
            {counted == null ? 'never' : `${counted} days ago`}
          </b>
        </div>
        {(item.openMl ?? 0) > 0 && (
          <span className="ml-auto inline-flex items-center gap-2 text-[11px] text-gray-500 bg-gray-50 border border-gray-100 rounded-full px-3 py-1">
            Open bottle: <b className="font-mono text-gray-700">{item.openMl} ml left</b>
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
        {/* live vs shadow */}
        <Card title="Live vs shadow">
          <div className="flex items-stretch gap-2.5">
            <div className="flex-1 text-center py-2.5 rounded-lg bg-blue-50">
              <div className="font-mono text-xl font-bold text-blue-600">{live}</div>
              <div className="text-[10.5px] font-semibold text-blue-600 mt-0.5">Live count</div>
            </div>
            <div className="flex items-center text-[11px] font-bold text-gray-300">vs</div>
            <div className="flex-1 text-center py-2.5 rounded-lg bg-violet-50">
              <div className="font-mono text-xl font-bold text-violet-600">{shadow}</div>
              <div className="text-[10.5px] font-semibold text-violet-600 mt-0.5">Shadow count</div>
            </div>
          </div>
          {shadow > 0 ? (
            <button
              onClick={() => reconcile.mutate({ actualCount: live + shadow, notes: 'Shadow reconciled into live' })}
              disabled={reconcile.isPending}
              className="w-full mt-3 h-9 bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold rounded-lg disabled:opacity-60"
            >
              Reconcile {shadow} bottle{shadow === 1 ? '' : 's'} into live
            </button>
          ) : (
            <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">Live and shadow are in sync. No reconciliation needed.</p>
          )}
        </Card>

        {/* par & reorder */}
        <Card title="Par and reorder">
          <KV k="Suggested order" v={`${suggested} btl`} />
          <KV k="Covers" v={run != null ? `${Math.round((live + suggested) / Math.max(velocity, 0.1))} days at current velocity` : 'n/a'} />
          <KV k="Reorder point" v={`${Math.max(item.threshold, Math.ceil(velocity * leadDays))} btl (${leadDays}d lead + safety)`} />
          <KV k="Runway now" v={run == null ? 'n/a' : `${Math.round(run)} day${Math.round(run) === 1 ? '' : 's'}`} tone={run != null && run <= 5 ? 'amber' : undefined} />
          <button
            onClick={() => navigate(`/orders?draft=new&inventoryId=${inventoryId}&qty=${suggested || item.threshold}`)}
            className="w-full mt-2.5 h-9 bg-wine-600 hover:bg-wine-700 text-white text-xs font-bold rounded-lg"
          >
            Draft PO, {suggested || item.threshold} btl
          </button>
        </Card>

        {/* market price */}
        <Card
          title="Market price"
          right={
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-emerald-600 normal-case tracking-normal">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              feed {item.marketPrice ? 'connected' : 'no data'}
            </span>
          }
        >
          <KV k={`Market avg (${formatVolume(item.bottleSizeMl ?? 750, measurementUnit)})`} v={fmtMoneyExact(item.marketPrice)} />
          <KV k="You paid (WAC)" v={fmtMoneyExact(paid)} />
          <KV
            k="Delta"
            v={delta$ == null ? 'n/a' : `${delta$ > 0 ? '+' : ''}${delta$.toFixed(0)}%${delta$ >= 15 ? ', appreciating, hold' : delta$ <= -5 ? ', re-quote vendor' : ''}`}
            tone={delta$ != null && delta$ > 0 ? 'green' : 'amber'}
          />
          <KV k="Menu price" v={item.menuPrice ? `${fmtMoneyExact(item.menuPrice)}${paid ? ` (${(item.menuPrice / paid).toFixed(1)}x)` : ''}` : 'not set'} tone="blue" />
          <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
            Alerts fire when a vendor quote exceeds market or margin slips under 1.8x.
          </p>
        </Card>

        {/* velocity 14d */}
        <Card title="Velocity, last 14 days">
          {daily.length > 0 ? (
            <>
              <div className="flex items-end gap-1 h-16">
                {daily.map((d) => (
                  <i
                    key={d.date}
                    title={`${d.date}: ${d.out}`}
                    className={cn('flex-1 rounded-t', d.out >= maxDaily * 0.75 ? 'bg-blue-600' : 'bg-blue-100')}
                    style={{ height: `${Math.max((d.out / maxDaily) * 100, 4)}%` }}
                  />
                ))}
              </div>
              <div className="flex justify-between font-mono text-[9px] text-gray-400 mt-1.5">
                <span>{daily[0]?.date.slice(5)}</span>
                <span>{daily[daily.length - 1]?.date.slice(5)}</span>
              </div>
            </>
          ) : (
            <p className="text-[11px] text-gray-400">No depletion recorded yet.</p>
          )}
          <KV k="Current velocity" v={`${velocity.toFixed(1)} btl/day`} />
        </Card>

        {/* busy hours */}
        <Card title="When it sells">
          {activity?.heat?.length ? (
            <HoursHeatmap heat={activity.heat} />
          ) : (
            <p className="text-[11px] text-gray-400">Heatmap builds as POS sales come in.</p>
          )}
        </Card>

        {/* order history */}
        <Card title="Order history">
          {orders.length === 0 ? (
            <p className="text-[11px] text-gray-400">No orders for this wine yet.</p>
          ) : (
            <div>
              {orders.map((o: any) => (
                <div key={o.id} className="flex items-center gap-2.5 py-1.5 border-t border-gray-50 first:border-t-0 text-xs">
                  <span className="font-mono text-[11px] font-bold text-gray-700 w-16 truncate">{o.orderNumber || o.id.slice(0, 8)}</span>
                  <span className="flex-1 text-gray-500 truncate">
                    {o.createdAt ? new Date(o.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}
                  </span>
                  <span className="font-mono font-semibold text-gray-700">{o.quantity} btl</span>
                  <span
                    className={cn(
                      'text-[9px] font-bold rounded px-1.5 py-0.5',
                      String(o.status).toLowerCase().includes('deliver') || String(o.status).toLowerCase().includes('complet')
                        ? 'bg-emerald-50 text-emerald-600'
                        : 'bg-blue-50 text-blue-600',
                    )}
                  >
                    {String(o.status || '').toUpperCase().slice(0, 9)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {receiptDepthOn && <ReceiptDepth orders={orders} />}
      </div>

      {/* action bar */}
      <div className="flex flex-wrap items-center gap-3 mt-3.5 bg-white border border-gray-100 rounded-xl px-4 py-3">
        <button
          onClick={() => setShowSpotCount(true)}
          className="h-9 px-4 border border-gray-200 hover:bg-gray-50 text-gray-700 text-xs font-bold rounded-lg"
        >
          Spot count
        </button>

        <span className="w-px h-6 bg-gray-200" />

        <span className="text-[10.5px] font-bold uppercase tracking-wider text-gray-400">Manual adjust</span>
        <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
          <button onClick={() => setDelta((d) => d - 1)} className="w-8 h-8 text-gray-500 hover:bg-gray-50">-</button>
          <span className={cn('w-11 text-center font-mono text-sm font-bold border-x border-gray-100 leading-8', delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-rose-600' : 'text-gray-700')}>
            {delta > 0 ? `+${delta}` : delta}
          </span>
          <button onClick={() => setDelta((d) => d + 1)} className="w-8 h-8 text-gray-500 hover:bg-gray-50">+</button>
        </div>
        <ThemedSelect value={reason} options={ADJUST_REASONS} onChange={setReason} align="left" />
        <button
          onClick={() => reconcile.mutate({ actualCount: Math.max(0, live + delta), notes: reason })}
          disabled={delta === 0 || reconcile.isPending}
          className="h-9 px-4 bg-wine-600 hover:bg-wine-700 text-white text-xs font-bold rounded-lg disabled:opacity-40"
        >
          Apply
        </button>

        <span className="w-px h-6 bg-gray-200" />

        <span className="text-[10.5px] font-bold uppercase tracking-wider text-gray-400">Locations</span>
        <MultiLocationCell
          totalLive={live}
          breakdown={item.locations ?? []}
          locations={locations}
          onTransfer={doTransfer}
        />

        {(item.saleType === 'glass' || item.saleType === 'both') && (live > 0 || (item.openMl ?? 0) > 0) && (
          <>
            <span className="w-px h-6 bg-gray-200" />
            <button
              onClick={() => void pour()}
              disabled={pouring}
              title="Record one by-the-glass pour — depletes the open bottle"
              className="h-9 px-4 border border-gray-200 hover:bg-gray-50 text-gray-700 text-xs font-semibold rounded-lg disabled:opacity-40"
            >
              Record pour
            </button>
          </>
        )}

        {/*
         * `/documents` is not a route — the documents surface is `/documents-reports`
         * (App.tsx), so this button was a no-op that fell through to the `*` catch-all
         * and bounced the user to the dashboard.
         *
         * The old `?ledger=<inventoryId>` param is dropped rather than carried over:
         * DocumentsPage renders generated reports plus classified conversations, and
         * neither is keyed by an inventory item, so there is nothing on that page for
         * the id to select. The per-item ledger data does exist server-side
         * (`GET /inventory-ledger/inventory/:inventoryId/history`) but has no UI yet;
         * building one is out of scope here.
         */}
        <button
          onClick={() => navigate('/documents-reports')}
          className="ml-auto text-xs font-semibold text-gray-500 hover:text-gray-700 px-2 py-1.5 rounded-lg hover:bg-gray-100"
        >
          View ledger
        </button>
      </div>

      {showSpotCount && (
        <SpotCountPanel
          item={item}
          onClose={() => setShowSpotCount(false)}
          onCommitted={invalidate}
        />
      )}
    </div>
  )
}
