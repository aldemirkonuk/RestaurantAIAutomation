/**
 * Per-server performance. Reads real ingested sales; shows an explicit
 * "no data yet" state (never mock numbers) until sales are attributed.
 * Supports single-service log + CSV batch upload.
 */
import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { BarChart3, Plus, Upload } from 'lucide-react'
import { getMemberPerformance, ingestSales, ingestSalesBatch, type TeamMember } from '../../../services/api/team'
import { ExportMenu } from '../../../components/ui/ExportMenu'
import { exportTable, type TableExportColumn, type TableExportFormat } from '../../../lib/tableExport'

export function PerformancePanel({ member }: { member: TeamMember | null }) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ serviceDate: new Date().toISOString().slice(0, 10), covers: '', netSales: '', wineSales: '', checks: '' })

  const { data, isLoading } = useQuery({
    queryKey: ['team', 'performance', member?.id],
    queryFn: () => getMemberPerformance(member!.id),
    enabled: !!member,
  })

  /** NEW-529: export this member's performance series in shared formats. */
  const exportSeries = async (format: TableExportFormat) => {
    const series = data?.analytic?.series ?? []
    if (series.length === 0) {
      toast.error('No performance data to export yet')
      return
    }
    const rows = series.map((v: any, i: number) => ({
      member: member?.display_name ?? '',
      point: i + 1,
      value: typeof v === 'number' ? v : (v?.value ?? ''),
    }))
    const columns: TableExportColumn<(typeof rows)[number]>[] = [
      { header: 'Member', value: (r) => r.member },
      { header: 'Point', value: (r) => r.point },
      { header: 'Value', value: (r) => r.value },
    ]
    try {
      await exportTable({
        format,
        rows,
        columns,
        filename: `performance-${(member?.display_name ?? 'member').replace(/[^\w]+/g, '-').toLowerCase()}`,
        title: `Performance · ${member?.display_name ?? 'member'}`,
      })
      toast.success(
        format === 'clipboard'
          ? `Copied ${rows.length} points`
          : format === 'print'
            ? 'Opening print view'
            : `Exported ${rows.length} points`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed')
    }
  }

  const save = useMutation({
    mutationFn: () =>
      ingestSales({
        memberId: member!.id,
        serviceDate: form.serviceDate,
        covers: Number(form.covers) || 0,
        netSales: Number(form.netSales) || 0,
        wineSales: Number(form.wineSales) || 0,
        checks: Number(form.checks) || 0,
        source: 'manual',
      }),
    onSuccess: () => {
      toast.success('Sales recorded')
      setAdding(false)
      setForm({ serviceDate: new Date().toISOString().slice(0, 10), covers: '', netSales: '', wineSales: '', checks: '' })
      qc.invalidateQueries({ queryKey: ['team', 'performance', member?.id] })
    },
    onError: () => toast.error('Could not record sales'),
  })

  const batch = useMutation({
    mutationFn: (rows: Record<string, any>[]) => ingestSalesBatch(rows),
    onSuccess: (r: any) => {
      toast.success(`Imported ${r?.inserted ?? r?.rows ?? 'batch'} sales rows`)
      qc.invalidateQueries({ queryKey: ['team', 'performance'] })
    },
    onError: () => toast.error('CSV import failed — check headers and member IDs'),
  })

  const onCsv = async (file: File) => {
    if (!member) return
    const text = await file.text()
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    if (lines.length < 2) {
      toast.error('CSV needs a header row and at least one data row')
      return
    }
    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase())
    const idx = (names: string[]) => headers.findIndex((h) => names.includes(h))
    const iDate = idx(['service_date', 'servicedate', 'date'])
    const iCovers = idx(['covers', 'cover'])
    const iNet = idx(['net_sales', 'netsales', 'sales', 'net'])
    const iWine = idx(['wine_sales', 'winesales', 'wine'])
    const iChecks = idx(['checks', 'check_count', 'tickets'])
    const iMember = idx(['member_id', 'memberid', 'member'])
    if (iDate < 0) {
      toast.error('CSV must include a service_date (or date) column')
      return
    }
    const rows = lines.slice(1).map((line) => {
      const cols = line.split(',').map((c) => c.trim())
      return {
        memberId: (iMember >= 0 ? cols[iMember] : null) || member.id,
        serviceDate: cols[iDate],
        covers: iCovers >= 0 ? Number(cols[iCovers]) || 0 : 0,
        netSales: iNet >= 0 ? Number(cols[iNet]) || 0 : 0,
        wineSales: iWine >= 0 ? Number(cols[iWine]) || 0 : 0,
        checks: iChecks >= 0 ? Number(cols[iChecks]) || 0 : 0,
        source: 'csv',
      }
    }).filter((r) => r.serviceDate && r.memberId)
    if (!rows.length) {
      toast.error('No valid rows found in CSV')
      return
    }
    batch.mutate(rows)
  }

  if (!member) {
    return (
      <div className="p-4 text-xs text-gray-400">
        Select a shift to see that person&apos;s recent sales performance.
      </div>
    )
  }

  return (
    <div className="border-t border-gray-100">
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2 gap-2">
        <div>
          <div className="text-[9px] font-bold uppercase tracking-wider text-wine-700">Staff performance</div>
          <div className="text-sm font-extrabold text-gray-900">{member.display_name}</div>
        </div>
        <div className="flex items-center gap-1.5">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onCsv(f)
              e.target.value = ''
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={batch.isPending}
            className="inline-flex items-center gap-1 h-7 px-2 border border-gray-200 rounded-lg text-[10px] font-bold text-gray-600 hover:bg-gray-50"
            title="CSV columns: service_date, covers, net_sales, wine_sales, checks[, member_id]"
          >
            <Upload className="w-3 h-3" /> CSV
          </button>
          <ExportMenu
            variant="soft"
            size="xs"
            label="Export"
            count={(data?.analytic?.series ?? []).length}
            onExport={exportSeries}
            title="Export this member's performance series"
          />
          <button
            onClick={() => setAdding((v) => !v)}
            className="inline-flex items-center gap-1 h-7 px-2 border border-gray-200 rounded-lg text-[10px] font-bold text-gray-600 hover:bg-gray-50"
          >
            <Plus className="w-3 h-3" /> Log sales
          </button>
        </div>
      </div>

      {adding && (
        <div className="mx-4 mb-3 p-3 rounded-lg border border-gray-100 bg-gray-50 grid grid-cols-2 gap-2">
          <input type="date" value={form.serviceDate} onChange={(e) => setForm({ ...form, serviceDate: e.target.value })} className="col-span-2 h-8 px-2 rounded-md border border-gray-200 text-xs" />
          <input placeholder="Covers" value={form.covers} onChange={(e) => setForm({ ...form, covers: e.target.value })} className="h-8 px-2 rounded-md border border-gray-200 text-xs" />
          <input placeholder="Checks" value={form.checks} onChange={(e) => setForm({ ...form, checks: e.target.value })} className="h-8 px-2 rounded-md border border-gray-200 text-xs" />
          <input placeholder="Net sales $" value={form.netSales} onChange={(e) => setForm({ ...form, netSales: e.target.value })} className="h-8 px-2 rounded-md border border-gray-200 text-xs" />
          <input placeholder="Wine sales $" value={form.wineSales} onChange={(e) => setForm({ ...form, wineSales: e.target.value })} className="h-8 px-2 rounded-md border border-gray-200 text-xs" />
          <button onClick={() => save.mutate()} disabled={save.isPending} className="col-span-2 h-8 bg-wine-600 text-white rounded-md text-xs font-bold hover:bg-wine-700">
            Save service
          </button>
        </div>
      )}

      <div className="px-4 pb-4">
        {isLoading ? (
          <div className="text-xs text-gray-400 py-4">Loading…</div>
        ) : !data?.hasData ? (
          <div className="flex flex-col items-center text-center gap-1.5 py-6 rounded-lg border border-dashed border-gray-200 bg-gray-50/60">
            <BarChart3 className="w-5 h-5 text-gray-300" />
            <div className="text-xs font-semibold text-gray-500">No sales data yet</div>
            <div className="text-[10px] text-gray-400 max-w-[220px]">
              Log a service or upload CSV. We never show estimated numbers.
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <Metric label="Sales / shift" value={`$${data.metrics!.salesPerShift.toLocaleString()}`} />
              <Metric label="Avg check" value={`$${data.metrics!.avgCheck.toLocaleString()}`} />
              <Metric label="Wine attach" value={`${data.metrics!.wineAttachPct}%`} />
            </div>
            <Sparkline analytic={data.analytic!} />
          </>
        )}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-2 rounded-lg border border-gray-100 bg-gray-50">
      <div className="text-sm font-extrabold tabular-nums text-gray-900">{value}</div>
      <div className="mt-0.5 text-[8px] font-bold uppercase tracking-wide text-gray-400">{label}</div>
    </div>
  )
}

function Sparkline({ analytic }: { analytic: NonNullable<import('../../../services/api/team').MemberPerformance['analytic']> }) {
  const { series, median, band } = analytic
  const W = 300, H = 60, pad = 4
  const all = [...series, median, band[0], band[1]]
  let lo = Math.min(...all), hi = Math.max(...all)
  const range = hi - lo || 1
  lo -= range * 0.15; hi += range * 0.15
  const X = (i: number) => pad + (i / Math.max(1, series.length - 1)) * (W - 2 * pad)
  const Y = (v: number) => H - pad - ((v - lo) / (hi - lo || 1)) * (H - 2 * pad)
  const path = series.map((v, i) => `${i ? 'L' : 'M'}${X(i)},${Y(v)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-14">
      <rect x={0} y={Y(band[1])} width={W} height={Math.max(1, Y(band[0]) - Y(band[1]))} fill="#f3f4f6" />
      <line x1={0} y1={Y(median)} x2={W} y2={Y(median)} stroke="#d1d5db" strokeDasharray="3 3" />
      <path d={path} fill="none" stroke="#B8323A" strokeWidth={2} />
    </svg>
  )
}
