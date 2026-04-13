import React, { useState, useEffect } from 'react'
import { Plus, Trash2, Clock, Bell, AlertCircle } from 'lucide-react'
import axios from 'axios'

const API_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'

interface VendorDeadline {
  id: string
  provider_id: string
  provider_name: string
  deadline_day: number // 0-6 (Mon-Sun)
  deadline_time: string // HH:MM:SS format
  notification_hours_before: number
  active: boolean
  created_at: string
}

export function VendorDeadlineSettings() {
  const [deadlines, setDeadlines] = useState<VendorDeadline[]>([])
  const [showAddModal, setShowAddModal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchDeadlines()
  }, [])

  const fetchDeadlines = async () => {
    try {
      setLoading(true)
      const response = await axios.get(`${API_URL}/vendor-deadlines`)
      if (response.data.success) {
        setDeadlines(response.data.data)
      }
    } catch (err: any) {
      setError('Failed to load vendor deadlines')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this deadline?')) return

    try {
      await axios.delete(`${API_URL}/vendor-deadlines/${id}`)
      setDeadlines(deadlines.filter(d => d.id !== id))
    } catch (err: any) {
      alert('Failed to delete deadline')
    }
  }

  const getDayName = (day: number) => {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    return days[day]
  }

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(':')
    const hour = parseInt(hours)
    const ampm = hour >= 12 ? 'PM' : 'AM'
    const displayHour = hour % 12 || 12
    return `${displayHour}:${minutes} ${ampm}`
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Vendor Order Deadlines</h3>
          <p className="text-sm text-gray-500 mt-1">
            Get notified before provider order cutoff times
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-wine-600 text-white font-medium rounded-lg hover:bg-wine-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Deadline
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-wine-600" />
        </div>
      ) : error ? (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-600" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      ) : deadlines.length === 0 ? (
        <div className="text-center py-8 bg-gray-50 rounded-lg">
          <Clock className="w-10 h-10 text-gray-400 mx-auto mb-3" />
          <p className="text-gray-600 font-medium">No deadlines set</p>
          <p className="text-sm text-gray-500 mt-1">Add your first vendor deadline</p>
        </div>
      ) : (
        <div className="space-y-3">
          {deadlines.map(deadline => (
            <div
              key={deadline.id}
              className="flex items-center justify-between p-4 bg-white rounded-lg border border-gray-200 hover:border-gray-300 transition-colors"
            >
              <div className="flex items-start gap-4">
                <div className="p-2 bg-amber-50 rounded-lg">
                  <Bell className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900">{deadline.provider_name}</h4>
                  <div className="flex items-center gap-4 mt-1">
                    <span className="text-sm text-gray-600">
                      Every <span className="font-medium">{getDayName(deadline.deadline_day)}</span>
                    </span>
                    <span className="text-sm text-gray-600">
                      at <span className="font-medium">{formatTime(deadline.deadline_time)}</span>
                    </span>
                    <span className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded">
                      {deadline.notification_hours_before}h notice
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => handleDelete(deadline.id)}
                className="p-2 hover:bg-red-50 rounded-lg transition-colors"
                title="Delete deadline"
              >
                <Trash2 className="w-5 h-5 text-red-600" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add Deadline Modal */}
      {showAddModal && (
        <AddDeadlineModal
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            fetchDeadlines()
            setShowAddModal(false)
          }}
        />
      )}
    </div>
  )
}

interface AddDeadlineModalProps {
  onClose: () => void
  onSuccess: () => void
}

function AddDeadlineModal({ onClose, onSuccess }: AddDeadlineModalProps) {
  const [providerName, setProviderName] = useState('')
  const [deadlineDay, setDeadlineDay] = useState(1) // Monday
  const [deadlineTime, setDeadlineTime] = useState('17:00')
  const [notificationHours, setNotificationHours] = useState(48)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)

    try {
      await axios.post(`${API_URL}/vendor-deadlines`, {
        provider_id: `PROV_${Date.now()}`, // Mock ID
        provider_name: providerName,
        deadline_day: deadlineDay,
        deadline_time: `${deadlineTime}:00`,
        notification_hours_before: notificationHours
      })
      onSuccess()
    } catch (err: any) {
      alert('Failed to create deadline')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-amber-50 to-orange-50">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Add Vendor Deadline</h3>
            <p className="text-sm text-gray-500">Set order cutoff notification</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/50 rounded-lg transition-colors">
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Provider Name</label>
            <input
              type="text"
              value={providerName}
              onChange={(e) => setProviderName(e.target.value)}
              placeholder="e.g., Southern Glazer's"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Deadline Day</label>
            <select
              value={deadlineDay}
              onChange={(e) => setDeadlineDay(parseInt(e.target.value))}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg"
            >
              <option value={0}>Monday</option>
              <option value={1}>Tuesday</option>
              <option value={2}>Wednesday</option>
              <option value={3}>Thursday</option>
              <option value={4}>Friday</option>
              <option value={5}>Saturday</option>
              <option value={6}>Sunday</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Deadline Time</label>
            <input
              type="time"
              value={deadlineTime}
              onChange={(e) => setDeadlineTime(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Notification Hours Before
            </label>
            <select
              value={notificationHours}
              onChange={(e) => setNotificationHours(parseInt(e.target.value))}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg"
            >
              <option value={24}>24 hours</option>
              <option value={48}>48 hours</option>
              <option value={72}>72 hours</option>
            </select>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-6 py-3 bg-wine-600 text-white font-medium rounded-xl hover:bg-wine-700 transition-colors disabled:opacity-50"
            >
              {submitting ? 'Creating...' : 'Create Deadline'}
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
      </div>
    </div>
  )
}

