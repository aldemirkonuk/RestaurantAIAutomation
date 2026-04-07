import { WineRecord, useStudioSessionStore } from '../../stores/useStudioSessionStore'
import { Skeleton } from '../../components/ui/loading-skeleton'
import { FieldCell } from './FieldCell'

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
]

interface WineRecordsTableProps {
  records: WineRecord[]
  isLoading: boolean
}

export function WineRecordsTable({ records, isLoading }: WineRecordsTableProps) {
  const { sessionId, setRecords } = useStudioSessionStore()

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
      <table className="w-full border-collapse" style={{ minWidth: COLUMN_ORDER.reduce((a, c) => a + c.minWidth, 0) }}>
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
          </tr>
        </thead>
        <tbody>
          {records.map((record) => {
            const fc = record.field_confidence ?? {}
            const hasReview = Object.values(fc).some(
              (e) => e && typeof e === 'object' && e.confidence !== null && e.confidence >= 0.5 && e.confidence < 0.8
            )
            return (
              <tr
                key={record.id}
                className={`border-b border-slate-100 last:border-0 hover:bg-wine-50/40 transition-colors duration-100 ${
                  hasReview ? 'bg-amber-50/30' : 'bg-white'
                }`}
                style={{ minHeight: 56 }}
              >
                {COLUMN_ORDER.map((col) => {
                  const entry = fc[col.key as string] ?? { value: record[col.key] as string | null, confidence: null, source: null }
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
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
