import { StudioLayout } from './StudioLayout'
import { CommandBar } from './CommandBar'
import { SessionSummary } from './SessionSummary'
import { MetricsDashboard } from './metrics/MetricsDashboard'
import { WineRecordsTable } from './WineRecordsTable'
import { EmptyState } from '../../components/ui/empty-state'
import { Database } from 'lucide-react'
import { useStudioSessionStore } from '../../stores/useStudioSessionStore'

export default function Studio() {
  const { sessionId, records, isExtracting } = useStudioSessionStore()

  return (
    <StudioLayout>
      <div className="px-6 py-8 flex flex-col gap-4 min-h-0">
        <CommandBar />
        {sessionId && <SessionSummary />}
        <MetricsDashboard />
        {!sessionId && !isExtracting ? (
          <div className="flex-1 flex items-center justify-center py-24">
            <EmptyState
              size="lg"
              icon={<Database className="w-full h-full" />}
              title="No records in this session"
              description="Paste a URL or drop a PDF into the bar above to begin ingestion."
            />
          </div>
        ) : (
          <WineRecordsTable records={records} isLoading={isExtracting} />
        )}
      </div>
    </StudioLayout>
  )
}
