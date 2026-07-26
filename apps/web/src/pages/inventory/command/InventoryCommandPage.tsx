/**
 * Inventory Command — production port of sketch 038.
 * 3a live/shadow spine: 9-column table, row-expand detail, attention rail,
 * cellar map view, receiving verification, adjustable locations.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Search, Plus, MapPin, LayoutGrid, Rows3, ChevronDown, PackageCheck,
  ArrowUp, ArrowDown, Copy, X, FileDown, ChevronRight as ChevronRightIcon,
} from 'lucide-react'
import { useInventoryPage, type InventoryItem } from '../index'
import { ContextualInsights } from '../../../components/insights/ContextualInsights'
import { useStorageLocations } from '../../../hooks/useStorageLocations'
import { useCreateInventoryItem } from '../../../hooks/queries'
import { getOrders } from '../../../services/api/orders'
import { AddWineToInventoryModal } from '../../../components/inventory/AddWineToInventoryModal'
import { StorageLocationManager } from '../../../components/inventory/StorageLocationManager'
import { ThemedSelect } from '../../../components/ui/ThemedSelect'
import { ExportMenu } from '../../../components/ui/ExportMenu'
import { exportTable, type TableExportColumn, type TableExportFormat } from '../../../lib/tableExport'
import { classifyStock } from '../../../lib/inventoryStatus'
import { cn } from '../../../lib/utils'
import { toast } from 'sonner'
import {
  Kpi, StockGauge, StatusChip, AbcBadge, TypeChip,
  rowFlags, runwayDays, marketDeltaPct, daysSinceCounted, fmtMoney, COUNT_DUE_DAYS, type RowFlag,
} from './bits'
import { RowExpansion } from './RowExpansion'
import { ReceivingWorkspace } from './ReceivingWorkspace'
import { CellarMapView } from './CellarMapView'

const GRID = '34px minmax(215px,1.5fr) 80px 128px 195px 90px 78px 84px 92px 106px 32px'

const SORTS = [
  { value: 'runway', label: 'Runway, shortest first' },
  { value: 'velocity', label: 'Velocity, fastest first' },
  { value: 'value', label: 'Value, highest first' },
  { value: 'name', label: 'Name, A to Z' },
]

type SortKey = 'runway' | 'velocity' | 'value' | 'name'
type SortDir = 'asc' | 'desc'
/** Default direction per sort key (matches the dropdown's stated order). */
const SORT_DEFAULT_DIR: Record<SortKey, SortDir> = {
  runway: 'asc',
  velocity: 'desc',
  value: 'desc',
  name: 'asc',
}
/** Which grid columns are click-to-sort, by header index (after checkbox col). */
const SORTABLE_COL: Record<number, SortKey> = {
  0: 'name', // Wine
  4: 'velocity',
  5: 'runway',
  7: 'value',
}

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
  const navigate = useNavigate()
  const searchRef = useRef<HTMLInputElement>(null)

  const [view, setView] = useState<'table' | 'map'>('table')
  const [sort, setSort] = useState<SortKey>('runway')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [activeFlag, setActiveFlag] = useState<RowFlag | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showAddWine, setShowAddWine] = useState(false)
  const [showStorageManager, setShowStorageManager] = useState(false)
  const [verifyOrder, setVerifyOrder] = useState<any | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const [showAllLocations, setShowAllLocations] = useState(false)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)

  const anyModalOpen = showAddWine || showStorageManager || !!verifyOrder

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
    const items = activeFlag
      ? filteredInventory.filter((i) => rowFlags(i).includes(activeFlag))
      : [...filteredInventory]
    const val = (i: InventoryItem) => ((i.wac ?? i.price ?? 0) * ((i.liveStock ?? 0) + (i.shadowStock ?? 0)))
    // Comparator in the key's natural ascending order; sortDir flips it.
    const cmp = (a: InventoryItem, b: InventoryItem) => {
      switch (sort) {
        case 'velocity': return (a.velocityPerDay ?? 0) - (b.velocityPerDay ?? 0)
        case 'value': return val(a) - val(b)
        case 'name': return a.name.localeCompare(b.name)
        default: {
          const ra = runwayDays(a); const rb = runwayDays(b)
          return (ra ?? Infinity) - (rb ?? Infinity)
        }
      }
    }
    items.sort((a, b) => (sortDir === 'asc' ? cmp(a, b) : -cmp(a, b)))
    return items
  }, [filteredInventory, activeFlag, sort, sortDir])

  // Column-header + dropdown sort control (NEW-087). Clicking the active column
  // toggles direction; a new column adopts its natural default direction.
  const applySort = useCallback((key: SortKey) => {
    setSort((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      } else {
        setSortDir(SORT_DEFAULT_DIR[key])
      }
      return key
    })
  }, [])

  // ── Multi-select (NEW-064) ──────────────────────────────────────────────
  const selectedRows = useMemo(
    () => rows.filter((r) => r.inventoryId && selected.has(r.inventoryId)),
    [rows, selected],
  )
  const allVisibleSelected = rows.length > 0 && rows.every((r) => r.inventoryId && selected.has(r.inventoryId))
  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }, [])
  const selectAllVisible = useCallback(() => {
    setSelected((prev) =>
      rows.length > 0 && rows.every((r) => r.inventoryId && prev.has(r.inventoryId))
        ? new Set()
        : new Set(rows.map((r) => r.inventoryId!).filter(Boolean)),
    )
  }, [rows])
  const clearSelect = useCallback(() => setSelected(new Set()), [])

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

  const valuationColumns: TableExportColumn<InventoryItem>[] = useMemo(
    () => [
      { header: 'Wine', value: (i) => i.name },
      { header: 'Producer', value: (i) => i.producer ?? '' },
      { header: 'Type', value: (i) => i.type ?? '' },
      { header: 'Live', value: (i) => i.liveStock ?? 0 },
      { header: 'Shadow', value: (i) => i.shadowStock ?? 0 },
      { header: 'Par', value: (i) => i.threshold },
      { header: 'Velocity/day', value: (i) => (i.velocityPerDay ?? 0).toFixed(2) },
      {
        header: 'Runway d',
        value: (i) => {
          const r = runwayDays(i)
          return r == null ? '' : Math.round(r)
        },
      },
      { header: 'WAC', value: (i) => i.wac ?? i.price ?? '' },
      { header: 'Market', value: (i) => i.marketPrice ?? '' },
      {
        header: 'Value',
        value: (i) =>
          ((i.wac ?? i.price ?? 0) * ((i.liveStock ?? 0) + (i.shadowStock ?? 0))).toFixed(2),
      },
    ],
    [],
  )

  const countSheetColumns: TableExportColumn<InventoryItem>[] = useMemo(
    () => [
      {
        header: 'Location',
        value: (i) => {
          const first = (i.locations ?? []).find((l) => l.locationId)
          if (!first) return 'Unassigned'
          const loc = locations.find((l) => l.id === first.locationId)
          return loc?.name ?? 'Unassigned'
        },
      },
      { header: 'Wine', value: (i) => i.name },
      { header: 'Producer', value: (i) => i.producer ?? '' },
      { header: 'Vintage', value: (i) => i.vintage ?? '' },
      { header: 'Type', value: (i) => i.type ?? '' },
      { header: 'Bottle size', value: (i) => (i.bottleSizeMl ? `${i.bottleSizeMl}ml` : '') },
      { header: 'System qty (live)', value: (i) => i.liveStock ?? 0 },
      { header: 'System qty (shadow)', value: (i) => i.shadowStock ?? 0 },
      { header: 'Par', value: (i) => i.threshold },
      { header: 'Counted qty', value: () => '' },
      { header: 'Variance', value: () => '' },
      {
        header: 'Days since counted',
        value: (i) => {
          const counted = daysSinceCounted(i)
          return counted == null ? 'never' : counted
        },
      },
      { header: 'Velocity/day', value: (i) => (i.velocityPerDay ?? 0).toFixed(2) },
      {
        header: 'Runway d',
        value: (i) => {
          const r = runwayDays(i)
          return r == null ? '' : Math.round(r)
        },
      },
      { header: 'WAC', value: (i) => i.wac ?? i.price ?? '' },
      {
        header: 'Value',
        value: (i) =>
          ((i.wac ?? i.price ?? 0) * ((i.liveStock ?? 0) + (i.shadowStock ?? 0))).toFixed(2),
      },
      { header: 'Observation', value: (i) => countObservation(i) },
    ],
    // countObservation closes over helpers; recreate when inventory shape changes
    [locations],
  )

  const runInventoryExport = useCallback(
    async (
      format: TableExportFormat,
      exportRows: InventoryItem[],
      columns: TableExportColumn<InventoryItem>[],
      filename: string,
      title: string,
    ) => {
      try {
        await exportTable({ format, rows: exportRows, columns, filename, title })
        toast.success(
          format === 'clipboard'
            ? `Copied ${exportRows.length} rows`
            : format === 'print'
              ? 'Opening print view'
              : `Exported ${exportRows.length} rows`,
        )
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Export failed')
      }
    },
    [],
  )

  const exportSelected = (format: TableExportFormat) =>
    runInventoryExport(
      format,
      selectedRows,
      valuationColumns,
      `inventory-selected-${new Date().toISOString().slice(0, 10)}`,
      'Inventory selection',
    )

  const exportValuation = (format: TableExportFormat) =>
    runInventoryExport(
      format,
      rows,
      valuationColumns,
      `inventory-valuation-${new Date().toISOString().slice(0, 10)}`,
      'Inventory valuation',
    )

  const exportCountSheet = (format: TableExportFormat) =>
    runInventoryExport(
      format,
      rows,
      countSheetColumns,
      `inventory-count-${new Date().toISOString().slice(0, 10)}`,
      'Inventory count sheet',
    )

  const copySelectedNames = () => {
    navigator.clipboard?.writeText(selectedRows.map((r) => r.name).join('\n'))
  }

  // Keep the focus index valid as the row set changes.
  useEffect(() => {
    setFocusedIndex((i) => (i >= rows.length ? rows.length - 1 : i))
  }, [rows.length])

  // ── Keyboard navigation (NEW-078/079/080) ───────────────────────────────
  useEffect(() => {
    if (view !== 'table') return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey) return
      const t = e.target as HTMLElement | null
      const typing =
        !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
        if (typing || anyModalOpen) return
        e.preventDefault()
        setSelected(new Set(rows.map((r) => r.inventoryId!).filter(Boolean)))
        return
      }
      if (e.metaKey || e.ctrlKey || typing || anyModalOpen) return
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); return }
      if (e.key === 'Escape' && selected.size) { clearSelect(); return }
      if (rows.length === 0) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusedIndex((i) => Math.min(rows.length - 1, (i < 0 ? -1 : i) + 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedIndex((i) => Math.max(0, (i < 0 ? 0 : i) - 1))
      } else if (e.key === 'Enter') {
        const r = rows[focusedIndex]
        if (r?.inventoryId) setExpandedId((cur) => (cur === r.inventoryId ? null : r.inventoryId!))
      } else if (e.key === ' ') {
        const r = rows[focusedIndex]
        if (r?.inventoryId) { e.preventDefault(); toggleSelect(r.inventoryId) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, rows, focusedIndex, anyModalOpen, selected.size, toggleSelect, clearSelect])

  // Scroll the focused row into view.
  useEffect(() => {
    if (focusedIndex < 0) return
    document.querySelector(`[data-inv-row="${focusedIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [focusedIndex])

  // Close the right-click menu on any outside click.
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menu])

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

  const locName = (item: InventoryItem) => {
    const first = (item.locations ?? []).find((l) => l.locationId)
    if (!first) return null
    const loc = locations.find((l) => l.id === first.locationId)
    return loc ? { ...loc, extra: (item.locations ?? []).filter((l) => l.locationId).length - 1 } : null
  }

  return (
    <div className="p-6 max-w-[1500px] mx-auto">
      {/* header */}
      <div className="flex items-center justify-between gap-4 flex-wrap mb-4" data-tour="inventory-filters">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Inventory</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {stats.total} wines, {stats.liveTotal + stats.shadowTotal} bottles on hand
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap" data-tour="inventory-actions">
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
          <ExportMenu
            variant="soft"
            size="sm"
            label="Export count sheet"
            count={rows.length}
            onExport={exportCountSheet}
            title="Export count sheet for physical inventory"
          />
          <ExportMenu
            variant="soft"
            size="sm"
            label="Export valuation"
            count={rows.length}
            onExport={exportValuation}
            title="Export inventory valuation"
          />
          <button onClick={() => setShowStorageManager(true)} className="flex items-center gap-1.5 h-9 px-3 border border-gray-200 bg-white rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-50">
            <MapPin className="w-3.5 h-3.5" /> Locations
          </button>
          <button onClick={() => setShowAddWine(true)} className="flex items-center gap-1.5 h-9 px-4 bg-wine-600 hover:bg-wine-700 text-white rounded-lg text-xs font-bold shadow-sm">
            <Plus className="w-3.5 h-3.5" /> Add wine
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5 mb-3.5" data-tour="inventory-low-stock">
        <Kpi label="On hand" value={stats.liveTotal + stats.shadowTotal} sub={`${stats.total} wines`} />
        <Kpi label="Live" value={stats.liveTotal} sub="POS-verified" tone="blue" />
        <Kpi label="Shadow" value={stats.shadowTotal} sub="awaiting reconcile" tone="violet" active={activeFlag === 'recon'} onClick={() => setActiveFlag(activeFlag === 'recon' ? null : 'recon')} />
        <Kpi label="Value on hand" value={fmtMoney(kpis.valueOnHand)} sub={kpis.menuPotential > 0 ? `${fmtMoney(kpis.menuPotential)} menu` : 'cost basis'} tone="green" />
        <Kpi label="Below par" value={stats.low + stats.critical} sub={`${stats.critical} critical`} tone="amber" active={activeFlag === 'low'} onClick={() => setActiveFlag(activeFlag === 'low' ? null : 'low')} />
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
            ref={searchRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search wines, producers, grapes    ( / )"
            className="w-full h-9 pl-9 pr-3 bg-white border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-wine-100 focus:border-wine-500"
          />
        </div>
        <button
          onClick={() => setSelectedLocationFilter(null)}
          className={cn('h-9 px-3 rounded-lg text-xs font-semibold border', !selectedLocationFilter ? 'bg-gray-900 border-gray-900 text-white' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300')}
        >
          All locations
        </button>
        {(showAllLocations ? locations : locations.slice(0, 5)).map((l) => (
          <button
            key={l.id}
            onClick={() => setSelectedLocationFilter(selectedLocationFilter === l.id ? null : l.id)}
            className={cn('inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-semibold border', selectedLocationFilter === l.id ? 'bg-gray-900 border-gray-900 text-white' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300')}
          >
            <span className="w-2 h-2 rounded-full" style={{ background: l.color || '#be123c' }} />
            {l.name}
          </button>
        ))}
        {locations.length > 5 && (
          <button
            onClick={() => setShowAllLocations((s) => !s)}
            className="h-9 px-3 rounded-lg text-xs font-semibold border border-gray-200 bg-white text-gray-500 hover:border-gray-300"
          >
            {showAllLocations ? 'Show less' : `+${locations.length - 5} more`}
          </button>
        )}
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
        <ThemedSelect
          value={sort}
          options={SORTS}
          onChange={(v) => { setSort(v as SortKey); setSortDir(SORT_DEFAULT_DIR[v as SortKey]) }}
        />
      </div>

      {/* ── TABLE VIEW ── */}
      {view === 'table' && (
        <>
          {/* Bulk action bar (NEW-064/068) */}
          {selected.size > 0 && (
            <div className="sticky top-2 z-20 flex items-center justify-between gap-3 mb-2.5 px-4 py-2.5 bg-gray-900 text-white rounded-xl shadow-lg">
              <span className="text-sm font-semibold">{selected.size} selected</span>
              <div className="flex items-center gap-2">
                <ExportMenu
                  variant="dark"
                  size="sm"
                  label="Export selected"
                  count={selected.size}
                  onExport={exportSelected}
                  title="Export selected inventory rows"
                />
                <button onClick={copySelectedNames} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-white/10 hover:bg-white/20 rounded-lg">
                  <Copy className="w-3.5 h-3.5" /> Copy names
                </button>
                <button onClick={clearSelect} className="p-1.5 hover:bg-white/20 rounded-lg" aria-label="Clear selection">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
          <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <div className="min-w-[1180px]">
                <div className="grid items-center gap-x-3 px-5 h-10 bg-gray-50 border-b border-gray-100" style={{ gridTemplateColumns: GRID }}>
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={selectAllVisible}
                      className="w-4 h-4 rounded border-gray-300 text-wine-600 focus:ring-wine-500 cursor-pointer"
                      aria-label="Select all visible"
                    />
                  </div>
                  {['Wine', 'Type', 'Location', 'Stock, live / shadow', 'Velocity', 'Runway', 'Market', 'Value', 'Status', ''].map((h, i) => {
                    const sortKey = SORTABLE_COL[i]
                    const rightAlign = i === 6 || i === 7
                    if (sortKey) {
                      const activeSort = sort === sortKey
                      return (
                        <button
                          key={i}
                          onClick={() => applySort(sortKey)}
                          className={cn('flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider transition-colors hover:text-gray-800', activeSort ? 'text-wine-700' : 'text-gray-500', rightAlign && 'justify-end')}
                        >
                          {h}
                          {activeSort && (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                        </button>
                      )
                    }
                    return <div key={i} className={cn('text-[10px] font-bold uppercase tracking-wider text-gray-500', rightAlign && 'text-right')}>{h}</div>
                  })}
                </div>

                {rows.length === 0 && (
                  <div className="p-10 text-center text-sm text-gray-400">No wines match the current filters.</div>
                )}

                {rows.map((item, idx) => {
                  const isOpen = expandedId === item.inventoryId
                  const isSelected = !!item.inventoryId && selected.has(item.inventoryId)
                  const isFocused = idx === focusedIndex
                  const run = runwayDays(item)
                  const delta = marketDeltaPct(item)
                  const value = (item.wac ?? item.price ?? 0) * ((item.liveStock ?? 0) + (item.shadowStock ?? 0))
                  const loc = locName(item)
                  const status = classifyStock(item.liveStock, item.threshold)
                  return (
                    <div key={item.inventoryId} data-inv-row={idx}>
                      <div
                        onClick={() => setExpandedId(isOpen ? null : item.inventoryId!)}
                        onContextMenu={(e) => { e.preventDefault(); if (item.inventoryId) setMenu({ id: item.inventoryId, x: e.clientX, y: e.clientY }) }}
                        className={cn(
                          'grid items-center gap-x-3 px-5 py-3 border-b border-gray-100 cursor-pointer transition-colors',
                          isSelected ? 'bg-wine-50/40' : isOpen ? 'bg-wine-50/60' : 'hover:bg-gray-50/60',
                          isFocused && 'ring-2 ring-inset ring-wine-300',
                        )}
                        style={{ gridTemplateColumns: GRID }}
                      >
                        <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => item.inventoryId && toggleSelect(item.inventoryId)}
                            className="w-4 h-4 rounded border-gray-300 text-wine-600 focus:ring-wine-500 cursor-pointer"
                            aria-label={`Select ${item.name}`}
                          />
                        </div>
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

      {/* Right-click row context menu (NEW-072) */}
      {menu && (() => {
        const item = filteredInventory.find((i) => i.inventoryId === menu.id)
        if (!item) return null
        const isOpen = expandedId === menu.id
        const isSel = selected.has(menu.id)
        const MenuItem = ({ icon: Icon, label, onClick }: { icon: any; label: string; onClick: () => void }) => (
          <button
            onClick={onClick}
            className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 rounded-lg"
          >
            <Icon className="w-4 h-4 text-gray-400" /> {label}
          </button>
        )
        return (
          <div
            className="fixed z-50 w-52 bg-white border border-gray-200 rounded-xl shadow-xl p-1"
            style={{ top: Math.min(menu.y, window.innerHeight - 240), left: Math.min(menu.x, window.innerWidth - 220) }}
            onClick={(e) => e.stopPropagation()}
          >
            <MenuItem icon={ChevronRightIcon} label={isOpen ? 'Collapse row' : 'Expand row'} onClick={() => { setExpandedId(isOpen ? null : menu.id); setMenu(null) }} />
            <MenuItem icon={PackageCheck} label={isSel ? 'Deselect' : 'Select'} onClick={() => { toggleSelect(menu.id); setMenu(null) }} />
            <MenuItem icon={Plus} label={`Draft PO, ${item.threshold} btl`} onClick={() => { navigate(`/orders?draft=new&inventoryId=${menu.id}&qty=${item.threshold}`); setMenu(null) }} />
            <MenuItem icon={Copy} label="Copy name" onClick={() => { navigator.clipboard?.writeText(item.name); setMenu(null) }} />
            <MenuItem icon={FileDown} label="Export this row" onClick={() => {
              void runInventoryExport(
                'csv',
                [item],
                valuationColumns,
                item.name.replace(/[^\w]+/g, '-').toLowerCase() || 'inventory-row',
                item.name,
              )
              setMenu(null)
            }} />
          </div>
        )
      })()}
    </div>
  )
}
