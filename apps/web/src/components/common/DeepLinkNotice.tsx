/**
 * The words a page says when a deep link named something that is not here.
 *
 * ADR 0020: a surface that cannot answer says so. The failure mode this
 * replaces is worse than an error — the page rendered its ordinary, complete
 * self, so the reader concluded the link had worked and that the row they were
 * sent to look at simply did not stand out.
 *
 * `role="status"` rather than `role="alert"`: nothing is broken and nothing was
 * lost, so it must not interrupt a screen-reader mid-sentence.
 */

import { AlertCircle, X } from 'lucide-react'

export interface DeepLinkNoticeProps {
  message: string
  /** Clears the offending parameter. Omit to render a non-dismissable notice. */
  onDismiss?: () => void
  className?: string
}

export function DeepLinkNotice({ message, onDismiss, className = '' }: DeepLinkNoticeProps) {
  return (
    <div
      role="status"
      data-testid="deep-link-notice"
      className={`flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 ${className}`}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
      <p className="flex-1 text-sm text-amber-900">{message}</p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded p-1 text-amber-700 transition-colors hover:bg-amber-100"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

export default DeepLinkNotice
