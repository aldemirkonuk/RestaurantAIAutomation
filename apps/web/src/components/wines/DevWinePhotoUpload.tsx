import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Upload, Image as ImageIcon, Trash2, Eye, Download, Camera } from 'lucide-react'
import { Card, Button } from '../ui'

interface WineTestPhoto {
  id: string
  name: string
  url: string
  file: File
  uploadedAt: Date
  notes: string
}

interface DevWinePhotoUploadProps {
  onClose: () => void
}

export function DevWinePhotoUpload({ onClose }: DevWinePhotoUploadProps) {
  const [testPhotos, setTestPhotos] = useState<WineTestPhoto[]>([])
  const [selectedPhoto, setSelectedPhoto] = useState<WineTestPhoto | null>(null)
  const [dragOver, setDragOver] = useState(false)

  // Pre-populated test wines data
  const testWinesInfo = [
    {
      name: '2022 Petit Clos (Clos Henri) Marlborough Pinot Noir',
      producer: 'Clos Henri',
      region: 'Marlborough',
      country: 'New Zealand',
      vintage: 2022,
      type: 'red',
      grapes: ['Pinot Noir']
    },
    {
      name: '2022 Scribe Estate Carneros Pinot Noir',
      producer: 'Scribe Winery',
      region: 'Carneros',
      appellation: 'Sonoma Valley',
      country: 'USA',
      vintage: 2022,
      type: 'red',
      grapes: ['Pinot Noir']
    },
    {
      name: '2021 Ramey Russian River Valley Chardonnay',
      producer: 'Ramey Wine Cellars',
      region: 'Russian River Valley',
      appellation: 'Sonoma County',
      country: 'USA',
      vintage: 2021,
      type: 'white',
      grapes: ['Chardonnay']
    }
  ]

  const handleFileUpload = (files: FileList | null) => {
    if (!files) return

    Array.from(files).forEach(file => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader()
        reader.onload = (e) => {
          const newPhoto: WineTestPhoto = {
            id: `TEST_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: file.name,
            url: e.target?.result as string,
            file: file,
            uploadedAt: new Date(),
            notes: ''
          }
          setTestPhotos(prev => [...prev, newPhoto])
        }
        reader.readAsDataURL(file)
      }
    })
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    handleFileUpload(e.dataTransfer.files)
  }

  const deletePhoto = (id: string) => {
    setTestPhotos(prev => prev.filter(p => p.id !== id))
    if (selectedPhoto?.id === id) {
      setSelectedPhoto(null)
    }
  }

  const updateNotes = (id: string, notes: string) => {
    setTestPhotos(prev => prev.map(p => p.id === id ? { ...p, notes } : p))
    if (selectedPhoto?.id === id) {
      setSelectedPhoto({ ...selectedPhoto, notes })
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden border-2 border-red-500/30"
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-red-600 to-rose-600 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-lg">
                <Camera className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white">🔧 DEV: Wine Label Test Photos</h2>
                <p className="text-sm text-white/80">Testing YOLOv8 + OCR Detection | Programmer Access Only</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-white hover:bg-white/20 p-2 rounded-lg transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          <div className="p-6 max-h-[calc(90vh-100px)] overflow-y-auto">
            {/* Instructions Panel */}
            <Card variant="glass" padding="md" className="mb-6 bg-blue-50 border-blue-200">
              <h3 className="text-lg font-bold text-blue-900 mb-3">📋 Test Wines Information</h3>
              <div className="space-y-3 text-sm">
                {testWinesInfo.map((wine, idx) => (
                  <div key={idx} className="p-3 bg-white rounded-lg border border-blue-200">
                    <p className="font-bold text-gray-900">{idx + 1}. {wine.name}</p>
                    <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-gray-600">
                      <p><span className="font-semibold">Producer:</span> {wine.producer}</p>
                      <p><span className="font-semibold">Vintage:</span> {wine.vintage}</p>
                      <p><span className="font-semibold">Region:</span> {wine.region}, {wine.country}</p>
                      <p><span className="font-semibold">Type:</span> {wine.type} ({wine.grapes.join(', ')})</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Upload Area */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-all ${
                dragOver 
                  ? 'border-wine-500 bg-wine-50' 
                  : 'border-gray-300 bg-gray-50 hover:border-wine-400'
              }`}
            >
              <Upload className={`w-12 h-12 mx-auto mb-4 ${dragOver ? 'text-wine-600' : 'text-gray-400'}`} />
              <p className="text-lg font-semibold text-gray-700 mb-2">
                Drag & Drop Wine Label Photos Here
              </p>
              <p className="text-sm text-gray-500 mb-4">
                or click to browse (JPG, PNG, WebP)
              </p>
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={(e) => handleFileUpload(e.target.files)}
                className="hidden"
                id="wine-photo-upload"
              />
              <label htmlFor="wine-photo-upload">
                <Button variant="default" className="bg-wine-600 hover:bg-wine-700 cursor-pointer">
                  <Upload className="w-4 h-4 mr-2" />
                  Browse Files
                </Button>
              </label>
            </div>

            {/* Photos Grid */}
            {testPhotos.length > 0 && (
              <div className="mt-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-white">
                    Uploaded Photos ({testPhotos.length})
                  </h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setTestPhotos([])}
                    className="text-red-600 border-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Clear All
                  </Button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {testPhotos.map(photo => (
                    <motion.div
                      key={photo.id}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="group relative bg-white rounded-xl shadow-md overflow-hidden hover:shadow-xl transition-shadow"
                    >
                      <div className="aspect-[3/4] relative">
                        <img
                          src={photo.url}
                          alt={photo.name}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-all flex items-center justify-center gap-2">
                          <button
                            onClick={() => setSelectedPhoto(photo)}
                            className="p-2 bg-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-gray-100"
                          >
                            <Eye className="w-5 h-5 text-gray-700" />
                          </button>
                          <button
                            onClick={() => deletePhoto(photo.id)}
                            className="p-2 bg-red-500 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                          >
                            <Trash2 className="w-5 h-5 text-white" />
                          </button>
                        </div>
                      </div>
                      <div className="p-3">
                        <p className="text-xs font-medium text-gray-700 truncate">{photo.name}</p>
                        <p className="text-xs text-gray-500">{photo.uploadedAt.toLocaleTimeString()}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {/* Photo Detail Modal */}
            <AnimatePresence>
              {selectedPhoto && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[250] flex items-center justify-center p-4"
                  onClick={() => setSelectedPhoto(null)}
                >
                  <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    onClick={(e) => e.stopPropagation()}
                    className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden"
                  >
                    <div className="flex items-center justify-between p-4 border-b border-gray-200">
                      <h3 className="text-lg font-bold text-gray-900">{selectedPhoto.name}</h3>
                      <button
                        onClick={() => setSelectedPhoto(null)}
                        className="p-2 hover:bg-gray-100 rounded-lg"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="p-6 overflow-y-auto max-h-[calc(90vh-180px)]">
                      <img
                        src={selectedPhoto.url}
                        alt={selectedPhoto.name}
                        className="w-full h-auto rounded-lg shadow-lg mb-4"
                      />
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                          Testing Notes:
                        </label>
                        <textarea
                          value={selectedPhoto.notes}
                          onChange={(e) => updateNotes(selectedPhoto.id, e.target.value)}
                          placeholder="Add notes about this test image (e.g., YOLOv8 confidence, OCR accuracy, detection issues...)"
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-wine-500 text-sm"
                          rows={4}
                        />
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3">
                        <a
                          href={selectedPhoto.url}
                          download={selectedPhoto.name}
                          className="flex items-center justify-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
                        >
                          <Download className="w-4 h-4" />
                          Download
                        </a>
                        <button
                          onClick={() => {
                            // TODO: When Visual Verification Agent is ready, call API here
                            alert('🚧 YOLOv8 Detection API not ready yet.\n\nThis will call:\nPOST /api/visual/detect-wine\n\nExpected response:\n- Wine name\n- Producer\n- Vintage\n- Confidence score\n- Master library match')
                          }}
                          className="flex items-center justify-center gap-2 px-4 py-2 bg-wine-600 hover:bg-wine-700 text-white rounded-lg transition-colors"
                        >
                          <ImageIcon className="w-4 h-4" />
                          Test Detection
                        </button>
                      </div>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Info Footer */}
            <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-sm text-yellow-800">
                <strong>⚠️ Developer Mode:</strong> This panel is for testing YOLOv8 wine label detection during development. 
                Photos uploaded here are stored in browser memory only and will be lost on page refresh. 
                Use the "Test Detection" button to send images to the Visual Verification Agent once implemented.
              </p>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

