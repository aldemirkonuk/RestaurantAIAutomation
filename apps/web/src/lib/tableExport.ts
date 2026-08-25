/**
 * Generic tabular export used by list/table pages (Orders, etc.).
 *
 * Everything runs client-side from rows already on screen, so what you export
 * always matches the active filters. Heavy writers (ExcelJS, jsPDF) are
 * dynamically imported so they stay out of the main bundle.
 */

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

function toMatrix<T>(rows: T[], columns: TableExportColumn<T>[]): string[][] {
  return rows.map((row) =>
    columns.map((col) => {
      const raw = col.value(row)
      if (raw === null || raw === undefined) return ''
      return typeof raw === 'string' ? raw : String(raw)
    }),
  )
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
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

function buildHtmlDocument(title: string, headers: string[], matrix: string[][]): string {
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
  th { background: #9E4249; color: #fff; text-align: left; padding: 8px; }
  td { border-bottom: 1px solid #e5e7eb; padding: 8px; }
  tr:nth-child(even) td { background: #fafafa; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<p class="meta">${matrix.length} row${matrix.length === 1 ? '' : 's'} · generated ${new Date().toLocaleString()}</p>
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
}: TableExportOptions<T>): Promise<void> {
  const headers = columns.map((c) => c.header)
  const matrix = toMatrix(rows, columns)
  const ext = EXTENSIONS[format]
  const fullName = ext ? `${filename}.${ext}` : filename

  switch (format) {
    case 'csv': {
      const body = [headers, ...matrix]
        .map((row) => row.map(escapeCsv).join(','))
        .join('\n')
      download(new Blob([body], { type: 'text/csv;charset=utf-8' }), fullName)
      break
    }

    case 'tsv': {
      // Tabs survive a paste straight into Excel / Google Sheets cells.
      const clean = (v: string) => v.replace(/[\t\r\n]+/g, ' ')
      const body = [headers, ...matrix]
        .map((row) => row.map(clean).join('\t'))
        .join('\n')
      download(new Blob([body], { type: 'text/tab-separated-values;charset=utf-8' }), fullName)
      break
    }

    case 'json': {
      const objects = rows.map((row) =>
        Object.fromEntries(columns.map((col) => [col.header, col.value(row) ?? null])),
      )
      download(
        new Blob([JSON.stringify(objects, null, 2)], { type: 'application/json' }),
        fullName,
      )
      break
    }

    case 'markdown': {
      const cell = (v: string) => v.replace(/\|/g, '\\|').replace(/\n/g, ' ')
      const lines = [
        `# ${title}`,
        '',
        `| ${headers.map(cell).join(' | ')} |`,
        `| ${headers.map(() => '---').join(' | ')} |`,
        ...matrix.map((row) => `| ${row.map(cell).join(' | ')} |`),
      ]
      download(new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }), fullName)
      break
    }

    case 'html': {
      download(
        new Blob([buildHtmlDocument(title, headers, matrix)], { type: 'text/html;charset=utf-8' }),
        fullName,
      )
      break
    }

    case 'excel': {
      const ExcelJS = (await import('exceljs')).default
      const workbook = new ExcelJS.Workbook()
      workbook.creator = 'WineOps AI'
      workbook.created = new Date()

      const sheet = workbook.addWorksheet(title.slice(0, 31) || 'Export', {
        views: [{ state: 'frozen', ySplit: 1 }],
      })
      sheet.columns = columns.map((col) => ({
        header: col.header,
        key: col.header,
        width: Math.min(Math.max(col.header.length + 6, 14), 40),
      }))
      matrix.forEach((row) => sheet.addRow(row))

      const headerRow = sheet.getRow(1)
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF722F37' },
      }
      headerRow.alignment = { vertical: 'middle' }
      headerRow.height = 22
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: columns.length },
      }

      const buffer = await workbook.xlsx.writeBuffer()
      download(
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
      doc.setFontSize(16)
      doc.text(title, 14, 18)
      doc.setFontSize(10)
      doc.setTextColor(130)
      doc.text(
        `${matrix.length} row${matrix.length === 1 ? '' : 's'} · generated ${new Date().toLocaleString()}`,
        14,
        25,
      )

      autoTable(doc, {
        startY: 32,
        head: [headers],
        body: matrix,
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [158, 66, 73], textColor: 255 },
        alternateRowStyles: { fillColor: [250, 250, 250] },
      })

      doc.save(fullName)
      break
    }

    case 'print': {
      const win = window.open('', '_blank', 'width=1024,height=768')
      if (!win) throw new Error('Popup blocked — allow popups to print.')
      win.document.write(buildHtmlDocument(title, headers, matrix))
      win.document.close()
      win.focus()
      win.print()
      break
    }

    case 'clipboard': {
      const clean = (v: string) => v.replace(/[\t\r\n]+/g, ' ')
      const body = [headers, ...matrix]
        .map((row) => row.map(clean).join('\t'))
        .join('\n')
      await navigator.clipboard.writeText(body)
      break
    }
  }
}
