import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../../__tests__/utils/test-utils'
import GmailSession from './GmailSession'
import { publicRouteFor, PUBLIC_ROUTES } from '../../lib/seo/routes'

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

  it('keeps gate tokens, capability ids and workstation paths off the public page', () => {
    const { container } = renderWithProviders(<GmailSession />)
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/pr-audit-gate|verdict=PASS|Y5VRZVvCaefSt4FNGgtBfw|d-e8fe9045eb|ex-invoice/)
    expect(text).not.toMatch(/\/Users\//)
    expect(text).not.toMatch(/auto-merges/i)
    expect(text).not.toMatch(/--admin|--auto|press merge|\b30K\b|personal account|\b[0-9a-f]{9}\b/i)
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
