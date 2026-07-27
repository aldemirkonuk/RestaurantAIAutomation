import { useNavigate } from 'react-router-dom'
import { ArrowRight, Bot, Package, ShoppingCart } from 'lucide-react'
import { Button } from '../ui/button'
import { BrandMark } from '../brand/BrandMark'

const STAFF_CARDS = [
  {
    id: 'inventory',
    title: 'Check inventory & alerts',
    description: 'See stock levels, low-stock signals, and cellar locations.',
    icon: Package,
    href: '/inventory',
  },
  {
    id: 'orders',
    title: 'Create & track orders',
    description: 'Turn low stock into vendor orders without leaving the app.',
    icon: ShoppingCart,
    href: '/orders',
  },
  {
    id: 'wine-agent',
    title: 'Ask the Wine Agent',
    description: 'Inventory and ordering help via Sommelier AI. It does not access your email.',
    icon: Bot,
    href: '/sommelier',
  },
]

/**
 * Staff first-run — no upload, no threshold, no invite steps (those are
 * owner/manager actions on the restaurant's shared menu, per role). If the
 * restaurant already has an active menu, staff never see it as a pending
 * task — see the restaurant-scoped self-heal in getOnboardingProgress.
 */
export function StaffWelcome() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-lg text-center">
        <BrandMark size={48} alt="" className="mx-auto mb-4" />
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Welcome to WineOps</h1>
        <p className="text-gray-500 mb-8">
          Your restaurant&apos;s wine list is ready to go — uploaded by your manager. Here&apos;s
          what you&apos;ll use day to day.
        </p>

        <div className="space-y-3 text-left">
          {STAFF_CARDS.map((card) => {
            const Icon = card.icon
            return (
              <div
                key={card.id}
                className="flex items-center gap-4 p-4 rounded-xl border border-gray-200 hover:border-[#722F37]/30 transition-colors bg-white"
              >
                <div className="w-10 h-10 rounded-xl bg-[#722F37]/10 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-5 h-5 text-[#722F37]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 text-sm">{card.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{card.description}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-shrink-0"
                  onClick={() => navigate(card.href)}
                >
                  Open
                  <ArrowRight className="w-3.5 h-3.5 ml-1" />
                </Button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
