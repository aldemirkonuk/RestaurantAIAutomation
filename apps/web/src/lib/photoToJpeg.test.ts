import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_PHOTO_EDGE, fitWithin, photoToJpegBase64 } from './photoToJpeg';

describe('fitWithin', () => {
  it('brings the long edge down to the limit and keeps the shape', () => {
    expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it('never enlarges a small photo', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });
});

describe('photoToJpegBase64', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function stubCanvas(dataUrl: string) {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as never);
    const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(dataUrl);
    return { drawImage, toDataURL };
  }

  it('draws a phone photo at 1600 px and sends it as JPEG', async () => {
    const close = vi.fn();
    const bitmap = { width: 4032, height: 3024, close };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
    const { drawImage, toDataURL } = stubCanvas('data:image/jpeg;base64,QUJD');
    const out = await photoToJpegBase64(new File(['x'], 'IMG.HEIC', { type: 'image/heic' }));
    expect(out).toBe('QUJD');
    expect(MAX_PHOTO_EDGE).toBe(1600);
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 1600, 1200);
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', expect.any(Number));
    expect(close).toHaveBeenCalled();
  });

  it('sends the file’s own bytes when this browser cannot decode it', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('cannot decode')));
    const out = await photoToJpegBase64(new File(['%PDF'], 'a.pdf', { type: 'application/pdf' }));
    expect(out).toBe(btoa('%PDF'));
  });

  it('sends the original when the canvas cannot write JPEG', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 10, height: 10, close: vi.fn() }));
    stubCanvas('data:image/png;base64,UE5H');
    expect(await photoToJpegBase64(new File(['x'], 'a.png'))).toBe(btoa('x'));
  });
});
