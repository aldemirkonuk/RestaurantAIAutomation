import { useState } from 'react'
import { ArrowUpRight, CheckCircle2, Loader2 } from 'lucide-react'
import { WineRecord, useStudioSessionStore } from '../../stores/useStudioSessionStore'
import { Skeleton } from '../../components/ui/loading-skeleton'
import { FieldCell } from './FieldCell'
import { canPromote } from '../../lib/wine-format-mapper'

// D-06: fixed column order — never reorder
const COLUMN_ORDER: { key: keyof WineRecord; label: string; minWidth: number }[] = [
  { key: 'wine_name', label: 'Wine Name', minWidth: 220 },
  { key: 'vintage', label: 'Vintage', minWidth: 80 },
  { key: 'producer', label: 'Producer', minWidth: 160 },
  { key: 'region', label: 'Region', minWidth: 140 },
  { key: 'country', label: 'Country', minWidth: 120 },
  { key: 'grape_variety', label: 'Grape Variety', minWidth: 160 },
  { key: 'color', label: 'Color', minWidth: 100 },
  { key: 'primary_type', label: 'Primary Type', minWidth: 120 },
  { key: 'sweetness_level', label: 'Sweetness', minWidth: 120 },
  { key: 'price_bottle', label: 'Bottle', minWidth: 100 },
  { key: 'price_glass', label: 'Glass', minWidth: 100 },
  { key: 'tasting_notes', label: 'Tasting Notes', minWidth: 200 },
  { key: 'description', label: 'Description', minWidth: 200 },
]

interface WineRecordsTableProps {
  records: WineRecord[]
  isLoading: boolean
}

type PromoteState = 'idle' | 'loading' | 'promoted' | 'duplicate' | 'error'

export function WineRecordsTable({ records, isLoading }: WineRecordsTableProps) {
  const { sessionId, setRecords } = useStudioSessionStore()
  const [promoteStates, setPromoteStates] = useState<Record<string, PromoteState>>({})

  const handlePromote = async (record: WineRecord) => {
    const id = record.id
    setPromoteStates((prev) => ({ ...prev, [id]: 'loading' }))
    const token = localStorage.getItem('accessToken')
    try {
      const resp = await fetch('/api/v1/studio/promote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ submission_id: record.submission_id }),
      })
      if (resp.status === 409) {
        setPromoteStates((prev) => ({ ...prev, [id]: 'duplicate' }))
        return
      }
      if (!resp.ok) {
        setPromoteStates((prev) => ({ ...prev, [id]: 'error' }))
        setTimeout(() => setPromoteStates((prev) => ({ ...prev, [id]: 'idle' })), 3000)
        return
      }
      setPromoteStates((prev) => ({ ...prev, [id]: 'promoted' }))
    } catch {
      setPromoteStates((prev) => ({ ...prev, [id]: 'error' }))
      setTimeout(() => setPromoteStates((prev) => ({ ...prev, [id]: 'idle' })), 3000)
    }
  }

  const handleOverrideSuccess = (recordId: string, field: string, newValue: string) => {
    setRecords(
      useStudioSessionStore.getState().records.map((r) =>
        r.id === recordId
          ? {
              ...r,
              [field]: newValue,
              field_confidence: {
                ...(r.field_confidence ?? {}),
                [field]: { value: newValue, confidence: 1.0, source: 'human_override' },
              },
            }
          : r
      )
    )
  }

  if (isLoading) {
    return (
      <div className="rounded-xl border border-slate-200 shadow-xs bg-white overflow-hidden">
        {[1, 2, 3].map((i) => (
          <div key={i} className="p-4 border-b border-slate-100 last:border-0">
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
      </div>
    )
  }

  if (records.length === 0) return null

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-xs bg-white max-h-[calc(100vh-320px)] overflow-y-auto">
      <table className="w-full border-collapse" style={{ minWidth: COLUMN_ORDER.reduce((a, c) => a + c.minWidth, 0) + 110 }}>
        <thead className="sticky top-0 z-10 bg-[#F1F3F5]">
          <tr>
            {COLUMN_ORDER.map((col) => (
              <th
                key={col.key}
                style={{ minWidth: col.minWidth }}
                className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 text-left ${
                  col.key === 'wine_name' ? 'sticky left-0 bg-[#F1F3F5] z-20' : ''
                }`}
              >
                {col.label}
              </th>
            ))}
            <th
              style={{ minWidth: 110 }}
              className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 text-left"
            >
              Action
            </th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => {
            const fc = record.field_confidence ?? {}
            const hasReview = Object.values(fc).some(
              (e) => e && typeof e === 'object' && e.confidence !== null && e.confidence >= 0.5 && e.confidence < 0.8
            )
            const promoteState = promoteStates[record.id] ?? 'idle'
            const promotable = canPromote(record)
            return (
              <tr
                key={record.id}
                className={`border-b border-slate-100 last:border-0 hover:bg-wine-50/40 transition-colors duration-100 ${
                  hasReview ? 'bg-amber-50/30' : 'bg-white'
                }`}
                style={{ minHeight: 56 }}
              >
                {COLUMN_ORDER.map((col) => {
                  const rawVal = record[col.key]
                  // Guard: if rawVal is a nested {value,...} object (unflatten slip), extract the string
                  const plainVal = (rawVal && typeof rawVal === 'object' && 'value' in rawVal)
                    ? (rawVal as { value: unknown }).value as string | null
                    : rawVal as string | null
                  const entry = fc[col.key as string] ?? { value: plainVal, confidence: null, source: null }
                  return (
                    <FieldCell
                      key={col.key}
                      recordId={record.id}
                      submissionId={record.submission_id}
                      sessionId={sessionId}
                      field={col.key as string}
                      entry={{
                        value: entry.value ?? null,
                        confidence: entry.confidence ?? null,
                        source: entry.source ?? null,
                      }}
                      onOverrideSuccess={(f, v) => handleOverrideSuccess(record.id, f, v)}
                    />
                  )
                })}
                <td className="px-3 py-2">
                  {promoteState === 'promoted' ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-100 px-2 py-1 rounded-full">
                      <CheckCircle2 className="w-3 h-3" />
                      Promoted
                    </span>
                  ) : promoteState === 'duplicate' ? (
                    <span className="text-xs font-medium text-amber-700 bg-amber-100 px-2 py-1 rounded-full">
                      Already in library
                    </span>
                  ) : promoteState === 'error' ? (
                    <span className="text-xs font-medium text-red-600 bg-red-100 px-2 py-1 rounded-full">
                      Failed
                    </span>
                  ) : (
                    <button
                      onClick={() => handlePromote(record)}
                      disabled={!promotable || promoteState === 'loading'}
                      className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full transition-colors ${
                        promotable
                          ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 cursor-pointer'
                          : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      }`}
                      title={promotable ? 'Promote to Wine Library' : 'Wine name required to promote'}
                    >
                      {promoteState === 'loading' ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <ArrowUpRight className="w-3 h-3" />
                      )}
                      Promote
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
