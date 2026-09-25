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
import { useMudavymDesign } from '../../lib/mudavym/useMudavymDesign'
import './house-toast.css'

export function AppToaster() {
  const shellOn = useMudavymDesign('shell')

  if (shellOn) {
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

  // Legacy — unchanged from what App.tsx mounted before this file existed.
  return (
    <Toaster
      position="top-right"
      gap={12}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'flex items-center gap-3 w-full max-w-sm p-4 bg-white rounded-xl border border-slate-200 shadow-lg',
          title: 'text-sm font-semibold text-slate-900',
          description: 'text-sm text-slate-500',
          success: 'border-emerald-200 bg-emerald-50',
          error: 'border-rose-200 bg-rose-50',
          warning: 'border-amber-200 bg-amber-50',
          info: 'border-blue-200 bg-blue-50',
          actionButton:
            'px-3 py-1.5 text-sm font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800',
          cancelButton: 'px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900',
          closeButton: 'text-slate-400 hover:text-slate-600',
        },
      }}
      closeButton
      richColors
      expand={false}
    />
  )
}

export default AppToaster
