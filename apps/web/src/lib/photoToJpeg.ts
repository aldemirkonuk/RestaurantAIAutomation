/**
 * A shelf photo, made small and plain before it is sent (inventory walk #7,
 * lane I2, G10). A phone hands over 4–12 MB, as HEIC on an iPhone, which the
 * model cannot read; a canvas re-encode brings the long edge to MAX_PHOTO_EDGE
 * and leaves whatever this browser decodes as JPEG. What it cannot decode goes
 * as its own bytes, and the gateway refuses that in plain words.
 */

/** The longest edge, in pixels, of a photo sent to be counted. */
export const MAX_PHOTO_EDGE = 1600;

/** Small, and still sharp enough to count. */
export const JPEG_QUALITY = 0.85;

/** The drawn size, so neither edge passes `max`. Never enlarges. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** The file's own bytes as base64, with no data-URL prefix. */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result);
      resolve(s.slice(s.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function decode(file: Blob): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    return await createImageBitmap(file);
  } catch {
    return null;
  }
}

/**
 * Base64 of `file` re-encoded as a JPEG no larger than `maxEdge` on its long
 * edge, or of the file's own bytes when this browser cannot decode or draw it.
 */
export async function photoToJpegBase64(file: Blob, maxEdge = MAX_PHOTO_EDGE): Promise<string> {
  const bitmap = await decode(file);
  if (!bitmap) return fileToBase64(file);
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return fileToBase64(file);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const url = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    // A canvas that cannot write JPEG answers PNG: send the original.
    if (!url.startsWith('data:image/jpeg')) return fileToBase64(file);
    return url.slice(url.indexOf(',') + 1);
  } finally {
    bitmap.close?.();
  }
}
