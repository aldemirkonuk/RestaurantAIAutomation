/**
 * Inventory Command — production port of sketch 038.
 * 3a live/shadow spine: 9-column table, row-expand detail, attention rail,
 * cellar map view, receiving verification, adjustable locations.
 */
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Search, Plus, Download, MapPin, LayoutGrid, Rows3, ChevronDown, PackageCheck,
} from 'lucide-react'
import { useInventoryPage, type InventoryItem } from '../index'
import { ContextualInsights } from '../../../components/insights/ContextualInsights'
import { useStorageLocations } from '../../../hooks/useStorageLocations'
import { useCreateInventoryItem } from '../../../hooks/queries'
import { getOrders } from '../../../services/api/orders'
import { AddWineToInventoryModal } from '../../../components/inventory/AddWineToInventoryModal'
import { StorageLocationManager } from '../../../components/inventory/StorageLocationManager'
import { ThemedSelect } from '../../../components/ui/ThemedSelect'
import { classifyStock } from '../../../lib/inventoryStatus'
import { cn } from '../../../lib/utils'
import {
  Kpi, StockGauge, StatusChip, AbcBadge, TypeChip,
  rowFlags, runwayDays, marketDeltaPct, daysSinceCounted, fmtMoney, COUNT_DUE_DAYS, type RowFlag,
} from './bits'
import { RowExpansion } from './RowExpansion'
import { ReceivingWorkspace } from './ReceivingWorkspace'
import { CellarMapView } from './CellarMapView'

const GRID = 'minmax(215px,1.5fr) 80px 128px 195px 90px 78px 84px 92px 106px 32px'

const SORTS = [
  { value: 'runway', label: 'Runway, shortest first' },
  { value: 'velocity', label: 'Velocity, fastest first' },
  { value: 'value', label: 'Value, highest first' },
  { value: 'name', label: 'Name, A to Z' },
]

const FLAG_DEFS: Array<{ key: RowFlag; label: string; dot: string }> = [
  { key: 'low', label: 'Below par', dot: 'bg-amber-500' },
  { key: 'recon', label: 'Reconcile', dot: 'bg-violet-500' },
  { key: 'count', label: 'Count due', dot: 'bg-gray-400' },
  { key: 'dead', label: 'Dead stock', dot: 'bg-gray-300' },
  { key: 'price', label: 'Price signals', dot: 'bg-emerald-500' },
]

export function InventoryCommandPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const page = useInventoryPage({})
  const {
    searchQuery, setSearchQuery, filterType, setFilterType,
    selectedLocationFilter, setSelectedLocationFilter,
    filteredInventory, stats, refetchInventory,
  } = page

  const { locations, setLocations } = useStorageLocations()
  const createInventoryItem = useCreateInventoryItem()

  const [view, setView] = useState<'table' | 'map'>('table')
  const [sort, setSort] = useState('runway')
  const [activeFlag, setActiveFlag] = useState<RowFlag | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showAddWine, setShowAddWine] = useState(false)
  const [showStorageManager, setShowStorageManager] = useState(false)
  const [verifyOrder, setVerifyOrder] = useState<any | null>(null)

  // Deliveries still owed a three-way match. PARTIALLY_RECEIVED belongs here too: those orders
  // were matched once and left open for a backorder, so they still need a human when the rest
  // shows up. Filtering to DELIVERED alone would strand them where nothing links to them.
  const { data: delivered = [] } = useQuery({
    queryKey: ['orders', 'to-verify', 'delivered'],
    queryFn: () => getOrders({ status: 'delivered' as any }),
    staleTime: 60_000,
  })
  const { data: partiallyReceived = [] } = useQuery({
    queryKey: ['orders', 'to-verify', 'partially-received'],
    queryFn: () => getOrders({ status: 'partially_received' as any }),
    staleTime: 60_000,
  })

  const toVerify = useMemo(
    () =>
      [...(delivered || []), ...(partiallyReceived || [])].filter((o: any) =>
        ['DELIVERED', 'PARTIALLY_RECEIVED'].includes(String(o.status).toUpperCase()),
      ),
    [delivered, partiallyReceived],
  )

  // Deep-link: /inventory?verify=<orderId> (from the pinned notification)
  useEffect(() => {
    const id = searchParams.get('verify')
    if (!id || verifyOrder) return
    const match = (toVerify as any[]).find((o) => o.id === id)
    if (match) setVerifyOrder(match)
  }, [searchParams, toVerify, verifyOrder])

  const closeVerify = () => {
    setVerifyOrder(null)
    if (searchParams.has('verify')) {
      searchParams.delete('verify')
      setSearchParams(searchParams, { replace: true })
    }
    void refetchInventory()
  }

  const flagCounts = useMemo(() => {
    const counts: Record<RowFlag, number> = { low: 0, recon: 0, count: 0, dead: 0, price: 0 }
    for (const item of filteredInventory) for (const f of rowFlags(item)) counts[f]++
    return counts
  }, [filteredInventory])

  const rows = useMemo(() => {
    let items = activeFlag
      ? filteredInventory.filter((i) => rowFlags(i).includes(activeFlag))
      : [...filteredInventory]
    const val = (i: InventoryItem) => ((i.wac ?? i.price ?? 0) * ((i.liveStock ?? 0) + (i.shadowStock ?? 0)))
    items.sort((a, b) => {
      switch (sort) {
        case 'velocity': return (b.velocityPerDay ?? 0) - (a.velocityPerDay ?? 0)
        case 'value': return val(b) - val(a)
        case 'name': return a.name.localeCompare(b.name)
        default: {
          const ra = runwayDays(a); const rb = runwayDays(b)
          return (ra ?? Infinity) - (rb ?? Infinity)
        }
      }
    })
    return items
  }, [filteredInventory, activeFlag, sort])

  const kpis = useMemo(() => {
    const valueOnHand = filteredInventory.reduce(
      (s, i) => s + (i.wac ?? i.price ?? 0) * ((i.liveStock ?? 0) + (i.shadowStock ?? 0)), 0)
    const menuPotential = filteredInventory.reduce(
      (s, i) => s + (i.menuPrice ?? 0) * ((i.liveStock ?? 0) + (i.shadowStock ?? 0)), 0)
    const runwayAlerts = filteredInventory.filter((i) => {
      const r = runwayDays(i)
      return r != null && r <= 5
    }).length
    return { valueOnHand, menuPotential, runwayAlerts }
  }, [filteredInventory])

  const typeOptions = useMemo(() => {
    const types = Array.from(new Set(filteredInventory.map((i) => (i.type || '').toLowerCase()).filter(Boolean)))
    return types.slice(0, 5)
  }, [filteredInventory])

  const exportCsv = () => {
    const header = 'Wine,Producer,Type,Live,Shadow,Par,Velocity/day,Runway d,WAC,Market,Value\n'
    const body = rows.map((i) => {
      const r = runwayDays(i)
      return [
        `"${i.name}"`, `"${i.producer ?? ''}"`, i.type ?? '', i.liveStock ?? 0, i.shadowStock ?? 0,
        i.threshold, (i.velocityPerDay ?? 0).toFixed(2), r == null ? '' : Math.round(r),
        i.wac ?? i.price ?? '', i.marketPrice ?? '',
        ((i.wac ?? i.price ?? 0) * ((i.liveStock ?? 0) + (i.shadowStock ?? 0))).toFixed(2),
      ].join(',')
    }).join('\n')
    const blob = new Blob([header + body], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `inventory-valuation-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // A senior storage manager's read on a single row: the one thing worth flagging, if any.
  const countObservation = (item: InventoryItem): string => {
    const flags = rowFlags(item)
    const runway = runwayDays(item)
    const counted = daysSinceCounted(item)
    const delta = marketDeltaPct(item)
    const shadow = item.shadowStock ?? 0
    const notes: string[] = []
    if (flags.includes('dead')) notes.push(`Dead stock${item.daysSinceSale != null ? ` — no sale ${item.daysSinceSale}d` : ''}, consider clearance/86`)
    if (runway != null && runway <= 3) notes.push(`Stockout risk — ${Math.round(runway)}d runway`)
    else if (runway != null && runway <= 5) notes.push(`Reorder soon — ${Math.round(runway)}d runway`)
    if (flags.includes('recon')) notes.push(`Shadow variance ${shadow} — reconcile after this count`)
    if (counted == null) notes.push('Never counted')
    else if (counted > COUNT_DUE_DAYS) notes.push(`Count overdue ${counted}d`)
    if (delta != null && delta >= 15) notes.push(`Priced ${delta.toFixed(0)}% under market — margin opportunity`)
    if (delta != null && delta <= -5) notes.push(`Cost ${Math.abs(delta).toFixed(0)}% above market — review supplier`)
    if ((item.velocityPerDay ?? 0) > 0 && (item.liveStock ?? 0) + shadow > (item.threshold || 0) * 3) notes.push('Overstocked vs. par — tie up cash')
    return notes.join('; ')
  }

  const exportCountSheet = () => {
    const csvField = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
    const today = new Date().toISOString().slice(0, 10)

    const totalBottles = filteredInventory.reduce((s, i) => s + (i.liveStock ?? 0) + (i.shadowStock ?? 0), 0)
    const belowPar = filteredInventory.filter((i) => rowFlags(i).includes('low')).length
    const reconcileCount = filteredInventory.filter((i) => rowFlags(i).includes('recon')).length
    const countDue = filteredInventory.filter((i) => rowFlags(i).includes('count')).length
    const deadCount = filteredInventory.filter((i) => rowFlags(i).includes('dead')).length
    const priceSignals = filteredInventory.filter((i) => rowFlags(i).includes('price')).length
    const stockoutRisk = filteredInventory.filter((i) => { const r = runwayDays(i); return r != null && r <= 5 }).length

    const summary = [
      `Inventory count sheet — generated ${today}`,
      `Wines,${filteredInventory.length}`,
      `Bottles on hand (live+shadow),${totalBottles}`,
      `Value on hand (cost basis),${fmtMoney(kpis.valueOnHand)}`,
      `Below par,${belowPar}`,
      `Awaiting reconcile (shadow > 0),${reconcileCount}`,
      `Count overdue (>${COUNT_DUE_DAYS}d or never),${countDue}`,
      `Dead stock,${deadCount}`,
      `Stockout risk (<=5d runway),${stockoutRisk}`,
      `Price signals (market vs. cost),${priceSignals}`,
      '',
    ].join('\n')

    const header = [
      'Location', 'Wine', 'Producer', 'Vintage', 'Type', 'Bottle size',
      'System qty (live)', 'System qty (shadow)', 'Par',
      'Counted qty', 'Variance',
      'Days since counted', 'Velocity/day', 'Runway d', 'WAC', 'Value',
      'Observation',
    ].map(csvField).join(',') + '\n'

    const body = rows.map((i) => {
      const loc = locName(i)
      const r = runwayDays(i)
      const counted = daysSinceCounted(i)
      const value = (i.wac ?? i.price ?? 0) * ((i.liveStock ?? 0) + (i.shadowStock ?? 0))
      return [
        csvField(loc ? loc.name : 'Unassigned'),
        csvField(i.name),
        csvField(i.producer ?? ''),
        csvField(i.vintage ?? ''),
        csvField(i.type ?? ''),
        csvField(i.bottleSizeMl ? `${i.bottleSizeMl}ml` : ''),
        i.liveStock ?? 0,
        i.shadowStock ?? 0,
        i.threshold,
        '', '',
        counted == null ? 'never' : counted,
        (i.velocityPerDay ?? 0).toFixed(2),
        r == null ? '' : Math.round(r),
        i.wac ?? i.price ?? '',
        value.toFixed(2),
        csvField(countObservation(i)),
      ].join(',')
    }).join('\n')

    const blob = new Blob([summary + header + body], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `inventory-count-${today}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const locName = (item: InventoryItem) => {
    const first = (item.locations ?? []).find((l) => l.locationId)
    if (!first) return null
    const loc = locations.find((l) => l.id === first.locationId)
    return loc ? { ...loc, extra: (item.locations ?? []).filter((l) => l.locationId).length - 1 } : null
  }

  return (
    <div className="p-6 max-w-[1500px] mx-auto">
      {/* header */}
      <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Inventory</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {stats.total} wines, {stats.liveTotal + stats.shadowTotal} bottles on hand
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setView('table')}
              className={cn('flex items-center gap-1.5 text-xs font-semibold rounded-md px-3 py-1.5', view === 'table' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500')}
            >
              <Rows3 className="w-3.5 h-3.5" /> Table
            </button>
            <button
              onClick={() => setView('map')}
              className={cn('flex items-center gap-1.5 text-xs font-semibold rounded-md px-3 py-1.5', view === 'map' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500')}
            >
              <LayoutGrid className="w-3.5 h-3.5" /> Cellar Map
            </button>
          </div>
          <button onClick={exportCountSheet} className="flex items-center gap-1.5 h-9 px-3 border border-gray-200 bg-white rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-50">
            <Download className="w-3.5 h-3.5" /> Export count sheet
          </button>
          <button onClick={exportCsv} className="flex items-center gap-1.5 h-9 px-3 border border-gray-200 bg-white rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-50">
            <Download className="w-3.5 h-3.5" /> Export valuation
          </button>
          <button onClick={() => setShowStorageManager(true)} className="flex items-center gap-1.5 h-9 px-3 border border-gray-200 bg-white rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-50">
            <MapPin className="w-3.5 h-3.5" /> Locations
          </button>
          <button onClick={() => setShowAddWine(true)} className="flex items-center gap-1.5 h-9 px-4 bg-wine-600 hover:bg-wine-700 text-white rounded-lg text-xs font-bold shadow-sm">
            <Plus className="w-3.5 h-3.5" /> Add wine
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5 mb-3.5">
        <Kpi label="On hand" value={stats.liveTotal + stats.shadowTotal} sub={`${stats.total} wines`} />
        <Kpi label="Live" value={stats.liveTotal} sub="POS-verified" tone="blue" />
        <Kpi label="Shadow" value={stats.shadowTotal} sub="awaiting reconcile" tone="violet" />
        <Kpi label="Value on hand" value={fmtMoney(kpis.valueOnHand)} sub={kpis.menuPotential > 0 ? `${fmtMoney(kpis.menuPotential)} menu` : 'cost basis'} tone="green" />
        <Kpi label="Below par" value={stats.low + stats.critical} sub={`${stats.critical} critical`} tone="amber" />
        <Kpi label="Runway alerts" value={kpis.runwayAlerts} sub="stockout inside 5 days" tone="red" />
      </div>

      {/* engine insights in context (NEW-729) */}
      <ContextualInsights host="inventory" defaultOpen={false} className="mb-3" />

      {/* attention rail */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <span className="text-[10.5px] font-bold uppercase tracking-wider text-gray-400 mr-1">Needs attention</span>
        {(toVerify as any[]).length > 0 && (
          <button
            onClick={() => setVerifyOrder((toVerify as any[])[0])}
            className="inline-flex items-center gap-1.5 text-xs font-bold rounded-full px-3.5 py-1.5 bg-wine-600 text-white shadow-sm"
          >
            <PackageCheck className="w-3.5 h-3.5" />
            Match invoice <b className="font-mono text-[11px]">{(toVerify as any[]).length}</b>
          </button>
        )}
        {FLAG_DEFS.map((f) => (
          <button
            key={f.key}
            onClick={() => setActiveFlag(activeFlag === f.key ? null : f.key)}
            className={cn(
              'inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1.5 border',
              activeFlag === f.key ? 'border-wine-600 bg-wine-50 text-wine-700' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300',
            )}
          >
            <span className={cn('w-1.5 h-1.5 rounded-full', f.dot)} />
            {f.label} <b className="font-mono text-[11px]">{flagCounts[f.key]}</b>
          </button>
        ))}
      </div>

      {/* toolbar */}
      <div className="flex items-center gap-2.5 flex-wrap mb-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search wines, producers, grapes"
            className="w-full h-9 pl-9 pr-3 bg-white border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-wine-100 focus:border-wine-500"
          />
        </div>
        <button
          onClick={() => setSelectedLocationFilter(null)}
          className={cn('h-9 px-3 rounded-lg text-xs font-semibold border', !selectedLocationFilter ? 'bg-gray-900 border-gray-900 text-white' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300')}
        >
          All locations
        </button>
        {locations.slice(0, 4).map((l) => (
          <button
            key={l.id}
            onClick={() => setSelectedLocationFilter(selectedLocationFilter === l.id ? null : l.id)}
            className={cn('inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-semibold border', selectedLocationFilter === l.id ? 'bg-gray-900 border-gray-900 text-white' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300')}
          >
            <span className="w-2 h-2 rounded-full" style={{ background: l.color || '#be123c' }} />
            {l.name}
          </button>
        ))}
        {typeOptions.map((t) => (
          <button
            key={t}
            onClick={() => setFilterType(filterType === t ? 'all' : (t as any))}
            className={cn('h-9 px-3 rounded-lg text-xs font-semibold border capitalize', filterType === t ? 'bg-wine-50 border-wine-600 text-wine-700' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300')}
          >
            {t}
          </button>
        ))}
        <div className="flex-1" />
        <ThemedSelect value={sort} options={SORTS} onChange={setSort} />
      </div>

      {/* ── TABLE VIEW ── */}
      {view === 'table' && (
        <>
          <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <div className="min-w-[1180px]">
                <div className="grid items-center gap-x-3 px-5 h-10 bg-gray-50 border-b border-gray-100" style={{ gridTemplateColumns: GRID }}>
                  {['Wine', 'Type', 'Location', 'Stock, live / shadow', 'Velocity', 'Runway', 'Market', 'Value', 'Status', ''].map((h, i) => (
                    <div key={i} className={cn('text-[10px] font-bold uppercase tracking-wider text-gray-500', (i === 6 || i === 7) && 'text-right')}>{h}</div>
                  ))}
                </div>

                {rows.length === 0 && (
                  <div className="p-10 text-center text-sm text-gray-400">No wines match the current filters.</div>
                )}

                {rows.map((item) => {
                  const isOpen = expandedId === item.inventoryId
                  const run = runwayDays(item)
                  const delta = marketDeltaPct(item)
                  const value = (item.wac ?? item.price ?? 0) * ((item.liveStock ?? 0) + (item.shadowStock ?? 0))
                  const loc = locName(item)
                  const status = classifyStock(item.liveStock, item.threshold)
                  return (
                    <div key={item.inventoryId}>
                      <div
                        onClick={() => setExpandedId(isOpen ? null : item.inventoryId!)}
                        className={cn('grid items-center gap-x-3 px-5 py-3 border-b border-gray-100 cursor-pointer transition-colors', isOpen ? 'bg-wine-50/60' : 'hover:bg-gray-50/60')}
                        style={{ gridTemplateColumns: GRID }}
                      >
                        <div>
                          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-900 leading-tight">
                            <span className="truncate">{item.name}</span>
                            <AbcBadge abc={item.abcClass} />
                          </div>
                          <div className="text-[11px] text-gray-400 mt-0.5 truncate">
                            {[item.producer, item.region].filter(Boolean).join(', ') || item.grape || ''}
                          </div>
                        </div>
                        <div><TypeChip type={item.type} /></div>
                        <div>
                          {loc ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); setShowStorageManager(true) }}
                              className="inline-flex items-center gap-1.5 max-w-full px-2.5 py-1 rounded-full bg-white border border-gray-200 hover:border-gray-300 text-[11px] text-gray-600"
                              title="Adjust locations"
                            >
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: loc.color || '#be123c' }} />
                              <span className="truncate">{loc.name}</span>
                              {loc.extra > 0 && <span className="font-mono text-[10px] text-gray-400">+{loc.extra}</span>}
                            </button>
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); setShowStorageManager(true) }}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-dashed border-gray-300 text-[11px] text-gray-400 hover:text-gray-600 hover:border-gray-400"
                            >
                              <MapPin className="w-3 h-3" /> Assign
                            </button>
                          )}
                        </div>
                        <div><StockGauge item={item} /></div>
                        <div className="font-mono text-xs text-gray-700">
                          {(item.velocityPerDay ?? 0).toFixed(1)} <span className="text-[9.5px] text-gray-400">btl/day</span>
                        </div>
                        <div className={cn('font-mono text-[13px] font-bold', run == null ? 'text-gray-300' : run <= 2 ? 'text-rose-600' : run <= 5 ? 'text-amber-600' : 'text-emerald-600')}>
                          {run == null ? 'n/a' : `${Math.max(0, Math.round(run))}d`}
                        </div>
                        <div className={cn('text-right font-mono text-xs font-bold', delta == null ? 'text-gray-300' : delta >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                          {delta == null ? '-' : `${delta > 0 ? '+' : ''}${delta.toFixed(0)}%`}
                        </div>
                        <div className="text-right font-mono text-xs font-semibold text-gray-700">{fmtMoney(value)}</div>
                        <div><StatusChip item={item} /></div>
                        <div className="flex justify-end">
                          <ChevronDown className={cn('w-4 h-4 transition-transform', isOpen ? 'rotate-180 text-wine-600' : 'text-gray-300', status.key === 'critical' && !isOpen && 'text-rose-300')} />
                        </div>
                      </div>
                      {isOpen && <RowExpansion item={item} locations={locations} />}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between mt-2.5 text-xs text-gray-400">
            <span>Showing {rows.length} of {stats.total} wines</span>
            {flagCounts.dead > 0 && <span>Dead stock tip: feature slow movers by the glass this weekend.</span>}
          </div>
        </>
      )}

      {/* ── MAP VIEW ── */}
      {view === 'map' && (
        <CellarMapView
          items={filteredInventory}
          locations={locations}
          onOpenInTable={(locationId) => { setSelectedLocationFilter(locationId); setView('table') }}
          onManageLocations={() => setShowStorageManager(true)}
        />
      )}

      {/* ── MODALS ── */}
      <AddWineToInventoryModal
        isOpen={showAddWine}
        onClose={() => setShowAddWine(false)}
        onAddWine={async (wine: any, quantity: number, threshold: number, storageLocationId?: string, volumeFields?: any) => {
          await createInventoryItem.mutateAsync({
            wineId: wine.id,
            stockLive: quantity,
            thresholdMin: threshold,
            storageLocationId,
            bottleSizeMl: volumeFields?.bottleSizeMl,
            saleType: volumeFields?.saleType,
            pourSizeMl: volumeFields?.pourSizeMl,
            menuPriceGlass: volumeFields?.menuPriceGlass,
          } as any)
          setShowAddWine(false)
          void refetchInventory()
        }}
      />

      <StorageLocationManager
        isOpen={showStorageManager}
        onClose={() => setShowStorageManager(false)}
        inventoryItems={filteredInventory as any}
        onSelectLocation={(location: any) => {
          setSelectedLocationFilter(location.id)
          setShowStorageManager(false)
        }}
        onLocationsChange={(updated: any) => setLocations(updated)}
      />

      {verifyOrder && (
        <ReceivingWorkspace order={verifyOrder} items={filteredInventory} onClose={closeVerify} />
      )}
    </div>
  )
}
