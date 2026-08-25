import { useCallback, useEffect, useState, type MouseEvent } from 'react'

export interface ContextMenuPosition {
  x: number
  y: number
}

export interface ContextMenuState<T> {
  target: T
  x: number
  y: number
}

/**
 * Orders-style right-click menu state: open at cursor, close on outside click / Esc.
 */
export function useContextMenu<T>() {
  const [menu, setMenu] = useState<ContextMenuState<T> | null>(null)

  const close = useCallback(() => setMenu(null), [])

  const onContextMenu = useCallback((e: MouseEvent, target: T) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ target, x: e.clientX, y: e.clientY })
  }, [])

  useEffect(() => {
    if (!menu) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu, close])

  return {
    open: menu !== null,
    menu,
    position: menu ? { x: menu.x, y: menu.y } : null,
    target: menu?.target ?? null,
    onContextMenu,
    close,
    setMenu,
  }
}
