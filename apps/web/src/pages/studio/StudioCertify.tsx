import { StudioLayout } from './StudioLayout'
import { EmptyState } from '../../components/ui/empty-state'
import { BadgeCheck } from 'lucide-react'

export default function StudioCertify() {
  return (
    <StudioLayout>
      <div className="px-6 py-8">
        <EmptyState
          size="lg"
          icon={<BadgeCheck className="w-full h-full" />}
          title="Certify Records"
          description="Record certification flow — coming in Plan 04."
        />
      </div>
    </StudioLayout>
  )
}
