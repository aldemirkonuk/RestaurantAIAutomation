/**
 * Every live tour's steps point at something a page still draws (ADR 0251 D3).
 *
 * TourEngine leaves out a step whose element is not on the page, without an
 * error, so a rebuilt page that drops an anchor makes its step vanish in
 * silence. That is how 36 of the 40 old anchors died. This reads the page
 * sources and fails when a selector's attribute, id or class no longer appears
 * in any of them.
 *
 * It is a static check: it proves the anchor is still written somewhere under
 * `src/pages`, not that the page renders it at the moment the tour runs (a
 * section drawn only when it has rows is still left out then, as designed).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TOUR_REGISTRY } from './registry'
import { PAGE_TOUR_ROUTES, type PageTourId } from '../types'

const PAGES = join(__dirname, '..', '..', 'pages')

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return sources(p)
    return /\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name) ? [readFileSync(p, 'utf8')] : []
  })
}

const SOURCE = sources(PAGES).join('\n')

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** What a page's source must contain for one part of a CSS selector to match. */
function needles(selector: string): { part: string; anyOf: RegExp[] }[] {
  const out: { part: string; anyOf: RegExp[] }[] = []
  for (const m of selector.matchAll(/\[([\w-]+)(\^?)="([^"]+)"\]/g)) {
    const [part, name, prefix, value] = m
    const anyOf = [
      new RegExp(`${esc(name)}="${esc(value)}${prefix ? '' : '"'}`),
      // A literal in braces, or a template whose fixed head the value begins with.
      new RegExp(`${esc(name)}=\\{\`${esc(value)}`),
    ]
    const head = value.match(/^(.*-)[a-z]+$/)?.[1]
    if (head) anyOf.push(new RegExp(`${esc(name)}=\\{\`${esc(head)}\\$\\{`))
    // A component prop that the component writes out as the attribute.
    if (name === 'data-tour') anyOf.push(new RegExp(`\\btour="${esc(value)}"`))
    if (name === 'aria-label') anyOf.push(new RegExp(`\\btitle="${esc(value)}"`))
    out.push({ part, anyOf })
  }
  for (const m of selector.replace(/\[[^\]]*\]/g, '').matchAll(/([#.])([\w-]+)/g)) {
    const [part, kind, value] = m
    out.push({
      part,
      anyOf: [
        kind === '#'
          ? new RegExp(`\\bid="${esc(value)}"`)
          : new RegExp(`className="(?:[^"]* )?${esc(value)}(?: [^"]*)?"`),
      ],
    })
  }
  return out
}

/** Tours a person can still reach from a page or from Help. */
const LIVE = (Object.keys(PAGE_TOUR_ROUTES) as PageTourId[]).filter((id) => TOUR_REGISTRY[id])

describe('live tours ring something a page still draws', () => {
  it('covers every reachable tour', () => {
    expect(LIVE.sort()).toEqual(
      ['calendar', 'communications', 'dashboard', 'inventory', 'orders', 'providers', 'reports', 'settings-services'].sort(),
    )
  })

  for (const id of LIVE) {
    for (const step of TOUR_REGISTRY[id].steps) {
      it(`${id}: "${step.title}" → ${step.element}`, () => {
        const parts = needles(step.element)
        expect(parts.length).toBeGreaterThan(0)
        for (const { part, anyOf } of parts) {
          expect(anyOf.some((re) => re.test(SOURCE)), `${part} is in no page source`).toBe(true)
        }
      })
    }
  }

  it('titles name the job, not a part of the screen, and carry no "1/4" prefix', () => {
    for (const id of LIVE) {
      for (const step of TOUR_REGISTRY[id].steps) {
        expect(step.title).not.toMatch(/^\d+\s*\/\s*\d+/)
        expect(step.title).not.toMatch(/\b(at a glance|toolbar|sidebar|canvas|table|grid|tabs?)\b/i)
      }
    }
  })
})
