/**
 * F-1294: a CSV menu saved by Turkish Excel's default CSV is Windows-1254, and
 * `file.text()` read it as UTF-8, so every ş, ğ and ı was lost.
 */
import { describe, expect, it } from 'vitest'
import { CSV_NOT_READABLE, decodeCsvBytes, readMenuCsv } from './menuCsvText'

/** Text as Windows-1254 bytes (the Turkish letters Excel writes). */
const cp1254 = (text: string) => {
  const map: Record<string, number> = { Ş: 0xde, ş: 0xfe, ı: 0xfd, İ: 0xdd, ğ: 0xf0, Ğ: 0xd0, ü: 0xfc, ö: 0xf6, ç: 0xe7 }
  return new Uint8Array([...text].map((ch) => map[ch] ?? ch.charCodeAt(0)))
}

describe('decodeCsvBytes (F-1294)', () => {
  it('reads a UTF-8 file as UTF-8', () => {
    expect(decodeCsvBytes(new TextEncoder().encode('Ad;Şişe Fiyatı\nYakut;850\n'), 'tr-TR')).toBe('Ad;Şişe Fiyatı\nYakut;850\n')
  })

  it('reads a Turkish Excel CSV (Windows-1254) in a Turkish house', () => {
    expect(decodeCsvBytes(cp1254('Ad;Şişe Fiyatı\nKavaklıdere Yakut;850\n'), 'tr-TR')).toBe(
      'Ad;Şişe Fiyatı\nKavaklıdere Yakut;850\n',
    )
  })

  it('reads a non-UTF-8 file as Windows-1252 anywhere else', () => {
    expect(decodeCsvBytes(new Uint8Array([0x43, 0x68, 0xe2, 0x74, 0x65, 0x61, 0x75]), 'en-US')).toBe('Château')
  })

  it('refuses a file that still holds the replacement character, and names the Excel setting', () => {
    expect(() => decodeCsvBytes(new TextEncoder().encode('name\nCh�teau\n'), 'en-US')).toThrow(CSV_NOT_READABLE)
    expect(CSV_NOT_READABLE).toMatch(/CSV UTF-8/)
  })

  it('reads a picked file', async () => {
    await expect(readMenuCsv(new File([cp1254('Ad;Şişe\n')], 'menu.csv'), 'tr-TR')).resolves.toBe('Ad;Şişe\n')
  })
})
