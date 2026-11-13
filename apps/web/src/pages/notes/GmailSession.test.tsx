import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../../__tests__/utils/test-utils'
import GmailSession from './GmailSession'
import { publicRouteFor, PUBLIC_ROUTES } from '../../lib/seo/routes'

/** ADR 0356: public on purpose, unlisted, so the shell's closed head applies. */
describe('/notes/gmail-session', () => {
  it('renders the page with one h1 and the two-jobs summary', () => {
    renderWithProviders(<GmailSession />)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { name: /two jobs/i })).toBeInTheDocument()
  })

  it('is not in the public route registry, so it is noindex and out of the sitemap', () => {
    expect(publicRouteFor('/notes/gmail-session')).toBeUndefined()
  })

  it('carries no em or en dashes', () => {
    const { container } = renderWithProviders(<GmailSession />)
    expect(container.textContent).not.toMatch(/[–—]/)
  })

  // A guard for this one page only. It is not a content policy for /notes/ pages.
  it('stays a stub: no decision ids, pull requests, paths or comment markers', () => {
    const { container } = renderWithProviders(<GmailSession />)
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/<!--|\/Users\/|\bOD-\d+|#\d{2,}|\bapps\//)
    expect(text).toMatch(/not current policy/i)
  })

  it('no /notes/ page is ever registered as a public route', () => {
    expect(PUBLIC_ROUTES.filter((r) => r.path.startsWith('/notes'))).toEqual([])
  })

  it('is served the closed crawl head: the SPA rewrite lists notes', () => {
    const vercel = JSON.parse(readFileSync(resolve(__dirname, '../../../vercel.json'), 'utf8'))
    const spa = vercel.rewrites.find((r: { destination: string }) => r.destination === '/crawl/app.html')
    expect(spa).toBeDefined()
    expect(new RegExp(`^${spa.source}$`).test('/notes/gmail-session')).toBe(true)
  })
})
