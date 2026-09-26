import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './styles/globals.css'
import { initGlobalErrorHandler } from './lib/global-error-handler'
import { initErrorTracking } from './lib/error-tracking'
import { startReminderScheduler } from './lib/reminder-scheduler'
import { registerServiceWorker } from './lib/register-sw'
import { applyDevAuthBypass } from './lib/devAuthBypass'

// Initialize global error handler
initGlobalErrorHandler()
initErrorTracking()

// The browser-side email scheduler (lib/email-scheduler.ts) is no longer
// started: it drained a localStorage queue nothing has written since
// 2026-05-14 into POST /notifications/send-email, which is closed (PR #410,
// ADR 0147). The house's mail is queued server-side by the Communications
// composer (POST /communications/letters).

// Start reminder scheduler
startReminderScheduler()

// PWA service worker (production builds)
registerServiceWorker()

// A no-op await outside dev-bypass mode (see the file for the full gate), so
// this does not delay a normal or production boot.
applyDevAuthBypass().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
})
