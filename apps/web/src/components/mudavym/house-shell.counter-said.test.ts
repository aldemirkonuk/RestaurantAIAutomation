import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The rail's "The house said" log holds the height of its first entry before there is one (r103 mail-8, the walk's
 * layout shift on the first line said). jsdom does no layout, so this pins the rule that holds the height.
 */
const css = readFileSync(join(__dirname, 'house-shell.css'), 'utf8')
const rule = (selector: string) => {
  const m = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)
  return m ? m[1] : ''
}

describe('the rail log', () => {
  it('reserves one entry for "Nothing yet" and for the first entry alike', () => {
    expect(rule('.mdv-counter__said .mdv-counter__quiet')).toMatch(/min-height:\s*51px/)
    expect(rule('.mdv-counter__said .mdv-counter__saidlist')).toMatch(/min-height:\s*51px/)
  })

  it('takes the quiet line\'s own margin away so the two states do not differ by it', () => {
    expect(rule('.mdv-counter__said .mdv-counter__quiet')).toMatch(/margin:\s*0\s*;/)
  })

  it('holds the foot at its two-line height so "reading" turning into "read ... Read now" moves nothing', () => {
    expect(rule('.mdv-counter__foot')).toMatch(/min-height:\s*53px/)
  })
})
