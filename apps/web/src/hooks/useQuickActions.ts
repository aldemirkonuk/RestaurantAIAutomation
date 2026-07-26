import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  createDefaultQuickActionsState,
  isValidQuickActionHref,
  loadQuickActionsState,
  MAX_CUSTOM_QUICK_ACTIONS,
  resolveQuickActions,
  saveQuickActionsState,
  type CustomQuickAction,
  type QuickActionsState,
  type ResolvedQuickAction,
} from '../data/quickActions'
import { useUserPreferences } from './useUserPreferences'

function customId(): string {
  return `custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

export function useQuickActions() {
  const { preferences, updatePreferences } = useUserPreferences()
  const [state, setState] = useState<QuickActionsState>(() => loadQuickActionsState())
  const hydratedFromPrefs = useRef(false)
  const skipNextPersist = useRef(false)

  // Hydrate from remote prefs once if present
  useEffect(() => {
    if (hydratedFromPrefs.current) return
    const remote = preferences.quickActions as QuickActionsState | undefined
    if (remote && Array.isArray(remote.order)) {
      hydratedFromPrefs.current = true
      skipNextPersist.current = true
      setState({
        order: remote.order,
        hiddenBuiltin: Array.isArray(remote.hiddenBuiltin) ? remote.hiddenBuiltin : [],
        custom: Array.isArray(remote.custom) ? remote.custom : [],
      })
      saveQuickActionsState(remote as QuickActionsState)
    } else {
      hydratedFromPrefs.current = true
    }
  }, [preferences.quickActions])

  useEffect(() => {
    if (!hydratedFromPrefs.current) return
    if (skipNextPersist.current) {
      skipNextPersist.current = false
      return
    }
    saveQuickActionsState(state)
    const t = window.setTimeout(() => {
      updatePreferences({ quickActions: state })
    }, 500)
    return () => window.clearTimeout(t)
  }, [state, updatePreferences])

  const actions = useMemo(() => resolveQuickActions(state), [state])

  const persist = useCallback((updater: (prev: QuickActionsState) => QuickActionsState) => {
    setState((prev) => updater(prev))
  }, [])

  const addCustom = useCallback(
    (input: { title: string; href: string; icon?: string; color?: string; description?: string }) => {
      if (!input.title.trim() || !isValidQuickActionHref(input.href.trim())) {
        toast.error('Title and a valid URL (starting with / or https://) are required')
        return false
      }
      if (state.custom.length >= MAX_CUSTOM_QUICK_ACTIONS) {
        toast.error(`You can add up to ${MAX_CUSTOM_QUICK_ACTIONS} custom actions`)
        return false
      }
      const action: CustomQuickAction = {
        id: customId(),
        kind: 'custom',
        title: input.title.trim(),
        href: input.href.trim(),
        icon: input.icon || 'Zap',
        color: input.color,
        description: input.description?.trim(),
      }
      persist((prev) => ({
        ...prev,
        custom: [...prev.custom, action],
        order: [...prev.order, action.id],
      }))
      toast.success('Quick action saved')
      return true
    },
    [persist, state.custom.length],
  )

  const updateCustom = useCallback(
    (
      id: string,
      input: { title: string; href: string; icon?: string; color?: string; description?: string },
    ) => {
      if (!input.title.trim() || !isValidQuickActionHref(input.href.trim())) {
        toast.error('Title and a valid URL (starting with / or https://) are required')
        return false
      }
      persist((prev) => ({
        ...prev,
        custom: prev.custom.map((c) =>
          c.id === id
            ? {
                ...c,
                title: input.title.trim(),
                href: input.href.trim(),
                icon: input.icon || c.icon,
                color: input.color ?? c.color,
                description: input.description?.trim(),
              }
            : c,
        ),
      }))
      toast.success('Quick action updated')
      return true
    },
    [persist],
  )

  const removeCustom = useCallback(
    (id: string, opts?: { silent?: boolean }) => {
      let removed: CustomQuickAction | undefined
      let removedIndex = -1
      persist((prev) => {
        removed = prev.custom.find((c) => c.id === id)
        removedIndex = prev.order.indexOf(id)
        return {
          ...prev,
          custom: prev.custom.filter((c) => c.id !== id),
          order: prev.order.filter((oid) => oid !== id),
        }
      })
      if (removed && !opts?.silent) {
        const snapshot = removed
        const index = removedIndex
        toast.success(`Removed ${snapshot.title}`, {
          action: {
            label: 'Undo',
            onClick: () => {
              persist((prev) => {
                if (prev.custom.some((c) => c.id === snapshot.id)) return prev
                const order = [...prev.order]
                if (index >= 0 && index <= order.length) {
                  order.splice(index, 0, snapshot.id)
                } else {
                  order.push(snapshot.id)
                }
                return { ...prev, custom: [...prev.custom, snapshot], order }
              })
            },
          },
        })
      }
    },
    [persist],
  )

  const hideBuiltin = useCallback(
    (key: string) => {
      persist((prev) => ({
        ...prev,
        hiddenBuiltin: prev.hiddenBuiltin.includes(key)
          ? prev.hiddenBuiltin
          : [...prev.hiddenBuiltin, key],
      }))
      toast.success('Hidden from Quick Actions')
    },
    [persist],
  )

  const moveAction = useCallback(
    (id: string, direction: 'up' | 'down') => {
      persist((prev) => {
        const visible = resolveQuickActions(prev).map((a) => a.id)
        const vi = visible.indexOf(id)
        if (vi < 0) return prev
        const swapWith = direction === 'up' ? vi - 1 : vi + 1
        if (swapWith < 0 || swapWith >= visible.length) return prev
        const a = visible[vi]
        const b = visible[swapWith]
        const order = [...prev.order]
        const ai = order.indexOf(a)
        const bi = order.indexOf(b)
        if (ai < 0 || bi < 0) return prev
        ;[order[ai], order[bi]] = [order[bi], order[ai]]
        return { ...prev, order }
      })
    },
    [persist],
  )

  const resetDefaults = useCallback(() => {
    setState(createDefaultQuickActionsState())
    toast.success('Quick Actions reset to defaults')
  }, [])

  const getCustom = useCallback(
    (id: string) => state.custom.find((c) => c.id === id),
    [state.custom],
  )

  return {
    actions: actions as ResolvedQuickAction[],
    state,
    addCustom,
    updateCustom,
    removeCustom,
    hideBuiltin,
    moveAction,
    resetDefaults,
    getCustom,
  }
}
