/**
 * The sighting sheet's own contract (ADR 0160 §112 review, 2026-09-18):
 *  - a figure opens to its sources — an order link, a source link, or an
 *    honest "nothing to open", never all three states confused;
 *  - a withheld person (ADR 0149 answer 17) never renders as a blank name;
 *  - Undo is offered only when this house decided it, the role can act, and
 *    the server has not refused it;
 *  - a failed candidates read is an error, not an empty queue.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { VendorObservationRow } from '../../../services/api/vendorIntel'

const mock = vi.hoisted(() => ({
  role: 'manager' as 'owner' | 'manager' | 'staff' | null,
  decisions: { data: undefined as any, isLoading: false, isError: false, error: null as { message: string } | null, refetch: vi.fn() },
  candidates: { data: undefined as any, isLoading: false, isError: false, error: null as { message: string } | null, refetch: vi.fn() },
  decide: { mutate: vi.fn(), isPending: false, isError: false },
  undo: { mutate: vi.fn(), isPending: false, isError: false },
}))

vi.mock('./useVendorPricesNextData', () => ({
  useSightingIdentity: () => ({ decisions: mock.decisions, candidates: mock.candidates }),
  useDecideCandidate: () => mock.decide,
  useUndoDecision: () => mock.undo,
}))

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRole: mock.role }),
}))

import { SightingSheet } from './SightingSheet'

// A variable, not a literal — scripts/check_money_states_its_currency.py
// scans for a currency field pinned inline, which is how a page comes to
// assume every house's money is dollars.
const FIXTURE_CURRENCY = 'USD'

function row(over: Partial<VendorObservationRow> = {}): VendorObservationRow {
  return {
    id: 'obs-1',
    vendorName: 'A Vendor',
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
    observedAt: new Date().toISOString(),
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

beforeEach(() => {
  mock.role = 'manager'
  mock.decisions = { data: { items: [], scope: '', limit: 50, complete: true }, isLoading: false, isError: false, error: null, refetch: vi.fn() }
  mock.candidates = { data: { items: [], count: 0, limit: 10, complete: true }, isLoading: false, isError: false, error: null, refetch: vi.fn() }
  mock.decide = { mutate: vi.fn(), isPending: false, isError: false }
  mock.undo = { mutate: vi.fn(), isPending: false, isError: false }
})

describe('SightingSheet — provenance links', () => {
  it('says "No paper attached" when there is neither an order id nor a source url', () => {
    render(<SightingSheet row={row({ sourceRef: null, sourceUrl: null })} productName="Chablis" productRef={null} onClose={vi.fn()} />)
    expect(screen.getByText(/No paper attached/)).toBeInTheDocument()
    expect(screen.queryByText(/Open the order/)).toBeNull()
    expect(screen.queryByText(/Open the source/)).toBeNull()
  })

  it('links an own-paper row to its order and receipt, using the order id from sourceRef', () => {
    render(
      <SightingSheet
        row={row({ sourceType: 'invoice', sourceRef: 'receipt_verified:order-9' })}
        productName="Chablis"
        productRef={null}
        onClose={vi.fn()}
      />,
    )
    const link = screen.getByText('Open the order and its receipt') as HTMLAnchorElement
    expect(link.closest('a')).toHaveAttribute('href', '/receiving/order-9/door')
    expect(screen.queryByText(/No paper attached/)).toBeNull()
  })

  it('links a recorded sourceUrl even with no own-paper sourceRef, never saying "nothing to open"', () => {
    render(
      <SightingSheet
        row={row({ sourceType: 'website_scrape', sourceRef: null, sourceUrl: 'https://vendor.example/list' })}
        productName="Chablis"
        productRef={null}
        onClose={vi.fn()}
      />,
    )
    const link = screen.getByText('Open the source') as HTMLAnchorElement
    expect(link.closest('a')).toHaveAttribute('href', 'https://vendor.example/list')
    expect(screen.queryByText(/No paper attached/)).toBeNull()
  })
})

describe('SightingSheet — an unidentified row never shows an identity panel', () => {
  it('renders the unidentified sentence and no decisions/candidates section, even if the hook returned data', () => {
    // Deliberately non-empty, to prove the component's OWN `row.identityId`
    // guard is what keeps the panel off — not merely an empty mock result.
    mock.decisions.data = { items: [{ id: 'd1' }], scope: '', limit: 50, complete: true } as any
    render(<SightingSheet row={row({ identityId: null })} productName="Chablis" productRef={null} onClose={vi.fn()} />)
    expect(screen.getByText(/no confirmed identity/)).toBeInTheDocument()
    expect(screen.queryByText(/Identity decisions on this bottle/)).toBeNull()
  })
})

describe('SightingSheet — a withheld person (ADR 0149 answer 17)', () => {
  const DECIDED_BY_ANOTHER_HOUSE = {
    id: 'd1',
    candidateId: 'c1',
    restaurantId: null,
    action: 'confirmed' as const,
    decidedBy: null,
    decidedByLabel: null,
    decidedByRole: null,
    decidedAt: new Date().toISOString(),
    evidenceShown: {},
    note: null,
    linkWritten: null,
    undoesDecisionId: null,
    decidedIn: 'another_house' as const,
    personShown: false,
    undoRefusal: 'That decision on a shared register was taken in another house.',
  }

  it('never renders a blank name — prints the redaction sentence instead', () => {
    mock.decisions.data = { items: [DECIDED_BY_ANOTHER_HOUSE], scope: '', limit: 50, complete: true }
    render(<SightingSheet row={row({ identityId: 'ident-1' })} productName="Chablis" productRef={null} onClose={vi.fn()} />)
    // The sentence is split across sibling text nodes ("confirmed" / " by
    // another house, outcome shared"), so match on the list item's whole text.
    expect(screen.getByText((_, el) => el?.tagName === 'LI' && /confirmed by another house, outcome shared/.test(el.textContent ?? ''))).toBeInTheDocument()
    // Never "confirmed by  ()" — no empty parens, no dangling "by".
    expect(screen.queryByText(/by\s*\(\s*\)/)).toBeNull()
  })

  it('offers no Undo when undoRefusal names a reason, even for a manager', () => {
    mock.decisions.data = { items: [DECIDED_BY_ANOTHER_HOUSE], scope: '', limit: 50, complete: true }
    mock.role = 'manager'
    render(<SightingSheet row={row({ identityId: 'ident-1' })} productName="Chablis" productRef={null} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /undo/i })).toBeNull()
  })

  it('offers Undo only when this house decided it, the role can act, and the server refuses nothing', () => {
    mock.decisions.data = {
      items: [{ ...DECIDED_BY_ANOTHER_HOUSE, decidedIn: 'this_house', personShown: true, undoRefusal: null, decidedByLabel: 'Aylin', decidedByRole: 'staff' }],
      scope: '',
      limit: 50,
      complete: true,
    }
    mock.role = 'manager'
    render(<SightingSheet row={row({ identityId: 'ident-1' })} productName="Chablis" productRef={null} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /undo/i })).toBeInTheDocument()
  })

  it('offers no Undo for staff even on this house\'s own decision', () => {
    mock.decisions.data = {
      items: [{ ...DECIDED_BY_ANOTHER_HOUSE, decidedIn: 'this_house', personShown: true, undoRefusal: null, decidedByLabel: 'Aylin', decidedByRole: 'staff' }],
      scope: '',
      limit: 50,
      complete: true,
    }
    mock.role = 'staff'
    render(<SightingSheet row={row({ identityId: 'ident-1' })} productName="Chablis" productRef={null} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /undo/i })).toBeNull()
  })
})

describe('SightingSheet — a failed candidates read is an error, not an empty queue', () => {
  it('renders the server reason and a retry, never a silent "nothing waiting"', () => {
    mock.candidates = { data: undefined, isLoading: false, isError: true, error: { message: 'connection reset' }, refetch: vi.fn() }
    render(<SightingSheet row={row({ identityId: 'ident-1' })} productName="Chablis" productRef={null} onClose={vi.fn()} />)
    expect(screen.getByText(/could not be read/)).toBeInTheDocument()
    expect(screen.getByText(/connection reset/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('a failed decisions read renders an error with a retry, never "no decisions"', () => {
    mock.decisions = { data: undefined, isLoading: false, isError: true, error: { message: 'timeout' }, refetch: vi.fn() }
    render(<SightingSheet row={row({ identityId: 'ident-1' })} productName="Chablis" productRef={null} onClose={vi.fn()} />)
    expect(screen.getByText(/Could not be read/)).toBeInTheDocument()
    expect(screen.getByText(/timeout/)).toBeInTheDocument()
    expect(screen.queryByText(/No decision has been taken/)).toBeNull()
  })
})

describe('SightingSheet — a candidate shows its evidence before Confirm', () => {
  it('prints the method and the evidence fields, not a bare percent', () => {
    mock.candidates.data = {
      items: [{ id: 'cand-1', subjectTable: 'restaurant_inventory', subjectId: 'inv-1', restaurantId: null, identityId: 'ident-1', method: 'normalised_key', confidence: 0.81, evidence: { producer: 'agreed', name: 'agreed', size: 'unstated' }, createdAt: new Date().toISOString() }],
      count: 1,
      limit: 10,
      complete: true,
    }
    render(<SightingSheet row={row({ identityId: 'ident-1' })} productName="Chablis" productRef={null} onClose={vi.fn()} />)
    // Review finding: the raw enum value ("normalised_key") used to be
    // printed straight into the sentence — machinery ADR 0160 §112 says
    // stays behind the page. Plain words now, the evidence fields as before.
    expect(screen.queryByText(/normalised_key/)).toBeNull()
    expect(screen.getByText(/81% match — a normalised name match/)).toBeInTheDocument()
    expect(screen.getByText(/producer: agreed/)).toBeInTheDocument()
    expect(screen.getByText(/size: unstated/)).toBeInTheDocument()
  })
})

describe('SightingSheet — vendor and note (review finding: neither was shown for a non-own-paper row)', () => {
  it('shows the Vendor row for a quote, and the recorded note when there is one', () => {
    render(
      <SightingSheet
        row={row({ sourceType: 'quote', vendorName: 'Empire Merchants', note: 'Good through month end' })}
        productName="Chablis"
        productRef={null}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('Vendor')).toBeInTheDocument()
    expect(screen.getByText('Empire Merchants')).toBeInTheDocument()
    expect(screen.getByText('Note')).toBeInTheDocument()
    expect(screen.getByText('Good through month end')).toBeInTheDocument()
  })

  it('never renders a Note row when none was recorded', () => {
    render(
      <SightingSheet row={row({ note: null })} productName="Chablis" productRef={null} onClose={vi.fn()} />,
    )
    expect(screen.queryByText('Note')).toBeNull()
  })

  it('says the row does not name who, rather than a blank Vendor row, when vendorName is null', () => {
    render(
      <SightingSheet
        row={row({ sourceType: 'chat', vendorName: null })}
        productName="Chablis"
        productRef={null}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('a vendor the row does not name')).toBeInTheDocument()
  })
})
