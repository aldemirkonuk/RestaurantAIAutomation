/**
 * Formatting for the canonical document (ADR 0104 D4, D9; ADR 0103 A6).
 *
 * Three rules this file exists to enforce, all of them about not lying:
 *
 * 1. **Confidence is never a number on screen.** There is deliberately no
 *    `fmtConfidence` here. The founder's answer was named exceptions only, and
 *    a helper that formatted `0.71` as `71%` would be used the moment it
 *    existed. `confidenceWord` returns a WORD, and only for the two states that
 *    change what a person should do.
 * 2. **`not_counted` is words.** Never 0, never blank, never equal to shipped.
 * 3. **A currency we were not told is not a dollar sign.** `fmtMoney` takes the
 *    document's own currency and renders the em dash when there is none.
 */

export const EM = '—'

export const SERIF = '"Fraunces", Georgia, "Times New Roman", serif'
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace'
export const SANS = '"DM Sans", "Plus Jakarta Sans", system-ui, sans-serif'

const SYMBOLS: Record<string, string> = { TRY: '₺', USD: '$', EUR: '€', GBP: '£' }

/** Turkish documents group with `.` and decimal with `,`. */
function localeFor(currency: string | null | undefined): string {
  return currency === 'TRY' ? 'tr-TR' : 'en-US'
}

export function currencySymbol(currency: string | null | undefined): string {
  if (!currency) return ''
  return SYMBOLS[currency] ?? `${currency} `
}

/**
 * A money figure in the document's own currency.
 *
 * When the currency is unknown the number is still shown but UNSYMBOLED — a
 * `$` on a Turkish invoice is a wrong claim about the amount, not a cosmetic
 * default.
 */
export function fmtMoney(
  n: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (n == null || !Number.isFinite(Number(n))) return EM
  const body = Number(n).toLocaleString(localeFor(currency), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `${currencySymbol(currency)}${body}`
}

/** A bare quantity, in the document's own number formatting. */
export function fmtQty(
  n: number | null | undefined,
  currency?: string | null,
): string {
  if (n == null || !Number.isFinite(Number(n))) return EM
  return Number(n).toLocaleString(localeFor(currency), {
    maximumFractionDigits: 3,
  })
}

/**
 * ADR 0103 A6. `"not_counted"` renders as the WORDS "not counted".
 *
 * The alternative renderings are all claims nobody made: `0` says the door
 * counted nothing and found nothing, a blank says the column does not apply,
 * and copying `shipped` says the vendor's number is ours.
 */
export function fmtReceived(
  received: number | 'not_counted' | null | undefined,
  currency?: string | null,
): string {
  if (received === 'not_counted') return 'not counted'
  if (received == null) return EM
  return fmtQty(received, currency)
}

/**
 * A date in the DOCUMENT's own convention, not the reader's.
 *
 * `jurisdiction` is the right answer where it is set — but it comes from a
 * column that is frequently NULL, and on 2026-09-04 all three documents on
 * screen (two of them Turkish) rendered `Aug 12, 2026` because a null
 * jurisdiction fell straight through to `en-US`. A default is not a jurisdiction
 * and must not act like one, so the document's CURRENCY is consulted second: a
 * document billed in TRY is a Turkish document whatever the column says.
 *
 * The Turkish form is written out rather than delegated to `toLocaleDateString`
 * because that call depends on the runtime's ICU data — the same code then
 * prints `14.08.2026` in one environment and `8/14/2026` in another, and a date
 * that changes shape with the server build is not a transcription of anything.
 */
export function fmtDate(
  iso: string | null | undefined,
  jurisdiction?: string | null,
  currency?: string | null,
): string {
  if (!iso) return EM
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso)
  if (!Number.isFinite(d.getTime())) return EM
  // A Turkish document prints 14.08.2026; a Californian one prints Aug 14, 2026.
  const turkish = jurisdiction === 'TR' || (jurisdiction !== 'US-CA' && currency === 'TRY')
  if (turkish) {
    const p = (n: number) => String(n).padStart(2, '0')
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`
  }
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * The two states of confidence that change what a person should do — as words.
 *
 * ADR 0104 D4: a manager reads "line 4 billed 12, received 10 → claim ₺840,00",
 * never `0.71`. `null` is NOT low confidence: an EDI document, a signed XML and
 * a human typing all have no notion of confidence at all, and calling that
 * "unsure" would send someone to re-check a document nothing was uncertain about.
 */
export function confidenceWord(c: number | null | undefined): string | null {
  if (c == null || !Number.isFinite(Number(c))) return null
  return Number(c) < 0.6 ? 'read with difficulty' : null
}

/** What a `source` means, in a sentence a bookkeeper can act on. */
export function sourceSentence(
  source: string,
  page: number | null | undefined,
  asPrinted: string | null | undefined,
): string {
  const printed =
    asPrinted == null
      ? 'as printed: not kept'
      : `as printed “${asPrinted}”`
  switch (source) {
    case 'extracted':
      return `Read from the document${page ? `, page ${page}` : ''} · ${printed}`
    case 'embedded_xml':
      return `Read from the signed XML the vendor sent · ${printed}`
    case 'edi':
      return `Received as EDI · ${printed}`
    case 'portal':
      return `Pulled from the vendor's portal · ${printed}`
    case 'learned_from_vendor':
      return 'Learned from this vendor · not printed on this document'
    case 'carried_from_po':
      return 'Carried from the purchase order · not printed on this document'
    /**
     * A hand-entered value that kept NO literal was not printed at all — it is
     * a provider row, a restaurant row, a number somebody typed. Saying "as
     * printed: not kept" there implies the page carried it and we lost the
     * glyphs, which is a claim about the document nobody made.
     */
    case 'human_entered':
      return asPrinted == null
        ? 'From your own records in Mudavym · not printed on this document'
        : `Entered by hand · ${printed}`
    case 'human_corrected':
      return `Corrected by hand · ${printed}`
    case 'computed':
      return 'Computed by us · not printed on this document'
    default:
      return `Source recorded as "${source}" · ${printed}`
  }
}

/** Human names for the document types that get their own sections. */
export const DOC_TYPE_LABELS: Record<string, string> = {
  invoice: 'Invoice',
  credit_memo: 'Credit memo',
  delivery_note: 'Delivery note',
  packing_slip: 'Packing slip',
  delivery_receipt: 'Delivery receipt',
  receiving_advice: 'Door count',
  purchase_order: 'Purchase order',
  statement: 'Statement',
  price_list: 'Price list',
  portal_export: 'Portal export',
  informal_note: 'Informal note',
  unknown: 'Document',
}

/** Human names for the role a document plays ON a delivery. */
export const ROLE_LABELS: Record<string, string> = {
  purchase_order: 'Ordered',
  despatch_advice: 'Despatched',
  door_count: 'Counted at the door',
  invoice: 'Billed',
  credit_memo: 'Credited',
  statement: 'Statement',
  other: 'Other',
}

/** ADR 0103 D1 — the ladder the spine walks. */
export const STATE_LADDER = [
  'DELIVERED',
  'RECONCILING',
  'AGREED',
  'VERIFIED',
] as const

/**
 * Money is suppressed on a document that carries none, and on the door.
 *
 * ADR 0104 D2: the money block is EMPTY on a delivery note, because a despatch
 * advice prints no prices — showing a zero there would invent an amount.
 * D11: the door view suppresses money BY ROLE, not by breakpoint.
 */
export function showsMoney(docType: string): boolean {
  return docType !== 'delivery_note' && docType !== 'receiving_advice'
}

/** ADR 0104 D2 — the claim block belongs to a credit memo. */
export function showsClaimBlock(docType: string): boolean {
  return docType === 'credit_memo'
}

/**
 * A date AND a time, in the document's own convention — for the correction log.
 *
 * ADR 0104 D5's example sentence is "Corrected by Ayşe 14.08 09:40": a Turkish
 * document says `14.08 09:40`, a Californian one `Aug 14, 09:40`. The Turkish
 * form is written out for the same reason `fmtDate` writes it out — a shape that
 * changes with the runtime's ICU data is not a transcription of anything.
 *
 * The time is rendered in the READER's zone, deliberately: "when did Ayşe
 * change this" is a question about the person at the keyboard, not about the
 * document's jurisdiction.
 */
export function fmtStamp(
  iso: string | null | undefined,
  jurisdiction?: string | null,
  currency?: string | null,
): string {
  if (!iso) return EM
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return EM
  const p = (n: number) => String(n).padStart(2, '0')
  const clock = `${p(d.getHours())}:${p(d.getMinutes())}`
  const turkish = jurisdiction === 'TR' || (jurisdiction !== 'US-CA' && currency === 'TRY')
  if (turkish) return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${clock}`
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${clock}`
}

/**
 * "Corrected by Ayşe 14.08 09:40, was “142,00”" — ADR 0104 D5's own sentence.
 *
 * WHAT `was` SHOWS. The envelope's `as_printed` when the paper carried one, and
 * otherwise the value we had concluded. The two are labelled differently on
 * purpose: "was as printed “142,00”" is a statement about the document, "was
 * 142" is a statement about our reading of it, and a screen that renders them
 * identically turns the provenance trail into a second copy of our own answer.
 *
 * A NAME WE DO NOT HOLD IS "someone", never a user id. A uuid on this line
 * tells a manager nothing and looks like a defect.
 */
export function correctionSentence(
  entry: {
    kind: 'correction' | 'verification'
    correctedByName: string | null
    correctedAt: string
    before: { value?: unknown; as_printed?: string | null } | null
  },
  jurisdiction?: string | null,
  currency?: string | null,
): string {
  const who = entry.correctedByName ?? 'someone'
  const when = fmtStamp(entry.correctedAt, jurisdiction, currency)
  if (entry.kind === 'verification') return `Verified by ${who} ${when}`
  const printed = entry.before?.as_printed
  if (printed != null) return `Corrected by ${who} ${when}, was as printed “${printed}”`
  const had = entry.before?.value
  if (had === null || had === undefined)
    return `Corrected by ${who} ${when}, and nothing was there before`
  return `Corrected by ${who} ${when}, was “${String(had)}”`
}

/**
 * Read ONE envelope out of layer 1 by its path. Read-only, and only for display.
 *
 * The gateway owns the closed list of what may be CORRECTED
 * (`correctable-paths.ts`); this exists so the correction dialog can show what
 * the field says now. It walks only the three shapes layer 1 has — a header
 * field, a `seller.x` / `buyer.x` / `totals.x` field, and `lines[n].field` — and
 * returns null for anything else. It never writes, so there is no path here on
 * which `__proto__` reaches an assignment.
 */
export function envelopeAt(
  layer1: unknown,
  path: string,
): { value?: unknown; as_printed?: string | null } | null {
  const root = layer1 as Record<string, unknown> | null
  if (!root) return null
  const line = /^lines\[(\d+)\]\.([A-Za-z]+)$/.exec(path)
  if (line) {
    const rows = root.lines as Record<string, unknown>[] | undefined
    const row = rows?.[Number(line[1])]
    return (row?.[line[2]] as { value?: unknown } | undefined) ?? null
  }
  const nested = /^([A-Za-z]+)\.([A-Za-z]+)$/.exec(path)
  if (nested) {
    if (!['seller', 'buyer', 'totals'].includes(nested[1])) return null
    const group = root[nested[1]] as Record<string, unknown> | undefined
    return (group?.[nested[2]] as { value?: unknown } | undefined) ?? null
  }
  if (!/^[A-Za-z]+$/.test(path)) return null
  return (root[path] as { value?: unknown } | undefined) ?? null
}
