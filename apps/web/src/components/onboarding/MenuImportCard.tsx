import { cn } from '../../lib/utils'

interface MenuImportCardProps {
  icon: React.ReactNode
  title: string
  description: string
  active: boolean
  dimmed: boolean
  onClick: () => void
}

export function MenuImportCard({
  icon,
  title,
  description,
  active,
  dimmed,
  onClick,
}: MenuImportCardProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-col items-start p-6 rounded-2xl border-2 text-left transition-all duration-200 w-full',
        active
          ? 'border-[#722F37] bg-[#722F37]/5 shadow-md'
          : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm',
        dimmed && 'opacity-40'
      )}
    >
      <div
        className={cn(
          'w-10 h-10 rounded-xl flex items-center justify-center mb-4',
          active ? 'bg-[#722F37] text-white' : 'bg-gray-100 text-gray-600'
        )}
      >
        {icon}
      </div>
      <h3 className="font-semibold text-gray-900 mb-1">{title}</h3>
      <p className="text-sm text-gray-500 leading-relaxed">{description}</p>
    </button>
  )
}
