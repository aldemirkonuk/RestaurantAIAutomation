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
  // undefined = not picked yet: From starts on the place holding the most (F-1541).
  const [fromPick, setFromId] = useState<string | null | undefined>(undefined) // null = unassigned
  const [toId, setToId] = useState<string>('')
  // The text as typed, so the field can be cleared and retyped; read on Move (F-1541).
  const [qtyText, setQtyText] = useState('1')
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

  const fromId = fromPick !== undefined ? fromPick : rows[0]?.locationId ?? null
  const fromMax = rows.find((r) => r.locationId === fromId)?.qty ?? 0
  const qty = /^\d+$/.test(qtyText.trim()) ? Number(qtyText.trim()) : NaN
  const qtyOk = Number.isInteger(qty) && qty >= 1 && qty <= fromMax

  // Bottles land on a shelf, never on a place that holds other places: there
  // they could not be counted by shelf (F-1542, the F-945 rule).
  const parentIds = new Set(locations.map((l) => l.parentId).filter(Boolean))
  const destinations = locations.filter((l) => l.id !== fromId && !parentIds.has(l.id))

  // Why Move is off, in words (F-1541).
  const blocked =
    fromMax === 0
      ? 'Nothing to move from here. Pick where the bottles are now.'
      : !toId || toId === fromId
        ? 'Pick where the bottles go.'
        : !qtyOk
          ? `Type how many bottles, from 1 to ${fromMax}.`
          : null

  const doTransfer = async () => {
    if (blocked || fromId === toId) return
    setBusy(true)
    try {
      await onTransfer(fromId, toId, qty)
      setOpen(false)
      setQtyText('1')
    } catch {
      // The caller has said why. The picker stays open on the same move, so
      // pressing Move again re-sends it, under the same key (F-1594).
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
              {destinations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              aria-label="Bottles to move"
              value={qtyText}
              onChange={(e) => setQtyText(e.target.value)}
              className="w-16 text-xs border border-gray-200 rounded px-2 py-1"
            />
            <span className="text-[10px] text-gray-400">/ {fromMax} at source</span>
            <button
              disabled={busy || blocked !== null}
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
          {blocked && <p className="mt-1.5 text-[11px] text-gray-500">{blocked}</p>}
        </div>
      )}
    </div>
  )
}
