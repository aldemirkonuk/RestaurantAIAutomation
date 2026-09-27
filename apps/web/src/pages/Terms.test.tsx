import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../__tests__/utils/test-utils'
import Terms from './Terms'

/**
 * G9 (census, 2026-09-25): `/terms` had no route. This confirms the page
 * renders, is clearly labelled as a placeholder per OD-132/OD-124 (founder
 * Q11, 2026-09-22: "keep placeholder text for now; lawyer later"), and
 * cross-links `/privacy`.
 */
describe('Terms page', () => {
  it('renders the page', () => {
    renderWithProviders(<Terms />)
    expect(screen.getByRole('heading', { name: /terms of service/i })).toBeInTheDocument()
  })

  it('is clearly labelled as a placeholder, not a reviewed contract', () => {
    renderWithProviders(<Terms />)
    expect(screen.getByRole('heading', { name: /this page is a placeholder/i })).toBeInTheDocument()
    expect(screen.getByText(/has not been reviewed by a lawyer/i)).toBeInTheDocument()
  })

  it('links to the privacy notice', () => {
    renderWithProviders(<Terms />)
    const links = screen.getAllByRole('link', { name: /privacy/i })
    expect(links.some((a) => a.getAttribute('href') === '/privacy')).toBe(true)
  })

  it('states the training notice only as far as the code enforces it', () => {
    renderWithProviders(<Terms />)
    expect(screen.getByRole('heading', { name: /questions you ask mudavym/i })).toBeInTheDocument()
    // [PR 478 audit round 2] Names the section the owner actually finds
    // (SettingsNext.tsx "Questions and training"), and claims only what
    // ask_folio_training_export + asked_while_opted_out enforce
    // (migration 20260922220600): out of the training export, not "any".
    expect(screen.getByText(/settings → questions and training/i)).toBeInTheDocument()
    expect(screen.getByText(/kept out of mudavym's training export permanently/i)).toBeInTheDocument()
    expect(screen.queryByText(/training use,/i)).toBeNull()
    expect(screen.queryByText(/any training export/i)).toBeNull()
    // [PR 478 audit round 3] No by-reference clause to /privacy's section,
    // whose wording ("Training use", "never used for training") is broader
    // than the one export filter the code has.
    expect(screen.queryByText(/same notice/i)).toBeNull()
    expect(screen.queryByText(/never used for training/i)).toBeNull()
  })

  it('does not assume an acceptance the product never records', () => {
    renderWithProviders(<Terms />)
    expect(screen.queryByText(/already agreed/i)).toBeNull()
    expect(screen.getByText(/does not record acceptance of it/i)).toBeInTheDocument()
  })
})
