import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './styles/globals.css'
import { initGlobalErrorHandler } from './lib/global-error-handler'
import { initErrorTracking } from './lib/error-tracking'
import { startEmailScheduler, scheduleTestEmail, getPendingEmails } from './lib/email-scheduler'
import { startReminderScheduler } from './lib/reminder-scheduler'

// Initialize global error handler
initGlobalErrorHandler()
initErrorTracking()

// Start email scheduler
startEmailScheduler()

// Start reminder scheduler
startReminderScheduler()

// Schedule the test email if not already scheduled
const pendingEmails = getPendingEmails()
const hasTestEmail = pendingEmails.some(e => e.to.includes('aldemirkonuk2004@gmail.com'))
if (!hasTestEmail) {
  const scheduled = scheduleTestEmail()
  console.log(`📧 Test email scheduled for: ${new Date(scheduled.scheduledAt).toLocaleString()}`)
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
