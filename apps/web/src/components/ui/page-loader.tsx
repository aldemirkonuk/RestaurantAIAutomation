import { Loader2 } from 'lucide-react'

export function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center">
        <Loader2 className="w-8 h-8 text-wine-600 animate-spin mx-auto mb-4" />
        <p className="text-sm text-gray-600">Loading...</p>
      </div>
    </div>
  )
}

export function SectionLoader() {
  return (
    <div className="flex items-center justify-center p-12">
      <div className="text-center">
        <Loader2 className="w-6 h-6 text-wine-600 animate-spin mx-auto mb-3" />
        <p className="text-xs text-gray-500">Loading...</p>
      </div>
    </div>
  )
}
