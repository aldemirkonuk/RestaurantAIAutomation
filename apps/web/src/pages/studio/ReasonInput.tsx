import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'

interface ReasonInputProps {
  show: boolean
  value: string
  onChange: (v: string) => void
  error?: string
}

export function ReasonInput({ show, value, onChange, error }: ReasonInputProps) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ height: 0, opacity: 0, marginTop: 0 }}
          animate={{ height: 'auto', opacity: 1, marginTop: 8 }}
          exit={{ height: 0, opacity: 0, marginTop: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="overflow-hidden"
        >
          <div>
            <p className="text-xs text-amber-700 font-medium mb-1 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 inline" />
              Reason required — this field has high confidence
            </p>
            <textarea
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="e.g. confirmed on producer website, verified from label photo"
              className="w-full text-sm border border-amber-300 rounded-lg px-2 py-1 resize-none focus:ring-2 focus:ring-amber-400 focus:outline-none focus-visible:outline-offset-0"
              rows={2}
            />
            {error && <p className="text-xs text-red-500 mt-0.5">{error}</p>}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
