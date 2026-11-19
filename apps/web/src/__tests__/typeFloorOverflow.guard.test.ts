/**
 * Lifting text to 11 px must not push it out of its box. Two overflows the
 * 2026-11-18 walk measured: the calendar record tag (2 px past the card at 375)
 * and the tucked counter's verb word (3 px past its button at 1440, every page).
 * jsdom has no layout, so this pins the rules that keep them inside.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8')
const rule = (css: string, selector: string) => {
  const m = css.match(new RegExp(`(^|\\n)${selector.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`))
  if (!m) throw new Error(`no rule for ${selector}`)
  return m[2]
}

describe('type floor overflow', () => {
  const shell = read('components/mudavym/house-shell.css')
  const cal = read('pages/calendar/next/calendar-next.css')

  it('the tucked counter fits its longest verb word at 11px', () => {
    const word = rule(shell, '.mdv-counter__stripword')
    expect(word).toMatch(/font-size:\s*11px/)
    expect(word).toMatch(/max-width:\s*100%/)
    // "PROPOSED" is 8 mono glyphs: 8 x (0.6em + 0.02em) x 11px ~ 55px, so the button needs >= 58px.
    const w = (sel: string) => Number(rule(shell, sel).match(/width:\s*(\d+)px/)![1])
    expect(w('.mdv-counter__stripverb')).toBeGreaterThanOrEqual(58)
    expect(w('.mdv-counter--strip')).toBeGreaterThanOrEqual(w('.mdv-counter__stripverb') + 8)
  })

  it('the calendar record tag wraps instead of overflowing its card', () => {
    // break-word + hyphens: a long tag wraps at word boundaries; only a single over-long word may split.
    // `anywhere` shrank min-content and let the tag break mid-word at 375 px (r63 walk).
    expect(rule(cal, '.cn-record-tag')).toMatch(/overflow-wrap:\s*break-word/)
    expect(rule(cal, '.cn-record-tag')).not.toMatch(/overflow-wrap:\s*anywhere/)
    expect(rule(cal, '.cn-record-tag')).toMatch(/hyphens:\s*auto/)
    expect(rule(cal, '.cn-record-tag')).toMatch(/min-width:\s*0/)
    expect(rule(cal, '.cn-record')).toMatch(/max-width:\s*100%/)
  })
})
