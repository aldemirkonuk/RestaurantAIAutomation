/**
 * The client exports a house opens in a spreadsheet or prints: what reaches
 * the file, byte for byte (wave6sim F-359, F-360, F-363, F-368, F-369).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const pdf = vi.hoisted(() => ({
  doc: {
    addFileToVFS: vi.fn(),
    addFont: vi.fn(),
    setFont: vi.fn(),
    setFontSize: vi.fn(),
    setTextColor: vi.fn(),
    text: vi.fn(),
    save: vi.fn(),
  },
  autoTable: vi.fn(),
}))

vi.mock('jspdf', () => ({ default: vi.fn(() => pdf.doc) }))
vi.mock('jspdf-autotable', () => ({ default: pdf.autoTable }))

import { exportTable, fileSafeName, type TableExportColumn } from './tableExport'

type Row = { who: string; hours: number; cost: number | null }
const columns: TableExportColumn<Row>[] = [
  { header: 'Who', value: (r) => r.who },
  { header: 'Hours worked', value: (r) => r.hours },
  { header: 'Labour cost', value: (r) => r.cost },
]

const created: Blob[] = []
const urlApi = URL as unknown as { createObjectURL?: unknown; revokeObjectURL?: unknown }
const saved = { create: urlApi.createObjectURL, revoke: urlApi.revokeObjectURL }

function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve) => {
    const r = new FileReader()
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer))
    r.readAsArrayBuffer(blob)
  })
}

beforeEach(() => {
  created.length = 0
  urlApi.createObjectURL = vi.fn((b: Blob) => (created.push(b), 'blob:x'))
  urlApi.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  urlApi.createObjectURL = saved.create
  urlApi.revokeObjectURL = saved.revoke
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('CSV', () => {
  it('starts with a UTF-8 BOM so Excel reads Turkish letters (F-359)', async () => {
    await exportTable({ format: 'csv', rows: [{ who: 'Şükrü', hours: 8.5, cost: null }], columns, filename: 'x' })
    const bytes = await bytesOf(created[0])
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)).toContain('"Şükrü"')
  })

  it('a typed name that begins like a formula opens as words; a negative number stays a number (F-369)', async () => {
    await exportTable({
      format: 'csv',
      rows: [
        { who: '=HYPERLINK("http://x","pay")', hours: -2, cost: 10 },
        { who: '@SUM(A1)', hours: 1, cost: 1 },
      ],
      columns,
      filename: 'x',
    })
    const text = new TextDecoder().decode(await bytesOf(created[0]))
    expect(text).toContain(`"'=HYPERLINK(""http://x"",""pay"")","-2","10"`)
    expect(text).toContain(`"'@SUM(A1)"`)
  })

  it('TSV gets the same formula guard', async () => {
    await exportTable({ format: 'tsv', rows: [{ who: '+1 555', hours: 1, cost: 1 }], columns, filename: 'x' })
    const text = new TextDecoder().decode(await bytesOf(created[0]))
    expect(text.split('\n')[1].split('\t')[0]).toBe("'+1 555")
  })
})

describe('Excel', () => {
  it('writes numbers as number cells, so SUM over a column is not 0 (F-368)', async () => {
    await exportTable({
      format: 'excel',
      rows: [{ who: '=1+1', hours: 8.5, cost: 120 }],
      columns,
      filename: 'x',
      title: 'Schedule',
    })
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load((await bytesOf(created[0])).buffer as ArrayBuffer)
    const row = wb.getWorksheet('Schedule')!.getRow(2)
    expect(row.getCell(2).type).toBe(ExcelJS.ValueType.Number)
    expect(row.getCell(2).value).toBe(8.5)
    expect(row.getCell(3).value).toBe(120)
    // A string is a text cell, which Excel shows and never evaluates.
    expect(row.getCell(1).type).toBe(ExcelJS.ValueType.String)
  })
})

describe('PDF', () => {
  it('embeds a font that has ş ğ ı İ and sets it on the title and the table (F-360)', async () => {
    const fontBytes = new Uint8Array([0, 1, 0, 0, 0x4f, 0x54])
    const fetchMock = vi.fn(async () => new Response(fontBytes, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await exportTable({ format: 'pdf', rows: [{ who: 'Kavaklıdere İşçi', hours: 1, cost: 1 }], columns, filename: 'x' })
    expect(fetchMock).toHaveBeenCalledWith('/fonts/inter-regular.ttf')
    expect(pdf.doc.addFileToVFS).toHaveBeenCalledWith('inter-regular.ttf', btoa(String.fromCharCode(...fontBytes)))
    expect(pdf.doc.addFont).toHaveBeenCalledWith('inter-regular.ttf', 'Inter', 'normal')
    expect(pdf.doc.setFont).toHaveBeenCalledWith('Inter')
    // The font is set before the first line of text is written.
    expect(pdf.doc.setFont.mock.invocationCallOrder[0]).toBeLessThan(pdf.doc.text.mock.invocationCallOrder[0])
    expect(pdf.autoTable.mock.calls[0][1].styles.font).toBe('Inter')
  })

  it('refuses in words, rather than writing garbled names, when the font cannot load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    pdf.doc.save.mockClear()
    await expect(
      exportTable({ format: 'pdf', rows: [{ who: 'a', hours: 1, cost: 1 }], columns, filename: 'x' }),
    ).rejects.toThrow('The PDF could not be made')
    expect(pdf.doc.save).not.toHaveBeenCalled()
  })
})

describe('fileSafeName (F-363)', () => {
  it('keeps Turkish letters in a filename', () => {
    expect(fileSafeName('Kavaklıdere Öküzgözü 2019', 'inventory-row')).toBe('kavaklıdere-öküzgözü-2019')
    expect(fileSafeName('Şarap / Boğazkere', 'inventory-row')).toBe('şarap-boğazkere')
  })

  it('falls back when nothing usable is left', () => {
    expect(fileSafeName(' / ', 'inventory-row')).toBe('inventory-row')
  })
})
