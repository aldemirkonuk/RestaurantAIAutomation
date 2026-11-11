/**
 * Photos of a menu, made ready on the device before they are sent.
 *
 * Several photos of one menu go up together as one menu (founder 2026-11-07,
 * "One upload = one version"); the gateway joins them into one PDF and can
 * join only JPEG and PNG. So every photo is redrawn here as a JPEG, no longer
 * than MAX_EDGE on its long side: a phone's 12-megapixel HEIC or PNG becomes
 * a few hundred kilobytes the reader reads just as well, and twenty pages fit
 * under the gateway's 15 MB body limit.
 *
 * A HEIC opens only where the browser itself can decode it (Safari does); any
 * photo the browser cannot open is refused in words, naming it, before
 * anything is sent.
 */

/** The longest side a page is sent at. Menu text stays legible well below it. */
export const MAX_EDGE = 2000
/** JPEG quality for a redrawn page. */
const QUALITY = 0.85
/** The most pages one upload carries (the gateway's MAX_MENU_PAGES). */
export const MAX_PAGES = 20
/** What all pages together may weigh as base64, under the gateway's 15 MB body. */
export const MAX_TOTAL_BASE64 = 14 * 1024 * 1024

/** Whether a chosen file is a photo (read as a page) rather than a PDF or a sheet. */
export function isPhoto(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  return /\.(jpe?g|png|webp|gif|heic|heif|avif|bmp|tiff?)$/i.test(file.name)
}

/** The size a page is redrawn at: the long side at most MAX_EDGE, never enlarged. */
export function fitWithin(width: number, height: number, maxEdge = MAX_EDGE): { width: number; height: number } {
  const long = Math.max(width, height)
  if (long <= maxEdge || long === 0) return { width, height }
  const k = maxEdge / long
  return { width: Math.round(width * k), height: Math.round(height * k) }
}

/** A sentence when a set of pages cannot go up together, or null when it can. */
export function pagesProblem(pages: string[]): string | null {
  if (pages.length > MAX_PAGES) {
    return `One upload holds at most ${MAX_PAGES} pages; you chose ${pages.length}. Send the rest as a second upload.`
  }
  const total = pages.reduce((n, p) => n + p.length, 0)
  if (total > MAX_TOTAL_BASE64) {
    return 'These pages are too large to send together. Send fewer pages at a time.'
  }
  return null
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(`${file.name} could not be opened in this browser. Export it as a JPEG, or take the photo here.`))
    }
    img.src = url
  })
}

/** One photo as the bare base64 of a JPEG, at most MAX_EDGE on its long side. */
export async function photoToJpegBase64(file: File): Promise<string> {
  const img = await loadImage(file)
  const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(`${file.name} could not be prepared in this browser. Try another browser.`)
  // A transparent PNG would turn black as a JPEG: paper is white.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0, width, height)
  const dataUrl = canvas.toDataURL('image/jpeg', QUALITY)
  const bare = dataUrl.split(',', 2)[1] ?? ''
  if (!bare) throw new Error(`${file.name} could not be prepared in this browser. Try another browser.`)
  return bare
}

/** Every chosen photo ready to send, in the order chosen. */
export async function photosToPages(files: File[]): Promise<string[]> {
  const pages: string[] = []
  for (const f of files) pages.push(await photoToJpegBase64(f))
  return pages
}
