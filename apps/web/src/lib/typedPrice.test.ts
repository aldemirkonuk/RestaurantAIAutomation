/**
 * Onboarding r22 D6. The vectors are the gateway's `parseMenuPrice` spec
 * (apps/api-gateway/src/menus/menus.service.spec.ts, menu r21 #1252), so the
 * same text reads the same on /get-started and on /menu.
 */
import { describe, expect, it } from 'vitest'
import { readTypedPrice } from './typedPrice'

const value = (raw: string) => {
  const r = readTypedPrice(raw)
  return 'value' in r ? r.value : 'refused'
}

describe('readTypedPrice', () => {
  it('reads a dot or a comma decimal, thousands groups and a currency mark', () => {
    expect(value('70')).toBe(70)
    expect(value('24,50')).toBe(24.5)
    expect(value('45.50')).toBe(45.5)
    expect(value('45,5')).toBe(45.5)
    expect(value('$70')).toBe(70)
    expect(value('45 TL')).toBe(45)
    expect(value('₺ 1 250')).toBe(1250)
    expect(value('1.250,00')).toBe(1250)
    expect(value('1,250.75')).toBe(1250.75)
    expect(value('1.250.000')).toBe(1250000)
    expect(value('0')).toBe(0)
  })

  it('reads an empty box as no price, never zero', () => {
    expect(value('')).toBeNull()
    expect(value('   ')).toBeNull()
  })

  it('refuses a minus, letters, two decimals and a three-digit tail it cannot place', () => {
    for (const raw of ['-5', 'abc', 'TL', '12.5.1', '1,2.50', '1.250,505', '.5', '24,']) expect(value(raw)).toBe('refused')
    const r = readTypedPrice('1,250')
    expect('refused' in r && r.refused).toBe('"1,250" is not a price: it could be 1250 or 1.25; write it as 1250 or 1.25.')
    const k = readTypedPrice('1.000')
    expect('refused' in k && k.refused).toMatch(/could be 1000 or 1;/)
  })
})
