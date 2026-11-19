/**
 * The three big pages (Reports, Connections, Settings) sit at the 11 px floor
 * with no ceiling left in the allowlist: a new small size there fails here, not
 * just on the file-by-file ratchet. Eyebrows and chips that were lifted from 8.5
 * to 10.5 px carry at most 0.08em of tracking so the wider type does not wrap.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain ESM tool, shared with the codemod CLI
import { readAllowlist, scan, SRC } from '../../tools/typeFloor.mjs'

const FOLDERS = ['pages/reports/', 'pages/connections/']

describe('type floor on the big pages', () => {
  it.each(FOLDERS)('%s has no site under 11px and no allowlist ceiling', (folder) => {
    const sites = Object.keys(scan()).filter((f) => f.startsWith(folder))
    expect(sites).toEqual([])
    expect(Object.keys(readAllowlist()).filter((f) => f.startsWith(folder))).toEqual([])
  })

  it.each(['pages/reports/next/reports-next.css', 'pages/connections/next/connections-next.css'])(
    '%s keeps tracking at 0.08em or less where the type was lifted',
    (file) => {
      const css = readFileSync(join(SRC, file), 'utf8')
      const wide = [...css.matchAll(/\{[^{}]*\}/g)]
        .map((m) => m[0])
        .filter((b) => /font-size:\s*11px/.test(b))
        .filter((b) => [...b.matchAll(/letter-spacing:\s*(\d*\.?\d+)em/g)].some((m) => +m[1] > 0.08))
      expect(wide).toEqual([])
    },
  )
})
