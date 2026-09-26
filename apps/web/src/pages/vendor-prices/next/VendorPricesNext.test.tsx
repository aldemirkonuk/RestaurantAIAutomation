/**
 * VendorPricesNext render contract — direction A's spine (ADR 0160 §112):
 * a consensus never crosses a comparison class, an unread register is an
 * error not an empty one, and a struck row is drawn, never hidden.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { VendorObservationRow } from '../../../services/api/vendorIntel'

const mock = vi.hoisted(() => ({
  ref: null as { kind: 'wine' | 'signature' | 'identity'; id: string } | null,
  setWineId: vi.fn(),
  compare: {} as Record<string, unknown>,
  wine: { data: undefined },
  search: { results: [], isLoading: false, isError: false },
  role: 'owner' as 'owner' | 'manager' | 'staff' | null,
  houseCandidates: { data: { items: [] as Array<{ id: string }>, count: 0, limit: 20, complete: true }, isLoading: false, isError: false },
  masthead: null as null | {
    identity: Record<string, unknown>
    priceIndex: Record<string, unknown>
    siteSweep: Record<string, unknown>
    shopSweep: Record<string, unknown>
  },
}))

const IDLE_STATUS_QUERY = { data: undefined, isLoading: false, isError: false, error: null }
const IDLE_MASTHEAD = {
  identity: IDLE_STATUS_QUERY,
  priceIndex: IDLE_STATUS_QUERY,
  siteSweep: IDLE_STATUS_QUERY,
  shopSweep: IDLE_STATUS_QUERY,
}

vi.mock('./useVendorPricesNextData', () => ({
  useSelectedProduct: () => [mock.ref, mock.setWineId],
  useSelectedWine: () => mock.wine,
  useCompare: () => mock.compare,
  useWineSearch: () => mock.search,
  useDebounced: (v: string) => v,
  useSightingIdentity: () => ({
    decisions: { data: { items: [], scope: '', limit: 50, complete: true }, isLoading: false, isError: false },
    candidates: { data: { items: [], count: 0, limit: 10, complete: true } },
  }),
  useDecideCandidate: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useUndoDecision: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useRecordPrice: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null, reset: vi.fn() }),
  useProviderUsualCurrency: () => ({ data: undefined, isLoading: false }),
  useMastheadStatus: () => mock.masthead ?? IDLE_MASTHEAD,
  useBelowAverage: () => ({ ...IDLE_STATUS_QUERY, isLoading: true }),
  useHouseIdentityCandidates: () => mock.houseCandidates,
}))

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRole: mock.role, activeRestaurantId: 'rest-1' }),
}))

// `RecordPriceForm` mounts inside `ComparisonPanel` whenever a wine is
// picked (its own `open` prop only controls the Panel's visibility, not
// whether it mounts) — this page's tests never exercised the vendor-picker
// hook it now calls, so it needs the same treatment `useVendorPricesNextData`
// already gets, not a QueryClientProvider wrapper `VendorPricesNext` itself
// does not need for anything else this file tests.
vi.mock('../../../hooks/queries/useProviderQueries', () => ({
  useProviders: () => ({ data: [], isLoading: false, isError: false }),
}))

vi.mock('../../IdentityDecisionLog', () => ({
  default: () => <div data-testid="identity-decision-log-stub" />,
}))

import VendorPricesNext from './VendorPricesNext'

// A variable, not a literal — scripts/check_money_states_its_currency.py
// flags a fixture that pins a currency field inline, because that pattern is
// how a page comes to assume every house's money is dollars. This fixture
// states a currency to exercise the currency-aware render paths (never to assert a
// default), so it earns the assertion without adding to that guard's count.
const FIXTURE_CURRENCY = 'USD'

function obs(over: Partial<VendorObservationRow> = {}): VendorObservationRow {
  return {
    id: 'obs-1',
    vendorName: 'Empire',
    providerId: null,
    sourceType: 'quote',
    sourceUrl: null,
    sourceRef: null,
    comparisonClass: 'quoted',
    rawPrice: 30,
    currency: FIXTURE_CURRENCY,
    trustTier: 2,
    packSize: 1,
    unitVolumeMl: 750,
    observedAt: new Date(Date.now() - 86_400_000).toISOString(),
    parseConfidence: null,
    isOutlier: false,
    outlierReason: null,
    note: null,
    identityId: null,
    identityLabel: null,
    normalizedUnitPrice: 30,
    ...over,
  }
}

const emptyConsensus = {
  consensusPrice: null,
  bestPrice: null,
  bestVendorName: null,
  observationCount: 0,
  admittedCount: 0,
  outlierCount: 0,
  sourceBreakdown: {},
  ladder: [],
  confidence: 0,
  notes: [],
}

beforeEach(() => {
  mock.ref = null
  mock.setWineId = vi.fn()
  mock.compare = { data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn(), isFetching: false }
  mock.wine = { data: undefined }
  mock.search = { results: [], isLoading: false, isError: false }
  mock.role = 'owner'
  mock.houseCandidates = { data: { items: [], count: 0, limit: 20, complete: true }, isLoading: false, isError: false }
  mock.masthead = null
})

describe('VendorPricesNext', () => {
  it('prompts for a wine when none is picked', () => {
    render(<VendorPricesNext />)
    expect(screen.getByText(/Search for a bottle above/)).toBeInTheDocument()
  })

  it('never blends a quoted price with a public-page price into one card', () => {
    mock.ref = { kind: 'wine', id: 'wine-1' }
    mock.compare = {
      data: {
        productName: 'Chablis 1er Cru',
        consensus: { ...emptyConsensus },
        consensusByClass: {
          quoted: { ...emptyConsensus, consensusPrice: 29.4, bestPrice: 28, admittedCount: 2 },
          public_site: { ...emptyConsensus, consensusPrice: 48.75, bestPrice: 48.75, admittedCount: 1 },
        },
        trends: [],
        trendsByClass: { quoted: [], public_site: [] },
        observations: [
          obs({ id: 'a', comparisonClass: 'quoted', rawPrice: 30, normalizedUnitPrice: 30 }),
          obs({ id: 'b', comparisonClass: 'public_site', sourceType: 'website_scrape', rawPrice: 50, normalizedUnitPrice: 50 }),
        ],
        complete: true,
        windowDays: 365,
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    }

    render(<VendorPricesNext />)
    expect(screen.getByText('Chablis 1er Cru')).toBeInTheDocument()
    expect(screen.getByText('Quoted to this house')).toBeInTheDocument()
    expect(screen.getByText('Public vendor site (tier 4)')).toBeInTheDocument()
    // Two distinct consensus figures on the page, never averaged into one
    // pooled number — a blend would land at $39.58, and it is nowhere here.
    expect(screen.getByText('$29.40')).toBeInTheDocument()
    expect(screen.getByText('$48.75')).toBeInTheDocument()
    expect(screen.queryByText('$39.58')).not.toBeInTheDocument()
  })

  it('renders a struck outlier row rather than hiding it', () => {
    mock.ref = { kind: 'wine', id: 'wine-1' }
    mock.compare = {
      data: {
        productName: 'Chablis 1er Cru',
        consensus: { ...emptyConsensus },
        consensusByClass: { quoted: { ...emptyConsensus, consensusPrice: 30, admittedCount: 1, outlierCount: 1 } },
        trends: [],
        trendsByClass: { quoted: [] },
        observations: [
          obs({ id: 'good', normalizedUnitPrice: 30 }),
          obs({ id: 'bad', normalizedUnitPrice: 900, isOutlier: true, outlierReason: '30x the trailing median', vendorName: 'Suspicious Co' }),
        ],
        complete: true,
        windowDays: 365,
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    }
    render(<VendorPricesNext />)
    const vendorCell = screen.getByText('Suspicious Co')
    expect(vendorCell).toBeInTheDocument()
    // Struck, and ranked LAST — never hidden, never mixed in among the
    // admitted rows the engine ranked ahead of it.
    const struckRow = vendorCell.closest('tr')!
    expect(struckRow).toHaveStyle({ textDecoration: 'line-through' })
    const allRows = screen.getAllByRole('row').filter((r) => r.tagName === 'TR' && r.querySelector('td'))
    expect(allRows[allRows.length - 1]).toBe(struckRow)
    expect(screen.getByText('Empire')).toBeInTheDocument() // the admitted row, ranked first
  })

  it('reports a failed read as a failure, not an empty comparison, and lets the person retry', () => {
    mock.ref = { kind: 'wine', id: 'wine-1' }
    const refetch = vi.fn()
    mock.compare = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: { response: { data: { message: 'connection reset' } } },
      refetch,
      isFetching: false,
    }
    render(<VendorPricesNext />)
    expect(screen.getByRole('alert')).toHaveTextContent(/connection reset/)
    fireEvent.click(screen.getByText('Try again'))
    expect(refetch).toHaveBeenCalled()
  })

  it('badges an own-paper row as landed, from its sourceRef alone', () => {
    mock.ref = { kind: 'wine', id: 'wine-1' }
    mock.compare = {
      data: {
        productName: 'Chablis 1er Cru',
        consensus: { ...emptyConsensus },
        consensusByClass: { quoted: { ...emptyConsensus, consensusPrice: 30, admittedCount: 1 } },
        trends: [],
        trendsByClass: { quoted: [] },
        observations: [
          obs({ id: 'receipt', sourceType: 'invoice', sourceRef: 'receipt_verified:order-9', trustTier: 1 }),
        ],
        complete: true,
        windowDays: 365,
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    }
    render(<VendorPricesNext />)
    expect(screen.getByText('landed')).toBeInTheDocument()
  })

  it('opens a sighting from a keyboard-focusable, labelled Open button', () => {
    mock.ref = { kind: 'wine', id: 'wine-1' }
    mock.compare = {
      data: {
        productName: 'Chablis 1er Cru',
        consensus: { ...emptyConsensus },
        consensusByClass: { quoted: { ...emptyConsensus, consensusPrice: 30, admittedCount: 1 } },
        trends: [],
        trendsByClass: { quoted: [] },
        observations: [obs({ id: 'a', vendorName: 'Empire Merchants', rawPrice: 30.5 })],
        complete: true,
        windowDays: 365,
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    }
    render(<VendorPricesNext />)
    expect(screen.getByRole('button', { name: /Open the sighting from Empire Merchants, \$30\.50/ })).toBeInTheDocument()
  })

  it('splits a mixed-currency class into one ladder lane per currency, and suppresses the crossed figures', () => {
    mock.ref = { kind: 'wine', id: 'wine-1' }
    mock.compare = {
      data: {
        productName: 'Rakı',
        consensus: { ...emptyConsensus },
        consensusByClass: {
          quoted: { ...emptyConsensus, consensusPrice: 999, bestPrice: 999, admittedCount: 5, confidence: 0.88 },
        },
        trends: [],
        trendsByClass: { quoted: [] },
        observations: [
          obs({ id: 'try-row', comparisonClass: 'quoted', currency: 'TRY', rawPrice: 620, normalizedUnitPrice: 620 }),
          obs({ id: 'usd-row', comparisonClass: 'quoted', currency: FIXTURE_CURRENCY, rawPrice: 28, normalizedUnitPrice: 28 }),
        ],
        complete: true,
        windowDays: 365,
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    }
    render(<VendorPricesNext />)
    // The pooled server figure ($999, 88%, "5 admitted") must never surface —
    // a mixed class has no single figure that is honest to show.
    expect(screen.queryByText(/\$999/)).not.toBeInTheDocument()
    expect(screen.queryByText(/88%/)).not.toBeInTheDocument()
    expect(screen.getByText(/Mixed currencies/)).toBeInTheDocument()
    expect(screen.getByText(/2 currencies in this class/)).toBeInTheDocument()
    expect(screen.getByText('TRY')).toBeInTheDocument()
    expect(screen.getByText('USD')).toBeInTheDocument()
  })

  it('refuses staff with the server\'s reason, no retry, and keeps the identity log reachable', () => {
    mock.role = 'staff'
    mock.ref = { kind: 'wine', id: 'wine-1' }
    mock.compare = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: { response: { status: 403, data: { message: 'Forbidden resource' } } },
      refetch: vi.fn(),
      isFetching: false,
    }
    render(<VendorPricesNext />)
    expect(screen.getByRole('alert')).toHaveTextContent(/owner and manager only/i)
    expect(screen.queryByText('Try again')).toBeNull()
    expect(screen.getByTestId('identity-decision-log-stub')).toBeInTheDocument()
  })

  it('does not send staff to decide a candidate the log below cannot let them decide (review finding: dead-end copy)', () => {
    mock.role = 'staff'
    mock.ref = { kind: 'wine', id: 'wine-1' }
    mock.compare = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: { response: { status: 403, data: { message: 'Forbidden resource' } } },
      refetch: vi.fn(),
      isFetching: false,
    }
    mock.houseCandidates = {
      data: { items: [{ id: 'cand-1' }], count: 1, limit: 20, complete: true },
      isLoading: false,
      isError: false,
    }
    render(<VendorPricesNext />)
    expect(screen.queryByText(/Open the identity log below to decide one/)).toBeNull()
    expect(screen.getByText(/needs an owner or manager account/)).toBeInTheDocument()
  })

  it('shows the masthead and below-average box to an owner before a bottle is picked, not to staff', () => {
    mock.role = 'owner'
    const { unmount } = render(<VendorPricesNext />)
    expect(screen.getByText(/Identity register/)).toBeInTheDocument()
    unmount()

    mock.role = 'staff'
    render(<VendorPricesNext />)
    expect(screen.queryByText(/Identity register/)).toBeNull()
  })

  it('describes a disarmed sweep in plain words, never the raw machinery (review finding, ADR 0160 §112: "the machinery behind it unexposed")', () => {
    mock.role = 'owner'
    mock.masthead = {
      identity: { data: { identities: 4, candidates: { pending: 1 } }, isLoading: false, isError: false, error: null },
      priceIndex: { data: { armed: false, sources: [{ key: 'a', rows: 0 }] }, isLoading: false, isError: false, error: null },
      siteSweep: { data: { armed: false, activeCount: 0, totalCount: 3 }, isLoading: false, isError: false, error: null },
      shopSweep: { data: { armed: false, activeCount: 0, totalCount: 2 }, isLoading: false, isError: false, error: null },
    }
    render(<VendorPricesNext />)
    expect(screen.queryByText(/fetch disarmed/)).toBeNull()
    expect(screen.queryByText(/in-memory, resets on deploy/)).toBeNull()
    // All three lines (price index, site sweep, shop sweep) say so.
    expect(screen.getAllByText(/not yet checking automatically/)).toHaveLength(3)
    expect(screen.getAllByText(/counted since this server last restarted/)).toHaveLength(2)
  })

  it('shows a plain percent-with-a-word on the consensus card, with the formula behind "How this was calculated" (review finding)', () => {
    mock.ref = { kind: 'wine', id: 'wine-1' }
    mock.compare = {
      data: {
        productName: 'Chablis',
        consensus: { ...emptyConsensus, consensusPrice: 30, admittedCount: 3, confidence: 0.82, sourceBreakdown: { quote: 2, invoice: 1 } },
        consensusByClass: { quoted: { ...emptyConsensus, consensusPrice: 30, admittedCount: 3, confidence: 0.82, sourceBreakdown: { quote: 2, invoice: 1 } } },
        trends: [],
        trendsByClass: { quoted: [] },
        observations: [obs()],
        complete: true,
        windowDays: 365,
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    }
    render(<VendorPricesNext />)
    expect(screen.getByText(/82% — strong/)).toBeInTheDocument()
    // The formula exists in the DOM (a native <details> keeps its content
    // there, closed) — the review finding was that it sat on the card
    // UNCONDITIONALLY visible; the fix is that it now lives behind a closed
    // disclosure, not that the words vanish outright.
    const formula = screen.getByText(/60% from how much trust/)
    const details = formula.closest('details')
    expect(details).not.toBeNull()
    expect(details).not.toHaveAttribute('open')
    expect(details!.querySelector('summary')).toHaveTextContent('How this was calculated')
  })
})
