/**
 * CollapsibleSection - Atomic Component
 * Generic collapsible container with header
 */

import { ChevronDown, ChevronUp, LucideIcon } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface CollapsibleSectionProps {
  title: string
  subtitle?: string
  icon?: LucideIcon
  badge?: React.ReactNode
  isOpen: boolean
  onToggle: () => void
  children: React.ReactNode
  className?: string
  headerClassName?: string
}

export function CollapsibleSection({
  title,
  subtitle,
  icon: Icon,
  badge,
  isOpen,
  onToggle,
  children,
  className = '',
  headerClassName = '',
}: CollapsibleSectionProps) {
  return (
    <div className={`bg-white rounded-xl border border-gray-200 overflow-hidden ${className}`}>
      <button
        onClick={onToggle}
        className={`w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors ${headerClassName}`}
      >
        <div className="flex items-center gap-3">
          {Icon && <Icon className="w-5 h-5 text-gray-600" />}
          <div className="text-left">
            <h3 className="font-semibold text-gray-900">{title}</h3>
            {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {badge}
          {isOpen ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-gray-200 overflow-hidden"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
