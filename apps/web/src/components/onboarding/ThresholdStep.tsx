import { useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'
import { Button } from '../ui/button'
import { setDefaultThreshold } from '../../services/api/menus'

interface ThresholdStepProps {
  onDone: () => void
}

/**
 * Get-started step 3: one restaurant-wide low-stock threshold. Deliberately
 * a single number, not a per-wine form — per-wine tuning happens later from
 * Inventory. Soft-required: skippable, but shown by default so "activated"
 * (menu_uploaded + threshold_configured) is reachable in one sitting.
 */
export function ThresholdStep({ onDone }: ThresholdStepProps) {
  const [value, setValue] = useState(6)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await setDefaultThreshold(value)
      onDone()
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Failed to save threshold.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-4 py-16">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md text-center"
      >
        <div className="w-14 h-14 mx-auto mb-5 rounded-2xl bg-amber-50 flex items-center justify-center">
          <AlertTriangle className="w-6 h-6 text-amber-600" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Set your low-stock threshold</h1>
        <p className="text-gray-500 mb-8">
          One number to start — we&apos;ll flag any wine that drops below this many bottles.
          You can fine-tune it per wine later from Inventory.
        </p>

        <div className="flex items-center justify-center gap-4 mb-3">
          <button
            type="button"
            onClick={() => setValue((v) => Math.max(0, v - 1))}
            className="w-10 h-10 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 text-lg font-medium"
          >
            −
          </button>
          <input
            type="number"
            min={0}
            max={999}
            value={value}
            onChange={(e) => setValue(Math.max(0, parseInt(e.target.value, 10) || 0))}
            className="w-24 text-center text-3xl font-bold text-gray-900 border-b-2 border-[#722F37] focus:outline-none py-1"
          />
          <button
            type="button"
            onClick={() => setValue((v) => v + 1)}
            className="w-10 h-10 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 text-lg font-medium"
          >
            +
          </button>
        </div>
        <p className="text-xs text-gray-400 mb-8">bottles per wine, restaurant-wide default</p>

        {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

        <div className="flex items-center justify-center gap-4">
          <button onClick={onDone} className="text-sm text-gray-400 hover:text-gray-600">
            Skip for now
          </button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-[#722F37] hover:bg-[#8B3A44] text-white"
          >
            {saving ? 'Saving...' : 'Continue'}
          </Button>
        </div>
      </motion.div>
    </div>
  )
}
