/**
 * "Place N bottles by their zones?" — the auto-locate proposal.
 *
 * ── THE HOUSE SHAPE (ADR 0112, census 102) ────────────────────────────────
 * SHAPE: `Panel`, and the PLAIN DIE. It is a question about a batch, answered
 * once and left, so it is centred — and bulk gets the plain button, never the
 * wax (ADR 0112 rule 3). A zone mapping is not a ledger row: it says where a
 * bottle sits, not that it exists.
 *
 * WHAT THE ENGINE IS ALLOWED TO DO HERE. Nothing. It proposes a zone per wine,
 * with its score and the reasons it scored that way, and every one of them sits
 * GREY beside the row until a person leaves the tick on (sketch 103 `2c`). The
 * ticks choose; the button applies; nothing is written by opening this.
 *
 * TWO THINGS THE LEGACY BRANCH COULD NOT SAY:
 *
 *  1. **What actually landed.** `onConfirm` fired `assignWineToLocation` per
 *     row — fire-and-forget through `persistToServer`, which swallows every
 *     failure — and then toasted "14 wines assigned to locations". True about
 *     the React Query cache; possibly false about the database. The house
 *     branch awaits `assignWinesToLocations` and reports the rows that did not
 *     land, with the server's own words, and separates a refusal from a fault.
 *  2. **Which wines were skipped, and why.** The header counted them
 *     ("3 skipped (no valid match)") and the panel never named one. A count
 *     with no rows behind it is the figure ADR 0020 exists to stop.
 *
 * The legacy branch below is frozen and renders byte-for-byte as it shipped.
 */
import { useMemo, useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Zap } from 'lucide-react'
import type { WineLocationScore, AutoLocateResult } from '../../lib/autoLocateEngine'
import type { StorageLocation } from '../../hooks/useStorageLocations'
import { Panel } from '../mudavym/Sheet'
import { useMudavymShell } from '../../lib/mudavym/shellGround'
import './inventory-mudavym.css'

interface AutoLocatePreviewModalProps {
  isOpen: boolean
  onClose: () => void
  result: AutoLocateResult
  allLocations: StorageLocation[]
  includeAssigned: boolean
  onToggleIncludeAssigned: (val: boolean) => void
  onConfirm: (selected: WineLocationScore[]) => void
  /**
   * The awaited apply, used by the house branch only.
   *
   * `onConfirm` stays exactly what it was so the legacy branch's behaviour is
   * untouched; this one returns what the server actually accepted, so the panel
   * can say which rows did not land instead of claiming they all did.
   */
  onApply?: (selected: WineLocationScore[]) => Promise<{
    written: string[]
    failed: { wineId: string; label: string; message: string }[]
    denied: boolean
  }>
}

export function AutoLocatePreviewModal({
  isOpen,
  onClose,
  result,
  allLocations,
  includeAssigned,
  onToggleIncludeAssigned,
  onConfirm,
  onApply,
}: AutoLocatePreviewModalProps) {
  const shell = useMudavymShell()
  const [rows, setRows] = useState<WineLocationScore[]>([])
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  /* House-branch state; the legacy render never reads any of it. */
  const [applying, setApplying] = useState(false)
  const [outcome, setOutcome] = useState<{
    written: number
    failed: { wineId: string; label: string; message: string }[]
    denied: boolean
    at: Date
  } | null>(null)
  const readAt = useMemo(() => new Date(), [result])

  useEffect(() => {
    setRows(result.assignments)
    const initial: Record<string, boolean> = {}
    result.assignments.forEach(a => {
      initial[a.wineId] = true
    })
    setChecked(initial)
  }, [result])

  const selectedCount = Object.values(checked).filter(Boolean).length
  const locationsUtilized = new Set(
    rows.filter(r => checked[r.wineId]).map(r => r.locationId),
  ).size
  const skippedCount = result.skipped.length

  const handleLocationChange = (wineId: string, newLocationId: string) => {
    setRows(prev =>
      prev.map(r =>
        r.wineId === wineId
          ? {
              ...r,
              locationId: newLocationId,
              locationName:
                allLocations.find(l => l.id === newLocationId)?.name ?? r.locationName,
            }
          : r,
      ),
    )
  }

  const apply = async () => {
    const picks = rows.filter((r) => checked[r.wineId])
    if (picks.length === 0 || !onApply) return
    setApplying(true)
    try {
      const res = await onApply(picks)
      setOutcome({
        written: res.written.length,
        failed: res.failed,
        denied: res.denied,
        at: new Date(),
      })
    } finally {
      setApplying(false)
    }
  }

  /* ── the house shape ───────────────────────────────────────────────────── */
  if (shell.on) {
    const contract = `Place ${selectedCount} bottle${selectedCount !== 1 ? 's' : ''} by their zones?`
    return (
      <Panel
        open={isOpen}
        onClose={onClose}
        label={`${contract} Applying writes a zone for each ticked wine. Leaving writes nothing.`}
        eyebrow="The zones"
        title={outcome ? 'What was placed' : contract}
        closeLabel={outcome ? 'Done' : 'Close'}
        zIndex={110}
        footer={
          <span>
            A zone says where a bottle sits, not that it exists. Nothing here touches the ledger.
          </span>
        }
      >
        <div className="mdv-form">
          <p className="mdv-contract">
            {outcome
              ? 'This is what the house accepted. Anything it refused is named below and is unplaced.'
              : 'The engine proposes a zone for each wine. The ticks choose; nothing is written until you apply. Leaving writes nothing.'}
          </p>

          {outcome ? (
            <>
              <div className="mdv-panelbox">
                <p className="mdv-alert__head">Placed</p>
                <p className="mdv-record">{outcome.written}</p>
                <span className="mdv-prov">
                  of {outcome.written + outcome.failed.length} ticked ·{' '}
                  {outcome.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              {outcome.failed.length > 0 && (
                <div className="mdv-alert" role="alert">
                  <p className="mdv-alert__head">
                    {outcome.denied ? 'Not permitted' : 'Not placed'}
                  </p>
                  <p>
                    {outcome.denied
                      ? 'This account is not permitted to write zone assignments. The wines below are unplaced.'
                      : `${outcome.failed.length} wine${outcome.failed.length !== 1 ? 's were' : ' was'} not written. ${outcome.failed.length !== 1 ? 'They are' : 'It is'} unplaced — nothing else changed.`}
                  </p>
                  {outcome.failed.map((f) => (
                    <p key={f.wineId} className="mdv-hintline">
                      {f.label} — {f.message}
                    </p>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="mdv-pick">
                <span style={{ minWidth: 0 }}>
                  <label className="mdv-pick__label" htmlFor="mdv-include-assigned">
                    Include wines that already have a zone
                  </label>
                  <span className="mdv-pick__sub">Ticking this reassigns them.</span>
                </span>
                <input
                  id="mdv-include-assigned"
                  type="checkbox"
                  checked={includeAssigned}
                  onChange={(e) => onToggleIncludeAssigned(e.target.checked)}
                />
              </div>

              {rows.length === 0 ? (
                <p className="mdv-quiet">
                  The engine proposed no placements. That is its answer, not a failure — every wine
                  it looked at either has a zone already or matched none.
                </p>
              ) : (
                <div>
                  <span className="mdv-head">
                    <span>The proposal</span>
                    <button
                      type="button"
                      className="mdv-link"
                      onClick={() => {
                        const all = rows.every((r) => checked[r.wineId])
                        const next: Record<string, boolean> = {}
                        rows.forEach((r) => {
                          next[r.wineId] = !all
                        })
                        setChecked(next)
                      }}
                    >
                      {rows.every((r) => checked[r.wineId]) ? 'Untick all' : 'Tick all'}
                    </button>
                  </span>
                  <div className="mdv-picks mdv-scroll">
                    {rows.map((row) => {
                      const on = checked[row.wineId] ?? true
                      return (
                        <div key={row.wineId} className="mdv-pick" aria-checked={on} role="group">
                          <span style={{ minWidth: 0, flex: '1 1 auto' }}>
                            <span className="mdv-pick__label">{row.wineName}</span>
                            {/* The engine's words. Grey, and they stay grey. */}
                            <span className="mdv-grey">
                              proposes {row.locationName} · {row.score} points ·{' '}
                              {row.reasons.length > 0
                                ? row.reasons.join(' · ')
                                : 'no reason was recorded'}
                            </span>
                            <span style={{ display: 'block', marginTop: 5 }}>
                              <label className="mdv-label" htmlFor={`zone-${row.wineId}`}>
                                Zone
                              </label>
                              <select
                                id={`zone-${row.wineId}`}
                                className="mdv-select"
                                value={row.locationId}
                                onChange={(e) => handleLocationChange(row.wineId, e.target.value)}
                              >
                                {allLocations.map((loc) => (
                                  <option key={loc.id} value={loc.id}>
                                    {loc.name} ({loc.currentCount}/{loc.capacity ?? 'no capacity recorded'})
                                  </option>
                                ))}
                              </select>
                            </span>
                          </span>
                          <input
                            type="checkbox"
                            aria-label={`Place ${row.wineName}`}
                            checked={on}
                            onChange={(e) =>
                              setChecked((prev) => ({ ...prev, [row.wineId]: e.target.checked }))
                            }
                          />
                        </div>
                      )
                    })}
                  </div>
                  <span className="mdv-prov">
                    {rows.length} proposal{rows.length !== 1 ? 's' : ''} scored from this tenant's
                    zones and the wines on the register · read{' '}
                    {readAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ·{' '}
                    {locationsUtilized} zone{locationsUtilized !== 1 ? 's' : ''} would be used
                  </span>
                </div>
              )}

              {/* A count with no rows behind it is not a fact. Name them. */}
              {skippedCount > 0 && (
                <div>
                  <span className="mdv-head">
                    <span>Matched no zone — {skippedCount}</span>
                  </span>
                  <div className="mdv-lines">
                    {result.skipped.map((w) => (
                      <div key={w.id} className="mdv-line" data-owed="true">
                        <span className="mdv-line__name">
                          {w.name}
                          <span className="mdv-line__sub">
                            No zone scored above nothing for this bottle. It stays where it is.
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mdv-actions">
                <span className="mdv-tally">
                  {selectedCount} of {rows.length} ticked
                </span>
                <button type="button" className="mdv-btn" onClick={onClose} disabled={applying}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="mdv-btn mdv-btn--seal"
                  onClick={() => void apply()}
                  disabled={applying || selectedCount === 0 || !onApply}
                >
                  {applying
                    ? 'Placing…'
                    : `Place ${selectedCount} wine${selectedCount !== 1 ? 's' : ''}`}
                </button>
              </div>
              {!onApply && (
                <p className="mdv-hintline">
                  This panel was mounted without an apply path, so the button is unavailable.
                  Nothing here can write.
                </p>
              )}
            </>
          )}
        </div>
      </Panel>
    )
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/50 z-50"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            key="panel"
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
          >
            <div
              className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[85vh] flex flex-col pointer-events-auto"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                    <Zap className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">Auto-Locate Preview</h2>
                    <div className="flex gap-5 mt-0.5 text-sm text-gray-500">
                      <span>
                        <strong className="text-gray-800">{selectedCount}</strong> wines to assign
                      </span>
                      <span>
                        <strong className="text-gray-800">{locationsUtilized}</strong> locations utilized
                      </span>
                      {skippedCount > 0 && (
                        <span className="text-amber-600">
                          <strong>{skippedCount}</strong> skipped (no valid match)
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Toggle */}
              <div className="px-6 py-3 border-b border-gray-50 bg-gray-50/60">
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includeAssigned}
                    onChange={e => onToggleIncludeAssigned(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  Include already-assigned wines (will reassign them)
                </label>
              </div>

              {/* Table */}
              <div className="flex-1 overflow-y-auto">
                {rows.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                    <Zap className="w-8 h-8 mb-3 opacity-30" />
                    <p className="text-sm">No wines to assign</p>
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-white border-b border-gray-100 z-10">
                      <tr>
                        <th className="w-8 pl-6 py-3 text-left">
                          <input
                            type="checkbox"
                            checked={rows.length > 0 && rows.every(r => checked[r.wineId])}
                            onChange={e => {
                              const next: Record<string, boolean> = {}
                              rows.forEach(r => {
                                next[r.wineId] = e.target.checked
                              })
                              setChecked(next)
                            }}
                            className="rounded border-gray-300"
                          />
                        </th>
                        <th className="py-3 text-left font-medium text-gray-500 pr-4">Wine</th>
                        <th className="py-3 text-left font-medium text-gray-500 pr-4">
                          Proposed Location
                        </th>
                        <th className="py-3 text-left font-medium text-gray-500 pr-4">Score</th>
                        <th className="py-3 text-left font-medium text-gray-500 pr-6">Reasons</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {rows.map(row => (
                        <tr
                          key={row.wineId}
                          className={`transition-colors ${
                            checked[row.wineId] ? 'bg-white' : 'bg-gray-50/50 opacity-60'
                          }`}
                        >
                          {/* Checkbox */}
                          <td className="pl-6 py-3 w-8">
                            <input
                              type="checkbox"
                              checked={checked[row.wineId] ?? true}
                              onChange={e =>
                                setChecked(prev => ({ ...prev, [row.wineId]: e.target.checked }))
                              }
                              className="rounded border-gray-300"
                            />
                          </td>

                          {/* Wine name + type */}
                          <td className="py-3 pr-4">
                            <div className="font-medium text-gray-900 truncate max-w-[180px]">
                              {row.wineName}
                            </div>
                            <div className="text-xs text-gray-400 capitalize">{row.wineType}</div>
                          </td>

                          {/* Location dropdown */}
                          <td className="py-3 pr-4">
                            <select
                              value={row.locationId}
                              onChange={e => handleLocationChange(row.wineId, e.target.value)}
                              className="text-sm border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 max-w-[200px]"
                            >
                              {allLocations.map(loc => (
                                <option key={loc.id} value={loc.id}>
                                  {loc.name} ({loc.currentCount}/{loc.capacity ?? '—'})
                                </option>
                              ))}
                            </select>
                          </td>

                          {/* Score badge */}
                          <td className="py-3 pr-4">
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                                row.score >= 70
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : row.score >= 40
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-gray-100 text-gray-600'
                              }`}
                            >
                              {row.score}pts
                            </span>
                          </td>

                          {/* Reasons */}
                          <td className="py-3 pr-6">
                            <span className="text-xs text-gray-500">
                              {row.reasons.join(' · ') || '—'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-white rounded-b-xl">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => onConfirm(rows.filter(r => checked[r.wineId]))}
                  disabled={selectedCount === 0}
                  className="px-6 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Confirm Selected ({selectedCount})
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
