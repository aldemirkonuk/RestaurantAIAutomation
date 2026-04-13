import { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import { QrCode, Download, Printer, Camera, X, MapPin, Package, Wine, ArrowRight } from 'lucide-react'
import { QRCodeCanvas } from 'qrcode.react'

interface WineOption {
  id: string
  name: string
  producer?: string
  vintage?: number
  stockLive?: number
  shadowStock?: number
  storageLocation?: string
}

interface QRCodeGeneratorProps {
  wines: WineOption[]
  onWineFound?: (wine: WineOption) => void
}

interface ScannedWineInfo {
  wine: WineOption | null
  loading: boolean
  error: string | null
}

export function QRCodeGenerator({ wines, onWineFound }: QRCodeGeneratorProps) {
  const [activeTab, setActiveTab] = useState<'generate' | 'scan'>('generate')
  const [selectedWineId, setSelectedWineId] = useState(wines[0]?.id || '')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isCameraActive, setIsCameraActive] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [scannedWine, setScannedWine] = useState<ScannedWineInfo>({ wine: null, loading: false, error: null })
  const streamRef = useRef<MediaStream | null>(null)

  const selectedWine = useMemo(() => wines.find(wine => wine.id === selectedWineId), [wines, selectedWineId])
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
  const qrValue = selectedWine && baseUrl ? `${baseUrl}/wines?wineId=${selectedWine.id}` : ''

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
      }
    }
  }, [])

  // Stop camera when switching tabs
  useEffect(() => {
    if (activeTab !== 'scan' && streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
      setIsCameraActive(false)
    }
  }, [activeTab])

  const handleDownload = () => {
    if (!canvasRef.current || !selectedWine) return
    const dataUrl = canvasRef.current.toDataURL('image/png')
    const link = document.createElement('a')
    link.href = dataUrl
    link.download = `${selectedWine.name.replace(/\s+/g, '-').toLowerCase()}-qr.png`
    link.click()
  }

  const handlePrint = () => {
    if (!canvasRef.current || !selectedWine) return
    const dataUrl = canvasRef.current.toDataURL('image/png')
    const printWindow = window.open('', '_blank')
    if (!printWindow) return
    printWindow.document.write(`
      <html>
        <head><title>${selectedWine.name} QR</title></head>
        <body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
          <img src="${dataUrl}" alt="${selectedWine.name} QR" style="width:256px;height:256px;" />
        </body>
      </html>
    `)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
    printWindow.close()
  }

  const startCamera = async () => {
    setCameraError(null)
    setScannedWine({ wine: null, loading: false, error: null })
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      })
      
      streamRef.current = stream
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setIsCameraActive(true)
        startScanning()
      }
    } catch (error) {
      console.error('Camera access error:', error)
      setCameraError('Unable to access camera. Please grant camera permissions.')
    }
  }

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    setIsCameraActive(false)
    setScannedWine({ wine: null, loading: false, error: null })
  }

  const startScanning = useCallback(() => {
    if (!videoRef.current || !isCameraActive) return

    // Check if BarcodeDetector is available
    if ('BarcodeDetector' in window) {
      const barcodeDetector = new (window as any).BarcodeDetector({ formats: ['qr_code'] })
      
      const scanInterval = setInterval(async () => {
        if (!videoRef.current || !isCameraActive) {
          clearInterval(scanInterval)
          return
        }

        try {
          const barcodes = await barcodeDetector.detect(videoRef.current)
          if (barcodes.length > 0) {
            const qrData = barcodes[0].rawValue
            clearInterval(scanInterval)
            handleQRResult(qrData)
          }
        } catch (error) {
          // Silent fail - keep scanning
        }
      }, 200)

      return () => clearInterval(scanInterval)
    } else {
      // Fallback: manual entry or show message
      setCameraError('QR scanning requires a supported browser. Try Chrome or Safari.')
    }
  }, [isCameraActive])

  useEffect(() => {
    if (isCameraActive) {
      const cleanup = startScanning()
      return cleanup
    }
  }, [isCameraActive, startScanning])

  const handleQRResult = (qrData: string) => {
    setScannedWine({ wine: null, loading: true, error: null })
    
    try {
      // Parse the QR URL to get wine ID
      const url = new URL(qrData)
      const wineId = url.searchParams.get('wineId')
      
      if (wineId) {
        const foundWine = wines.find(w => w.id === wineId)
        if (foundWine) {
          setScannedWine({ wine: foundWine, loading: false, error: null })
          stopCamera()
          if (onWineFound) {
            onWineFound(foundWine)
          }
        } else {
          setScannedWine({ wine: null, loading: false, error: 'Wine not found in inventory' })
        }
      } else {
        setScannedWine({ wine: null, loading: false, error: 'Invalid QR code format' })
      }
    } catch (error) {
      setScannedWine({ wine: null, loading: false, error: 'Could not parse QR code' })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <QrCode className="w-5 h-5 text-emerald-600" />
          <h4 className="font-semibold text-gray-900">QR Code</h4>
        </div>
      </div>

      {/* Tab Switcher */}
      <div className="flex bg-gray-100 rounded-lg p-1">
        <button
          onClick={() => setActiveTab('generate')}
          className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-all ${
            activeTab === 'generate'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Generate QR
        </button>
        <button
          onClick={() => setActiveTab('scan')}
          className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-all ${
            activeTab === 'scan'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Scan QR
        </button>
      </div>

      {activeTab === 'generate' ? (
        /* Generate Tab */
        <div className="p-5 bg-gradient-to-br from-emerald-50 to-teal-50 rounded-xl space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-2">Select wine</label>
            <select
              value={selectedWineId}
              onChange={(e) => setSelectedWineId(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            >
              {wines.map(wine => (
                <option key={wine.id} value={wine.id}>
                  {wine.name} {wine.vintage ? `(${wine.vintage})` : ''} {wine.producer ? `• ${wine.producer}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="bg-white rounded-lg p-4 flex items-center justify-center shadow-sm">
            {qrValue ? (
              <QRCodeCanvas ref={canvasRef} value={qrValue} size={180} />
            ) : (
              <div className="w-40 h-40 flex items-center justify-center text-gray-400 border border-dashed border-gray-300 rounded-lg">
                No wine selected
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDownload}
              disabled={!qrValue}
              className="flex-1 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Download className="w-4 h-4" />
              Download
            </button>
            <button
              onClick={handlePrint}
              disabled={!qrValue}
              className="flex-1 px-4 py-2 bg-white text-emerald-700 text-sm font-medium rounded-lg border border-emerald-200 hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Printer className="w-4 h-4" />
              Print
            </button>
          </div>

          {selectedWine && (
            <p className="text-xs text-gray-500 text-center">
              QR links to {selectedWine.name} in Wine Library.
            </p>
          )}
        </div>
      ) : (
        /* Scan Tab */
        <div className="p-5 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl space-y-4">
          {!isCameraActive && !scannedWine.wine ? (
            /* Camera Not Active - Show Start Button */
            <div className="space-y-4">
              <div className="relative w-full aspect-square max-w-xs mx-auto bg-gray-900 rounded-3xl overflow-hidden flex items-center justify-center">
                <div className="absolute inset-4 rounded-2xl border-4 border-blue-500 z-10 pointer-events-none" />
                <div className="text-center text-white">
                  <Camera className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p className="text-sm font-medium">CAMERA VIEW</p>
                  <p className="text-xs opacity-70 mt-1">Tap to start scanning</p>
                </div>
              </div>
              
              <button
                onClick={startCamera}
                className="w-full px-4 py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
              >
                <Camera className="w-5 h-5" />
                Start Scanning
              </button>

              {cameraError && (
                <p className="text-sm text-red-600 text-center bg-red-50 p-3 rounded-lg">
                  {cameraError}
                </p>
              )}
            </div>
          ) : isCameraActive ? (
            /* Camera Active - Show Video Feed */
            <div className="space-y-4">
              <div className="relative w-full aspect-square max-w-xs mx-auto rounded-3xl overflow-hidden">
                <div className="absolute inset-4 rounded-2xl border-4 border-blue-500 z-10 pointer-events-none animate-pulse" />
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
              </div>
              
              <p className="text-sm text-gray-600 text-center">
                Point camera at a wine QR code
              </p>

              <button
                onClick={stopCamera}
                className="w-full px-4 py-3 bg-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-300 transition-colors flex items-center justify-center gap-2"
              >
                <X className="w-5 h-5" />
                Cancel
              </button>
            </div>
          ) : scannedWine.wine ? (
            /* Wine Found - Show Details */
            <div className="space-y-4">
              <div className="bg-white rounded-xl p-4 border border-green-200 shadow-sm">
                <div className="flex items-center gap-2 mb-3 text-green-600">
                  <QrCode className="w-5 h-5" />
                  <span className="text-sm font-semibold">Wine Found!</span>
                </div>
                
                <div className="flex items-start gap-3">
                  <div className="w-12 h-16 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Wine className="w-6 h-6 text-gray-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-gray-900 truncate">{scannedWine.wine.name}</h4>
                    <p className="text-sm text-gray-500">{scannedWine.wine.producer}</p>
                    {scannedWine.wine.vintage && (
                      <p className="text-sm text-gray-500">Vintage: {scannedWine.wine.vintage}</p>
                    )}
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 gap-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Package className="w-4 h-4 text-blue-500" />
                    <span className="text-gray-600">Stock:</span>
                    <span className="font-semibold text-gray-900">
                      {(scannedWine.wine.stockLive || 0) + (scannedWine.wine.shadowStock || 0)} bottles
                    </span>
                  </div>
                  {scannedWine.wine.storageLocation && (
                    <div className="flex items-center gap-2 text-sm">
                      <MapPin className="w-4 h-4 text-emerald-500" />
                      <span className="text-gray-600">Location:</span>
                      <span className="font-semibold text-gray-900">{scannedWine.wine.storageLocation}</span>
                    </div>
                  )}
                </div>
              </div>

              <button
                onClick={() => {
                  setScannedWine({ wine: null, loading: false, error: null })
                  startCamera()
                }}
                className="w-full px-4 py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
              >
                <Camera className="w-5 h-5" />
                Scan Another
              </button>

              <button
                onClick={() => {
                  if (scannedWine.wine) {
                    window.location.href = `/wines?wineId=${scannedWine.wine.id}`
                  }
                }}
                className="w-full px-4 py-3 bg-white text-blue-700 font-medium rounded-xl border border-blue-200 hover:bg-blue-50 transition-colors flex items-center justify-center gap-2"
              >
                View in Wine Library
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          ) : scannedWine.error ? (
            /* Error State */
            <div className="space-y-4">
              <div className="bg-red-50 rounded-xl p-4 border border-red-200">
                <p className="text-sm text-red-600 text-center">{scannedWine.error}</p>
              </div>
              <button
                onClick={() => {
                  setScannedWine({ wine: null, loading: false, error: null })
                  startCamera()
                }}
                className="w-full px-4 py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
              >
                <Camera className="w-5 h-5" />
                Try Again
              </button>
            </div>
          ) : null}
        </div>
      )}
      
      <p className="text-xs text-gray-500 text-center">
        {activeTab === 'generate' 
          ? 'Print and place QR codes in cellar sections for instant mobile access'
          : 'Scan QR codes to quickly look up wine details and stock levels'
        }
      </p>
    </div>
  )
}
