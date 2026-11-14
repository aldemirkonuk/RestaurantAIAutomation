/**
 * r36 menu audit N3: the /menu read box sent a phone photo whole, and a file
 * too big for the reader was told the reader was "temporarily unavailable".
 */
import { describe, expect, it } from 'vitest'
import {
  MENU_FILE_MAX_BYTES,
  READER_PHOTO_MAX_BASE64,
  fittedPhotoRefusal,
  pickedSizeRefusal,
} from './menu-read-size'
import { scanPayload } from './MenuVersions'

const MB = 1024 * 1024

describe('pickedSizeRefusal: a file too big for one read is said at once', () => {
  it('refuses a PDF, CSV or workbook past 10 MB, naming its size', () => {
    expect(pickedSizeRefusal({ name: 'menu.pdf', type: 'application/pdf', size: 12 * MB })).toBe(
      'This file is 12.0 MB, and one read takes up to 10.0 MB. Divide the menu into smaller files and choose one.',
    )
    expect(pickedSizeRefusal({ name: 'menu.csv', type: 'text/csv', size: MENU_FILE_MAX_BYTES + 1 })).toMatch(/^This file is 10\.0 MB/)
  })

  it('lets a file at the cap, a photo of any size, and an unknown size through', () => {
    expect(pickedSizeRefusal({ name: 'menu.pdf', type: 'application/pdf', size: MENU_FILE_MAX_BYTES })).toBeNull()
    expect(pickedSizeRefusal({ name: 'menu.jpg', type: 'image/jpeg', size: 40 * MB })).toBeNull()
    expect(pickedSizeRefusal({ name: 'menu.pdf' })).toBeNull()
    expect(pickedSizeRefusal(null)).toBeNull()
  })
})

describe('fittedPhotoRefusal: a photo still too big after its fit is never sent', () => {
  const b64 = (n: number) => 'A'.repeat(n)

  it('lets a photo up to the reader’s 5 MB through', () => {
    expect(fittedPhotoRefusal({ base64: b64(READER_PHOTO_MAX_BASE64), mime: 'image/jpeg', fitted: true })).toBeNull()
  })

  it('says what to do: take it again when it was fitted, save as JPEG when the browser could not', () => {
    expect(fittedPhotoRefusal({ base64: b64(READER_PHOTO_MAX_BASE64 + 4), mime: 'image/jpeg', fitted: true })).toMatch(
      /^This photo is still 3\.8 MB after it was made smaller, and the reader takes photos up to 5 MB\. Take it again/,
    )
    expect(fittedPhotoRefusal({ base64: b64(READER_PHOTO_MAX_BASE64 + 4), mime: 'image/heic', fitted: false })).toMatch(
      /this browser could not make it smaller; the reader takes photos up to 5 MB\. Save it as a JPEG/,
    )
  })

  it('judges a PDF by the read’s 10 MB, not the photo cap', () => {
    expect(fittedPhotoRefusal({ base64: b64(8 * MB), mime: 'application/pdf', fitted: false })).toBeNull()
    expect(fittedPhotoRefusal({ base64: b64(14 * MB), mime: 'application/pdf', fitted: false })).toMatch(/^This file is 10\.5 MB/)
  })
})

describe('scanPayload: what the read box sends for a photo or PDF', () => {
  it('sends a small photo and a PDF as bare base64', async () => {
    const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], 'menu.jpg', { type: 'image/jpeg' })
    expect(await scanPayload(jpeg)).toBe('/9j/4AECAw==')
    const pdf = new File(['%PDF-1.4'], 'menu.pdf', { type: 'application/pdf' })
    expect(await scanPayload(pdf)).toBe('JVBERi0xLjQ=')
  })

  it('refuses a photo this browser cannot make smaller once it is past 5 MB, before anything is sent', async () => {
    const big = new Uint8Array(4 * MB)
    big.set([0xff, 0xd8, 0xff, 0xe0])
    await expect(scanPayload(new File([big], 'menu.jpg', { type: 'image/jpeg' }))).rejects.toThrow(
      /^This photo is 4\.0 MB, and this browser could not make it smaller/,
    )
  })
})
