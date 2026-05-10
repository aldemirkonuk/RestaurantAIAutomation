import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Calendar,
  PartyPopper,
  Truck,
  Cake,
  Package,
  Users,
  CalendarDays,
  Bell,
  Wine,
  Check,
} from 'lucide-react'

export interface ImportantDate {
  id: number
  date: string
  title: string
  type: 'event' | 'delivery' | 'birthday' | 'inventory' | 'reservation' | 'meeting' | 'tasting' | 'reminder'
  icon: React.ElementType
  color: string
  time?: string
  notes?: string
}

interface AddImportantDateModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (date: Omit<ImportantDate, 'id'>) => void
  editingDate?: ImportantDate | null
}

const DATE_TYPES = [
  { type: 'event', label: 'Event', icon: PartyPopper, color: 'purple' },
  { type: 'delivery', label: 'Delivery', icon: Truck, color: 'blue' },
  { type: 'birthday', label: 'Birthday', icon: Cake, color: 'pink' },
  { type: 'inventory', label: 'Inventory', icon: Package, color: 'emerald' },
  { type: 'reservation', label: 'Reservation', icon: Users, color: 'amber' },
  { type: 'meeting', label: 'Meeting', icon: CalendarDays, color: 'indigo' },
  { type: 'tasting', label: 'Wine Tasting', icon: Wine, color: 'rose' },
  { type: 'reminder', label: 'Reminder', icon: Bell, color: 'gray' },
] as const

const COLOR_OPTIONS = [
  { value: 'purple', bg: 'bg-purple-100', text: 'text-purple-700', ring: 'ring-purple-500' },
  { value: 'blue', bg: 'bg-blue-100', text: 'text-blue-700', ring: 'ring-blue-500' },
  { value: 'pink', bg: 'bg-pink-100', text: 'text-pink-700', ring: 'ring-pink-500' },
  { value: 'emerald', bg: 'bg-emerald-100', text: 'text-emerald-700', ring: 'ring-emerald-500' },
  { value: 'amber', bg: 'bg-amber-100', text: 'text-amber-700', ring: 'ring-amber-500' },
  { value: 'indigo', bg: 'bg-indigo-100', text: 'text-indigo-700', ring: 'ring-indigo-500' },
  { value: 'rose', bg: 'bg-rose-100', text: 'text-rose-700', ring: 'ring-rose-500' },
  { value: 'gray', bg: 'bg-gray-100', text: 'text-gray-700', ring: 'ring-gray-500' },
]

export function AddImportantDateModal({
  isOpen,
  onClose,
  onSave,
  editingDate,
}: AddImportantDateModalProps) {
  const [title, setTitle] = useState(editingDate?.title || '')
  const [date, setDate] = useState(editingDate?.date || new Date().toISOString().split('T')[0])
  const [time, setTime] = useState(editingDate?.time || '')
  const [selectedType, setSelectedType] = useState<ImportantDate['type']>(editingDate?.type || 'event')
  const [selectedColor, setSelectedColor] = useState(editingDate?.color || 'purple')
  const [notes, setNotes] = useState(editingDate?.notes || '')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!title.trim() || !date) return

    const typeConfig = DATE_TYPES.find(t => t.type === selectedType)
    
    onSave({
      title: title.trim(),
      date,
      type: selectedType,
      icon: typeConfig?.icon || PartyPopper,
      color: selectedColor,
      time: time || undefined,
      notes: notes.trim() || undefined,
    })

    // Reset form
    setTitle('')
    setDate(new Date().toISOString().split('T')[0])
    setTime('')
    setSelectedType('event')
    setSelectedColor('purple')
    setNotes('')
    onClose()
  }

  const handleClose = () => {
    setTitle('')
    setDate(new Date().toISOString().split('T')[0])
    setTime('')
    setSelectedType('event')
    setSelectedColor('purple')
    setNotes('')
    onClose()
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={handleClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="px-6 py-4 border-b bg-gradient-to-r from-wine-50 to-rose-50 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-wine-100 rounded-xl">
                <Calendar className="w-5 h-5 text-wine-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">
                  {editingDate ? 'Edit Date' : 'Add Important Date'}
                </h3>
                <p className="text-sm text-gray-500">Add events, deadlines, and reminders</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="p-2 hover:bg-white/50 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* Title */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Title <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Wine Tasting Event, Maria's Birthday"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-wine-500 focus:border-transparent"
                required
              />
            </div>

            {/* Date & Time */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Date <span className="text-rose-500">*</span>
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-wine-500 focus:border-transparent"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Time (optional)
                </label>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-wine-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Type Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Type
              </label>
              <div className="grid grid-cols-4 gap-2">
                {DATE_TYPES.map((typeOption) => {
                  const Icon = typeOption.icon
                  const isSelected = selectedType === typeOption.type
                  const colorClass = COLOR_OPTIONS.find(c => c.value === typeOption.color)
                  
                  return (
                    <button
                      key={typeOption.type}
                      type="button"
                      onClick={() => {
                        setSelectedType(typeOption.type)
                        setSelectedColor(typeOption.color)
                      }}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all ${
                        isSelected
                          ? `border-${typeOption.color}-500 ${colorClass?.bg}`
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <Icon className={`w-5 h-5 ${isSelected ? colorClass?.text : 'text-gray-500'}`} />
                      <span className={`text-xs font-medium ${isSelected ? colorClass?.text : 'text-gray-600'}`}>
                        {typeOption.label}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Color Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Color
              </label>
              <div className="flex gap-2">
                {COLOR_OPTIONS.map((colorOption) => (
                  <button
                    key={colorOption.value}
                    type="button"
                    onClick={() => setSelectedColor(colorOption.value)}
                    className={`w-8 h-8 rounded-full ${colorOption.bg} transition-all ${
                      selectedColor === colorOption.value
                        ? `ring-2 ring-offset-2 ${colorOption.ring}`
                        : 'hover:scale-110'
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any additional details..."
                rows={3}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-wine-500 focus:border-transparent resize-none"
              />
            </div>
          </form>

          {/* Footer */}
          <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-end gap-3 shrink-0">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!title.trim() || !date}
              className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors ${
                title.trim() && date
                  ? 'bg-wine-600 text-white hover:bg-wine-700'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              <Check className="w-4 h-4" />
              {editingDate ? 'Update Date' : 'Add Date'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
