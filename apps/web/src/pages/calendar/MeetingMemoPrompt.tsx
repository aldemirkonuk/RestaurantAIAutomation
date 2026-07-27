import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  FileText,
  Phone,
  Wine,
  MessageSquare,
  Tag,
  ChevronDown,
} from 'lucide-react'
import type { EventLabel } from './EventModal'

// ─────────────────────────────── Types ───────────────────────────────────────

export type DocType = 'meeting_memo' | 'call_log' | 'tasting_notes' | 'general'

interface DocTypeOption {
  id: DocType
  label: string
  icon: React.ReactNode
  description: string
}

interface MeetingMemoPromptProps {
  isOpen: boolean
  onClose: () => void
  onSave: (memo: MeetingMemo) => void
  eventTitle: string
  eventDate: string
  labels?: EventLabel[]
}

export interface MeetingMemo {
  eventTitle: string
  eventDate: string
  docType: DocType
  notes: string
  labels?: EventLabel[]
}

// ─────────────────────────────── Constants ────────────────────────────────────

const DOC_TYPES: DocTypeOption[] = [
  {
    id: 'meeting_memo',
    label: 'Meeting Memo',
    icon: <FileText className="w-4 h-4" />,
    description: 'Key takeaways & decisions',
  },
  {
    id: 'call_log',
    label: 'Call Log',
    icon: <Phone className="w-4 h-4" />,
    description: 'Phone / video call summary',
  },
  {
    id: 'tasting_notes',
    label: 'Tasting Notes',
    icon: <Wine className="w-4 h-4" />,
    description: 'Wine & product evaluations',
  },
  {
    id: 'general',
    label: 'General Note',
    icon: <MessageSquare className="w-4 h-4" />,
    description: 'Freeform notes',
  },
]

const LABEL_COLORS: Record<EventLabel['type'], { strip: string; bg: string }> = {
  provider_meeting: { strip: '#722F37', bg: '#fdf4f5' },
  call:             { strip: '#10B981', bg: '#f0fdf4' },
  tasting:          { strip: '#8B5CF6', bg: '#f5f3ff' },
  delivery:         { strip: '#F59E0B', bg: '#fefce8' },
  email_thread:     { strip: '#3B82F6', bg: '#eff6ff' },
  custom:           { strip: '#6B7280', bg: '#f3f4f6' },
}

// ─────────────────────────────── Component ───────────────────────────────────

export function MeetingMemoPrompt({
  isOpen,
  onClose,
  onSave,
  eventTitle,
  eventDate,
  labels = [],
}: MeetingMemoPromptProps) {
  const [docType, setDocType] = useState<DocType>('meeting_memo')
  const [notes, setNotes] = useState('')

  function handleSave() {
    onSave({ eventTitle, eventDate, docType, notes, labels })
    onClose()
  }

  const primaryLabel = labels[0]
  const primaryLabelColors = primaryLabel ? LABEL_COLORS[primaryLabel.type] : null

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 16 }}
          transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
          onClick={e => e.stopPropagation()}
          className="bg-white rounded-2xl w-full max-w-[520px] overflow-hidden flex flex-col"
          style={{ boxShadow: '0 0 0 1px rgba(0,0,0,.06), 0 24px 64px rgba(0,0,0,.22)' }}
        >
          {/* Banner */}
          <div className="px-5 py-4 border-b border-gray-100 flex items-start gap-3 bg-wine-50">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: '#722F37' }}>
              <FileText className="w-4.5 h-4.5 text-white" style={{ width: '18px', height: '18px' }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold text-gray-900 leading-snug">
                Write a meeting note for <span className="text-wine-800">"{eventTitle}"</span>?
              </p>
              <p className="text-[12px] text-gray-500 mt-1">
                Capture key points while they're fresh — saved under Documents → Meetings.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 rounded-full bg-white/70 flex items-center justify-center text-gray-400 hover:bg-white hover:text-gray-600 transition-colors shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Label identity card */}
          {primaryLabel && primaryLabelColors && (
            <div className="px-5 py-3 border-b border-gray-100">
              <p className="text-[10px] font-bold text-gray-300 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <Tag className="w-3 h-3" /> Filed under
              </p>
              <div className="flex items-stretch rounded-lg border border-gray-200 overflow-hidden bg-white">
                <div className="w-1 shrink-0" style={{ backgroundColor: primaryLabelColors.strip }} />
                <div className="flex items-center gap-2 px-3 py-2">
                  <div
                    className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0"
                    style={{ backgroundColor: primaryLabelColors.bg, color: primaryLabelColors.strip }}
                  >
                    {primaryLabel.displayName.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-[12px] font-bold text-gray-800">{primaryLabel.displayName}</p>
                    {primaryLabel.entityName && (
                      <p className="text-[11px] text-gray-500">{primaryLabel.entityName}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="px-5 py-4 space-y-4">
            {/* Doc type selector */}
            <div>
              <p className="text-[10px] font-bold text-gray-300 uppercase tracking-widest mb-2">Document type</p>
              <div className="grid grid-cols-2 gap-1.5">
                {DOC_TYPES.map(dt => (
                  <button
                    key={dt.id}
                    type="button"
                    onClick={() => setDocType(dt.id)}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border text-left transition-all ${
                      docType === dt.id
                        ? 'border-wine-200 bg-wine-50 text-wine-800'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    <span className={`shrink-0 ${docType === dt.id ? 'text-wine-700' : 'text-gray-400'}`}>
                      {dt.icon}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold leading-tight">{dt.label}</p>
                      <p className="text-[10px] text-gray-400 leading-tight mt-0.5">{dt.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div>
              <p className="text-[10px] font-bold text-gray-300 uppercase tracking-widest mb-2">Notes</p>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={5}
                placeholder={
                  docType === 'tasting_notes'
                    ? 'Wine name, vintage, color, aroma, palate, finish, rating…'
                    : docType === 'call_log'
                    ? 'Caller, purpose, outcomes, follow-ups…'
                    : 'Topics discussed, decisions made, next steps…'
                }
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-700 leading-relaxed focus:outline-none focus:border-wine-600 focus:ring-1 focus:ring-wine-600/20 resize-none"
                autoFocus
              />
            </div>

            {/* Obsidian teaser */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-purple-50 border border-purple-100 text-[11px] text-purple-700">
              <ChevronDown className="w-3.5 h-3.5 rotate-0 shrink-0" />
              <span>
                <span className="font-bold">Obsidian sync</span> — connect your vault to auto-export meeting notes.{' '}
                <span className="font-semibold underline cursor-pointer">Coming soon</span>
              </span>
            </div>
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/50 flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              className="text-[13px] font-medium text-gray-400 hover:text-gray-600 transition-colors"
            >
              Later
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-[13px] font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!notes.trim()}
                className="px-4 py-2 text-[13px] font-semibold text-white rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: '#722F37' }}
                onMouseEnter={e => !e.currentTarget.disabled && (e.currentTarget.style.backgroundColor = '#7c1d3c')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#722F37')}
              >
                Save note
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
