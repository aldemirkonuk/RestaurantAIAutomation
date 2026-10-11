import { useState, useRef } from 'react'
import { FileSpreadsheet, Upload, RotateCcw } from 'lucide-react'
import { Button } from '../ui/button'
import {
  importMenu,
  type MenuFileResult,
  type MenuImportResult,
  type MenuImportSuccess,
} from '../../services/api/menus'
import {
  DOCUMENT_ACCEPT,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_FILES,
  formatBytes,
  validateSelection,
  isScannable,
  isTabular,
  resetFileInput,
} from '../../lib/uploadAccept'
import { skippedMenuColumns } from '../../lib/menuColumns'
import { READ_WITHOUT_ANSWER, readWithoutAnswer } from '../../lib/menuReadWithoutAnswer'

interface MenuCsvUploadProps {
  onSuccess: MenuImportSuccess
}

interface PreviewRow {
  cells: string[]
}

const EXCEL_EXTENSION_RE = /\.(xlsx|xls)$/i
const SCAN_EXTENSION_RE = /\.(pdf|png|jpe?g|webp|gif|bmp|tiff?|heic|heif|avif)$/i

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

export function MenuCsvUpload({ onSuccess }: MenuCsvUploadProps) {
  const [csvContent, setCsvContent] = useState<string | null>(null)
  const [fileBase64, setFileBase64] = useState<string | null>(null)
  const [isExcelFile, setIsExcelFile] = useState(false)
  const [isScanFile, setIsScanFile] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewRow[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Files beyond the first, when several are picked at once. Each is imported
  // as its own request — batching them into one body would blow past both our
  // body limit and Anthropic's 32 MB per-request ceiling.
  const [queue, setQueue] = useState<File[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const parseCsvPreview = (text: string) => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim())
    if (lines.length === 0) return
    // The same delimiter the reader picks: the one the header uses most.
    const delimiter = [',', ';', '\t'].reduce((best, d) =>
      lines[0].split(d).length > lines[0].split(best).length ? d : best,
    )

    const parseRow = (line: string): string[] => {
      const result: string[] = []
      let current = ''
      let inQuotes = false
      for (let i = 0; i < line.length; i++) {
        const char = line[i]
        if (char === '"') {
          inQuotes = !inQuotes
        } else if (char === delimiter && !inQuotes) {
          result.push(current.trim())
          current = ''
        } else {
          current += char
        }
      }
      result.push(current.trim())
      return result
    }

    const headerRow = parseRow(lines[0])
    setHeaders(headerRow)

    const previewRows = lines.slice(1, 6).map((line) => ({ cells: parseRow(line) }))
    setPreview(previewRows)
  }

  const resetFile = () => {
    setCsvContent(null)
    setFileBase64(null)
    setIsExcelFile(false)
    setIsScanFile(false)
    setFileName(null)
    setPreview([])
    setHeaders([])
    setQueue([])
    setProgress(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target
    // Validate size/type/count up front. Without this an oversized file is
    // only rejected at the server as a bare 413 — which arrives before the
    // auth guard and reads as a generic network error in the UI.
    const { accepted, errors } = validateSelection(input.files, {
      accept: (f) => isScannable(f) || isTabular(f),
      kindLabel: 'a spreadsheet, CSV, PDF, or image',
    })
    resetFileInput(input)

    if (errors.length) setError(errors.join(' '))
    else setError(null)
    if (accepted.length === 0) return

    const [file, ...rest] = accepted
    setQueue(rest)
    setProgress(null)
    setFileName(file.name)

    const excel = EXCEL_EXTENSION_RE.test(file.name)
    const scanFile = SCAN_EXTENSION_RE.test(file.name)
    setIsExcelFile(excel)
    setIsScanFile(scanFile)

    if (excel || scanFile) {
      // Binary file (Excel or Image/PDF) — read as bytes and base64-encode for the server
      const reader = new FileReader()
      reader.onload = () => {
        const buffer = reader.result as ArrayBuffer
        setFileBase64(arrayBufferToBase64(buffer))
        setCsvContent(null)
        setPreview([])
        setHeaders([])
      }
      reader.onerror = () => setError('Failed to read file')
      reader.readAsArrayBuffer(file)
      return
    }

    setFileBase64(null)
    const reader = new FileReader()
    reader.onload = () => {
      const text = reader.result as string
      setCsvContent(text)
      parseCsvPreview(text)
    }
    reader.onerror = () => setError('Failed to read file')
    reader.readAsText(file)
  }

  /** Import one already-read file. */
  const importOne = async (opts: {
    scan: boolean
    base64: string | null
    csv: string | null
  }) => {
    if (opts.scan) return importMenu('scan', { imageBase64: opts.base64! })
    return opts.base64
      ? importMenu('csv', { fileBase64: opts.base64 })
      : importMenu('csv', { csvContent: opts.csv! })
  }

  const readFile = (file: File) =>
    new Promise<{ scan: boolean; base64: string | null; csv: string | null }>(
      (resolve, reject) => {
        const excel = EXCEL_EXTENSION_RE.test(file.name)
        const scan = SCAN_EXTENSION_RE.test(file.name)
        const reader = new FileReader()
        reader.onerror = () => reject(new Error(`Failed to read "${file.name}"`))
        if (excel || scan) {
          reader.onload = () =>
            resolve({
              scan,
              base64: arrayBufferToBase64(reader.result as ArrayBuffer),
              csv: null,
            })
          reader.readAsArrayBuffer(file)
        } else {
          reader.onload = () =>
            resolve({ scan: false, base64: null, csv: reader.result as string })
          reader.readAsText(file)
        }
      },
    )

  const reasonOf = (err: any) =>
    err?.response?.data?.message || err?.message || 'it could not be read'

  const handleImport = async () => {
    if (!csvContent && !fileBase64) return
    setLoading(true)
    setError(null)
    try {
      const total = 1 + queue.length
      if (total > 1) setProgress({ done: 0, total, current: fileName || '' })

      // The file already read into state, then the rest of the queue, each as
      // its own request. One failure does not abandon the files after it, and
      // every file's result goes on to the proof (F-682): the last one alone
      // used to, and the failures were said on a step that was then left.
      const read: Array<{ name: string; result: MenuImportResult }> = []
      const files: MenuFileResult[] = []
      const sources = [
        { name: fileName || 'file 1', load: async () => ({ scan: isScanFile, base64: fileBase64, csv: csvContent }) },
        ...queue.map((f) => ({ name: f.name, load: () => readFile(f) })),
      ]
      for (let i = 0; i < sources.length; i++) {
        const { name, load } = sources[i]
        if (total > 1) setProgress({ done: i, total, current: name })
        try {
          const result = await importOne(await load())
          read.push({ name, result })
          files.push({
            name,
            itemsExtracted: result.itemsExtracted,
            read: result.read ?? null,
            // F-1292: a photo or PDF read only in part says why on the proof.
            ...(result.partRead ? { partRead: result.partRead } : {}),
          })
        } catch (err: any) {
          // The first file with no answer back is let go as before (F-803,
          // below); a later one is named here, and the rest are still tried.
          if (i === 0 && readWithoutAnswer(err)) throw err
          files.push({
            name,
            failure: readWithoutAnswer(err)
              ? 'no answer came back; look for it under Menus kept before reading it again'
              : reasonOf(err),
          })
        }
      }

      if (read.length === 0) {
        setError(
          files
            .map((f) => ('failure' in f ? (total > 1 ? `${f.name}: ${f.failure}` : f.failure) : ''))
            .join(' '),
        )
        return
      }
      const [first] = read
      const result: MenuImportResult =
        total > 1
          ? {
              ...first.result,
              itemsExtracted: read.reduce((n, r) => n + r.result.itemsExtracted, 0),
              submissionsCreated: read.reduce((n, r) => n + r.result.submissionsCreated, 0),
              items: read.flatMap((r) => r.result.items),
              read: null,
              files,
            }
          : first.result
      const image =
        isScanFile && fileBase64 && !/\.pdf$/i.test(fileName || '') && first.name === fileName
          ? `data:image/jpeg;base64,${fileBase64}`
          : null
      onSuccess(result, { image })
    } catch (e: any) {
      // A file sent with no answer back may already be read and kept, so the
      // file is let go: pressing Import again would read and keep it twice
      // (F-803). A CSV or spreadsheet too (F-807): the gateway import is not
      // idempotent, each call inserts a new version (menus.service.ts:597) and
      // nothing dedupes on source_sha256. Files queued behind it were never
      // sent, and are named.
      if (readWithoutAnswer(e)) {
        const unsent = queue.length
        resetFile()
        setError(
          unsent
            ? `${READ_WITHOUT_ANSWER} The other ${unsent === 1 ? 'file was' : `${unsent} files were`} not read: choose ${unsent === 1 ? 'it' : 'them'} again.`
            : READ_WITHOUT_ANSWER,
        )
        return
      }
      setError(e?.response?.data?.message || e?.message || 'Import failed. Please try again.')
    } finally {
      setLoading(false)
      setProgress(null)
    }
  }

  const rowCount = preview.length
  const estimatedTotal = csvContent
    ? csvContent.split(/\r?\n/).filter((l) => l.trim()).length - 1
    : 0

  const hasFile = !!csvContent || !!fileBase64
  // F-017: a column the importer does not read is named before anything is
  // read, not dropped in silence.
  const skipped = csvContent ? skippedMenuColumns(headers) : []

  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-6">
      <input
        ref={fileInputRef}
        type="file"
        accept={DOCUMENT_ACCEPT}
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />

      {error && (
        <div className="mb-4 flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <RotateCcw className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!hasFile ? (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full flex flex-col items-center justify-center gap-3 p-12 rounded-xl border-2 border-dashed border-gray-300 bg-white hover:border-[#1A5E6B]/50 hover:bg-[#1A5E6B]/5 transition-all group"
        >
          <div className="w-12 h-12 rounded-xl bg-gray-100 group-hover:bg-[#1A5E6B]/10 flex items-center justify-center transition-colors">
            <FileSpreadsheet className="w-6 h-6 text-gray-500 group-hover:text-[#1A5E6B] transition-colors" />
          </div>
          <div className="text-center">
            <p className="font-medium text-gray-700">Click to upload file</p>
            <p className="text-sm text-gray-400 mt-1">
              Supports .csv, .xlsx, .pdf, images — up to {MAX_UPLOAD_FILES} files,{' '}
              {formatBytes(MAX_UPLOAD_BYTES)} each
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Upload className="w-3 h-3" />
            <span>Export from your POS, Excel, or upload a document</span>
          </div>
        </button>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-[#1A5E6B]" />
              <span className="font-medium text-gray-900 text-sm">{fileName}</span>
              {queue.length > 0 && (
                <span className="text-xs font-medium text-[#1A5E6B]">
                  +{queue.length} more queued
                </span>
              )}
              {!isExcelFile && !isScanFile && (
                <span className="text-xs text-gray-500">({estimatedTotal} rows detected)</span>
              )}
            </div>
            <button onClick={resetFile} className="text-xs text-gray-400 hover:text-gray-600 underline">
              {queue.length > 0 ? 'Clear files' : 'Change file'}
            </button>
          </div>

          {isExcelFile ? (
            <div className="mb-4 p-4 rounded-xl border border-gray-200 bg-white text-sm text-gray-600">
              Spreadsheet ready. We'll read its first sheet by these column names: Name,
              Producer, Vintage, Region, Grape, Category, Glass, Bottle. Any other column is
              not read.
            </div>
          ) : isScanFile ? (
            <div className="mb-4 p-4 rounded-xl border border-gray-200 bg-white text-sm text-gray-600">
              Ready. We'll read every drink on it when you import, and show you the lines
              before anything is set.
            </div>
          ) : (
            preview.length > 0 && (
              <div className="mb-4 overflow-auto rounded-xl border border-gray-200 bg-white">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      {headers.map((h, i) => (
                        <th
                          key={i}
                          className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap"
                        >
                          {h || `Column ${i + 1}`}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, ri) => (
                      <tr key={ri} className="border-b border-gray-100 last:border-0">
                        {row.cells.map((cell, ci) => (
                          <td key={ci} className="px-3 py-2 text-gray-700 whitespace-nowrap max-w-[180px] truncate">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {skipped.length > 0 && (
                  <p role="status" className="px-3 py-2 text-xs text-amber-800 bg-amber-50 border-t border-amber-100">
                    {skipped.length === 1 ? 'This column will not be read' : 'These columns will not be read'}:{' '}
                    <strong>{skipped.join(', ')}</strong>. A price column reads only when it is named
                    Glass or Bottle — rename it in the file to keep it.
                  </p>
                )}
                {estimatedTotal > 5 && (
                  <p className="px-3 py-2 text-xs text-gray-400 text-center border-t border-gray-100">
                    Showing first {rowCount} of {estimatedTotal} rows
                  </p>
                )}
              </div>
            )
          )}

          <Button
            onClick={handleImport}
            disabled={loading}
            className="w-full bg-[#1A5E6B] hover:bg-[#14515C] text-white"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                {progress
                  ? `Importing ${progress.done + 1} of ${progress.total} — ${progress.current}`
                  : 'Importing...'}
              </span>
            ) : queue.length > 0 ? (
              `Import ${queue.length + 1} files`
            ) : isExcelFile || isScanFile ? (
              'Import the menu'
            ) : estimatedTotal === 1 ? (
              'Import 1 line'
            ) : estimatedTotal > 1 ? (
              `Import ${estimatedTotal} lines`
            ) : (
              'Import the menu'
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
