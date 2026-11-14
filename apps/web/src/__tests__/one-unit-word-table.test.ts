/**
 * Guard: the web app says a stored unit in words from ONE table,
 * `lib/unit-words.ts` (2026-11-13).
 *
 * Five pages had their own copy and they disagreed ("2 each" on the invoice,
 * "2 items" on /orders, "2 units" at the door). A sixth copy would start the
 * drift again, so a quoted "split case" (the one word every copy had) may
 * appear in code only in the table itself.
 *
 * `STRAGGLERS` names a copy left on purpose, with why. The second test fails
 * when a straggler is fixed, so the list cannot outlive the copy it excuses.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..')
const TABLE = 'lib/unit-words.ts'

const STRAGGLERS: Record<string, string> = {
  // The legacy receiving workspace on /inventory, owned by the inventory lane
  // (r21) while this was built; it should import lib/unit-words.ts too.
  'pages/inventory/command/ReceivingWorkspace.tsx': 'inventory lane, not touched here',
}

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

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
}

const A_UNIT_WORD = /['"`]split cases?['"`]/

function filesSayingUnitWords(): string[] {
  return walk(SRC)
    .filter((f) => A_UNIT_WORD.test(stripComments(readFileSync(f, 'utf8'))))
    .map((f) => relative(SRC, f).split(sep).join('/'))
    .sort()
}

describe('one table of unit words', () => {
  it('has no copy outside lib/unit-words.ts but the named stragglers', () => {
    expect(filesSayingUnitWords()).toEqual([TABLE, ...Object.keys(STRAGGLERS)].sort())
  })

  it('still finds each straggler, so a fixed one leaves the list', () => {
    const found = new Set(filesSayingUnitWords())
    for (const file of Object.keys(STRAGGLERS)) expect(found.has(file)).toBe(true)
  })
})
