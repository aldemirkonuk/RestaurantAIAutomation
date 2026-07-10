'use client'
import { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronDown, Loader2, ArrowRight } from 'lucide-react'
import type { StorageLocation } from '../../hooks/useStorageLocations'

export interface LocationBreakdown {
  locationId: string | null
  qty: number
  wac: number | null
}

interface MultiLocationCellProps {
  totalLive: number
  breakdown: LocationBreakdown[]
  locations: StorageLocation[]
  onTransfer: (
    fromLocationId: string | null,
    toLocationId: string,
    qty: number,
  ) => Promise<void>
}

/**
 * Multi-location cell: a wine can live in many locations at once (lots as source of truth).
 * Shows per-location chips and a "move N bottles from A → B" control. Replaces the old
 * one-wine-one-location picker.
 */
export function MultiLocationCell({
  totalLive,
  breakdown,
  locations,
  onTransfer,
}: MultiLocationCellProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [fromId, setFromId] = useState<string | null>(null) // null = unassigned
  const [toId, setToId] = useState<string>('')
  const [qty, setQty] = useState(1)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const locName = (id: string | null) =>
    id === null ? 'Unassigned' : locations.find((l) => l.id === id)?.name ?? 'Unknown'
  const locColor = (id: string | null) =>
    id === null ? '#9ca3af' : locations.find((l) => l.id === id)?.color ?? '#6b7280'

  // Named locations first (qty desc), unassigned last.
  const rows = useMemo(
    () =>
      [...breakdown]
        .filter((b) => b.qty > 0)
        .sort((a, b) => {
          if ((a.locationId === null) !== (b.locationId === null))
            return a.locationId === null ? 1 : -1
          return b.qty - a.qty
        }),
    [breakdown],
  )

  const fromMax = rows.find((r) => r.locationId === fromId)?.qty ?? 0

  const doTransfer = async () => {
    if (!toId || qty <= 0 || qty > fromMax || fromId === toId) return
    setBusy(true)
    try {
      await onTransfer(fromId, toId, qty)
      setOpen(false)
      setQty(1)
    } finally {
      setBusy(false)
    }
  }

  if (totalLive === 0) {
    return <span className="text-xs text-gray-300">— no stock</span>
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex flex-wrap items-center gap-1 max-w-full text-left"
        title="Click to move bottles between locations"
      >
        {rows.length === 0 ? (
          <span className="text-xs text-amber-600">{totalLive} unplaced</span>
        ) : (
          rows.map((r) => (
            <span
              key={r.locationId ?? 'unassigned'}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-white border border-gray-200 shadow-sm"
              title={`${r.qty} in ${locName(r.locationId)}`}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: locColor(r.locationId) }}
              />
              <span className="truncate max-w-[64px] text-gray-700">
                {locName(r.locationId)}
              </span>
              <span className="font-semibold text-gray-500">{r.qty}</span>
            </span>
          ))
        )}
        <ChevronDown className="w-3 h-3 text-gray-400 flex-shrink-0" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 w-64 bg-white rounded-lg shadow-xl border border-gray-100 p-3">
          <p className="text-[11px] font-semibold text-gray-500 mb-2">
            Move bottles between locations
          </p>
          <div className="flex items-center gap-1.5 mb-2">
            <select
              value={fromId ?? ''}
              onChange={(e) => setFromId(e.target.value || null)}
              className="flex-1 min-w-0 text-xs border border-gray-200 rounded px-1.5 py-1"
            >
              <option value="">
                Unassigned ({rows.find((r) => r.locationId === null)?.qty ?? 0})
              </option>
              {rows
                .filter((r) => r.locationId !== null)
                .map((r) => (
                  <option key={r.locationId!} value={r.locationId!}>
                    {locName(r.locationId)} ({r.qty})
                  </option>
                ))}
            </select>
            <ArrowRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
            <select
              value={toId}
              onChange={(e) => setToId(e.target.value)}
              className="flex-1 min-w-0 text-xs border border-gray-200 rounded px-1.5 py-1"
            >
              <option value="">To…</option>
              {locations
                .filter((l) => l.id !== fromId)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={fromMax}
              value={qty}
              onChange={(e) =>
                setQty(Math.max(1, Math.min(fromMax, parseInt(e.target.value) || 1)))
              }
              className="w-16 text-xs border border-gray-200 rounded px-2 py-1"
            />
            <span className="text-[10px] text-gray-400">/ {fromMax} at source</span>
            <button
              disabled={busy || !toId || qty > fromMax || fromMax === 0}
              onClick={doTransfer}
              className="ml-auto px-2.5 py-1 bg-wine-600 text-white rounded text-xs font-medium hover:bg-wine-700 disabled:opacity-40 flex items-center gap-1"
            >
              {busy ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <ArrowRight className="w-3 h-3" />
              )}
              Move
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
