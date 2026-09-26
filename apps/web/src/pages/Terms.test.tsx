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

  it('states the training-use notice consistently with /privacy', () => {
    renderWithProviders(<Terms />)
    expect(screen.getByRole('heading', { name: /questions you ask mudavym/i })).toBeInTheDocument()
  })
})
