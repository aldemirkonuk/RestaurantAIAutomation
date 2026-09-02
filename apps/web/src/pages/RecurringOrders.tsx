import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Edit2, Trash2, Calendar, RefreshCw, Check, X, AlertCircle, DollarSign, Mail, Clock, TrendingUp, Shield } from 'lucide-react'
import { Header } from '../components/layout/Header'
import { useAuth } from '../contexts/AuthContext'
import axios from 'axios'

const API_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'

interface PriceEntry {
  price: number
  date: string
  source: 'provider_confirmed' | 'manager_override' | 'initial'
  notes?: string
}

interface RecurringOrder {
  id: string
  wine_id: string
  wine_name: string
  quantity: number
  unit_type: 'case' | 'bottle'
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly'
  frequency_day?: number
  preferred_providers: string[]
  auto_approve: boolean
  next_order_date: string
  last_order_date?: string
  active: boolean
  created_at: string
  // Price management (Stream 5B)
  negotiated_price?: number
  price_valid_until?: string
  price_history?: PriceEntry[]
  manager_override_price?: number
  deal_duration_months?: number
  last_confirmed_price?: number
  price_confirmation_required?: boolean
  // Provider communication (Stream 5A)
  last_price_inquiry_date?: string
  price_inquiry_status?: 'none' | 'sent' | 'confirmed' | 'expired'
}

interface CreateRecurringOrderData {
  wine_id: string
  quantity: number
  unit_type: 'case' | 'bottle'
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly'
  frequency_day?: number
  preferred_providers: string[]
  auto_approve: boolean
  next_order_date: string
  negotiated_price?: number
  price_valid_until?: string
  deal_duration_months?: number
  price_confirmation_required?: boolean
  manager_override_price?: number
}

export function RecurringOrders() {
  const { user } = useAuth()
  const restaurantId = user?.restaurantId || ''
  const [recurringOrders, setRecurringOrders] = useState<RecurringOrder[]>([])
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingOrder, setEditingOrder] = useState<RecurringOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchRecurringOrders = useCallback(async () => {
    try {
      setLoading(true)
      const response = await axios.get(`${API_URL}/recurring-orders/${restaurantId}`)
      const orders = Array.isArray(response.data) ? response.data : response.data?.data || []
      setRecurringOrders(orders)
    } catch (err: any) {
      setError('Failed to load recurring orders')
    } finally {
      setLoading(false)
    }
  }, [restaurantId])

  useEffect(() => {
    if (restaurantId) fetchRecurringOrders()
  }, [restaurantId, fetchRecurringOrders])

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this recurring order?')) return

    try {
      await axios.delete(`${API_URL}/recurring-orders/${restaurantId}/${id}`)
      setRecurringOrders(orders => orders.filter(o => o.id !== id))
    } catch (err: any) {
      alert('Failed to delete recurring order')
    }
  }

  const handleToggleActive = async (order: RecurringOrder) => {
    try {
      await axios.put(`${API_URL}/recurring-orders/${restaurantId}/${order.id}`, {
        active: !order.active
      })
      setRecurringOrders(orders =>
        orders.map(o => o.id === order.id ? { ...o, active: !o.active } : o)
      )
    } catch (err: any) {
      alert('Failed to update order status')
    }
  }

  const getFrequencyLabel = (frequency: string, frequency_day?: number) => {
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    
    if (frequency === 'daily') return 'Daily'
    if (frequency === 'weekly' && frequency_day !== undefined) {
      return `Weekly (${dayNames[frequency_day]})`
    }
    if (frequency === 'biweekly') return 'Bi-weekly'
    if (frequency === 'monthly' && frequency_day !== undefined) {
      return `Monthly (Day ${frequency_day})`
    }
    return frequency
  }

  const getDaysUntilNext = (nextDate: string) => {
    const days = Math.ceil((new Date(nextDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    if (days < 0) return 'Overdue'
    if (days === 0) return 'Today'
    if (days === 1) return 'Tomorrow'
    return `in ${days} days`
  }

  const handleSendPriceInquiry = async (order: RecurringOrder) => {
    const providerNames = order.preferred_providers.join(', ') || 'your provider'
    const emailBody = `Hi ${providerNames},\n\nI wanted to confirm our upcoming recurring order for ${order.wine_name} (${order.quantity} ${order.unit_type}s).\n\nCould you please confirm the current pricing for this order?\n\nThank you,\nMudavym`
    
    try {
      await axios.post(`${API_URL}/api/v1/notifications/send-email`, {
        to: [], // Provider emails would be resolved by backend
        subject: `Price Confirmation - ${order.wine_name} Recurring Order`,
        body_text: emailBody,
        body_html: `<p>${emailBody.replace(/\n/g, '<br/>')}</p>`,
        metadata: {
          type: 'price_inquiry',
          recurring_order_id: order.id,
          wine_name: order.wine_name,
        }
      })
      
      // Update order status
      setRecurringOrders(orders => orders.map(o =>
        o.id === order.id ? {
          ...o,
          last_price_inquiry_date: new Date().toISOString(),
          price_inquiry_status: 'sent' as const,
        } : o
      ))
      
      alert(`Price inquiry sent for ${order.wine_name}`)
    } catch {
      alert('Failed to send price inquiry. Check your email configuration.')
    }
  }

  const handleOverridePrice = (orderId: string) => {
    const priceStr = prompt('Enter override price per unit:')
    if (!priceStr) return
    const price = parseFloat(priceStr)
    if (isNaN(price) || price <= 0) return

    setRecurringOrders(orders => orders.map(o =>
      o.id === orderId ? {
        ...o,
        manager_override_price: price,
        price_history: [
          ...(o.price_history || []),
          { price, date: new Date().toISOString(), source: 'manager_override' as const, notes: 'Manual price override' }
        ]
      } : o
    ))
    
    // Persist to server
    axios.put(`${API_URL}/recurring-orders/${restaurantId}/${orderId}`, { manager_override_price: price }).catch(() => {})
  }

  const isPriceDealExpiring = (order: RecurringOrder) => {
    if (!order.price_valid_until) return false
    const daysUntil = Math.ceil((new Date(order.price_valid_until).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    return daysUntil <= 7 && daysUntil >= 0
  }

  const isPriceDealExpired = (order: RecurringOrder) => {
    if (!order.price_valid_until) return false
    return new Date(order.price_valid_until) < new Date()
  }

  return (
    <div className="min-h-screen">
      <Header title="Recurring Orders" subtitle="Manage automated wine reordering schedules" />

      <div className="p-6">
        {/* Header Actions */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Scheduled Orders</h2>
            <p className="text-sm text-gray-500 mt-1">
              {recurringOrders.filter(o => o.active).length} active, {recurringOrders.filter(o => !o.active).length} paused
            </p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-wine-600 text-white font-medium rounded-xl hover:bg-wine-700 transition-colors"
          >
            <Plus className="w-5 h-5" />
            Create Recurring Order
          </button>
        </div>

        {/* Orders List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-wine-600" />
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-600" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        ) : recurringOrders.length === 0 ? (
          <div className="text-center py-12">
            <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 font-medium">No recurring orders yet</p>
            <p className="text-sm text-gray-500 mt-1">Create your first automated reorder</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {recurringOrders.map(order => (
              <motion.div
                key={order.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className={`bg-white rounded-xl border-2 p-5 transition-all ${
                  order.active ? 'border-gray-200 hover:border-gray-300' : 'border-gray-100 opacity-60'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-bold text-gray-900">{order.wine_name}</h3>
                      {!order.active && (
                        <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs font-medium rounded">
                          Paused
                        </span>
                      )}
                      {order.auto_approve && (
                        <span className="px-2 py-1 bg-emerald-100 text-emerald-700 text-xs font-medium rounded">
                          Auto-approve
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3">
                      <div>
                        <p className="text-xs text-gray-500 font-medium">Quantity</p>
                        <p className="text-sm font-semibold text-gray-900">
                          {order.quantity} {order.unit_type}(s)
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 font-medium">Frequency</p>
                        <p className="text-sm font-semibold text-gray-900">
                          {getFrequencyLabel(order.frequency, order.frequency_day)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 font-medium">Next Order</p>
                        <p className="text-sm font-semibold text-gray-900">
                          {new Date(order.next_order_date).toLocaleDateString()}
                        </p>
                        <p className="text-xs text-gray-500">{getDaysUntilNext(order.next_order_date)}</p>
                      </div>
                      {order.last_order_date && (
                        <div>
                          <p className="text-xs text-gray-500 font-medium">Last Ordered</p>
                          <p className="text-sm font-semibold text-gray-900">
                            {new Date(order.last_order_date).toLocaleDateString()}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Price Information */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3 pt-3 border-t border-gray-100">
                      <div>
                        <p className="text-xs text-gray-500 font-medium flex items-center gap-1">
                          <DollarSign className="w-3 h-3" /> Current Price
                        </p>
                        <p className="text-sm font-semibold text-gray-900">
                          {order.manager_override_price 
                            ? `$${order.manager_override_price.toFixed(2)} (override)`
                            : order.negotiated_price 
                              ? `$${order.negotiated_price.toFixed(2)}`
                              : 'Not set'
                          }
                        </p>
                      </div>
                      {order.price_valid_until && (
                        <div>
                          <p className="text-xs text-gray-500 font-medium flex items-center gap-1">
                            <Clock className="w-3 h-3" /> Deal Expires
                          </p>
                          <p className={`text-sm font-semibold ${
                            isPriceDealExpired(order) ? 'text-red-600' 
                            : isPriceDealExpiring(order) ? 'text-amber-600' 
                            : 'text-gray-900'
                          }`}>
                            {new Date(order.price_valid_until).toLocaleDateString()}
                            {isPriceDealExpired(order) && ' (Expired)'}
                            {isPriceDealExpiring(order) && ' (Expiring soon!)'}
                          </p>
                        </div>
                      )}
                      {order.deal_duration_months && (
                        <div>
                          <p className="text-xs text-gray-500 font-medium flex items-center gap-1">
                            <Shield className="w-3 h-3" /> Deal Duration
                          </p>
                          <p className="text-sm font-semibold text-gray-900">
                            {order.deal_duration_months} month{order.deal_duration_months !== 1 ? 's' : ''}
                          </p>
                        </div>
                      )}
                      <div>
                        <p className="text-xs text-gray-500 font-medium flex items-center gap-1">
                          <TrendingUp className="w-3 h-3" /> Price Inquiry
                        </p>
                        <p className={`text-sm font-semibold ${
                          order.price_inquiry_status === 'confirmed' ? 'text-emerald-600'
                          : order.price_inquiry_status === 'sent' ? 'text-blue-600'
                          : 'text-gray-400'
                        }`}>
                          {order.price_inquiry_status === 'confirmed' ? 'Confirmed'
                           : order.price_inquiry_status === 'sent' ? 'Awaiting response'
                           : 'Not sent'}
                        </p>
                      </div>
                    </div>

                    {order.preferred_providers.length > 0 && (
                      <div className="mt-3">
                        <p className="text-xs text-gray-500 font-medium mb-1">Providers</p>
                        <div className="flex gap-2">
                          {order.preferred_providers.map(provider => (
                            <span
                              key={provider}
                              className="px-2 py-1 bg-blue-50 text-blue-700 text-xs font-medium rounded"
                            >
                              {provider}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
                      {order.price_confirmation_required && (
                        <button
                          onClick={() => handleSendPriceInquiry(order)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors text-xs font-medium"
                        >
                          <Mail className="w-3.5 h-3.5" />
                          Send Price Inquiry
                        </button>
                      )}
                      <button
                        onClick={() => handleOverridePrice(order.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 transition-colors text-xs font-medium"
                      >
                        <DollarSign className="w-3.5 h-3.5" />
                        Override Price
                      </button>
                    </div>
                  </div>

                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleToggleActive(order)}
                      className={`p-2 rounded-lg transition-colors ${
                        order.active
                          ? 'hover:bg-gray-100'
                          : 'hover:bg-emerald-50'
                      }`}
                      title={order.active ? 'Pause' : 'Activate'}
                    >
                      {order.active ? (
                        <X className="w-5 h-5 text-gray-600" />
                      ) : (
                        <Check className="w-5 h-5 text-emerald-600" />
                      )}
                    </button>
                    <button
                      onClick={() => setEditingOrder(order)}
                      className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                      title="Edit"
                    >
                      <Edit2 className="w-5 h-5 text-gray-600" />
                    </button>
                    <button
                      onClick={() => handleDelete(order.id)}
                      className="p-2 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-5 h-5 text-red-600" />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      <RecurringOrderModal
        isOpen={showCreateModal || !!editingOrder}
        onClose={() => {
          setShowCreateModal(false)
          setEditingOrder(null)
        }}
        editingOrder={editingOrder}
        restaurantId={restaurantId}
        onSuccess={() => {
          fetchRecurringOrders()
          setShowCreateModal(false)
          setEditingOrder(null)
        }}
      />
    </div>
  )
}

interface RecurringOrderModalProps {
  isOpen: boolean
  onClose: () => void
  editingOrder: RecurringOrder | null
  restaurantId: string
  onSuccess: () => void
}

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function RecurringOrderModal({ isOpen, onClose, editingOrder, restaurantId, onSuccess }: RecurringOrderModalProps) {
  const [formData, setFormData] = useState<CreateRecurringOrderData>({
    wine_id: '',
    quantity: 12,
    unit_type: 'bottle',
    frequency: 'monthly',
    frequency_day: undefined,
    preferred_providers: [],
    auto_approve: false,
    next_order_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (editingOrder) {
      setFormData({
        wine_id: editingOrder.wine_id,
        quantity: editingOrder.quantity,
        unit_type: editingOrder.unit_type,
        frequency: editingOrder.frequency,
        frequency_day: editingOrder.frequency_day,
        preferred_providers: editingOrder.preferred_providers,
        auto_approve: editingOrder.auto_approve,
        next_order_date: editingOrder.next_order_date.split('T')[0]
      })
    }
  }, [editingOrder])

  // Auto-set frequency_day from start date when frequency changes
  useEffect(() => {
    if (formData.frequency === 'weekly' || formData.frequency === 'biweekly') {
      if (formData.frequency_day === undefined && formData.next_order_date) {
        const date = new Date(formData.next_order_date)
        const jsDay = date.getDay()
        const freqDay = jsDay === 0 ? 6 : jsDay - 1 // Convert Sun=0..Sat=6 to Mon=0..Sun=6
        setFormData(prev => ({ ...prev, frequency_day: freqDay }))
      }
    } else if (formData.frequency === 'monthly') {
      if (formData.frequency_day === undefined && formData.next_order_date) {
        const day = new Date(formData.next_order_date).getDate()
        setFormData(prev => ({ ...prev, frequency_day: Math.min(day, 28) }))
      }
    } else {
      setFormData(prev => ({ ...prev, frequency_day: undefined }))
    }
    // Intentional single trigger: derive the default frequency_day only when the
    // frequency itself changes, reading whatever next_order_date/frequency_day are
    // at that moment. Adding those as deps would recompute on every date edit,
    // which is a behavior change we do not want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.frequency])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)

    try {
      if (editingOrder) {
        await axios.put(`${API_URL}/recurring-orders/${restaurantId}/${editingOrder.id}`, formData)
      } else {
        await axios.post(`${API_URL}/recurring-orders/${restaurantId}`, formData)
      }
      onSuccess()
    } catch (err: any) {
      alert('Failed to save recurring order')
    } finally {
      setSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden"
        >
          <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-wine-50 to-purple-50">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-wine-600 rounded-xl">
                <RefreshCw className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  {editingOrder ? 'Edit Recurring Order' : 'Create Recurring Order'}
                </h2>
                <p className="text-sm text-gray-500">Set up automated wine reordering</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/50 rounded-lg transition-colors">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Wine Name</label>
                <input
                  type="text"
                  placeholder="Wine name"
                  value={formData.wine_id}
                  onChange={(e) => setFormData({ ...formData, wine_id: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Quantity</label>
                {/*
                  Two independent reasons this field could not accept 4.5 kg of
                  flour, and both had to go (ADR 0071):

                    1. No `step`. HTML defaults `step=1`, so the browser reports
                       a stepMismatch on 2.5 and the value never reaches the
                       server at all — below any DTO, below any validator.
                    2. `parseInt`, which truncates "4.5" to 4 SILENTLY. That is
                       worse than the block: a refusal is answerable, a quietly
                       different number is not.

                  `step="0.001"` is the column's real precision — numeric(12,3) —
                  so the browser refuses a fourth decimal place with its own
                  message rather than letting Postgres round it. Whether a
                  fraction is legal at all depends on the unit, which the server
                  decides in resolveOrderUnits; the input does not guess.
                */}
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={formData.quantity}
                  onChange={(e) => setFormData({ ...formData, quantity: e.target.value === '' ? NaN : Number(e.target.value) })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Unit Type</label>
                <select
                  value={formData.unit_type}
                  onChange={(e) => setFormData({ ...formData, unit_type: e.target.value as 'case' | 'bottle' })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg"
                >
                  <option value="bottle">Bottles</option>
                  <option value="case">Cases</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Frequency</label>
                <select
                  value={formData.frequency}
                  onChange={(e) => setFormData({ ...formData, frequency: e.target.value as any })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Bi-weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
                <input
                  type="date"
                  value={formData.next_order_date}
                  onChange={(e) => setFormData({ ...formData, next_order_date: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg"
                  required
                />
              </div>
            </div>

            {/* Day-of-week selector for weekly/biweekly */}
            {(formData.frequency === 'weekly' || formData.frequency === 'biweekly') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Order Day ({formData.frequency === 'biweekly' ? 'every other' : 'every'} week)
                </label>
                <div className="flex gap-1.5">
                  {DAY_SHORT.map((name, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setFormData({ ...formData, frequency_day: idx })}
                      className={`flex-1 py-2 px-1 text-xs font-medium rounded-lg border-2 transition-all ${
                        formData.frequency_day === idx
                          ? 'border-wine-600 bg-wine-50 text-wine-700'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Day-of-month selector for monthly */}
            {formData.frequency === 'monthly' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Day of Month
                </label>
                <select
                  value={formData.frequency_day || 1}
                  onChange={(e) => setFormData({ ...formData, frequency_day: parseInt(e.target.value) })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg"
                >
                  {Array.from({ length: 28 }, (_, i) => i + 1).map(day => (
                    <option key={day} value={day}>
                      {day}{day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th'} of each month
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Price Management */}
            <div className="pt-4 border-t border-gray-200">
              <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-wine-600" />
                Price Management
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Negotiated Price (per unit)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="$0.00"
                    value={formData.negotiated_price || ''}
                    onChange={(e) => setFormData({ ...formData, negotiated_price: e.target.value ? parseFloat(e.target.value) : undefined })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Deal Duration (months)</label>
                  <input
                    type="number"
                    min="1"
                    placeholder="e.g., 6"
                    value={formData.deal_duration_months || ''}
                    onChange={(e) => setFormData({ ...formData, deal_duration_months: e.target.value ? parseInt(e.target.value) : undefined })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Price Valid Until</label>
                  <input
                    type="date"
                    value={formData.price_valid_until || ''}
                    onChange={(e) => setFormData({ ...formData, price_valid_until: e.target.value || undefined })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Manager Override Price</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="$0.00"
                    value={formData.manager_override_price || ''}
                    onChange={(e) => setFormData({ ...formData, manager_override_price: e.target.value ? parseFloat(e.target.value) : undefined })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="auto-approve"
                  checked={formData.auto_approve}
                  onChange={(e) => setFormData({ ...formData, auto_approve: e.target.checked })}
                  className="rounded border-gray-300 text-wine-600"
                />
                <label htmlFor="auto-approve" className="text-sm text-gray-700">
                  Auto-approve orders (no manual confirmation needed)
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="price-confirm"
                  checked={formData.price_confirmation_required || false}
                  onChange={(e) => setFormData({ ...formData, price_confirmation_required: e.target.checked })}
                  className="rounded border-gray-300 text-wine-600"
                />
                <label htmlFor="price-confirm" className="text-sm text-gray-700">
                  Ask provider to confirm price before each order
                </label>
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 px-6 py-3 bg-wine-600 text-white font-medium rounded-xl hover:bg-wine-700 transition-colors disabled:opacity-50"
              >
                {submitting ? 'Saving...' : editingOrder ? 'Update Order' : 'Create Order'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

