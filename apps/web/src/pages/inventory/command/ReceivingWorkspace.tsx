/**
 * Receiving workspace — the canonical Mudavym invoice.
 *
 * Vendors send wildly different paperwork; we never make the manager read theirs. This renders
 * OUR normalized FOUR-way match instead, always the same shape:
 *
 *   ORDERED (agreed)  vs  SHIPPED (their packing slip)  vs  RECEIVED (counted)  vs  INVOICED (billed)
 *
 * The vendor's own document stays attached as evidence, never as the working surface — but the
 * numbers on it are now READ rather than retyped. Any invoice or packing slip already ingested
 * for this order (photographed at the door, emailed in, or parsed from an EDI 810/856) pre-fills
 * the columns, so a manager confirms a transcription instead of performing one.
 *
 * NOTHING IS PRE-FILLED FROM THE ORDER ITSELF. Until an invoice is actually in hand the invoice
 * column is empty and the verdict is `unmatched`. It previously defaulted to the stocked quantity,
 * which made the headline check compare a number to itself and recorded a price as verified that
 * nobody had ever looked at.
 *
 * The server recomputes the verdict and derives the ledger correction — what we send is evidence,
 * not a decision. Rules mirrored from lib/invoiceMatch.ts (the backend is authoritative).
 */
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Check, AlertTriangle, Plus, Receipt, FileText, ShieldCheck } from 'lucide-react'
import { verifyOrderReceipt } from '../../../services/api/orders'
import {
  allocatedChargesFor,
  documentsApi,
  pickDocuments,
} from '../../../services/api/documents'
import { settingsApi } from '../../../services/api/settings'
import { useNotificationStore } from '../../../stores'
import { CURRENCY_CODES } from '../../../lib/currency'
/*
 * THE FIRST PRODUCTION IMPORT FROM THE GATEWAY IN THIS APP (2026-09-11, audit of
 * b6d2e4b4). The receiving refusal's shared sentence is imported, not restated,
 * so the DTO, verifyReceipt and this panel cannot say two different things about
 * a price with no code. It builds because Vercel builds the web from the monorepo
 * root; it stays CURRENT only because `scripts/vercel_should_build.sh` and
 * `turbo.json` now name this file and the one it imports (`common/iso-4217.ts`)
 * as inputs of the web build. Without that, a gateway-only edit to the sentence
 * would skip the preview and hit the web's turbo cache, and ship yesterday's words.
 */
import { RECEIVING_PRICE_CURRENCY_RUNGS } from '../../../../../api-gateway/src/procurement/price-currency'
import { ThemedSelect } from '../../../components/ui/ThemedSelect'
import { computeMatch, verdictStyle, money } from '../../../lib/invoiceMatch'
import { cn } from '../../../lib/utils'
import type { InventoryItem } from '../useInventoryPage'
import type { ShelfReceived } from '../../../services/api/types'

interface Props {
  order: any
  items: InventoryItem[]
  onClose: () => void
  /** Completed orders reopen here as a read-only audit record (D9). */
  readOnly?: boolean
}

/** Units whose one-of-them is several bottles. */
const MULTIPLYING = new Set(['case', 'cases', 'pack', 'packs', 'split_case'])

function unitWord(unit: string, n: number): string {
  const one = n === 1
  switch (unit) {
    case 'case':
    case 'cases':
      return one ? 'case' : 'cases'
    case 'pack':
    case 'packs':
      return one ? 'pack' : 'packs'
    case 'split_case':
      return one ? 'split case' : 'split cases'
    case 'bottle':
    case 'bottles':
      return one ? 'bottle' : 'bottles'
    default:
      return unit
  }
}

export interface DeskCountBasis {
  /** `order` = every number on the screen is in the order's own unit; `bottle` = in bottles. */
  basis: 'order' | 'bottle'
  /** What the physical count starts from, in `basis`. */
  prefill: number
  /** Bottles in one of the order's unit, when the count is in bottles. */
  packSize: number | null
  /** One sentence the desk prints, saying where the count came from. */
  note: string
}

/**
 * How the desk counts this order, decided ONCE from what the stock ledger
 * booked for it — ADR 0192 (founder, 2026-09-21): "received" is the ledger's
 * count, in the item's stock unit, never rounded.
 *
 * This screen used to seed the count from `order.quantityReceived`, a column
 * the receiving door wrote in BOTTLES while this screen read it in the order's
 * unit: a 5-case order the door had counted pre-filled "60", and submitted
 * unedited that is 60 cases — a +660 bottle correction. The ledger's block
 * says its own unit and pack view, so:
 *
 *   * a whole number of packs is counted in the order's unit ("5 cases" -> 5);
 *   * a PART pack is counted in bottles ("5 cases + 5 bottles" -> 65, sent with
 *     `countedUom: 'bottle'`), so it verifies instead of being refused as a
 *     fraction of a case;
 *   * a reading that failed, or a route that sent none, starts from the
 *     ordered quantity and SAYS so — never from a number nobody measured.
 */
export function deskCountBasis(order: {
  quantity?: number | null
  unitType?: string | null
  received?: ShelfReceived | null
}): DeskCountBasis {
  const ordered = typeof order.quantity === 'number' ? order.quantity : 0
  const unit = (order.unitType ?? 'bottle').toString().trim().toLowerCase() || 'bottle'
  const fromOrdered = (why: string): DeskCountBasis => ({
    basis: 'order',
    prefill: ordered,
    packSize: null,
    note: `${why} The count starts from the ordered quantity; confirm what actually arrived.`,
  })
  const r = order.received
  if (!r) return fromOrdered('This screen was not told what the stock ledger booked for this order.')
  if (!r.readable || r.quantityInStockUom === null || !r.words) {
    return fromOrdered(
      `What the stock ledger booked for this order could not be read${r.why ? ` (${r.why})` : ''}.`,
    )
  }
  if (r.packUnit && r.packSize && r.packs !== null && r.looseInStockUom !== null) {
    if (r.looseInStockUom === 0) {
      return {
        basis: 'order',
        prefill: r.packs,
        packSize: null,
        note: `The shelf holds ${r.words} for this order, from the stock ledger.`,
      }
    }
    return {
      basis: 'bottle',
      prefill: r.quantityInStockUom,
      packSize: r.packSize,
      note:
        `The shelf holds ${r.words} for this order — not a whole number of ` +
        `${unitWord(r.packUnit, 2)} — so every number here is in bottles.`,
    }
  }
  const sameUnit =
    !MULTIPLYING.has(unit) &&
    (unit === r.stockUom ||
      (['bottle', 'bottles', 'each'].includes(unit) && ['bottle', 'each'].includes(r.stockUom ?? '')))
  if (sameUnit) {
    return {
      basis: 'order',
      prefill: r.quantityInStockUom,
      packSize: null,
      note: `The shelf holds ${r.words} for this order, from the stock ledger.`,
    }
  }
  return fromOrdered(
    `The shelf holds ${r.words} for this order, but the order states no pack size, so ` +
      `they cannot be counted in ${unitWord(unit, 2)} here.`,
  )
}

/**
 * The agreed price per BOTTLE, for the preview on a bottle-counted screen, or
 * null when the order does not say what its price is per. The gateway compares
 * the real thing (`verifyReceipt`, ADR 0119); a preview that guessed would ask
 * for an override reason nobody owes.
 */
function perBottlePrice(order: any, price: number | null): number | null {
  if (price === null) return null
  const uom = typeof order.priceUom === 'string' ? order.priceUom.toLowerCase() : null
  if (uom === 'bottle' || uom === 'each') return price
  const pack = typeof order.pricePackSize === 'number' ? order.pricePackSize : null
  if (uom && MULTIPLYING.has(uom) && pack && pack > 0) return price / pack
  return null
}

interface ExtraLine {
  inventoryId: string
  label: string
  countedQty: number
}

/**
 * What the vendor's own paperwork said, and how much to trust our reading of it.
 *
 * Shown above the numbers rather than beside them because it changes how the whole screen should
 * be read: a manager confirming a machine transcription behaves differently from one entering
 * figures themselves, and the difference matters most when the extraction is doubtful.
 *
 * A document whose lines do not add up to its own stated total is surfaced loudly. That is the
 * cheapest hallucination detector available — a misread quantity or price nearly always breaks
 * the arithmetic — and it is exactly the invoice a person should look at before arguing from it.
 */
function DocumentStrip({
  invoice,
  packingSlip,
}: {
  invoice: { doc_number: string | null; ties_out: boolean | null; status: string; extraction_confidence: number | null } | null
  packingSlip: { doc_number: string | null; status: string } | null
}) {
  if (!invoice && !packingSlip) {
    return (
      <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100 text-[11px] text-gray-500">
        <FileText className="w-3.5 h-3.5 shrink-0" />
        No paperwork attached to this delivery yet — photograph it, or type what the invoice says.
      </div>
    )
  }

  const doubtful = invoice?.ties_out === false

  return (
    <div
      className={cn(
        'mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 rounded-lg border text-[11px]',
        doubtful
          ? 'bg-amber-50 border-amber-200 text-amber-800'
          : 'bg-emerald-50/60 border-emerald-100 text-emerald-800',
      )}
    >
      <span className="flex items-center gap-1.5 font-semibold">
        {doubtful ? <AlertTriangle className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
        Read from their paperwork
      </span>
      {invoice && (
        <span>
          Invoice {invoice.doc_number ?? '(no number)'}
          {invoice.status === 'verified' ? ' · checked by a human' : ''}
        </span>
      )}
      {packingSlip && <span>Packing slip {packingSlip.doc_number ?? '(no number)'}</span>}
      {doubtful && (
        <span className="font-semibold">
          Its lines do not add up to its own total — check the figures before accepting.
        </span>
      )}
    </div>
  )
}

/** Small stepper used for every count on this screen. */
function Stepper({
  value,
  onChange,
  disabled,
  tone = 'default',
  uxKey,
}: {
  value: number
  onChange: (n: number) => void
  disabled?: boolean
  tone?: 'default' | 'warn'
  /** Stable agent-facing name. Steppers are where miscounts happen, so which one is being fought with matters. */
  uxKey?: string
}) {
  return (
    <div
      data-ux-key={uxKey}
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

  // ADR 0192 — the count's unit and its starting point, from the ledger.
  const count = useMemo(() => deskCountBasis(order), [order])
  const inBottles = count.basis === 'bottle'
  const headerPrice: number | null =
    order.finalPrice ?? order.negotiatedPrice ?? order.quotedPrice ?? order.unitPrice ?? null
  // In bottles, the ordered figure and the agreed price are restated per
  // bottle so every number on the screen is in ONE unit.
  const orderedQty: number = inBottles
    ? (order.quantity ?? 0) * (count.packSize as number)
    : (order.quantity ?? 0)
  const poUnitPrice: number | null = inBottles ? perBottlePrice(order, headerPrice) : headerPrice
  const stockedQty: number = count.prefill
  const countUnitLabel = inBottles
    ? 'Bottles'
    : (() => {
        const w = unitWord((order.unitType ?? 'bottle').toString().trim().toLowerCase() || 'bottle', 2)
        return w.charAt(0).toUpperCase() + w.slice(1)
      })()
  const shelf: ShelfReceived | null = order.received ?? null

  // NULL until an invoice is actually in hand. Absence is not agreement: defaulting these to the
  // order made physical_vs_bill compare a number to itself and wrote price_verified for a delivery
  // nobody had checked.
  const [invoiceQty, setInvoiceQty] = useState<number | null>(null)
  const [invoiceUnitPrice, setInvoiceUnitPrice] = useState<number | null>(null)
  /*
   * WHAT THE PRICE IS IN — required beside it since 2026-09-06 (founder batch
   * 67: "a price without money is not a price").
   *
   * `''` and never a default. Four rungs can fill it and all four are OFFERED
   * rather than applied, nearest paper first: the code the matched INVOICE is
   * filed in, the currency the ORDER was placed in, the HOUSE's own reporting
   * currency, or a code chosen here. The first two pre-fill, in that order
   * (founder, 2026-09-11, batch 69); the house's is only ever a labelled chip.
   * The gateway refuses the pair (`VerifyReceiptDto.priceStatesItsCurrency`), so
   * a screen that assumed one would be putting words in the desk's mouth AND
   * passing them a server check.
   */
  const [invoiceCurrency, setInvoiceCurrency] = useState<string>('')
  /** True once a rung filled the code, so a re-fetch never clobbers a choice. */
  const [currencyPrefilled, setCurrencyPrefilled] = useState(false)
  const [shippedQty, setShippedQty] = useState<number | null>(null)
  const [freeGoodsQty, setFreeGoodsQty] = useState<number>(0)
  // The physical count starts from what the LEDGER says is on the shelf for this order (ADR 0192)
  // — bookings made by a human at the door or on delivery, not the vendor's claim.
  const [acceptedQty, setAcceptedQty] = useState<number>(stockedQty)
  const [rejectedQty, setRejectedQty] = useState<number>(0)
  const [rejectedReason, setRejectedReason] = useState('')
  const [priceOverrideReason, setPriceOverrideReason] = useState('')
  const [note, setNote] = useState('')
  /** True once a value came from a document, so re-fetches never clobber typing. */
  const [prefilled, setPrefilled] = useState(false)

  /**
   * What the extraction proposed, frozen at the moment it proposed it (ADR 0059).
   *
   * Written once, by the same effect that fills the inputs, and never touched
   * again — including when the manager edits an input. That is the entire point:
   * the pre-fill and the final answer must be two separate facts, or a
   * correction is indistinguishable from a confirmation. Fields the document did
   * not offer stay null, because "the machine said nothing" and "the machine said
   * zero" are different statements.
   */
  const [proposed, setProposed] = useState<{
    invoiceQty: number | null
    invoiceUnitPrice: number | null
    shippedQty: number | null
    freeGoodsQty: number | null
  }>({ invoiceQty: null, invoiceUnitPrice: null, shippedQty: null, freeGoodsQty: null })

  const [extras, setExtras] = useState<ExtraLine[]>([])
  const [addingId, setAddingId] = useState('')

  /*
   * A + B4 (founder, 2026-09-06 batch 64/65). The same request now also brings
   * back what the ORDER was placed in, so the two halves of the invoice-versus-
   * order comparison come from ONE moment: an invoice read now against an order
   * read a second later can show a mismatch a restatement in between had already
   * resolved.
   */
  const { data: docsAndOrder } = useQuery({
    queryKey: ['procurement-documents', order.id],
    queryFn: () => documentsApi.forOrderWithCurrency(order.id),
    enabled: !!order.id,
    staleTime: 30_000,
  })
  const documents = docsAndOrder?.documents ?? []
  const orderCurrency = docsAndOrder?.order ?? null

  /*
   * ITEM B (founder, 2026-09-06 batch 67) — the house's own reporting currency,
   * as the SECOND rung the price field can be filled from.
   *
   * Read here rather than derived: `restaurants.currency` is nullable and a
   * house that has never answered the question must show as unanswered, not as
   * USD. `readable: false` is a third state again — a failed read is never
   * rendered as "no currency recorded" (ADR 0083).
   */
  const { data: house } = useQuery({
    queryKey: ['settings', 'currency'],
    queryFn: () => settingsApi.houseCurrency(),
    staleTime: 5 * 60_000,
  })
  const houseCurrency = house?.readable ? (house.code ?? null) : null

  const { invoice, packingSlip } = useMemo(() => pickDocuments(documents), [documents])
  const allocatedCharges = useMemo(() => allocatedChargesFor(invoice), [invoice])

  /**
   * Read the vendor's numbers off the documents.
   *
   * Runs once. A manager who has corrected a misread figure must not have it overwritten by a
   * background refetch — that is how a correction silently disappears and the wrong number gets
   * sent to a distributor.
   */
  useEffect(() => {
    if (prefilled || readOnly) return
    if (!invoice && !packingSlip) return

    // ADR 0059: the machine's half, captured in the same pass that fills the
    // inputs. Every branch below that calls a setter records what it proposed.
    const machine = {
      invoiceQty: null as number | null,
      invoiceUnitPrice: null as number | null,
      shippedQty: null as number | null,
      freeGoodsQty: null as number | null,
    }

    if (invoice) {
      const lines = (invoice as any).extracted?.lines as any[] | undefined
      const totalBottles = lines?.reduce((n, l) => n + (Number(l.qtyBottles) || 0), 0)
      if (totalBottles) {
        setInvoiceQty(totalBottles)
        machine.invoiceQty = totalBottles
      }
      const firstPriced = lines?.find((l) => l.unitPrice != null)
      if (firstPriced?.unitPrice != null) {
        setInvoiceUnitPrice(Number(firstPriced.unitPrice))
        machine.invoiceUnitPrice = Number(firstPriced.unitPrice)
      }
      const free = lines?.reduce((n, l) => n + (Number(l.freeGoodsQty) || 0), 0)
      if (free) {
        setFreeGoodsQty(free)
        machine.freeGoodsQty = free
      }
    }

    if (packingSlip) {
      const lines = (packingSlip as any).extracted?.lines as any[] | undefined
      const shipped = lines?.reduce((n, l) => n + (Number(l.qtyBottles) || 0), 0)
      if (shipped) {
        setShippedQty(shipped)
        machine.shippedQty = shipped
      }
    }

    setProposed(machine)
    setPrefilled(true)
  }, [invoice, packingSlip, prefilled, readOnly])

  const match = useMemo(
    () =>
      computeMatch({
        orderedQty,
        poUnitPrice,
        shippedQty,
        invoiceQty,
        invoiceUnitPrice,
        acceptedQty,
        rejectedQty,
        freeGoodsQty,
        allocatedCharges,
        priceOverrideReason,
      }),
    [
      orderedQty,
      poUnitPrice,
      shippedQty,
      invoiceQty,
      invoiceUnitPrice,
      acceptedQty,
      rejectedQty,
      freeGoodsQty,
      allocatedCharges,
      priceOverrideReason,
    ],
  )

  /*
   * ITEM A — THE PRICE IS REFUSED WHILE THE INVOICE'S MONEY IS HELD.
   *
   * `moneyState` is the gateway's own verdict, computed by the SAME function
   * `verifyReceipt` refuses the price with, so this field is disabled exactly
   * when the server would reject it. Deriving the verdict here instead would
   * eventually show an enabled box over a request that 409s.
   *
   * The count, the rejection and the stock movement are untouched: only this one
   * input is closed, and the sentence says so.
   */
  const moneyHold =
    invoice && invoice.moneyState && invoice.moneyState.priced === false
      ? invoice.moneyState.reason
      : null

  /*
   * B4 — the invoice's currency beside the order's. NOTHING IS CONVERTED and
   * nothing is judged: the two codes are printed as they are, and a screen that
   * shows them differing has said the useful thing.
   */
  const currencyMismatch =
    !!orderCurrency?.currency &&
    !!invoice?.currency &&
    orderCurrency.currency !== invoice.currency

  /*
   * ITEM B — THE CODE IS OFFERED, ONCE: THE INVOICE'S FILED CODE FIRST, THEN
   * THE ORDER'S, THEN NOTHING. Never from the house.
   *
   * THE FOUNDER, 2026-09-11 (batch 69): *"Invoice's filed code first, then the
   * order's"* — *"A reading of the document, like the quantities and prices on
   * that screen already are; when the two disagree the comparison banner already
   * says so. One line."*
   *
   * The field is literally the INVOICE's unit price, so the invoice's own filed
   * code is a reading of the paper in front of the desk — the same kind of act
   * as the quantity and the price this screen already pre-fills from that
   * document. The order's currency is one step further away: a fact about what
   * somebody intended to buy, which a vendor is free to bill differently. Both
   * are still only OFFERED — the desk confirms or changes what is in the field
   * before anything records.
   *
   * NOTHING IS HIDDEN WHEN THE TWO DISAGREE. The comparison banner below already
   * prints "the order was placed in X; this invoice states Y" whenever both are
   * known and differ, and it is unchanged: pre-filling the invoice's code makes
   * that banner MORE useful, because the figure and the code in the cell now
   * come from the same piece of paper.
   *
   * The house's reporting currency is a fact about the HOUSE and says nothing
   * about what a vendor billed — offered below as a one-tap choice, with its
   * provenance on the label, never written into the field for somebody. That
   * distinction is the whole of ADR 0117 Q25 and it is untouched.
   *
   * Runs once, like the document pre-fill above and for the same reason: a
   * background re-fetch must not overwrite a manager's correction.
   */
  useEffect(() => {
    if (currencyPrefilled || readOnly) return
    // In order. A rung that names a code this product cannot offer is skipped,
    // not written: the picker would not hold it and the gateway would refuse it.
    const rungs = [invoice?.currency as string | undefined, orderCurrency?.currency]
    const filled = rungs.find(
      (code): code is string =>
        typeof code === 'string' && CURRENCY_CODES.includes(code),
    )
    // No `else` that invents one. A delivery whose paper and whose order both
    // state nothing leaves the field empty, the Accept button reads "Currency
    // required", and the chips offer the house's code with its provenance.
    if (filled) {
      setInvoiceCurrency(filled)
      setCurrencyPrefilled(true)
    }
  }, [invoice, orderCurrency, currencyPrefilled, readOnly])

  /**
   * The codes this desk can take in one tap, each labelled with where it came
   * from. A chip that did not say "the house reports in this" would be a code
   * appearing from nowhere, which is the same defect as a default.
   */
  const currencyOffers = useMemo(() => {
    const seen = new Set<string>()
    const out: Array<{ code: string; from: string }> = []
    const offer = (code: string | null | undefined, from: string) => {
      if (typeof code !== 'string') return
      if (!CURRENCY_CODES.includes(code) || seen.has(code)) return
      seen.add(code)
      out.push({ code, from })
    }
    offer(invoice?.currency as string | undefined, 'this invoice is filed in')
    offer(orderCurrency?.currency, 'the order was placed in')
    offer(houseCurrency, 'this house reports in')
    return out.filter((o) => o.code !== invoiceCurrency)
  }, [invoice, orderCurrency, houseCurrency, invoiceCurrency])

  /** The server refuses this pair; so does the button, with the same reason. */
  const priceNeedsCurrency = invoiceUnitPrice != null && invoiceCurrency === ''

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
        // undefined, not a fallback. The server reads an absent invoice quantity as
        // "unknown" and returns `unmatched`, which keeps the order open until the
        // paperwork actually turns up.
        // Every number on this screen is in ONE unit (ADR 0192). In the order's
        // own unit, no unit is declared and an absent unit means exactly that to
        // the server. In bottles — a part case on the shelf — every quantity
        // declares `bottle`, so the server converts nothing it should not.
        countedUom: inBottles ? 'bottle' : undefined,
        invoiceUom: inBottles && invoiceQty != null ? 'bottle' : undefined,
        shippedUom: inBottles && shippedQty != null ? 'bottle' : undefined,
        invoiceQuantityInInvoiceUom: invoiceQty ?? undefined,
        invoiceUnitPrice: invoiceUnitPrice ?? undefined,
        // Sent whenever it is set, price or no price. The gateway refuses the
        // PAIR (a price with no code) and accepts a code with no price, so a
        // desk that picks the currency before typing the figure is not fought.
        invoiceCurrency: invoiceCurrency || undefined,
        shippedQuantityInShippedUom: shippedQty ?? undefined,
        freeGoodsQuantityInCountedUom: freeGoodsQty || undefined,
        allocatedCharges: allocatedCharges || undefined,
        acceptedQuantityInCountedUom: acceptedQty,
        rejectedQuantityInCountedUom: rejectedQty,
        rejectedReason: rejectedQty > 0 ? rejectedReason || 'damaged on arrival' : undefined,
        priceOverrideReason: priceDiffers ? priceOverrideReason : undefined,
        // ADR 0059. What the machine put in these fields before the manager
        // answered, sent alongside — never instead of — what they submitted.
        // `undefined` where the document proposed nothing: absence of a proposal
        // is not a proposal of zero, and the final value there is an original
        // answer rather than a correction.
        prefilledInvoiceQuantityInInvoiceUom: proposed.invoiceQty ?? undefined,
        prefilledInvoiceUnitPrice: proposed.invoiceUnitPrice ?? undefined,
        prefilledShippedQuantityInShippedUom: proposed.shippedQty ?? undefined,
        prefilledFreeGoodsQuantityInCountedUom: proposed.freeGoodsQty ?? undefined,
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

  // The gateway refuses a price with no code before it writes anything, so the
  // button refuses it too rather than sending a request that 400s. Both refusals
  // exist: this one is courtesy, the server's is the rule.
  const blocked = match.requiresOverride || priceNeedsCurrency
  const primaryLabel = priceNeedsCurrency
    ? 'Currency required'
    : blocked
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
          {/* What the vendor's own paperwork said, and how confident we are we read it right. */}
          <DocumentStrip invoice={invoice} packingSlip={packingSlip} />

          {/* WHAT THE SHELF HOLDS FOR THIS ORDER (ADR 0192), and the two facts that
              travel beside it and are never folded into it. */}
          <div
            className="mb-3 rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2 text-xs text-gray-600"
            data-testid="receiving-shelf-note"
          >
            <p>{count.note}</p>
            {shelf?.readable && (shelf.rejectedAtDoorBottles ?? 0) > 0 && (
              <p className="mt-1 text-amber-700">
                {shelf.rejectedAtDoorBottles}{' '}
                {shelf.rejectedAtDoorBottles === 1 ? 'bottle was' : 'bottles were'} rejected at the
                door.
              </p>
            )}
            {shelf?.readable && (shelf.countedNotBookedBottles ?? 0) > 0 && (
              <p className="mt-1 text-amber-700">
                {shelf.countedNotBookedBottles}{' '}
                {shelf.countedNotBookedBottles === 1 ? 'bottle was' : 'bottles were'} counted at
                the door and are not on the shelf yet.
              </p>
            )}
            {/* The earlier verification's own facts (ADR 0192 amendment), in
                bottles: they used to be order columns in two units. */}
            {shelf?.readable && (shelf.rejectedAtDeskBottles ?? 0) > 0 && (
              <p className="mt-1 text-amber-700" data-testid="receiving-shelf-desk-rejected">
                {shelf.rejectedAtDeskBottles}{' '}
                {shelf.rejectedAtDeskBottles === 1 ? 'bottle was' : 'bottles were'} rejected at the
                last verification.
              </p>
            )}
            {shelf?.readable && (shelf.backorderBottles ?? 0) > 0 && (
              <p className="mt-1" data-testid="receiving-shelf-backorder">
                {shelf.backorderBottles} {shelf.backorderBottles === 1 ? 'bottle is' : 'bottles are'} still
                owed on this order.
              </p>
            )}
          </div>

          {/* four-way header */}
          <div className="grid grid-cols-[1fr_74px_74px_74px_74px_74px_66px] gap-1.5 items-end pb-2 text-[10.5px] font-bold uppercase tracking-wider text-gray-400">
            <div className="truncate">{order.wineName || 'Ordered wine'}</div>
            <div className="text-center">Ordered</div>
            <div className="text-center" title="From the vendor's own packing slip">
              Shipped
            </div>
            <div className="text-center">Invoiced</div>
            <div className="text-center">Accepted</div>
            <div className="text-center">Rejected</div>
            <div className="text-right">Back</div>
          </div>

          {/* quantities */}
          <div className="grid grid-cols-[1fr_74px_74px_74px_74px_74px_66px] gap-1.5 items-center py-3 border-t border-gray-100">
            <div className="text-xs text-gray-500" data-testid="receiving-count-unit">
              {countUnitLabel}
            </div>
            <div className="text-center font-mono text-sm text-gray-500">{orderedQty}</div>
            <div className="flex justify-center">
              <input
                type="number"
                min={0}
                disabled={readOnly}
                placeholder="—"
                aria-label="Quantity shipped per the packing slip"
                title="What their packing slip says shipped. Disagreeing with the invoice proves an overbill from their own paperwork."
                value={shippedQty ?? ''}
                onChange={(e) =>
                  setShippedQty(
                    e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0),
                  )
                }
                className={cn(
                  'w-[64px] h-8 text-center font-mono text-sm border rounded-lg outline-none focus:ring-2 focus:ring-wine-500 focus:border-transparent disabled:bg-gray-50',
                  match.selfEvidenced ? 'border-rose-400 bg-rose-50' : 'border-gray-200',
                )}
              />
            </div>
            <div className="flex justify-center">
              <input
                type="number"
                min={0}
                disabled={readOnly}
                // Empty means "no invoice yet", which is a real and common state —
                // many houses bill weekly in arrears. It must not read as zero.
                placeholder="—"
                aria-label="Quantity invoiced"
                value={invoiceQty ?? ''}
                onChange={(e) =>
                  setInvoiceQty(
                    e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0),
                  )
                }
                className="w-[64px] h-8 text-center font-mono text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-wine-500 focus:border-transparent disabled:bg-gray-50"
              />
            </div>
            <div className="flex justify-center">
              <Stepper value={acceptedQty} onChange={setAcceptedQty} disabled={readOnly} uxKey="receiving:accepted-qty" />
            </div>
            <div className="flex justify-center">
              <Stepper value={rejectedQty} onChange={setRejectedQty} disabled={readOnly} tone="warn" uxKey="receiving:rejected-qty" />
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
          <div className="grid grid-cols-[1fr_74px_74px_280px] gap-1.5 items-center py-3 border-t border-gray-50">
            <div className="text-xs text-gray-500">
              Unit price
              {/* The code travels WITH the figure, in the same cell, because a
                  currency picked three rows away from a number is a currency
                  people stop reading. */}
              <select
                aria-label="Invoice currency"
                data-testid="receiving-invoice-currency"
                disabled={readOnly || !!moneyHold}
                value={invoiceCurrency}
                onChange={(e) => {
                  setInvoiceCurrency(e.target.value)
                  setCurrencyPrefilled(true)
                }}
                className={cn(
                  'ml-2 h-6 px-1 text-[11px] font-mono border rounded-md bg-white outline-none focus:ring-2 focus:ring-wine-500 disabled:bg-gray-50',
                  priceNeedsCurrency ? 'border-rose-300 bg-rose-50/40' : 'border-gray-200',
                )}
              >
                <option value="">currency?</option>
                {CURRENCY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </div>
            <div className="text-center font-mono text-sm text-gray-500">
              {poUnitPrice != null ? money(poUnitPrice) : '—'}
            </div>
            <div className="flex justify-center">
              <input
                type="number"
                min={0}
                step="0.01"
                disabled={readOnly || !!moneyHold}
                aria-label="Invoice unit price"
                title={moneyHold ?? undefined}
                placeholder="—"
                value={moneyHold ? '' : (invoiceUnitPrice ?? '')}
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
              {moneyHold ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700">
                  <AlertTriangle className="w-3 h-3" /> Price held — currency not filed
                </span>
              ) : poUnitPrice == null ? (
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

          {/* B (batch 67) — a price with no code, said in words, with the codes
              this desk can take in one tap and where each comes from. Shown only
              when a price has actually been typed: an empty price field asks no
              currency question, and a screen that nagged about one before there
              was a figure would train people to ignore it. */}
          {priceNeedsCurrency && !readOnly && (
            <div
              data-testid="receiving-price-needs-currency"
              className="mt-1 mb-2 p-3 rounded-lg bg-rose-50/60 ring-1 ring-rose-200"
            >
              <p className="text-[11px] font-bold uppercase tracking-wider text-rose-700 mb-1.5">
                This price does not say what it is in
              </p>
              {/* THE GATEWAY'S OWN SENTENCE, imported rather than restated. The
                  DTO, verifyReceipt and this panel say one thing about a price
                  with no code: what it costs, the four rungs that state one, and
                  what still records without it. This panel used to carry its own
                  wording and named no rung, so in the state with no chip to offer
                  the desk was told a code was needed and not where to find one. */}
              <p
                data-testid="receiving-price-currency-rungs"
                className="text-[11.5px] leading-relaxed text-rose-900/90"
              >
                {RECEIVING_PRICE_CURRENCY_RUNGS}
              </p>
              {currencyOffers.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  {currencyOffers.map((o) => (
                    <button
                      key={o.code}
                      type="button"
                      onClick={() => {
                        setInvoiceCurrency(o.code)
                        setCurrencyPrefilled(true)
                      }}
                      className="h-6 px-2 rounded-md border border-rose-200 bg-white text-[11px] font-semibold text-rose-800 hover:bg-rose-50"
                    >
                      {o.from} <span className="font-mono">{o.code}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* A — the refusal, in words, with the act that clears it. Never hidden
              and never a bare disabled box: a person who cannot do something has
              to learn who can and how. */}
          {moneyHold && (
            <div
              data-testid="receiving-money-hold"
              className="mt-1 mb-2 p-3 rounded-lg bg-amber-50/70 ring-1 ring-amber-200"
            >
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-800 mb-1.5">
                The unit price is not accepted on this delivery
              </p>
              <p className="text-[11.5px] leading-relaxed text-amber-900/90">{moneyHold}</p>
              <p className="text-[11.5px] leading-relaxed text-amber-900/90 mt-1.5">
                Everything else here still stands — the count, the rejection and the
                stock movement are unaffected, and this receipt can be submitted now
                without a price.{' '}
                <Link
                  to={`/receipts?doc=${invoice?.id ?? ''}`}
                  className="underline font-semibold"
                >
                  Restate or confirm this invoice’s currency
                </Link>{' '}
                — a manager’s or an owner’s decision, recorded with their name — and
                the price is accepted as it stands.
              </p>
            </div>
          )}

          {/* B4 — the invoice's money beside the order's. Nothing is converted. */}
          {(orderCurrency?.failure || currencyMismatch) && (
            <div
              data-testid="receiving-currency-compare"
              className={cn(
                'mt-1 mb-2 p-3 rounded-lg ring-1',
                currencyMismatch
                  ? 'bg-rose-50/60 ring-rose-200'
                  : 'bg-gray-50 ring-gray-200',
              )}
            >
              {orderCurrency?.failure ? (
                <p className="text-[11.5px] leading-relaxed text-gray-700">
                  {orderCurrency.failure}
                </p>
              ) : (
                <p className="text-[11.5px] leading-relaxed text-rose-800">
                  <span className="font-semibold">
                    The order was placed in {orderCurrency?.currency}; this invoice states{' '}
                    {invoice?.currency}.
                  </span>{' '}
                  Nothing has been converted — there is no exchange rate in this
                  system — so the figures above are not comparable until one of the
                  two is right.{' '}
                  <Link
                    to={`/receipts?doc=${invoice?.id ?? ''}`}
                    className="underline font-semibold"
                  >
                    Restate or confirm the invoice’s currency
                  </Link>
                  .
                </p>
              )}
            </div>
          )}

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
            {invoiceQty != null && receivedQty !== invoiceQty && (
              <p className="text-[10.5px] text-gray-500 mt-2 pt-2 border-t border-black/5">
                {receivedQty} physically arrived ({acceptedQty} accepted + {rejectedQty} rejected)
                against {invoiceQty} billed
                {freeGoodsQty > 0 ? `, ${freeGoodsQty} of them free` : ''}.
              </p>
            )}
            {match.selfEvidenced && (
              <p className="text-[10.5px] font-semibold text-rose-700 mt-2 pt-2 border-t border-black/5">
                {/* The one claim that needs no argument — their two documents disagree. */}
                Their packing slip and their invoice disagree. Attach the slip to the credit
                request and there is nothing to dispute.
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
              data-ux-key="receiving:defer"
              className="h-9 px-4 border border-gray-200 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-100"
            >
              {readOnly ? 'Close' : 'Later'}
            </button>
            {!readOnly && (
              <button
                onClick={() => verify.mutate()}
                data-ux-key="receiving:verify"
                disabled={verify.isPending || blocked}
                title={
                  priceNeedsCurrency
                    ? 'Say what the price is in, or clear it — the count still records either way'
                    : blocked
                      ? 'Give a reason for the price difference first'
                      : undefined
                }
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
