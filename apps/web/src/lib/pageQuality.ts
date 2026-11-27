/**
 * Is a menu photo worth reading? (r110 g2) A pure, advisory look at one page
 * before Read: blurred, flat (no contrast) or small. It never tests mean
 * brightness, so white-on-black and chalkboard menus are not called dark. It
 * never blocks Read: a false positive only asks for a retake.
 */

/** Long edge the page is looked at on. */
export const SAMPLE_EDGE = 512;
/** Variance of the 3x3 Laplacian below this reads as out of focus. */
export const BLUR_MIN = 200;
/** Luminance standard deviation below this reads as no contrast. */
export const CONTRAST_MIN = 20;
/** A source whose long edge is under this is too small for small print. */
export const SMALL_EDGE = 1000;

export interface PageQuality {
  blurred: boolean;
  flat: boolean;
  small: boolean;
}

interface Pixels {
  data: ArrayLike<number>;
  width: number;
  height: number;
}

/** Blur and contrast from RGBA pixels (the part of the check with no browser in it). */
export function checkPixels({ data, width, height }: Pixels): Pick<PageQuality, 'blurred' | 'flat'> {
  const n = width * height;
  const gray = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const g = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    gray[i] = g;
    sum += g;
  }
  const mean = n ? sum / n : 0;
  let sq = 0;
  for (let i = 0; i < n; i++) sq += (gray[i] - mean) ** 2;
  const std = n ? Math.sqrt(sq / n) : 0;

  let lap = 0;
  let lapSq = 0;
  let m = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const v = gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width] - 4 * gray[i];
      lap += v;
      lapSq += v * v;
      m++;
    }
  }
  const variance = m ? lapSq / m - (lap / m) ** 2 : 0;
  return { blurred: variance < BLUR_MIN, flat: std < CONTRAST_MIN };
}

type Source = { width: number; height: number } & CanvasImageSource;

/** Downsample a decoded photo to SAMPLE_EDGE on a canvas and check it. */
export function checkPage(bitmap: Source): PageQuality {
  const long = Math.max(bitmap.width, bitmap.height);
  const small = long < SMALL_EDGE;
  const k = Math.min(1, SAMPLE_EDGE / (long || 1));
  const w = Math.max(3, Math.round(bitmap.width * k));
  const h = Math.max(3, Math.round(bitmap.height * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { blurred: false, flat: false, small };
  ctx.drawImage(bitmap, 0, 0, w, h);
  return { ...checkPixels(ctx.getImageData(0, 0, w, h)), small };
}

/** Decode a held file and check it; null when it is not a photo or the browser cannot decode it. */
export async function checkFile(file: File): Promise<PageQuality | null> {
  if (!file.type.startsWith('image/') || typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(file);
    try {
      return checkPage(bitmap);
    } finally {
      bitmap.close?.();
    }
  } catch {
    return null;
  }
}

/** The one thing to say about a page, worst first; null when it looks fine. */
export function qualityKind(q: PageQuality | null | undefined): 'flat' | 'blurred' | 'small' | null {
  if (!q) return null;
  return q.flat ? 'flat' : q.blurred ? 'blurred' : q.small ? 'small' : null;
}
