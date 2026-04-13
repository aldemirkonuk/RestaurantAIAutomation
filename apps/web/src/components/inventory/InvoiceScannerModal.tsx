import React, { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Upload, FileText, Loader2, Check, Edit2, Trash2, AlertCircle } from 'lucide-react'
import axios from 'axios'

const API_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'

interface ExtractedWine {
  name: string
  quantity: number
  unit_type: 'case' | 'bottle'
  unit_price: number
  total_price: number
  vintage?: number
  producer?: string
  notes?: string
}

interface InvoiceScanResult {
  id: string
  wines: ExtractedWine[]
  invoice_number?: string
  invoice_date?: string
  total_amount?: number
  provider_info?: {
    name: string
    address?: string
    phone?: string
  }
}

interface InvoiceScannerModalProps {
  isOpen: boolean
  onClose: () => void
  onInvoiceProcessed: () => void
}

export function InvoiceScannerModal({ isOpen, onClose, onInvoiceProcessed }: InvoiceScannerModalProps) {
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [extractedData, setExtractedData] = useState<InvoiceScanResult | null>(null)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editedWines, setEditedWines] = useState<ExtractedWine[]>([])
  const [error, setError] = useState<string | null>(null)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    
    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile && (droppedFile.type === 'application/pdf' || droppedFile.type.startsWith('image/'))) {
      setFile(droppedFile)
      setError(null)
    } else {
      setError('Please upload a PDF or image file')
    }
  }, [])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      setFile(selectedFile)
      setError(null)
    }
  }

  const handleUpload = async () => {
    if (!file) return

    setProcessing(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await axios.post(`${API_URL}/invoices/scan`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      })

      if (response.data.success) {
        setExtractedData(response.data.data)
        setEditedWines(response.data.data.wines)
      } else {
        setError(response.data.error || 'Failed to process invoice')
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to upload invoice. Please try again.')
    } finally {
      setProcessing(false)
    }
  }

  const handleEditWine = (index: number) => {
    setEditingIndex(index)
  }

  const handleSaveEdit = (index: number, updatedWine: ExtractedWine) => {
    const newWines = [...editedWines]
    newWines[index] = updatedWine
    setEditedWines(newWines)
    setEditingIndex(null)
  }

  const handleDeleteWine = (index: number) => {
    setEditedWines(editedWines.filter((_, i) => i !== index))
  }

  const handleConfirmAndAddToInventory = async () => {
    if (!extractedData) return

    try {
      await axios.post(`${API_URL}/invoices/${extractedData.id}/add-to-inventory`, {
        wines: editedWines
      })

      onInvoiceProcessed()
      handleClose()
    } catch (err: any) {
      setError('Failed to add wines to inventory. Please try again.')
    }
  }

  const handleClose = () => {
    setFile(null)
    setExtractedData(null)
    setEditedWines([])
    setEditingIndex(null)
    setError(null)
    onClose()
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={handleClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-wine-50 to-purple-50">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-wine-600 rounded-xl">
                <FileText className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Scan Invoice</h2>
                <p className="text-sm text-gray-500">Upload PDF or image to extract wine data</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="p-2 hover:bg-white/50 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {!extractedData ? (
              <>
                {/* Upload Area */}
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-xl p-8 text-center transition-all ${
                    isDragging
                      ? 'border-wine-600 bg-wine-50'
                      : 'border-gray-300 hover:border-gray-400'
                  }`}
                >
                  <div className="flex flex-col items-center gap-4">
                    <div className={`p-4 rounded-full ${isDragging ? 'bg-wine-600' : 'bg-gray-100'}`}>
                      <Upload className={`w-8 h-8 ${isDragging ? 'text-white' : 'text-gray-400'}`} />
                    </div>
                    
                    {file ? (
                      <div className="text-center">
                        <p className="text-lg font-semibold text-gray-900">{file.name}</p>
                        <p className="text-sm text-gray-500">{(file.size / 1024).toFixed(2)} KB</p>
                      </div>
                    ) : (
                      <div>
                        <p className="text-lg font-medium text-gray-700">
                          Drag & drop your invoice here
                        </p>
                        <p className="text-sm text-gray-500 mt-1">or click to browse</p>
                      </div>
                    )}

                    <input
                      type="file"
                      accept="application/pdf,image/*"
                      onChange={handleFileSelect}
                      className="hidden"
                      id="invoice-file-input"
                    />
                    <label
                      htmlFor="invoice-file-input"
                      className="px-6 py-2.5 bg-wine-600 text-white font-medium rounded-lg hover:bg-wine-700 transition-colors cursor-pointer"
                    >
                      Choose File
                    </label>

                    <p className="text-xs text-gray-400">
                      Supported formats: PDF, JPG, PNG (max 10MB)
                    </p>
                  </div>
                </div>

                {error && (
                  <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-red-900">Error</p>
                      <p className="text-sm text-red-700">{error}</p>
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-3 mt-6">
                  <button
                    onClick={handleUpload}
                    disabled={!file || processing}
                    className="flex-1 px-6 py-3 bg-wine-600 text-white font-medium rounded-xl hover:bg-wine-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {processing ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Upload className="w-5 h-5" />
                        Scan Invoice
                      </>
                    )}
                  </button>
                  <button
                    onClick={handleClose}
                    className="px-6 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* Invoice Info */}
                <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl p-4 mb-6">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {extractedData.invoice_number && (
                      <div>
                        <p className="text-xs text-gray-500 font-medium">Invoice #</p>
                        <p className="text-sm font-semibold text-gray-900">{extractedData.invoice_number}</p>
                      </div>
                    )}
                    {extractedData.invoice_date && (
                      <div>
                        <p className="text-xs text-gray-500 font-medium">Date</p>
                        <p className="text-sm font-semibold text-gray-900">{extractedData.invoice_date}</p>
                      </div>
                    )}
                    {extractedData.provider_info?.name && (
                      <div>
                        <p className="text-xs text-gray-500 font-medium">Provider</p>
                        <p className="text-sm font-semibold text-gray-900">{extractedData.provider_info.name}</p>
                      </div>
                    )}
                    {extractedData.total_amount && (
                      <div>
                        <p className="text-xs text-gray-500 font-medium">Total</p>
                        <p className="text-sm font-semibold text-gray-900">${extractedData.total_amount.toFixed(2)}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Extracted Wines */}
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-gray-900">
                      Extracted Wines ({editedWines.length})
                    </h3>
                    <p className="text-sm text-gray-500">Review and edit before adding</p>
                  </div>

                  <div className="space-y-3">
                    {editedWines.map((wine, index) => (
                      <WinePreviewCard
                        key={index}
                        wine={wine}
                        isEditing={editingIndex === index}
                        onEdit={() => handleEditWine(index)}
                        onSave={(updated) => handleSaveEdit(index, updated)}
                        onDelete={() => handleDeleteWine(index)}
                      />
                    ))}
                  </div>
                </div>

                {error && (
                  <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-700">{error}</p>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-3 mt-6">
                  <button
                    onClick={handleConfirmAndAddToInventory}
                    className="flex-1 px-6 py-3 bg-emerald-600 text-white font-medium rounded-xl hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2"
                  >
                    <Check className="w-5 h-5" />
                    Add All to Inventory ({editedWines.length})
                  </button>
                  <button
                    onClick={handleClose}
                    className="px-6 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

interface WinePreviewCardProps {
  wine: ExtractedWine
  isEditing: boolean
  onEdit: () => void
  onSave: (wine: ExtractedWine) => void
  onDelete: () => void
}

function WinePreviewCard({ wine, isEditing, onEdit, onSave, onDelete }: WinePreviewCardProps) {
  const [editedWine, setEditedWine] = useState<ExtractedWine>(wine)

  const handleSave = () => {
    onSave(editedWine)
  }

  if (isEditing) {
    return (
      <div className="bg-blue-50 border-2 border-blue-300 rounded-xl p-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-700 mb-1">Wine Name</label>
            <input
              type="text"
              value={editedWine.name}
              onChange={(e) => setEditedWine({ ...editedWine, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Quantity</label>
            <input
              type="number"
              value={editedWine.quantity}
              onChange={(e) => setEditedWine({ ...editedWine, quantity: parseInt(e.target.value) || 0 })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Unit Type</label>
            <select
              value={editedWine.unit_type}
              onChange={(e) => setEditedWine({ ...editedWine, unit_type: e.target.value as 'case' | 'bottle' })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="bottle">Bottles</option>
              <option value="case">Cases</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Unit Price</label>
            <input
              type="number"
              step="0.01"
              value={editedWine.unit_price}
              onChange={(e) => setEditedWine({ ...editedWine, unit_price: parseFloat(e.target.value) || 0 })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Producer</label>
            <input
              type="text"
              value={editedWine.producer || ''}
              onChange={(e) => setEditedWine({ ...editedWine, producer: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <button
            onClick={handleSave}
            className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          >
            Save
          </button>
          <button
            onClick={onEdit}
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 hover:border-gray-300 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h4 className="font-semibold text-gray-900">{wine.name}</h4>
          {wine.producer && (
            <p className="text-sm text-gray-500">{wine.producer}</p>
          )}
          <div className="flex items-center gap-4 mt-2">
            <span className="text-sm text-gray-600">
              Qty: <span className="font-medium">{wine.quantity} {wine.unit_type}(s)</span>
            </span>
            <span className="text-sm text-gray-600">
              Price: <span className="font-medium">${wine.unit_price.toFixed(2)}/{wine.unit_type}</span>
            </span>
            <span className="text-sm text-gray-600">
              Total: <span className="font-medium">${wine.total_price.toFixed(2)}</span>
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onEdit}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="Edit"
          >
            <Edit2 className="w-4 h-4 text-gray-600" />
          </button>
          <button
            onClick={onDelete}
            className="p-2 hover:bg-red-50 rounded-lg transition-colors"
            title="Delete"
          >
            <Trash2 className="w-4 h-4 text-red-600" />
          </button>
        </div>
      </div>
    </div>
  )
}

