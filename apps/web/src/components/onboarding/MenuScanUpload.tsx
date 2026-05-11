import { useState } from 'react'
import { Upload, RotateCcw } from 'lucide-react'
import { CameraCapture } from '../scanner/CameraCapture'
import { importMenu, type MenuImportResult } from '../../services/api/menus'

interface MenuScanUploadProps {
  onSuccess: (result: MenuImportResult) => void
}

export function MenuScanUpload({ onSuccess }: MenuScanUploadProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleImage = async (imageBase64: string) => {
    setLoading(true)
    setError(null)
    try {
      const result = await importMenu('scan', { imageBase64 })
      onSuccess(result)
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Failed to analyze menu. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="w-12 h-12 rounded-full border-4 border-[#722F37]/20 border-t-[#722F37] animate-spin" />
        <p className="text-gray-600 font-medium">Analyzing your menu with AI...</p>
        <p className="text-sm text-gray-400">This usually takes 10–20 seconds</p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
      {error && (
        <div className="mb-4 flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <RotateCcw className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-xs underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}
      <div className="rounded-xl overflow-hidden bg-white min-h-[400px]">
        <CameraCapture
          onCapture={handleImage}
          onFileUpload={handleImage}
          enableLiveDetection={false}
        />
      </div>
      <p className="mt-3 text-xs text-center text-gray-400">
        Take a photo with your camera or upload an image of your printed wine list
      </p>
    </div>
  )
}
