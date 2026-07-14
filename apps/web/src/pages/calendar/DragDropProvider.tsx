import { createContext, useContext, useState, useCallback, useRef, useEffect, ReactNode } from 'react'

// ==================== Types ====================

export type DragType = 'create' | 'move' | 'resize' | null

export interface DragState {
  isDragging: boolean
  dragType: DragType
  startDate: Date | null
  endDate: Date | null
  eventId?: string
  initialEventStart?: Date
  initialEventEnd?: Date
}

export interface DragDropContextValue {
  dragState: DragState
  dragPreview: { startDate: Date; endDate: Date } | null
  startDrag: (type: 'create' | 'move' | 'resize', initialDate: Date, eventId?: string, initialEventStart?: Date, initialEventEnd?: Date) => void
  updateDrag: (currentDate: Date) => void
  endDrag: () => void
  cancelDrag: () => void
}

interface DragDropProviderProps {
  children: ReactNode
  onCreateEvent: (start: Date, end: Date) => void
  onMoveEvent: (eventId: string, newStart: Date, newEnd: Date) => void
  onResizeEvent: (eventId: string, newEnd: Date) => void
}

// ==================== Context ====================

const DragDropContext = createContext<DragDropContextValue | undefined>(undefined)

export function useDragDrop() {
  const context = useContext(DragDropContext)
  if (!context) {
    throw new Error('useDragDrop must be used within DragDropProvider')
  }
  return context
}

// ==================== Provider ====================

export function DragDropProvider({
  children,
  onCreateEvent,
  onMoveEvent,
  onResizeEvent,
}: DragDropProviderProps) {
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    dragType: null,
    startDate: null,
    endDate: null,
  })

  const dragStartRef = useRef<Date | null>(null)
  const isPointerDownRef = useRef(false)
  // Calculate preview dates based on drag state
  const dragPreview = dragState.isDragging && dragState.startDate && dragState.endDate
    ? { startDate: dragState.startDate, endDate: dragState.endDate }
    : null

  // Start drag operation
  const startDrag = useCallback((
    type: 'create' | 'move' | 'resize',
    initialDate: Date,
    eventId?: string,
    initialEventStart?: Date,
    initialEventEnd?: Date
  ) => {
    dragStartRef.current = initialDate
    isPointerDownRef.current = true

    if (type === 'create') {
      // For create, start and end are the same initially
      setDragState({
        isDragging: true,
        dragType: 'create',
        startDate: initialDate,
        endDate: initialDate,
      })
    } else if (type === 'move') {
      if (!eventId || !initialEventStart || !initialEventEnd) {
        console.error('Move drag requires eventId, initialEventStart, and initialEventEnd')
        return
      }
      // Calculate offset from initial event start
      const offset = initialDate.getTime() - initialEventStart.getTime()
      const newStart = new Date(initialEventStart.getTime() + offset)
      const duration = initialEventEnd.getTime() - initialEventStart.getTime()
      const newEnd = new Date(newStart.getTime() + duration)

      setDragState({
        isDragging: true,
        dragType: 'move',
        startDate: newStart,
        endDate: newEnd,
        eventId,
        initialEventStart,
        initialEventEnd,
      })
    } else if (type === 'resize') {
      if (!eventId || !initialEventStart || !initialEventEnd) {
        console.error('Resize drag requires eventId, initialEventStart, and initialEventEnd')
        return
      }
      setDragState({
        isDragging: true,
        dragType: 'resize',
        startDate: initialEventStart,
        endDate: initialDate, // End date follows the cursor
        eventId,
        initialEventStart,
        initialEventEnd,
      })
    }
  }, [])

  // Update drag position
  const updateDrag = useCallback((currentDate: Date) => {
    if (!dragState.isDragging || !dragStartRef.current) return

    const currentTime = currentDate.getTime()
    const startTime = dragStartRef.current.getTime()

    if (dragState.dragType === 'create') {
      // For create, ensure endDate is always >= startDate
      if (currentTime >= startTime) {
        setDragState(prev => ({
          ...prev,
          endDate: currentDate,
        }))
      } else {
        // If dragging backwards, swap start and end
        setDragState(prev => ({
          ...prev,
          startDate: currentDate,
          endDate: prev.startDate!,
        }))
        dragStartRef.current = currentDate
      }
    } else if (dragState.dragType === 'move') {
      if (!dragState.initialEventStart || !dragState.initialEventEnd) return
      // Calculate offset from initial drag start
      const offset = currentTime - startTime
      const newStart = new Date(dragState.initialEventStart.getTime() + offset)
      const duration = dragState.initialEventEnd.getTime() - dragState.initialEventStart.getTime()
      const newEnd = new Date(newStart.getTime() + duration)

      setDragState(prev => ({
        ...prev,
        startDate: newStart,
        endDate: newEnd,
      }))
    } else if (dragState.dragType === 'resize') {
      if (!dragState.initialEventStart) return
      // Ensure endDate is always >= startDate
      if (currentTime >= dragState.initialEventStart.getTime()) {
        setDragState(prev => ({
          ...prev,
          endDate: currentDate,
        }))
      }
    }
  }, [dragState.isDragging, dragState.dragType, dragState.initialEventStart, dragState.initialEventEnd])

  // Cancel drag without triggering callback.
  // Declared before endDrag so it can be a stable dependency there (its own
  // deps are empty, so its identity never changes — safe to depend on).
  const cancelDrag = useCallback(() => {
    setDragState({
      isDragging: false,
      dragType: null,
      startDate: null,
      endDate: null,
    })
    dragStartRef.current = null
    isPointerDownRef.current = false
  }, [])

  // End drag and trigger callback
  const endDrag = useCallback(() => {
    if (!dragState.isDragging || !dragState.startDate || !dragState.endDate) {
      cancelDrag()
      return
    }

    const { dragType, eventId, startDate, endDate } = dragState

    // Ensure endDate >= startDate
    const finalStart = startDate.getTime() <= endDate.getTime() ? startDate : endDate
    const finalEnd = startDate.getTime() <= endDate.getTime() ? endDate : startDate

    if (dragType === 'create') {
      onCreateEvent(finalStart, finalEnd)
    } else if (dragType === 'move' && eventId) {
      onMoveEvent(eventId, finalStart, finalEnd)
    } else if (dragType === 'resize' && eventId) {
      onResizeEvent(eventId, finalEnd)
    }

    // Reset state
    setDragState({
      isDragging: false,
      dragType: null,
      startDate: null,
      endDate: null,
    })
    dragStartRef.current = null
    isPointerDownRef.current = false
  }, [dragState, onCreateEvent, onMoveEvent, onResizeEvent, cancelDrag])

  // Handle global pointer events for drag
  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (!isPointerDownRef.current) return

      // Get the element under the pointer
      const element = document.elementFromPoint(e.clientX, e.clientY)
      if (!element) return

      // Try to find a time slot element (calendar grid cell)
      const timeSlot = element.closest('[data-time-slot]')
      if (!timeSlot) return

      const dateStr = timeSlot.getAttribute('data-date')
      const hourStr = timeSlot.getAttribute('data-hour')
      const minuteStr = timeSlot.getAttribute('data-minute') || '0'

      if (dateStr && hourStr) {
        const [year, month, day] = dateStr.split('-').map(Number)
        const hour = parseInt(hourStr, 10)
        const minute = parseInt(minuteStr, 10)
        const date = new Date(year, month - 1, day, hour, minute)
        updateDrag(date)
      }
    }

    const handlePointerUp = () => {
      if (isPointerDownRef.current && dragState.isDragging) {
        endDrag()
      }
      isPointerDownRef.current = false
    }

    if (dragState.isDragging) {
      document.addEventListener('pointermove', handlePointerMove)
      document.addEventListener('pointerup', handlePointerUp)
      // Prevent text selection during drag
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'grabbing'
    }

    return () => {
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', handlePointerUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [dragState.isDragging, updateDrag, endDrag])

  const value: DragDropContextValue = {
    dragState,
    dragPreview,
    startDrag,
    updateDrag,
    endDrag,
    cancelDrag,
  }

  return <DragDropContext.Provider value={value}>{children}</DragDropContext.Provider>
}
