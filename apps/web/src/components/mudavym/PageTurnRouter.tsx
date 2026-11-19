import { startTransition, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Router, createPath, type NavigationType, type To } from 'react-router-dom'
import { createPageTurn } from '../../lib/mudavym/viewTransition'
import './page-turn.css'

interface Place {
  pathname: string
  search: string
  hash: string
  state: unknown
  key: string
}

function here(): Place {
  const { pathname, search, hash } = window.location
  const saved = window.history.state as { usr?: unknown; key?: string } | null
  return { pathname, search, hash, state: saved?.usr ?? null, key: saved?.key ?? 'default' }
}

/**
 * The browser router, with one difference: the change of page goes through
 * `viewTransition.ts`, so every `navigate()` and every `<Link>` in the product
 * turns the page the same way and no page has to ask. The URL changes at once;
 * the screen changes inside the transition. A change that keeps the path (a
 * filter in the query string) is not a new page and does not turn.
 */
export function PageTurnRouter({
  children,
  future,
}: {
  children: ReactNode
  future?: { v7_startTransition?: boolean; v7_relativeSplatPath?: boolean }
}) {
  const turn = useMemo(() => createPageTurn(), [])
  const [at, setAt] = useState<{ place: Place; action: NavigationType }>(() => ({ place: here(), action: 'POP' as NavigationType }))
  const current = useRef(at.place)
  current.current = at.place

  useLayoutEffect(() => {
    turn.committed()
  }, [turn, at.place.key])

  const show = useMemo(
    () => (action: NavigationType) => {
      const next = { place: here(), action }
      const newPage = next.place.pathname !== current.current.pathname
      const apply = () => startTransition(() => setAt(next))
      if (newPage) turn.run(apply)
      else apply()
    },
    [turn],
  )

  const navigator = useMemo(() => {
    const write = (mode: 'pushState' | 'replaceState', action: NavigationType) => (to: To, state?: unknown) => {
      const key = Math.random().toString(36).slice(2, 10)
      window.history[mode]({ usr: state ?? null, key }, '', typeof to === 'string' ? to : createPath(to))
      show(action)
    }
    return {
      createHref: (to: To) => (typeof to === 'string' ? to : createPath(to)),
      push: write('pushState', 'PUSH' as NavigationType),
      replace: write('replaceState', 'REPLACE' as NavigationType),
      go: (delta: number) => window.history.go(delta),
    }
  }, [show])

  useLayoutEffect(() => {
    const onPop = () => show('POP' as NavigationType)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [show])

  return (
    <Router location={at.place} navigationType={at.action} navigator={navigator} future={future}>
      {children}
    </Router>
  )
}

export default PageTurnRouter
