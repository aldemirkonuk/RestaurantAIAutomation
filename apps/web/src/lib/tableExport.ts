/**
 * Generic tabular export used by list/table pages (Orders, etc.).
 *
 * Everything runs client-side from rows already on screen, so what you export
 * always matches the active filters. Heavy writers (ExcelJS, jsPDF) are
 * dynamically imported so they stay out of the main bundle.
 */
import { currencyMinorUnits } from './currency'
import { getHouseLocale } from './houseCurrency'
import { getHouseZone } from './houseZone'

export type TableExportFormat =
  | 'csv'
  | 'tsv'
  | 'excel'
  | 'json'
  | 'markdown'
  | 'html'
  | 'pdf'
  | 'print'
  | 'clipboard'

export interface TableExportColumn<T> {
  header: string
  /** Cell value; return a primitive — objects are stringified. */
  value: (row: T) => string | number | null | undefined
}

export interface TableExportOptions<T> {
  format: TableExportFormat
  rows: T[]
  columns: TableExportColumn<T>[]
  /** Base filename without extension, e.g. "orders-2026-07-26". */
  filename: string
  /** Document title used by PDF / print / markdown / html output. */
  title?: string
  /** The formats tag the text files are written in; the house's own by default (F-1401). */
  locale?: string
  /**
   * Lines said above the table, as label and value: whose file it is, when it
   * was read, what it shows and what it leaves out (F-1607). A spreadsheet's
   * rows carry none of that, so a file handed on read as the whole book.
   * Written into every file but JSON and the clipboard, which stay the table.
   */
  about?: Array<[string, string]>
  /** The house's IANA zone for the "generated" stamp; the picked house's by default (F-1740). */
  zone?: string | null
}

const EXTENSIONS: Partial<Record<TableExportFormat, string>> = {
  csv: 'csv',
  tsv: 'tsv',
  excel: 'xlsx',
  json: 'json',
  markdown: 'md',
  html: 'html',
  pdf: 'pdf',
}

type Cell = string | number

/**
 * Cells as the columns gave them: a number stays a number, so a spreadsheet
 * can sum it (an Excel cell written from the string "8.5" is text, and SUM
 * over text is 0). Only the text formats stringify, through `cellText`.
 */
function toCells<T>(rows: T[], columns: TableExportColumn<T>[]): Cell[][] {
  return rows.map((row) =>
    columns.map((col) => {
      const raw = col.value(row)
      if (raw === null || raw === undefined) return ''
      if (typeof raw === 'number') return Number.isFinite(raw) ? raw : ''
      return typeof raw === 'string' ? raw : String(raw)
    }),
  )
}

function cellText(cell: Cell, decimal = '.'): string {
  return typeof cell === 'number' ? String(cell).replace('.', decimal) : cell
}

/** A header `moneyHeader` wrote, with the unit it names (F-599). */
const MONEY_HEADER = / \(([A-Z]{3}|currency not read|currency not recorded)\)$/

/**
 * How a number reads in a file a person reads (PDF, print, HTML, Markdown),
 * per column (F-1740): money the way the screen shows it — the house's decimal
 * mark and grouping, to its currency's places (two; "1.234,56" in a lira
 * house); any other number with the house's decimal mark and no grouping, so
 * a vintage stays "2019" and never "2.019". CSV, TSV, the clipboard and the
 * workbook keep the raw figure a sheet can sum.
 */
function documentNumbers(headers: string[], locale: string): Array<(n: number) => string> {
  const make = (o: Intl.NumberFormatOptions) => {
    try {
      return new Intl.NumberFormat(locale, o)
    } catch {
      return new Intl.NumberFormat('en-US', o)
    }
  }
  return headers.map((h) => {
    const unit = MONEY_HEADER.exec(h)?.[1]
    if (unit === undefined) {
      const plain = make({ maximumFractionDigits: 3, useGrouping: false })
      return (n) => plain.format(n)
    }
    const places = currencyMinorUnits(unit) ?? 2
    const money = make({ minimumFractionDigits: places, maximumFractionDigits: places })
    return (n) => money.format(n)
  })
}

/**
 * When a file was made, on the house's clock when it has one and in the
 * house's formats, as the valuation file's "As of" line says it (F-1740).
 */
function generatedSaid(locale: string, zone: string | null): string {
  const now = new Date()
  const opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }
  const said = (o: Intl.DateTimeFormatOptions) => {
    try {
      return now.toLocaleString(locale, o)
    } catch {
      return now.toLocaleString('en-US', o)
    }
  }
  if (zone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: zone })
      return `${said({ ...opts, timeZone: zone })}, house time (${zone})`
    } catch {
      // A zone this browser cannot read: the reader's clock stands in, and says so.
    }
  }
  return `${said(opts)}, this device's time`
}

/**
 * The gateway's report CSV rule (`report-export-render.ts`, csvMarks, F-907):
 * Excel splits a double-clicked .csv on the system list separator, which is
 * ";" wherever the decimal mark is "," (Türkiye, most of Europe). A
 * comma-joined file opened there as one column, and "12.5" as text or a date
 * (F-1401). TSV and the clipboard keep the tab but take the same decimal.
 */
export function csvMarks(locale: string | null | undefined): { sep: ',' | ';'; decimal: string } {
  let decimal = '.'
  try {
    decimal =
      new Intl.NumberFormat(locale || 'en-US').formatToParts(1.5).find((p) => p.type === 'decimal')?.value ?? '.'
  } catch {
    // An unusable tag writes the en-US marks, as the gateway does.
  }
  return decimal === ',' ? { sep: ';', decimal } : { sep: ',', decimal: '.' }
}

/**
 * The gateway's report CSV rule (`report-export-render.ts`, FORMULA_LEAD): a
 * TEXT cell that begins with `=`, `+`, `-`, `@`, tab or CR is prefixed with
 * `'`, so a staff name or a wine alias someone typed as `=HYPERLINK(...)`
 * opens as words, not as a formula (OWASP CSV injection). Numbers are left
 * alone, so a negative figure stays a number.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/

function guardFormula(cell: Cell): Cell {
  return typeof cell === 'string' && FORMULA_LEAD.test(cell) ? `'${cell}` : cell
}

/** What an uncosted figure says in a file, as in the gateway's report CSV. */
export const WITHHELD = 'withheld'

/**
 * The unit a money header names (F-599): a bare number in a spreadsheet has no
 * currency. A failed or unfinished read is never "not recorded" (ADR 0083).
 */
export function moneyUnit(
  currency: { code: string | null; readable: boolean } | null | undefined,
): string {
  if (!currency || currency.readable !== true) return 'currency not read'
  return currency.code || 'currency not recorded'
}

export const moneyHeader = (label: string, unit: string) => `${label} (${unit})`

/** The day in an export's filename: the reader's own date, never UTC's (F-601). */
export function exportDay(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

/**
 * Write to the clipboard and say whether it took (F-600). A browser that
 * refuses, or has no clipboard, answers false instead of throwing.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) return false
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * A filename from a name someone typed: letters and digits of any script stay
 * (Kavaklıdere Öküzgözü → kavaklıdere-öküzgözü), everything else is one dash.
 */
export function fileSafeName(name: string, fallback: string): string {
  const safe = name
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return safe || fallback
}

/**
 * The house's name as the exports shelf writes it into a file name,
 * `mudavym-<house>-…` (F-1631): plain ASCII, lower case, hyphens, at most 40
 * letters, "house" when there is no name. The same rule as the gateway's
 * `houseSlug` (`report-export-naming.ts`), so a file saved here and one from
 * the shelf name the house alike.
 */
export function exportHouseWord(name: string | null | undefined): string {
  const slug = (name ?? '')
    // Turkish dotless i has no decomposition; everything else NFKD strips.
    .replace(/ı/g, 'i')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return slug || 'house'
}

/**
 * jsPDF's built-in Helvetica speaks WinAnsi only: ş ğ ı İ Ş Ğ have no glyph in
 * it, and one such letter turns the whole string to garble. The PDF carries
 * Inter instead (OFL, `public/fonts/OFL-inter.txt`), fetched only when a PDF
 * is made so it stays out of every other page load.
 */
const PDF_FONT_URL = '/fonts/inter-regular.ttf'
const PDF_FONT = 'Inter'

async function embedPdfFont(doc: {
  addFileToVFS: (name: string, data: string) => unknown
  addFont: (file: string, name: string, style: string) => unknown
  setFont: (name: string) => unknown
}): Promise<void> {
  let bytes: Uint8Array
  try {
    const res = await fetch(PDF_FONT_URL)
    if (!res.ok) throw new Error(String(res.status))
    bytes = new Uint8Array(await res.arrayBuffer())
  } catch {
    // Never fall back to Helvetica: that writes a PDF whose Turkish names are
    // garbled, and nothing on it would say so.
    throw new Error('The PDF could not be made: its lettering did not load. Check the connection and try again.')
  }
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  doc.addFileToVFS('inter-regular.ttf', btoa(binary))
  // One weight serves both: the table header asks for bold.
  doc.addFont('inter-regular.ttf', PDF_FONT, 'normal')
  doc.addFont('inter-regular.ttf', PDF_FONT, 'bold')
  doc.setFont(PDF_FONT)
}

/**
 * How long the blob URL outlives the click, as `saveFile` in
 * `pages/reports/next/useReportExports.ts` does. `a.click()` only STARTS a
 * download; some Safari and Firefox versions abort it when the URL is revoked
 * in the same tick, and a detached anchor is not clicked at all in some.
 * Revoking later still frees the blob (F-598).
 */
export const REVOKE_AFTER_MS = 1000

/** Hand a file to the reader: attach, click, detach, revoke after a delay. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS)
}

function escapeCsv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildHtmlDocument(
  title: string,
  headers: string[],
  matrix: string[][],
  about: Array<[string, string]>,
  generated: string,
): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 32px; color: #111827; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.meta { color: #6b7280; font-size: 12px; margin: 0 0 20px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th { background: #1A5E6B; color: #fff; text-align: left; padding: 8px; }
  td { border-bottom: 1px solid #e5e7eb; padding: 8px; }
  tr:nth-child(even) td { background: #fafafa; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<p class="meta">${matrix.length} row${matrix.length === 1 ? '' : 's'} · generated ${escapeHtml(generated)}</p>
${about.map(([k, v]) => `<p class="meta">${escapeHtml(k)}: ${escapeHtml(v)}</p>`).join('\n')}
<table>
<thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
<tbody>
${matrix.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('\n')}
</tbody>
</table>
</body>
</html>`
}

export async function exportTable<T>({
  format,
  rows,
  columns,
  filename,
  title = filename,
  locale = getHouseLocale(),
  about = [],
  zone = getHouseZone(),
}: TableExportOptions<T>): Promise<void> {
  const headers = columns.map((c) => c.header)
  const cells = toCells(rows, columns)
  const marks = csvMarks(locale)
  // The document formats only: the house's marks, money to its places (F-1740).
  const numbers = documentNumbers(headers, locale)
  const matrix = cells.map((row) => row.map((c, j) => (typeof c === 'number' ? numbers[j](c) : c)))
  const generated = generatedSaid(locale, zone)
  const ext = EXTENSIONS[format]
  const fullName = ext ? `${filename}.${ext}` : filename
  // The lines above the table, then one blank row, as the gateway's report CSV.
  const aboutRows: string[][] = about.length > 0 ? [...about.map(([k, v]) => [k, String(guardFormula(v))]), []] : []

  switch (format) {
    case 'csv': {
      const body = [...aboutRows, headers, ...cells.map((row) => row.map((c) => cellText(guardFormula(c), marks.decimal)))]
        .map((row) => row.map(escapeCsv).join(marks.sep))
        .join('\n')
      // BOM so Excel opens it as UTF-8 (Turkish letters, em dashes), as the
      // gateway's report CSV does.
      downloadBlob(new Blob(['\uFEFF' + body], { type: 'text/csv;charset=utf-8' }), fullName)
      break
    }

    case 'tsv': {
      // Tabs survive a paste straight into Excel / Google Sheets cells.
      const clean = (v: string) => v.replace(/[\t\r\n]+/g, ' ')
      const body = [...aboutRows, headers, ...cells.map((row) => row.map((c) => cellText(guardFormula(c), marks.decimal)))]
        .map((row) => row.map(clean).join('\t'))
        .join('\n')
      downloadBlob(new Blob([body], { type: 'text/tab-separated-values;charset=utf-8' }), fullName)
      break
    }

    case 'json': {
      const objects = rows.map((row) =>
        Object.fromEntries(columns.map((col) => [col.header, col.value(row) ?? null])),
      )
      downloadBlob(
        new Blob([JSON.stringify(objects, null, 2)], { type: 'application/json' }),
        fullName,
      )
      break
    }

    case 'markdown': {
      // Backslash first: escaping `|` before `\` turns a cell containing `\|`
      // into `\\|`, which markdown reads as an escaped backslash followed by a
      // live column separator — the value breaks out of its own cell and
      // shifts every column after it.
      const cell = (v: string) =>
        v.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ')
      const lines = [
        `# ${title}`,
        '',
        ...about.flatMap(([k, v]) => [`${cell(k)}: ${cell(v)}`, '']),
        `| ${headers.map(cell).join(' | ')} |`,
        `| ${headers.map(() => '---').join(' | ')} |`,
        ...matrix.map((row) => `| ${row.map(cell).join(' | ')} |`),
      ]
      downloadBlob(new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }), fullName)
      break
    }

    case 'html': {
      downloadBlob(
        new Blob([buildHtmlDocument(title, headers, matrix, about, generated)], { type: 'text/html;charset=utf-8' }),
        fullName,
      )
      break
    }

    case 'excel': {
      const ExcelJS = (await import('exceljs')).default
      const workbook = new ExcelJS.Workbook()
      workbook.creator = 'Mudavym'
      workbook.created = new Date()

      // The header sits under the lines about the file, when there are any.
      const headAt = aboutRows.length + 1
      const sheet = workbook.addWorksheet(title.slice(0, 31) || 'Export', {
        views: [{ state: 'frozen', ySplit: headAt }],
      })
      sheet.columns = columns.map((col) => ({
        key: col.header,
        width: Math.min(Math.max(col.header.length + 6, 14), 40),
      }))
      aboutRows.forEach((row, i) => {
        sheet.getRow(i + 1).values = row
      })
      sheet.getRow(headAt).values = headers
      // Typed cells: numbers as numbers. A string is written as a text cell,
      // which Excel shows and never evaluates, so no formula guard is needed.
      cells.forEach((row) => sheet.addRow(row))

      const headerRow = sheet.getRow(headAt)
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF722F37' },
      }
      headerRow.alignment = { vertical: 'middle' }
      headerRow.height = 22
      sheet.autoFilter = {
        from: { row: headAt, column: 1 },
        to: { row: headAt, column: columns.length },
      }

      const buffer = await workbook.xlsx.writeBuffer()
      downloadBlob(
        new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        fullName,
      )
      break
    }

    case 'pdf': {
      const { default: jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')

      const doc = new jsPDF({ orientation: columns.length > 6 ? 'landscape' : 'portrait' })
      await embedPdfFont(doc)
      doc.setFontSize(16)
      doc.text(title, 14, 18)
      doc.setFontSize(10)
      doc.setTextColor(130)
      doc.text(
        `${matrix.length} row${matrix.length === 1 ? '' : 's'} · generated ${generated}`,
        14,
        25,
      )

      about.forEach(([k, v], i) => doc.text(`${k}: ${v}`, 14, 31 + i * 5))

      autoTable(doc, {
        startY: 32 + about.length * 5,
        head: [headers],
        body: matrix,
        theme: 'grid',
        styles: { font: PDF_FONT, fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [26,94,107], textColor: 255 },
        alternateRowStyles: { fillColor: [250, 250, 250] },
      })

      doc.save(fullName)
      break
    }

    case 'print': {
      const win = window.open('', '_blank', 'width=1024,height=768')
      if (!win) throw new Error('Popup blocked — allow popups to print.')
      win.document.write(buildHtmlDocument(title, headers, matrix, about, generated))
      win.document.close()
      win.focus()
      win.print()
      break
    }

    case 'clipboard': {
      // Pasted into a sheet, a cell is read as a formula exactly as in a CSV,
      // so it gets the same guard.
      const clean = (v: string) => v.replace(/[\t\r\n]+/g, ' ')
      const body = [headers, ...cells.map((row) => row.map((c) => cellText(guardFormula(c), marks.decimal)))]
        .map((row) => row.map(clean).join('\t'))
        .join('\n')
      await navigator.clipboard.writeText(body)
      break
    }
  }
}
