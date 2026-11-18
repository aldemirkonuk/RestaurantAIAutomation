import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BookNotFound } from './BookNotFound'
import { SettlingHouse } from './SettlingHouse'

const css = readFileSync(resolve(__dirname, 'book-states.css'), 'utf8')

describe('BookNotFound', () => {
  it('says the page is not in the book, names the address and offers one way home', () => {
    render(
      <MemoryRouter initialEntries={['/this-page-does-not-exist']}>
        <BookNotFound />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: /isn.t in the book/i })).toBeTruthy()
    expect(screen.getByText('/this-page-does-not-exist')).toBeTruthy()
    const home = screen.getByRole('link', { name: /front of the book/i })
    expect(home.getAttribute('href')).toBe('/')
  })
})

describe('SettlingHouse', () => {
  it('says the house is being set up, as a polite status, with no link out', () => {
    render(
      <MemoryRouter>
        <SettlingHouse />
      </MemoryRouter>,
    )
    expect(screen.getByRole('status').textContent).toMatch(/One moment, setting up your house/)
    expect(screen.queryByRole('link', { name: /sign in again/i })).toBeNull()
  })

  it('when held, keeps the session and offers another try', () => {
    const onRetry = vi.fn()
    render(
      <MemoryRouter>
        <SettlingHouse held onRetry={onRetry} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/still signed in/i)).toBeTruthy()
  })
})

describe('book-states.css', () => {
  it('turns every animation off under prefers-reduced-motion', () => {
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(block).toMatch(/\.mdv-bs\s*{\s*animation:\s*none/)
    expect(block).toMatch(/\.mdv-bs-dots > span\s*{\s*animation:\s*none/)
  })

  it('animates only opacity and transform, and never transition: all', () => {
    expect(css).not.toMatch(/transition:\s*all/)
    const keyframes = [...css.matchAll(/@keyframes[^{]+{([\s\S]*?)\n}/g)].map((m) => m[1])
    expect(keyframes.length).toBeGreaterThan(1)
    for (const body of keyframes) {
      for (const prop of body.matchAll(/([a-z-]+)\s*:/g)) {
        expect(['opacity', 'transform']).toContain(prop[1])
      }
    }
  })

  it('uses tokens only, so the dark ground resolves with the rest of the book', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsl\(/)
  })
})
