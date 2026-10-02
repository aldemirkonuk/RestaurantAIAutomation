/**
 * Every live tour's steps point at something its page still draws (ADR 0251 D3).
 *
 * TourEngine leaves out a step whose element is not on the page, without an
 * error, so a rebuilt page that drops an anchor makes its step vanish in
 * silence. That is how 36 of the 40 old anchors died.
 *
 * For each step, `anchors.scan.ts` reads the page that step's tour runs on
 * (the `<Route>` for its path in `App.tsx`, followed through the components it
 * draws) and needs ONE element there to meet the whole selector: tag, id,
 * classes and every attribute, plus an ancestor for a descendant selector.
 * A part met by one element and another part by a different element does not
 * count, nor does a match on some other page, nor an element written where
 * code the scan cannot see decides whether it is drawn (inside a package
 * component, or handed to a call it does not know).
 *
 * Why it parses rather than renders: the pages read the gateway through hooks,
 * and several anchors are drawn only when there are rows (drafts waiting, a
 * low-stock list), so a render would need a mocked data set per page and
 * would still leave the empty branches unchecked. The compiler reads every
 * branch instead. Building its program takes seconds, most of this file's
 * run time, so it is built once in `beforeAll` rather than inside whichever
 * step's test runs first.
 *
 * It is a static check: it proves an element meeting the selector is written
 * on the page, not that the page draws it at the moment the tour runs (a
 * section drawn only when it has rows is still left out then, as designed),
 * nor that it is the element the step means. Only the literals `true` and
 * `false` are read as conditions.
 *
 * A step whose anchor needs a value the scan cannot resolve is `cannot-check`,
 * and that fails like `missing` unless the step is listed in CANNOT_CHECK with
 * a reason. A listed step fails when it becomes checkable or leaves its tour.
 */
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { TOUR_REGISTRY } from './registry'
import { PAGE_TOUR_ROUTES, type PageTourId } from '../types'
import { createAnchorScanner, type AnchorScanner } from './anchors.scan'

const WEB = join(__dirname, '..', '..', '..')

/** `<tour id> <selector>` → why the scan cannot check it. Empty today. */
const CANNOT_CHECK: Record<string, string> = {}

/** Tours a person can still reach from a page or from Help. */
const LIVE = (Object.keys(PAGE_TOUR_ROUTES) as PageTourId[]).filter((id) => TOUR_REGISTRY[id])

let scanner: AnchorScanner | undefined
const scan = (): AnchorScanner => (scanner ??= createAnchorScanner({ webRoot: WEB }))

describe('live tours ring something their page still draws', () => {
  // The program build is charged here, not to the first step's test.
  beforeAll(() => void scan(), 60_000)

  it('covers every reachable tour', () => {
    expect(LIVE.sort()).toEqual(
      ['calendar', 'communications', 'dashboard', 'inventory', 'orders', 'providers', 'reports', 'settings-services'].sort(),
    )
  })

  for (const id of LIVE) {
    for (const step of TOUR_REGISTRY[id].steps) {
      const key = `${id} ${step.element}`
      it(`${id}: "${step.title}" → ${step.element}`, () => {
        const v = scan().page(PAGE_TOUR_ROUTES[id]!).check(step.element)
        if (key in CANNOT_CHECK) {
          expect(v.status, `listed as cannot-check but now ${v.status}: update CANNOT_CHECK`).toBe('cannot-check')
        } else {
          expect(v.status, `${v.status} on ${PAGE_TOUR_ROUTES[id]} ${v.at.join(', ')}`).toBe('rings')
        }
      })
    }
  }

  it('lists in CANNOT_CHECK only steps a live tour still has', () => {
    const live = new Set(LIVE.flatMap((id) => TOUR_REGISTRY[id].steps.map((s) => `${id} ${s.element}`)))
    expect(Object.keys(CANNOT_CHECK).filter((k) => !live.has(k))).toEqual([])
  })

  it('titles name the job, not a part of the screen, and carry no "1/4" prefix', () => {
    for (const id of LIVE) {
      for (const step of TOUR_REGISTRY[id].steps) {
        expect(step.title).not.toMatch(/^\d+\s*\/\s*\d+/)
        expect(step.title).not.toMatch(/\b(at a glance|toolbar|sidebar|canvas|table|grid|tabs?)\b/i)
      }
    }
  })
})

/* ── the scan itself, on pages written here ─────────────────────────────── */

const V = '/virtual'

function page(app: string, extra: Record<string, string> = {}) {
  const files: Record<string, string> = { [`${V}/src/App.tsx`]: app }
  for (const [k, v] of Object.entries(extra)) files[`${V}/src/${k}`] = v
  return createAnchorScanner({ webRoot: V, files }).page('/p')
}

const route = (body: string, before = '') =>
  `${before}\nexport function App() { return <Route path="/p" element={${body}} /> }\n`

describe('the anchor scan', () => {
  it('needs one element to meet every part', () => {
    const p = page(route('<main><div className="h"><button data-primary="true" /></div><header /></main>'))
    expect(p.check('header.h button[data-primary="true"]').status).toBe('missing')
    expect(p.check('div.h button[data-primary="true"]').status).toBe('rings')
    expect(p.check('section[aria-label="A"]').status).toBe('missing')
  })

  it('follows a prop into the component that writes it', () => {
    const panel = `function Panel({ title }: { title: string }) { return <section aria-label={title} /> }`
    expect(page(route('<Panel title="Running low" />', panel)).check('section[aria-label="Running low"]').status).toBe('rings')
    expect(page(route('<Panel title="Other" />', panel)).check('section[aria-label="Running low"]').status).toBe('missing')
    // A value the scan cannot read is never a pass.
    expect(page(route('<Panel title={useTitle()} />', panel)).check('section[aria-label="Running low"]').status).toBe('cannot-check')
  })

  it('reads a .map over a constant array, and gives up on a filtered one', () => {
    const tabs = `const S = ['menu', 'all'] as const
function Tabs() { return <div>{S.map((s) => <button data-testid={\`scope-\${s}\`} />)}</div> }
function Some() { return <div>{S.filter(Boolean).map((s) => <button data-testid={\`scope-\${s}\`} />)}</div> }`
    expect(page(route('<Tabs />', tabs)).check('[data-testid="scope-menu"]').status).toBe('rings')
    expect(page(route('<Tabs />', tabs)).check('[data-testid="scope-find"]').status).toBe('missing')
    expect(page(route('<Some />', tabs)).check('[data-testid="scope-menu"]').status).toBe('cannot-check')
  })

  it('reads only the page on the route, through imports and lazy pages', () => {
    const app = `import { lazy } from 'react'
const Other = lazy(() => import('./Other'))
import { Here } from './Here'
export function App() { return <><Route path="/p" element={<Here />} /><Route path="/q" element={<Other />} /></> }`
    const p = page(app, {
      'Here.tsx': `export function Here() { return <section id="here" /> }`,
      'Other.tsx': `export default function Other() { return <section id="there" /> }`,
    })
    expect(p.check('section#here').status).toBe('rings')
    expect(p.check('section#there').status).toBe('missing')
  })

  it('puts nothing above an element drawn through a portal', () => {
    const p = page(route('<header className="h">{createPortal(<button data-y="1" />, document.body)}</header>'))
    expect(p.check('header.h button[data-y="1"]').status).toBe('missing')
    expect(p.check('button[data-y="1"]').status).toBe('rings')
  })

  // A package component, or a call the scan does not know, decides whether its JSX is drawn.
  const pkg = `import { Dialog, Tooltip, Popover, wrap } from 'some-package'`
  it('never rings on the children of a package component (a closed dialog)', () => {
    const p = page(route('<header className="h"><Dialog open={false}><button data-x="1" /></Dialog></header>', pkg))
    expect(p.check('button[data-x="1"]').status).toBe('cannot-check')
    expect(p.check('header.h button[data-x="1"]').status).toBe('cannot-check')
  })

  it('never rings on JSX handed to a package component in a prop', () => {
    const p = page(route('<main><Tooltip content={<div data-x="1" />} /><Popover render={() => <div data-y="1" />} /></main>', pkg))
    expect(p.check('div[data-x="1"]').status).toBe('cannot-check')
    expect(p.check('div[data-y="1"]').status).toBe('cannot-check')
  })

  it('never rings on JSX handed to a call it does not know, or a portal opened there', () => {
    const p = page(route('<main>{wrap(<div data-x="1" />)}{wrap(() => createPortal(<b data-y="1" />, document.body))}</main>', pkg))
    expect(p.check('div[data-x="1"]').status).toBe('cannot-check')
    expect(p.check('b[data-y="1"]').status).toBe('cannot-check')
  })

  it('draws in place the children of a context provider and the return of a function called at once', () => {
    const ctx = `import { createContext } from 'react'
import { Store } from 'some-package'
const Ground = createContext(null)`
    const p = page(
      route('<main className="m"><Ground.Provider value={1}><b data-x="1" /></Ground.Provider><Store.Provider><b data-x="2" /></Store.Provider>{(() => <b data-x="3" />)()}</main>', ctx),
    )
    expect(p.check('main.m b[data-x="1"]').status).toBe('rings')
    expect(p.check('b[data-x="2"]').status).toBe('cannot-check')
    expect(p.check('main.m b[data-x="3"]').status).toBe('rings')
  })

  it('leaves out what a literal true or false never draws', () => {
    const shown = `function Shown() { if (false) return <i data-x="dead" />; if (true) return <i data-x="live" />; else return <i data-x="else" /> }`
    const p = page(route('<main>{false && <b data-x="and" />}{true ? <b data-x="yes" /> : <b data-x="no" />}<Shown /></main>', shown))
    expect(p.check('[data-x="and"]').status).toBe('missing')
    expect(p.check('[data-x="yes"]').status).toBe('rings')
    expect(p.check('[data-x="no"]').status).toBe('missing')
    expect(p.check('[data-x="dead"]').status).toBe('missing')
    expect(p.check('[data-x="live"]').status).toBe('rings')
    expect(p.check('[data-x="else"]').status).toBe('missing')
  })

  it('refuses a selector it cannot read', () => {
    expect(() => page(route('<div />')).check('div > span')).toThrow(/unsupported selector/)
    expect(() => page(route('<div />')).check('a:hover')).toThrow(/unsupported selector/)
  })
})
