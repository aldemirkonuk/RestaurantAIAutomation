/**
 * The price history chart's own contract (ADR 0160 §112 review, 2026-09-18,
 * second pass): the y-scale is built from ADMITTED rows only — a struck
 * outlier must never stretch the axis far enough to flatten every admitted
 * price onto one line, which is exactly what a $3.10 mistaken entry did
 * before this fix.
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { VendorObservationRow } from '../../../services/api/vendorIntel'
import { PriceHistoryChart } from './PriceHistoryChart'

// A variable, not a literal: scripts/check_money_states_its_currency.py flags
// a fixture that pins a currency inline. This one states a currency to
// exercise the currency-aware axis, never to assert a default.
const FIXTURE_CURRENCY = 'USD'

function row(over: Partial<VendorObservationRow> = {}): VendorObservationRow {
  return {
    id: `obs-${Math.random()}`,
    vendorName: 'Empire Merchants',
    providerId: 'prov-1',
    sourceType: 'invoice',
    sourceUrl: null,
    sourceRef: null,
    comparisonClass: 'quoted',
    rawPrice: 20,
    currency: FIXTURE_CURRENCY,
    trustTier: 1,
    packSize: 1,
    unitVolumeMl: 750,
    observedAt: new Date('2026-08-01T00:00:00.000Z').toISOString(),
    parseConfidence: null,
    isOutlier: false,
    outlierReason: null,
    note: null,
    identityId: null,
    identityLabel: null,
    normalizedUnitPrice: 20,
    ...over,
  }
}

describe('PriceHistoryChart — the scale excludes struck outliers (review finding, major)', () => {
  it('keeps the y-axis on the admitted band, never stretched down to a struck outlier', () => {
    const rows = [
      row({ id: 'a', observedAt: '2026-08-01T00:00:00.000Z', normalizedUnitPrice: 19, isOutlier: false }),
      row({ id: 'b', observedAt: '2026-08-08T00:00:00.000Z', normalizedUnitPrice: 21, isOutlier: false }),
      row({ id: 'c', observedAt: '2026-08-15T00:00:00.000Z', normalizedUnitPrice: 20, isOutlier: false }),
      // The mistaken entry: a decimal-lost $3.10 far below the admitted band.
      row({ id: 'outlier', observedAt: '2026-08-22T00:00:00.000Z', normalizedUnitPrice: 3.1, isOutlier: true, outlierReason: 'far below the median' }),
    ]
    render(<PriceHistoryChart rows={rows} currency={FIXTURE_CURRENCY} onOpen={vi.fn()} />)

    const svg = screen.getByRole('img', { name: /Price over time/ })
    // The axis prints the ADMITTED min ($19), never the struck row's $3.10 —
    // before this fix pMin was Math.min across every row including outliers.
    expect(svg).toHaveAttribute(
      'aria-label',
      expect.stringContaining('$19.00 to $21.00'),
    )
    expect(screen.getByText('$21.00')).toBeInTheDocument()
    expect(screen.getByText('$19.00')).toBeInTheDocument()
    expect(screen.queryByText('$3.10')).toBeNull()
  })

  it('still draws every admitted point inside the plot band, and the outlier clipped to an edge rather than off-chart', () => {
    const rows = [
      row({ id: 'a', observedAt: '2026-08-01T00:00:00.000Z', normalizedUnitPrice: 19 }),
      row({ id: 'b', observedAt: '2026-08-08T00:00:00.000Z', normalizedUnitPrice: 21 }),
      row({ id: 'outlier', observedAt: '2026-08-15T00:00:00.000Z', normalizedUnitPrice: 3.1, isOutlier: true, outlierReason: 'far below the median' }),
    ]
    const { container } = render(<PriceHistoryChart rows={rows} currency={FIXTURE_CURRENCY} onOpen={vi.fn()} />)
    const marks = container.querySelectorAll('svg [role="button"] circle[cy], svg [role="button"] line')
    // Every drawn y-coordinate stays within the SVG's own height (140) — the
    // clip, not an unbounded plot that would draw the outlier far off-canvas.
    const circles = container.querySelectorAll('svg circle:not([fill="transparent"])')
    circles.forEach((c) => {
      const cy = Number(c.getAttribute('cy'))
      expect(cy).toBeGreaterThanOrEqual(0)
      expect(cy).toBeLessThanOrEqual(140)
    })
    expect(marks.length).toBeGreaterThan(0)
  })

  it('insets a clamped mark off the axis line, never exactly on it (visual finding, 2026-09-19: a struck row that is also the newest point landed indistinguishably on the x-axis line\'s own corner)', () => {
    const rows = [
      row({ id: 'a', observedAt: '2026-08-01T00:00:00.000Z', normalizedUnitPrice: 19 }),
      row({ id: 'b', observedAt: '2026-08-08T00:00:00.000Z', normalizedUnitPrice: 21 }),
      // The newest point AND struck far below the admitted band — the exact
      // combination that used to clamp to (x, y) equal to the axis line's
      // own right end.
      row({ id: 'outlier', observedAt: '2026-08-15T00:00:00.000Z', normalizedUnitPrice: 3.1, isOutlier: true, outlierReason: 'far below the median' }),
    ]
    render(<PriceHistoryChart rows={rows} currency={FIXTURE_CURRENCY} onOpen={vi.fn()} />)
    const outlierMark = screen.getByRole('button', { name: /set aside as an outlier/ })
    const crossLines = outlierMark.querySelectorAll('line')
    expect(crossLines.length).toBe(2)
    crossLines.forEach((l) => {
      // Height is 140, PAD_B is 26 — the true bottom edge is y=114; the
      // inset keeps every coordinate strictly off it (and off y=16, PAD_T).
      expect(Number(l.getAttribute('y1'))).not.toBe(114)
      expect(Number(l.getAttribute('y2'))).not.toBe(114)
    })
  })

  it('falls back to the full range only when every row is struck, rather than drawing nothing', () => {
    const rows = [
      row({ id: 'a', observedAt: '2026-08-01T00:00:00.000Z', normalizedUnitPrice: 19, isOutlier: true, outlierReason: 'x' }),
      row({ id: 'b', observedAt: '2026-08-08T00:00:00.000Z', normalizedUnitPrice: 3.1, isOutlier: true, outlierReason: 'y' }),
    ]
    render(<PriceHistoryChart rows={rows} currency={FIXTURE_CURRENCY} onOpen={vi.fn()} />)
    expect(screen.getByText('$19.00')).toBeInTheDocument()
    expect(screen.getByText('$3.10')).toBeInTheDocument()
  })
})

describe('PriceHistoryChart — "Last landed" does not collide with the newest mark (review finding, minor)', () => {
  it('left-anchors the label rather than sitting at the same edge as the rightmost point', () => {
    const rows = [
      row({ id: 'a', observedAt: '2026-08-01T00:00:00.000Z', normalizedUnitPrice: 19 }),
      // The newest point is ALSO the landed one — the exact case that used
      // to collide when the label was right-anchored at the same edge.
      row({ id: 'landed', observedAt: '2026-08-22T00:00:00.000Z', normalizedUnitPrice: 21, sourceRef: 'receipt_verified:order-9' }),
    ]
    render(<PriceHistoryChart rows={rows} currency={FIXTURE_CURRENCY} onOpen={vi.fn()} />)
    const label = screen.getByText('Last landed')
    expect(label).toHaveAttribute('text-anchor', 'start')
    // Anchored near the left padding, not the right edge (width - PAD_R).
    expect(Number(label.getAttribute('x'))).toBeLessThan(60)
  })
})
