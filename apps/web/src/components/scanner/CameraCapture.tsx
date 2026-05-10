import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Camera,
  CameraOff,
  Upload,
  Zap,
  ZapOff,
  Image as ImageIcon,
  SwitchCamera,
} from 'lucide-react'

const ORCHESTRATOR_URL =
  import.meta.env?.VITE_AGENT_ORCHESTRATOR_URL ||
  import.meta.env?.VITE_API_GATEWAY_URL ||
  'http://localhost:8000'

export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
  label: string
  confidence: number
  classId?: number
}

interface CameraCaptureProps {
  onCapture: (imageBase64: string) => void
  onFileUpload: (imageBase64: string) => void
  enableLiveDetection?: boolean
}

export function CameraCapture({ onCapture, onFileUpload, enableLiveDetection = true }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const animFrameRef = useRef<number>(0)
  const lastFrameTimeRef = useRef<number>(0)

  const [isCameraActive, setIsCameraActive] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [isLiveDetectionOn, setIsLiveDetectionOn] = useState(enableLiveDetection)
  const [boundingBoxes, setBoundingBoxes] = useState<BoundingBox[]>([])
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment')
  const [isCapturing, setIsCapturing] = useState(false)
  const [wsConnected, setWsConnected] = useState(false)

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera()
      disconnectWs()
    }
  }, [])

  // Connect WebSocket for live YOLO preview
  const connectWs = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    try {
      const wsUrl = ORCHESTRATOR_URL.replace(/^http/, 'ws')
      const ws = new WebSocket(`${wsUrl}/ws/scan/preview`)

      ws.onopen = () => {
        setWsConnected(true)
        console.log('YOLO preview WebSocket connected')
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.boxes) {
            setBoundingBoxes(data.boxes)
          }
        } catch (err) {
          // ignore parse errors
        }
      }

      ws.onclose = () => {
        setWsConnected(false)
      }

      ws.onerror = () => {
        setWsConnected(false)
        console.warn('YOLO preview WebSocket unavailable - live detection disabled')
      }

      wsRef.current = ws
    } catch {
      console.warn('Failed to connect YOLO preview WebSocket')
    }
  }, [])

  const disconnectWs = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setWsConnected(false)
    setBoundingBoxes([])
  }, [])

  // Send frames to backend for live detection
  const sendFrameForDetection = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || !wsRef.current) return
    if (wsRef.current.readyState !== WebSocket.OPEN) return

    const video = videoRef.current
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Throttle to ~2 fps
    const now = performance.now()
    if (now - lastFrameTimeRef.current < 500) return
    lastFrameTimeRef.current = now

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    ctx.drawImage(video, 0, 0)

    // Send as compressed JPEG for performance
    canvas.toBlob(
      (blob) => {
        if (!blob || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
        const reader = new FileReader()
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1]
          wsRef.current?.send(JSON.stringify({ frame: base64 }))
        }
        reader.readAsDataURL(blob)
      },
      'image/jpeg',
      0.6,
    )
  }, [])

  // Draw bounding box overlay
  const drawOverlay = useCallback(() => {
    const overlay = overlayCanvasRef.current
    const video = videoRef.current
    if (!overlay || !video) return

    const ctx = overlay.getContext('2d')
    if (!ctx) return

    // Match overlay size to video display size
    const rect = video.getBoundingClientRect()
    overlay.width = rect.width
    overlay.height = rect.height

    ctx.clearRect(0, 0, overlay.width, overlay.height)

    if (boundingBoxes.length === 0) return

    // Scale factors (video resolution -> display size)
    const scaleX = rect.width / video.videoWidth
    const scaleY = rect.height / video.videoHeight

    const COLORS = [
      '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
      '#f97316', '#eab308', '#22c55e', '#14b8a6',
    ]

    boundingBoxes.forEach((box, i) => {
      const x = box.x * scaleX
      const y = box.y * scaleY
      const w = box.width * scaleX
      const h = box.height * scaleY
      const color = COLORS[i % COLORS.length]

      // Draw box
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.setLineDash([4, 2])
      ctx.strokeRect(x, y, w, h)
      ctx.setLineDash([])

      // Draw label background
      const label = `${box.label} ${Math.round(box.confidence * 100)}%`
      ctx.font = 'bold 11px Inter, system-ui, sans-serif'
      const textWidth = ctx.measureText(label).width + 8
      ctx.fillStyle = color
      ctx.fillRect(x, y - 20, textWidth, 20)

      // Draw label text
      ctx.fillStyle = '#ffffff'
      ctx.fillText(label, x + 4, y - 6)
    })
  }, [boundingBoxes])

  // Animation loop for overlay + frame sending
  useEffect(() => {
    if (!isCameraActive) return

    const loop = () => {
      if (isLiveDetectionOn) {
        sendFrameForDetection()
      }
      drawOverlay()
      animFrameRef.current = requestAnimationFrame(loop)
    }

    animFrameRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(animFrameRef.current)
  }, [isCameraActive, isLiveDetectionOn, sendFrameForDetection, drawOverlay])

  // Start camera
  const startCamera = async () => {
    setCameraError(null)
    setBoundingBoxes([])

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      })

      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setIsCameraActive(true)

        if (isLiveDetectionOn) {
          connectWs()
        }
      }
    } catch (error) {
      console.error('Camera access error:', error)
      setCameraError('Unable to access camera. Please grant camera permissions or try uploading an image instead.')
    }
  }

  // Stop camera
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    cancelAnimationFrame(animFrameRef.current)
    setIsCameraActive(false)
    setBoundingBoxes([])
    disconnectWs()
  }

  // Switch camera (front/back)
  const switchCamera = async () => {
    stopCamera()
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))
    // Camera will restart when facingMode changes
    setTimeout(startCamera, 100)
  }

  // Toggle live detection
  const toggleLiveDetection = () => {
    if (isLiveDetectionOn) {
      disconnectWs()
      setBoundingBoxes([])
    } else {
      connectWs()
    }
    setIsLiveDetectionOn(!isLiveDetectionOn)
  }

  // Capture current frame
  const captureFrame = () => {
    if (!videoRef.current || !canvasRef.current) return

    setIsCapturing(true)
    const video = videoRef.current
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    ctx.drawImage(video, 0, 0)

    const base64 = canvas.toDataURL('image/jpeg', 0.9).split(',')[1]

    stopCamera()
    setIsCapturing(false)
    onCapture(base64)
  }

  // Handle file upload
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      alert('Please select an image file')
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.includes(',') ? result.split(',')[1] : result
      onFileUpload(base64)
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="flex flex-col h-full">
      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} className="hidden" />

      {!isCameraActive ? (
        /* Camera not active - show start options */
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <div className="text-center max-w-md">
            <div className="w-20 h-20 bg-indigo-100 rounded-2xl mx-auto mb-4 flex items-center justify-center">
              <Camera className="w-10 h-10 text-indigo-600" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">Scan Wine Menu</h3>
            <p className="text-gray-500 mb-6">
              Use your camera for live AI detection or upload a menu image for full analysis.
            </p>

            <div className="flex flex-col gap-3">
              <button
                onClick={startCamera}
                className="w-full px-6 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2"
              >
                <Camera className="w-5 h-5" />
                Open Camera
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full px-6 py-3 bg-white text-gray-700 font-medium rounded-xl border-2 border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 transition-all flex items-center justify-center gap-2"
              >
                <Upload className="w-5 h-5" />
                Upload Image
              </button>
            </div>

            {cameraError && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                <CameraOff className="w-4 h-4 inline mr-2" />
                {cameraError}
              </div>
            )}

            <div className="mt-6 p-4 bg-purple-50 border border-purple-100 rounded-xl text-left">
              <div className="flex items-start gap-3">
                <Zap className="w-5 h-5 text-purple-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-gray-900 text-sm">AI Detection Pipeline</p>
                  <p className="text-xs text-gray-600 mt-1">
                    YOLOv8 (13-class) + Multi-language OCR + Gemini Pro (25 fields) + Master Library matching.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Camera active - show video with overlay */
        <div className="flex-1 flex flex-col">
          {/* Video container */}
          <div className="flex-1 relative bg-black rounded-xl overflow-hidden mx-4 mt-4">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-contain"
            />
            {/* YOLO bounding box overlay */}
            <canvas
              ref={overlayCanvasRef}
              className="absolute inset-0 w-full h-full pointer-events-none"
            />

            {/* Live detection indicator */}
            <AnimatePresence>
              {isLiveDetectionOn && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="absolute top-3 left-3 flex items-center gap-2 px-3 py-1.5 bg-black/60 backdrop-blur-sm rounded-full"
                >
                  <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-400 animate-pulse' : 'bg-amber-400'}`} />
                  <span className="text-xs text-white font-medium">
                    {wsConnected ? `YOLO Live (${boundingBoxes.length} detected)` : 'Connecting...'}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Capture flash animation */}
            <AnimatePresence>
              {isCapturing && (
                <motion.div
                  initial={{ opacity: 1 }}
                  animate={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="absolute inset-0 bg-white z-10"
                />
              )}
            </AnimatePresence>
          </div>

          {/* Camera controls */}
          <div className="px-4 py-4">
            <div className="flex items-center justify-between">
              {/* Left controls */}
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleLiveDetection}
                  className={`p-2.5 rounded-xl transition-all ${
                    isLiveDetectionOn
                      ? 'bg-indigo-100 text-indigo-600'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                  title={isLiveDetectionOn ? 'Disable live detection' : 'Enable live detection'}
                >
                  {isLiveDetectionOn ? <Zap className="w-5 h-5" /> : <ZapOff className="w-5 h-5" />}
                </button>
                <button
                  onClick={switchCamera}
                  className="p-2.5 bg-gray-100 text-gray-500 rounded-xl hover:bg-gray-200 transition-all"
                  title="Switch camera"
                >
                  <SwitchCamera className="w-5 h-5" />
                </button>
              </div>

              {/* Center: capture button */}
              <button
                onClick={captureFrame}
                className="w-16 h-16 bg-white border-4 border-indigo-600 rounded-full flex items-center justify-center hover:bg-indigo-50 transition-all shadow-lg active:scale-95"
                title="Capture frame for full analysis"
              >
                <div className="w-12 h-12 bg-indigo-600 rounded-full flex items-center justify-center">
                  <Camera className="w-6 h-6 text-white" />
                </div>
              </button>

              {/* Right controls */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2.5 bg-gray-100 text-gray-500 rounded-xl hover:bg-gray-200 transition-all"
                  title="Upload image instead"
                >
                  <ImageIcon className="w-5 h-5" />
                </button>
                <button
                  onClick={stopCamera}
                  className="p-2.5 bg-red-100 text-red-600 rounded-xl hover:bg-red-200 transition-all"
                  title="Stop camera"
                >
                  <CameraOff className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
