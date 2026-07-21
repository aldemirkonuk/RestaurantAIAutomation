/**
 * Breadcrumbs — clickable trail for nested pages (NEW-030).
 *
 * Derived from the current route via breadcrumbTrail(). On flat top-level
 * routes it collapses to nothing (a single segment isn't a trail), so pages can
 * render it unconditionally without visual noise.
 */

import { Link, useLocation } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { breadcrumbTrail } from '../command/commands'
import { cn } from '../../lib/utils'

export function Breadcrumbs({ className }: { className?: string }) {
  const location = useLocation()
  const trail = breadcrumbTrail(location.pathname)

  // Nothing meaningful to show for a single-segment (flat) route.
  if (trail.length < 2) return null

  return (
    <nav aria-label="Breadcrumb" className={cn('flex items-center gap-1 text-sm', className)}>
      {trail.map((crumb, i) => {
        const last = i === trail.length - 1
        return (
          <span key={crumb.href} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-gray-300" aria-hidden />}
            {last ? (
              <span className="font-medium text-gray-900" aria-current="page">
                {crumb.label}
              </span>
            ) : (
              <Link to={crumb.href} className="text-gray-500 hover:text-gray-800 transition-colors">
                {crumb.label}
              </Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}
