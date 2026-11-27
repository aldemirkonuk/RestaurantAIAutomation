import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every `.mdv-spread-*` class endpaper.css styles is rendered by some source
 * file. #1871 had to drop seven rules nothing rendered to get under the CI
 * audit's 30K bound; this keeps a dead rule from coming back unseen.
 */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) sources(path, out)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path)
  }
  return out
}

describe('endpaper.css .mdv-spread-* rules', () => {
  it('styles only classes some source renders', () => {
    const src = resolve(process.cwd(), 'src')
    const css = readFileSync(join(src, 'components/brand/endpaper.css'), 'utf8')
    const classes = [...new Set(css.match(/\.mdv-spread-[a-z0-9-]+/g) ?? [])].map((c) => c.slice(1))
    expect(classes.length).toBeGreaterThan(5)
    const code = sources(src).map((f) => readFileSync(f, 'utf8')).join('\n')
    const unrendered = classes.filter((c) => !new RegExp(`${c}(?![a-z0-9-])`).test(code))
    expect(unrendered).toEqual([])
  })
})
