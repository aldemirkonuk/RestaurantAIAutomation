import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../__tests__/utils/test-utils'
import { useAuth } from '../contexts/AuthContext'
import { fetchIdentityDecisions } from '../services/api/vendorIntel'
import IdentityDecisionLog from './IdentityDecisionLog'

/**
 * The three rules the log's own docblock claims — each asserted, because a
 * claim in a comment is not a claim the page keeps.
 *
 *  1. a failed read renders as a FAILURE with its reason, never as an empty log;
 *  2. a full page renders as a floor, never as a total;
 *  3. staff see the log and no undo control, with the reason said out loud.
 */

vi.mock('../services/api/vendorIntel', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    fetchIdentityDecisions: vi.fn(),
    undoIdentityDecision: vi.fn(),
  }
})

vi.mock('../contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, useAuth: vi.fn() }
})

function asRole(role: 'owner' | 'manager' | 'staff') {
  vi.mocked(useAuth).mockReturnValue({
    user: { userId: 'u1', email: 'a@b.test', name: 'Aylin', restaurantId: 'r1', role },
    loading: false,
    logout: vi.fn(),
    availableRestaurants: [],
    activeRestaurantId: 'r1',
    activeRole: role,
    setActiveRestaurantId: vi.fn(),
    refreshBranches: vi.fn(),
  } as any)
}

const ONE = {
  id: 'd1',
  candidateId: 'c1',
  restaurantId: 'r1',
  action: 'confirmed' as const,
  decidedBy: 'u1',
  decidedByLabel: 'Aylin',
  decidedByRole: 'staff',
  decidedAt: '2026-09-05T10:00:00.000Z',
  evidenceShown: {
    identity: { display_label: 'Krug Grande Cuvée (750ml)' },
    confidence: 0.62,
    method: 'normalised_key',
    subject: { table: 'restaurant_inventory' },
  },
  note: 'checked the label',
  linkWritten: 'restaurant_inventory.identity_id',
  undoesDecisionId: null,
}

describe('the identity decision log', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    asRole('manager')
  })

  it('names who decided, in what role, and what they were shown', async () => {
    vi.mocked(fetchIdentityDecisions).mockResolvedValue({
      items: [ONE],
      scope: "this house's decisions",
      limit: 50,
      complete: true,
    })
    renderWithProviders(<IdentityDecisionLog />)
    await waitFor(() => expect(screen.getByText('Aylin')).toBeInTheDocument())
    expect(screen.getByText('(staff)')).toBeInTheDocument()
    expect(screen.getByText('Confirmed')).toBeInTheDocument()
    expect(
      screen.getByText(/Krug Grande Cuvée \(750ml\) · shown at 62% by normalised_key/),
    ).toBeInTheDocument()
    expect(screen.getByText(/wrote restaurant_inventory.identity_id/)).toBeInTheDocument()
  })

  it('renders a failed read as a failure with its reason, not as an empty log', async () => {
    vi.mocked(fetchIdentityDecisions).mockRejectedValue(
      Object.assign(new Error('boom'), {
        response: { status: 400, data: { message: 'relation missing' } },
      }),
    )
    renderWithProviders(<IdentityDecisionLog />)
    await waitFor(() =>
      expect(screen.getByText('The decision log could not be read.')).toBeInTheDocument(),
    )
    expect(screen.getByText(/relation missing/)).toBeInTheDocument()
    expect(screen.getByText(/This is a failure, not an empty log/)).toBeInTheDocument()
    expect(screen.queryByText(/No identity decision has been taken/)).toBeNull()
  })

  it('says an empty log is empty, in words that do not sound like a failure', async () => {
    vi.mocked(fetchIdentityDecisions).mockResolvedValue({
      items: [],
      scope: "this house's decisions",
      limit: 50,
      complete: true,
    })
    renderWithProviders(<IdentityDecisionLog />)
    await waitFor(() =>
      expect(
        screen.getByText(/No identity decision has been taken in this house yet/),
      ).toBeInTheDocument(),
    )
  })

  it('renders a capped page as a FLOOR, and says the page stopped', async () => {
    vi.mocked(fetchIdentityDecisions).mockResolvedValue({
      items: [ONE, { ...ONE, id: 'd2' }],
      scope: "this house's decisions",
      limit: 2,
      complete: false,
    })
    renderWithProviders(<IdentityDecisionLog />)
    await waitFor(() => expect(screen.getByText('at least 2')).toBeInTheDocument())
    expect(screen.getByText(/stopped at 2 rows, so the count above is a floor/)).toBeInTheDocument()
  })

  it('shows a manager the undo control', async () => {
    vi.mocked(fetchIdentityDecisions).mockResolvedValue({
      items: [ONE],
      scope: '',
      limit: 50,
      complete: true,
    })
    renderWithProviders(<IdentityDecisionLog />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /undo/i })).toBeInTheDocument(),
    )
  })

  it('shows staff no undo control, and says why rather than failing on the press', async () => {
    asRole('staff')
    vi.mocked(fetchIdentityDecisions).mockResolvedValue({
      items: [ONE],
      scope: '',
      limit: 50,
      complete: true,
    })
    renderWithProviders(<IdentityDecisionLog />)
    await waitFor(() => expect(screen.getByText('Aylin')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /undo/i })).toBeNull()
    expect(
      screen.getByText(/Taking a decision back is an owner or manager action/),
    ).toBeInTheDocument()
  })

  it('offers no undo on a row that is itself an undo', async () => {
    vi.mocked(fetchIdentityDecisions).mockResolvedValue({
      items: [
        { ...ONE, id: 'd3', action: 'undone' as const, undoesDecisionId: 'd1', linkWritten: null },
      ],
      scope: '',
      limit: 50,
      complete: true,
    })
    renderWithProviders(<IdentityDecisionLog />)
    await waitFor(() => expect(screen.getByText('Undone')).toBeInTheDocument())
    expect(screen.getByText(/takes back an earlier decision/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /undo/i })).toBeNull()
  })

  it('prints a PROVISIONAL identity as provisional, never as official', async () => {
    vi.mocked(fetchIdentityDecisions).mockResolvedValue({
      items: [
        {
          ...ONE,
          evidenceShown: {
            ...ONE.evidenceShown,
            identity: { display_label: 'Ev Şarabı', standing: 'provisional' },
          },
        },
      ],
      scope: '',
      limit: 50,
      complete: true,
    })
    renderWithProviders(<IdentityDecisionLog />)
    await waitFor(() => expect(screen.getByText('Provisional')).toBeInTheDocument())
    expect(screen.queryByText('Library')).toBeNull()
  })

  it('prints a promoted identity as Library', async () => {
    vi.mocked(fetchIdentityDecisions).mockResolvedValue({
      items: [
        {
          ...ONE,
          evidenceShown: {
            ...ONE.evidenceShown,
            identity: { display_label: 'Krug', standing: 'library' },
          },
        },
      ],
      scope: '',
      limit: 50,
      complete: true,
    })
    renderWithProviders(<IdentityDecisionLog />)
    await waitFor(() => expect(screen.getByText('Library')).toBeInTheDocument())
    expect(screen.queryByText('Provisional')).toBeNull()
  })

  it('prints NO standing at all when the snapshot predates the column, rather than guessing official', async () => {
    vi.mocked(fetchIdentityDecisions).mockResolvedValue({
      items: [ONE],
      scope: '',
      limit: 50,
      complete: true,
    })
    renderWithProviders(<IdentityDecisionLog />)
    await waitFor(() => expect(screen.getByText('Aylin')).toBeInTheDocument())
    expect(screen.queryByText('Provisional')).toBeNull()
    expect(screen.queryByText('Library')).toBeNull()
    expect(screen.queryByText('From a source file')).toBeNull()
  })

  it('says the identity was not read rather than inventing a bottle name', async () => {
    vi.mocked(fetchIdentityDecisions).mockResolvedValue({
      items: [
        {
          ...ONE,
          evidenceShown: {
            ...ONE.evidenceShown,
            identity: { unread: true, reason: 'connection reset' },
          },
        },
      ],
      scope: '',
      limit: 50,
      complete: true,
    })
    renderWithProviders(<IdentityDecisionLog />)
    await waitFor(() =>
      expect(
        screen.getByText(/identity not read at the time \(connection reset\)/),
      ).toBeInTheDocument(),
    )
  })
})
