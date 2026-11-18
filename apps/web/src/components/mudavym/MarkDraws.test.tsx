import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MarkDraws } from './MarkDraws'

type Call = { keyframes: Keyframe[]; options: KeyframeAnimationOptions }
let calls: Call[] = []
let reduced = false

beforeEach(() => {
  calls = []
  reduced = false
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: vi.fn(function (this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      calls.push({ keyframes, options })
      return { cancel() {}, finish() {} }
    }),
  })
  window.matchMedia = ((q: string) => ({
    matches: reduced && q.includes('reduce'),
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})
afterEach(() => {
  // @ts-expect-error test cleanup
  delete Element.prototype.animate
})

describe('MarkDraws', () => {
  it('brings the name in whole in one 280 ms fade, never a clip wipe through a glyph', () => {
    render(<MarkDraws />)
    const name = calls[0]
    expect(name.options.duration).toBe(280)
    expect(JSON.stringify(name.keyframes)).not.toContain('clipPath')
    expect(Object.keys(name.keyframes[0]).sort()).toEqual(['opacity', 'transform'])
    for (const c of calls) expect(Number(c.options.delay ?? 0) + Number(c.options.duration)).toBeLessThanOrEqual(660)
  })

  it('collapses every step to its end state under reduced motion', () => {
    reduced = true
    render(<MarkDraws />)
    expect(calls.length).toBe(4)
    for (const c of calls) expect(c.options.duration).toBe(0)
  })

  it('renders the finished mark with no motion when play is false', () => {
    render(<MarkDraws play={false} />)
    expect(calls).toHaveLength(0)
  })

  it('stays one labelled image', () => {
    const { getByRole } = render(<MarkDraws />)
    expect(getByRole('img').getAttribute('aria-label')).toBe('Mudavym')
  })
})
