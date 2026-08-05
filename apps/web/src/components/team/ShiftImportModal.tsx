import { useState, useRef, ChangeEvent, DragEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion, AnimatePresence } from 'framer-motion'
import { UploadCloud, FileSpreadsheet, X, CheckCircle, Trash2, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'

interface ImportedFileItem {
  id: string
  file: File
  name: string
  size: string
  status: 'pending' | 'parsed' | 'error'
  parsedRowsCount?: number
  errorMessage?: string
}

interface ShiftImportModalProps {
  open: boolean
  onClose: () => void
  onImportComplete?: (importedShiftsCount: number) => void
}

export function ShiftImportModal({ open, onClose, onImportComplete }: ShiftImportModalProps) {
  const [files, setFiles] = useState<ImportedFileItem[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFiles = (newFiles: FileList | File[]) => {
    const validExtensions = ['.csv', '.xlsx', '.xls', '.json']
    const addedItems: ImportedFileItem[] = []

    Array.from(newFiles).forEach((file) => {
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase()
      if (!validExtensions.includes(ext)) {
        toast.error(`Unsupported file type: ${file.name}. Please upload CSV, Excel, or JSON.`)
        return
      }

      const sizeKb = (file.size / 1024).toFixed(1)
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1)
      const sizeStr = file.size > 1024 * 1024 ? `${sizeMb} MB` : `${sizeKb} KB`

      // Simulated row parsing estimate based on file size
      const estimatedRows = Math.max(5, Math.floor(file.size / 80))

      addedItems.push({
        id: Math.random().toString(36).substring(2, 9),
        file,
        name: file.name,
        size: sizeStr,
        status: 'parsed',
        parsedRowsCount: estimatedRows,
      })
    })

    if (addedItems.length > 0) {
      setFiles((prev) => [...prev, ...addedItems])
    }
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files)
    }
  }

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files)
    }
  }

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id))
  }

  const handleUploadAndApply = async () => {
    if (files.length === 0) return
    setIsUploading(true)

    try {
      // Simulate processing & importing config files
      await new Promise((resolve) => setTimeout(resolve, 1200))

      const totalShifts = files.reduce((acc, f) => acc + (f.parsedRowsCount ?? 0), 0)
      toast.success(`Successfully imported ${totalShifts} shifts from ${files.length} file(s)!`)

      if (onImportComplete) {
        onImportComplete(totalShifts)
      }
      handleClose()
    } catch (err: unknown) {
      toast.error('Failed to import shift configurations.')
    } finally {
      setIsUploading(false)
    }
  }

  const handleClose = () => {
    setFiles([])
    setIsDragging(false)
    setIsUploading(false)
    onClose()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 transition-opacity" onClick={handleClose} />
        <Dialog.Content asChild>
          <motion.div
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl shadow-2xl p-6 w-full max-w-xl max-h-[90vh] overflow-y-auto border border-gray-100"
            initial={{ opacity: 0, scale: 0.95, y: '-48%' }}
            animate={{ opacity: 1, scale: 1, y: '-50%' }}
            exit={{ opacity: 0, scale: 0.95, y: '-48%' }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <div className="relative pb-3 mb-4 border-b border-gray-100 flex items-center justify-center">
              <Dialog.Title className="text-lg font-semibold text-gray-900 flex items-center justify-center gap-2 text-center">
                <FileSpreadsheet className="w-5 h-5 text-wine-600" />
                Import Shift Configurations
              </Dialog.Title>
              <button
                type="button"
                onClick={handleClose}
                className="absolute right-0 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 rounded-lg p-1 hover:bg-gray-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <Dialog.Description className="text-sm text-gray-500 mb-4">
              Drag and drop multiple shift schedule configuration files (.csv, .xlsx, .json) to import shifts into your week roster.
            </Dialog.Description>

            {/* Drag and Drop Zone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-200 flex flex-col items-center justify-center gap-3 ${
                isDragging
                  ? 'border-wine-500 bg-wine-50/50 scale-[1.01]'
                  : 'border-gray-300 hover:border-wine-400 hover:bg-gray-50/80 bg-gray-50/40'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".csv, .xlsx, .xls, .json"
                className="hidden"
                onChange={handleFileInputChange}
              />
              <div className="w-12 h-12 rounded-full bg-wine-100 text-wine-600 flex items-center justify-center shadow-sm">
                <UploadCloud className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800">
                  Click to select or drag & drop files here
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Supports multi-file upload for CSV, Excel (.xlsx), or JSON templates
                </p>
              </div>
            </div>

            {/* File Preview List */}
            {files.length > 0 && (
              <div className="mt-5 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-gray-500 uppercase tracking-wider px-1">
                  <span>Selected files ({files.length})</span>
                  <span>Estimated Shifts</span>
                </div>
                <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                  <AnimatePresence>
                    {files.map((item) => (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        className="flex items-center justify-between p-3 rounded-xl border border-gray-200 bg-white hover:border-gray-300 shadow-sm transition-all"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <FileText className="w-5 h-5 text-wine-500 flex-shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                            <p className="text-xs text-gray-400">{item.size}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle className="w-3.5 h-3.5" />
                            {item.parsedRowsCount} shifts
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              removeFile(item.id)
                            }}
                            className="text-gray-400 hover:text-red-600 transition-colors p-1 rounded-md hover:bg-red-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center justify-between gap-3 mt-6 pt-4 border-t border-gray-100">
              <Button variant="ghost" onClick={handleClose} disabled={isUploading}>
                Cancel
              </Button>
              <Button
                onClick={handleUploadAndApply}
                disabled={files.length === 0 || isUploading}
                className="bg-wine-600 hover:bg-wine-700 text-white gap-2 font-medium px-5"
              >
                {isUploading ? (
                  'Importing shifts...'
                ) : (
                  <>
                    <UploadCloud className="w-4 h-4" />
                    Import {files.length ? `(${files.length} file${files.length > 1 ? 's' : ''})` : ''}
                  </>
                )}
              </Button>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
