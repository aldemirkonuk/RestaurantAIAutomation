import { useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { CameraCapture } from '../scanner/CameraCapture'
import { importMenu, readRefusalWords, type MenuImportSuccess } from '../../services/api/menus'
import { getActiveRestaurantId } from '../../services/api/client'
import { fitPhotoForReading } from '../../lib/fitPhoto'
import { writeMenuReading } from '../../lib/houseMenuReading'

/** How long a background read runs before the owner is offered the house (r109 g4). */
export const GO_ON_AFTER_MS = 3000

interface MenuScanUploadProps {
  onSuccess: MenuImportSuccess
  /**
   * Opens the house while the read goes on. Given, a read still running
   * GO_ON_AFTER_MS after the server took the photo offers "Go on to the house".
   */
  onGoOn?: () => void
}

export function MenuScanUpload({ onSuccess, onGoOn }: MenuScanUploadProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The version the server is reading, once it says so, and whether the
  // offer to go on is showing (only after the read has run GO_ON_AFTER_MS).
  const [reading, setReading] = useState<{ houseId: string; menuId: string } | null>(null)
  const [offer, setOffer] = useState(false)
  // Once the owner went on, the read's ending belongs to /house and the bell:
  // it must not pull them back to the proof, nor say a word here.
  const wentOn = useRef(false)

  // Keyed on whether a way on exists, not on the callback: a parent's new
  // arrow on each render must not restart the three seconds.
  const canGoOn = Boolean(onGoOn)
  useEffect(() => {
    if (!reading || !canGoOn) return
    const timer = setTimeout(() => setOffer(true), GO_ON_AFTER_MS)
    return () => clearTimeout(timer)
  }, [reading, canGoOn])
  // The photo last sent, so "Try again" sends it again (r28 gap 13: a
  // "Retry" that only cleared the message left the owner to take the
  // photo again, with nothing said).
  const [lastImage, setLastImage] = useState<string | null>(null)

  const handleImage = async (imageBase64: string) => {
    setLastImage(imageBase64)
    setLoading(true)
    setError(null)
    setReading(null)
    setOffer(false)
    // The house the photo is sent for: importMenu posts this same id.
    const houseId = getActiveRestaurantId()
    try {
      // Bare base64 for the reader, a data URL for the first proof's crops,
      // and a phone photo fitted first (r28 gap 12).
      const photo = await fitPhotoForReading(imageBase64)
      const result = await importMenu(
        'scan',
        { imageBase64: photo.base64 },
        { onReading: (menuId) => setReading(houseId ? { houseId, menuId } : null) },
      )
      if (wentOn.current) return
      onSuccess(result, { image: photo.dataUrl })
    } catch (e: any) {
      if (wentOn.current) return
      setError(readRefusalWords(e, 'The menu was not read. Please try again.'))
    } finally {
      if (!wentOn.current) {
        setLoading(false)
        setReading(null)
        setOffer(false)
      }
    }
  }

  const goOn = () => {
    if (!reading || !onGoOn) return
    wentOn.current = true
    writeMenuReading({ ...reading, at: Date.now() })
    onGoOn()
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="w-12 h-12 rounded-full border-4 border-[#1A5E6B]/20 border-t-[#1A5E6B] animate-spin motion-reduce:animate-none" />
        <p className="text-gray-600 font-medium">Reading your menu…</p>
        {offer && reading ? (
          <>
            <p className="max-w-xs text-center text-sm text-gray-600">
              This can take a minute. Go on to your house; we will ring when it is read.
            </p>
            <button
              type="button"
              onClick={goOn}
              className="min-h-11 rounded-xl bg-[#1A5E6B] px-5 text-sm font-semibold text-white hover:bg-[#164f5a]"
            >
              Go on to the house
            </button>
          </>
        ) : (
          <p className="text-sm text-gray-400">This usually takes 10–20 seconds</p>
        )}
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
