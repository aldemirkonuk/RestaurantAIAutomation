import { useState } from 'react'
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
  ChevronLeft,
  ChevronRight,
  LogOut,
  Bell,
  HelpCircle,
  Truck,
  FileText,
  Shield,
  Sparkles,
  Bot,
  MessageSquare,
  RefreshCw,
  Calendar,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { cn } from '../../lib/utils'

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
  { name: 'Inventory', href: '/inventory', icon: Package, badge: 3 },
  { name: 'Orders', href: '/orders', icon: ShoppingCart, badge: 5 },
  { name: 'Wine Library', href: '/wines', icon: Wine },
  { name: 'Providers', href: '/providers', icon: Truck },
  { name: 'Reports', href: '/reports', icon: BarChart3 },
]

const secondaryNavItems: NavItem[] = [
  { name: 'Calendar', href: '/calendar', icon: Calendar },
  { name: 'Team', href: '/team', icon: Users },
  { name: 'Communications', href: '/communications', icon: MessageSquare },
  { name: 'Documents & Reports', href: '/documents-reports', icon: DocumentsReportsIcon },
  { name: 'Notifications', href: '/notifications', icon: Bell, badge: 12 },
]

const aiNavItems: NavItem[] = [
  { name: 'Sommelier AI', href: '/sommelier', icon: Sparkles },
  { name: 'Wine Agent', href: '/wine-agent', icon: Bot },
]

const bottomNavItems: NavItem[] = [
  { name: 'Settings', href: '/settings', icon: Settings },
  { name: 'Help & Support', href: '/help', icon: HelpCircle },
]

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)
  const location = useLocation()
  const { user, logout } = useAuth()

  const NavItemComponent = ({ item, collapsed }: { item: NavItem; collapsed: boolean }) => {
    const isActive = location.pathname === item.href
    const Icon = item.icon

    const isParentActive =
      isActive ||
      (item.children && item.children.some((child) => location.pathname.startsWith(child.href)))

    return (
      <NavLink
        to={item.href}
        onMouseEnter={() => setHoveredItem(item.name)}
        onMouseLeave={() => setHoveredItem(null)}
        className={cn(
          'group relative flex items-center gap-3 px-3 py-2.5 rounded-xl',
          isParentActive
            ? 'bg-wine-600 text-white shadow-lg shadow-wine-600/30'
            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
        )}
        aria-label={item.name}
        aria-current={isActive ? 'page' : undefined}
      >
        <Icon className={cn('w-5 h-5 flex-shrink-0 transition-transform duration-200 group-hover:scale-110', isActive && 'text-white')} aria-hidden="true" />
        
        {!collapsed && (
          <span className="font-medium whitespace-nowrap overflow-hidden">
            {item.name}
          </span>
        )}

        {/* Badge */}
        {item.badge && (
          <span
            className={cn(
              'absolute flex items-center justify-center text-xs font-bold rounded-full min-w-[20px] h-5 px-1.5',
              collapsed ? 'top-0 right-0' : 'right-3',
              isActive ? 'bg-white text-wine-600' : 'bg-wine-100 text-wine-600'
            )}
          >
            {item.badge}
          </span>
        )}

        {/* Tooltip for collapsed state */}
        {collapsed && hoveredItem === item.name && (
          <div className="absolute left-full ml-3 px-3 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg shadow-xl z-50 whitespace-nowrap">
            {item.name}
            {item.badge && (
              <span className="ml-2 px-1.5 py-0.5 bg-wine-500 rounded-full text-xs">
                {item.badge}
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
      animate={{ width: collapsed ? 80 : 260 }}
      transition={{ duration: 0.3, ease: 'easeInOut' }}
      className="fixed left-0 top-0 h-screen bg-white border-r border-gray-200 flex flex-col z-40 shadow-sm"
    >
      {/* Logo */}
      <div className="flex items-center justify-between h-16 px-4 border-b border-gray-100">
        <NavLink to="/" className="flex items-center gap-3" aria-label="WineOps AI home">
          <div className="w-10 h-10 bg-gradient-to-br from-wine-500 to-wine-700 rounded-xl flex items-center justify-center shadow-lg">
            <Wine className="w-6 h-6 text-white" aria-hidden="true" />
          </div>
          <AnimatePresence>
            {!collapsed && (
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
      <nav className="flex-1 overflow-y-auto py-4 px-3">
        {/* Primary Section */}
        <div className="space-y-1">
          {!collapsed && (
            <p className="px-3 mb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Main
            </p>
          )}
          {mainNavItems.map((item) => (
            <div key={item.name} className="space-y-1">
              <NavItemComponent item={item} collapsed={collapsed} />
              {!collapsed && item.children && (
                <div className="ml-9 space-y-1">
                  {item.children.map((child) => {
                    const childActive = location.pathname.startsWith(child.href)
                    return (
                      <NavLink
                        key={child.name}
                        to={child.href}
                        className={cn(
                          'block text-sm px-3 py-2 rounded-lg transition-all',
                          childActive ? 'bg-wine-50 text-wine-700 font-semibold' : 'text-gray-600 hover:bg-gray-100'
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
        <div className="mt-8 space-y-1">
          {!collapsed && (
            <p className="px-3 mb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Workspace
            </p>
          )}
          {secondaryNavItems.map((item) => (
            <div key={item.name} className="space-y-1">
              <NavItemComponent item={item} collapsed={collapsed} />
              {!collapsed && item.children && (
                <div className="ml-9 space-y-1">
                  {item.children.map((child) => {
                    const childActive = location.pathname.startsWith(child.href)
                    return (
                      <NavLink
                        key={child.name}
                        to={child.href}
                        className={cn(
                          'block text-sm px-3 py-2 rounded-lg transition-all',
                          childActive ? 'bg-wine-50 text-wine-700 font-semibold' : 'text-gray-600 hover:bg-gray-100'
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
        <div className="mt-8 space-y-1">
          {!collapsed && (
            <p className="px-3 mb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
              AI Assistants
            </p>
          )}
          {aiNavItems.map((item) => (
            <NavItemComponent key={item.name} item={item} collapsed={collapsed} />
          ))}
        </div>

        {/* Admin Section (if admin/owner) */}
        {user?.role === 'owner' && (
          <div className="mt-8 space-y-1">
            {!collapsed && (
              <p className="px-3 mb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Admin
              </p>
            )}
            <NavItemComponent
              item={{ name: 'Admin Panel', href: '/admin', icon: Shield }}
              collapsed={collapsed}
            />
          </div>
        )}
      </nav>

      {/* Bottom Section */}
      <div className="border-t border-gray-100 p-3 space-y-1">
        {bottomNavItems.map((item) => (
          <NavItemComponent key={item.name} item={item} collapsed={collapsed} />
        ))}

        {/* Logout */}
        <button
          onClick={logout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-gray-600 hover:bg-red-50 hover:text-red-600 transition-all duration-200"
        >
          <LogOut className="w-5 h-5 flex-shrink-0" />
          <AnimatePresence>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                className="font-medium whitespace-nowrap overflow-hidden"
              >
                Log Out
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>

      {/* User Profile */}
      <div className="border-t border-gray-100 p-3">
        <div
          className={cn(
            'flex items-center gap-3 p-2 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer',
            collapsed && 'justify-center'
          )}
        >
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-wine-400 to-wine-600 flex items-center justify-center text-white font-semibold text-sm shadow-md">
            {user?.name?.charAt(0) || 'U'}
          </div>
          <AnimatePresence>
            {!collapsed && (
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

      {/* Collapse Toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-20 w-6 h-6 bg-white border border-gray-200 rounded-full flex items-center justify-center shadow-md hover:shadow-lg hover:bg-gray-50 transition-all z-50"
      >
        {collapsed ? (
          <ChevronRight className="w-4 h-4 text-gray-600" />
        ) : (
          <ChevronLeft className="w-4 h-4 text-gray-600" />
        )}
      </button>
    </motion.aside>
  )
}

