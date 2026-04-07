import { StudioLayout } from './StudioLayout'
import { EmptyState } from '../../components/ui/empty-state'
import { ClipboardList } from 'lucide-react'

export default function StudioApprovalQueue() {
  return (
    <StudioLayout>
      <div className="px-6 py-8">
        <EmptyState
          size="lg"
          icon={<ClipboardList className="w-full h-full" />}
          title="Approval Queue"
          description="Override approval queue — coming in Plan 04."
        />
      </div>
    </StudioLayout>
  )
}
