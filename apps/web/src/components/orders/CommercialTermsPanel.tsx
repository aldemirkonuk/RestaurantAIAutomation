/**
 * CommercialTermsPanel — the supplier's structured pricing/ordering terms, rendered inside
 * DealApprovalModal. One component, three emergent states (no selector needed):
 *   • full     — rich terms, no advisories        (sketch 10a)
 *   • advisory — an amber flag derived from data   (sketch 10b)
 *   • sparse   — only the few fields present       (sketch 10c)
 *
 * Self-sufficient: the advisories (case↔unit price mismatch, MOQ not met, tax basis unknown,
 * currency ambiguity) are derived here from the raw terms + orderQty, mirroring the backend's
 * validateCommercialTerms — so the UI is robust even though the deal payload carries no flags
 * array. Display-only. Absent fields render nothing. Amber = advisory, never blocking.
 */
import { useMemo, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Link2, AlertTriangle, Clock } from 'lucide-react'
import type { CommercialTermsDto, DiscountTierDto } from '../../hooks/queries/useDraftEmailQueries'

const spring = { type: 'spring' as const, damping: 26, stiffness: 300 }

interface Props {
  terms: CommercialTermsDto
  /** current order quantity, for the tier ladder + MOQ check */
  orderQty?: number | null
}

function formatDay(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function CommercialTermsPanel({ terms, orderQty }: Props) {
  const currency = terms.currency ?? 'USD'
  const fmt = useMemo(() => {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })
    } catch {
      return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }
  }, [currency])

  const qty = orderQty ?? 0

  // Per-field provenance: the supplier's exact phrase a value was read from (source_quotes).
  // Absent → no affordance (degrades to plain text), mirroring the price fields.
  const quote = (key: string): string | undefined => {
    const q = terms.source_quotes?.[key]
    return q && q.trim() ? q.trim() : undefined
  }

  // ── advisories derived client-side (mirrors backend validateCommercialTerms) ──
  const derivedCaseUnit =
    terms.case_price != null && terms.bottles_per_case ? terms.case_price / terms.bottles_per_case : null
  const priceInconsistent =
    derivedCaseUnit != null && terms.unit_price != null && terms.unit_price > 0
      ? Math.abs(derivedCaseUnit - terms.unit_price) / terms.unit_price > 0.02
      : false
  const moqNotMet = terms.min_order_qty != null && qty > 0 && terms.min_order_qty > qty
  const currencyAmbiguous = terms.currency_ambiguous === true
  const taxUnknown = terms.tax_status === 'unknown'

  const caseSavingPct =
    derivedCaseUnit != null && terms.unit_price && !priceInconsistent
      ? Math.round((1 - derivedCaseUnit / terms.unit_price) * 1000) / 10
      : null

  const validDays = useMemo(() => {
    if (!terms.price_valid_until) return null
    const d = Math.ceil((new Date(terms.price_valid_until).getTime() - Date.now()) / 86_400_000)
    return Number.isFinite(d) ? d : null
  }, [terms.price_valid_until])

  const hasHero = terms.unit_price != null || terms.case_price != null
  const bothPrices = terms.unit_price != null && terms.case_price != null

  const specCells = [
    terms.min_order_qty != null && {
      key: 'moq',
      label: 'Min order',
      value: `${terms.min_order_qty} ${terms.min_order_unit ?? 'bottles'}${moqNotMet ? ' · not met' : ''}`,
      amber: moqNotMet,
      quote: quote('min_order_qty'),
    },
    terms.payment_terms && { key: 'pay', label: 'Payment', value: terms.payment_terms, quote: quote('payment_terms') },
    terms.delivery_lead_time && { key: 'lead', label: 'Lead time', value: terms.delivery_lead_time, quote: quote('delivery_lead_time') },
    terms.price_valid_until && {
      key: 'valid',
      label: 'Price valid',
      value: `${formatDay(terms.price_valid_until)}${validDays != null ? ` · ${validDays}d` : ''}`,
      amber: validDays != null && validDays <= 7,
      clock: true,
      quote: quote('price_valid_until'),
    },
  ].filter(Boolean) as Array<{ key: string; label: string; value: string; amber?: boolean; clock?: boolean; quote?: string }>

  const tiers = (terms.discount_tiers ?? []).filter((t) => t.threshold_qty != null && (t.threshold_qty as number) > 0)

  // Nothing extractable → render nothing (sketch 10c taken to its limit).
  if (!hasHero && specCells.length === 0 && tiers.length === 0 && !terms.currency && !terms.stock_status && !taxUnknown) {
    return null
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      className="space-y-3 mb-4"
      aria-label="Supplier commercial terms"
    >
      {/* Hero: unit ↔ case */}
      {hasHero && (
        <div className="relative">
          <div className={`grid ${bothPrices ? 'grid-cols-2' : 'grid-cols-1'} border border-gray-200 rounded-xl overflow-hidden`}>
            {terms.unit_price != null && (
              <div className={bothPrices ? (priceInconsistent ? 'p-3 border-r border-dashed border-amber-300' : 'p-3 border-r border-gray-200') : 'p-3'}>
                <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Unit price</div>
                <div className="text-xl font-bold text-wine-700 leading-none">
                  {terms.source_quotes?.unit_price
                    ? <span className="border-b border-dashed border-wine-300 cursor-help" title={`“${terms.source_quotes.unit_price}”`}>{fmt.format(terms.unit_price)}</span>
                    : fmt.format(terms.unit_price)}
                </div>
                <div className="text-[11px] text-gray-500 mt-1">per bottle</div>
              </div>
            )}
            {terms.case_price != null && (
              <div className="p-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Case price</div>
                <div className="text-xl font-bold text-gray-900 leading-none">
                  {terms.source_quotes?.case_price
                    ? <span className="border-b border-dashed border-gray-300 cursor-help" title={`“${terms.source_quotes.case_price}”`}>{fmt.format(terms.case_price)}</span>
                    : fmt.format(terms.case_price)}
                </div>
                {derivedCaseUnit != null && (
                  <div className="flex items-center gap-1.5 text-[11px] text-gray-500 mt-1 flex-wrap">
                    <span>{terms.bottles_per_case} btl → <span className="font-medium text-gray-900">{fmt.format(derivedCaseUnit)}/btl</span></span>
                    {caseSavingPct != null && caseSavingPct > 0 && (
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 rounded-full px-1.5 py-px">save {caseSavingPct}%</span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          {bothPrices && (
            <span
              aria-hidden
              className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center border ${priceInconsistent ? 'bg-amber-50 border-amber-300' : 'bg-white border-gray-200'}`}
            >
              {priceInconsistent ? <AlertTriangle className="w-3 h-3 text-amber-700" /> : <Link2 className="w-3 h-3 text-gray-400" />}
            </span>
          )}
        </div>
      )}

      {priceInconsistent && derivedCaseUnit != null && terms.unit_price != null && (
        <p className="text-[11px] leading-relaxed text-amber-800 px-0.5" role="note">
          Case ÷ {terms.bottles_per_case} = {fmt.format(derivedCaseUnit)}/btl, but the unit price is {fmt.format(terms.unit_price)} — these don&rsquo;t reconcile. Confirm which is current before ordering.
        </p>
      )}

      {/* Spec grid */}
      {specCells.length > 0 && (
        <dl className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
          {specCells.map((cell) => (
            <div key={cell.key} className={`rounded-lg border px-2.5 py-2 ${cell.amber ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-100'}`}>
              <dt className={`text-[9px] font-bold uppercase tracking-wider mb-0.5 ${cell.amber ? 'text-amber-700' : 'text-gray-400'}`}>{cell.label}</dt>
              <dd className={`text-[13px] font-medium m-0 flex items-center gap-1 ${cell.amber ? 'text-amber-800' : 'text-gray-900'}`}>
                {cell.clock && <Clock className="w-3 h-3 shrink-0" aria-hidden />}
                {cell.quote
                  ? <span className={`border-b border-dashed cursor-help ${cell.amber ? 'border-amber-400' : 'border-gray-300'}`} title={`“${cell.quote}”`}>{cell.value}</span>
                  : cell.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {/* Discount ladder */}
      {tiers.length > 0 && <TierLadder tiers={tiers} orderQty={qty > 0 ? qty : null} moq={terms.min_order_qty ?? null} moqNotMet={moqNotMet} sourceQuote={quote('discount_tiers')} />}

      {/* Metadata chips */}
      <div className="flex items-center gap-1.5 flex-wrap" aria-label="Quote metadata">
        {terms.currency && <Chip amber={currencyAmbiguous} quote={quote('currency')}>{currencyAmbiguous ? `currency unclear — assumed ${currency}` : currency}</Chip>}
        {taxUnknown ? (
          <Chip amber>Tax basis unstated — confirm before ordering</Chip>
        ) : (
          terms.tax_status && <Chip quote={quote('tax_status')}>Tax {terms.tax_status}</Chip>
        )}
        {terms.stock_status && terms.stock_status !== 'in_stock' && (
          <Chip amber dot quote={quote('stock_status')}>
            {terms.stock_status === 'limited' && `Limited stock${terms.stock_qty_available != null ? ` · ${terms.stock_qty_available} btl left` : ''}`}
            {terms.stock_status === 'allocation' && 'On allocation'}
            {terms.stock_status === 'out_of_stock' && 'Out of stock'}
          </Chip>
        )}
      </div>
    </motion.div>
  )
}

function Chip({ children, amber, dot, quote }: { children: ReactNode; amber?: boolean; dot?: boolean; quote?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[10px] font-medium rounded-full px-2.5 py-1 border ${amber ? 'text-amber-800 bg-amber-50 border-amber-200' : 'text-gray-500 bg-gray-50 border-gray-100'} ${quote ? 'cursor-help' : ''}`}
      title={quote ? `“${quote}”` : undefined}
    >
      {dot && <span aria-hidden className={`w-1.5 h-1.5 rounded-full ${amber ? 'bg-amber-500' : 'bg-emerald-500'}`} />}
      {quote ? <span className={`border-b border-dashed ${amber ? 'border-amber-400' : 'border-gray-300'}`}>{children}</span> : children}
    </span>
  )
}

function TierLadder({ tiers, orderQty, moq, moqNotMet, sourceQuote }: { tiers: DiscountTierDto[]; orderQty: number | null; moq: number | null; moqNotMet: boolean; sourceQuote?: string }) {
  const sorted = [...tiers].sort((a, b) => (a.threshold_qty as number) - (b.threshold_qty as number))
  const max = sorted[sorted.length - 1].threshold_qty as number
  if (!(max > 0)) return null
  const pos = (q: number) => 8 + (Math.min(q, max) / max) * 86
  const tierLabel = (t: DiscountTierDto) =>
    t.discount_pct != null ? `−${t.discount_pct}%` : t.discount_amount != null ? `−${t.discount_amount}` : ''
  const nextTier = orderQty != null ? sorted.find((t) => (t.threshold_qty as number) > orderQty) : null

  return (
    <div aria-label="Volume discount tiers">
      <div className="flex items-baseline justify-between mb-3.5">
        <span
          className={`text-[9px] font-bold uppercase tracking-wider text-gray-400 ${sourceQuote ? 'border-b border-dashed border-gray-300 cursor-help' : ''}`}
          title={sourceQuote ? `“${sourceQuote}”` : undefined}
        >Volume discounts</span>
        {moqNotMet && moq != null && orderQty != null ? (
          <span className="text-[11px] font-bold text-amber-700">{moq - orderQty} below minimum</span>
        ) : nextTier && orderQty != null ? (
          <span className="text-[11px] font-bold text-wine-700">
            {(nextTier.threshold_qty as number) - orderQty} more unlocks {tierLabel(nextTier)}
          </span>
        ) : null}
      </div>
      <div
        className="relative h-9 mx-1.5"
        role="img"
        aria-label={`Tiers: ${sorted.map((t) => `${t.threshold_qty} ${tierLabel(t)}`).join(', ')}${orderQty != null ? `. Current order ${orderQty}` : ''}`}
      >
        <span className="absolute top-[5px] left-0 right-0 h-[3px] rounded-full bg-gray-100" />
        {orderQty != null && (
          <span className={`absolute top-[5px] left-0 h-[3px] rounded-full ${moqNotMet ? 'bg-amber-300' : 'bg-wine-300'}`} style={{ width: `${pos(orderQty)}%` }} />
        )}
        {sorted.map((t) => {
          const reached = orderQty != null && orderQty >= (t.threshold_qty as number)
          return (
            <span key={t.threshold_qty as number}>
              <span
                className={`absolute top-0.5 w-[9px] h-[9px] rounded-full -translate-x-1/2 ${reached ? 'bg-wine-700' : 'bg-white border border-gray-300'}`}
                style={{ left: `${pos(t.threshold_qty as number)}%` }}
              />
              <span className="absolute top-[18px] -translate-x-1/2 text-[9px] text-gray-500 whitespace-nowrap" style={{ left: `${pos(t.threshold_qty as number)}%` }}>
                <span className="font-medium text-gray-900">{t.threshold_qty}</span> · {tierLabel(t)}
              </span>
            </span>
          )
        })}
        {orderQty != null && (
          <>
            <motion.span
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={spring}
              className={`absolute top-0 w-[13px] h-[13px] rounded-full -translate-x-1/2 border-[2.5px] ${moqNotMet ? 'bg-amber-500 border-amber-200' : 'bg-wine-700 border-wine-200'}`}
              style={{ left: `${pos(orderQty)}%` }}
            />
            <span
              className={`absolute -top-[11px] -translate-x-1/2 text-[8.5px] font-bold whitespace-nowrap ${moqNotMet ? 'text-amber-700' : 'text-wine-700'}`}
              style={{ left: `${pos(orderQty)}%` }}
            >
              you · {orderQty}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
