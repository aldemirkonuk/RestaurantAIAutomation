import { useState, useRef, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  BarChart3,
  Wine,
  Users,
  Settings,
  User,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Bell,
  HelpCircle,
  Truck,
  Tag,
  Shield,
  Sparkles,
  Bot,
  MessageSquare,
  Calendar,
  Rocket,
  BookOpen,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { cn } from '../../lib/utils'
import { BrandMark } from '../brand/BrandMark'
import { useOnboardingProgress } from '../../hooks/queries/useOnboardingProgress'
import { LearnPanel } from '../../guidance/components/LearnPanel'
import { trackGuidance } from '../../guidance/analytics'
import { useUnreadCount } from '../../hooks/queries/useNotificationQueries'
import { usePendingOrdersCount } from '../../hooks/queries/useOrderQueries'
import { useLowStockItems } from '../../hooks/queries/useInventoryQueries'
import { useUIStore } from '../../stores/uiStore'

interface NavItem {
  name: string
  href: string
  icon: React.ElementType
  badge?: number
  children?: { name: string; href: string }[]
}

const DocumentsReportsIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </svg>
)

const mainNavItems: NavItem[] = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Inventory', href: '/inventory', icon: Package },
  { name: 'Orders', href: '/orders', icon: ShoppingCart },
  { name: 'Wine Library', href: '/wines', icon: Wine },
  // Distributor discovery is a tab inside Providers (/providers?tab=discover)
  // rather than its own nav item — same subject, and the sidebar is already full.
  { name: 'Providers', href: '/providers', icon: Truck },
  { name: 'Promotions', href: '/promotions', icon: Tag },
  { name: 'Reports', href: '/reports', icon: BarChart3 },
]

const secondaryNavItems: NavItem[] = [
  { name: 'Calendar', href: '/calendar', icon: Calendar },
  { name: 'Team', href: '/team', icon: Users },
  { name: 'Communications', href: '/communications', icon: MessageSquare },
  { name: 'Documents & Reports', href: '/documents-reports', icon: DocumentsReportsIcon },
  { name: 'Notifications', href: '/notifications', icon: Bell },
]

const aiNavItems: NavItem[] = [
  { name: 'Sommelier AI', href: '/sommelier', icon: Sparkles },
  { name: 'Wine Agent', href: '/wineagent', icon: Bot },
]

const bottomNavItems: NavItem[] = [
  { name: 'Profile', href: '/profile', icon: User },
  { name: 'Settings', href: '/settings', icon: Settings },
  { name: 'Help & Support', href: '/help', icon: HelpCircle },
]

export function Sidebar() {
  const collapsed = useUIStore((s) => s.sidebarCollapsed)
  const setCollapsed = useUIStore((s) => s.setSidebarCollapsed)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen)
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)
  const [showChecklist, setShowChecklist] = useState(false)
  const checklistButtonRef = useRef<HTMLButtonElement>(null)
  const location = useLocation()
  const { user, logout } = useAuth()
  const { progress, update } = useOnboardingProgress()

  // Force expanded labels in the mobile drawer
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const apply = () => setIsMobile(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  const effectiveCollapsed = isMobile ? false : collapsed

  const closeMobileNav = () => {
    if (isMobile) setSidebarOpen(false)
  }

  // Live nav badges (NEW-018): pending orders, unread notifications, low stock.
  const unread = useUnreadCount(user?.userId ?? '')
  const pendingOrders = usePendingOrdersCount()
  const lowStock = useLowStockItems()
  const num = (v: unknown): number =>
    typeof v === 'number'
      ? v
      : Array.isArray(v)
        ? v.length
        : typeof (v as any)?.count === 'number'
          ? (v as any).count
          : 0
  const badgeByHref: Record<string, number> = {
    '/orders': num(pendingOrders.data),
    '/notifications': num(unread.data),
    '/inventory': num(lowStock.data),
  }

  const completedCount = progress
    ? [true, progress.menu_uploaded, progress.vendor_added, progress.team_member_invited].filter(
        Boolean,
      ).length
    : 1
  // Always show Get started while activation incomplete (fallback if progress fetch fails)
  const activationComplete = !!(progress?.completed_at)
  const checklistDismissed = !!progress?.checklist_dismissed
  const showGetStarted = !activationComplete && !checklistDismissed
  const showLearn = activationComplete || checklistDismissed

  const NavItemComponent = ({ item, collapsed }: { item: NavItem; collapsed: boolean }) => {
    const isActive = location.pathname === item.href
    const Icon = item.icon
    const badgeCount = item.badge ?? badgeByHref[item.href] ?? 0
    const badgeLabel = badgeCount > 99 ? '99+' : badgeCount > 0 ? String(badgeCount) : null

    const isParentActive =
      isActive ||
      (item.children && item.children.some((child) => location.pathname.startsWith(child.href)))

    return (
      <NavLink
        to={item.href}
        onClick={closeMobileNav}
        onMouseEnter={() => setHoveredItem(item.name)}
        onMouseLeave={() => setHoveredItem(null)}
        className={cn(
          'group relative flex items-center rounded-lg transition-colors',
          collapsed
            ? 'mx-auto h-10 w-10 justify-center'
            : 'min-h-[38px] gap-2.5 px-2.5 py-2',
          isParentActive
            ? 'border border-wine-100 bg-wine-50 text-wine-700'
            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
        )}
        aria-label={
          badgeLabel ? `${item.name}, ${badgeCount} pending` : item.name
        }
        aria-current={isActive ? 'page' : undefined}
      >
        <span className="relative flex shrink-0 items-center justify-center">
          <Icon
            className={cn(
              'transition-colors',
              collapsed ? 'h-[18px] w-[18px]' : 'h-4 w-4',
              isParentActive ? 'text-wine-600' : 'text-gray-400 group-hover:text-gray-700',
            )}
            aria-hidden="true"
          />

          {/* Collapsed: dot only — numbers without labels read as "2 2 2" in the rail */}
          {collapsed && badgeLabel && (
            <span
              className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-wine-500 ring-2 ring-white"
              aria-hidden
            />
          )}
        </span>

        {!collapsed && (
          <span className="overflow-hidden whitespace-nowrap text-[13px] font-medium tracking-[-0.01em]">
            {item.name}
          </span>
        )}

        {/* Expanded: numeric badge */}
        {!collapsed && badgeLabel && (
          <span
            className={cn(
              'absolute right-2.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-semibold',
              isParentActive
                ? 'border border-wine-100 bg-white text-wine-600'
                : 'bg-wine-100 text-wine-600',
            )}
            aria-hidden
          >
            {badgeLabel}
          </span>
        )}

        {/* Tooltip for collapsed state */}
        {collapsed && hoveredItem === item.name && (
          <div className="absolute left-full ml-3 whitespace-nowrap rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white shadow-xl z-50">
            {item.name}
            {badgeLabel && (
              <span className="ml-2 px-1.5 py-0.5 bg-wine-500 rounded-full text-xs">
                {badgeLabel}
              </span>
            )}
          </div>
        )}
      </NavLink>
    )
  }

  return (
    <motion.aside
      initial={false}
      animate={{ width: effectiveCollapsed ? 72 : 260 }}
      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      className={cn(
        'fixed left-0 top-0 h-screen bg-white border-r border-gray-200 flex flex-col shadow-sm',
        'z-50 md:z-40',
        'safe-area-pad transition-transform duration-200 ease-smooth',
        // Mobile drawer: off-canvas unless open
        sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
      )}
    >
      {/* Logo */}
      <div
        className={cn(
          'flex h-14 items-center border-b border-gray-100',
          effectiveCollapsed ? 'justify-center px-2' : 'justify-between px-4',
        )}
      >
        <NavLink
          to="/"
          onClick={closeMobileNav}
          className={cn('flex items-center', effectiveCollapsed ? 'justify-center' : 'gap-3')}
          aria-label="WineOps AI home"
        >
          <BrandMark
            size={effectiveCollapsed ? 28 : 32}
            alt=""
            className="shadow-sm"
          />
          <AnimatePresence>
            {!effectiveCollapsed && (
              <motion.div
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                className="overflow-hidden"
              >
                <h1 className="text-lg font-bold text-gray-900 whitespace-nowrap">WineOps AI</h1>
                <p className="text-xs text-gray-500 -mt-0.5">Inventory Intelligence</p>
              </motion.div>
            )}
          </AnimatePresence>
        </NavLink>
      </div>

      {/* Main Navigation */}
      <nav
        className={cn(
          'flex-1 overflow-y-auto py-3',
          effectiveCollapsed ? 'px-1.5' : 'px-3',
        )}
      >
        {/* Primary Section */}
        <div className="space-y-1">
          {!effectiveCollapsed && (
            <p className="px-3 mb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Main
            </p>
          )}
          {mainNavItems.map((item) => (
            <div key={item.name} className="space-y-1">
              <NavItemComponent item={item} collapsed={effectiveCollapsed} />
              {!effectiveCollapsed && item.children && (
                <div className="ml-9 space-y-1">
                  {item.children.map((child) => {
                    const childActive = location.pathname.startsWith(child.href)
                    return (
                      <NavLink
                        key={child.name}
                        to={child.href}
                        onClick={closeMobileNav}
                        className={cn(
                          'block min-h-[36px] rounded-lg px-2.5 py-1.5 text-[13px] transition-colors',
                          childActive
                            ? 'bg-wine-50 text-wine-700 font-medium'
                            : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800',
                        )}
                      >
                        {child.name}
                      </NavLink>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Secondary Section */}
        <div className={cn('space-y-1', effectiveCollapsed ? 'mt-3 border-t border-gray-100 pt-3' : 'mt-8')}>
          {!effectiveCollapsed && (
            <p className="px-3 mb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Workspace
            </p>
          )}
          {secondaryNavItems.map((item) => (
            <div key={item.name} className="space-y-1">
              <NavItemComponent item={item} collapsed={effectiveCollapsed} />
              {!effectiveCollapsed && item.children && (
                <div className="ml-9 space-y-1">
                  {item.children.map((child) => {
                    const childActive = location.pathname.startsWith(child.href)
                    return (
                      <NavLink
                        key={child.name}
                        to={child.href}
                        onClick={closeMobileNav}
                        className={cn(
                          'block min-h-[36px] rounded-lg px-2.5 py-1.5 text-[13px] transition-colors',
                          childActive
                            ? 'bg-wine-50 text-wine-700 font-medium'
                            : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800',
                        )}
                      >
                        {child.name}
                      </NavLink>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* AI Section */}
        <div className={cn('space-y-1', effectiveCollapsed ? 'mt-3 border-t border-gray-100 pt-3' : 'mt-8')}>
          {!effectiveCollapsed && (
            <p className="px-3 mb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
              AI Assistants
            </p>
          )}
          {aiNavItems.map((item) => (
            <NavItemComponent key={item.name} item={item} collapsed={effectiveCollapsed} />
          ))}
        </div>

        {/* Admin Section (if admin/owner) */}
        {user?.role === 'owner' && (
          <div className={cn('space-y-1', effectiveCollapsed ? 'mt-3 border-t border-gray-100 pt-3' : 'mt-8')}>
            {!effectiveCollapsed && (
              <p className="px-3 mb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Admin
              </p>
            )}
            <NavItemComponent
              item={{ name: 'Admin Panel', href: '/admin', icon: Shield }}
              collapsed={effectiveCollapsed}
            />
          </div>
        )}

        {/* Get started — always visible while activation incomplete */}
        {showGetStarted && (
          <div className="relative mt-4">
            <button
              ref={checklistButtonRef}
              onClick={() => {
                setShowChecklist(!showChecklist)
                if (!showChecklist) trackGuidance('learn_opened', { mode: 'get-started' })
              }}
              className={cn(
                'group flex items-center rounded-lg transition-colors text-left',
                effectiveCollapsed
                  ? 'mx-auto h-10 w-10 justify-center'
                  : 'min-h-[38px] w-full gap-2.5 px-2.5 py-2',
                showChecklist
                  ? 'bg-wine-50 text-wine-700 border border-wine-100'
                  : 'text-gray-600 hover:bg-gray-50',
              )}
            >
              <div className="relative flex shrink-0 items-center justify-center">
                <Rocket className={cn('flex-shrink-0', effectiveCollapsed ? 'h-[18px] w-[18px]' : 'h-4 w-4')} />
                {completedCount < 4 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-wine-600 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                    {completedCount}
                  </span>
                )}
              </div>
              {!effectiveCollapsed && (
                <span className="flex-1 overflow-hidden whitespace-nowrap text-[13px] font-medium tracking-[-0.01em]">
                  Get started
                </span>
              )}
              {!effectiveCollapsed && (
                <span className="text-[11px] text-gray-400">{completedCount}/4</span>
              )}
            </button>

            <AnimatePresence>
              {showChecklist && (
                <LearnPanel
                  progress={progress}
                  mode="get-started"
                  anchorRef={checklistButtonRef}
                  onClose={() => setShowChecklist(false)}
                  onDismissChecklist={() => {
                    update({ checklist_dismissed: true })
                    setShowChecklist(false)
                  }}
                />
              )}
            </AnimatePresence>
          </div>
        )}
      </nav>

      {/* Bottom Section */}
      <div className={cn('border-t border-gray-100 space-y-1', effectiveCollapsed ? 'p-1.5' : 'p-3')}>
        {showLearn && (
          <div className="relative">
            <button
              ref={checklistButtonRef}
              data-guidance="learn-help"
              onClick={() => {
                setShowChecklist(!showChecklist)
                if (!showChecklist) trackGuidance('learn_opened', { mode: 'learn' })
              }}
              className={cn(
                'flex items-center rounded-lg transition-colors text-left',
                effectiveCollapsed
                  ? 'mx-auto h-10 w-10 justify-center'
                  : 'min-h-[38px] w-full gap-2.5 px-2.5 py-2',
                showChecklist
                  ? 'bg-wine-50 text-wine-700 border border-wine-100'
                  : 'text-gray-600 hover:bg-gray-50',
              )}
            >
              <BookOpen className={cn('flex-shrink-0', effectiveCollapsed ? 'h-[18px] w-[18px]' : 'h-4 w-4')} />
              {!effectiveCollapsed && (
                <span className="overflow-hidden whitespace-nowrap text-[13px] font-medium tracking-[-0.01em]">
                  Learn & Help
                </span>
              )}
            </button>
            <AnimatePresence>
              {showChecklist && (
                <LearnPanel
                  progress={progress}
                  mode="learn"
                  anchorRef={checklistButtonRef}
                  onClose={() => setShowChecklist(false)}
                />
              )}
            </AnimatePresence>
          </div>
        )}
        {bottomNavItems.map((item) => (
          <NavItemComponent key={item.name} item={item} collapsed={effectiveCollapsed} />
        ))}

        {/* Logout */}
        <button
          onClick={logout}
          className={cn(
            'rounded-lg text-gray-600 transition-colors hover:bg-red-50 hover:text-red-600 flex items-center',
            effectiveCollapsed
              ? 'mx-auto h-10 w-10 justify-center'
              : 'min-h-[38px] w-full gap-2.5 px-2.5 py-2',
          )}
        >
          <LogOut className={cn('flex-shrink-0', effectiveCollapsed ? 'h-[18px] w-[18px]' : 'h-4 w-4')} />
          <AnimatePresence>
            {!effectiveCollapsed && (
              <motion.span
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                className="overflow-hidden whitespace-nowrap text-[13px] font-medium tracking-[-0.01em]"
              >
                Log Out
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>

      {/* User Profile */}
      <div className={cn('border-t border-gray-100', effectiveCollapsed ? 'p-1.5' : 'p-3')}>
        <div
          className={cn(
            'flex items-center rounded-xl bg-gray-50 transition-colors cursor-pointer hover:bg-gray-100',
            effectiveCollapsed ? 'justify-center p-1.5' : 'gap-3 p-2',
          )}
        >
          <div
            className={cn(
              'flex items-center justify-center rounded-full bg-gradient-to-br from-wine-400 to-wine-600 font-semibold text-white shadow-md',
              effectiveCollapsed ? 'h-8 w-8 text-xs' : 'h-9 w-9 text-sm',
            )}
          >
            {user?.name?.charAt(0) || 'U'}
          </div>
          <AnimatePresence>
            {!effectiveCollapsed && (
              <motion.div
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                className="flex-1 overflow-hidden"
              >
                <p className="text-sm font-medium text-gray-900 truncate">
                  {user?.name || 'User'}
                </p>
                <p className="text-xs text-gray-500 truncate capitalize">{user?.role || 'Manager'}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Collapse Toggle — desktop only */}
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="hidden md:flex absolute -right-3 top-20 w-6 h-6 bg-white border border-gray-200 rounded-full items-center justify-center shadow-md hover:shadow-lg hover:bg-gray-50 transition-all z-50"
      >
        {effectiveCollapsed ? (
          <ChevronRight className="w-4 h-4 text-gray-600" />
        ) : (
          <ChevronLeft className="w-4 h-4 text-gray-600" />
        )}
      </button>
    </motion.aside>
  )
}

