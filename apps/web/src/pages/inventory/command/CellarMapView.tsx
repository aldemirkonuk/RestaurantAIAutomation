/**
 * Cellar Map — spatial view of storage locations. Zone cards show capacity,
 * temperature, and each wine stored there as a health-tinted tile; selecting
 * a zone opens the rail with per-wine gauges and quick actions.
 */
import { useMemo, useState } from 'react'
import { classifyStock } from '../../../lib/inventoryStatus'
import { cn } from '../../../lib/utils'
import type { StorageLocation } from '../../../hooks/useStorageLocations'
import type { InventoryItem } from '../useInventoryPage'
import { StockGauge } from './bits'
import { rolledUpTotals, rollupLabel } from '../../../components/inventory/zoneNesting'

/** A tile's tint. Named by colour so each page can attach its own words. */
export type MapTone = 'violet' | 'rose' | 'amber' | 'green' | 'neutral'

const TONE_CLASS: Record<MapTone, string> = {
  violet: 'bg-violet-50 border-violet-200',
  rose: 'bg-rose-50 border-rose-200',
  amber: 'bg-amber-50 border-amber-200',
  green: 'bg-emerald-50 border-emerald-200',
  neutral: 'bg-gray-50 border-gray-200',
}

const DEFAULT_WORDS: Record<MapTone, string> = {
  green: 'Healthy',
  amber: 'Below par',
  rose: 'Critical',
  violet: 'Needs reconcile',
  neutral: 'Stock not read, or no par',
}

// An unread count or a missing par used to fall through to green "Healthy"
// (INV-W19). It has nothing to be healthy against, so it is neutral.
function defaultTone(item: InventoryItem): MapTone {
  if ((item.shadowStock ?? 0) > 0) return 'violet'
  const s = classifyStock(item.liveStock, item.threshold)
  if (s.key === 'critical') return 'rose'
  if (s.key === 'low') return 'amber'
  if (s.key === 'unknown') return 'neutral'
  return 'green'
}

interface Props {
  items: InventoryItem[]
  locations: StorageLocation[]
  /** The zones query has not answered yet. Not the same as "no zones". */
  locationsLoading?: boolean
  /** The zones query failed. Also not the same as "no zones". */
  locationsUnavailable?: boolean
  onOpenInTable: (locationId: string) => void
  onManageLocations: () => void
  /** The page's own rule for a tile's tint; defaults to the old page's. */
  toneOf?: (item: InventoryItem) => MapTone
  /** The legend's words, in the page's vocabulary; defaults to the old page's. */
  toneWords?: Record<MapTone, string>
}

export function CellarMapView({
  items,
  locations,
  locationsLoading = false,
  locationsUnavailable = false,
  onOpenInTable,
  onManageLocations,
  toneOf = defaultTone,
  toneWords = DEFAULT_WORDS,
}: Props) {
  const [picked, setSelected] = useState<string | null>(null)
  // Zones usually arrive after the page opens; until someone picks one, the
  // first zone is selected rather than none (INV-W19).
  const selected = picked ?? locations[0]?.id ?? null

  const byLocation = useMemo(() => {
    const map = new Map<string, Array<{ item: InventoryItem; qty: number }>>()
    for (const item of items) {
      for (const loc of item.locations ?? []) {
        if (!loc.locationId || !(loc.qty > 0)) continue
        const arr = map.get(loc.locationId) ?? []
        arr.push({ item, qty: loc.qty })
        map.set(loc.locationId, arr)
      }
    }
    return map
  }, [items])

  // Nested-zone totals (founder answer 2026-09-29, "Show both (Recommended)"):
  // each card keeps its own bottles / slots, and a zone with zones inside it
  // also shows a labelled total for itself and everything below it, counted
  // from the same inventory rows as the cards.
  const rollups = useMemo(
    () =>
      rolledUpTotals(locations, (z) =>
        (byLocation.get(z.id) ?? []).reduce((s, w) => s + w.qty, 0),
      ),
    [locations, byLocation],
  )

  const selectedLoc = locations.find((l) => l.id === selected)
  const selectedWines = (selected && byLocation.get(selected)) || []

  const tileTone = (item: InventoryItem) => TONE_CLASS[toneOf(item)]
  const gaugeTone = (item: InventoryItem) => {
    const t = toneOf(item)
    return t === 'rose' || t === 'amber' ? t : null
  }

  // Three different sentences for three different states. Before 2026-09-02 all
  // three rendered four invented zones, so the map could not say any of them.
  if (locationsUnavailable) {
    return (
      <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center">
        <h3 className="text-base font-bold text-gray-900 mb-1">Storage zones could not be loaded</h3>
        <p className="text-sm text-gray-500">
          The request to the server failed, so this map is not claiming anything about your cellar.
          It is not saying you have no zones — it does not know. Reload to try again.
        </p>
      </div>
    )
  }

  if (locationsLoading) {
    return (
      <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center">
        <h3 className="text-base font-bold text-gray-900 mb-1">Loading storage zones…</h3>
        <p className="text-sm text-gray-500">Nothing below is claimed until this answers.</p>
      </div>
    )
  }

  if (locations.length === 0) {
    return (
      <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center">
        <h3 className="text-base font-bold text-gray-900 mb-1">No storage locations yet</h3>
        <p className="text-sm text-gray-500 mb-4">Create zones like Main Cellar, VIP Reserve, or Bar Stock to see the map.</p>
        <button onClick={onManageLocations} className="h-9 px-4 bg-wine-600 hover:bg-wine-700 text-white text-xs font-bold rounded-lg">
          Manage locations
        </button>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-3.5 items-start">
      <div className="flex flex-col gap-3.5">
        {locations.map((zone) => {
          const wines = byLocation.get(zone.id) ?? []
          const bottleCount = wines.reduce((s, w) => s + w.qty, 0)
          // A capacity nobody recorded is not 100 and not zero — it is no
          // denominator at all, so there is no percentage to draw.
          const capacity = zone.capacity
          const pct = capacity != null && capacity > 0
            ? Math.min(100, (bottleCount / capacity) * 100)
            : null
          return (
            <div key={zone.id} data-testid={`zone-card-${zone.name}`} className="bg-white border border-gray-100 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5 text-sm font-bold text-gray-900">
                  <span className="w-2 h-2 rounded-full" style={{ background: zone.color || '#be123c' }} />
                  {zone.name}
                </div>
                <div
                  className="font-mono text-[11px] text-gray-400"
                  title={capacity == null ? 'No capacity recorded for this zone' : undefined}
                >
                  {bottleCount} / {capacity ?? '—'} slots{zone.temperature ? `, ${zone.temperature}` : ''}
                </div>
              </div>
              {rollups.has(zone.id) && (
                <p
                  className="font-mono text-[11px] text-gray-500 -mt-2 mb-3"
                  title="This zone's own bottles plus every zone inside it. Reports count each bottle once, in the zone that holds it."
                >
                  {rollupLabel(rollups.get(zone.id)!)}
                </p>
              )}
              {pct == null ? (
                <p className="text-[10.5px] text-gray-400 mb-3.5">
                  Capacity not recorded — no fill shown.
                </p>
              ) : (
                <div className="h-1 bg-gray-100 rounded-full overflow-hidden mb-3.5">
                  <i className="block h-full rounded-full" style={{ width: `${pct}%`, background: zone.color || '#be123c' }} />
                </div>
              )}
              {wines.length === 0 ? (
                <p className="text-xs text-gray-400">Nothing assigned here yet.</p>
              ) : (
                <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
                  {wines.map(({ item, qty }) => (
                    <button
                      key={item.inventoryId}
                      onClick={() => setSelected(zone.id)}
                      className={cn(
                        'text-left border rounded-lg px-2.5 py-2 transition-shadow hover:shadow-sm',
                        tileTone(item),
                        selected === zone.id && 'ring-1 ring-wine-300',
                      )}
                    >
                      <div className="text-[11px] font-semibold text-gray-800 truncate">{item.name}</div>
                      <div className="font-mono text-[10px] text-gray-500 mt-0.5">{qty} btl</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        <div className="flex flex-wrap gap-4 text-[10.5px] text-gray-500 px-1">
          {(['green', 'amber', 'rose', 'violet', 'neutral'] as const)
            .map((tone) => [TONE_CLASS[tone], toneWords[tone]])
            .map(([cls, label]) => (
              <span key={label} className="inline-flex items-center gap-1.5">
                <i className={cn('w-2.5 h-2.5 rounded border inline-block', cls)} />
                {label}
              </span>
            ))}
        </div>
      </div>

      {/* rail */}
      <div className="bg-white border border-gray-100 rounded-2xl p-4 lg:sticky lg:top-4">
        {selectedLoc ? (
          <>
            <h4 className="text-sm font-bold text-gray-900">{selectedLoc.name}</h4>
            <p className="text-[11px] text-gray-400 mb-3">
              {selectedWines.reduce((s, w) => s + w.qty, 0)} bottles, {selectedWines.length} wine{selectedWines.length === 1 ? '' : 's'}
            </p>
            <div className="max-h-[46vh] overflow-y-auto -mr-1 pr-1">
              {selectedWines.map(({ item, qty }) => (
                <div key={item.inventoryId} className="py-2.5 border-t border-gray-50 first:border-t-0">
                  <div className="text-xs font-semibold text-gray-900">{item.name}</div>
                  <div className="text-[10.5px] text-gray-400 mb-1.5">
                    {item.liveStock != null && item.shadowStock != null
                      ? `${qty} here of ${item.liveStock + item.shadowStock} total`
                      : `${qty} here; the total could not be read`}
                  </div>
                  <StockGauge
                    item={item}
                    compact
                    numTone={gaugeTone(item)}
                  />
                </div>
              ))}
              {selectedWines.length === 0 && <p className="text-xs text-gray-400 py-2">Empty zone.</p>}
            </div>
            <button
              onClick={() => onOpenInTable(selectedLoc.id)}
              className="w-full mt-3 h-9 bg-wine-600 hover:bg-wine-700 text-white text-xs font-bold rounded-lg"
            >
              Open in table
            </button>
            <button
              onClick={onManageLocations}
              className="w-full mt-2 h-9 border border-gray-200 hover:bg-gray-50 text-gray-600 text-xs font-semibold rounded-lg"
            >
              Manage locations
            </button>
          </>
        ) : (
          <p className="text-xs text-gray-400">Select a zone to inspect it.</p>
        )}
      </div>
    </div>
  )
}
