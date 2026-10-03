/**
 * ProvenanceHover — the popover stays inside the box that clips it.
 *
 * Walk-through RECEIPTS-W36 (2026-10-01), measured headless on /receipts: the
 * line table scrolls inside its own box, and the line total's popover ran 260px
 * right from the field, so 181px of it were hidden at 1600px and 1024px and
 * "Correct this" was cut in half on a 375px phone. On open it now moves left
 * just far enough to fit, narrows when even that is not enough, and opens
 * upward when there is no room below. jsdom has no layout, so the boxes are
 * stated here.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ProvenanceHover } from '../ProvenanceHover'

const envelope = {
  source: 'extracted' as const,
  confidence: null,
  page: 1,
  as_printed: '7.440,00',
  verified_by: null,
  verified_at: null,
}

type Box = { left: number; right: number; top: number; bottom: number }
const rect = (b: Box) =>
  ({ ...b, x: b.left, y: b.top, width: b.right - b.left, height: b.bottom - b.top, toJSON: () => b }) as DOMRect

/** The scroll box, the field, and the popover's own height. */
function setup(clip: Box, field: Box, popHeight = 80) {
  render(
    <div data-testid="clip" style={{ overflowX: 'auto' }}>
      <ProvenanceHover
        label="Line total, line 2"
        envelope={envelope}
        path="lines[1].netAmount"
        onCorrect={vi.fn()}
        onVerify={vi.fn()}
      >
        7.440,00
      </ProvenanceHover>
    </div>,
  )
  const clipEl = screen.getByTestId('clip')
  const trigger = screen.getByRole('button', { name: 'Where Line total, line 2 came from' })
  const wrap = trigger.parentElement as HTMLElement
  const real = Element.prototype.getBoundingClientRect
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this === clipEl) return rect(clip)
    if (this === wrap) return rect(field)
    if ((this as HTMLElement).classList?.contains('cd-provenance-pop'))
      return rect({ left: 0, right: 260, top: 0, bottom: popHeight })
    return real.call(this)
  })
  fireEvent.mouseEnter(wrap)
  const pop = document.querySelector('.cd-provenance-pop') as HTMLElement
  return { pop }
}

afterEach(() => vi.restoreAllMocks())

describe('ProvenanceHover placement (W36)', () => {
  it('opens to the right of a field with room, as before', () => {
    const { pop } = setup({ left: 0, right: 900, top: 0, bottom: 900 }, { left: 100, right: 156, top: 100, bottom: 117 })
    expect(pop.style.left).toBe('0px')
    expect(pop.style.width).toBe('260px')
    expect(pop.dataset.place).toBe('down')
  })

  it('moves left just far enough when the field is near the right edge of its box', () => {
    // 1024 wide as measured (jsdom's own width): box 256–948, the line total at 869.
    const { pop } = setup({ left: 256, right: 948, top: 0, bottom: 900 }, { left: 869, right: 925, top: 100, bottom: 117 })
    // 948 - 260 - 869 = -181: the popover's right edge meets the box's.
    expect(pop.style.left).toBe('-181px')
    expect(pop.style.width).toBe('260px')
  })

  it('narrows to the box on a screen narrower than the popover', () => {
    const { pop } = setup({ left: 16, right: 216, top: 0, bottom: 900 }, { left: 150, right: 200, top: 100, bottom: 117 })
    expect(pop.style.width).toBe('200px')
    // Its left edge sits on the box's left edge: 16 - 150.
    expect(pop.style.left).toBe('-134px')
  })

  it('stays inside the screen when nothing between it and the page clips it', () => {
    // No clipping box: the screen is the limit (jsdom is 1024 wide).
    render(
      <ProvenanceHover label="Seller" envelope={envelope}>
        Bağcılık
      </ProvenanceHover>,
    )
    const trigger = screen.getByRole('button', { name: 'Where Seller came from' })
    const wrap = trigger.parentElement as HTMLElement
    const real = Element.prototype.getBoundingClientRect
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this === wrap) return rect({ left: 900, right: 960, top: 100, bottom: 117 })
      return real.call(this)
    })
    fireEvent.mouseEnter(wrap)
    const pop = document.querySelector('.cd-provenance-pop') as HTMLElement
    expect(pop.style.left).toBe(`${window.innerWidth - 260 - 900}px`)
  })

  it('opens upward when the box has no room below the field and room above it', () => {
    const { pop } = setup({ left: 0, right: 900, top: 0, bottom: 400 }, { left: 100, right: 156, top: 360, bottom: 377 }, 80)
    expect(pop.dataset.place).toBe('up')
    expect(pop.style.bottom).toBe('100%')
    expect(pop.style.paddingBottom).toBe('4px')
    expect(pop.style.top).toBe('')
  })

  it('stays below when there is no room above either', () => {
    const { pop } = setup({ left: 0, right: 900, top: 0, bottom: 120 }, { left: 100, right: 156, top: 30, bottom: 47 }, 80)
    expect(pop.dataset.place).toBe('down')
    expect(pop.style.top).toBe('100%')
    expect(pop.style.paddingTop).toBe('4px')
  })
})
