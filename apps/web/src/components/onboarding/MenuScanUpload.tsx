import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { CameraCapture } from '../scanner/CameraCapture'
import { importMenu, type MenuImportSuccess } from '../../services/api/menus'
import { fitPhotoForReading } from '../../lib/fitPhoto'

interface MenuScanUploadProps {
  onSuccess: MenuImportSuccess
}

export function MenuScanUpload({ onSuccess }: MenuScanUploadProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The photo last sent, so "Try again" sends it again (r28 gap 13: a
  // "Retry" that only cleared the message left the owner to take the
  // photo again, with nothing said).
  const [lastImage, setLastImage] = useState<string | null>(null)

  const handleImage = async (imageBase64: string) => {
    setLastImage(imageBase64)
    setLoading(true)
    setError(null)
    try {
      // Bare base64 for the reader, a data URL for the first proof's crops,
      // and a phone photo fitted first (r28 gap 12).
      const photo = await fitPhotoForReading(imageBase64)
      const result = await importMenu('scan', { imageBase64: photo.base64 })
      onSuccess(result, { image: photo.dataUrl })
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Failed to analyze menu. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="w-12 h-12 rounded-full border-4 border-[#1A5E6B]/20 border-t-[#1A5E6B] animate-spin" />
        <p className="text-gray-600 font-medium">Reading your menu…</p>
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
          {lastImage && (
            <button
              type="button"
              onClick={() => void handleImage(lastImage)}
              className="ml-auto shrink-0 text-xs underline hover:no-underline"
            >
              Send this photo again
            </button>
          )}
        </div>
      )}
      <div className="rounded-xl overflow-hidden bg-white min-h-[400px]">
        <CameraCapture
          onCapture={handleImage}
          onFileUpload={handleImage}
          enableLiveDetection={false}
          useCameraModal={true}
          heading="Photograph the menu"
          intro="Take a photo of the printed menu, or choose a photo or a PDF of it. Mudavym reads every line, drinks and dishes."
          showPipeline={false}
        />
      </div>
      <p className="mt-3 text-xs text-center text-gray-400">
        Take a photo with your camera or upload an image of your printed menu
      </p>
    </div>
  )
}
