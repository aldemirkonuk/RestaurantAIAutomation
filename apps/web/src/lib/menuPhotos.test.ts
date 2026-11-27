import { describe, expect, it, vi } from 'vitest'
import { fitWithin, isPhoto, MAX_EDGE, MAX_PAGES, MAX_TOTAL_BASE64, ONE_PAGE_EDGE, pagesProblem, photoToJpegBase64, photosToPages } from './menuPhotos'

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

  it('a single photo keeps up to 2576 px (what the high-resolution readers see); pages of several, 2000', () => {
    expect(ONE_PAGE_EDGE).toBe(2576)
    expect(MAX_EDGE).toBe(2000)
    // A 12-megapixel phone photo, alone: shrunk only to 2576 on its long side.
    expect(fitWithin(4032, 3024, ONE_PAGE_EDGE)).toEqual({ width: 2576, height: 1932 })
    // Both edges sit above the 1568 px the current reader (claude-haiku-4-5) is shown.
    expect(Math.min(ONE_PAGE_EDGE, MAX_EDGE)).toBeGreaterThan(1568)
  })

  it('refuses more pages than the gateway joins, and a set too heavy to send, in words', () => {
    expect(pagesProblem(['a', 'b'])).toBeNull()
    expect(pagesProblem(Array(MAX_PAGES + 1).fill('a'))).toMatch(/at most 20 pages; you chose 21/)
    expect(pagesProblem(['x'.repeat(MAX_TOTAL_BASE64 + 1)])).toMatch(/too large to send together/)
  })
})

describe('a turned page is drawn upright', () => {
  function stubCanvas(natural: { w: number; h: number }) {
    const calls: Array<[string, ...number[]]> = [];
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        fillStyle: '',
        fillRect: () => undefined,
        translate: (...a: number[]) => calls.push(['translate', ...a]),
        rotate: (...a: number[]) => calls.push(['rotate', ...a]),
        drawImage: (...a: unknown[]) => calls.push(['drawImage', ...(a.slice(1) as number[])]),
      }),
      toDataURL: () => 'data:image/jpeg;base64,AAAA',
    };
    const make = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => (tag === 'canvas' ? canvas : make(tag))) as typeof document.createElement);
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = natural.w;
        naturalHeight = natural.h;
        onload: (() => void) | null = null;
        set src(_v: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    return { canvas, calls };
  }

  it('a 90-degree turn swaps the canvas width and height and rotates the draw', async () => {
    const { canvas, calls } = stubCanvas({ w: 1000, h: 500 });
    await photoToJpegBase64(new File(['x'], 'a.jpg', { type: 'image/jpeg' }), 2576, 90);
    expect([canvas.width, canvas.height]).toEqual([500, 1000]);
    expect(calls.some((c) => c[0] === 'rotate' && Math.abs((c[1] as number) - Math.PI / 2) < 1e-9)).toBe(true);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  })

  it('no turn, and a 180, keep the canvas as the photo is', async () => {
    const a = stubCanvas({ w: 1000, h: 500 });
    await photoToJpegBase64(new File(['x'], 'a.jpg', { type: 'image/jpeg' }), 2576, 0);
    expect([a.canvas.width, a.canvas.height]).toEqual([1000, 500]);
    await photoToJpegBase64(new File(['x'], 'a.jpg', { type: 'image/jpeg' }), 2576, 180);
    expect([a.canvas.width, a.canvas.height]).toEqual([1000, 500]);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  })

  it('photosToPages hands each page its own turn by index', async () => {
    const { canvas } = stubCanvas({ w: 1000, h: 500 });
    const files = [new File(['x'], 'a.jpg', { type: 'image/jpeg' }), new File(['x'], 'b.jpg', { type: 'image/jpeg' })];
    // Page 0 stays, page 1 turns: the canvas of the last draw is the turned one.
    await photosToPages(files, { 1: 90 });
    expect([canvas.width, canvas.height]).toEqual([500, 1000]);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  })
})
