/**
 * A menu photo, fitted before it is sent to the reader (r28 onboarding gap 12).
 *
 * Two things went wrong on the way to the reader:
 *
 * 1. **A dropped photo went as a data URL.** "Drop the menu here" sent
 *    `data:image/jpeg;base64,...` as `imageBase64`. The gateway hands that
 *    string to the model as base64, so the prefix made it unreadable, and the
 *    media type was guessed as JPEG for every file (onboarding audit G5; the
 *    gateway half is #762). The photo box sent bare base64, so the first
 *    proof's crops were drawn from a string that is not a URL.
 * 2. **A phone photo went up whole.** A 12-50 MP photo is 3-12 MB. The model
 *    takes at most 5 MB per image and scales anything past ~1568 px on the
 *    long edge down anyway, so the extra bytes were a slow upload on a phone
 *    and, past 5 MB, a refused read.
 *
 * `fitPhotoForReading` takes either form and gives both: bare base64 for the
 * gateway and a data URL for the page. A photo larger than READ_LONG_EDGE or
 * READ_MAX_BYTES, or in a form the reader does not take (HEIC where the
 * browser can open it, BMP, TIFF), is redrawn as a JPEG. A PDF is never
 * touched. When the browser cannot open the photo (HEIC in Chrome), the bytes
 * go as they are and the gateway says what it can do with them.
 */

/** Long edge, in pixels, past which a photo is scaled down. Above the model's ~1568 px, with room. */
export const READ_LONG_EDGE = 2048
/** Bytes past which a photo is re-encoded. The model's cap is 5 MB of base64 (~3.75 MB of bytes). */
export const READ_MAX_BYTES = 3_000_000
/** JPEG quality for a redrawn photo; a second, lower pass if the first is still too large. */
export const READ_QUALITY = 0.85
export const READ_QUALITY_SMALLER = 0.7

/** What the reader takes as it is (scan-parser.service.ts detectMediaType). */
const READER_TAKES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export interface FittedPhoto {
  /** Bare base64, as the gateway's `imageBase64` expects. */
  base64: string
  /** For an <img>: null for a PDF, which no <img> draws. */
  dataUrl: string | null
  mime: string
  /** True when the photo was redrawn here. */
  fitted: boolean
}

export interface PhotoCodec {
  /** False when this browser cannot draw at all (no canvas). */
  canDraw(): boolean
  /** Rejects when the browser cannot open the photo. */
  decode(dataUrl: string): Promise<{ width: number; height: number; source: CanvasImageSource }>
  /** A JPEG data URL of `source` at width x height. */
  encode(source: CanvasImageSource, width: number, height: number, quality: number): string
}

/** The media type from the first bytes, as the gateway sniffs it. */
export function sniffMime(base64: string): string {
  if (base64.startsWith('JVBERi0')) return 'application/pdf'
  if (base64.startsWith('/9j/')) return 'image/jpeg'
  if (base64.startsWith('iVBORw')) return 'image/png'
  if (base64.startsWith('UklGR')) return 'image/webp'
  if (base64.startsWith('R0lGOD')) return 'image/gif'
  return 'image/jpeg'
}

/** Split a data URL or bare base64 into its media type and bare base64. */
export function splitPhoto(input: string): { mime: string; base64: string } {
  const match = /^data:([^;,]*)(;[^,]*)?,(.*)$/s.exec(input)
  if (match) {
    const base64 = match[3]
    const declared = match[1].trim().toLowerCase()
    return { mime: declared || sniffMime(base64), base64 }
  }
  return { mime: sniffMime(input), base64: input }
}

/** Decoded size of a base64 string, in bytes. */
export function base64Bytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding)
}

/** The size a photo is drawn at: the long edge at most `longEdge`, never enlarged. */
export function fittedSize(width: number, height: number, longEdge = READ_LONG_EDGE): { width: number; height: number } {
  const scale = Math.min(1, longEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

const browserCodec: PhotoCodec = {
  canDraw() {
    try {
      return typeof document !== 'undefined' && !!document.createElement('canvas').getContext('2d')
    } catch {
      return false
    }
  },
  decode(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () =>
        image.naturalWidth > 0 && image.naturalHeight > 0
          ? resolve({ width: image.naturalWidth, height: image.naturalHeight, source: image })
          : reject(new Error('empty photo'))
      image.onerror = () => reject(new Error('this browser cannot open the photo'))
      image.src = dataUrl
    })
  },
  encode(source, width, height, quality) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('no canvas')
    // A transparent PNG drawn as JPEG would turn black behind its text.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(source, 0, 0, width, height)
    return canvas.toDataURL('image/jpeg', quality)
  },
}

/** Never throws: any failure here sends the photo as it came. */
export async function fitPhotoForReading(input: string, codec: PhotoCodec = browserCodec): Promise<FittedPhoto> {
  const { mime, base64 } = splitPhoto(input)
  const asIs: FittedPhoto = {
    base64,
    dataUrl: mime === 'application/pdf' ? null : `data:${mime};base64,${base64}`,
    mime,
    fitted: false,
  }
  if (mime === 'application/pdf' || !codec.canDraw()) return asIs
  try {
    const { width, height, source } = await codec.decode(asIs.dataUrl as string)
    const tooLarge = Math.max(width, height) > READ_LONG_EDGE || base64Bytes(base64) > READ_MAX_BYTES
    if (!tooLarge && READER_TAKES.has(mime)) return asIs
    const size = fittedSize(width, height)
    let drawn = codec.encode(source, size.width, size.height, READ_QUALITY)
    let out = splitPhoto(drawn)
    if (base64Bytes(out.base64) > READ_MAX_BYTES) {
      drawn = codec.encode(source, size.width, size.height, READ_QUALITY_SMALLER)
      out = splitPhoto(drawn)
    }
    if (out.mime !== 'image/jpeg' || out.base64.length === 0) return asIs
    return { base64: out.base64, dataUrl: drawn, mime: 'image/jpeg', fitted: true }
  } catch {
    return asIs
  }
}
