/**
 * How big a file the /menu read box sends (r36 menu audit N3).
 *
 * The box sent a phone photo whole: no fit and no size check. A 12-50 MP
 * photo is 3-12 MB, the reader takes at most 5 MB of base64 per image, and
 * the gateway's body cap is 15 MB (apps/api-gateway/src/main.ts). Past either
 * one the read failed, and the person was told the reader was "temporarily
 * unavailable" and to try later. Now a photo is fitted first (lib/fitPhoto.ts,
 * the same fit /get-started uses), and what is still too big is said here,
 * before anything is sent.
 */
import { base64Bytes } from '../../../lib/fitPhoto'

/** The reader's cap on one image: 5 MB of base64. */
export const READER_PHOTO_MAX_BASE64 = 5 * 1024 * 1024
/** One read's file, before base64: its base64 (4/3 larger) stays under the gateway's 15 MB body. */
export const MENU_FILE_MAX_BYTES = 10 * 1024 * 1024

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Why a file picked for reading is too big to send, before it is read; null
 * when it may go. A photo is not judged here: it is fitted first.
 */
export function pickedSizeRefusal(file: { name: string; type?: string; size?: number } | null): string | null {
  if (!file || typeof file.size !== 'number') return null
  const isPhoto = (file.type ?? '').startsWith('image/')
  if (isPhoto || file.size <= MENU_FILE_MAX_BYTES) return null
  return `This file is ${mb(file.size)}, and one read takes up to ${mb(MENU_FILE_MAX_BYTES)}. Divide the menu into smaller files and choose one.`
}

/**
 * Why a photo is still too big for the reader after it was fitted, or null.
 * `fitted` is false when this browser could not redraw it (a HEIC photo in
 * Chrome, say), which is what the person can act on.
 */
export function fittedPhotoRefusal(photo: { base64: string; mime: string; fitted: boolean }): string | null {
  if (photo.mime === 'application/pdf') {
    const bytes = base64Bytes(photo.base64)
    return bytes > MENU_FILE_MAX_BYTES
      ? `This file is ${mb(bytes)}, and one read takes up to ${mb(MENU_FILE_MAX_BYTES)}. Divide the menu into smaller files and choose one.`
      : null
  }
  if (photo.base64.length <= READER_PHOTO_MAX_BASE64) return null
  const size = mb(base64Bytes(photo.base64))
  return photo.fitted
    ? `This photo is still ${size} after it was made smaller, and the reader takes photos up to 5 MB. Take it again a little further back and choose that.`
    : `This photo is ${size}, and this browser could not make it smaller; the reader takes photos up to 5 MB. Save it as a JPEG, or take it again, and choose that.`
}
