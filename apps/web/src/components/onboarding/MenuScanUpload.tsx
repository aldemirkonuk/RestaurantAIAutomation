import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { CameraCapture } from '../scanner/CameraCapture'
import { importMenu, type MenuImportSuccess } from '../../services/api/menus'
import { READ_WITHOUT_ANSWER, readWithoutAnswer } from '../../lib/menuReadWithoutAnswer'
import { MAX_UPLOAD_BYTES } from '../../lib/uploadAccept'

// The gateway's size limit answers with a bare 413 and no words, which the
// owner used to see as "Request failed with status code 413" (F-1404).
const TOO_BIG = `This file is too big — under ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB please.`

interface MenuScanUploadProps {
  onSuccess: MenuImportSuccess
}

export function MenuScanUpload({ onSuccess }: MenuScanUploadProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The page last sent, so "Try again" sends it again rather than only
  // clearing the message and making the owner pick the file a second time
  // (F-014). Cleared when the read may already be kept, so it is not read twice.
  const [lastImage, setLastImage] = useState<string | null>(null)

  const handleImage = async (imageBase64: string) => {
    setLastImage(imageBase64)
    setLoading(true)
    setError(null)
    try {
      const result = await importMenu('scan', { imageBase64 })
      onSuccess(result, { image: imageBase64 })
    } catch (e: any) {
      if (e?.response?.status === 413) {
        // The same page would be refused again, so nothing is kept to resend.
        setLastImage(null)
        setError(TOO_BIG)
        return
      }
      if (readWithoutAnswer(e)) {
        setLastImage(null)
        setError(READ_WITHOUT_ANSWER)
        return
      }
      setError(e?.response?.data?.message || e?.message || 'We could not read that menu.')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="w-12 h-12 rounded-full border-4 border-[#1A5E6B]/20 border-t-[#1A5E6B] animate-spin" />
        <p className="text-gray-600 font-medium">Reading your menu…</p>
        <p className="text-sm text-gray-400">A long menu can take a few minutes</p>
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
              className="ml-auto text-xs underline hover:no-underline"
            >
              Try again
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
        />
      </div>
      <p className="mt-3 text-xs text-center text-gray-400">
        A photo of each page, or one PDF of the whole menu
      </p>
    </div>
  )
}
