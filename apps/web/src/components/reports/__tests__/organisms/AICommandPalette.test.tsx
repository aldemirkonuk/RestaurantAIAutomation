/**
 * What the ⌘K palette actually puts in front of an owner.
 *
 * The regression this locks out: the palette used to answer any typed question
 * with a hand-written, numerically specific paragraph from `generateMockAnswer`
 * that had never touched the restaurant's data.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const FEED = [
  {
    ruleKey: 'insight:a',
    sentence: 'Tuesday wine revenue is 18% below the weekly average.',
    category: 'sales',
    score: 9,
    effectPct: -0.18,
    zScore: null,
    entityKey: null,
    entityLabel: null,
    pinned: false,
  },
  {
    ruleKey: 'insight:b',
    sentence: 'Barolo reaches its reorder point in 6 days.',
    category: 'inventory',
    score: 7,
    effectPct: null,
    zScore: null,
    entityKey: 'barolo',
    entityLabel: 'Barolo',
    pinned: false,
  },
]

const insightsState = {
  insights: FEED as unknown[],
  loading: false,
  error: null as string | null,
}

vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { restaurantId: 'rest-1' } }),
}))

vi.mock('../../../../hooks/useEngineInsights', () => ({
  useEngineInsights: () => ({ ...insightsState, hasData: true, refresh: vi.fn() }),
  CATEGORY_LABEL: { sales: 'Sales', inventory: 'Stock' },
}))

import { AICommandPalette } from '../../organisms/AICommandPalette'

function open() {
  return render(
    <MemoryRouter>
      <AICommandPalette isOpen onClose={() => {}} />
    </MemoryRouter>,
  )
}

describe('AICommandPalette', () => {
  it('states up front that it does not answer free-text questions', () => {
    open()
    expect(
      screen.getByText(/does not answer questions in free text yet/i),
    ).toBeInTheDocument()
  })

  it('shows the engine sentences verbatim', () => {
    open()
    expect(screen.getByText(FEED[0].sentence)).toBeInTheDocument()
    expect(screen.getByText(FEED[1].sentence)).toBeInTheDocument()
  })

  it('filters to the matching insight when a question is typed', async () => {
    const user = userEvent.setup()
    open()
    await user.type(screen.getByLabelText(/filter insights/i), 'Why did Tuesday revenue dip?')

    expect(screen.getByText(FEED[0].sentence)).toBeInTheDocument()
    expect(screen.queryByText(FEED[1].sentence)).not.toBeInTheDocument()
  })

  it('says nothing matched rather than inventing an answer', async () => {
    const user = userEvent.setup()
    open()
    await user.type(screen.getByLabelText(/filter insights/i), 'sancerre')

    expect(screen.getByText(/No insight mentions/i)).toBeInTheDocument()
    // The old mock's fallback paragraph and its figures must not be reachable.
    expect(screen.queryByText(/by-the-glass upsells/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/34%/)).not.toBeInTheDocument()
  })

  it('reports an engine failure instead of filling the gap with prose', () => {
    insightsState.error = 'Network Error'
    insightsState.insights = []
    try {
      open()
      expect(screen.getByText(/Could not reach the analytics engine/i)).toBeInTheDocument()
    } finally {
      insightsState.error = null
      insightsState.insights = FEED as unknown[]
    }
  })
})
