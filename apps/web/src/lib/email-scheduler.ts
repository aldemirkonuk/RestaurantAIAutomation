/**
 * Email Scheduler Service
 * Handles scheduled email sending using localStorage and periodic checks
 */

import axios from 'axios'

const API_URL = import.meta.env?.VITE_API_GATEWAY_URL || 'http://localhost:4000'
const SCHEDULED_EMAILS_KEY = 'wineops_scheduled_emails'

export interface ScheduledEmail {
  id: string
  to: string[]
  subject: string
  bodyHtml: string
  bodyText: string
  cc?: string[]
  bcc?: string[]
  scheduledAt: number // Unix timestamp in ms
  createdAt: number
  status: 'pending' | 'sent' | 'failed'
  error?: string
}

/**
 * Get all scheduled emails
 */
export function getScheduledEmails(): ScheduledEmail[] {
  try {
    const stored = localStorage.getItem(SCHEDULED_EMAILS_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

/**
 * Save scheduled emails
 */
function saveScheduledEmails(emails: ScheduledEmail[]): void {
  localStorage.setItem(SCHEDULED_EMAILS_KEY, JSON.stringify(emails))
}

/**
 * Schedule an email to be sent at a specific time
 */
export function scheduleEmail(
  to: string[],
  subject: string,
  bodyHtml: string,
  bodyText: string,
  delayMinutes: number,
  cc?: string[],
  bcc?: string[]
): ScheduledEmail {
  const scheduledAt = Date.now() + delayMinutes * 60 * 1000
  
  const email: ScheduledEmail = {
    id: `email_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    to,
    subject,
    bodyHtml,
    bodyText,
    cc,
    bcc,
    scheduledAt,
    createdAt: Date.now(),
    status: 'pending',
  }
  
  const emails = getScheduledEmails()
  emails.push(email)
  saveScheduledEmails(emails)
  
  console.log(`📧 Email scheduled for ${new Date(scheduledAt).toLocaleTimeString()}`)
  
  return email
}

/**
 * Send an email via the API
 */
async function sendEmail(email: ScheduledEmail): Promise<boolean> {
  try {
    const response = await axios.post(`${API_URL}/api/v1/notifications/send-email`, {
      to: email.to,
      subject: email.subject,
      body_html: email.bodyHtml,
      body_text: email.bodyText,
      cc: email.cc,
      bcc: email.bcc,
    })
    
    return response.data.success
  } catch (error) {
    console.error('Failed to send scheduled email:', error)
    return false
  }
}

/**
 * Check and send due emails
 */
export async function checkAndSendDueEmails(): Promise<void> {
  const emails = getScheduledEmails()
  const now = Date.now()
  let updated = false
  
  for (const email of emails) {
    if (email.status === 'pending' && email.scheduledAt <= now) {
      console.log(`📧 Sending scheduled email: ${email.subject}`)
      
      const success = await sendEmail(email)
      email.status = success ? 'sent' : 'failed'
      if (!success) {
        email.error = 'Failed to send email'
      }
      updated = true
      
      // Show notification
      if (success) {
        showNotification('Email Sent', `"${email.subject}" sent to ${email.to.join(', ')}`)
      }
    }
  }
  
  if (updated) {
    saveScheduledEmails(emails)
  }
}

/**
 * Show browser notification
 */
function showNotification(title: string, body: string): void {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body, icon: '/wine-icon.png' })
  }
}

/**
 * Cancel a scheduled email
 */
export function cancelScheduledEmail(emailId: string): boolean {
  const emails = getScheduledEmails()
  const index = emails.findIndex(e => e.id === emailId)
  
  if (index !== -1 && emails[index].status === 'pending') {
    emails.splice(index, 1)
    saveScheduledEmails(emails)
    return true
  }
  
  return false
}

/**
 * Get pending scheduled emails
 */
export function getPendingEmails(): ScheduledEmail[] {
  return getScheduledEmails().filter(e => e.status === 'pending')
}

/**
 * Start the email scheduler (call this on app init)
 */
let schedulerInterval: NodeJS.Timeout | null = null

export function startEmailScheduler(): void {
  if (schedulerInterval) return
  
  // Check every 30 seconds
  schedulerInterval = setInterval(() => {
    checkAndSendDueEmails()
  }, 30000)
  
  // Also check immediately
  checkAndSendDueEmails()
  
  console.log('📧 Email scheduler started')
}

export function stopEmailScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval)
    schedulerInterval = null
    console.log('📧 Email scheduler stopped')
  }
}

/**
 * Schedule a test email. Set `VITE_SCHEDULED_TEST_EMAIL` (comma-separated) or this is a no-op.
 */
export function scheduleTestEmail(): ScheduledEmail | null {
  const raw = import.meta.env.VITE_SCHEDULED_TEST_EMAIL as string | undefined
  const to = raw?.split(',').map(e => e.trim()).filter(e => e) ?? []
  if (to.length === 0) {
    return null
  }
  const testHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>WineOps Test Email</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f3f4f6;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
    <div style="background: linear-gradient(135deg, #7c2d12 0%, #991b1b 100%); padding: 40px 30px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">🍷 WineOps AI</h1>
      <p style="color: rgba(255, 255, 255, 0.9); margin: 10px 0 0 0; font-size: 14px;">Scheduled Email Test</p>
    </div>
    <div style="padding: 40px 30px;">
      <h2 style="color: #1f2937; font-size: 24px; margin: 0 0 20px 0;">Test Email - Scheduled Send</h2>
      <p style="color: #374151; font-size: 16px; line-height: 1.6;">
        This is a test email that was scheduled to be sent 20 minutes after creation.
      </p>
      <p style="color: #374151; font-size: 16px; line-height: 1.6;">
        If you received this, the email scheduling system is working correctly! 🎉
      </p>
      <div style="margin-top: 30px; padding: 20px; background-color: #f9fafb; border-radius: 12px;">
        <p style="color: #6b7280; font-size: 14px; margin: 0;">
          <strong>Sent at:</strong> ${new Date(Date.now() + 20 * 60 * 1000).toLocaleString()}
        </p>
      </div>
    </div>
    <div style="background-color: #f3f4f6; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
      <p style="color: #9ca3af; font-size: 12px; margin: 0;">© ${new Date().getFullYear()} WineOps AI</p>
    </div>
  </div>
</body>
</html>
  `
  
  return scheduleEmail(
    to,
    'WineOps AI - Scheduled Test Email',
    testHtml,
    'This is a test email scheduled to be sent 20 minutes after creation.',
    20 // 20 minutes
  )
}
