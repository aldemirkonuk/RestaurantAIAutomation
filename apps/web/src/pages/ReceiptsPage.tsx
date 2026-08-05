/**
 * Receipts page (decisions E48/E49) — vendor documents with two primary lanes:
 * needs_review and verified. Selecting a document shows the stored image
 * beside the extracted lines for side-by-side verification. Tri-state nulls
 * (match checks that could not be evaluated because a document is absent)
 * render as an em dash, never as a pass.
 *
 * Credits live as a second tab on the same page so the chase list is one
 * click away from the documents that prove the claims.
 */
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, FileText, Loader2, RefreshCw } from 'lucide-react'
import { Header } from '../components/layout/Header'
import {
  documentsApi,
  dashNull,
  type ProcurementDocument,
  type ProcurementDocumentLine,
} from '../services/api/documents'
import {
  creditsApi,
  type CreditState,
  type ProcurementCredit,
} from '../services/api/credits'
import { cn } from '../lib/utils'
import { useNotificationStore } from '../stores'

type Lane = 'needs_review' | 'verified'
type Tab = 'receipts' | 'credits'

const CREDIT_TRANSITIONS: Record<CreditState, CreditState[]> = {
  open: ['requested', 'rejected', 'written_off'],
  requested: ['promised', 'credited', 'rejected', 'written_off'],
  promised: ['credited', 'rejected', 'written_off'],
  credited: [],
  rejected: [],
  written_off: [],
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—'
  return `$${Number(n).toFixed(2)}`
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function ReceiptsPage() {
  const toast = useNotificationStore()
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab: Tab = searchParams.get('tab') === 'credits' ? 'credits' : 'receipts'
  const setTab = (next: Tab) => {
    if (next === 'credits') setSearchParams({ tab: 'credits' })
    else setSearchParams({})
  }
  const [lane, setLane] = useState<Lane>('needs_review')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)

  const listQuery = useQuery({
    queryKey: ['procurement-documents', lane],
    queryFn: () => documentsApi.list({ status: lane, limit: 100 }),
    enabled: tab === 'receipts',
  })

  const detailQuery = useQuery({
    queryKey: ['procurement-document', selectedId],
    queryFn: () => documentsApi.detail(selectedId!),
    enabled: !!selectedId && tab === 'receipts',
  })

  const creditsQuery = useQuery({
    queryKey: ['procurement-credits'],
    queryFn: () => creditsApi.list(),
    enabled: tab === 'credits',
  })

  const statsQuery = useQuery({
    queryKey: ['procurement-credits-stats'],
    queryFn: () => creditsApi.stats(),
    enabled: tab === 'credits',
  })

  // Reset selection when the lane changes so we don't keep a verified doc
  // selected while browsing the needs_review list.
  useEffect(() => {
    setSelectedId(null)
  }, [lane])

  const handleVerify = useCallback(async () => {
    if (!selectedId) return
    setVerifying(true)
    try {
      await documentsApi.verify(selectedId)
      toast.success('Document verified', 'Extraction confirmed against the paper.')
      await qc.invalidateQueries({ queryKey: ['procurement-documents'] })
      setSelectedId(null)
      setLane('verified')
    } catch (e: any) {
      toast.error('Verify failed', e?.response?.data?.message || e?.message)
    } finally {
      setVerifying(false)
    }
  }, [selectedId, qc, toast])

  const handleCreditTransition = useCallback(
    async (credit: ProcurementCredit, to: CreditState) => {
      try {
        let creditedAmount: number | undefined
        let creditDocumentId: string | undefined
        if (to === 'credited') {
          const amountStr = window.prompt(
            'Amount the vendor allowed (required):',
            String(credit.claimed_amount),
          )
          if (amountStr == null) return
          creditedAmount = Number(amountStr)
          if (!Number.isFinite(creditedAmount) || creditedAmount < 0) {
            toast.error('Invalid amount', 'Enter a non-negative number.')
            return
          }
          const docId = window.prompt(
            'Credit-memo document id (required — a promise without a memo is not recovery):',
          )
          if (!docId) {
            toast.error('Credit memo required', 'Cannot settle without the document.')
            return
          }
          creditDocumentId = docId.trim()
        }
        await creditsApi.transition(credit.id, { to, creditedAmount, creditDocumentId })
        toast.success(`Claim → ${to}`, credit.reason || credit.id)
        await Promise.all([
          qc.invalidateQueries({ queryKey: ['procurement-credits'] }),
          qc.invalidateQueries({ queryKey: ['procurement-credits-stats'] }),
        ])
      } catch (e: any) {
        toast.error('Transition refused', e?.response?.data?.message || e?.message)
      }
    },
    [qc, toast],
  )

  const docs = listQuery.data ?? []
  const selected = detailQuery.data

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="Receipts & credits" subtitle="Vendor documents and the money they owe back" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div className="flex gap-1 bg-white border border-gray-200 rounded-xl p-1 w-fit">
          {([
            ['receipts', 'Receipts'],
            ['credits', 'Credits'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'px-4 h-9 rounded-lg text-xs font-bold transition-colors',
                tab === key ? 'bg-wine-600 text-white' : 'text-gray-600 hover:bg-gray-50',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'receipts' ? (
          <>
            <div className="flex gap-2">
              {([
                ['needs_review', 'Needs review'],
                ['verified', 'Verified'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setLane(key)}
                  className={cn(
                    'px-3.5 h-9 rounded-lg text-xs font-bold border transition-colors',
                    lane === key
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50',
                  )}
                >
                  {label}
                </button>
              ))}
              <button
                onClick={() => void listQuery.refetch()}
                className="ml-auto h-9 w-9 flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50"
                title="Refresh"
              >
                <RefreshCw className={cn('w-3.5 h-3.5', listQuery.isFetching && 'animate-spin')} />
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 min-h-[60vh]">
              <div className="lg:col-span-2 bg-white border border-gray-200 rounded-2xl overflow-hidden">
                {listQuery.isLoading ? (
                  <div className="flex items-center justify-center h-40 text-gray-400">
                    <Loader2 className="w-5 h-5 animate-spin" />
                  </div>
                ) : docs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-40 text-gray-400 gap-2">
                    <FileText className="w-6 h-6" />
                    <p className="text-xs">No {lane.replace('_', ' ')} documents</p>
                  </div>
                ) : (
                  <ul className="divide-y divide-gray-100 max-h-[70vh] overflow-y-auto">
                    {docs.map((d) => (
                      <DocRow
                        key={d.id}
                        doc={d}
                        active={d.id === selectedId}
                        onClick={() => setSelectedId(d.id)}
                      />
                    ))}
                  </ul>
                )}
              </div>

              <div className="lg:col-span-3 bg-white border border-gray-200 rounded-2xl overflow-hidden">
                {!selectedId ? (
                  <div className="flex items-center justify-center h-full min-h-[40vh] text-gray-400 text-xs">
                    Select a document to review
                  </div>
                ) : detailQuery.isLoading ? (
                  <div className="flex items-center justify-center h-40 text-gray-400">
                    <Loader2 className="w-5 h-5 animate-spin" />
                  </div>
                ) : selected ? (
                  <DocDetail
                    document={selected.document}
                    lines={selected.lines}
                    verifying={verifying}
                    onVerify={lane === 'needs_review' ? handleVerify : undefined}
                  />
                ) : null}
              </div>
            </div>
          </>
        ) : (
          <CreditsPane
            credits={creditsQuery.data ?? []}
            stats={statsQuery.data}
            loading={creditsQuery.isLoading}
            onTransition={handleCreditTransition}
          />
        )}
      </div>
    </div>
  )
}

function DocRow({
  doc,
  active,
  onClick,
}: {
  doc: ProcurementDocument
  active: boolean
  onClick: () => void
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className={cn(
          'w-full text-left px-4 py-3.5 hover:bg-gray-50 transition-colors',
          active && 'bg-wine-50 hover:bg-wine-50',
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-gray-900 truncate">
            {doc.doc_type.replace('_', ' ')}
            {doc.doc_number ? ` · #${doc.doc_number}` : ''}
          </span>
          <span className="text-[11px] text-gray-400 shrink-0">{fmtDate(doc.doc_date || doc.created_at)}</span>
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-[11px] text-gray-500 capitalize">{doc.source_channel}</span>
          <span className="text-xs font-semibold text-gray-700">{fmtMoney(doc.total)}</span>
        </div>
      </button>
    </li>
  )
}

function DocDetail({
  document,
  lines,
  verifying,
  onVerify,
}: {
  document: ProcurementDocument
  lines: ProcurementDocumentLine[]
  verifying: boolean
  onVerify?: () => void
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div>
          <h3 className="text-sm font-bold text-gray-900 capitalize">
            {document.doc_type.replace('_', ' ')}
            {document.doc_number ? ` #${document.doc_number}` : ''}
          </h3>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {fmtDate(document.doc_date)} · {dashNull(document.filename)} · total {fmtMoney(document.total)}
          </p>
        </div>
        {onVerify && (
          <button
            onClick={onVerify}
            disabled={verifying}
            className="flex items-center gap-1.5 h-9 px-3.5 bg-wine-600 hover:bg-wine-700 text-white text-xs font-bold rounded-lg disabled:opacity-50"
          >
            {verifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Verify extraction
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-0 flex-1 min-h-0">
        <div className="border-r border-gray-100 bg-gray-50 flex items-center justify-center p-4 min-h-[280px]">
          {document.imageUrl ? (
            <img
              src={document.imageUrl}
              alt="Stored document"
              className="max-h-[60vh] max-w-full object-contain rounded-lg shadow-sm"
            />
          ) : (
            <div className="text-center text-gray-400 space-y-1.5">
              <FileText className="w-8 h-8 mx-auto" />
              <p className="text-xs">No stored image</p>
              <p className="text-[10px]">EDI and text-only channels keep content in the payload</p>
            </div>
          )}
        </div>

        <div className="overflow-y-auto max-h-[60vh]">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-white border-b border-gray-100">
              <tr className="text-[10px] uppercase tracking-wide text-gray-400">
                <th className="px-3 py-2 font-semibold">#</th>
                <th className="px-3 py-2 font-semibold">Description</th>
                <th className="px-3 py-2 font-semibold">SKU</th>
                <th className="px-3 py-2 font-semibold text-right">Qty</th>
                <th className="px-3 py-2 font-semibold text-right">Price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-xs text-gray-400">
                    No lines extracted
                  </td>
                </tr>
              ) : (
                lines.map((l) => (
                  <tr key={l.id} className="text-xs text-gray-700">
                    <td className="px-3 py-2 text-gray-400">{l.line_no}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-900">{dashNull(l.description)}</div>
                      {l.vintage != null && (
                        <div className="text-[10px] text-gray-400">{l.vintage}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px]">{dashNull(l.vendor_sku)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{dashNull(l.qty_bottles)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(l.unit_price)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function CreditsPane({
  credits,
  stats,
  loading,
  onTransition,
}: {
  credits: ProcurementCredit[]
  stats: Awaited<ReturnType<typeof creditsApi.stats>> | undefined
  loading: boolean
  onTransition: (c: ProcurementCredit, to: CreditState) => void
}) {
  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Recovered', value: fmtMoney(stats.recovered), hint: 'Settled by credit memo' },
            { label: 'Outstanding', value: fmtMoney(stats.outstanding), hint: 'Open + requested' },
            { label: 'Promised', value: fmtMoney(stats.promised), hint: 'Not yet recovered' },
            { label: 'Self-evidenced open', value: String(stats.selfEvidencedOpen), hint: 'Worth a phone call' },
          ].map((k) => (
            <div key={k.label} className="bg-white border border-gray-200 rounded-xl px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">{k.label}</p>
              <p className="text-lg font-bold text-gray-900 mt-0.5 tabular-nums">{k.value}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">{k.hint}</p>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : credits.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-gray-400 gap-2">
            <p className="text-xs">No credit claims</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {credits.map((c) => {
              const next = CREDIT_TRANSITIONS[c.state] ?? []
              return (
                <li key={c.id} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-gray-900 capitalize">{c.state}</span>
                      {c.self_evidenced && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">
                          Self-evidenced
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">{c.reason || '—'}</p>
                    <p className="text-[11px] text-gray-400 mt-1">
                      Opened {fmtDate(c.opened_at)} · claimed {fmtMoney(c.claimed_amount)}
                      {c.credited_amount != null ? ` · credited ${fmtMoney(c.credited_amount)}` : ''}
                    </p>
                  </div>
                  {next.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {next.map((to) => (
                        <button
                          key={to}
                          onClick={() => onTransition(c, to)}
                          className={cn(
                            'h-8 px-2.5 rounded-lg text-[11px] font-bold border',
                            to === 'credited'
                              ? 'bg-wine-600 text-white border-wine-600'
                              : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50',
                          )}
                        >
                          → {to}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

export default ReceiptsPage
