/**
 * ReceiptDepth — the founder's named gap for /inventory (MAKEOVER-VERDICTS:
 * KEEP the dropdowns; "the dropdown needs more detail for the receipt and
 * invoice actions — differentiated work, not a generic expander").
 *
 * A flag-gated card (mudavym_design_inventory) inside the kept RowExpansion:
 * for this wine's recent orders, the paperwork that actually arrived —
 * invoices, delivery receipts, packing slips — with each document's status,
 * total, and whether it ties out. Styled native to the kept page (the grey
 * card idiom), deliberately NOT the .mudavym tokens: the founder kept this
 * page as it is; the İznik re-skin arrives with the page redesigns, not here.
 *
 * Honesty (decision E49 carried): absence is never agreement — a null
 * tie-out is an em dash, not a pass; a missing doc number is a dash; a
 * fetch failure is said in words.
 */
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { documentsApi, dashNull, type ProcurementDocument } from '../../../services/api/documents'
import { cn } from '../../../lib/utils'

const TYPE_LABELS: Record<ProcurementDocument['doc_type'], string> = {
  invoice: 'Invoice',
  packing_slip: 'Packing slip',
  delivery_receipt: 'Delivery receipt',
  credit_memo: 'Credit memo',
  purchase_order: 'Purchase order',
  statement: 'Statement',
  unknown: 'Document',
}

function money(v: number | null): string {
  return v == null ? '—' : `$${v.toFixed(2)}`
}

function TieOut({ doc }: { doc: ProcurementDocument }) {
  if (doc.ties_out === null) return <span className="font-mono text-gray-400">—</span>
  if (doc.ties_out) return <span className="font-mono font-semibold text-emerald-600">ties out</span>
  return (
    <span className="font-mono font-semibold text-amber-600">
      off by {doc.tie_out_delta == null ? '—' : `$${Math.abs(doc.tie_out_delta).toFixed(2)}`}
    </span>
  )
}

export function ReceiptDepth({
  orders,
}: {
  orders: Array<{ id: string; orderNumber?: string | null }>
}) {
  const navigate = useNavigate()
  const orderIds = orders.slice(0, 4).map((o) => o.id)

  const docsQ = useQuery({
    queryKey: ['inventory', 'receipt-depth', orderIds],
    queryFn: async () => {
      const perOrder = await Promise.all(orderIds.map((id) => documentsApi.forOrder(id)))
      const numberOf = new Map(orders.map((o) => [o.id, o.orderNumber ?? null]))
      // One invoice routinely links to several orders (the gateway calls this
      // routine, not an edge case) — de-dup by document id or it renders once
      // per linked order (inventory-audit.md, BLOCKER).
      const unique = Array.from(new Map(perOrder.flat().map((d) => [d.id, d])).values())
      const when = (d: ProcurementDocument) => Date.parse(d.doc_date ?? d.created_at) || 0
      return unique
        .filter((d) => d.status !== 'superseded')
        .sort((a, b) => when(b) - when(a))
        .map((d) => ({ doc: d, orderNumber: d.order_id ? (numberOf.get(d.order_id) ?? null) : null }))
    },
    enabled: orderIds.length > 0,
    staleTime: 60_000,
  })

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4">
      <h5 className="flex items-center justify-between text-[10.5px] font-bold uppercase tracking-wider text-gray-400 mb-3">
        Receipts &amp; invoices
        <button
          onClick={() => navigate('/receipts')}
          className="text-[10px] font-bold text-blue-600 hover:text-blue-700 normal-case tracking-normal"
        >
          Open receipts →
        </button>
      </h5>

      {orderIds.length === 0 ? (
        <p className="text-[11px] text-gray-400">No orders for this wine yet, so no paperwork to show.</p>
      ) : docsQ.isError ? (
        <p className="text-[11px] text-gray-500">
          The paperwork could not be read just now — nothing below is claimed.{' '}
          <button onClick={() => void docsQ.refetch()} className="text-blue-600 font-semibold">
            Try again
          </button>
        </p>
      ) : docsQ.data === undefined ? (
        <p className="text-[11px] text-gray-400">Reading the paperwork…</p>
      ) : docsQ.data.length === 0 ? (
        <p className="text-[11px] text-gray-400">
          No invoice or receipt is attached to this wine's recent orders yet.
        </p>
      ) : (
        <div>
          {docsQ.data.map(({ doc, orderNumber }) => (
            <div
              key={doc.id}
              className="flex flex-wrap items-center gap-2.5 py-1.5 border-t border-gray-50 first:border-t-0 text-xs"
            >
              <span className="font-semibold text-gray-700 w-24 truncate">
                {TYPE_LABELS[doc.doc_type]}
              </span>
              <span className="font-mono text-[11px] text-gray-500 w-20 truncate">
                {dashNull(doc.doc_number)}
              </span>
              <span className="text-gray-500">
                {doc.doc_date
                  ? new Date(doc.doc_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                  : '—'}
              </span>
              {orderNumber && <span className="font-mono text-[10px] text-gray-400">{orderNumber}</span>}
              <span className="ml-auto font-mono font-semibold text-gray-700">{money(doc.total)}</span>
              <TieOut doc={doc} />
              <span
                className={cn(
                  'text-[9px] font-bold rounded px-1.5 py-0.5 uppercase',
                  doc.status === 'verified'
                    ? 'bg-emerald-50 text-emerald-600'
                    : doc.status === 'needs_review'
                      ? 'bg-amber-50 text-amber-600'
                      : 'bg-gray-100 text-gray-500',
                )}
              >
                {doc.status.replace('_', ' ')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
