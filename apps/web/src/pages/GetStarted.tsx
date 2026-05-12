import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Camera, FileSpreadsheet, PenLine, Check, Wine } from 'lucide-react'
import { Button } from '../components/ui/button'
import { MenuImportCard } from '../components/onboarding/MenuImportCard'
import { MenuScanUpload } from '../components/onboarding/MenuScanUpload'
import { MenuCsvUpload } from '../components/onboarding/MenuCsvUpload'
import { MenuManualEntry } from '../components/onboarding/MenuManualEntry'
import { useOnboardingProgress } from '../hooks/queries/useOnboardingProgress'
import type { MenuImportResult } from '../services/api/menus'

type ImportMethod = 'scan' | 'csv' | 'manual'

function SuccessScreen({
  result,
  onDashboard,
  onInventory,
}: {
  result: MenuImportResult
  onDashboard: () => void
  onInventory: () => void
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 bg-white">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', duration: 0.5 }}
        className="flex flex-col items-center text-center"
      >
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-6">
          <Check className="w-8 h-8 text-green-600" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          We found {result.itemsExtracted} wine{result.itemsExtracted !== 1 ? 's' : ''}!
        </h1>
        <p className="text-gray-500 text-center max-w-sm mb-8">
          Your wine list has been uploaded. WineOps will analyze and enrich each wine in the
          background.
        </p>
        <div className="flex gap-3">
          <Button variant="outline" onClick={onInventory}>
            View Inventory
          </Button>
          <Button
            onClick={onDashboard}
            className="bg-[#722F37] hover:bg-[#8B3A44] text-white"
          >
            Go to Dashboard →
          </Button>
        </div>
      </motion.div>
    </div>
  )
}

export default function GetStarted() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [activeMethod, setActiveMethod] = useState<ImportMethod | null>(null)
  const [result, setResult] = useState<MenuImportResult | null>(null)
  const { progress, isLoading } = useOnboardingProgress()

  // Deep-link: /get-started?method=scan|csv|manual (also used by /onboarding/extract)
  useEffect(() => {
    const m = searchParams.get('method')?.toLowerCase()
    if (m === 'scan' || m === 'csv' || m === 'manual') {
      setActiveMethod(m as ImportMethod)
    }
  }, [searchParams])

  useEffect(() => {
    if (!isLoading && progress?.menu_uploaded) {
      navigate('/', { replace: true })
    }
  }, [progress, isLoading, navigate])

  const toggleMethod = (method: ImportMethod) => {
    setActiveMethod((prev) => (prev === method ? null : method))
  }

  if (result) {
    return (
      <SuccessScreen
        result={result}
        onDashboard={() => navigate('/')}
        onInventory={() => navigate('/inventory')}
      />
    )
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="p-6 flex items-center border-b border-gray-100">
        <Wine className="w-6 h-6 text-[#722F37] mr-2" />
        <span className="font-bold text-gray-900">WineOps</span>
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 pb-16 pt-10">
        <div className="w-full max-w-4xl">
          {/* Hero text */}
          <div className="text-center mb-10">
            <h1 className="text-3xl font-bold text-gray-900 mb-3">
              Let's set up your wine list
            </h1>
            <p className="text-gray-500 max-w-lg mx-auto">
              Uploading your menu helps WineOps understand what you sell — making ordering,
              inventory, and AI suggestions accurate from day one.
            </p>
          </div>

          {/* Method cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full mb-6">
            <MenuImportCard
              icon={<Camera className="w-5 h-5" />}
              title="Scan Photo"
              description="Take a photo of your menu with your camera or upload an image"
              active={activeMethod === 'scan'}
              dimmed={activeMethod !== null && activeMethod !== 'scan'}
              onClick={() => toggleMethod('scan')}
            />
            <MenuImportCard
              icon={<FileSpreadsheet className="w-5 h-5" />}
              title="Upload CSV"
              description="Export from your POS system or Excel and import directly"
              active={activeMethod === 'csv'}
              dimmed={activeMethod !== null && activeMethod !== 'csv'}
              onClick={() => toggleMethod('csv')}
            />
            <MenuImportCard
              icon={<PenLine className="w-5 h-5" />}
              title="Manual Entry"
              description="Type your wines in — perfect for a quick start"
              active={activeMethod === 'manual'}
              dimmed={activeMethod !== null && activeMethod !== 'manual'}
              onClick={() => toggleMethod('manual')}
            />
          </div>

          {/* Expanded sub-component */}
          <AnimatePresence mode="wait">
            {activeMethod === 'scan' && (
              <motion.div
                key="scan"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="w-full"
              >
                <MenuScanUpload onSuccess={setResult} />
              </motion.div>
            )}
            {activeMethod === 'csv' && (
              <motion.div
                key="csv"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="w-full"
              >
                <MenuCsvUpload onSuccess={setResult} />
              </motion.div>
            )}
            {activeMethod === 'manual' && (
              <motion.div
                key="manual"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="w-full"
              >
                <MenuManualEntry onSuccess={setResult} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Skip link */}
          <div className="flex justify-center mt-6">
            <button
              onClick={() => navigate('/')}
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              Skip for now →
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
