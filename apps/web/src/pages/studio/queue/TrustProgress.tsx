import { motion } from 'framer-motion'

interface TrustProgressProps {
  approved: number
  threshold?: number
}

export function TrustProgress({ approved, threshold = 5 }: TrustProgressProps) {
  const pct = Math.min((approved / threshold) * 100, 100)
  return (
    <div className="flex items-center gap-2 text-xs text-slate-400 mt-1.5">
      <span>{approved}/{threshold} approvals toward auto-promote</span>
      <div className="w-24 h-1.5 bg-slate-200 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-wine-500 rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        />
      </div>
    </div>
  )
}
