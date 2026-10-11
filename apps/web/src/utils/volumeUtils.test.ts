import { describe, expect, it } from 'vitest'
import { isValidBottleSize, parseVolumeInput } from './volumeUtils'

/**
 * F-834: custom bottle and pour sizes refused "1,5 L" and "37,5" while the
 * price fields beside them took "12,50", and there was no cl at all.
 */
describe('parseVolumeInput', () => {
  it('reads the sizes it always read', () => {
    expect(parseVolumeInput('750')?.ml).toBe(750)
    expect(parseVolumeInput('750ml')?.ml).toBe(750)
    expect(parseVolumeInput('1.5 L')?.ml).toBe(1500)
    expect(parseVolumeInput('5 oz')?.ml).toBe(148)
  })

  it('reads a decimal comma, as the price fields do', () => {
    expect(parseVolumeInput('1,5 L')?.ml).toBe(1500)
    expect(parseVolumeInput('37,5')?.ml).toBe(38)
    expect(parseVolumeInput('187,5 ml')?.ml).toBe(188)
  })

  it('reads centilitres', () => {
    expect(parseVolumeInput('75cl')?.ml).toBe(750)
    expect(parseVolumeInput('37,5 cl')?.ml).toBe(375)
  })

  it('refuses what is not a size', () => {
    expect(parseVolumeInput('')).toBeNull()
    expect(parseVolumeInput('abc')).toBeNull()
    expect(parseVolumeInput('1,5,0 L')).toBeNull()
    expect(parseVolumeInput('0 ml')).toBeNull()
  })
})

describe('isValidBottleSize', () => {
  it('takes a US half-barrel keg, as the gateway does (F-1383)', () => {
    expect(isValidBottleSize(58674)).toBe(true)
    expect(isValidBottleSize(parseVolumeInput('58674ml')!.ml)).toBe(true)
    expect(isValidBottleSize(60001)).toBe(false)
    expect(isValidBottleSize(20)).toBe(false)
  })
})
