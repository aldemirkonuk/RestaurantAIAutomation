/**
 * Receiving workspace — the canonical WineOps invoice.
 *
 * Vendors send wildly different paperwork; we never make the manager read theirs. This renders
 * OUR normalized three-way match instead, always the same shape:
 *
 *   ORDERED (what we agreed to buy)  vs  INVOICED (what they billed)  vs  RECEIVED (what came)
 *
 * The vendor's own document stays attached as evidence, never as the working surface.
 * Delivery already stocked bottles in at invoice quantity; this is the audit layer. The server
 * recomputes the verdict and derives the ledger correction — what we send is evidence, not a
 * decision. Rules mirrored from lib/invoiceMatch.ts (the backend is authoritative).
 */
import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Check, AlertTriangle, Plus, Receipt } from 'lucide-react'
import { verifyOrderReceipt } from '../../../services/api/orders'
import { useNotificationStore } from '../../../stores'
import { ThemedSelect } from '../../../components/ui/ThemedSelect'
import { computeMatch, verdictStyle, money } from '../../../lib/invoiceMatch'
import { cn } from '../../../lib/utils'
import type { InventoryItem } from '../useInventoryPage'

interface Props {
  order: any
  items: InventoryItem[]
  onClose: () => void
  /** Completed orders reopen here as a read-only audit record (D9). */
  readOnly?: boolean
}

interface ExtraLine {
  inventoryId: string
  label: string
  countedQty: number
}

/** Small stepper used for every count on this screen. */
function Stepper({
  value,
  onChange,
  disabled,
  tone = 'default',
}: {
  value: number
  onChange: (n: number) => void
  disabled?: boolean
  tone?: 'default' | 'warn'
}) {
  return (
    <div
      className={cn(
        'inline-flex items-center border rounded-lg overflow-hidden bg-white',
        tone === 'warn' && value > 0 ? 'border-amber-300' : 'border-gray-200',
        disabled && 'opacity-60',
      )}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(Math.max(0, value - 1))}
        className="w-7 h-7 text-gray-500 hover:bg-gray-50 disabled:hover:bg-white"
      >
        -
      </button>
      <span className="w-9 text-center font-mono text-sm font-bold text-gray-800 leading-7 border-x border-gray-100">
        {value}
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(value + 1)}
        className="w-7 h-7 text-gray-500 hover:bg-gray-50 disabled:hover:bg-white"
      >
        +
      </button>
    </div>
  )
}

export function ReceivingWorkspace({ order, items, onClose, readOnly = false }: Props) {
  const queryClient = useQueryClient()
  const toast = useNotificationStore()

  const orderedQty: number = order.quantity ?? 0
  const poUnitPrice: number | null =
    order.finalPrice ?? order.negotiatedPrice ?? order.quotedPrice ?? order.unitPrice ?? null
  const stockedQty: number = order.quantityReceived ?? order.quantity ?? 0

  // The invoice is expected to agree with the PO — we render our own format — so it starts
  // pre-filled from the order. Editing these is how a vendor deviation gets recorded.
  const [invoiceQty, setInvoiceQty] = useState<number>(stockedQty)
  const [invoiceUnitPrice, setInvoiceUnitPrice] = useState<number | null>(poUnitPrice)
  const [acceptedQty, setAcceptedQty] = useState<number>(stockedQty)
  const [rejectedQty, setRejectedQty] = useState<number>(0)
  const [rejectedReason, setRejectedReason] = useState('')
  const [priceOverrideReason, setPriceOverrideReason] = useState('')
  const [note, setNote] = useState('')

  const [extras, setExtras] = useState<ExtraLine[]>([])
  const [addingId, setAddingId] = useState('')

  const match = useMemo(
    () =>
      computeMatch({
        orderedQty,
        poUnitPrice,
        invoiceQty,
        invoiceUnitPrice,
        acceptedQty,
        rejectedQty,
        priceOverrideReason,
      }),
    [
      orderedQty,
      poUnitPrice,
      invoiceQty,
      invoiceUnitPrice,
      acceptedQty,
      rejectedQty,
      priceOverrideReason,
    ],
  )

  const style = verdictStyle(match.verdict)
  const priceDiffers =
    poUnitPrice != null &&
    invoiceUnitPrice != null &&
    Math.round(poUnitPrice * 100) !== Math.round(invoiceUnitPrice * 100)
  const receivedQty = acceptedQty + rejectedQty

  const addable = useMemo(
    () => items.filter((i) => i.inventoryId && !extras.some((l) => l.inventoryId === i.inventoryId)),
    [items, extras],
  )

  const addExtra = () => {
    const item = addable.find((i) => i.inventoryId === addingId)
    if (!item) return
    setExtras((ls) => [...ls, { inventoryId: item.inventoryId!, label: item.name, countedQty: 1 }])
    setAddingId('')
  }

  const verify = useMutation({
    mutationFn: () =>
      verifyOrderReceipt(order.id, {
        invoiceQuantity: invoiceQty,
        invoiceUnitPrice: invoiceUnitPrice ?? undefined,
        acceptedQuantity: acceptedQty,
        rejectedQuantity: rejectedQty,
        rejectedReason: rejectedQty > 0 ? rejectedReason || 'damaged on arrival' : undefined,
        priceOverrideReason: priceDiffers ? priceOverrideReason : undefined,
        adjustments: extras.map((l) => ({
          inventoryId: l.inventoryId,
          delta: l.countedQty,
          reason: 'unlisted item received',
        })),
        note: note || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      const heldOpen = match.backorderQty > 0
      toast.success(
        heldOpen ? 'Received, order held open' : 'Receipt verified',
        heldOpen
          ? `${acceptedQty} of ${orderedQty} accepted — ${match.backorderQty} still on backorder.`
          : match.summary,
      )
      onClose()
    },
    onError: (e: any) =>
      toast.error('Verification failed', e?.response?.data?.message || e?.message),
  })

  const blocked = match.requiresOverride
  const primaryLabel = blocked
    ? 'Reason required'
    : match.backorderQty > 0
      ? 'Accept & keep open'
      : priceDiffers
        ? 'Accept with override'
        : 'Accept & complete'

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-wine-50 flex items-center justify-center shrink-0">
              <Receipt className="w-4 h-4 text-wine-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">
                {readOnly ? 'Receipt record' : 'Match invoice'}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {order.orderNumber || order.id?.slice(0, 8)}
                {order.providerName ? ` · ${order.providerName}` : ''} ·{' '}
                {readOnly ? 'verified' : 'confirm what arrived against what we agreed'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="px-6 py-4 max-h-[62vh] overflow-y-auto">
          {/* three-way header */}
          <div className="grid grid-cols-[1fr_86px_86px_86px_86px_74px] gap-2 items-end pb-2 text-[10.5px] font-bold uppercase tracking-wider text-gray-400">
            <div className="truncate">{order.wineName || 'Ordered wine'}</div>
            <div className="text-center">Ordered</div>
            <div className="text-center">Invoiced</div>
            <div className="text-center">Accepted</div>
            <div className="text-center">Rejected</div>
            <div className="text-right">Backorder</div>
          </div>

          {/* quantities */}
          <div className="grid grid-cols-[1fr_86px_86px_86px_86px_74px] gap-2 items-center py-3 border-t border-gray-100">
            <div className="text-xs text-gray-500">Bottles</div>
            <div className="text-center font-mono text-sm text-gray-500">{orderedQty}</div>
            <div className="flex justify-center">
              <input
                type="number"
                min={0}
                disabled={readOnly}
                value={invoiceQty}
                onChange={(e) => setInvoiceQty(Math.max(0, Number(e.target.value) || 0))}
                className="w-[70px] h-8 text-center font-mono text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-wine-500 focus:border-transparent disabled:bg-gray-50"
              />
            </div>
            <div className="flex justify-center">
              <Stepper value={acceptedQty} onChange={setAcceptedQty} disabled={readOnly} />
            </div>
            <div className="flex justify-center">
              <Stepper value={rejectedQty} onChange={setRejectedQty} disabled={readOnly} tone="warn" />
            </div>
            <div
              className={cn(
                'text-right font-mono text-sm font-bold',
                match.backorderQty === 0 ? 'text-emerald-600' : 'text-amber-600',
              )}
            >
              {match.backorderQty === 0 ? <Check className="w-4 h-4 inline" /> : match.backorderQty}
            </div>
          </div>

          {/* prices — exact match, no tolerance band */}
          <div className="grid grid-cols-[1fr_86px_86px_246px] gap-2 items-center py-3 border-t border-gray-50">
            <div className="text-xs text-gray-500">Unit price</div>
            <div className="text-center font-mono text-sm text-gray-500">
              {poUnitPrice != null ? money(poUnitPrice) : '—'}
            </div>
            <div className="flex justify-center">
              <input
                type="number"
                min={0}
                step="0.01"
                disabled={readOnly}
                value={invoiceUnitPrice ?? ''}
                onChange={(e) =>
                  setInvoiceUnitPrice(
                    e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0),
                  )
                }
                className={cn(
                  'w-[70px] h-8 text-center font-mono text-sm border rounded-lg outline-none focus:ring-2 focus:ring-wine-500 focus:border-transparent disabled:bg-gray-50',
                  priceDiffers ? 'border-rose-300 bg-rose-50/40' : 'border-gray-200',
                )}
              />
            </div>
            <div className="text-right">
              {poUnitPrice == null ? (
                <span className="text-[11px] text-gray-400">No agreed price on this order</span>
              ) : priceDiffers ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600">
                  <AlertTriangle className="w-3 h-3" />
                  {money(Math.abs((invoiceUnitPrice ?? 0) - poUnitPrice))}/btl{' '}
                  {(invoiceUnitPrice ?? 0) > poUnitPrice ? 'over' : 'under'} agreed
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
                  <Check className="w-3 h-3" /> Matches agreed price
                </span>
              )}
            </div>
          </div>

          {/* price override — the only way past an exact-match failure */}
          {priceDiffers && !readOnly && (
            <div className="mt-1 mb-2 p-3 rounded-lg bg-rose-50/60 ring-1 ring-rose-100">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-rose-700 mb-1.5">
                Why accept this price?
              </label>
              <input
                value={priceOverrideReason}
                onChange={(e) => setPriceOverrideReason(e.target.value)}
                placeholder="e.g. freight surcharge agreed with the rep by phone"
                className="w-full px-3 py-2 border border-rose-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-rose-400 focus:border-transparent"
              />
              <p className="text-[10.5px] text-rose-600/80 mt-1.5">
                Recorded against the order. The price stays marked unverified either way.
              </p>
            </div>
          )}

          {/* rejected reason */}
          {rejectedQty > 0 && !readOnly && (
            <div className="mt-1 mb-2 p-3 rounded-lg bg-amber-50/60 ring-1 ring-amber-100">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-amber-700 mb-1.5">
                Why were {rejectedQty} rejected?
              </label>
              <input
                value={rejectedReason}
                onChange={(e) => setRejectedReason(e.target.value)}
                placeholder="e.g. 2 bottles broken in transit"
                className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
              />
              <p className="text-[10.5px] text-amber-700/80 mt-1.5">
                They arrived but never entered stock — tracked as a credit, not a short ship.
              </p>
            </div>
          )}

          {/* unlisted extras */}
          {extras.map((l, idx) => (
            <div
              key={l.inventoryId}
              className="grid grid-cols-[1fr_86px_86px_86px_86px_74px] gap-2 items-center py-2.5 border-t border-gray-50 bg-amber-50/40 -mx-2 px-2 rounded-lg"
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900 truncate">{l.label}</div>
                <div className="text-[10px] text-amber-600 font-semibold">not on the invoice</div>
              </div>
              <div className="text-center font-mono text-sm text-gray-300">—</div>
              <div className="text-center font-mono text-sm text-gray-300">—</div>
              <div className="flex justify-center">
                <Stepper
                  value={l.countedQty}
                  disabled={readOnly}
                  onChange={(n) =>
                    setExtras((ls) => ls.map((x, i) => (i === idx ? { ...x, countedQty: n } : x)))
                  }
                />
              </div>
              <div className="text-center font-mono text-sm text-gray-300">—</div>
              <div className="text-right">
                {!readOnly && (
                  <button
                    onClick={() => setExtras((ls) => ls.filter((_, i) => i !== idx))}
                    className="text-[11px] font-semibold text-gray-400 hover:text-rose-600"
                  >
                    remove
                  </button>
                )}
              </div>
            </div>
          ))}

          {!readOnly && (
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
              <ThemedSelect
                value={addingId}
                options={[
                  { value: '', label: 'Add unlisted item' },
                  ...addable.slice(0, 200).map((i) => ({ value: i.inventoryId!, label: i.name })),
                ]}
                onChange={setAddingId}
                align="left"
                className="flex-1"
              />
              <button
                onClick={addExtra}
                disabled={!addingId}
                className="h-9 px-3 inline-flex items-center gap-1.5 border border-gray-200 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>
          )}

          {/* verdict */}
          <div className={cn('mt-4 p-3 rounded-xl ring-1', style.bg, style.ring)}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className={cn('text-xs font-bold', style.text)}>{style.label}</div>
                <p className="text-[11.5px] text-gray-600 mt-0.5">{match.summary}</p>
              </div>
              <div className="text-right shrink-0">
                {match.effectiveUnitCost != null && (
                  <div className="text-[10.5px] text-gray-500">
                    Real cost{' '}
                    <span className="font-mono font-bold text-gray-700">
                      {money(match.effectiveUnitCost)}
                    </span>
                    /btl
                  </div>
                )}
                {match.creditDue && (
                  <div className="text-[10.5px] font-semibold text-amber-700 mt-0.5">Credit due</div>
                )}
              </div>
            </div>
            {receivedQty !== invoiceQty && (
              <p className="text-[10.5px] text-gray-500 mt-2 pt-2 border-t border-black/5">
                {receivedQty} physically arrived ({acceptedQty} accepted + {rejectedQty} rejected)
                against {invoiceQty} billed.
              </p>
            )}
          </div>

          {!readOnly && (
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note (substitute vintage, driver waited, pallet damaged...)"
              className="w-full mt-3 px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-wine-500 focus:border-transparent"
            />
          )}
        </div>

        {/* footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 bg-gray-50 border-t border-gray-100">
          {readOnly ? (
            <span className="text-xs text-gray-400">Read-only audit record</span>
          ) : match.backorderQty > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-600">
              <AlertTriangle className="w-3.5 h-3.5" />
              {match.backorderQty} bottle{match.backorderQty === 1 ? ' stays' : 's stay'} on backorder
            </span>
          ) : (
            <span className="text-xs text-gray-400">Order will close</span>
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="h-9 px-4 border border-gray-200 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-100"
            >
              {readOnly ? 'Close' : 'Later'}
            </button>
            {!readOnly && (
              <button
                onClick={() => verify.mutate()}
                disabled={verify.isPending || blocked}
                title={blocked ? 'Give a reason for the price difference first' : undefined}
                className="h-9 px-5 bg-wine-600 hover:bg-wine-700 text-white text-xs font-bold rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {verify.isPending ? 'Verifying...' : primaryLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
