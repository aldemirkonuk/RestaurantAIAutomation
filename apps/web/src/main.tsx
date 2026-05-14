import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './styles/globals.css'
import { initGlobalErrorHandler } from './lib/global-error-handler'
import { initErrorTracking } from './lib/error-tracking'
import { startEmailScheduler } from './lib/email-scheduler'
import { startReminderScheduler } from './lib/reminder-scheduler'

// Initialize global error handler
initGlobalErrorHandler()
initErrorTracking()

// Start email scheduler (sends user-scheduled emails from localStorage only)
startEmailScheduler()

// Start reminder scheduler
startReminderScheduler()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
