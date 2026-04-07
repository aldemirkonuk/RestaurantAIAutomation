import { motion } from 'framer-motion'
import { QueueRow, QueueItem } from './QueueRow'

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
}

const THEAD_COLS = ['Wine', 'Field', 'Change', 'Actor', 'Reason', 'Citation', 'Submitted', 'Actions']

interface QueueTableProps {
  items: QueueItem[]
  onDecide: (id: string, decision: 'approved' | 'rejected', note?: string) => Promise<void>
}

export function QueueTable({ items, onDecide }: QueueTableProps) {
  return (
    <div className="rounded-xl border border-slate-200 shadow-xs bg-white overflow-hidden">
      <table className="w-full border-collapse">
        <thead className="bg-[#F1F3F5]">
          <tr>
            {THEAD_COLS.map((col) => (
              <th key={col} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 text-left">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <motion.tbody variants={containerVariants} initial="hidden" animate="visible">
          {items.map((item) => (
            <QueueRow key={item.id} item={item} onDecide={onDecide} />
          ))}
        </motion.tbody>
      </table>
    </div>
  )
}
