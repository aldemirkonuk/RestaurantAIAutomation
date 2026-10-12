/**
 * Remove from inventory — replaces the old browser `confirm()` flow.
 *
 * Policy (decided 2026-07-29): removal is blocked while a wine still carries
 * live/shadow stock or an open bottle. The bottles still on the shelf are
 * first taken off as a movement carrying the chosen reason — the same
 * mechanism RowExpansion's "Manual adjust" uses (adjustStock). Only after
 * every selected item is at zero does the soft-delete (deleteInventoryItem)
 * run.
 *
 * F-1539: this used to send a shelf count of 0. A count is a variance, so the
 * month close showed every removed bottle as missing. A take-off is not a
 * count: breakage is written off, a comp is a comp, and none of it is short. This keeps cost-basis / P&L reporting honest: nothing disappears
 * from the ledger silently, and the economic impact (value being written
 * off) is shown to the manager before they confirm.
 */
import { useId, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Loader2, Trash2, X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { adjustStock, deleteInventoryItem } from '../../services/api/inventory'
import { newClientCountId } from '../../lib/spotCountOutbox'
import { formatVolume } from '../../utils/volumeUtils'
import { useRestaurantSettingsStore } from '../../stores/restaurantSettingsStore'
import { ThemedSelect } from '../ui/ThemedSelect'
import { fmtMoney } from '../../pages/inventory/command/bits'
import { recordedCost, type InventoryItem } from '../../pages/inventory/useInventoryPage'
import { useModalDialog } from '../../hooks/useModalDialog'

const REMOVE_REASONS = [
  { value: 'Discontinued', label: 'Discontinued — no longer carrying' },
  { value: 'Breakage', label: 'Breakage / damaged, written off' },
  { value: 'Return to vendor', label: 'Returned to vendor' },
  { value: 'Comp / gift', label: 'Given away, comp / staff gift' },
  { value: 'Count correction', label: 'Never actually had stock (data entry error)' },
]

/**
 * How each reason goes on the ledger (F-1539). A bottle sent back to the vendor
 * is an adjustment: 'return' on this ledger means a bottle coming back IN.
 */
const REMOVE_MOVEMENT: Record<string, 'adjustment' | 'waste' | 'comp' | 'correction'> = {
  Discontinued: 'waste',
  Breakage: 'waste',
  'Return to vendor': 'adjustment',
  'Comp / gift': 'comp',
  'Count correction': 'correction',
}

interface RemoveFromInventoryModalProps {
  isOpen: boolean
  items: InventoryItem[]
  onClose: () => void
  /** Called once, after every item has been removed. */
  onRemoved: () => void
}

type Phase = 'confirm' | 'working' | 'error'

export function RemoveFromInventoryModal({ isOpen, items, onClose, onRemoved }: RemoveFromInventoryModalProps) {
  const queryClient = useQueryClient()
  const measurementUnit = useRestaurantSettingsStore((s) => s.measurementUnit)
  const [reason, setReason] = useState(REMOVE_REASONS[0].value)
  const [phase, setPhase] = useState<Phase>('confirm')
  const [failures, setFailures] = useState<{ name: string; message: string }[]>([])

  const rows = useMemo(
    () =>
      items.map((item) => {
        const live = item.liveStock ?? 0
        const shadow = item.shadowStock ?? 0
        const openMl = item.openMl ?? 0
        const total = live + shadow
        // What the house paid, never the library's price (F-1311). With no
        // recorded cost the value is withheld (null), not counted at 0.
        const cost = recordedCost(item)
        const value = cost == null ? (total > 0 ? null : 0) : cost * total
        return { item, live, shadow, openMl, total, value }
      }),
    [items],
  )
  const totalValue = rows.reduce((s, r) => s + (r.value ?? 0), 0)
  const withheld = rows.filter((r) => r.value == null).length
  const anyStock = rows.some((r) => r.total > 0 || r.openMl > 0)

  const titleId = useId()
  // Escape goes through the same `close` as the X, so it is refused mid-run too.
  const dialogRef = useModalDialog(isOpen, () => close())

  if (!isOpen) return null

  const close = () => {
    if (phase === 'working') return
    setPhase('confirm')
    setFailures([])
    onClose()
  }

  const run = async () => {
    setPhase('working')
    const failed: { name: string; message: string }[] = []

    for (const { item, live } of rows) {
      const inventoryId = item.inventoryId
      if (!inventoryId) continue
      try {
        // Step 1: take the shelf's bottles off, on the ledger, with the chosen
        // reason. The server refuses more than it holds, so a bottle sold since
        // the page loaded stops the removal here, before anything is deleted.
        if (live > 0) {
          const moved = (await adjustStock(inventoryId, {
            wineId: item.id || undefined,
            quantityChange: -live,
            reason: `Removed from inventory — ${reason}`,
            transactionType: REMOVE_MOVEMENT[reason] ?? 'adjustment',
            idempotencyKey: `remove:${inventoryId}:${newClientCountId()}`,
          })) as { quantityAfter?: number } | null
          // Bottles booked in since the page loaded are still on the books.
          const left = moved?.quantityAfter ?? 0
          if (left > 0) {
            throw new Error(
              `${left} more bottle${left === 1 ? ' was' : 's were'} booked in since this page loaded and ${left === 1 ? 'is' : 'are'} still on the books, so the wine was not removed. Open it again to take ${left === 1 ? 'it' : 'them'} off too.`,
            )
          }
        }
        // Step 2: soft-delete the inventory row (keeps the wine in the Wine Library).
        await deleteInventoryItem(inventoryId)
      } catch (err: any) {
        failed.push({
          name: item.name,
          message: err?.response?.data?.message || err?.message || 'Unknown error',
        })
      }
    }

    queryClient.invalidateQueries({ queryKey: ['inventory'] })

    if (failed.length === 0) {
      toast.success(
        rows.length === 1
          ? `${rows[0].item.name} removed from inventory`
          : `${rows.length} wines removed from inventory`,
      )
      setPhase('confirm')
      onRemoved()
      onClose()
    } else {
      setFailures(failed)
      setPhase('error')
    }
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
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden focus:outline-none"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-rose-50">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-rose-600 rounded-xl">
                <Trash2 className="w-4.5 h-4.5 text-white" />
              </div>
              <div>
                <h2 id={titleId} className="text-base font-bold text-gray-900">
                  Remove {rows.length === 1 ? rows[0].item.name : `${rows.length} wines`} from inventory
                </h2>
                <p className="text-xs text-gray-500">Keeps the wine in your Wine Library — re-add anytime</p>
              </div>
            </div>
            <button onClick={close} aria-label="Close" className="p-2 hover:bg-white/60 rounded-lg transition-colors" disabled={phase === 'working'}>
              <X className="w-4.5 h-4.5 text-gray-500" aria-hidden />
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
                    {openMl > 0 ? ` · ${formatVolume(openMl, measurementUnit)} open` : ''}
                    {value == null ? (
                      <span className="ml-2 text-gray-400">no cost recorded</span>
                    ) : (
                      value > 0 && <b className="ml-2 text-gray-700">{fmtMoney(value)}</b>
                    )}
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
                  {withheld > 0 ? (
                    <>
                      {withheld === 1 ? '1 wine has' : `${withheld} wines have`} no recorded cost, so{' '}
                      {withheld === 1 ? 'its' : 'their'} value is{' '}
                      {totalValue > 0 ? 'left out of that figure. ' : 'not shown. '}
                    </>
                  ) : null}
                  The bottles still on the books are taken off on the ledger with the reason below before removal —
                  nothing is deleted silently, and none of it shows as missing at the month close.
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
