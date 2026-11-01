import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../../__tests__/utils/test-utils'
import GmailSession from './GmailSession'
import { publicRouteFor } from '../../lib/seo/routes'

/** ADR 0355: public on purpose, unlisted, so the shell's closed head applies. */
describe('/notes/gmail-session', () => {
  it('renders the page with one h1', () => {
    renderWithProviders(<GmailSession />)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { name: /job 2: letter bench v4/i })).toBeInTheDocument()
  })

  it('is not in the public route registry, so it is noindex and out of the sitemap', () => {
    expect(publicRouteFor('/notes/gmail-session')).toBeUndefined()
  })

  it('carries no em or en dashes', () => {
    const { container } = renderWithProviders(<GmailSession />)
    expect(container.textContent).not.toMatch(/[–—]/)
  })
})
