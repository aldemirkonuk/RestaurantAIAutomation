/**
 * CalendarModular — routes the fully-built modular calendar (`pages/calendar/*`)
 * that ships Week/Day views, drag-move/resize, click-slot-to-create, true event
 * editing, RRULE recurrence, multi-channel reminders, and meeting-memo capture
 * (UX_PATHS_CATALOG.md NEW-384…NEW-393, NEW-400). Previously built but unrouted.
 *
 * Wrapped with the app Header and a bounded-height flex column so the calendar's
 * internal `h-full` / `overflow-hidden` scroll regions resolve correctly.
 */

import { Header } from '../components/layout/Header'
import CalendarPage from './calendar/CalendarPage'

export default function CalendarModular() {
  return (
    <div className="flex flex-col h-screen">
      <Header
        title="Calendar"
        subtitle="Schedule, deliveries, tastings, and reminders"
      />
      <div className="flex-1 min-h-0">
        <CalendarPage />
      </div>
    </div>
  )
}
