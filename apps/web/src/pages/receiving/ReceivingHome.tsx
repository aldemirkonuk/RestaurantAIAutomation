import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  Camera,
  ChevronRight,
  Clock,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react'
import { apiClient } from '../../services/api/client'
import type { UnverifiedDelivery } from '../../services/api/receiving'
import { useAuth } from '../../contexts/AuthContext'
import { cn } from '../../lib/utils'

/**
 * Receiving — one event, three renderings, chosen by role.
 *
 * This is the defensible version of "the interface adapts to you". It is not an agent reshaping
 * the page from behavioural telemetry: it is the same underlying data rendered three ways, chosen
 * by a fact we already know. Deterministic, so the same role always sees the same layout — which
 * matters in a business with high turnover where training is oral ("hit the green button"), and
 * where an interface that moves is an interface nobody can be taught.
 *
 *   STAFF    which delivery are you receiving? -> the door flow. NO PRICES.
 *   MANAGER  what needs a decision, worst money first.
 *   OWNER    one number, and it is only ever money that actually came back.
 *
 * The staff view hides cost deliberately. Line cost is not floor-staff information, it invites an
 * argument with a driver who has no authority to settle it, and it is the single biggest source of
 * hesitation at the door.
 */

interface QueueItem {
  orderId: string
  orderNumber: string | null
  verdict: string
  summary: string | null
  backorderQty: number
  verifiedAt: string | null
  dollarsAtRisk: number
  selfEvidenced: boolean
  openClaims: number
}

interface RecoveryStats {
  recovered: number
  outstanding: number
  promised: number
  rejected: number
  openClaims: number
  oldestOpenDays: number | null
  settlementRate: number | null
  selfEvidencedOpen: number
}

const money = (n: number) =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export default function ReceivingHome() {
  // useAuth, not useAuthStore — the store's user is not the one the rest of the shell reads,
  // and taking the role from the wrong source silently rendered the staff view to an owner.
  // Getting this wrong is not cosmetic here: the staff view deliberately hides all money.
  const { user } = useAuth()
  const role = (user?.role ?? '').toLowerCase()

  if (role === 'owner') return <OwnerView />
  if (role === 'manager' || role === 'admin') return <ManagerView />
  // Anything unrecognised falls to the staff view, which shows no cost data. If the role
  // cannot be established, showing less is the safe direction to fail.
  return <StaffView />
}

/* ---------------------------------------------------------------- staff --- */

/**
 * "Which one are you receiving?" and nothing else.
 *
 * Big rows because this is used one-handed at a door. No money, no verdicts, no history — a
 * porter does not need to know what a delivery is worth and cannot act on it if they do.
 */
function StaffView() {
  const navigate = useNavigate()
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['receiving-open-orders'],
    queryFn: async () => {
      const { data } = await apiClient.get('/procurement/orders', {
        params: { status: 'SENT', limit: 25 },
      })
      return (data?.items ?? data ?? []) as any[]
    },
  })

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <h1 className="text-xl font-bold text-gray-900">Receiving</h1>
      <p className="mt-1 text-sm text-gray-500">Tap the delivery that just arrived.</p>

      {isLoading && <p className="mt-8 text-sm text-gray-400">Loading…</p>}

      {!isLoading && orders.length === 0 && (
        <div className="mt-8 rounded-xl border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
          Nothing is out for delivery right now.
        </div>
      )}

      <div className="mt-6 space-y-3">
        {orders.map((o) => (
          <button
            key={o.id}
            type="button"
            data-ux-key="receiving:staff-order"
            onClick={() => navigate(`/receiving/${o.id}/door`)}
            className="w-full min-h-[72px] flex items-center justify-between gap-3 px-4 py-4 rounded-2xl border border-gray-200 bg-white active:bg-gray-50 text-left"
          >
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 truncate">
                {o.providerName || o.provider?.name || 'Delivery'}
              </p>
              <p className="text-xs text-gray-500 truncate">
                {o.orderNumber || o.id?.slice(0, 8)}
                {/* Quantity yes, value never. */}
                {o.quantity ? ` · ${o.quantity} bottles expected` : ''}
              </p>
            </div>
            <Camera className="w-5 h-5 text-wine-600 shrink-0" />
          </button>
        ))}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- manager --- */

function ManagerView() {
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: ['receiving-queue'],
    queryFn: async () => {
      const { data } = await apiClient.get('/procurement/receiving/queue')
      return data as { items: QueueItem[]; unverified: UnverifiedDelivery[]; totalAtRisk: number }
    },
  })

  const items = data?.items ?? []
  const unverified = data?.unverified ?? []

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-bold text-gray-900">Deliveries needing a decision</h1>
        {!!data?.totalAtRisk && (
          <span className="text-sm font-semibold text-rose-700">
            {money(data.totalAtRisk)} at risk
          </span>
        )}
      </div>

      {/* The safety net for stock booked on a case count. Shown before the queue because an
          uncounted delivery is the one that turns into unexplained shrinkage. */}
      {unverified.length > 0 && <UnverifiedStrip items={unverified} />}

      {isLoading && <p className="mt-8 text-sm text-gray-400">Loading…</p>}

      {!isLoading && items.length === 0 && (
        <div className="mt-6 rounded-xl border border-emerald-100 bg-emerald-50/60 p-6 text-sm text-emerald-800">
          Nothing to chase. Every verified delivery matched its paperwork.
        </div>
      )}

      <div className="mt-5 space-y-2">
        {items.map((i) => (
          <button
            key={i.orderId}
            type="button"
            data-ux-key="receiving:queue-row"
            onClick={() => navigate(`/orders?order=${i.orderId}`)}
            className="w-full flex items-center gap-4 px-4 py-3 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-left"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-900 text-sm">
                  {i.orderNumber || i.orderId.slice(0, 8)}
                </span>
                {i.selfEvidenced && (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded"
                    title="Their packing slip and their invoice disagree — provable from their own paperwork"
                  >
                    <ShieldCheck className="w-3 h-3" />
                    Provable
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-0.5 truncate">{i.summary || i.verdict}</p>
            </div>
            <div className="text-right shrink-0">
              <p
                className={cn(
                  'font-mono text-sm font-bold',
                  i.dollarsAtRisk > 0 ? 'text-rose-700' : 'text-gray-400',
                )}
              >
                {i.dollarsAtRisk > 0 ? money(i.dollarsAtRisk) : '—'}
              </p>
              {i.backorderQty > 0 && (
                <p className="text-[10px] text-amber-600">{i.backorderQty} on backorder</p>
              )}
            </div>
            <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
          </button>
        ))}
      </div>
    </div>
  )
}

function UnverifiedStrip({ items }: { items: UnverifiedDelivery[] }) {
  const overdue = items.filter((i) => i.severity === 'overdue').length
  return (
    <div
      className={cn(
        'mt-4 flex items-center gap-3 px-4 py-3 rounded-xl border text-sm',
        overdue
          ? 'bg-amber-50 border-amber-200 text-amber-900'
          : 'bg-gray-50 border-gray-200 text-gray-700',
      )}
    >
      <Clock className="w-4 h-4 shrink-0" />
      <span>
        <strong>{items.length}</strong> deliver{items.length === 1 ? 'y' : 'ies'} counted by case
        and not yet by bottle — oldest {items[0].ageHours}h.
        {overdue > 0 && (
          <span className="font-semibold">
            {' '}
            {/* This is the real risk of booking stock at the door: not the approximate hour,
                but the delivery nobody goes back to, where a short case quietly becomes
                shrinkage that can no longer be claimed. */}
            {overdue} past two days — a short case here can no longer be claimed from the vendor.
          </span>
        )}
      </span>
    </div>
  )
}

/* ---------------------------------------------------------------- owner --- */

/**
 * One card.
 *
 * `recovered` is money a distributor actually credited back, evidenced by a credit memo.
 * Everything asked for and not yet settled is shown separately and never added in — a
 * dollars-recovered figure a bookkeeper cannot tie to a vendor statement destroys trust the
 * first time they check, and they always check.
 */
function OwnerView() {
  const { data, isLoading } = useQuery({
    queryKey: ['recovery-stats'],
    queryFn: async () => {
      const { data } = await apiClient.get('/procurement/credits/stats')
      return data as RecoveryStats
    },
  })

  const settlement = useMemo(
    () => (data?.settlementRate == null ? null : Math.round(data.settlementRate * 100)),
    [data],
  )

  if (isLoading || !data)
    return <div className="max-w-2xl mx-auto px-4 py-10 text-sm text-gray-400">Loading…</div>

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="rounded-2xl border border-gray-200 bg-white p-6">
        <p className="text-xs font-bold uppercase tracking-wider text-gray-400">
          Recovered from distributors
        </p>
        <p className="mt-2 text-4xl font-bold text-emerald-700 tabular-nums">
          {money(data.recovered)}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Credit memos actually issued. Money asked for is not counted here.
        </p>

        <div className="mt-6 grid grid-cols-2 gap-4 pt-5 border-t border-gray-100">
          <Stat
            label="Still owed"
            value={money(data.outstanding)}
            hint={`${data.openClaims} open claim${data.openClaims === 1 ? '' : 's'}${
              data.oldestOpenDays != null ? `, oldest ${data.oldestOpenDays}d` : ''
            }`}
            tone={data.outstanding > 0 ? 'warn' : 'muted'}
          />
          <Stat
            label="They refused"
            value={money(data.rejected)}
            // The denominator. A recovery figure with nothing to divide it by flatters.
            hint={settlement == null ? 'Nothing settled yet' : `${settlement}% of claims settle`}
            tone="muted"
          />
        </div>

        {data.selfEvidencedOpen > 0 && (
          <div className="mt-5 flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-100 px-4 py-3 text-sm text-rose-800">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              <strong>{data.selfEvidencedOpen}</strong> open claim
              {data.selfEvidencedOpen === 1 ? ' is' : 's are'} provable from the distributor's own
              packing slip. Those are the ones worth a phone call.
            </span>
          </div>
        )}

        {data.recovered === 0 && data.openClaims === 0 && (
          <p className="mt-5 flex items-center gap-2 text-sm text-gray-500">
            <TrendingUp className="w-4 h-4" />
            No discrepancies found yet. This fills in as deliveries are matched against their
            invoices.
          </p>
        )}
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint: string
  tone: 'warn' | 'muted'
}) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wider text-gray-400">{label}</p>
      <p
        className={cn(
          'mt-1 text-xl font-bold tabular-nums',
          tone === 'warn' ? 'text-amber-700' : 'text-gray-700',
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-gray-500">{hint}</p>
    </div>
  )
}
