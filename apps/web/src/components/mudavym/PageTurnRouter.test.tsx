import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PAGE_TURN } from '../../lib/mudavym/viewTransition'
import { PageTurnRouter } from './PageTurnRouter'

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8')

function Where() {
  const loc = useLocation()
  const go = useNavigate()
  return createElement(
    'div',
    null,
    createElement('h1', null, loc.pathname),
    createElement('output', { 'data-testid': 'search' }, loc.search),
    createElement(Link, { to: '/register' }, 'to register'),
    createElement('button', { onClick: () => go('/login?tab=2') }, 'search only'),
    createElement('button', { onClick: () => go('/team') }, 'programmatic'),
  )
}

function mount() {
  return render(
    createElement(PageTurnRouter, null, createElement(Routes, null, createElement(Route, { path: '*', element: createElement(Where) }))),
  )
}

beforeEach(() => {
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never
})

let started: Array<() => Promise<void> | void> = []
function withApi() {
  started = []
  ;(document as unknown as { startViewTransition: unknown }).startViewTransition = (cb: () => Promise<void> | void) => {
    started.push(cb)
    // The browser calls the update once the old page is captured.
    queueMicrotask(() => void cb())
    return { finished: Promise.resolve() }
  }
}

afterEach(() => {
  delete (document as unknown as { startViewTransition?: unknown }).startViewTransition
  window.history.replaceState(null, '', '/login')
})

describe('PageTurnRouter', () => {
  it('turns the page for a link and for navigate(), each once, and lands on the new page', async () => {
    window.history.replaceState(null, '', '/login')
    withApi()
    mount()
    await act(async () => {
      fireEvent.click(screen.getByText('to register'))
    })
    expect(started).toHaveLength(1)
    expect(window.location.pathname).toBe('/register')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('/register')
    await act(async () => {
      fireEvent.click(screen.getByText('programmatic'))
    })
    expect(started).toHaveLength(2)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('/team')
  })

  it('does not turn the page for a change that keeps the path', async () => {
    window.history.replaceState(null, '', '/login')
    withApi()
    mount()
    await act(async () => {
      fireEvent.click(screen.getByText('search only'))
    })
    expect(started).toHaveLength(0)
    expect(screen.getByTestId('search').textContent).toBe('?tab=2')
  })

  it('still navigates when the browser has no page turn', async () => {
    window.history.replaceState(null, '', '/login')
    mount()
    await act(async () => {
      fireEvent.click(screen.getByText('to register'))
    })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('/register')
  })

  it('follows the browser back button', async () => {
    window.history.replaceState(null, '', '/login')
    mount()
    await act(async () => {
      fireEvent.click(screen.getByText('to register'))
    })
    window.history.back()
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('/login')
  })
})

describe('the page turn sheet', () => {
  const css = read('src/components/mudavym/page-turn.css')
  it('lifts the old page in 90 ms and settles the new one in 220 ms on the house curve', () => {
    expect(css).toMatch(/::view-transition-old\(root\)\s*\{[^}]*animation:\s*mdv-turn-out 90ms cubic-bezier\(0\.16, 1, 0\.3, 1\)/)
    expect(css).toMatch(/::view-transition-new\(root\)\s*\{[^}]*animation:\s*mdv-turn-in 220ms cubic-bezier\(0\.16, 1, 0\.3, 1\) 90ms/)
    expect(PAGE_TURN.outMs).toBe(90)
    expect(PAGE_TURN.inMs).toBe(220)
  })
  it('names the H1 page-title and glides it over 220 ms', () => {
    expect(css).toMatch(/::view-transition-group\(page-title\)\s*\{[^}]*animation-duration:\s*220ms/)
    expect(PAGE_TURN.titleName).toBe('page-title')
  })
  it('animates opacity and transform only, never transition-all, and stops for reduced motion', () => {
    const keyframes = css.match(/@keyframes[^{]+\{[\s\S]*?\n\}/g)!.join('\n')
    const props = [...keyframes.matchAll(/^\s+(?:from|to)\s*\{\s*([a-z-]+):/gm)].map((m) => m[1])
    expect(new Set(props)).toEqual(new Set(['opacity']))
    expect(keyframes).toContain('transform: translateY')
    expect(css).not.toContain('transition: all')
    expect(css).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*animation: none/)
  })
  it('is the router App mounts', () => {
    expect(read('src/App.tsx')).toMatch(/PageTurnRouter as Router/)
  })
})

describe('the book is centred', () => {
  const css = read('src/components/brand/endpaper.css')
  const rule = css.slice(css.indexOf('.mudavym.mdv-auth.mdv-endpaper {'))
  const block = rule.slice(0, rule.indexOf('}'))
  it('holds the viewport and centres on both axes with equal padding above and below', () => {
    expect(block).toContain('min-height: 100dvh')
    expect(block).toContain('place-content: center')
    expect(block).toMatch(/padding: clamp\(20px, 5vh, 56px\) 16px;/)
  })
})
