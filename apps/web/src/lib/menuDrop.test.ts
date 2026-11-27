import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ photosToPages: vi.fn() }))
vi.mock('./menuPhotos', async (orig) => ({
  ...(await orig<typeof import('./menuPhotos')>()),
  photosToPages: h.photosToPages,
}))
import { readDroppedMenu } from './menuDrop'

const file = (name: string, type: string, bytes = 10) =>
  new File([new Uint8Array(bytes)], name, { type })

beforeEach(() => {
  h.photosToPages.mockReset()
  h.photosToPages.mockImplementation(async (files: File[]) => files.map((f) => `page:${f.name}`))
})

describe('the first-menu drop zone (r105 g4)', () => {
  it('a PDF routes to the file reader with the file in hand, not dropped', async () => {
    const pdf = file('menu.pdf', 'application/pdf')
    const out = await readDroppedMenu([pdf])
    expect(out).toEqual({ kind: 'files', files: [pdf] })
    expect(h.photosToPages).not.toHaveBeenCalled()
  })

  it('three photos are all read, in the order dropped', async () => {
    const a = file('a.jpg', 'image/jpeg')
    const b = file('b.jpg', 'image/jpeg')
    const c = file('c.jpg', 'image/jpeg')
    const out = await readDroppedMenu([a, b, c])
    expect(h.photosToPages).toHaveBeenCalledWith([a, b, c])
    expect(out).toEqual({ kind: 'pages', pages: ['page:a.jpg', 'page:b.jpg', 'page:c.jpg'] })
  })

  it('a photo and a PDF together go to the file reader, none dropped', async () => {
    const photo = file('p.jpg', 'image/jpeg')
    const pdf = file('m.pdf', 'application/pdf')
    const out = await readDroppedMenu([photo, pdf])
    expect(out).toEqual({ kind: 'files', files: [photo, pdf] })
  })

  it('a large phone photo is redrawn, never sent raw', async () => {
    const big = file('IMG_1.jpg', 'image/jpeg', 14 * 1024 * 1024)
    const out = await readDroppedMenu([big])
    expect(h.photosToPages).toHaveBeenCalledWith([big])
    expect(out).toEqual({ kind: 'pages', pages: ['page:IMG_1.jpg'] })
  })

  it('a photo that cannot be opened is refused in the words of the error', async () => {
    h.photosToPages.mockRejectedValue(new Error('x.heic could not be opened in this browser.'))
    const out = await readDroppedMenu([file('x.heic', 'image/heic')])
    expect(out).toEqual({ kind: 'refused', words: 'x.heic could not be opened in this browser.' })
  })

  it('a file that is not a menu is refused with a sentence', async () => {
    const out = await readDroppedMenu([file('notes.exe', 'application/x-msdownload')])
    expect(out.kind).toBe('refused')
    expect((out as { words: string }).words.length).toBeGreaterThan(0)
  })
})
