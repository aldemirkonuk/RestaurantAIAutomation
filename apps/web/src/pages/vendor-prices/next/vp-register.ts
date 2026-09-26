/**
 * The register, shaped for direction A's ladder (ADR 0160 §112) — pure joins
 * and sentences over what the gateway returned. Nothing here ranks or
 * normalises a price: `vendor-price-consensus.ts` already did that, and
 * `normalizedUnitPrice` / `isOutlier` on each row are its verdicts, taken as
 * given (see `VendorComparisonService.compare()`).
 */

import type { ComparisonClass, VendorObservationRow } from '../../../services/api/vendorIntel'
import { ageWords, dateWords, isSourceType, money, packWords, SOURCE_META, sourceLabel } from './vp-format'

/* ── grouping by class — a consensus never crosses one (fork 1) ─────────── */

export interface ClassGroup {
  cls: ComparisonClass
  /** Admitted rows first (ascending by normalised price, nulls last), then
   * struck rows, oldest verdict first. Never re-sorted by the client on a
   * different key — the engine's ranking is the ranking. */
  rows: VendorObservationRow[]
  /** More than one means this class's figures cannot be compared across the
   * group — nothing here converts currencies. */
  currencies: string[]
}

/**
 * Admitted rows ascending by normalised price (nulls last), then struck rows,
 * in whatever order they arrived — the engine's own ranking, never re-derived.
 * Factored out so a currency LANE (below) is ranked exactly the same way a
 * whole class used to be, instead of drifting into a second rule.
 */
function rankRows(rows: VendorObservationRow[]): VendorObservationRow[] {
  const admitted = rows
    .filter((r) => !r.isOutlier)
    .sort((a, b) => {
      const an = a.normalizedUnitPrice
      const bn = b.normalizedUnitPrice
      if (an === null && bn === null) return 0
      if (an === null) return 1
      if (bn === null) return -1
      return an - bn
    })
  const struck = rows.filter((r) => r.isOutlier)
  return [...admitted, ...struck]
}

export function groupByClass(observations: VendorObservationRow[]): ClassGroup[] {
  const byClass = new Map<ComparisonClass, VendorObservationRow[]>()
  for (const o of observations) {
    const bucket = byClass.get(o.comparisonClass)
    if (bucket) bucket.push(o)
    else byClass.set(o.comparisonClass, [o])
  }
  return [...byClass.entries()].map(([cls, rows]) => {
    const currencies = [...new Set(rows.map((r) => r.currency))].sort()
    return { cls, rows: rankRows(rows), currencies }
  })
}

export interface CurrencyLane {
  currency: string
  /** Ranked within this ONE currency alone — never against another currency's
   * numbers, which `rankRows` on the pooled class used to do (ADR 0160 §112,
   * fork 1/2: a TRY rung and a USD rung are not one ascending order). */
  rows: VendorObservationRow[]
}

/**
 * A class split into its currency lanes — direction A's ladder drawn the way
 * fork 2(c) asks for a mixed class: "one ladder per currency." The class-level
 * `currencies` list travels with each lane so the caller can tell a
 * single-currency class (the server's `consensusByClass` figure applies) from
 * a mixed one (no figure the server returned can be trusted for any one
 * lane — it was pooled across currencies before this page existed).
 */
export function laneGroups(observations: VendorObservationRow[]): Array<{
  cls: ComparisonClass
  currencies: string[]
  lanes: CurrencyLane[]
}> {
  return groupByClass(observations).map(({ cls, rows, currencies }) => {
    const byCurrency = new Map<string, VendorObservationRow[]>()
    for (const r of rows) {
      const bucket = byCurrency.get(r.currency)
      if (bucket) bucket.push(r)
      else byCurrency.set(r.currency, [r])
    }
    const lanes = [...byCurrency.keys()]
      .sort()
      .map((currency) => ({ currency, rows: rankRows(byCurrency.get(currency)!) }))
    return { cls, currencies, lanes }
  })
}

/** True order for the page: this house's own paper and quotes first, then
 * the open market, then anything the page has no name for. */
export function classSortKey(cls: ComparisonClass): number {
  if (cls === 'quoted') return 0
  if (cls === 'public_site') return 1
  return 2
}

/* ── the landed / agreed badge — free, from the own-paper source_ref ────── */

export type PaperBadge = 'landed' | 'agreed' | null

/**
 * `own-paper-sighting.ts` writes `receipt_verified:<orderId>` for a verified
 * receipt (landed) and `order_confirmed:<orderId>` for a confirmed order
 * (agreed) — direction B's badge grafted onto direction A for free, since
 * the prefix is already on the wire. A hand-recorded row carries no
 * `sourceRef`, which is the honest "No paper attached" signal, not a bug to
 * paper over.
 */
export function paperBadge(sourceRef: string | null): PaperBadge {
  if (!sourceRef) return null
  if (sourceRef.startsWith('receipt_verified:')) return 'landed'
  if (sourceRef.startsWith('order_confirmed:')) return 'agreed'
  return null
}

/** The order id an own-paper row names, for a future line-level document
 * link — part of ADR 0160 §112 fork 6(a)'s full provenance, which the
 * founder put in the FIRST build, not a later step. Not built here; see
 * `vendor-prices.md` for the open founder question, which is on sequencing
 * only. */
export function orderIdOf(sourceRef: string | null): string | null {
  if (!sourceRef) return null
  const m = /^(?:receipt_verified|order_confirmed):(.+)$/.exec(sourceRef)
  return m ? m[1] : null
}

/* ── the sighting sheet's provenance sentence ────────────────────────────── */

export interface Provenance {
  eyebrow: string
  what: string
  /** The paper this row can point to, or null with `unlinked` saying why —
   * "No paper attached" for a hand-recorded row is the honest state, not a
   * broken link (ADR 0160 §112). */
  paper: PaperBadge
  /** The order id an own-paper row names (fork 6b: "the order and its
   * receipt"). Opens `/receiving/:orderId/door`, the one real route that
   * already carries an order through to its verified receipt. */
  orderId: string | null
  /** A link someone else attached to this sighting — a public listing, a
   * recorded quote's URL. Independent of `orderId`: a row can carry one,
   * both, or neither. */
  sourceUrl: string | null
  /** Set only when NEITHER `orderId` nor `sourceUrl` is present — "a figure
   * opens to its sources" (CLAUDE.md), so this is never printed over a link
   * the row actually has. */
  unlinked: string | null
  asQuoted: string
  when: string
  verdict: string
  identityWords: string
  /** Who this row names, for a row where `what` does not already say so —
   * always populated when the row has a vendor, never invented when it does
   * not (review finding: a quote, a rep message, a told-to-us row or a
   * public-page row never named who, ADR 0160 §112). */
  vendor: string
  /** The note recorded with this sighting, or null when none was. */
  note: string | null
}

export function provenanceOf(row: VendorObservationRow): Provenance {
  const meta = isSourceType(row.sourceType) ? SOURCE_META[row.sourceType] : null
  const tier = row.trustTier ?? meta?.tier ?? null
  const eyebrow = `${sourceLabel(row.sourceType)}${tier !== null ? ` · tier ${tier}` : ''}`
  const vendor = row.vendorName ?? 'a vendor the row does not name'
  const badge = paperBadge(row.sourceRef)
  const orderId = orderIdOf(row.sourceRef)

  // The generic per-source sentence (`SOURCE_META`) never named who —
  // review finding: "the sighting sheet never names the vendor for quote,
  // rep-message, told-to-us or public rows." Own-paper's two sentences
  // above already name the vendor inline; every other kind gets it said
  // plainly, right after the source's own sentence, rather than folded into
  // wording that has to carry every source type at once.
  const genericWhat = meta?.sentence
    ? `${meta.sentence} ${row.vendorName ? `From ${row.vendorName}.` : 'The row does not name who.'}`
    : `A row with a source this page has no words for (${row.sourceType}). Shown, not folded into another kind. ${row.vendorName ? `From ${row.vendorName}.` : 'The row does not name who.'}`
  const what =
    badge === 'landed'
      ? `A line on a receipt from ${vendor} that this house verified. Mirrored into the register the moment it was checked; nobody typed it.`
      : badge === 'agreed'
        ? `A line on an order to ${vendor} that the vendor confirmed. Mirrored at confirmation — an agreed price, not yet a landed one.`
        : genericWhat

  const asQuoted = `${money(row.rawPrice, row.currency)} for ${packWords(row.packSize, row.unitVolumeMl)}`
  const when = `seen ${ageWords(row.observedAt)} (${dateWords(row.observedAt)})`

  const verdict = row.outlierReason
    ? `${row.isOutlier ? 'Set aside' : 'Admitted'} — ${row.outlierReason}`
    : 'No judge has looked at this row. That is not the same as judged clean.'

  const identityWords = row.identityId
    ? row.identityLabel
      ? `Names bottle identity “${row.identityLabel}”.`
      : `Names bottle identity ${row.identityId} (no label recorded).`
    : 'Unidentified — no confirmed bottle identity names this row yet (ADR 0124). It is ranked by name and vintage alone, so a 375 ml and a 750 ml of one wine could share a rung.'

  const hasLink = orderId !== null || !!row.sourceUrl
  return {
    eyebrow,
    what,
    paper: badge,
    orderId,
    sourceUrl: row.sourceUrl,
    // "Nothing to open" only when there is truly nothing — a public-page
    // sighting or a recorded quote can carry a `sourceUrl` with no own-paper
    // `sourceRef` at all, and that link is exactly what this row has to open.
    unlinked: hasLink
      ? null
      : badge === null && row.sourceRef
        ? `The row carries a reference this page does not parse as a paper link: ${row.sourceRef}.`
        : 'No paper attached. This row has nothing to open.',
    asQuoted,
    when,
    verdict,
    identityWords,
    vendor,
    note: row.note,
  }
}
