import { Card, Button } from '../../components/ui'
import {
  Wine,
  Building2,
  Package,
  Clock,
  CheckCircle,
  ShoppingCart,
  Truck,
} from 'lucide-react'

interface OrderFiltersProps {
  filterStatus: string
  setFilterStatus: (status: string) => void
  groupBy: 'wine' | 'provider'
  setGroupBy: (groupBy: 'wine' | 'provider') => void
  setExpandedGroups: (groups: Set<string>) => void
  oneTimeOrderCount: number
  pendingCount: number
  approvedCount: number
  orderedCount: number
  deliveredCount: number
}

export function OrderFilters({
  filterStatus,
  setFilterStatus,
  groupBy,
  setGroupBy,
  setExpandedGroups,
  oneTimeOrderCount,
  pendingCount,
  approvedCount,
  orderedCount,
  deliveredCount,
}: OrderFiltersProps) {
  return (
    <>
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
        <Card variant="glass" padding="md" hover="lift">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 font-medium uppercase">Total</p>
              <p className="text-2xl font-bold text-gray-900">{oneTimeOrderCount}</p>
            </div>
            <div className="p-2 bg-gray-100 rounded-lg">
              <Package className="w-5 h-5 text-gray-600" />
            </div>
          </div>
        </Card>

        <Card variant="glass" padding="md" hover="lift" className={pendingCount > 0 ? 'ring-2 ring-yellow-400' : ''}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 font-medium uppercase">Pending</p>
              <p className="text-2xl font-bold text-yellow-600">{pendingCount}</p>
            </div>
            <div className="p-2 bg-yellow-100 rounded-lg">
              <Clock className="w-5 h-5 text-yellow-600" />
            </div>
          </div>
        </Card>

        <Card variant="glass" padding="md" hover="lift">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 font-medium uppercase">Approved</p>
              <p className="text-2xl font-bold text-emerald-600">{approvedCount}</p>
            </div>
            <div className="p-2 bg-emerald-100 rounded-lg">
              <CheckCircle className="w-5 h-5 text-emerald-600" />
            </div>
          </div>
        </Card>

        <Card variant="glass" padding="md" hover="lift">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 font-medium uppercase">Ordered</p>
              <p className="text-2xl font-bold text-blue-600">{orderedCount}</p>
            </div>
            <div className="p-2 bg-blue-100 rounded-lg">
              <ShoppingCart className="w-5 h-5 text-blue-600" />
            </div>
          </div>
        </Card>

        <Card variant="glass" padding="md" hover="lift">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 font-medium uppercase">Delivered</p>
              <p className="text-2xl font-bold text-purple-600">{deliveredCount}</p>
            </div>
            <div className="p-2 bg-purple-100 rounded-lg">
              <Truck className="w-5 h-5 text-purple-600" />
            </div>
          </div>
        </Card>
      </div>

      {/* Status Filter Tabs */}
      <Card variant="glass" padding="md" className="mb-6">
        <div className="flex gap-2 overflow-x-auto">
          {[
            { value: 'all', label: 'All Status' },
            { value: 'pending_approval', label: 'Pending' },
            { value: 'approved', label: 'Approved' },
            { value: 'ordered', label: 'Ordered' },
            { value: 'delivered', label: 'Delivered' },
          ].map((tab) => (
            <Button
              key={tab.value}
              variant={filterStatus === tab.value ? 'default' : 'ghost'}
              onClick={() => setFilterStatus(tab.value)}
              size="sm"
            >
              {tab.label}
            </Button>
          ))}
        </div>
      </Card>

      {/* Group By Toggle */}
      <Card variant="glass" padding="md" className="mb-6">
        <div className="flex items-center gap-4">
          <span className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Group By:</span>
          <div className="flex gap-2">
            <Button
              variant={groupBy === 'wine' ? 'default' : 'outline'}
              onClick={() => {
                setGroupBy('wine')
                setExpandedGroups(new Set())
              }}
              size="sm"
              className={groupBy === 'wine' ? 'bg-wine-600 hover:bg-wine-700' : ''}
            >
              <Wine className="w-4 h-4 mr-2" />
              Wine
            </Button>
            <Button
              variant={groupBy === 'provider' ? 'default' : 'outline'}
              onClick={() => {
                setGroupBy('provider')
                setExpandedGroups(new Set())
              }}
              size="sm"
              className={groupBy === 'provider' ? 'bg-wine-600 hover:bg-wine-700' : ''}
            >
              <Building2 className="w-4 h-4 mr-2" />
              Provider
            </Button>
          </div>
        </div>
      </Card>
    </>
  )
}
