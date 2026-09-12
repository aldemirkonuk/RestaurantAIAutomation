import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { BrandMark } from './BrandMark'
import { cn } from '../../lib/utils'

interface AuthShellProps {
  title: string
  subtitle?: string
  children: ReactNode
  /** Wider shell for multi-step register flows. */
  wide?: boolean
  className?: string
  markSize?: number
}

/**
 * Shared auth chrome — warm paper atmosphere with an İznik wash + the Mudavym
 * text wordmark (ADR 0042). Used by Login, Register, VerifyEmail,
 * InviteLanding, NoAccess. When `title` is the brand name itself, the wordmark
 * doubles as the page heading; otherwise the wordmark sits small above the
 * page-specific title.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  wide = false,
  className,
  markSize = 72,
}: AuthShellProps) {
  const isBrandTitle = title === 'Mudavym'

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 py-12 overflow-hidden bg-[#FAF7F5]">
      {/* Atmosphere — İznik seal wash */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,rgba(26,94,107,0.10),transparent_50%),radial-gradient(ellipse_at_100%_100%,rgba(26,94,107,0.07),transparent_45%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[640px] h-[640px] rounded-full bg-wine-600/[0.05] blur-3xl"
      />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className={cn('relative w-full', wide ? 'max-w-4xl' : 'max-w-md', className)}
      >
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.08, type: 'spring', stiffness: 260, damping: 22 }}
            className={isBrandTitle ? 'mb-2' : 'mb-4'}
          >
            {isBrandTitle ? (
              <h1 className="leading-none">
                <BrandMark size={Math.round(markSize / 2)} alt="Mudavym" />
              </h1>
            ) : (
              <BrandMark size={22} alt="Mudavym" />
            )}
          </motion.div>
          {!isBrandTitle && (
            <h1 className="text-3xl font-semibold tracking-tight text-gray-900 mb-2">{title}</h1>
          )}
          {subtitle ? <p className="text-[15px] text-gray-500 leading-relaxed">{subtitle}</p> : null}
        </div>

        {children}

        <p className="text-center text-xs text-gray-400 mt-8">© 2026 Mudavym. All rights reserved.</p>
      </motion.div>
    </div>
  )
}

interface AuthCardProps {
  children: ReactNode
  className?: string
}

export function AuthCard({ children, className }: AuthCardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-wine-100/80 bg-white/80 backdrop-blur-md p-8',
        'shadow-[0_24px_64px_-24px_rgba(26,94,107,0.18),0_8px_24px_-12px_rgba(15,23,42,0.08)]',
        className,
      )}
    >
      {children}
    </div>
  )
}
