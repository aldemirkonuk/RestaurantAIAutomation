/**
 * VendorPricesNext — the Mudavym redesign of `/vendor-prices` (ADR 0160
 * §112: direction A, "the ladder", with C's chart and paper trail grafted).
 *
 * The founder, on this page specifically: "this has to be the most technical
 * area … this is gonna be a quant type of thing … very well built and very
 * organized and tidy looking so that people can understand what they're
 * looking at" — and "I also like the ladder look since I can see everything
 * … I also like the comparison between our house and the public pages."
 *
 * What this build carries from the sketch (ADR 0160 §112 "Owed"):
 *  - the ladder never hides a rung the house has (every admitted AND struck
 *    row is drawn, grouped and ranked exactly as the engine judged it);
 *  - a consensus never crosses a comparison class OR a currency — a mixed
 *    class draws one ladder lane per currency with its figures suppressed,
 *    never a blend (`laneGroups`, fork 1 and fork 2);
 *  - every price opens to its source document or conversation on demand,
 *    never pre-fetched (`SightingSheet`, `useSightingIdentity`);
 *  - the house's own paper is badged landed/agreed for free, and links to
 *    the order and its receipt (`paperBadge`/`orderIdOf`, fork 6b);
 *  - currency is required with no default on a hand-typed price (fork 2,
 *    C's option (a) — not A's own (c), a founder question; see the fix note);
 *  - C's strip chart, client-side over data already loaded (`PriceHistoryChart`);
 *  - the house-versus-public comparison, drawn in one row above the ladder;
 *  - a masthead standing line and a below-average box before a bottle is
 *    picked, built from the identity/price-index/sweep status endpoints;
 *  - the house-wide identity log as a drawer, reachable from the page
 *    (ADR 0144 §3: "a drawer opened from a row", never a co-equal tab), and
 *    still readable by staff when the ladder itself refuses them.
 *
 * What it does NOT carry — named rather than silently dropped (CLAUDE.md
 * §0.5): the seal's "lowest quote before terms" (needs `vendor-terms`), C's
 * full page-turn popover with per-mark counts and cross-checked totals, and
 * fork 6(a)'s full provenance (document, message, person) — the founder put
 * this in the FIRST build, not a later step, and none of it is built: the
 * `document_id` + line-reference migration, both writer changes, the
 * attach-a-paper upload, and the conversation message-and-person link
 * (additionally blocked on a different lane's
 * `GET /conversations/by-order/:orderId` tenant-scope gap). Only the ORDER
 * this lands in — before or after this page's own flag ever flips on — is
 * an open founder question; see `vendor-prices.md`.
 */

import { useId, useMemo, useState, type KeyboardEvent } from 'react'
import { Wordmark } from '@/components/mudavym'
import { Sheet } from '../../../components/mudavym/Sheet'
import { useAuth } from '../../../contexts/AuthContext'
import type { VendorObservationRow } from '../../../services/api/vendorIntel'
import { apiErrorMessage, apiErrorStatus, comparisonClassLabel } from '../../../services/api/vendorIntel'
import { ink } from '../../../lib/mudavym/motion'
import {
  EM,
  MONO,
  SANS,
  SERIF,
  ageWords,
  confidenceHeadline,
  confidenceSentence,
  countWords,
  money,
  packWords,
  sourceLabel,
  trendWords,
  wineLabel,
} from './vp-format'
import { classSortKey, laneGroups, paperBadge } from './vp-register'
import { PriceHistoryChart } from './PriceHistoryChart'
import { RecordPriceForm } from './RecordPriceForm'
import { SightingSheet } from './SightingSheet'
import IdentityDecisionLog from '../../IdentityDecisionLog'
import {
  useBelowAverage,
  useHouseIdentityCandidates,
  useCompare,
  useDebounced,
  useMastheadStatus,
  useSelectedProduct,
  useSelectedWine,
  useWineSearch,
  type ProductRef,
} from './useVendorPricesNextData'

/**
 * The wine picker — an ARIA combobox, not a div that only a mouse can use.
 * Measured before this pass: Tab moved focus to a result button, and one
 * second later `onBlur`'s 150ms timeout had already hidden the list under it,
 * landing focus on `<body>`; Enter on the input did nothing, and there were
 * no arrow keys. This rebuild keeps the list open on a genuine blur only
 * (`onBlur` checks `relatedTarget` against the picker's own root) and adds
 * the combobox role, an active-descendant and Up/Down/Enter/Escape.
 */
function WinePicker({ onPick }: { onPick: (wineId: string) => void }) {
  const [query, setQuery] = useState('')
  const debounced = useDebounced(query)
  const { results, isLoading } = useWineSearch(debounced)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const listboxId = useId()
  const rootId = useId()

  const showList = open && debounced.trim().length >= 2
  const activeId = activeIndex >= 0 && results[activeIndex] ? `${listboxId}-opt-${results[activeIndex].id}` : undefined

  const pick = (id: string) => {
    onPick(id)
    setQuery('')
    setOpen(false)
    setActiveIndex(-1)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!showList || results.length === 0) {
      if (e.key === 'Escape') setOpen(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && results[activeIndex]) {
        e.preventDefault()
        pick(results[activeIndex].id)
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
      setActiveIndex(-1)
    }
  }

  return (
    <div
      id={rootId}
      style={{ position: 'relative', maxWidth: 420 }}
      onBlur={(e) => {
        // A genuine blur — focus left the whole picker, not merely moved from
        // the input to one of its own result buttons.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setOpen(false)
          setActiveIndex(-1)
        }
      }}
    >
      <input
        role="combobox"
        aria-expanded={showList}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-label="Search the wine library"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          setActiveIndex(-1)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search the wine library, 750ml and up…"
        style={{
          width: '100%',
          fontFamily: SANS,
          fontSize: 13.5,
          padding: '9px 12px',
          borderRadius: 10,
          border: '1px solid var(--paper-2, #EAE4D8)',
          background: 'var(--paper-0, #FFFDF8)',
          color: 'var(--ink-1, #211C16)',
        }}
      />
      {showList && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Wine search results"
          style={{
            listStyle: 'none',
            margin: 0,
            position: 'absolute',
            zIndex: 20,
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            maxHeight: 320,
            overflowY: 'auto',
            borderRadius: 10,
            border: '1px solid var(--paper-2, #EAE4D8)',
            background: 'var(--paper-0, #FFFDF8)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
            padding: 0,
          }}
        >
          {isLoading && (
            <li role="presentation" style={{ padding: '10px 12px', fontFamily: SANS, fontSize: 12, color: 'var(--ink-4, #665D50)' }}>
              Searching…
            </li>
          )}
          {!isLoading && results.length === 0 && (
            <li role="presentation" style={{ padding: '10px 12px', fontFamily: SANS, fontSize: 12, color: 'var(--ink-4, #665D50)' }}>
              No wine in the library matches "{debounced}".
            </li>
          )}
          {results.map((w, i) => (
            <li
              key={w.id}
              id={`${listboxId}-opt-${w.id}`}
              role="option"
              aria-selected={i === activeIndex}
            >
              <button
                type="button"
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => pick(w.id)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 12px',
                  border: 'none',
                  borderBottom: '1px solid var(--paper-1, #F3EFE6)',
                  background: i === activeIndex ? 'var(--paper-1, #F3EFE6)' : 'transparent',
                  cursor: 'pointer',
                  fontFamily: SANS,
                  fontSize: 12.5,
                  color: 'var(--ink-1, #211C16)',
                }}
              >
                {w.displayName ?? wineLabel(w)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ConsensusCard({
  label,
  consensus,
  trends,
  currency,
}: {
  label: string
  consensus: {
    consensusPrice: number | null
    bestPrice: number | null
    bestVendorName: string | null
    admittedCount: number
    outlierCount: number
    confidence: number
    sourceBreakdown: Record<string, number>
    notes: string[]
  }
  trends: Array<{ windowDays: number; pctChange: number | null; note: string; currentCount: number }>
  currency: string
}) {
  return (
    <div
      style={{
        border: '1px solid var(--paper-2, #EAE4D8)',
        borderRadius: 12,
        padding: '12px 14px',
        background: 'var(--paper-1, #F3EFE6)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minWidth: 220,
        flex: '1 1 260px',
      }}
    >
      <span style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--seal-deep, #14515C)' }}>
        {label}
      </span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 600, color: 'var(--ink-1, #211C16)' }}>
          {money(consensus.consensusPrice, currency)}
        </span>
        <span style={{ fontFamily: SANS, fontSize: 11, color: 'var(--ink-4, #665D50)' }}>consensus /750ml</span>
      </div>
      <span style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-2, #4F473C)' }}>
        Lowest admitted: {money(consensus.bestPrice, currency)}
        {consensus.bestVendorName ? ` — ${consensus.bestVendorName}` : ''}
      </span>
      <span style={{ fontFamily: SANS, fontSize: 11, color: 'var(--ink-4, #665D50)' }}>
        {countWords(consensus.admittedCount, 'admitted sighting')} · {consensus.outlierCount} set aside
      </span>
      <span style={{ fontFamily: SANS, fontSize: 11, color: 'var(--ink-4, #665D50)' }}>
        Confidence {confidenceHeadline(consensus.confidence)}
      </span>
      <div style={{ display: 'flex', gap: 6 }}>
        {trends.map((t) => (
          <div
            key={t.windowDays}
            role="group"
            aria-label={`${t.windowDays} day trend: ${trendWords(t.pctChange, t.currentCount)}. ${t.note}`}
            style={{
              flex: 1,
              padding: '4px 6px',
              borderRadius: 6,
              background: 'var(--paper-0, #FFFDF8)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontFamily: MONO, fontSize: 8.5, color: 'var(--ink-4, #665D50)' }}>{t.windowDays}d</div>
            <div style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 600, color: 'var(--ink-1, #211C16)' }}>
              {trendWords(t.pctChange, t.currentCount)}
            </div>
          </div>
        ))}
      </div>
      {/* Unconditional (review finding: the confidence formula sat exposed
          on the card at all times) — the parameters live here now, behind
          the disclosure the founder's own honesty rule already asks for
          (ADR 0113: never a bare percent, but the working is not the
          headline either), never printed unless someone asks. */}
      <details style={{ fontFamily: SANS, fontSize: 10.5, color: 'var(--ink-4, #665D50)' }}>
        <summary style={{ cursor: 'pointer' }}>How this was calculated</summary>
        <p style={{ margin: '4px 0 0' }}>{confidenceSentence(consensus.confidence, consensus.sourceBreakdown)}</p>
        {consensus.notes.length > 0 && (
          <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
            {consensus.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
      </details>
    </div>
  )
}

/** Below ~600px the table's fixed columns cannot fit — measured overflow at
 * 390px was 511px of scrollWidth against a 390px viewport, with the "Open"
 * affordance itself off-screen. Below that width each rung becomes a card
 * (`data-label` + `::before`, the standard responsive-table technique) so
 * every field — including Open — stays on screen with no horizontal scroll. */
const LADDER_CSS = `
.vp-ladder-wrap { overflow-x: auto; }
@media (max-width: 599px) {
  .vp-ladder-wrap { overflow-x: visible; }
  .vp-ladder table, .vp-ladder thead, .vp-ladder tbody, .vp-ladder tr, .vp-ladder th, .vp-ladder td { display: block; width: 100%; }
  .vp-ladder thead { position: absolute; left: -9999px; }
  .vp-ladder tr { border: 1px solid var(--paper-2, #EAE4D8); border-radius: 10px; padding: 8px 10px; margin-bottom: 8px; }
  .vp-ladder td { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 3px 0; border: none !important; text-align: right; }
  .vp-ladder td::before { content: attr(data-label); font-family: ${SANS}; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--ink-4, #665D50); text-align: left; }
}
`

function LadderTable({ rows, windowDays, onOpen }: { rows: VendorObservationRow[]; windowDays: number; onOpen: (row: VendorObservationRow) => void }) {
  return (
    <div className="vp-ladder-wrap vp-ladder">
      <p style={{ fontFamily: SANS, fontSize: 10.5, color: 'var(--ink-4, #665D50)', margin: '0 0 4px' }}>
        Last {windowDays} days only — an older rung is dropped, not hidden.
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: SANS, fontSize: 12 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--ink-4, #665D50)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            <th style={{ padding: '4px 8px' }}>Vendor</th>
            <th style={{ padding: '4px 8px' }}>Source</th>
            <th style={{ padding: '4px 8px' }}>As quoted</th>
            <th style={{ padding: '4px 8px', fontFamily: MONO }}>/ 750ml</th>
            <th style={{ padding: '4px 8px' }}>Seen</th>
            <th style={{ padding: '4px 8px' }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const badge = paperBadge(r.sourceRef)
            return (
              <tr
                key={r.id}
                style={{
                  borderTop: '1px solid var(--paper-2, #EAE4D8)',
                  opacity: r.isOutlier ? 0.55 : 1,
                  textDecoration: r.isOutlier ? 'line-through' : 'none',
                  transition: `background ${ink.ms}ms ${ink.easing}`,
                }}
              >
                <td data-label="Vendor" style={{ padding: '6px 8px', color: 'var(--ink-1, #211C16)' }}>{r.vendorName ?? EM}</td>
                <td data-label="Source" style={{ padding: '6px 8px' }}>
                  <span style={{ fontFamily: MONO, fontSize: 10.5 }}>
                    {sourceLabel(r.sourceType)}
                    {r.trustTier !== null ? ` · t${r.trustTier}` : ''}
                  </span>
                  {badge && (
                    <span
                      style={{
                        marginLeft: 6,
                        fontFamily: MONO,
                        fontSize: 9,
                        padding: '1px 5px',
                        borderRadius: 4,
                        background: 'var(--seal-tint, rgba(26,94,107,.1))',
                        color: 'var(--seal-deep, #14515C)',
                      }}
                    >
                      {badge}
                    </span>
                  )}
                </td>
                <td data-label="As quoted" style={{ padding: '6px 8px', fontFamily: MONO }}>
                  {money(r.rawPrice, r.currency)} <span style={{ color: 'var(--ink-4, #665D50)' }}>{packWords(r.packSize, r.unitVolumeMl)}</span>
                </td>
                <td data-label="/ 750ml" style={{ padding: '6px 8px', fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
                  {r.normalizedUnitPrice === null ? EM : money(r.normalizedUnitPrice, r.currency)}
                </td>
                <td data-label="Seen" style={{ padding: '6px 8px', color: 'var(--ink-4, #665D50)' }}>{ageWords(r.observedAt)}</td>
                <td data-label="Open" style={{ padding: '6px 8px', textAlign: 'right' }}>
                  <button
                    type="button"
                    onClick={() => onOpen(r)}
                    aria-label={`Open the sighting from ${r.vendorName ?? 'an unnamed vendor'}, ${money(r.rawPrice, r.currency)}`}
                    style={{
                      fontFamily: SANS,
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '3px 9px',
                      borderRadius: 6,
                      border: '1px solid var(--paper-2, #EAE4D8)',
                      background: 'transparent',
                      color: 'var(--seal-deep, #14515C)',
                      cursor: 'pointer',
                    }}
                  >
                    Open
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** The founder's own comparison — "our house and the public pages" — drawn
 * in one row above the ladder, not two stacked sections each with its own
 * table (review finding: the comparison "is not visible at a glance"). Only
 * drawn when both sides are single-currency (a mixed side has no figure to
 * put in the row, and a suppressed note already explains why below). */
type Side = { consensus: ConsensusInput; currency: string; trends: TrendInput[] } | 'mixed' | null

function HouseVsPublicRow({ quoted, publicSite }: { quoted: Side; publicSite: Side }) {
  if (quoted === null && publicSite === null) return null
  const quotedCard = quoted && quoted !== 'mixed' ? quoted : null
  const publicCard = publicSite && publicSite !== 'mixed' ? publicSite : null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
      {quotedCard ? (
        <ConsensusCard label="Quoted to this house" consensus={quotedCard.consensus} trends={quotedCard.trends} currency={quotedCard.currency} />
      ) : (
        <EmptySide label="Quoted to this house" mixed={quoted === 'mixed'} />
      )}
      {publicCard ? (
        <ConsensusCard label="Public vendor site (tier 4)" consensus={publicCard.consensus} trends={publicCard.trends} currency={publicCard.currency} />
      ) : (
        <EmptySide label="Public vendor site (tier 4)" mixed={publicSite === 'mixed'} />
      )}
      {quotedCard && publicCard && quotedCard.currency === publicCard.currency && quotedCard.consensus.consensusPrice !== null && publicCard.consensus.consensusPrice !== null && (
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 6px', fontFamily: SANS, fontSize: 12, color: 'var(--ink-2, #4F473C)' }}>
          Gap: {money(Math.abs(quotedCard.consensus.consensusPrice - publicCard.consensus.consensusPrice), quotedCard.currency)}
        </div>
      )}
    </div>
  )
}

function EmptySide({ label, mixed }: { label: string; mixed: boolean }) {
  return (
    <div
      style={{
        border: '1px dashed var(--paper-2, #EAE4D8)',
        borderRadius: 12,
        padding: '12px 14px',
        color: 'var(--ink-4, #665D50)',
        fontFamily: SANS,
        fontSize: 11.5,
        minWidth: 220,
        flex: '1 1 260px',
      }}
    >
      <div style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      {mixed ? 'Mixed currencies — no single figure; see the ladders below.' : 'No sighting in this class yet.'}
    </div>
  )
}

interface ConsensusInput {
  consensusPrice: number | null
  bestPrice: number | null
  bestVendorName: string | null
  admittedCount: number
  outlierCount: number
  confidence: number
  sourceBreakdown: Record<string, number>
  notes: string[]
}

interface TrendInput {
  windowDays: number
  pctChange: number | null
  note: string
  currentCount: number
}

/** The refusal a staff session gets from `compare` (owner/manager only) —
 * kept, with the server's own words, and no "Try again": a 403 will answer
 * the same way every time. Staff keep the house-wide identity log and the
 * waiting queue the legacy page rendered for them (review finding, major). */
function StaffRefusal({ message }: { message: string }) {
  const candidates = useHouseIdentityCandidates()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div role="alert" style={{ border: '1px solid var(--paper-2, #EAE4D8)', background: 'var(--paper-1, #F3EFE6)', borderRadius: 10, padding: '12px 14px' }}>
        <p style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-2, #4F473C)', margin: 0 }}>
          Vendor prices are owner and manager only on this house. {message}
        </p>
      </div>
      {candidates.data && candidates.data.items.length > 0 && (
        <div>
          <div style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ink-4, #665D50)', marginBottom: 6 }}>
            Waiting for a person ({candidates.data.items.length})
          </div>
          <p style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-2, #4F473C)' }}>
            Bottles proposed as the same identity, not yet confirmed or rejected. Deciding one needs an
            owner or manager account on this house — the log below shows what has already been decided,
            not a place to decide from here.
          </p>
        </div>
      )}
      <IdentityDecisionLog />
    </div>
  )
}

function ComparisonPanel({ productRef, wineId }: { productRef: ProductRef; wineId: string | null }) {
  // Named `productRef`, never `ref`: React reserves the `ref` prop name for
  // its own forwarding and silently drops it from a plain function
  // component's props — a real bug this rename exists to avoid, not a style
  // choice.
  const { data, isLoading, isError, error, refetch, isFetching } = useCompare(productRef)
  const { data: wine } = useSelectedWine(productRef)
  const [openRow, setOpenRow] = useState<VendorObservationRow | null>(null)
  const [recordOpen, setRecordOpen] = useState(false)

  const buckets = useMemo(() => (data ? laneGroups(data.observations).sort((a, b) => classSortKey(a.cls) - classSortKey(b.cls)) : []), [data])

  if (isLoading) {
    return <p style={{ fontFamily: SANS, fontSize: 13, color: 'var(--ink-4, #665D50)' }}>Reading the register…</p>
  }

  if (isError) {
    const status = apiErrorStatus(error)
    if (status === 403) {
      return <StaffRefusal message={apiErrorMessage(error, 'This account is not an owner or manager.')} />
    }
    return (
      <div
        role="alert"
        style={{ border: '1px solid var(--paper-2, #EAE4D8)', background: 'var(--paper-1, #F3EFE6)', borderRadius: 10, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}
      >
        <span style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-2, #4F473C)' }}>
          The register could not be read ({apiErrorMessage(error, 'unknown error')}). This is unknown, not empty.
        </span>
        <button type="button" onClick={() => refetch()} style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 8, border: '1px solid var(--seal-ring, rgba(26,94,107,.32))', background: 'transparent', color: 'var(--seal-deep, #14515C)', cursor: 'pointer' }}>
          Try again
        </button>
      </div>
    )
  }

  if (!data) return null

  const productName = data.productName ?? (wine ? wineLabel(wine) : null)
  const quotedBucket = buckets.find((b) => b.cls === 'quoted')
  const publicBucket = buckets.find((b) => b.cls === 'public_site')
  const quotedSide: Side = !quotedBucket
    ? null
    : quotedBucket.currencies.length > 1
      ? 'mixed'
      : data.consensusByClass.quoted
        ? { consensus: data.consensusByClass.quoted, currency: quotedBucket.currencies[0], trends: data.trendsByClass.quoted ?? [] }
        : null
  const publicSide: Side = !publicBucket
    ? null
    : publicBucket.currencies.length > 1
      ? 'mixed'
      : data.consensusByClass.public_site
        ? { consensus: data.consensusByClass.public_site, currency: publicBucket.currencies[0], trends: data.trendsByClass.public_site ?? [] }
        : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <h2 style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 600, margin: 0, color: 'var(--ink-1, #211C16)' }}>
          {productName ?? 'Product not named on the row'}
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {isFetching && <span style={{ fontFamily: SANS, fontSize: 11, color: 'var(--ink-4, #665D50)' }}>Refreshing…</span>}
          {wineId && (
            <button
              type="button"
              onClick={() => setRecordOpen(true)}
              style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 600, padding: '7px 14px', borderRadius: 9, border: 'none', background: 'var(--seal, #1A5E6B)', color: '#fff', cursor: 'pointer' }}
            >
              Add a price you were quoted
            </button>
          )}
        </div>
      </div>

      {!data.complete && (
        <p style={{ fontFamily: SANS, fontSize: 11, color: 'var(--ink-4, #665D50)', margin: 0 }}>
          The read stopped at the gateway's cap — the counts and figures below are a floor, not a total.
        </p>
      )}

      <HouseVsPublicRow quoted={quotedSide} publicSite={publicSide} />

      {buckets.length === 0 && (
        <p style={{ fontFamily: SANS, fontSize: 13, color: 'var(--ink-4, #665D50)' }}>
          No usable price observations for this bottle yet. Add one below, or wait for the next sighting.
        </p>
      )}

      {buckets.map((b) => {
        const mixed = b.currencies.length > 1
        // `quoted`/`public_site`, single-currency, already carry the label on
        // their `ConsensusCard` in `HouseVsPublicRow` above — a second,
        // identical label here would be a duplicate on the page, not a second
        // fact. Anything else (a mixed class, or a class the founder's two
        // named classes do not cover) still needs its own heading.
        const labelledAbove = !mixed && (b.cls === 'quoted' || b.cls === 'public_site')
        return (
          <section key={b.cls} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {!labelledAbove && (
              <div style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4, #665D50)' }}>
                {comparisonClassLabel(b.cls)}
              </div>
            )}
            {mixed && (
              <p style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-4, #665D50)', margin: 0 }}>
                {b.currencies.length} currencies in this class ({b.currencies.join(', ')}) — no figure, chip or "lowest" name crosses them. One ladder per currency below.
              </p>
            )}
            {b.lanes.map((lane) => (
              <div key={lane.currency} style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
                {mixed && (
                  <div style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 600, color: 'var(--ink-2, #4F473C)', minWidth: 44 }}>{lane.currency}</div>
                )}
                <div style={{ flex: 1, minWidth: 280 }}>
                  <PriceHistoryChart rows={lane.rows} currency={lane.currency} onOpen={setOpenRow} />
                  <LadderTable rows={lane.rows} windowDays={data.windowDays} onOpen={setOpenRow} />
                </div>
              </div>
            ))}
          </section>
        )
      })}

      {openRow && (
        <SightingSheet
          row={openRow}
          productName={productName}
          productRef={productRef}
          onClose={() => setOpenRow(null)}
        />
      )}

      {wineId && <RecordPriceForm open={recordOpen} onClose={() => setRecordOpen(false)} wineId={wineId} productName={productName} />}
    </div>
  )
}

/** The masthead standing line — what the identity register, the price index
 * and (owner only) the two sweeps hold, so the page is not just a title, a
 * search box and one sentence before a bottle is picked. */
function MastheadStatus({ role }: { role: 'owner' | 'manager' | 'staff' | null }) {
  const { identity, priceIndex, siteSweep, shopSweep } = useMastheadStatus(role)
  if (role !== 'owner' && role !== 'manager') return null

  const line = (label: string, node: React.ReactNode) => (
    <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
      <span style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-4, #665D50)' }}>{label}</span>
      <span style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-2, #4F473C)' }}>{node}</span>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, padding: '8px 0', borderTop: '1px solid var(--paper-2, #EAE4D8)', borderBottom: '1px solid var(--paper-2, #EAE4D8)' }}>
      {line(
        'Identity register',
        identity.isError
          ? `could not be read (${apiErrorMessage(identity.error, 'unknown error')})`
          : identity.data
            ? `${identity.data.identities ?? EM} confirmed identities, ${identity.data.candidates?.pending ?? EM} waiting for a person`
            : 'reading…',
      )}
      {line(
        'Price index',
        priceIndex.isError
          ? `could not be read (${apiErrorMessage(priceIndex.error, 'unknown error')})`
          : priceIndex.data
            ? `${priceIndex.data.sources.filter((s) => s.rows > 0).length} of ${priceIndex.data.sources.length} sources holding rows${priceIndex.data.armed ? '' : ' — not yet checking automatically'}`
            : 'reading…',
      )}
      {role === 'owner' ? (
        <>
          {line(
            'Site sweep',
            siteSweep.isError
              ? `could not be read (${apiErrorMessage(siteSweep.error, 'unknown error')})`
              : siteSweep.data
                ? `${siteSweep.data.activeCount} of ${siteSweep.data.totalCount} vendors writing rows${siteSweep.data.armed ? '' : ' — not yet checking automatically'}, counted since this server last restarted`
                : 'reading…',
          )}
          {line(
            'Shop sweep',
            shopSweep.isError
              ? `could not be read (${apiErrorMessage(shopSweep.error, 'unknown error')})`
              : shopSweep.data
                ? `${shopSweep.data.activeCount} of ${shopSweep.data.totalCount} shops writing rows${shopSweep.data.armed ? '' : ' — not yet checking automatically'}, counted since this server last restarted`
                : 'reading…',
          )}
        </>
      ) : (
        line('Site & shop sweep', 'owner only')
      )}
    </div>
  )
}

/** "Newest below the earlier mean" — the cross-product news box, built from
 * the endpoint of the same name (T-not-named in the review: the page before
 * a bottle is picked "is nearly empty" though the endpoint already exists). */
function BelowAverageBox({ role, onPick }: { role: 'owner' | 'manager' | 'staff' | null; onPick: (wineId: string) => void }) {
  const q = useBelowAverage(role)
  if (role !== 'owner' && role !== 'manager') return null
  if (q.isLoading) return null
  if (q.isError) {
    return (
      <p style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-4, #665D50)' }}>
        Newest below the earlier mean: could not be read ({apiErrorMessage(q.error, 'unknown error')}).
      </p>
    )
  }
  if (!q.data || q.data.items.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4, #665D50)' }}>
        Newest below the earlier mean — {q.data.window.days} day window, {countWords(q.data.scanned.observations, 'sighting')} scanned
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
        {q.data.items.map((it) => (
          <li key={`${it.productKey}:${it.sourceClass}`}>
            <button
              type="button"
              onClick={() => {
                const m = /^wine:(.+)$/.exec(it.productKey)
                if (m) onPick(m[1])
              }}
              disabled={!it.productKey.startsWith('wine:')}
              style={{
                display: 'flex',
                width: '100%',
                justifyContent: 'space-between',
                gap: 10,
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid var(--paper-2, #EAE4D8)',
                background: 'transparent',
                fontFamily: SANS,
                fontSize: 12,
                textAlign: 'left',
                cursor: it.productKey.startsWith('wine:') ? 'pointer' : 'default',
                color: 'var(--ink-1, #211C16)',
              }}
            >
              <span>{it.productName ?? 'Product not named on the row'}</span>
              <span style={{ fontFamily: MONO, color: 'var(--ink-2, #4F473C)' }}>
                {money(it.latest.unitPrice, it.currency)} vs mean {money(it.average.unitPrice, it.currency)} ({countWords(it.average.observations, 'earlier sighting')})
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function VendorPricesNext() {
  const { activeRole } = useAuth()
  const [ref, setWineId] = useSelectedProduct()
  const [logOpen, setLogOpen] = useState(false)

  return (
    <div className="mudavym min-h-screen" style={{ background: 'var(--paper-0, #FFFDF8)', color: 'var(--ink-1, #211C16)' }}>
      <style>{`
        @media (prefers-reduced-motion: reduce) { .mudavym * { transition: none !important; animation: none !important } }
        ${LADDER_CSS}
      `}</style>
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <Wordmark size={13} />
            <h1 style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 600, letterSpacing: '-0.015em', lineHeight: 1.1, margin: '4px 0 0', color: 'var(--ink-1, #211C16)' }}>
              Vendor prices
            </h1>
            <p style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-4, #665D50)', margin: '4px 0 0', maxWidth: 520 }}>
              The wine library, per bottle. Pick one to see every vendor's price beside it, with the source and the
              paper behind each figure — never pooled across your own paper and the public register.
            </p>
          </div>
          {(activeRole === 'owner' || activeRole === 'manager') && (
            <button
              type="button"
              onClick={() => setLogOpen(true)}
              style={{ fontFamily: SANS, fontSize: 12, fontWeight: 600, padding: '7px 12px', borderRadius: 8, border: '1px solid var(--paper-2, #EAE4D8)', background: 'transparent', color: 'var(--seal-deep, #14515C)', cursor: 'pointer' }}
            >
              Identity log
            </button>
          )}
        </header>

        <WinePicker onPick={setWineId} />

        {ref?.kind === 'identity' ? (
          <p style={{ fontFamily: SANS, fontSize: 13, color: 'var(--ink-4, #665D50)' }}>
            This link names a bottle by its confirmed identity, which this register cannot search by yet.
            Pick the bottle from the search box above.
          </p>
        ) : ref ? (
          <ComparisonPanel key={`${ref.kind}:${ref.id}`} productRef={ref} wineId={ref.kind === 'wine' ? ref.id : null} />
        ) : (
          <>
            <MastheadStatus role={activeRole} />
            <BelowAverageBox role={activeRole} onPick={setWineId} />
            <p style={{ fontFamily: SANS, fontSize: 13, color: 'var(--ink-4, #665D50)' }}>
              Search for a bottle above to open its price register.
            </p>
          </>
        )}
      </div>

      {logOpen && (
        <Sheet open onClose={() => setLogOpen(false)} label="House identity decision log" eyebrow="Bottle identity" title="Identity log" wide>
          <div className="px-4 py-4">
            <IdentityDecisionLog />
          </div>
        </Sheet>
      )}
    </div>
  )
}
