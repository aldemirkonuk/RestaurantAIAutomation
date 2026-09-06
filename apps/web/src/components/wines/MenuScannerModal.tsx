/**
 * "Carry these bottles" — the menu scan, and what happens to what it read.
 *
 * ── THE HOUSE SHAPE (ADR 0112, census 102, /cellar row) ───────────────────
 * SHAPE: `Sheet`. Bottles entering the book are objects, and the register they
 * are entering stays visible behind the sheet — the same shape /inventory's
 * carry gets, opened at its menu-scan start.
 *
 * WHAT WAS ACTUALLY BROKEN HERE. The census drew this row with a
 * "Carry the 8 I ticked" button and one line of footnote:
 *
 *     "The detection half is real; the approve half wrote nothing before
 *      (WineRegister.tsx:32-47)."
 *
 * That is exactly what was measured. On the rebuilt /cellar the scan ran, read
 * the menu, and then `WineRegister`'s handler said, in its own words, that
 * "no path from a detected title into the library or the cellar exists on this
 * page yet". The reader photographed a menu and got a sentence. A surface over
 * a dead end is the failure this house calls hollow, and re-skinning it would
 * have made the dead end prettier.
 *
 * So the house branch is two steps in one sheet:
 *
 *   1. **Read the menu** — `MenuScannerTab`, unchanged, the half that worked.
 *   2. **Carry what it read** — every detection with its confidence, ticked or
 *      not, with a bottle count per line, written through the SAME bulk path
 *      /inventory's menu scan and manual receipt already use:
 *      `persistBatchToInventory` → `POST /inventory/:restaurantId/items/bulk`
 *      (apps/api-gateway/src/inventory/inventory.controller.ts:77). Nothing new
 *      was invented for the cellar; it was given the door the rest of the house
 *      already had.
 *
 * The engine's reading stays grey and stays a proposal: a low-confidence line
 * arrives UNTICKED with its percentage on the row, because a 0.41 read that is
 * ticked by default is a guess wearing a person's authority. Quantities come
 * from `detectedWinesToBatchRows` — six for a confident read, one for a shaky
 * one — and are editable per line. No cost is ever seeded: the only price on a
 * wine list is the menu price, and a cost basis taken from it wrecks WAC.
 *
 * The outcome is read back per bucket, and a line the server refused stays on
 * the paper with the server's own reason. A provisional library entry is named
 * as provisional so nobody mistakes it for a curated wine.
 *
 * The legacy branch below is frozen and renders byte-for-byte as it shipped —
 * `pages/WineLibrary.tsx:1810` still opens it and that page is not rebuilt.
 */
import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { MenuScannerTab } from './MenuScannerTab'
import { Sheet } from '../mudavym/Sheet'
import { useMudavymShell } from '../../lib/mudavym/shellGround'
import {
  detectedWinesToBatchRows,
  persistBatchToInventory,
  type MenuScannerPersistResult,
} from '../../lib/menuScannerPersistence'
import { batchRowsToBulkLines, type BatchReceiveRow } from '../inventory/BatchReceiveGrid'
import type { DetectedWine } from '../../services/wineDetection'
import '../inventory/inventory-mudavym.css'

interface MenuScannerModalProps {
  isOpen: boolean
  onClose: () => void
  onWinesDetected: (wines: any[]) => void
  /**
   * Fired once the carry has been written, with what the house accepted.
   * House branch only — the legacy openers never pass it and never see it.
   */
  onCarried?: (result: MenuScannerPersistResult) => void
}

/** A detected line, plus the two things a person decides about it. */
interface CarryLine {
  row: BatchReceiveRow
  detected: DetectedWine
  ticked: boolean
}

/** Below this the read is shaky enough that ticking it by default is a guess. */
const LOW_CONFIDENCE = 0.6

export function MenuScannerModal({
  isOpen,
  onClose,
  onWinesDetected,
  onCarried,
}: MenuScannerModalProps) {
  const shell = useMudavymShell()
  const [lines, setLines] = useState<CarryLine[] | null>(null)
  const [carrying, setCarrying] = useState(false)
  const [outcome, setOutcome] = useState<{
    result: MenuScannerPersistResult
    at: Date
  } | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)

  const tickedCount = useMemo(
    () => (lines ?? []).filter((l) => l.ticked).length,
    [lines],
  )
  const tickedBottles = useMemo(
    () => (lines ?? []).filter((l) => l.ticked).reduce((s, l) => s + l.row.quantity, 0),
    [lines],
  )

  if (!isOpen) return null

  const takeDetections = (wines: DetectedWine[]) => {
    const rows = detectedWinesToBatchRows(wines)
    setLines(
      rows.map((row, i) => ({
        row,
        detected: wines[i],
        // A shaky read arrives UNTICKED. The engine proposes; a person applies.
        ticked: (wines[i]?.confidence ?? 0) >= LOW_CONFIDENCE,
      })),
    )
    onWinesDetected(wines)
  }

  const carry = async () => {
    const picks = (lines ?? []).filter((l) => l.ticked)
    if (picks.length === 0) return
    setCarrying(true)
    setFailure(null)
    setDenied(false)
    try {
      const result = await persistBatchToInventory(
        batchRowsToBulkLines(picks.map((l) => l.row)),
        { source: 'menu_scan', reason: 'Carried from a menu scan' },
      )
      setOutcome({ result, at: new Date() })
      onCarried?.(result)
    } catch (err) {
      const e = err as {
        response?: { status?: number; data?: { message?: string } }
        message?: string
      }
      setDenied(e?.response?.status === 403 || e?.response?.status === 401)
      setFailure(e?.response?.data?.message || e?.message || 'the request did not complete')
    } finally {
      setCarrying(false)
    }
  }

  /* ── the house shape ───────────────────────────────────────────────────── */
  if (shell.on) {
    const step: 'scan' | 'carry' | 'done' = outcome ? 'done' : lines ? 'carry' : 'scan'
    const result = outcome?.result
    const landed = result
      ? result.added.length + result.stockAdded.length + result.reactivated.length
      : 0

    return (
      <Sheet
        open
        onClose={onClose}
        label={
          step === 'scan'
            ? 'Read a menu. Nothing is written by reading it — you choose what to carry afterwards.'
            : 'Carry these bottles. Carrying writes an inventory row for each ticked line. Leaving writes nothing.'
        }
        eyebrow="The register"
        title={step === 'done' ? 'What was carried' : 'Carry these bottles'}
        wide
        closeLabel={step === 'done' ? 'Done' : 'Close'}
        zIndex={110}
        footer={
          <span>
            A wine the library does not hold is carried against a provisional entry and marked as
            one. No cost is taken from a menu price.
          </span>
        }
      >
        <div className="mdv-form">
          <p className="mdv-contract">
            {step === 'scan'
              ? 'Upload a wine list. The reader detects titles; nothing reaches the book until you tick lines and carry them.'
              : step === 'carry'
                ? 'The reader proposes; you decide. Carrying writes one inventory row per ticked line. Leaving writes nothing.'
                : 'This is what the house accepted. Anything it refused is named below and was not written.'}
          </p>

          {failure && (
            <div className="mdv-alert" role="alert">
              <p className="mdv-alert__head">{denied ? 'Not permitted' : 'Not carried'}</p>
              <p>
                {denied
                  ? 'This account is not permitted to write inventory rows. Nothing was carried; the register is unchanged.'
                  : `Nothing was carried — ${failure}. Every line below is still ticked and still unwritten.`}
              </p>
            </div>
          )}

          {step === 'scan' && (
            <div className="mdv-panelbox" style={{ padding: 0, overflow: 'hidden' }}>
              <MenuScannerTab onWinesDetected={takeDetections as (w: unknown[]) => void} />
            </div>
          )}

          {step === 'carry' && lines && (
            <>
              {lines.length === 0 ? (
                <p className="mdv-quiet">
                  The reader found no wine titles on that menu. That is its answer, not a failure —
                  nothing was written and nothing is waiting.
                </p>
              ) : (
                <div>
                  <span className="mdv-head">
                    <span>From the menu scan — {lines.length} found</span>
                    <button
                      type="button"
                      className="mdv-link"
                      onClick={() => {
                        const all = lines.every((l) => l.ticked)
                        setLines(lines.map((l) => ({ ...l, ticked: !all })))
                      }}
                    >
                      {lines.every((l) => l.ticked) ? 'Untick all' : 'Tick all'}
                    </button>
                  </span>
                  <div className="mdv-picks mdv-scroll">
                    {lines.map((line, i) => {
                      const conf = line.detected?.confidence ?? null
                      return (
                        <div key={line.row.key} className="mdv-pick" aria-checked={line.ticked} role="group">
                          <span style={{ minWidth: 0, flex: '1 1 auto' }}>
                            <span className="mdv-pick__label" style={{ whiteSpace: 'normal' }}>
                              {line.row.name}
                              {line.row.producer ? ` · ${line.row.producer}` : ''}
                              {line.row.vintage ? ` ${line.row.vintage}` : ''}
                            </span>
                            {/* The reader's words, grey, with its own number. */}
                            <span className="mdv-grey">
                              {conf == null
                                ? 'read with no confidence recorded'
                                : `read with confidence ${conf.toFixed(2)}`}
                              {line.row.hint ? ` — ${line.row.hint}` : ''}
                              {line.row.wineId
                                ? ' · matched in the library'
                                : ' · new to the library, carried as provisional'}
                            </span>
                            <span style={{ display: 'block', marginTop: 5 }}>
                              <label className="mdv-label" htmlFor={`qty-${line.row.key}`}>
                                Bottles
                              </label>
                              <input
                                id={`qty-${line.row.key}`}
                                className="mdv-input"
                                type="number"
                                min={1}
                                value={line.row.quantity}
                                onChange={(e) => {
                                  const q = Math.max(1, Number(e.target.value) || 1)
                                  setLines((prev) =>
                                    (prev ?? []).map((l, j) =>
                                      j === i ? { ...l, row: { ...l.row, quantity: q } } : l,
                                    ),
                                  )
                                }}
                                style={{ maxWidth: 110 }}
                              />
                            </span>
                          </span>
                          <input
                            type="checkbox"
                            aria-label={`Carry ${line.row.name}`}
                            checked={line.ticked}
                            onChange={(e) =>
                              setLines((prev) =>
                                (prev ?? []).map((l, j) =>
                                  j === i ? { ...l, ticked: e.target.checked } : l,
                                ),
                              )
                            }
                          />
                        </div>
                      )
                    })}
                  </div>
                  <span className="mdv-prov">
                    {lines.length} title{lines.length !== 1 ? 's' : ''} read off the menu you
                    uploaded · {lines.filter((l) => (l.detected?.confidence ?? 1) < LOW_CONFIDENCE).length}{' '}
                    below 0.60 and left unticked
                  </span>
                </div>
              )}

              {/* Nothing read means nothing to press. An empty actions row with a
                  dead button would read as a surface waiting on the operator. */}
              {lines.length > 0 && (
                <div className="mdv-actions">
                  <span className="mdv-tally">
                    {tickedCount} line{tickedCount !== 1 ? 's' : ''} · {tickedBottles} bottle
                    {tickedBottles !== 1 ? 's' : ''}
                  </span>
                  <button type="button" className="mdv-btn" onClick={onClose} disabled={carrying}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="mdv-btn mdv-btn--seal"
                    onClick={() => void carry()}
                    disabled={carrying || tickedCount === 0}
                  >
                    {carrying ? 'Carrying…' : `Carry the ${tickedCount} I ticked`}
                  </button>
                </div>
              )}
            </>
          )}

          {step === 'done' && result && (
            <>
              <div className="mdv-panelbox">
                <p className="mdv-alert__head">Carried</p>
                <p className="mdv-record">{landed}</p>
                <span className="mdv-prov">
                  of {landed + result.failed.length} ticked ·{' '}
                  {outcome.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              <div className="mdv-lines">
                <div className="mdv-line">
                  <span className="mdv-line__name">New rows on the register</span>
                  <span className="mdv-line__fig">
                    <b>{result.added.length}</b>
                  </span>
                </div>
                <div className="mdv-line">
                  <span className="mdv-line__name">Added to a row that already existed</span>
                  <span className="mdv-line__fig">
                    <b>{result.stockAdded.length}</b>
                  </span>
                </div>
                <div className="mdv-line">
                  <span className="mdv-line__name">Rows brought back</span>
                  <span className="mdv-line__fig">
                    <b>{result.reactivated.length}</b>
                  </span>
                </div>
                <div className="mdv-line" data-owed={result.provisional.length > 0 ? 'true' : undefined}>
                  <span className="mdv-line__name">
                    New to the library, carried as provisional
                    <span className="mdv-line__sub">
                      A provisional entry is not a curated wine. It is marked so nobody reads it as
                      one.
                    </span>
                  </span>
                  <span className="mdv-line__fig">
                    <b>{result.provisional.length}</b>
                  </span>
                </div>
              </div>

              {result.failed.length > 0 && (
                <div className="mdv-alert" role="alert">
                  <p className="mdv-alert__head">Not carried</p>
                  <p>
                    {result.failed.length} line{result.failed.length !== 1 ? 's' : ''} were refused
                    and wrote nothing. The rest are on the register.
                  </p>
                  {result.failed.map((f, i) => (
                    <p key={`${f.wineName ?? 'line'}-${i}`} className="mdv-hintline">
                      {f.wineName ?? `Line ${i + 1}`} — {f.error ?? 'no reason was returned'}
                    </p>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </Sheet>
    )
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl h-[80vh] overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-indigo-50 to-purple-50">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Menu Scanner</h2>
                <p className="text-sm text-gray-500">Upload your menu to detect multiple wines at once</p>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/50 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* Content */}
            <MenuScannerTab onWinesDetected={onWinesDetected} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
