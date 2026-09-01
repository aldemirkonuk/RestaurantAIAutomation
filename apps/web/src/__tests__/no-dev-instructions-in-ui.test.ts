/**
 * No user-facing string tells a customer to run a terminal command.
 *
 * The login screen on the production domain showed:
 *
 *   "Cannot reach server. Start the API Gateway: cd apps/api-gateway && pnpm start:dev"
 *
 * to a person who has no repository, no terminal, and no gateway to start —
 * and it was wrong about the cause anyway (the gateway was healthy; the real
 * failure was a CORS-blocked origin, which a browser surfaces as an
 * indistinguishable network error). A message that instructs the reader to do
 * something impossible is worse than one that admits it does not know.
 *
 * This guard is deliberately narrow: it flags shell-shaped instructions inside
 * string literals, not the words themselves. Comments and identifiers are
 * ignored, so explaining the history — as the file above does — stays legal.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const SRC = join(__dirname, '..')

/** Shell instructions that must never appear inside a rendered string. */
const DEV_INSTRUCTION = /(pnpm|npm|yarn|bun)\s+(run\s+)?(start|dev|start:dev|build)\b|cd\s+apps\//

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

/**
 * Strip comments so a string literal is the only thing left that can match.
 * Conservative on purpose: it never strips a trailing comment sharing a line
 * with code, so a real violation cannot be hidden by this function.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      return !t.startsWith('//') && !t.startsWith('*')
    })
    .join('\n')
}

/** Single- and double-quoted literals plus template chunks. */
function stringLiterals(source: string): string[] {
  return source.match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g) ?? []
}

describe('user-facing copy', () => {
  it('never instructs the reader to run a terminal command', () => {
    const offenders: string[] = []

    for (const file of walk(SRC)) {
      const source = stripComments(readFileSync(file, 'utf8'))
      for (const literal of stringLiterals(source)) {
        if (DEV_INSTRUCTION.test(literal)) {
          offenders.push(`${file.replace(SRC, 'src')}: ${literal.slice(0, 90)}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })
})
