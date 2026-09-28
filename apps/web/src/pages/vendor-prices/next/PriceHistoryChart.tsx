/**
 * C's graft: a strip chart of one class's sightings against time — kept for
 * the founder's "I like the graph, graph is really good" (ADR 0160 §112).
 * Client-side over data the ladder already holds — no extra fetch, so this
 * costs nothing beyond what `useCompare` already loaded, honouring "do not
 * add this to the cache" for anything BEYOND the ladder's own read.
 *
 * Rebuilt after review (2026-09-18), which found the graft below the
 * founder's bar: no axes, no labelled last-landed rule, a polyline joining
 * DIFFERENT vendors' prices as one series, marks that could not be focused
 * or opened, and a mark's tooltip printing `rawPrice` while the mark plots
 * `normalizedUnitPrice`. This version draws a real y-axis (min/max price) and
 * x-axis (first/last date), only connects a line between two points from the
 * SAME vendor, makes every mark a focusable button that opens its sighting
 * sheet, and a "Full chart" toggle mounts a bigger view of the same
 * already-loaded rows — nothing is re-fetched or newly cached.
 *
 * Rebuilt AGAIN after a second review (2026-09-18): the y-scale used to
 * include struck outliers, so one $3.10 mistaken entry flattened every
 * admitted price onto one line; the SVG carried a fixed pixel `height`
 * alongside `viewBox`, which (default `preserveAspectRatio`) constrains the
 * drawing to its OWN aspect ratio and letterboxes it inside a wider column
 * instead of filling it — the "floats at about 640px" defect, and the same
 * fault made "Full chart" render its 880-unit drawing into whatever a 390px
 * panel actually measures, shrinking every label with it; and "Last landed"
 * was right-anchored at the same edge the newest mark usually sits, so the
 * two collided. Now: the scale is built from ADMITTED rows only and a
 * struck row is drawn at the nearest edge rather than expanding it; the SVG
 * is measured to its real container width and drawn at that exact size (no
 * viewBox/viewport mismatch to letterbox); "Last landed" sits at the LEFT,
 * where the axis labels already leave room.
 *
 * Deliberately not C's full page-turn popover with per-mark counts
 * cross-checked against the trail (C's stricter promise, costed as its own
 * build in the sketch's recommendation). This is the free part of the graft
 * — the shape of the points over time, openable — not the whole instrument.
 */

import { useEffect, useRef, useState } from 'react'
import { Panel } from '../../../components/mudavym/Sheet'
import type { VendorObservationRow } from '../../../services/api/vendorIntel'
import { dateWords, money, MONO, SANS } from './vp-format'
import { paperBadge } from './vp-register'

/**
 * The element's own rendered width, kept in sync via `ResizeObserver` — a
 * column that grows (sidebar collapse, a wider viewport) or shrinks (390px)
 * redraws the chart at its real size instead of a size guessed once. `min`
 * floors it so a briefly-zero measurement (display:none during a transition)
 * never asks the SVG to draw at 0.
 */
function useContainerWidth(fallback: number, min = 200) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w && w > 0) setWidth(Math.max(min, Math.round(w)))
    })
    ro.observe(el)
    if (el.clientWidth > 0) setWidth(Math.max(min, Math.round(el.clientWidth)))
    return () => ro.disconnect()
  }, [min])
  return [ref, width] as const
}

const PAD_L = 54
const PAD_R = 16
const PAD_T = 16
const PAD_B = 26

interface Point {
  r: VendorObservationRow
  t: number
}

/** Consecutive points sharing one vendor become one polyline segment; a
 * vendor change breaks the line rather than joining two different vendors'
 * prices as if they were one series (review finding, major). */
function vendorRuns(points: Point[]): Point[][] {
  const runs: Point[][] = []
  let current: Point[] = []
  let currentVendor: string | null = null
  for (const p of points) {
    if (p.r.isOutlier) {
      if (current.length) runs.push(current)
      current = []
      currentVendor = null
      continue
    }
    const vendor = p.r.providerId ?? p.r.vendorName ?? null
    if (vendor === null || vendor !== currentVendor) {
      if (current.length) runs.push(current)
      current = [p]
      currentVendor = vendor
    } else {
      current.push(p)
    }
  }
  if (current.length) runs.push(current)
  return runs
}

function ChartSvg({
  rows,
  currency,
  width,
  height,
  onOpen,
}: {
  rows: VendorObservationRow[]
  currency: string
  width: number
  height: number
  onOpen: (row: VendorObservationRow) => void
}) {
  const withTime: Point[] = rows
    .map((r) => ({ r, t: new Date(r.observedAt).getTime() }))
    .filter((x) => Number.isFinite(x.t) && x.r.normalizedUnitPrice !== null)
    .sort((a, b) => a.t - b.t)

  if (withTime.length < 2) {
    return (
      <p style={{ fontFamily: MONO, fontSize: 11, color: 'var(--ink-4, #665D50)', margin: '8px 0' }}>
        Not enough points to draw a line yet.
      </p>
    )
  }

  const tMin = withTime[0].t
  const tMax = withTime[withTime.length - 1].t
  // The scale comes from ADMITTED rows only (review finding, major): a
  // single struck outlier used to stretch the axis far enough that every
  // admitted price flattened onto one line. A struck row is still drawn —
  // clipped to the nearest edge below, never expanding the range.
  const admittedPrices = withTime.filter((x) => !x.r.isOutlier).map((x) => x.r.normalizedUnitPrice as number)
  const scalePrices = admittedPrices.length > 0 ? admittedPrices : withTime.map((x) => x.r.normalizedUnitPrice as number)
  const pMin = Math.min(...scalePrices)
  const pMax = Math.max(...scalePrices)
  const tSpan = Math.max(1, tMax - tMin)
  const pSpan = Math.max(0.01, pMax - pMin)

  const x = (t: number) => PAD_L + ((t - tMin) / tSpan) * (width - PAD_L - PAD_R)
  // Clamped: a struck row's real price can sit far outside [pMin, pMax] on
  // purpose (that is what makes it an outlier) — plotting it unclamped would
  // reopen the exact defect this rebuild fixes. `yClamped` is for drawing a
  // mark; the ladder and the sheet it opens still show the row's real price.
  const yUnclamped = (p: number) => height - PAD_B - ((p - pMin) / pSpan) * (height - PAD_T - PAD_B)
  // Inset 4px from the true edges (visual check, 2026-09-19): a struck row
  // that is ALSO the newest point clamps to the same (x, y) as the x-axis
  // line's own right end, and the two marks were indistinguishable at a
  // glance. The inset keeps every clamped mark visibly off the axis line
  // and the plot's own boundary, never exactly on top of either.
  const CLAMP_INSET = 4
  const y = (p: number) => Math.min(height - PAD_B - CLAMP_INSET, Math.max(PAD_T + CLAMP_INSET, yUnclamped(p)))

  const lastLanded = [...withTime].reverse().find((p) => paperBadge(p.r.sourceRef) === 'landed')

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      role="img"
      aria-label={`Price over time, ${withTime.length} points, ${money(pMin, currency)} to ${money(pMax, currency)} per 750ml, ${dateWords(withTime[0].r.observedAt)} to ${dateWords(withTime[withTime.length - 1].r.observedAt)}`}
    >
      {/* y-axis: the plotted range, in the row's own currency */}
      <line x1={PAD_L} x2={PAD_L} y1={PAD_T} y2={height - PAD_B} stroke="var(--paper-2, #EAE4D8)" strokeWidth={1} />
      <text x={PAD_L - 6} y={PAD_T + 4} textAnchor="end" fontFamily={MONO} fontSize={9} fill="var(--ink-4, #665D50)">
        {money(pMax, currency)}
      </text>
      <text x={PAD_L - 6} y={height - PAD_B} textAnchor="end" fontFamily={MONO} fontSize={9} fill="var(--ink-4, #665D50)">
        {money(pMin, currency)}
      </text>
      {/* x-axis: first and last date in the window drawn */}
      <line x1={PAD_L} x2={width - PAD_R} y1={height - PAD_B} y2={height - PAD_B} stroke="var(--paper-2, #EAE4D8)" strokeWidth={1} />
      <text x={PAD_L} y={height - 8} textAnchor="start" fontFamily={MONO} fontSize={9} fill="var(--ink-4, #665D50)">
        {dateWords(withTime[0].r.observedAt)}
      </text>
      <text x={width - PAD_R} y={height - 8} textAnchor="end" fontFamily={MONO} fontSize={9} fill="var(--ink-4, #665D50)">
        {dateWords(withTime[withTime.length - 1].r.observedAt)}
      </text>

      {lastLanded && lastLanded.r.normalizedUnitPrice !== null && (
        <>
          <line
            x1={PAD_L}
            x2={width - PAD_R}
            y1={y(lastLanded.r.normalizedUnitPrice)}
            y2={y(lastLanded.r.normalizedUnitPrice)}
            stroke="var(--seal-ring, rgba(26,94,107,.32))"
            strokeDasharray="3 3"
            strokeWidth={1}
          />
          {/* Left-anchored, not right (review finding, minor): the newest
              point is usually the rightmost one too, so a right-anchored
              label sat on top of its own mark. The y-axis labels already
              leave PAD_L clear of any mark. */}
          <text
            x={PAD_L + 4}
            y={Math.max(PAD_T + 8, y(lastLanded.r.normalizedUnitPrice) - 4)}
            textAnchor="start"
            fontFamily={SANS}
            fontSize={9}
            fill="var(--seal-deep, #14515C)"
          >
            Last landed
          </text>
        </>
      )}

      {vendorRuns(withTime).map((run, i) => (
        <polyline
          key={i}
          fill="none"
          stroke="var(--seal, #1A5E6B)"
          strokeWidth={1.25}
          opacity={0.55}
          points={run.map((p) => `${x(p.t)},${y(p.r.normalizedUnitPrice as number)}`).join(' ')}
        />
      ))}

      {withTime.map((p, i) => {
        const cx = x(p.t)
        const cy = y(p.r.normalizedUnitPrice as number)
        const badge = paperBadge(p.r.sourceRef)
        const label = `${money(p.r.normalizedUnitPrice, currency)} per 750ml — as quoted ${money(p.r.rawPrice, p.r.currency)} — ${p.r.vendorName ?? 'an unnamed vendor'} — ${dateWords(p.r.observedAt)}${p.r.isOutlier ? ' — set aside as an outlier' : ''}`
        const activate = () => onOpen(p.r)
        return (
          <g
            key={p.r.id ?? i}
            role="button"
            tabIndex={0}
            aria-label={label}
            onClick={activate}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                activate()
              }
            }}
            style={{ cursor: 'pointer', outlineOffset: 2 }}
          >
            {/* A larger, invisible hit area — a 2.75px mark is not a usable
                pointer or focus target on its own. */}
            <circle cx={cx} cy={cy} r={9} fill="transparent" />
            {p.r.isOutlier ? (
              <g stroke="var(--ink-3, #7C7365)" strokeWidth={1.25}>
                <line x1={cx - 3} y1={cy - 3} x2={cx + 3} y2={cy + 3} />
                <line x1={cx - 3} y1={cy + 3} x2={cx + 3} y2={cy - 3} />
              </g>
            ) : (
              <circle
                cx={cx}
                cy={cy}
                r={badge ? 3.5 : 2.75}
                fill={badge ? 'var(--seal, #1A5E6B)' : 'none'}
                stroke="var(--seal, #1A5E6B)"
                strokeWidth={1.25}
              />
            )}
          </g>
        )
      })}
    </svg>
  )
}

export function PriceHistoryChart({
  rows,
  currency,
  onOpen,
}: {
  rows: VendorObservationRow[]
  currency: string
  onOpen: (row: VendorObservationRow) => void
}) {
  const [full, setFull] = useState(false)
  const plottable = rows.filter((r) => r.normalizedUnitPrice !== null)
  const [inlineRef, inlineWidth] = useContainerWidth(320)
  const [fullRef, fullWidth] = useContainerWidth(880)

  return (
    <div style={{ marginBottom: 8 }}>
      <div ref={inlineRef} style={{ width: '100%' }}>
        <ChartSvg rows={rows} currency={currency} width={inlineWidth} height={140} onOpen={onOpen} />
      </div>
      {plottable.length >= 2 && (
        <button
          type="button"
          onClick={() => setFull(true)}
          style={{
            fontFamily: SANS,
            fontSize: 11,
            fontWeight: 600,
            padding: '3px 8px',
            marginTop: 4,
            borderRadius: 6,
            border: '1px solid var(--paper-2, #EAE4D8)',
            background: 'transparent',
            color: 'var(--seal-deep, #14515C)',
            cursor: 'pointer',
          }}
        >
          Full chart
        </button>
      )}
      {full && (
        <Panel open onClose={() => setFull(false)} label="Full price chart" eyebrow="Chart" title="Price over time" wide>
          <div className="px-4 py-4">
            <div ref={fullRef} style={{ width: '100%' }}>
              <ChartSvg rows={rows} currency={currency} width={fullWidth} height={320} onOpen={onOpen} />
            </div>
            <p style={{ fontFamily: SANS, fontSize: 11, color: 'var(--ink-4, #665D50)', marginTop: 8 }}>
              Every mark is a focusable button — Tab to it and press Enter, or click it, to open that sighting.
            </p>
          </div>
        </Panel>
      )}
    </div>
  )
}
