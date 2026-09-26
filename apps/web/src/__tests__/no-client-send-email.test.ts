/**
 * Guard: nothing in the web app calls `POST /notifications/send-email`.
 *
 * That route took the recipients and the HTML from the browser and sent them
 * from the house's domain. PR #410 (ADR 0147) closed it: it now answers 403
 * and never calls Gmail. Three web callers still posted to it and would have
 * failed silently or with a bare "Network error":
 *
 * - `lib/email-scheduler.ts` (started on every page load from `main.tsx`,
 *   draining a localStorage queue nothing has written since 2026-05-14);
 * - `components/emails/QuickGmailModal.tsx` (legacy /providers, and the
 *   One-Tap center, which legacy Dashboard and legacy Notifications mount;
 *   all three pages are in LIVE_PAGES, so each renders only under the QA
 *   override);
 * - `pages/RecurringOrders.tsx` (no route in App.tsx).
 *
 * None is reachable from a Mudavym page, so each hands the writer to the
 * house's own composer (`/communications`, `POST /communications/letters`)
 * or stops running, and the files go with the ADR 0149 cutover. This test
 * keeps a fourth caller from appearing: the path may be named in a comment,
 * never in code.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules') continue
      walk(full, out)
    } else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

/** Block comments, then line comments that start a line or follow whitespace. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
}

const CLOSED_ROUTE = /notifications\/send-email/

describe('no web code calls the closed send-email route', () => {
  it('names notifications/send-email only in comments', () => {
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      const code = stripComments(readFileSync(file, 'utf8'))
      if (CLOSED_ROUTE.test(code)) {
        offenders.push(relative(SRC, file).split(sep).join('/'))
      }
    }
    expect(offenders).toEqual([])
  })

  it('main.tsx no longer starts the browser email scheduler', () => {
    const main = stripComments(readFileSync(join(SRC, 'main.tsx'), 'utf8'))
    expect(main).not.toMatch(/startEmailScheduler/)
  })

  it('the scan sees a call that is not in a comment', () => {
    // A no-op scan would pass the first test on any tree.
    const code = stripComments(
      "// notifications/send-email\nawait axios.post(`${API}/api/v1/notifications/send-email`, {})",
    )
    expect(CLOSED_ROUTE.test(code)).toBe(true)
    expect(CLOSED_ROUTE.test(stripComments('/* notifications/send-email */'))).toBe(false)
  })
})
