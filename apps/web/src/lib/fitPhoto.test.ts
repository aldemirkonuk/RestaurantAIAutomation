/** r28 onboarding gap 12: a menu photo is fitted before it is sent to the reader. */
import { describe, expect, it, vi } from 'vitest'
import {
  base64Bytes,
  fitPhotoForReading,
  fittedSize,
  READ_LONG_EDGE,
  READ_MAX_BYTES,
  READ_QUALITY,
  READ_QUALITY_SMALLER,
  sniffMime,
  splitPhoto,
  type PhotoCodec,
} from './fitPhoto'

const JPEG = '/9j/4AAQSkZJRgABAQ=='
const PNG = 'iVBORw0KGgoAAAANSUhEUg=='
const PDF = 'JVBERi0xLjQK'
/** A base64 string whose decoded size is `bytes`. */
const ofBytes = (bytes: number, head = '/9j/') => head + 'A'.repeat(Math.ceil((bytes * 4) / 3) - head.length)

function codec(over: Partial<PhotoCodec> & { size?: [number, number]; out?: string[] } = {}) {
  const outs = [...(over.out ?? ['data:image/jpeg;base64,/9j/SMALL'])]
  const encode = vi.fn(() => outs.shift() ?? 'data:image/jpeg;base64,/9j/SMALL')
  const decode = vi.fn(async () => ({ width: over.size?.[0] ?? 1000, height: over.size?.[1] ?? 800, source: {} as CanvasImageSource }))
  return {
    canDraw: over.canDraw ?? (() => true),
    decode: over.decode ?? decode,
    encode: over.encode ?? encode,
    calls: { encode, decode },
  }
}

describe('the photo forms', () => {
  it('sniffs the media type as the gateway does', () => {
    expect(sniffMime(JPEG)).toBe('image/jpeg')
    expect(sniffMime(PNG)).toBe('image/png')
    expect(sniffMime('UklGRiQAAABXRUJQ')).toBe('image/webp')
    expect(sniffMime('R0lGODlhAQAB')).toBe('image/gif')
    expect(sniffMime(PDF)).toBe('application/pdf')
    expect(sniffMime('AAAAGGZ0eXBoZWlj')).toBe('image/jpeg')
  })

  it('splits a data URL into its type and bare base64, and leaves bare base64 bare', () => {
    expect(splitPhoto(`data:image/png;base64,${PNG}`)).toEqual({ mime: 'image/png', base64: PNG })
    expect(splitPhoto(`data:;base64,${PNG}`)).toEqual({ mime: 'image/png', base64: PNG })
    expect(splitPhoto(JPEG)).toEqual({ mime: 'image/jpeg', base64: JPEG })
  })

  it('counts decoded bytes, padding included', () => {
    expect(base64Bytes('AAAA')).toBe(3)
    expect(base64Bytes('AAA=')).toBe(2)
    expect(base64Bytes('AA==')).toBe(1)
  })

  it('scales the long edge down to the limit and never enlarges', () => {
    expect(fittedSize(4032, 3024)).toEqual({ width: READ_LONG_EDGE, height: 1536 })
    expect(fittedSize(3024, 4032)).toEqual({ width: 1536, height: READ_LONG_EDGE })
    expect(fittedSize(800, 600)).toEqual({ width: 800, height: 600 })
  })
})

describe('fitPhotoForReading', () => {
  it('a dropped data URL goes to the reader as bare base64, and to the page as a data URL', async () => {
    const c = codec()
    const out = await fitPhotoForReading(`data:image/jpeg;base64,${JPEG}`, c)
    expect(out).toEqual({ base64: JPEG, dataUrl: `data:image/jpeg;base64,${JPEG}`, mime: 'image/jpeg', fitted: false })
    expect(c.calls.encode).not.toHaveBeenCalled()
  })

  it("the photo box's bare base64 gets a data URL for the page", async () => {
    const out = await fitPhotoForReading(PNG, codec())
    expect(out.base64).toBe(PNG)
    expect(out.dataUrl).toBe(`data:image/png;base64,${PNG}`)
  })

  it('a phone photo larger than the long edge is redrawn as a JPEG at the fitted size', async () => {
    const c = codec({ size: [4032, 3024] })
    const out = await fitPhotoForReading(`data:image/jpeg;base64,${JPEG}`, c)
    expect(c.calls.encode).toHaveBeenCalledWith(expect.anything(), READ_LONG_EDGE, 1536, READ_QUALITY)
    expect(out).toEqual({ base64: '/9j/SMALL', dataUrl: 'data:image/jpeg;base64,/9j/SMALL', mime: 'image/jpeg', fitted: true })
  })

  it('one pixel past the long edge is redrawn; the long edge itself is not', async () => {
    const past = codec({ size: [READ_LONG_EDGE + 1, 1000] })
    expect((await fitPhotoForReading(JPEG, past)).fitted).toBe(true)
    const at = codec({ size: [1000, READ_LONG_EDGE] })
    expect((await fitPhotoForReading(JPEG, at)).fitted).toBe(false)
  })

  it('a photo past the byte limit is redrawn even when it is small in pixels', async () => {
    const c = codec({ size: [1200, 900] })
    const out = await fitPhotoForReading(ofBytes(READ_MAX_BYTES + 10), c)
    expect(c.calls.encode).toHaveBeenCalledWith(expect.anything(), 1200, 900, READ_QUALITY)
    expect(out.fitted).toBe(true)
  })

  it('a photo just under both limits is sent as it came', async () => {
    const c = codec({ size: [READ_LONG_EDGE, 1000] })
    const out = await fitPhotoForReading(ofBytes(READ_MAX_BYTES - 10), c)
    expect(c.calls.encode).not.toHaveBeenCalled()
    expect(out.fitted).toBe(false)
  })

  it('a redraw still past the byte limit is drawn again at the lower quality', async () => {
    const big = `data:image/jpeg;base64,${ofBytes(READ_MAX_BYTES + 10)}`
    const c = codec({ size: [4032, 3024], out: [big, 'data:image/jpeg;base64,/9j/SMALLER'] })
    const out = await fitPhotoForReading(JPEG, c)
    expect(c.calls.encode).toHaveBeenNthCalledWith(2, expect.anything(), READ_LONG_EDGE, 1536, READ_QUALITY_SMALLER)
    expect(out.base64).toBe('/9j/SMALLER')
  })

  it('a form the reader does not take (HEIC the browser can open) is redrawn as a JPEG', async () => {
    const c = codec({ size: [800, 600] })
    const out = await fitPhotoForReading('data:image/heic;base64,AAAAGGZ0eXBoZWlj', c)
    expect(c.calls.encode).toHaveBeenCalledWith(expect.anything(), 800, 600, READ_QUALITY)
    expect(out.mime).toBe('image/jpeg')
  })

  it('a photo this browser cannot open goes as it came, never refused here', async () => {
    const c = codec({ decode: vi.fn(async () => Promise.reject(new Error('cannot open'))) })
    const out = await fitPhotoForReading('data:image/heic;base64,AAAAGGZ0eXBoZWlj', c)
    expect(out).toEqual({
      base64: 'AAAAGGZ0eXBoZWlj',
      dataUrl: 'data:image/heic;base64,AAAAGGZ0eXBoZWlj',
      mime: 'image/heic',
      fitted: false,
    })
  })

  it('a canvas that gives back no JPEG (an empty "data:,") leaves the photo as it came', async () => {
    const c = codec({ size: [4032, 3024], out: ['data:,'] })
    const out = await fitPhotoForReading(JPEG, c)
    expect(out.base64).toBe(JPEG)
    expect(out.fitted).toBe(false)
  })

  it('a failed redraw leaves the photo as it came', async () => {
    const c = codec({ size: [4032, 3024], encode: vi.fn(() => { throw new Error('out of memory') }) })
    const out = await fitPhotoForReading(JPEG, c)
    expect(out.base64).toBe(JPEG)
    expect(out.fitted).toBe(false)
  })

  it('a PDF is never opened or redrawn, and gives the page no image', async () => {
    const c = codec()
    const out = await fitPhotoForReading(PDF, c)
    expect(out).toEqual({ base64: PDF, dataUrl: null, mime: 'application/pdf', fitted: false })
    expect(c.calls.decode).not.toHaveBeenCalled()
  })

  it('with no canvas (this test runner), the photo goes as it came, with no wait', async () => {
    const c = codec({ canDraw: () => false })
    const out = await fitPhotoForReading(`data:image/jpeg;base64,${JPEG}`, c)
    expect(out.base64).toBe(JPEG)
    expect(c.calls.decode).not.toHaveBeenCalled()
  })

  it('the browser codec here has no canvas, so nothing waits on an image that never loads', async () => {
    const out = await fitPhotoForReading(`data:image/png;base64,${PNG}`)
    expect(out).toEqual({ base64: PNG, dataUrl: `data:image/png;base64,${PNG}`, mime: 'image/png', fitted: false })
  })
})
