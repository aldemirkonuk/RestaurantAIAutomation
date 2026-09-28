/**
 * The one `<Toaster/>` mounted in App.tsx. GATED like every shell chrome
 * piece (`useMudavymDesign('shell')`, three layers): off, this renders the
 * exact `<Toaster/>` App.tsx always mounted, unstyled classNames and all —
 * legacy pages see byte-for-byte what they always did. On, it wears the
 * house tokens (`house-toast.css`) instead — eyebrow-weight title, a quieter
 * "what is not claimed" description line, no red/amber/emerald severity
 * colour (the rest of the shell tells success from refusal with words and
 * shapes, never a traffic light; ADR 0042).
 *
 * Either way it is the SAME physical `<Toaster/>` component — `sonner`'s own
 * ~30 direct callers (`toast.success(...)` etc.) and `useToast()`'s ~9
 * callers (`contexts/ToastContext.tsx`, which forwards to `sonner` only when
 * this same gate is on) land on it. One visual system.
 */

import { Toaster } from 'sonner'
import './house-toast.css'

export function AppToaster() {
  // [ADR 0149 cutover trial, 2026-09-28] The house Toaster only; the
  // `shell` gate and the legacy Toaster are gone.
  return (
      <Toaster
        className="mudavym mdv-toaster"
        position="top-right"
        gap={10}
        visibleToasts={3}
        toastOptions={{
          unstyled: true,
          classNames: {
            toast: 'mdv-toast',
            title: 'mdv-toast__title',
            description: 'mdv-toast__description',
            actionButton: 'mdv-toast__action',
            cancelButton: 'mdv-toast__cancel',
            closeButton: 'mdv-toast__close',
            icon: 'mdv-toast__icon',
          },
        }}
        closeButton
        expand={false}
      />
    )
}

export default AppToaster
