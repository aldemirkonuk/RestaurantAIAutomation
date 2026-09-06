/**
 * CanonicalSheet — Direction A's typeset sheet, the selected frame (ADR 0104
 * D13). ONE component with CONDITIONAL SECTIONS, never one template per
 * document type (D2): the same field means the same thing on a credit memo and
 * on an invoice, so what changes is which blocks render, not which file runs.
 *
 * WHAT EACH SECTION IS CONDITIONAL ON
 *   header      always. EN 16931 order: parties, references, dates.
 *   lines       always, with the four-way spine — ordered · shipped · received ·
 *               billed. `received` prints the WORDS "not counted" when the door
 *               counted nothing (ADR 0103 A6).
 *   price base  a sub-line under the unit price, only when BT-149/BT-150 were
 *               PRINTED. `1 ks × 12 şişe` is the difference between ₺142 and
 *               ₺1.704 and nothing else on the page can show it.
 *   money       ABSENT on a delivery note and on a door count — a despatch
 *               advice prints no prices, and a zero there would invent one.
 *   claim       only on a credit memo (D2).
 *
 * The sheet stays LIGHT in dark mode (D9): it carries `data-ground="paper"`, and
 * `mudavym.css` gives that the light token column even under `.dark`.
 */

import { useMemo } from 'react'
import type {
  CanonicalDocument,
  CorrectionLogEntry,
  FieldEnvelope,
} from '../../services/api/canonical'
import { ProvenanceHover } from './ProvenanceHover'
import {
  DOC_TYPE_LABELS,
  EM,
  MONO,
  SERIF,
  fmtDate,
  fmtMoney,
  fmtQty,
  fmtReceived,
  showsClaimBlock,
  showsMoney,
} from './canonical-format'

const KICK: React.CSSProperties = {
  display: 'block',
  fontFamily: MONO,
  fontSize: 8,
  fontWeight: 600,
  letterSpacing: '.15em',
  textTransform: 'uppercase',
  color: 'var(--ink-3, #8E8576)',
}

const TH: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 8,
  fontWeight: 600,
  letterSpacing: '.09em',
  color: 'var(--ink-4, #665D50)',
  padding: '2px 4px',
  borderBottom: '1.5px solid var(--ink-1, #211C16)',
  textAlign: 'left',
  whiteSpace: 'nowrap',
}

const TD: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 10.5,
  padding: '2px 4px',
  borderBottom: '1px solid rgba(33,28,22,.10)',
  textAlign: 'right',
}

/**
 * A value with its provenance, or the em dash when the document did not say.
 *
 * `correct` carries the correction wiring for this one field. A field with no
 * `path` offers no correction affordance — the gateway holds the closed list of
 * what may be corrected (ADR 0104 D5), and a button that leads to a 400 is
 * worse than no button.
 */
function Field<T>({
  label,
  envelope,
  render,
  footnote,
  path,
  correct,
}: {
  label: string
  envelope: FieldEnvelope<T>
  render?: (v: T) => string
  footnote?: number
  path?: string
  correct?: CorrectionWiring
}) {
  const text =
    envelope.value == null
      ? EM
      : render
        ? render(envelope.value)
        : String(envelope.value)
  return (
    <div>
      <span style={KICK}>{label}</span>
      <span style={{ fontFamily: MONO, fontSize: 11.5 }}>
        {/* A field the document did not state is STILL correctable: "the
            extraction read nothing here and the paper says 14.08" is exactly
            the correction an empty field needs. Without a path it stays the
            plain em dash it was. */}
        {envelope.value == null && !path ? (
          text
        ) : (
          <ProvenanceHover
            label={label}
            envelope={envelope}
            footnote={footnote}
            path={path}
            {...(path ? correct?.(path) : {})}
          >
            {text}
          </ProvenanceHover>
        )}
      </span>
    </div>
  )
}

/**
 * Everything one field needs to show and offer its correction history.
 *
 * A FUNCTION, not a bag of props, so each of the sheet's ~20 provenance sites
 * asks for its own path and gets back the log for that path alone. Passing the
 * whole log to every field and filtering inside would make the popover on line 1
 * re-render whenever line 40 was corrected — and, worse, would put the wrong
 * field's history one indexing mistake away from being printed.
 */
export type CorrectionWiring = (path: string) => {
  log: CorrectionLogEntry[]
  onCorrect?: (path: string, label: string) => void
  onVerify?: (path: string, label: string) => void
  jurisdiction?: string | null
  currency?: string | null
}

export interface CanonicalSheetProps {
  doc: CanonicalDocument
  /** Called when a line is clicked, so the original pane can follow it. */
  onSelectLine?: (lineIndex: number) => void
  selectedLine?: number | null
  /**
   * ADR 0104 D5. `null` means the correction log could not be READ — the sheet
   * then offers no correction affordance and says so, rather than inviting a
   * correction on top of a history it cannot see. `[]` means nobody has
   * corrected anything, which is a different sentence.
   */
  corrections?: CorrectionLogEntry[] | null
  onCorrect?: (path: string, label: string) => void
  onVerify?: (path: string, label: string) => void
}

export function CanonicalSheet({
  doc,
  onSelectLine,
  selectedLine,
  corrections,
  onCorrect,
  onVerify,
}: CanonicalSheetProps) {
  const l1 = doc.layer1
  const currency = l1.currency.value

  /**
   * path -> its corrections, newest first. Built once per render.
   *
   * `corrections === null` means the LOG READ FAILED, and the sheet then hands
   * out no correction handlers at all: inviting someone to correct a field
   * whose history we could not read would let the same field be "corrected"
   * twice by two people who each believed they were the first.
   */
  const byPath = useMemo(() => {
    const m = new Map<string, CorrectionLogEntry[]>()
    for (const c of corrections ?? []) {
      const list = m.get(c.path)
      if (list) list.push(c)
      else m.set(c.path, [c])
    }
    return m
  }, [corrections])

  const wiring: CorrectionWiring = (path) => ({
    log: byPath.get(path) ?? [],
    ...(corrections !== null && onCorrect ? { onCorrect } : {}),
    ...(corrections !== null && onVerify ? { onVerify } : {}),
    jurisdiction: doc.jurisdiction,
    currency,
  })
  /**
   * NOTHING WAS READ. Caught on screen 2026-09-04 against three real
   * documents: with zero lines the totals block still printed
   * `Lines $0.00` — a computed sum of nothing, wearing a currency symbol the
   * intake had defaulted to USD on a Turkish invoice. Two fabrications in one
   * row. So an unread document renders its header and stops; the NOT EXTRACTED
   * notice above it is the whole story, and there is no empty table pretending
   * to be a complete one.
   */
  const nothingRead = l1.lines.length === 0
  const money = showsMoney(doc.docType) && !nothingRead
  const juris = doc.jurisdiction

  const adjudicated = new Map(doc.layer3.lines.map((l) => [l.lineIndex, l]))

  /**
   * THE LADDER NEVER CONTRADICTS THE LIST ABOVE IT.
   *
   * "Charges —" printed directly beneath a listed "Freight + $45.00" and a
   * "Deposit + $3.60" (on screen, 2026-09-04) is the document disagreeing with
   * itself in two adjacent rows. `from-parsed-document` now fills BT-107/BT-108
   * so a mapped document cannot reach here with a hole; this fallback covers
   * every OTHER source — a stored revision, a future EDI or signed-XML path —
   * and marks what it added up so a summed figure is never mistaken for a
   * printed one.
   */
  const fill = (
    env: FieldEnvelope<number>,
    isCharge: boolean,
  ): { envelope: FieldEnvelope<number>; summed: boolean } => {
    if (env.value != null) return { envelope: env, summed: false }
    const rows = l1.allowancesCharges.filter((ac) => ac.isCharge.value === isCharge)
    if (rows.length === 0) return { envelope: env, summed: false }
    const sum = rows.reduce((a, ac) => a + (ac.amount.value ?? 0), 0)
    return {
      envelope: { ...env, value: Math.round(sum * 100) / 100, source: 'computed' },
      summed: true,
    }
  }

  /**
   * `path` is present only on the totals a HUMAN may correct.
   *
   * Charges, Allowances and Before tax are computed — BT-107 and BT-108 are the
   * sums of the groups above them and BT-109 is BT-106 − BT-107 + BT-108
   * (BR-CO-13). A correction to one of those would be overwritten by the next
   * read, so the gateway refuses them and the sheet offers no handle.
   */
  const ladder: {
    label: string
    envelope: FieldEnvelope<number>
    summed: boolean
    path?: string
  }[] = [
    {
      label: 'Lines',
      envelope: l1.totals.linesNetTotal,
      summed: false,
      path: 'totals.linesNetTotal',
    },
    { label: 'Charges', ...fill(l1.totals.chargesTotal, true) },
    { label: 'Allowances', ...fill(l1.totals.allowancesTotal, false) },
    { label: 'Before tax', envelope: l1.totals.taxExclusiveAmount, summed: false },
    {
      label: 'Tax',
      envelope: l1.totals.taxAmount,
      summed: false,
      path: 'totals.taxAmount',
    },
  ]

  return (
    <article
      className="mudavym cd-sheet"
      data-ground="paper"
      data-doc-type={doc.docType}
      aria-label={`${DOC_TYPE_LABELS[doc.docType] ?? 'Document'} ${l1.documentNumber.value ?? ''}`}
      style={{
        background: 'var(--paper-0, #FFFDF8)',
        color: 'var(--ink-1, #211C16)',
        border: '1px solid var(--paper-2, #EAE4D8)',
        borderRadius: 12,
        padding: '14px 18px',
      }}
    >
      {/* ── header: what this document is ─────────────────────────────── */}
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={KICK}>{DOC_TYPE_LABELS[doc.docType] ?? doc.docType}</span>
          <h1
            style={{
              margin: 0,
              fontFamily: SERIF,
              fontSize: 17,
              fontWeight: 600,
              letterSpacing: '-.012em',
            }}
          >
            {l1.seller.name.value ?? 'The seller is not named on this document'}
          </h1>
          <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600 }}>
            {l1.documentNumber.value ?? EM}
          </span>
        </div>
        {doc.direction === 'issued_by_us' && (
          <span
            data-testid="direction-ours"
            style={{ fontFamily: MONO, fontSize: 9, color: 'var(--seal-deep, #14515C)' }}
          >
            ISSUED BY US — the reverse of a vendor document
          </span>
        )}
      </header>

      {/* ── parties and references (EN 16931 order) ───────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '6px 16px',
          padding: '8px 0',
          margin: '6px 0 0',
          borderTop: '1px solid rgba(33,28,22,.11)',
          borderBottom: '1px solid rgba(33,28,22,.11)',
        }}
      >
        <div>
          <span style={KICK}>Seller</span>
          {/* WITH ITS PROVENANCE. The name can now come from a resolved
              provider row rather than off the page, and those are different
              facts: the hover says which, so a name the document never printed
              never wears the paper's authority (ADR 0104 D1). */}
          <span style={{ fontSize: 11.5, fontWeight: 600 }}>
            {l1.seller.name.value ? (
              <ProvenanceHover
                label="Seller"
                envelope={l1.seller.name}
                path="seller.name"
                {...wiring('seller.name')}
              >
                {l1.seller.name.value}
              </ProvenanceHover>
            ) : (
              EM
            )}
          </span>
          <span style={{ display: 'block', fontFamily: MONO, fontSize: 9.5 }}>
            {l1.seller.vatIdentifier.value ? (
              <ProvenanceHover
                label="Seller VAT id"
                envelope={l1.seller.vatIdentifier}
                path="seller.vatIdentifier"
                {...wiring('seller.vatIdentifier')}
              >
                {l1.seller.vatIdentifier.value}
              </ProvenanceHover>
            ) : (
              EM
            )}
          </span>
        </div>
        <div>
          <span style={KICK}>Buyer</span>
          <span style={{ fontSize: 11.5, fontWeight: 600 }}>
            {l1.buyer.name.value ?? EM}
          </span>
          <span style={{ display: 'block', fontFamily: MONO, fontSize: 9.5 }}>
            {l1.buyer.vatIdentifier.value ?? EM}
          </span>
        </div>
        {/* Dates in the DOCUMENT's convention. `juris` is NULL on most rows,
            so the currency is the second witness: a TRY invoice is a Turkish
            document whatever the jurisdiction column says. */}
        <Field
          label="Issued"
          envelope={l1.issueDate}
          render={(v) => fmtDate(String(v), juris, currency)}
          path="issueDate"
          correct={wiring}
        />
        <Field
          label="Delivered"
          envelope={l1.actualDeliveryDate}
          render={(v) => fmtDate(String(v), juris, currency)}
          path="actualDeliveryDate"
          correct={wiring}
        />
        <Field
          label="Due"
          envelope={l1.paymentDueDate}
          render={(v) => fmtDate(String(v), juris, currency)}
          path="paymentDueDate"
          correct={wiring}
        />
        <Field
          label="Order reference"
          envelope={l1.purchaseOrderReference}
          path="purchaseOrderReference"
          correct={wiring}
        />
        <Field
          label="Despatch reference"
          envelope={l1.despatchAdviceReference}
          path="despatchAdviceReference"
          correct={wiring}
        />
        {showsClaimBlock(doc.docType) && (
          <Field
            label="Credits invoice"
            envelope={l1.precedingInvoiceReference}
            path="precedingInvoiceReference"
            correct={wiring}
          />
        )}
      </div>

      {nothingRead && (
        <p
          data-testid="nothing-read-note"
          style={{ marginTop: 10, fontSize: 11, color: 'var(--ink-2, #4F473C)' }}
        >
          No lines were read from this document, so there is no line table and
          no totals below. An empty table with a zero in it would be a claim
          about the paper that nobody made.
        </p>
      )}

      {/* ── the four-way line table ───────────────────────────────────── */}
      {!nothingRead && (
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
        {/*
          `display: table-caption`, spelled out, because KICK sets
          `display: block`.

          A caption whose display is `block` stops being a caption: CSS wraps it
          in an anonymous table cell, it lands in the first column — 22px wide,
          the `#` column — and the sentence wraps one word per line. That is
          exactly how it rendered on 2026-09-04. The override has to come AFTER
          the spread, and it has to be the caption's own display rather than a
          wrapper, so the row still spans every column at any width.
        */}
        <caption
          data-testid="line-table-caption"
          style={{
            ...KICK,
            display: 'table-caption',
            textAlign: 'left',
            paddingBottom: 2,
          }}
        >
          {l1.lines.length} {l1.lines.length === 1 ? 'line' : 'lines'} · each
          quantity column comes from a different document
        </caption>
        <thead>
          <tr>
            <th scope="col" style={{ ...TH, width: 22 }}>
              #
            </th>
            <th scope="col" style={TH}>
              Item
            </th>
            <th scope="col" style={{ ...TH, textAlign: 'right' }}>
              Ordered
            </th>
            <th scope="col" style={{ ...TH, textAlign: 'right' }}>
              Shipped
            </th>
            <th scope="col" style={{ ...TH, textAlign: 'right' }}>
              Received
            </th>
            <th scope="col" style={{ ...TH, textAlign: 'right' }}>
              Billed
            </th>
            <th scope="col" style={{ ...TH, textAlign: 'right' }}>
              Unit
            </th>
            {money && (
              <th scope="col" style={{ ...TH, textAlign: 'right' }}>
                Line
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {l1.lines.map((line, i) => {
            const adj = adjudicated.get(i)
            const base = line.priceBaseQuantity
            // Printed, not assumed: the sub-line appears only when the paper
            // actually stated a basis (`as_printed` kept) or the basis differs
            // from one invoiced unit.
            const basePrinted =
              base.as_printed != null ||
              (base.value != null && base.value !== 1)
            return (
              <tr
                key={i}
                data-testid="sheet-line"
                data-selected={selectedLine === i ? 'true' : 'false'}
                onClick={() => onSelectLine?.(i)}
                style={{
                  cursor: onSelectLine ? 'pointer' : 'default',
                  background:
                    adj && adj.verdict !== 'ok' ? 'rgba(148,102,26,.07)' : undefined,
                }}
              >
                <td style={{ ...TD, textAlign: 'left', color: 'var(--ink-3, #ABA294)' }}>
                  {i + 1}
                </td>
                <td style={{ ...TD, fontFamily: 'inherit', textAlign: 'left', fontSize: 11.5 }}>
                  {line.description.as_printed != null ? (
                    <ProvenanceHover
                      label={`Item, line ${i + 1}`}
                      envelope={line.description}
                      path={`lines[${i}].description`}
                      {...wiring(`lines[${i}].description`)}
                    >
                      {line.description.value ?? EM}
                    </ProvenanceHover>
                  ) : (
                    (line.description.value ?? EM)
                  )}
                  {line.vintage.value != null && (
                    <span style={{ color: 'var(--ink-3, #7C7365)' }}> · {line.vintage.value}</span>
                  )}
                </td>
                <td style={TD}>{fmtQty(adj?.ordered ?? null, currency)}</td>
                <td style={TD}>{fmtQty(adj?.shipped ?? null, currency)}</td>
                <td
                  style={{
                    ...TD,
                    fontFamily:
                      adj?.received === 'not_counted' ? 'inherit' : MONO,
                    fontSize: adj?.received === 'not_counted' ? 10 : 10.5,
                    color:
                      adj?.received === 'not_counted'
                        ? 'var(--ink-3, #7C7365)'
                        : undefined,
                  }}
                  data-testid="received-cell"
                >
                  {fmtReceived(adj?.received ?? null, currency)}
                </td>
                {/* BILLED is the bottle-equivalent of BT-129, so the field a
                    person corrects here is the INVOICED QUANTITY the paper
                    printed — not the converted number. The hover carries the
                    quantity's own envelope for exactly that reason. */}
                <td style={TD}>
                  <ProvenanceHover
                    label={`Quantity, line ${i + 1}`}
                    envelope={line.quantity}
                    path={`lines[${i}].quantity`}
                    {...wiring(`lines[${i}].quantity`)}
                  >
                    {fmtQty(adj?.billed ?? null, currency)}
                  </ProvenanceHover>
                </td>
                <td style={TD}>
                  {money ? (
                    <>
                      <ProvenanceHover
                        label={`Unit price, line ${i + 1}`}
                        envelope={line.netPrice}
                        path={`lines[${i}].netPrice`}
                        {...wiring(`lines[${i}].netPrice`)}
                      >
                        {fmtMoney(line.netPrice.value, currency)}
                      </ProvenanceHover>
                      {basePrinted && (
                        <span
                          data-testid="price-base"
                          style={{
                            display: 'block',
                            fontSize: 8,
                            color: 'var(--ink-3, #7C7365)',
                          }}
                        >
                          per {fmtQty(base.value, currency)}{' '}
                          {line.priceBaseUnit.value ?? line.unit.value ?? ''}
                        </span>
                      )}
                    </>
                  ) : (
                    <span style={{ color: 'var(--ink-3, #7C7365)' }}>{line.unit.value ?? EM}</span>
                  )}
                </td>
                {money && (
                  <td style={TD}>
                    <ProvenanceHover
                      label={`Line total, line ${i + 1}`}
                      envelope={line.netAmount}
                      path={`lines[${i}].netAmount`}
                      {...wiring(`lines[${i}].netAmount`)}
                    >
                      {fmtMoney(line.netAmount.value, currency)}
                    </ProvenanceHover>
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      )}

      {/* ── allowances, charges, VAT, totals — money documents only ────── */}
      {money ? (
        <div
          data-testid="money-block"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
            gap: 16,
            marginTop: 10,
          }}
        >
          <div>
            <span style={KICK}>Allowances and charges</span>
            {l1.allowancesCharges.length === 0 ? (
              <p style={{ margin: 0, fontSize: 10.5, color: 'var(--ink-3, #7C7365)' }}>
                None on this document.
              </p>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {l1.allowancesCharges.map((ac, i) => (
                  <li
                    key={i}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 10.5,
                      borderBottom: '1px solid rgba(33,28,22,.08)',
                      padding: '1px 0',
                    }}
                  >
                    <span>
                      {/* The reason NAME, not only its code: a returnable
                          deposit and freight are different things to argue. */}
                      {ac.reason.value ?? 'reason not stated'}
                      {ac.reasonCode.value && (
                        <span style={{ color: 'var(--ink-3, #7C7365)' }}>
                          {' '}
                          · {ac.reasonCode.value}
                        </span>
                      )}
                    </span>
                    <span style={{ fontFamily: MONO }}>
                      {ac.isCharge.value === false ? '− ' : '+ '}
                      {fmtMoney(ac.amount.value, currency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <span style={{ ...KICK, marginTop: 6 }}>VAT breakdown</span>
            {l1.vatBreakdown.length === 0 ? (
              <p style={{ margin: 0, fontSize: 10.5, color: 'var(--ink-3, #7C7365)' }}>
                The document states no VAT breakdown.
              </p>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {l1.vatBreakdown.map((v, i) => (
                  <li
                    key={i}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 10.5,
                      padding: '1px 0',
                    }}
                  >
                    <span>
                      {v.category.value ?? 'category not stated'}
                      {v.rate.value != null ? ` ${v.rate.value}%` : ''}
                      <span style={{ color: 'var(--ink-3, #7C7365)' }}>
                        {' '}
                        · on {fmtMoney(v.taxableAmount.value, currency)}
                      </span>
                    </span>
                    <span style={{ fontFamily: MONO }}>{fmtMoney(v.taxAmount.value, currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <span style={KICK}>Totals</span>
            {ladder.map(({ label, envelope, summed, path }) => (
              <div
                key={label}
                data-testid={`total-${label.toLowerCase().replace(/\s+/g, '-')}`}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 10.5,
                  borderBottom: '1px solid rgba(33,28,22,.08)',
                  padding: '1px 0',
                }}
              >
                <span>
                  {label}
                  {/* A number WE added up says so. It is not the paper's, so it
                      gets no provenance hover claiming the paper printed it. */}
                  {summed && (
                    <span style={{ color: 'var(--ink-3, #7C7365)' }}>
                      {' '}
                      · summed from the {l1.allowancesCharges.length} above
                    </span>
                  )}
                </span>
                <span style={{ fontFamily: MONO }}>
                  {summed ? (
                    fmtMoney(envelope.value, currency)
                  ) : (
                    <ProvenanceHover
                      label={label}
                      envelope={envelope}
                      path={path}
                      {...(path ? wiring(path) : { log: [] })}
                    >
                      {fmtMoney(envelope.value, currency)}
                    </ProvenanceHover>
                  )}
                </span>
              </div>
            ))}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                paddingTop: 3,
              }}
            >
              <span style={{ fontFamily: SERIF, fontSize: 12, fontWeight: 600 }}>Total</span>
              <span style={{ fontFamily: MONO, fontSize: 17, fontWeight: 600 }}>
                <ProvenanceHover
                  label="Document total"
                  envelope={l1.totals.taxInclusiveAmount}
                  path="totals.taxInclusiveAmount"
                  {...wiring('totals.taxInclusiveAmount')}
                >
                  {fmtMoney(l1.totals.taxInclusiveAmount.value, currency)}
                </ProvenanceHover>
              </span>
            </div>
          </div>
        </div>
      ) : nothingRead ? null : (
        <p
          data-testid="no-money-note"
          style={{ marginTop: 10, fontSize: 10.5, color: 'var(--ink-3, #7C7365)' }}
        >
          No money on this document — a {DOC_TYPE_LABELS[doc.docType]?.toLowerCase() ?? 'document'}{' '}
          travels with the goods and prints no prices. The money block is empty,
          not zero.
        </p>
      )}

      {/* ── the claim block, on a credit memo only ─────────────────────── */}
      {showsClaimBlock(doc.docType) && (
        <section
          data-testid="claim-block"
          style={{
            marginTop: 10,
            borderTop: '1px solid rgba(33,28,22,.11)',
            paddingTop: 6,
          }}
        >
          <span style={KICK}>The claim this credits</span>
          <p style={{ margin: 0, fontSize: 11 }}>
            {l1.precedingInvoiceReference.value
              ? `Credits invoice ${l1.precedingInvoiceReference.value}.`
              : 'The document does not name the invoice it credits — that reference is BT-25 and it is missing.'}{' '}
            {doc.direction === 'issued_by_us'
              ? 'Issued by us — an iade faturası, the reverse of a vendor credit memo.'
              : 'Issued by the vendor.'}
          </p>
        </section>
      )}
    </article>
  )
}

export default CanonicalSheet
