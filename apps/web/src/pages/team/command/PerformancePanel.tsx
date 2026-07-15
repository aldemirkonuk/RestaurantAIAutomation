/**
 * Per-server performance. Reads real ingested sales; shows an explicit
 * "no data yet" state (never mock numbers) until sales are attributed.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { BarChart3, Plus } from 'lucide-react'
import { getMemberPerformance, ingestSales, type TeamMember } from '../../../services/api/team'

export function PerformancePanel({ member }: { member: TeamMember | null }) {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ serviceDate: new Date().toISOString().slice(0, 10), covers: '', netSales: '', wineSales: '', checks: '' })

  const { data, isLoading } = useQuery({
    queryKey: ['team', 'performance', member?.id],
    queryFn: () => getMemberPerformance(member!.id),
    enabled: !!member,
  })

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

  if (!member) {
    return (
      <div className="p-4 text-xs text-gray-400">
        Select a shift to see that person&apos;s recent sales performance.
      </div>
    )
  }

  return (
    <div className="border-t border-gray-100">
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <div>
          <div className="text-[9px] font-bold uppercase tracking-wider text-wine-700">Staff performance</div>
          <div className="text-sm font-extrabold text-gray-900">{member.display_name}</div>
        </div>
        <button
          onClick={() => setAdding((v) => !v)}
          className="inline-flex items-center gap-1 h-7 px-2 border border-gray-200 rounded-lg text-[10px] font-bold text-gray-600 hover:bg-gray-50"
        >
          <Plus className="w-3 h-3" /> Log sales
        </button>
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
              Connect a POS or log a service above. We never show estimated numbers.
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
  const Y = (v: number) => H - ((v - lo) / (hi - lo)) * H
  const pts = series.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')
  return (
    <div>
      <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">
        Sales / cover · last {series.length} services
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-14">
        <rect x={0} y={Y(band[1])} width={W} height={Math.max(0, Y(band[0]) - Y(band[1]))} fill="rgba(190,18,60,.10)" />
        <line x1={0} y1={Y(median)} x2={W} y2={Y(median)} stroke="#9ca3af" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
        <polyline points={pts} fill="none" stroke="#be123c" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {series.length === 1 && <circle cx={X(0)} cy={Y(series[0])} r={3} fill="#be123c" />}
      </svg>
    </div>
  )
}
