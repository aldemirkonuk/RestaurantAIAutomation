/**
 * Guard: no new caller of `formatMoney` from `lib/utils`.
 *
 * That `formatMoney(value, mode)` prints a hardcoded `$` for every house: it
 * takes no currency. A lira house read "$1.4K" wherever it was used (r8/r9
 * browser checks, 2026-11-12). Measured on main, 2026-11-12: of the 45 files
 * that import from `lib/utils`, three import `formatMoney`, and each is
 * already being moved off it by an open stack:
 *
 * - `pages/dashboard/next/KpiRow.tsx` and `pages/dashboard/next/format.ts`
 *   (the dashboard money stack, #1176 → #1181);
 * - `pages/reports/next/rp-format.ts` (#1183).
 *
 * So the function is not given a currency parameter here: there is no
 * caller left to pass one. House money goes through the house's currency
 * (`pages/cellar/next/useHouseMoney.ts`, or `fmtMoney(n, code)` in
 * `pages/receipts/next/rc2-format.ts` where the record carries its own).
 * This test keeps a fourth caller from appearing. A file on the list that
 * stops importing it is fine; a new one fails.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..')

/** The callers that predate this guard; each has an open stack moving it off. */
const KNOWN = new Set([
  'pages/dashboard/next/KpiRow.tsx',
  'pages/dashboard/next/format.ts',
  'pages/reports/next/rp-format.ts',
])

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules') continue
      walk(full, out)
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

/** An import of `formatMoney` from `lib/utils`, by any relative or alias path. */
const IMPORTS_DOLLAR_FORMAT =
  /import\s*\{[^}]*\bformatMoney\b[^}]*\}\s*from\s*['"](?:@\/lib\/utils|(?:\.\.?\/)+(?:lib\/)?utils)['"]/

export function dollarFormatCallers(files: Array<[string, string]>): string[] {
  return files
    .filter(([, code]) => IMPORTS_DOLLAR_FORMAT.test(code))
    .map(([path]) => path)
    .sort()
}

describe('no new caller of the dollar-only formatMoney', () => {
  it('finds an import by alias or relative path', () => {
    expect(
      dollarFormatCallers([
        ['a.tsx', "import { cn, formatMoney } from '@/lib/utils'"],
        ['b.ts', "import {\n  formatMoney,\n} from '../../lib/utils'"],
        ['c.ts', "import { formatMoney } from '@/lib/currency'"],
        ['d.ts', "import { cn } from '@/lib/utils'"],
      ]),
    ).toEqual(['a.tsx', 'b.ts'])
  })

  it('is imported by no file outside the known three', () => {
    const files = walk(SRC)
      .filter((f) => !f.endsWith('no-new-dollar-formatmoney.test.ts'))
      .map((f): [string, string] => [relative(SRC, f).split(sep).join('/'), readFileSync(f, 'utf8')])
    const extra = dollarFormatCallers(files).filter((p) => !KNOWN.has(p))
    expect(extra).toEqual([])
  })
})
