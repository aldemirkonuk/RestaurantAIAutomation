/**
 * Remove from inventory — replaces the old browser `confirm()` flow.
 *
 * Policy (decided 2026-07-29): removal is blocked while a wine still carries
 * live/shadow stock or an open bottle. The manager must first reconcile that
 * stock to zero with an explicit, ledger-visible reason — the same
 * mechanism RowExpansion's "Manual adjust" uses (reconcileItem). Only after
 * every selected item is at zero does the soft-delete (deleteInventoryItem)
 * run. This keeps cost-basis / P&L reporting honest: nothing disappears
 * from the ledger silently, and the economic impact (value being written
 * off) is shown to the manager before they confirm.
 *
 * ── THE HOUSE SHAPE (ADR 0112, census 102 row "Write off N bottles?") ──────
 * SHAPE: `Panel` · the seal. It is a QUESTION the operator answers and leaves
 * — "write off these six bottles?" — not an object they open, so it is centred
 * and not a right sheet. And it ends in `HoldToApprove`, because a reconcile
 * plus a soft-delete is a real ledger commitment: the exact act ADR 0112's
 * ration names ("write off stock"). Bulk here does NOT downgrade to the plain
 * die: the ration is about what the act COSTS, and six bottles written off is
 * six bottles written off however many rows carry them.
 *
 * Three things the legacy branch cannot say, and this one does:
 *
 *  1. **The figure names its rows.** `fmtMoney(totalValue)` was a number with
 *     no ancestry. It now carries the row count and the moment the stock was
 *     read, because a write-off value that cannot be traced is the kind of
 *     figure ADR 0020 exists to stop.
 *  2. **A skipped row is not a removed row.** `run()` silently `continue`s any
 *     item with no `inventoryId` and then reported the full count as removed —
 *     an absence reported as health. The skipped rows are now counted, named,
 *     and shown; the legacy render is untouched, so nothing about the old page
 *     changes.
 *  3. **The seal reads back what it bound** (sketch 103 `1d`). The panel does
 *     not vanish on success: it stays, in a `sealed` phase, saying exactly what
 *     was written to the book and what it was worth. Closing is the operator's
 *     act, in words.
 *
 * The legacy branch below is frozen and renders byte-for-byte as it shipped.
 */
import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Loader2, Trash2, X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { deleteInventoryItem, reconcileItem } from '../../services/api/inventory'
import { ThemedSelect } from '../ui/ThemedSelect'
import { fmtMoney } from '../../pages/inventory/command/bits'
import type { InventoryItem } from '../../pages/inventory/useInventoryPage'
import { Panel } from '../mudavym/Sheet'
import { HoldToApprove } from '../mudavym/HoldToApprove'
import { useMudavymShell } from '../../lib/mudavym/shellGround'
import './inventory-mudavym.css'

const REMOVE_REASONS = [
  { value: 'Discontinued', label: 'Discontinued — no longer carrying' },
  { value: 'Breakage', label: 'Breakage / damaged, written off' },
  { value: 'Return to vendor', label: 'Returned to vendor' },
  { value: 'Comp / gift', label: 'Given away, comp / staff gift' },
  { value: 'Count correction', label: 'Never actually had stock (data entry error)' },
]

interface RemoveFromInventoryModalProps {
  isOpen: boolean
  items: InventoryItem[]
  onClose: () => void
  /** Called once, after every item has been removed. */
  onRemoved: () => void
}

type Phase = 'confirm' | 'working' | 'error' | 'sealed'

/** What the seal actually bound, read back after the write (sketch 103 `1d`). */
interface Bound {
  removed: number
  bottles: number
  value: number
  reason: string
  at: Date
}

export function RemoveFromInventoryModal({ isOpen, items, onClose, onRemoved }: RemoveFromInventoryModalProps) {
  const queryClient = useQueryClient()
  const shell = useMudavymShell()
  const [reason, setReason] = useState(REMOVE_REASONS[0].value)
  const [phase, setPhase] = useState<Phase>('confirm')
  const [failures, setFailures] = useState<{ name: string; message: string }[]>([])
  /**
   * Rows the loop stepped over because they carry no `inventoryId`. Legacy
   * counted them as removed; this branch says they were not touched. State
   * only — the legacy render below never reads it, so it stays byte-identical.
   */
  const [skipped, setSkipped] = useState<string[]>([])
  const [denied, setDenied] = useState(false)
  const [bound, setBound] = useState<Bound | null>(null)

  const rows = useMemo(
    () =>
      items.map((item) => {
        const live = item.liveStock ?? 0
        const shadow = item.shadowStock ?? 0
        const openMl = item.openMl ?? 0
        const total = live + shadow
        const value = (item.wac ?? item.price ?? 0) * total
        return { item, live, shadow, openMl, total, value }
      }),
    [items],
  )
  const totalValue = rows.reduce((s, r) => s + r.value, 0)
  const anyStock = rows.some((r) => r.total > 0 || r.openMl > 0)
  /**
   * When this panel read the stock it is about to write off. A value with no
   * read time is a value the operator cannot check against the shelf.
   */
  const readAt = useMemo(() => new Date(), [items])
  /** How many rows carry a cost at all — the denominator of the money figure. */
  const pricedRows = rows.filter((r) => (r.item.wac ?? r.item.price ?? null) != null).length
  const totalBottles = rows.reduce((s, r) => s + r.total, 0)

  if (!isOpen) return null

  const close = () => {
    if (phase === 'working') return
    setPhase('confirm')
    setFailures([])
    setSkipped([])
    setDenied(false)
    setBound(null)
    onClose()
  }

  const run = async () => {
    setPhase('working')
    setDenied(false)
    const failed: { name: string; message: string }[] = []
    const stepped: string[] = []
    let removed = 0

    for (const { item, total } of rows) {
      const inventoryId = item.inventoryId
      if (!inventoryId) {
        stepped.push(item.name)
        continue
      }
      try {
        // Step 1: zero out any remaining stock, on the ledger, with the chosen reason.
        if (total > 0) {
          await reconcileItem(inventoryId, {
            wineId: item.id,
            actualCount: 0,
            notes: `Removed from inventory — ${reason}`,
          })
        }
        // Step 2: soft-delete the inventory row (keeps the wine in the Wine Library).
        await deleteInventoryItem(inventoryId)
        removed += 1
      } catch (err: any) {
        if (err?.response?.status === 403 || err?.response?.status === 401) setDenied(true)
        failed.push({
          name: item.name,
          message: err?.response?.data?.message || err?.message || 'Unknown error',
        })
      }
    }

    queryClient.invalidateQueries({ queryKey: ['inventory'] })
    setSkipped(stepped)

    if (failed.length === 0) {
      toast.success(
        rows.length === 1
          ? `${rows[0].item.name} removed from inventory`
          : `${rows.length} wines removed from inventory`,
      )
      /* The house branch does not vanish on success: the seal reads back what
         it bound, and the operator closes it in words. The legacy branch keeps
         its original close-on-success behaviour exactly. */
      if (shell.on) {
        setBound({
          removed,
          bottles: rows
            .filter((r) => r.item.inventoryId)
            .reduce((s, r) => s + r.total, 0),
          value: rows
            .filter((r) => r.item.inventoryId)
            .reduce((s, r) => s + r.value, 0),
          reason,
          at: new Date(),
        })
        setPhase('sealed')
        onRemoved()
        return
      }
      setPhase('confirm')
      onRemoved()
      onClose()
    } else {
      setFailures(failed)
      setPhase('error')
    }
  }

  /* ── the house shape ─────────────────────────────────────────────────────
     The title IS the contract sentence and IS the accessible name (sketch 103
     `1e`): the eye and the ear are told the same thing. */
  if (shell.on) {
    const subject =
      rows.length === 1 ? rows[0].item.name : `${rows.length} wines`
    const contract =
      totalBottles > 0
        ? `Write off ${totalBottles} bottle${totalBottles !== 1 ? 's' : ''}?`
        : `Remove ${subject} from the book?`

    return (
      <Panel
        open={isOpen}
        onClose={close}
        label={`${contract} This writes to the ledger. Leaving writes nothing.`}
        eyebrow="The book"
        title={contract}
        closeLabel={phase === 'sealed' ? 'Done' : 'Close'}
        zIndex={110}
        footer={
          <span>
            {phase === 'sealed'
              ? 'The wines stay in the Master Wine Library. Re-add them any time.'
              : 'Leaving writes nothing. The wine stays in the Master Wine Library either way.'}
          </span>
        }
      >
        <div className="mdv-form">
          {phase === 'sealed' && bound ? (
            <>
              <div className="mdv-panelbox">
                <p className="mdv-alert__head">What the seal bound</p>
                <p className="mdv-record">
                  {bound.bottles} {bound.bottles === 1 ? 'bottle' : 'bottles'}
                </p>
                <span className="mdv-prov">
                  {bound.removed} of {rows.length} row{rows.length !== 1 ? 's' : ''} written ·
                  reason “{bound.reason}” ·{' '}
                  {bound.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {bound.value > 0 ? ` · ${fmtMoney(bound.value)} off the book` : ''}
                </span>
              </div>
              {skipped.length > 0 && (
                <div className="mdv-alert" role="status">
                  <p className="mdv-alert__head">Not written</p>
                  <p>
                    {skipped.length} row{skipped.length !== 1 ? 's' : ''} carried no inventory
                    record, so nothing was written for {skipped.join(', ')}. They are unchanged.
                  </p>
                </div>
              )}
              <p className="mdv-hintline">
                Each removal is two ledger entries: the stock reconciled to zero with the reason
                above, then the row retired. Both are readable in the ledger.
              </p>
            </>
          ) : (
            <>
              {phase === 'error' && (
                <div className="mdv-alert" role="alert">
                  <p className="mdv-alert__head">
                    {denied ? 'Not permitted' : 'Not removed'}
                  </p>
                  <p>
                    {denied
                      ? 'This account is not permitted to write off stock. Nothing was written; every row below is unchanged.'
                      : `${failures.length} of ${rows.length} row${rows.length !== 1 ? 's' : ''} were not written. They are unchanged — the rest were removed.`}
                  </p>
                  {failures.map((f) => (
                    <p key={f.name} className="mdv-hintline">
                      {f.name} — {f.message}
                    </p>
                  ))}
                </div>
              )}

              {rows.length === 0 ? (
                <p className="mdv-quiet">Nothing is selected, so there is nothing to write off.</p>
              ) : (
                <>
                  <div>
                    <span className="mdv-head">
                      <span>On the shelf now</span>
                      <span>
                        {rows.length} row{rows.length !== 1 ? 's' : ''}
                      </span>
                    </span>
                    <div className="mdv-lines mdv-scroll">
                      {rows.map(({ item, live, shadow, openMl, value }) => (
                        <div
                          key={item.inventoryId ?? item.id}
                          className="mdv-line"
                          data-owed={!item.inventoryId ? 'true' : undefined}
                        >
                          <span className="mdv-line__name">
                            {item.name}
                            {!item.inventoryId && (
                              <span className="mdv-line__sub">
                                No inventory record — nothing will be written for this row.
                              </span>
                            )}
                          </span>
                          <span className="mdv-line__fig">
                            {live + shadow > 0 ? (
                              <>
                                <b>{live}</b> live / <b>{shadow}</b> shadow
                              </>
                            ) : (
                              'no stock'
                            )}
                            {openMl > 0 ? ` · ${openMl}ml open` : ''}
                            {value > 0 && <> · {fmtMoney(value)}</>}
                          </span>
                        </div>
                      ))}
                    </div>
                    <span className="mdv-prov">
                      Summed from {rows.length} inventory row{rows.length !== 1 ? 's' : ''}
                      {pricedRows < rows.length
                        ? ` · ${rows.length - pricedRows} carry no recorded cost, so they add nothing to the value`
                        : ''}{' '}
                      · read {readAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  {anyStock && (
                    <p className="mdv-consequence">
                      {totalValue > 0 ? (
                        <>
                          This writes off <strong>{fmtMoney(totalValue)}</strong> of on-hand value.{' '}
                        </>
                      ) : null}
                      Remaining stock is reconciled to zero on the ledger with the reason below
                      before the row is retired — nothing is deleted silently.
                    </p>
                  )}

                  <div>
                    <label className="mdv-label" htmlFor="mdv-writeoff-reason">
                      Reason, on the ledger line
                    </label>
                    <ThemedSelect
                      value={reason}
                      options={REMOVE_REASONS}
                      onChange={setReason}
                      align="left"
                      aria-label="Removal reason"
                    />
                  </div>

                  <HoldToApprove
                    onApprove={() => void run()}
                    disabled={phase === 'working'}
                    label={
                      phase === 'working'
                        ? 'Writing to the book…'
                        : totalBottles > 0
                          ? `Hold to write off ${totalBottles} bottle${totalBottles !== 1 ? 's' : ''}`
                          : `Hold to remove ${rows.length} row${rows.length !== 1 ? 's' : ''}`
                    }
                    approvedLabel="Written to the book"
                  />
                </>
              )}
            </>
          )}
        </div>
      </Panel>
    )
  }

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
        onClick={close}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-rose-50">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-rose-600 rounded-xl">
                <Trash2 className="w-4.5 h-4.5 text-white" />
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900">
                  Remove {rows.length === 1 ? rows[0].item.name : `${rows.length} wines`} from inventory
                </h2>
                <p className="text-xs text-gray-500">Keeps the wine in your Wine Library — re-add anytime</p>
              </div>
            </div>
            <button onClick={close} className="p-2 hover:bg-white/60 rounded-lg transition-colors" disabled={phase === 'working'}>
              <X className="w-4.5 h-4.5 text-gray-500" />
            </button>
          </div>

          {/* Body */}
          <div className="p-5 space-y-4">
            {/* Stock list */}
            <div className="max-h-40 overflow-y-auto border border-gray-100 rounded-xl divide-y divide-gray-50">
              {rows.map(({ item, live, shadow, openMl, value }) => (
                <div key={item.inventoryId} className="flex items-center justify-between px-3 py-2 text-xs">
                  <span className="font-medium text-gray-800 truncate pr-2">{item.name}</span>
                  <span className="font-mono text-gray-500 shrink-0">
                    {live + shadow > 0 ? `${live} live / ${shadow} shadow` : 'no stock'}
                    {openMl > 0 ? ` · ${openMl}ml open` : ''}
                    {value > 0 && <b className="ml-2 text-gray-700">{fmtMoney(value)}</b>}
                  </span>
                </div>
              ))}
            </div>

            {anyStock && (
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50 border border-amber-100">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 leading-relaxed">
                  {totalValue > 0 ? (
                    <>This will write off <b>{fmtMoney(totalValue)}</b> in on-hand value. </>
                  ) : null}
                  Remaining stock is reconciled to zero and logged to the ledger with the reason below before removal —
                  nothing is deleted silently.
                </p>
              </div>
            )}

            {phase === 'error' && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-100 text-xs text-rose-700 space-y-1">
                <p className="font-semibold">Some items couldn't be removed:</p>
                {failures.map((f) => (
                  <p key={f.name}>• {f.name}: {f.message}</p>
                ))}
              </div>
            )}

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Reason</label>
              <ThemedSelect value={reason} options={REMOVE_REASONS} onChange={setReason} align="left" aria-label="Removal reason" />
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50">
            <button
              onClick={close}
              disabled={phase === 'working'}
              className="h-9 px-4 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={run}
              disabled={phase === 'working'}
              className="h-9 px-4 flex items-center gap-1.5 rounded-lg text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-60"
            >
              {phase === 'working' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              {phase === 'working' ? 'Removing…' : `Remove ${rows.length === 1 ? 'wine' : `${rows.length} wines`}`}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  )
}
