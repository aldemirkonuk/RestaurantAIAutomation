import { useState, useRef } from 'react'
import { FileSpreadsheet, Upload, RotateCcw } from 'lucide-react'
import { Button } from '../ui/button'
import { importMenu, type MenuImportResult } from '../../services/api/menus'
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

interface MenuCsvUploadProps {
  onSuccess: (result: MenuImportResult) => void
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

    const parseRow = (line: string): string[] => {
      const result: string[] = []
      let current = ''
      let inQuotes = false
      for (let i = 0; i < line.length; i++) {
        const char = line[i]
        if (char === '"') {
          inQuotes = !inQuotes
        } else if (char === ',' && !inQuotes) {
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

  const handleImport = async () => {
    if (!csvContent && !fileBase64) return
    setLoading(true)
    setError(null)
    try {
      const total = 1 + queue.length
      if (total > 1) setProgress({ done: 0, total, current: fileName || '' })

      // The file already read into state, then the rest of the queue — each as
      // its own request. One failure is reported but does not abandon the
      // files after it.
      let result = await importOne({
        scan: isScanFile,
        base64: fileBase64,
        csv: csvContent,
      })
      const failures: string[] = []

      for (let i = 0; i < queue.length; i++) {
        const f = queue[i]
        setProgress({ done: i + 1, total, current: f.name })
        try {
          result = await importOne(await readFile(f))
        } catch (err: any) {
          failures.push(
            `${f.name}: ${err?.response?.data?.message || err?.message || 'import failed'}`,
          )
        }
      }

      if (failures.length) {
        setError(
          `${failures.length} of ${total} file(s) failed — ${failures.join('; ')}`,
        )
      }
      onSuccess(result)
    } catch (e: any) {
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
          className="w-full flex flex-col items-center justify-center gap-3 p-12 rounded-xl border-2 border-dashed border-gray-300 bg-white hover:border-[#9E4249]/50 hover:bg-[#9E4249]/5 transition-all group"
        >
          <div className="w-12 h-12 rounded-xl bg-gray-100 group-hover:bg-[#9E4249]/10 flex items-center justify-center transition-colors">
            <FileSpreadsheet className="w-6 h-6 text-gray-500 group-hover:text-[#9E4249] transition-colors" />
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
              <FileSpreadsheet className="w-5 h-5 text-[#9E4249]" />
              <span className="font-medium text-gray-900 text-sm">{fileName}</span>
              {queue.length > 0 && (
                <span className="text-xs font-medium text-[#9E4249]">
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
              Excel file ready. We'll read the first sheet and match its columns
              (Name, Producer, Vintage, Region, Grape, Glass/Bottle price) when you import.
            </div>
          ) : isScanFile ? (
            <div className="mb-4 p-4 rounded-xl border border-gray-200 bg-white text-sm text-gray-600">
              Document ready. We'll extract your wines using AI when you import.
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
            className="w-full bg-[#9E4249] hover:bg-[#B85055] text-white"
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
              'Import wines'
            ) : (
              `Import ${estimatedTotal > 0 ? estimatedTotal : ''} wines`
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
