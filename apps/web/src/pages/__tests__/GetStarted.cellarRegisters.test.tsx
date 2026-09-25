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
    user: { name: 'Selin Kaya', emailVerified: true },
    createFirstHouse: vi.fn(),
  }),
}))
vi.mock('../../services/api/client', () => ({
  apiClient: { patch: vi.fn() },
}))
vi.mock('../../components/brand/BrandMark', () => ({
  BrandMark: () => <span>Mudavym</span>,
}))

import GetStarted from '../GetStarted'

describe('GetStarted — cellar registers left onboarding (ADR 0213)', () => {
  it('does not mount a register-checkbox step', () => {
    render(
      <MemoryRouter>
        <GetStarted />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: /Welcome, Selin/ })).toBeInTheDocument()
    expect(screen.queryByTestId('onboarding-cellar-registers')).toBeNull()
    expect(screen.queryByTestId('activate-cellar-registers')).toBeNull()
    expect(screen.queryByLabelText('Wines register')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
})
