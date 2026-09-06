/**
 * Explicit consent step for permissions that send data somewhere new.
 *
 * A toggle that flips silently is not consent — the user has to be told what
 * categories of data move, where they go, and be able to decline without
 * changing anything. Requiring the acknowledgement checkbox keeps a stray click
 * on the switch from becoming a grant.
 *
 * ── THE HOUSE SHAPE (ADR 0112, census 102 row "Share this with the engine?") ─
 * SHAPE: `Panel`, ASSERTED and not sealed (the settings ruling of 2026-09-04).
 * It is a question the reader answers and leaves; a consent is asserted by
 * ticking the acknowledgement, and the wax is rationed to commitments that move
 * stock, money or a letter.
 *
 * The focus decision survives the move and is worth restating, because the
 * primitive would otherwise undo it: `initialFocusRef` is NOT pointed at the
 * confirm control. Landing on the affirmative action invites an Enter keypress
 * that skips the disclosure entirely, which is how a consent dialog becomes a
 * formality. Focus goes to the acknowledgement tick — the one control the
 * reader has to pass through on the way to granting anything.
 *
 * ── AN OPEN FORK, STATED RATHER THAN DEFAULTED ────────────────────────────
 * This dialog has exactly one opener: `ServicesPermissions.tsx:300`, which is
 * mounted only by the LEGACY settings page (pages/Settings.tsx:1262). The
 * rebuilt page's `ServicesSection.tsx` deliberately renders the same four
 * consents as records with NO switches, because nothing in any of the four
 * runtimes branches on them and ADR 0020 forbids a control whose effect does
 * not exist. So the house branch below is correct and unreachable: with the
 * settings flag on, the page that opens this is not on screen.
 *
 * It is built anyway, and the fork is raised rather than answered here: either
 * the rebuilt page gets a real consent control back (which requires something
 * to actually read the consent first), or this act is a deletion. Neither is a
 * builder's call. See the packet 1 report.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Check, X } from 'lucide-react'
import { Panel } from '../mudavym/Sheet'
import { useMudavymShell } from '../../lib/mudavym/shellGround'
import '../inventory/inventory-mudavym.css'

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
  const shell = useMudavymShell()
  const [acknowledged, setAcknowledged] = useState(false)
  const titleId = useId()
  const confirmRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const ackRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) setAcknowledged(false)
  }, [open, copy?.title])

  useEffect(() => {
    if (!open) return
    // The primitive owns focus, Esc and the opener's restoration for the house
    // branch. Running this effect there too would fight it for all three.
    if (shell.on) return

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
  }, [open, onCancel, shell.on])

  /* ── the house shape ───────────────────────────────────────────────────── */
  if (shell.on) {
    return (
      <Panel
        open={open && !!copy}
        onClose={onCancel}
        label={
          copy
            ? `${copy.title} Turning it on records your consent. Leaving it off changes nothing.`
            : 'Share this with the engine?'
        }
        eyebrow="Your account"
        title={copy?.title ?? 'Share this with the engine?'}
        closeLabel="Keep it off"
        initialFocusRef={ackRef}
        zIndex={120}
        footer={
          <span>
            You can withdraw this at any time from this page. Withdrawing is never gated.
          </span>
        }
      >
        {copy ? (
          <div className="mdv-form">
            <p className="mdv-contract">{copy.summary}</p>

            <div>
              <span className="mdv-head">
                <span>What gets shared</span>
              </span>
              <div className="mdv-lines">
                {copy.dataCategories.map((cat) => (
                  <div key={cat} className="mdv-line">
                    <span className="mdv-line__name">{cat}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <span className="mdv-head">
                <span>What never leaves</span>
              </span>
              <div className="mdv-lines">
                {copy.exclusions.map((ex) => (
                  <div key={ex} className="mdv-line">
                    <span className="mdv-line__name">{ex}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* The tick is the assertion. Focus lands here, not on the grant. */}
            <label className="mdv-pick" style={{ alignItems: 'flex-start' }}>
              <span style={{ minWidth: 0 }}>
                <span className="mdv-pick__label" style={{ whiteSpace: 'normal' }}>
                  {copy.acknowledgement}
                </span>
                <span className="mdv-pick__sub">
                  <Link to="/privacy" className="mdv-link" onClick={(e) => e.stopPropagation()}>
                    Read the privacy notice
                  </Link>
                </span>
              </span>
              <input
                ref={ackRef}
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
            </label>

            <div className="mdv-actions">
              <span className="mdv-tally">
                {acknowledged ? 'Acknowledged' : 'Not acknowledged yet'}
              </span>
              <button type="button" className="mdv-btn" onClick={onCancel}>
                Keep it off
              </button>
              <button
                ref={confirmRef}
                type="button"
                className="mdv-btn mdv-btn--seal"
                disabled={!acknowledged}
                onClick={onConfirm}
              >
                {copy.confirmLabel}
              </button>
            </div>
          </div>
        ) : (
          <p className="mdv-quiet">
            There is nothing to consent to here — no permission was named.
          </p>
        )}
      </Panel>
    )
  }

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
