/**
 * DragHandle - Atomic Component
 * Visual drag indicator (3 dots)
 * Only visible in edit mode
 */

interface DragHandleProps {
  isVisible?: boolean
  className?: string
}

export function DragHandle({ isVisible = true, className = '' }: DragHandleProps) {
  if (!isVisible) return null

  return (
    <div className={`absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-0.5 ${className}`}>
      <div className="w-1 h-1 bg-gray-300 rounded-full" />
      <div className="w-1 h-1 bg-gray-300 rounded-full" />
      <div className="w-1 h-1 bg-gray-300 rounded-full" />
    </div>
  )
}
