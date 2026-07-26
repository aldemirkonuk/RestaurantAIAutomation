/**
 * Export split-button with a format picker.
 * Groups formats by intent (files, spreadsheets, documents, quick actions) so
 * the list stays scannable as formats are added.
 */
import { useEffect, useRef, useState } from 'react'
import {
  Download,
  ChevronDown,
  FileText,
  FileSpreadsheet,
  FileJson,
  FileCode,
  Printer,
  ClipboardCopy,
  Table2,
  Loader2,
} from 'lucide-react'
import { Button } from './index'
import { cn } from '../../lib/utils'
import type { TableExportFormat } from '../../lib/tableExport'

interface FormatOption {
  id: TableExportFormat
  label: string
  hint: string
  icon: React.ComponentType<{ className?: string }>
}

const GROUPS: { label: string; options: FormatOption[] }[] = [
  {
    label: 'Spreadsheet',
    options: [
      { id: 'csv', label: 'CSV', hint: 'Universal .csv — opens anywhere', icon: FileText },
      { id: 'excel', label: 'Excel', hint: 'Native .xlsx with filters', icon: FileSpreadsheet },
      { id: 'tsv', label: 'TSV', hint: 'Tab-separated — paste into Sheets', icon: Table2 },
    ],
  },
  {
    label: 'Document',
    options: [
      { id: 'pdf', label: 'PDF', hint: 'Formatted, print-ready table', icon: FileText },
      { id: 'markdown', label: 'Markdown', hint: '.md table for docs and tickets', icon: FileCode },
      { id: 'html', label: 'HTML', hint: 'Styled web page', icon: FileCode },
    ],
  },
  {
    label: 'Data',
    options: [
      { id: 'json', label: 'JSON', hint: 'Structured records for scripts', icon: FileJson },
    ],
  },
  {
    label: 'Quick',
    options: [
      { id: 'clipboard', label: 'Copy to clipboard', hint: 'Paste into any spreadsheet', icon: ClipboardCopy },
      { id: 'print', label: 'Print', hint: 'Open the print dialog', icon: Printer },
    ],
  },
]

interface ExportMenuProps {
  onExport: (format: TableExportFormat) => void | Promise<void>
  /** Row count shown in the menu header so users know the export scope. */
  count?: number
  label?: string
  disabled?: boolean
  align?: 'left' | 'right'
}

export function ExportMenu({
  onExport,
  count,
  label = 'Export',
  disabled,
  align = 'right',
}: ExportMenuProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<TableExportFormat | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const run = async (format: TableExportFormat) => {
    setBusy(format)
    try {
      await onExport(format)
      setOpen(false)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <Button
        variant="outline"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Export the filtered rows"
      >
        <Download className="w-4 h-4 mr-2" />
        {label}
        <ChevronDown
          className={cn('w-4 h-4 ml-1.5 transition-transform', open && 'rotate-180')}
        />
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className={cn(
              'absolute z-50 mt-2 w-72 rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden',
              align === 'right' ? 'right-0' : 'left-0',
            )}
          >
            <div className="px-3 py-2.5 border-b border-gray-100 bg-gray-50/80">
              <p className="text-xs font-semibold text-gray-700">Export format</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {typeof count === 'number'
                  ? `${count} row${count === 1 ? '' : 's'} matching current filters`
                  : 'Matches current filters'}
              </p>
            </div>

            <div className="max-h-[22rem] overflow-y-auto py-1">
              {GROUPS.map((group) => (
                <div key={group.label} className="py-1">
                  <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                    {group.label}
                  </p>
                  {group.options.map((opt) => {
                    const Icon = opt.icon
                    const isBusy = busy === opt.id
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        role="menuitem"
                        disabled={!!busy}
                        onClick={() => void run(opt.id)}
                        className="w-full flex items-start gap-2.5 px-3 py-2 text-left hover:bg-wine-50/70 disabled:opacity-60 transition-colors"
                      >
                        <span className="w-7 h-7 rounded-lg bg-gray-50 flex items-center justify-center shrink-0 mt-0.5">
                          {isBusy ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-wine-600" />
                          ) : (
                            <Icon className="w-3.5 h-3.5 text-gray-500" />
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-gray-800">
                            {opt.label}
                          </span>
                          <span className="block text-xs text-gray-400 truncate">{opt.hint}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
