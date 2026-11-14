import { Loader2 } from 'lucide-react'

export function PageLoader({ note }: { note?: string | null } = {}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center">
        <Loader2 className="w-8 h-8 text-wine-600 animate-spin mx-auto mb-4" />
        <p className="text-sm text-gray-600">Loading...</p>
        {note ? (
          <p role="status" aria-live="polite" data-session-wait-note className="mt-2 max-w-sm mx-auto px-4 text-sm text-gray-600">
            {note}
          </p>
        ) : null}
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
