/**
 * The socket client is a signed-in-only cost: it is fetched when a session in a
 * house opens a socket, never with the entry that every cold route (landing,
 * /register, /login) downloads. A static value import of it anywhere in src/
 * would put engine.io and socket.io back into that entry.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return f === '__tests__' ? [] : sources(p)
    return /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : []
  })
}

describe('entry chunk', () => {
  it('no source file imports socket.io-client as a value', () => {
    const offenders = sources(join(__dirname, '..')).filter((p) =>
      /^\s*import\s+(?!type\b)[^'"\n]*from\s+['"]socket\.io-client['"]/m.test(readFileSync(p, 'utf8')),
    )
    expect(offenders).toEqual([])
  })
})
