import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../__tests__/utils/test-utils'
import Privacy from './Privacy'

/**
 * ADR 0145, 2026-09-22 (round 6y), founder's pick verbatim: "Add to /privacy
 * now". Confirms the page renders and that its new "Questions you ask
 * Mudavym" section states the four things his pick asked for: what /ask
 * keeps, that the owner can opt out, that nothing asked while opted out is
 * ever used (even after opting back in), and that an export carries no
 * question text.
 */
describe('Privacy page', () => {
  it('renders the page', () => {
    renderWithProviders(<Privacy />)
    expect(screen.getByRole('heading', { name: /privacy & data/i })).toBeInTheDocument()
  })

  it('states what /ask keeps and how the record is used', () => {
    renderWithProviders(<Privacy />)
    expect(screen.getByRole('heading', { name: /questions you ask mudavym/i })).toBeInTheDocument()
    expect(
      screen.getByText(/we keep the question, the answer, and how the answer was reached/i),
    ).toBeInTheDocument()
  })

  it('states the owner opt-out', () => {
    renderWithProviders(<Privacy />)
    expect(screen.getByText(/house's owner can turn training use off for the whole house/i)).toBeInTheDocument()
  })

  it('states that a question asked while opted out is never used, even after opting back in', () => {
    renderWithProviders(<Privacy />)
    expect(
      screen.getByText(/never used for training, even if the owner turns it back on afterward/i),
    ).toBeInTheDocument()
  })

  it('states that an export carries no question text', () => {
    renderWithProviders(<Privacy />)
    expect(screen.getByText(/that export carries no question text at all/i)).toBeInTheDocument()
  })
})
