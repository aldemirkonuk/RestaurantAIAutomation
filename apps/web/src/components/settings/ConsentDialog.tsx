/**
 * Explicit consent step for permissions that send data somewhere new.
 *
 * A toggle that flips silently is not consent — the user has to be told what
 * categories of data move, where they go, and be able to decline without
 * changing anything. Requiring the acknowledgement checkbox keeps a stray click
 * on the switch from becoming a grant.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Check, X } from 'lucide-react'

export interface ConsentCopy {
  title: string
  /** One sentence on what turning this on actually causes. */
  summary: string
  /** Concrete data categories that leave the app. */
  dataCategories: string[]
  /** Reassurances about what stays put. */
  exclusions: string[]
  acknowledgement: string
  confirmLabel: string
}

interface ConsentDialogProps {
  open: boolean
  copy: ConsentCopy | null
  onCancel: () => void
  onConfirm: () => void
}

export function ConsentDialog({ open, copy, onCancel, onConfirm }: ConsentDialogProps) {
  const [acknowledged, setAcknowledged] = useState(false)
  const titleId = useId()
  const confirmRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) setAcknowledged(false)
  }, [open, copy?.title])

  useEffect(() => {
    if (!open) return

    const previouslyFocused = document.activeElement as HTMLElement | null
    // Focus the dialog itself rather than Confirm — landing on the affirmative
    // action invites an Enter keypress that skips the disclosure entirely.
    dialogRef.current?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [open, onCancel])

  return createPortal(
    <AnimatePresence>
      {open && copy && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/40 px-4 backdrop-blur-sm"
          onClick={onCancel}
        >
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl outline-none"
          >
            <div className="flex items-start gap-3 border-b border-gray-100 px-6 py-5">
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="text-base font-semibold text-gray-900">
                  {copy.title}
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-gray-500">{copy.summary}</p>
              </div>
              <button
                type="button"
                onClick={onCancel}
                aria-label="Close"
                className="-mr-1.5 -mt-1 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-6 py-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                What gets shared
              </p>
              <ul className="mt-2.5 space-y-2">
                {copy.dataCategories.map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-wine-50">
                      <Check className="h-2.5 w-2.5 text-wine-600" strokeWidth={3} />
                    </span>
                    <span className="text-sm text-gray-700">{item}</span>
                  </li>
                ))}
              </ul>

              <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                What never leaves
              </p>
              <ul className="mt-2.5 space-y-2">
                {copy.exclusions.map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gray-100">
                      <X className="h-2.5 w-2.5 text-gray-500" strokeWidth={3} />
                    </span>
                    <span className="text-sm text-gray-600">{item}</span>
                  </li>
                ))}
              </ul>

              <label className="mt-5 flex cursor-pointer items-start gap-2.5 rounded-xl border border-gray-200 bg-gray-50/60 p-3.5">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-wine-600 focus:ring-wine-600/30"
                />
                <span className="text-[13px] leading-relaxed text-gray-700">
                  {copy.acknowledgement}{' '}
                  <Link
                    to="/privacy"
                    className="font-medium text-wine-600 hover:text-wine-700"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Read the privacy notice
                  </Link>
                  .
                </span>
              </label>
            </div>

            <div className="flex flex-col-reverse gap-2.5 border-t border-gray-100 px-6 py-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                Keep it off
              </button>
              <button
                ref={confirmRef}
                type="button"
                disabled={!acknowledged}
                onClick={onConfirm}
                className="rounded-xl bg-wine-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-wine-700 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {copy.confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
