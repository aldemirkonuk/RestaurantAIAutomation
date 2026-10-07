/**
 * ADR 0213 rec 13: Threshold / cellar-register confirmation leaves onboarding.
 * The arrival You → restaurant → menu → reading flow must not ask the
 * seven-register checkbox question. That question is one house-contents line.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { name: 'Selin Kaya', emailVerified: true, restaurantId: '' },
    loading: false,
    activeRestaurantId: null,
    createFirstHouse: vi.fn(),
  }),
}))
vi.mock('../../services/api/client', () => ({
  // An account with no house yet: /get-started checks this on arrival (ADR 0309).
  apiClient: {
    patch: vi.fn(),
    get: vi.fn().mockResolvedValue({ data: { houses: [], held: [], accessEnded: false } }),
  },
}))
vi.mock('../../components/brand/BrandMark', () => ({
  BrandMark: () => <span>Mudavym</span>,
}))

import GetStarted from '../GetStarted'

describe('GetStarted — cellar registers left onboarding (ADR 0213)', () => {
  it('does not mount a register-checkbox step', async () => {
    render(
      <MemoryRouter>
        <GetStarted />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: /Welcome, Selin/ })).toBeInTheDocument()
    expect(screen.queryByTestId('onboarding-cellar-registers')).toBeNull()
    expect(screen.queryByTestId('activate-cellar-registers')).toBeNull()
    expect(screen.queryByLabelText('Wines register')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
})
