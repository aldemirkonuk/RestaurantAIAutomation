import { describe, expect, it } from 'vitest'
import { fitWithin, isPhoto, MAX_PAGES, MAX_TOTAL_BASE64, pagesProblem } from './menuPhotos'

describe('menu photos made ready on the device', () => {
  it('a photo is a photo by its type or, when the browser gives none, by its name', () => {
    expect(isPhoto(new File(['x'], 'a.jpg', { type: 'image/jpeg' }))).toBe(true)
    expect(isPhoto(new File(['x'], 'IMG_0001.HEIC', { type: '' }))).toBe(true)
    expect(isPhoto(new File(['x'], 'menu.pdf', { type: 'application/pdf' }))).toBe(false)
    expect(isPhoto(new File(['x'], 'menu.csv', { type: 'text/csv' }))).toBe(false)
  })

  it('shrinks the long side to 2000 and never enlarges', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2000, height: 1500 })
    expect(fitWithin(3024, 4032)).toEqual({ width: 1500, height: 2000 })
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
  })

  it('refuses more pages than the gateway joins, and a set too heavy to send, in words', () => {
    expect(pagesProblem(['a', 'b'])).toBeNull()
    expect(pagesProblem(Array(MAX_PAGES + 1).fill('a'))).toMatch(/at most 20 pages; you chose 21/)
    expect(pagesProblem(['x'.repeat(MAX_TOTAL_BASE64 + 1)])).toMatch(/too large to send together/)
  })
})
