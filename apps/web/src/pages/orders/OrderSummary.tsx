import { motion } from 'framer-motion'
import { Card } from '../../components/ui'
import {
  Clock,
  CheckCircle,
  ShoppingCart,
  Truck,
  RefreshCw,
  DollarSign,
  TrendingUp,
  TrendingDown,
} from 'lucide-react'

interface OrderAnalytics {
  thisMonthValue: number
  valueChange: number
}

interface OrderSummaryProps {
  pendingCount: number
  approvedCount: number
  orderedCount: number
  deliveredCount: number
  recurringActiveCount: number
  orderAnalytics: OrderAnalytics
  filterStatus: string
  onToggleStatusFilter: (status: string) => void
}

export function OrderSummary({
  pendingCount,
  approvedCount,
  orderedCount,
  deliveredCount,
  recurringActiveCount,
  orderAnalytics,
  filterStatus,
  onToggleStatusFilter,
}: OrderSummaryProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6"
    >
      {/* Pending Approval */}
      <Card
        variant="glass"
        padding="md"
        onClick={() => onToggleStatusFilter('pending_approval')}
        title="Filter to pending approvals"
        className={`col-span-1 cursor-pointer ${filterStatus === 'pending_approval' ? 'ring-2 ring-wine-500' : pendingCount > 0 ? 'ring-2 ring-yellow-400' : ''}`}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Pending</p>
            <p className="text-3xl font-bold text-yellow-600 mt-1">{pendingCount}</p>
            <p className="text-xs text-gray-500 mt-1">awaiting approval</p>
          </div>
          <div className="p-2 bg-yellow-100 rounded-lg">
            <Clock className="w-5 h-5 text-yellow-600" />
          </div>
        </div>
      </Card>

      {/* Approved */}
      <Card
        variant="glass"
        padding="md"
        onClick={() => onToggleStatusFilter('approved')}
        title="Filter to approved orders"
        className={`col-span-1 cursor-pointer ${filterStatus === 'approved' ? 'ring-2 ring-wine-500' : ''}`}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Approved</p>
            <p className="text-3xl font-bold text-emerald-600 mt-1">{approvedCount}</p>
            <p className="text-xs text-gray-500 mt-1">ready to order</p>
          </div>
          <div className="p-2 bg-emerald-100 rounded-lg">
            <CheckCircle className="w-5 h-5 text-emerald-600" />
          </div>
        </div>
      </Card>

      {/* Ordered */}
      <Card
        variant="glass"
        padding="md"
        onClick={() => onToggleStatusFilter('ordered')}
        title="Filter to ordered shipments"
        className={`col-span-1 cursor-pointer ${filterStatus === 'ordered' ? 'ring-2 ring-wine-500' : ''}`}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Ordered</p>
            <p className="text-3xl font-bold text-blue-600 mt-1">{orderedCount}</p>
            <p className="text-xs text-gray-500 mt-1">in transit</p>
          </div>
          <div className="p-2 bg-blue-100 rounded-lg">
            <ShoppingCart className="w-5 h-5 text-blue-600" />
          </div>
        </div>
      </Card>

      {/* Delivered */}
      <Card
        variant="glass"
        padding="md"
        onClick={() => onToggleStatusFilter('delivered')}
        title="Filter to delivered orders"
        className={`col-span-1 cursor-pointer ${filterStatus === 'delivered' ? 'ring-2 ring-wine-500' : ''}`}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Delivered</p>
            <p className="text-3xl font-bold text-purple-600 mt-1">{deliveredCount}</p>
            <p className="text-xs text-gray-500 mt-1">completed</p>
          </div>
          <div className="p-2 bg-purple-100 rounded-lg">
            <Truck className="w-5 h-5 text-purple-600" />
          </div>
        </div>
      </Card>

      {/* Recurring Active */}
      <Card variant="glass" padding="md" className="col-span-1">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Recurring</p>
            <p className="text-3xl font-bold text-indigo-600 mt-1">{recurringActiveCount}</p>
            <p className="text-xs text-gray-500 mt-1">active schedules</p>
          </div>
          <div className="p-2 bg-indigo-100 rounded-lg">
            <RefreshCw className="w-5 h-5 text-indigo-600" />
          </div>
        </div>
      </Card>

      {/* This Month Value */}
      <Card variant="glass" padding="md" className="col-span-1">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">This Month</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">
              ${(orderAnalytics.thisMonthValue / 1000).toFixed(1)}k
            </p>
            <div className={`flex items-center gap-1 mt-1 text-xs font-medium ${
              orderAnalytics.valueChange >= 0 ? 'text-emerald-600' : 'text-red-600'
            }`}>
              {orderAnalytics.valueChange >= 0 ? (
                <TrendingUp className="w-3 h-3" />
              ) : (
                <TrendingDown className="w-3 h-3" />
              )}
              {Math.abs(orderAnalytics.valueChange).toFixed(1)}%
            </div>
          </div>
          <div className="p-2 bg-emerald-100 rounded-lg">
            <DollarSign className="w-5 h-5 text-emerald-600" />
          </div>
        </div>
      </Card>
    </motion.div>
  )
}
