/**
 * Batch receive grid — the shared row editor behind both bulk-stock entry points
 * (Menu Scanner's stock-setup step and ManualReceiptWorkspace).
 *
 * Fully controlled: rows in, onChange out, no data fetching beyond the storage
 * location list (a shared React Query cache, so mounting this costs no request).
 * The whole point of the component is a 40-line delivery sheet, so the bulk-fill
 * bar and the column walk matter more than any single cell's polish — typing a
 * case quantity forty times is the friction this replaces.
 */
import { useCallback, useMemo, useRef } from 'react'
import { AlertTriangle, Check, Trash2, Wine } from 'lucide-react'
import { useStorageLocations } from '../../hooks/useStorageLocations'
import { fmtMoney } from '../../pages/inventory/command/bits'
import { cn } from '../../lib/utils'
import type { BulkInventoryLine, WineDraft } from '../../services/api/types'

const GRID = '32px minmax(190px,1.7fr) 76px 104px 172px 96px 34px'

export interface BatchReceiveRow {
  /** Stable client-side key — never sent to the server. */
  key: string
  /** Master Library wine. Mutually exclusive with `draft`. */
  wineId?: string
  /** Identity for a wine the library doesn't have yet; the server resolves-or-creates it. */
  draft?: WineDraft
  name: string
  producer?: string
  vintage?: number | null
  quantity: number
  /** Kept as a string so a half-typed "12." survives a re-render instead of snapping to 12. */
  cost: string
  storageLocationId?: string
  /** Free/comp bottle: forces cost 0 and provenance `sample`, excluded from WAC. */
  isSample: boolean
  selected: boolean
  /** Row-level note worth a manager's eye, e.g. a low-confidence OCR read. */
  hint?: string
  /** Set from a submit response so a failed line stays on screen with its reason. */
  error?: string
}

export interface BatchRowIssue {
  key: string
  name: string
  reason: string
}

export interface BatchTotals {
  rows: number
  bottles: number
  cost: number
  /** Rows that will mint a provisional Master Library entry. */
  provisional: number
  samples: number
}

let rowSeq = 0
/** Row keys only need to be unique within one open workspace. */
export function nextBatchRowKey(prefix = 'row'): string {
  rowSeq += 1
  return `${prefix}-${rowSeq}`
}

export function batchTotals(rows: BatchReceiveRow[]): BatchTotals {
  return rows.reduce<BatchTotals>(
    (acc, row) => {
      const cost = row.isSample ? 0 : Number(row.cost)
      acc.rows += 1
      acc.bottles += row.quantity
      if (Number.isFinite(cost)) acc.cost += cost * row.quantity
      if (row.draft) acc.provisional += 1
      if (row.isSample) acc.samples += 1
      return acc
    },
    { rows: 0, bottles: 0, cost: 0, provisional: 0, samples: 0 },
  )
}

/** Everything that would make the server reject a line, named per row rather than as one generic error. */
export function validateBatchRows(rows: BatchReceiveRow[]): BatchRowIssue[] {
  const issues: BatchRowIssue[] = []
  for (const row of rows) {
    const label = row.name || 'Unnamed wine'
    if (!row.wineId && !row.draft?.name?.trim()) {
      issues.push({ key: row.key, name: label, reason: 'no wine identified' })
    }
    if (!Number.isInteger(row.quantity) || row.quantity < 0) {
      issues.push({ key: row.key, name: label, reason: 'quantity must be a whole number of 0 or more' })
    }
    if (!row.isSample && row.cost.trim() !== '') {
      const cost = Number(row.cost)
      if (!Number.isFinite(cost) || cost < 0) {
        issues.push({ key: row.key, name: label, reason: `cost "${row.cost}" is not a number` })
      }
    }
  }
  return issues
}

/**
 * Rows → bulk endpoint lines. A sample sends an explicit 0 with provenance
 * `sample` so it is distinguishable in the ledger from "cost unknown"; a blank
 * cost sends nothing at all, which is what "we don't know yet" should look like.
 */
export function batchRowsToBulkLines(
  rows: BatchReceiveRow[],
  shared?: { providerId?: string },
): BulkInventoryLine[] {
  return rows.map((row) => {
    const line: BulkInventoryLine = {
      stockLive: row.quantity,
      storageLocationId: row.storageLocationId || null,
    }
    if (row.wineId) line.wineId = row.wineId
    else if (row.draft) line.wineDraft = row.draft
    if (shared?.providerId) line.providerId = shared.providerId

    if (row.isSample) {
      line.costPerBottle = 0
      line.costProvenance = 'sample'
    } else if (row.cost.trim() !== '') {
      line.costPerBottle = Number(row.cost)
      line.costProvenance = 'manual'
    }
    return line
  })
}

interface BatchReceiveGridProps {
  rows: BatchReceiveRow[]
  onChange: (rows: BatchReceiveRow[]) => void
  /** Hide the per-row delete control when the caller's row set is fixed. */
  allowRemove?: boolean
  disabled?: boolean
  /** Rendered in place of the table when there are no rows yet. */
  emptyState?: React.ReactNode
  className?: string
}

export function BatchReceiveGrid({
  rows,
  onChange,
  allowRemove = true,
  disabled = false,
  emptyState,
  className,
}: BatchReceiveGridProps) {
  const { locations } = useStorageLocations()
  const bodyRef = useRef<HTMLDivElement>(null)
  const fillRef = useRef<{ quantity: string; cost: string; locationId: string }>({
    quantity: '',
    cost: '',
    locationId: '',
  })

  const totals = useMemo(() => batchTotals(rows), [rows])
  const issues = useMemo(() => validateBatchRows(rows), [rows])
  const selectedCount = rows.filter((r) => r.selected).length
  const badKeys = useMemo(() => new Set(issues.map((i) => i.key)), [issues])
  const allSamples =
    rows.length > 0 &&
    (selectedCount > 0 ? rows.filter((r) => r.selected) : rows).every((r) => r.isSample)

  const patchRow = useCallback(
    (key: string, patch: Partial<BatchReceiveRow>) => {
      onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))
    },
    [rows, onChange],
  )

  /** Bulk fill targets the selection when there is one, otherwise every row. */
  const applyFill = useCallback(
    (patch: (row: BatchReceiveRow) => Partial<BatchReceiveRow>) => {
      const scoped = selectedCount > 0
      onChange(
        rows.map((row) => (scoped && !row.selected ? row : { ...row, ...patch(row) })),
      )
    },
    [rows, onChange, selectedCount],
  )

  /**
   * Enter / arrows walk the same column so a manager can read down a delivery
   * sheet without reaching for the mouse. preventDefault also kills the number
   * input's native arrow stepping — deliberate: on this screen moving between
   * rows is the far more common intent than nudging one value by one.
   */
  const onCellKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, column: string, index: number) => {
    const delta = e.key === 'Enter' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    if (!delta) return
    e.preventDefault()
    const next = bodyRef.current?.querySelector<HTMLInputElement>(
      `[data-cell="${column}-${index + delta}"]`,
    )
    if (next) {
      next.focus()
      next.select()
    }
  }

  const fillInput = 'w-16 h-7 px-2 text-xs font-mono text-right border border-gray-200 rounded-md outline-none focus:border-wine-500 focus:ring-2 focus:ring-wine-100'

  return (
    <div className={cn('flex flex-col min-h-0', className)}>
      {/* Bulk fill — the column-header equivalent, hoisted so it stays reachable while scrolling */}
      <div className="flex items-center gap-2 flex-wrap px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl mb-2">
        <span className="text-[10.5px] font-bold uppercase tracking-wider text-gray-400">
          Apply to {selectedCount > 0 ? `${selectedCount} selected` : `all ${rows.length}`}
        </span>
        <label className="flex items-center gap-1.5 text-xs text-gray-500">
          Qty
          <input
            type="number"
            min={0}
            disabled={disabled || rows.length === 0}
            defaultValue=""
            onChange={(e) => { fillRef.current.quantity = e.target.value }}
            className={fillInput}
            aria-label="Quantity for bulk fill"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-500">
          Cost
          <input
            type="number"
            min={0}
            step="0.01"
            disabled={disabled || rows.length === 0}
            defaultValue=""
            onChange={(e) => { fillRef.current.cost = e.target.value }}
            className={fillInput}
            aria-label="Cost per bottle for bulk fill"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-500">
          Location
          <select
            disabled={disabled || rows.length === 0}
            defaultValue=""
            onChange={(e) => { fillRef.current.locationId = e.target.value }}
            className="h-7 px-2 text-xs border border-gray-200 rounded-md bg-white outline-none focus:border-wine-500 focus:ring-2 focus:ring-wine-100"
            aria-label="Storage location for bulk fill"
          >
            <option value="">—</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>{loc.name}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={disabled || rows.length === 0}
          onClick={() => {
            const { quantity, cost, locationId } = fillRef.current
            if (quantity === '' && cost === '' && locationId === '') return
            applyFill(() => ({
              ...(quantity !== '' && { quantity: Math.max(0, Math.round(Number(quantity) || 0)) }),
              ...(cost !== '' && { cost, isSample: false }),
              ...(locationId !== '' && { storageLocationId: locationId }),
            }))
          }}
          className="h-7 px-3 rounded-md text-xs font-bold text-white bg-wine-600 hover:bg-wine-700 disabled:opacity-40"
        >
          Fill
        </button>
        <div className="flex-1" />
        <button
          type="button"
          disabled={disabled || rows.length === 0}
          onClick={() => {
            // One decision for the whole scope rather than a per-row flip, which on a
            // mixed selection would just swap which rows are samples.
            const scope = selectedCount > 0 ? rows.filter((r) => r.selected) : rows
            const makeSamples = scope.some((r) => !r.isSample)
            applyFill(() => ({ isSample: makeSamples, cost: '' }))
          }}
          className="h-7 px-3 rounded-md text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 disabled:opacity-40"
        >
          {allSamples ? 'Clear free samples' : 'Mark as free samples'}
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center border border-dashed border-gray-200 rounded-xl p-8 text-center">
          {emptyState ?? <p className="text-sm text-gray-400">No wines on this receipt yet.</p>}
        </div>
      ) : (
        <div className="flex-1 min-h-0 border border-gray-100 rounded-xl overflow-hidden bg-white flex flex-col">
          <div
            className="grid items-center gap-x-3 px-4 h-9 bg-gray-50 border-b border-gray-100 shrink-0"
            style={{ gridTemplateColumns: GRID }}
          >
            <div className="flex items-center">
              <input
                type="checkbox"
                disabled={disabled}
                checked={selectedCount === rows.length}
                onChange={() => {
                  const selectAll = selectedCount !== rows.length
                  onChange(rows.map((row) => ({ ...row, selected: selectAll })))
                }}
                className="w-3.5 h-3.5 rounded border-gray-300 text-wine-600 focus:ring-wine-500 cursor-pointer"
                aria-label="Select all rows"
              />
            </div>
            {['Wine', 'Qty', 'Cost / btl', 'Location', 'Free sample', ''].map((h, i) => (
              <div
                key={h || i}
                className={cn(
                  'text-[10px] font-bold uppercase tracking-wider text-gray-500',
                  (i === 1 || i === 2) && 'text-right',
                )}
              >
                {h}
              </div>
            ))}
          </div>

          <div ref={bodyRef} className="flex-1 min-h-0 overflow-y-auto">
            {rows.map((row, index) => (
              <div
                key={row.key}
                className={cn(
                  'grid items-center gap-x-3 px-4 py-2 border-b border-gray-50 transition-colors',
                  row.error ? 'bg-rose-50/60' : badKeys.has(row.key) ? 'bg-amber-50/50' : row.selected ? 'bg-wine-50/40' : 'hover:bg-gray-50/60',
                )}
                style={{ gridTemplateColumns: GRID }}
              >
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={row.selected}
                    onChange={() => patchRow(row.key, { selected: !row.selected })}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-wine-600 focus:ring-wine-500 cursor-pointer"
                    aria-label={`Select ${row.name}`}
                  />
                </div>

                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-semibold text-gray-900 truncate">{row.name}</span>
                    {row.draft ? (
                      <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[9.5px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700">
                        New to library
                      </span>
                    ) : (
                      <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[9.5px] font-bold uppercase tracking-wide bg-emerald-100 text-emerald-700">
                        Library
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-400 truncate">
                    {[row.producer, row.vintage ?? 'NV'].filter(Boolean).join(' · ')}
                  </div>
                  {row.hint && !row.error && (
                    <div className="text-[10.5px] text-amber-600 font-medium">{row.hint}</div>
                  )}
                  {row.error && (
                    <div className="text-[10.5px] text-rose-600 font-medium">{row.error}</div>
                  )}
                </div>

                <input
                  type="number"
                  min={0}
                  disabled={disabled}
                  data-cell={`qty-${index}`}
                  value={row.quantity}
                  onChange={(e) => patchRow(row.key, { quantity: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                  onKeyDown={(e) => onCellKeyDown(e, 'qty', index)}
                  className="w-full h-8 px-2 text-xs font-mono text-right border border-gray-200 rounded-lg outline-none focus:border-wine-500 focus:ring-2 focus:ring-wine-100 disabled:bg-gray-50"
                  aria-label={`Quantity for ${row.name}`}
                />

                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-gray-400">$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    disabled={disabled || row.isSample}
                    data-cell={`cost-${index}`}
                    value={row.isSample ? '0.00' : row.cost}
                    placeholder="—"
                    onChange={(e) => patchRow(row.key, { cost: e.target.value })}
                    onKeyDown={(e) => onCellKeyDown(e, 'cost', index)}
                    className="w-full h-8 pl-5 pr-2 text-xs font-mono text-right border border-gray-200 rounded-lg outline-none focus:border-wine-500 focus:ring-2 focus:ring-wine-100 disabled:bg-gray-50 disabled:text-gray-400"
                    aria-label={`Cost per bottle for ${row.name}`}
                  />
                </div>

                <select
                  disabled={disabled}
                  value={row.storageLocationId ?? ''}
                  onChange={(e) => patchRow(row.key, { storageLocationId: e.target.value || undefined })}
                  className="w-full h-8 px-2 text-xs border border-gray-200 rounded-lg bg-white text-gray-700 outline-none focus:border-wine-500 focus:ring-2 focus:ring-wine-100 disabled:bg-gray-50"
                  aria-label={`Storage location for ${row.name}`}
                >
                  <option value="">Unassigned</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                  ))}
                </select>

                <label className="flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={row.isSample}
                    onChange={(e) => patchRow(row.key, { isSample: e.target.checked, cost: e.target.checked ? '' : row.cost })}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
                  />
                  {row.isSample ? <span className="text-amber-700 font-semibold">$0</span> : 'Free'}
                </label>

                <div className="flex justify-end">
                  {allowRemove && (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
                      className="p-1 rounded-md text-gray-300 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                      aria-label={`Remove ${row.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live footer — what is about to be written, and what is blocking it */}
      <div className="mt-2 px-4 py-2.5 rounded-xl bg-gray-50 border border-gray-100">
        <div className="flex items-center gap-4 flex-wrap text-xs text-gray-600">
          <span className="flex items-center gap-1.5 font-semibold text-gray-800">
            <Wine className="w-3.5 h-3.5 text-gray-400" />
            {totals.bottles} bottle{totals.bottles !== 1 ? 's' : ''}
            <span className="text-gray-400 font-normal">across {totals.rows} wine{totals.rows !== 1 ? 's' : ''}</span>
          </span>
          <span className="font-mono font-semibold text-gray-800">{fmtMoney(totals.cost)}</span>
          {totals.samples > 0 && (
            <span className="text-amber-700">{totals.samples} free sample{totals.samples !== 1 ? 's' : ''} — excluded from average cost</span>
          )}
          {totals.provisional > 0 && (
            <span className="flex items-center gap-1.5 text-amber-700">
              <AlertTriangle className="w-3.5 h-3.5" />
              {totals.provisional} will be added to the Master Library as provisional
            </span>
          )}
          {issues.length === 0 && rows.length > 0 && (
            <span className="ml-auto flex items-center gap-1 text-emerald-600 font-semibold">
              <Check className="w-3.5 h-3.5" /> Ready to save
            </span>
          )}
        </div>
        {issues.length > 0 && (
          <div className="mt-2 pt-2 border-t border-gray-200 text-[11px] text-rose-600 space-y-0.5">
            {issues.slice(0, 5).map((issue, i) => (
              <p key={`${issue.key}-${i}`}><b className="font-semibold">{issue.name}</b>: {issue.reason}</p>
            ))}
            {issues.length > 5 && <p>…and {issues.length - 5} more row{issues.length - 5 !== 1 ? 's' : ''} to fix.</p>}
          </div>
        )}
      </div>
    </div>
  )
}
