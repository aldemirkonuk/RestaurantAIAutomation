/**
 * One source of truth for what every file picker in the app will let you
 * select.
 *
 * Two problems these constants exist to kill:
 *
 * 1. `accept="image/*"` was copy-pasted onto pickers whose backend has
 *    handled PDFs all along — the NestJS scan parser sniffs base64 magic
 *    bytes (`JVBERi0` -> application/pdf) and the Python orchestrator runs
 *    pdf2image, so a PDF menu was always processable; the browser just
 *    refused to let you choose one.
 * 2. `accept` is a *filter*, not a guarantee. Every OS picker has an "All
 *    Files" escape hatch, and some browsers hand back an empty `file.type`
 *    for perfectly valid files (notably CSV on Windows, and anything picked
 *    from cloud-backed folders). Guards that did
 *    `file.type.startsWith('image/')` therefore rejected real files. Use
 *    `isScannable` / `isTabular` below, which fall back to the extension.
 */

/** Raster formats every vision path in the app can decode. */
export const IMAGE_ACCEPT = 'image/*,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif'

/** Anything the scan/OCR pipeline can read: photos and PDFs. */
export const SCAN_ACCEPT = `${IMAGE_ACCEPT},application/pdf,.pdf`

/** Row-oriented data the CSV/Excel importers can parse. */
export const TABULAR_ACCEPT =
  '.csv,text/csv,.tsv,.xlsx,.xls,application/vnd.ms-excel,' +
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.json,application/json'

/**
 * The permissive default: photos, PDFs, spreadsheets, and plain text. Use
 * this on general-purpose "upload a document" affordances where the backend
 * decides what it can do with the bytes.
 */
export const DOCUMENT_ACCEPT = `${SCAN_ACCEPT},${TABULAR_ACCEPT},.txt,text/plain`

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|bmp|tiff?|heic|heif|avif)$/i
const PDF_EXT_RE = /\.pdf$/i
const TABULAR_EXT_RE = /\.(csv|tsv|xlsx?|json)$/i

/** True for a photo — by MIME type, or by extension when the browser gives us none. */
export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_EXT_RE.test(file.name)
}

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || PDF_EXT_RE.test(file.name)
}

/** True for anything the OCR/vision pipeline accepts (image or PDF). */
export function isScannable(file: File): boolean {
  return isImageFile(file) || isPdfFile(file)
}

/** True for anything the CSV/Excel importers accept. */
export function isTabular(file: File): boolean {
  return (
    TABULAR_EXT_RE.test(file.name) ||
    file.type === 'text/csv' ||
    file.type === 'application/json' ||
    file.type.includes('spreadsheet') ||
    file.type.includes('excel')
  )
}

/**
 * Best-effort MIME type for a file the browser declined to type. Backends
 * that branch on mime (document intake, receipt upload) need something
 * better than `''`.
 */
export function resolveMimeType(file: File): string {
  if (file.type) return file.type
  if (isPdfFile(file)) return 'application/pdf'
  if (/\.png$/i.test(file.name)) return 'image/png'
  if (/\.webp$/i.test(file.name)) return 'image/webp'
  if (IMAGE_EXT_RE.test(file.name)) return 'image/jpeg'
  if (/\.csv$/i.test(file.name)) return 'text/csv'
  if (/\.json$/i.test(file.name)) return 'application/json'
  return 'application/octet-stream'
}

/**
 * Per-file upload ceiling.
 *
 * Uploads travel as base64 inside JSON, which inflates a file ~33%, so the
 * server's body limit must be ~1.4x this (MAX_REQUEST_BODY_SIZE in
 * apps/api-gateway/src/main.ts, default 15mb). Sized against the real corpus
 * in datasets/annotation_inbox/pdfs — 26 restaurant wine lists, largest
 * 4.4 MB — so this clears every one with >2x headroom while a single encoded
 * file stays well inside Anthropic's 32 MB per-request ceiling.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

/**
 * How many files one picker may take at once. Each file is uploaded as its own
 * request (a batched request would blow Anthropic's 32 MB per-request limit),
 * so this bounds concurrency and blast radius, not payload size.
 */
export const MAX_UPLOAD_FILES = 10

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export interface FileSelectionResult {
  accepted: File[]
  errors: string[]
}

/**
 * Validate a picked FileList against type, size, and count limits.
 *
 * Returns the files worth uploading plus a human-readable reason for each
 * rejection, so the UI can accept the good files and still say what happened
 * to the rest — rather than failing the whole batch, or (worse) letting an
 * oversized file through to a bare 413 the user can't interpret.
 */
export function validateSelection(
  files: FileList | File[] | null | undefined,
  opts: {
    accept?: (file: File) => boolean
    maxFiles?: number
    maxBytes?: number
    kindLabel?: string
  } = {},
): FileSelectionResult {
  const {
    accept = isScannable,
    maxFiles = MAX_UPLOAD_FILES,
    maxBytes = MAX_UPLOAD_BYTES,
    kindLabel = 'a photo or PDF',
  } = opts

  const all = Array.from(files ?? [])
  const accepted: File[] = []
  const errors: string[] = []

  for (const file of all) {
    if (accepted.length >= maxFiles) {
      errors.push(
        `Only ${maxFiles} files at a time — "${file.name}" and any after it were skipped.`,
      )
      break
    }
    if (!accept(file)) {
      errors.push(`"${file.name}" is not ${kindLabel}.`)
      continue
    }
    if (file.size > maxBytes) {
      errors.push(
        `"${file.name}" is ${formatBytes(file.size)} — the limit is ${formatBytes(maxBytes)}.`,
      )
      continue
    }
    if (file.size === 0) {
      errors.push(`"${file.name}" is empty.`)
      continue
    }
    accepted.push(file)
  }

  return { accepted, errors }
}

/**
 * Clear an <input type="file"> after handling it. Without this, picking the
 * same file twice in a row fires no `change` event and the UI silently does
 * nothing — the single most common "the upload button is broken" report.
 */
export function resetFileInput(
  input: HTMLInputElement | null | undefined,
): void {
  if (input) input.value = ''
}
