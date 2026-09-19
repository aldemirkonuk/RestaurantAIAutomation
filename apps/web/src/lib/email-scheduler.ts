/**
 * Email Scheduler Service
 * Handles scheduled email sending using localStorage and periodic checks.
 *
 * WHOSE QUEUE (2026-09-17, notify-lane review minor 4). Since `sendHouseEmail`
 * carries the session token, a due entry really sends — as whoever is signed
 * in when it comes due. So the queue is KEYED by the person and the house the
 * token names (`sub`, `restaurantId`, the same claims the gateway checks), a
 * tick sends only the signed-in owner's entries, and a session that changes
 * mid-send puts the rest back rather than sending them as someone else. The
 * old unkeyed `wineops_scheduled_emails` queue has no owner and is never sent.
 *
 * ONE SEND PER ENTRY. An entry is marked `sending` and saved BEFORE the
 * request is awaited, so an overlapping tick or another tab reading storage
 * skips it. Ticks in one tab do not overlap, and where the Web Locks API
 * exists one tab at a time runs a tick. An entry left `sending` (the tab
 * closed mid-request) is marked failed after `STALE_SENDING_MS` and is NOT
 * resent: whether it left is unknown, and a second copy is worse than none.
 * Without Web Locks two tabs can still both read a `pending` entry in the
 * same instant; the window is the few milliseconds between read and save.
 */

import { sendHouseEmail, houseEmailRefusal } from '../services/api/notifications'

/** The pre-2026-09-17 unkeyed queue. Never read for sending. */
export const UNOWNED_QUEUE_KEY = 'wineops_scheduled_emails'
const QUEUE_KEY_PREFIX = 'mudavym_scheduled_emails'
const STALE_SENDING_MS = 10 * 60 * 1000

export interface QueueOwner {
  userId: string
  restaurantId: string
}

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
  status: 'pending' | 'sending' | 'sent' | 'failed'
  /** When the entry was claimed for sending. */
  sendingSince?: number
  /** Who scheduled it, and for which house. */
  ownerUserId: string
  ownerRestaurantId: string
  error?: string
}

/**
 * The person and house the current session token names, or null when there is
 * no readable token. Read from the token, not from `activeRestaurantId`: the
 * gateway decides the house from the token.
 */
export function currentQueueOwner(): QueueOwner | null {
  try {
    const token = localStorage.getItem('accessToken')
    const part = token?.split('.')[1]
    if (!part) return null
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const payload = JSON.parse(atob(padded)) as {
      sub?: unknown
      restaurantId?: unknown
    }
    const userId = typeof payload.sub === 'string' ? payload.sub : ''
    const restaurantId =
      typeof payload.restaurantId === 'string' ? payload.restaurantId : ''
    return userId && restaurantId ? { userId, restaurantId } : null
  } catch {
    return null
  }
}

function queueKey(owner: QueueOwner): string {
  return `${QUEUE_KEY_PREFIX}:${owner.userId}:${owner.restaurantId}`
}

function sameOwner(a: QueueOwner | null, b: QueueOwner): boolean {
  return !!a && a.userId === b.userId && a.restaurantId === b.restaurantId
}

function readQueue(owner: QueueOwner): ScheduledEmail[] {
  try {
    const stored = localStorage.getItem(queueKey(owner))
    const list = stored ? (JSON.parse(stored) as ScheduledEmail[]) : []
    // Belt and braces: an entry that names another owner is never ours.
    return Array.isArray(list)
      ? list.filter(
          (e) =>
            e.ownerUserId === owner.userId &&
            e.ownerRestaurantId === owner.restaurantId,
        )
      : []
  } catch {
    return []
  }
}

function saveQueue(owner: QueueOwner, emails: ScheduledEmail[]): void {
  localStorage.setItem(queueKey(owner), JSON.stringify(emails))
}

/**
 * The signed-in owner's scheduled emails (none when nobody is signed in).
 */
export function getScheduledEmails(): ScheduledEmail[] {
  const owner = currentQueueOwner()
  return owner ? readQueue(owner) : []
}

/**
 * Schedule an email to be sent at a specific time, as the signed-in person
 * for the signed-in house. Throws when there is no session to own it.
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
  const owner = currentQueueOwner()
  if (!owner) {
    throw new Error(
      'No signed-in house, so an email cannot be scheduled on nobody\'s behalf.',
    )
  }
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
    ownerUserId: owner.userId,
    ownerRestaurantId: owner.restaurantId,
  }

  const emails = readQueue(owner)
  emails.push(email)
  saveQueue(owner, emails)

  console.log(`Email scheduled for ${new Date(scheduledAt).toLocaleTimeString()}`)

  return email
}

/**
 * Send an email via the API
 */
async function sendEmail(
  email: ScheduledEmail,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await sendHouseEmail({
      to: email.to,
      subject: email.subject,
      body_html: email.bodyHtml,
      body_text: email.bodyText,
      cc: email.cc,
      bcc: email.bcc,
    })
    return { ok: true }
  } catch (error) {
    console.error('Failed to send scheduled email:', error)
    // The gateway's own sentence (e.g. an address outside the house's book),
    // kept on the entry instead of a generic "Failed to send email".
    return { ok: false, error: houseEmailRefusal(error) }
  }
}

/** One tick at a time in this tab. */
let tickRunning = false

/**
 * Check and send the signed-in owner's due emails.
 */
export async function checkAndSendDueEmails(): Promise<void> {
  if (tickRunning) return
  tickRunning = true
  try {
    const owner = currentQueueOwner()
    if (!owner) return
    const locks = (
      typeof navigator !== 'undefined'
        ? (navigator as Navigator & { locks?: LockManager }).locks
        : undefined
    )
    if (locks?.request) {
      await locks.request(
        `${QUEUE_KEY_PREFIX}:tick`,
        { ifAvailable: true },
        async (lock) => {
          if (lock) await sendDue(owner)
        },
      )
    } else {
      await sendDue(owner)
    }
  } finally {
    tickRunning = false
  }
}

async function sendDue(owner: QueueOwner): Promise<void> {
  const now = Date.now()

  // Claim every due entry, and retire stale claims, in ONE read-modify-save
  // with no await in between.
  const emails = readQueue(owner)
  const claimed: string[] = []
  let changed = false
  for (const email of emails) {
    if (
      email.status === 'sending' &&
      (email.sendingSince ?? 0) + STALE_SENDING_MS <= now
    ) {
      email.status = 'failed'
      email.error =
        'The send was interrupted before its outcome was known, so it was not retried (a second copy could reach the recipient).'
      delete email.sendingSince
      changed = true
    } else if (email.status === 'pending' && email.scheduledAt <= now) {
      email.status = 'sending'
      email.sendingSince = now
      claimed.push(email.id)
      changed = true
    }
  }
  if (changed) saveQueue(owner, emails)

  for (let i = 0; i < claimed.length; i++) {
    const id = claimed[i]
    const entry = readQueue(owner).find((e) => e.id === id)
    if (!entry || entry.status !== 'sending') continue

    // The token decides who sends. If the session changed since the claim,
    // put this and every later claim back instead of sending as someone else.
    if (!sameOwner(currentQueueOwner(), owner)) {
      const latest = readQueue(owner)
      for (const e of latest) {
        if (claimed.slice(i).includes(e.id) && e.status === 'sending') {
          e.status = 'pending'
          delete e.sendingSince
        }
      }
      saveQueue(owner, latest)
      return
    }

    console.log(`Sending scheduled email: ${entry.subject}`)
    const result = await sendEmail(entry)

    const latest = readQueue(owner)
    const target = latest.find((e) => e.id === id)
    if (!target) continue
    target.status = result.ok ? 'sent' : 'failed'
    delete target.sendingSince
    if (!result.ok) target.error = result.error
    saveQueue(owner, latest)

    if (result.ok) {
      showNotification('Email Sent', `"${entry.subject}" sent to ${entry.to.join(', ')}`)
    }
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
 * Cancel one of the signed-in owner's pending scheduled emails
 */
export function cancelScheduledEmail(emailId: string): boolean {
  const owner = currentQueueOwner()
  if (!owner) return false
  const emails = readQueue(owner)
  const index = emails.findIndex(e => e.id === emailId)

  if (index !== -1 && emails[index].status === 'pending') {
    emails.splice(index, 1)
    saveQueue(owner, emails)
    return true
  }

  return false
}

/**
 * Get the signed-in owner's pending scheduled emails
 */
export function getPendingEmails(): ScheduledEmail[] {
  return getScheduledEmails().filter(e => e.status === 'pending')
}

/**
 * Start the email scheduler (call this on app init)
 */
let schedulerInterval: ReturnType<typeof setInterval> | null = null

export function startEmailScheduler(): void {
  if (schedulerInterval) return

  // Check every 30 seconds
  schedulerInterval = setInterval(() => {
    void checkAndSendDueEmails()
  }, 30000)

  // Also check immediately
  void checkAndSendDueEmails()

  console.log('Email scheduler started')
}

export function stopEmailScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval)
    schedulerInterval = null
    console.log('Email scheduler stopped')
  }
}

/**
 * Schedule a test email. Set `VITE_SCHEDULED_TEST_EMAIL` (comma-separated) or this is a no-op;
 * also a no-op with nobody signed in, since the queue belongs to a person and a house.
 */
export function scheduleTestEmail(): ScheduledEmail | null {
  const raw = import.meta.env.VITE_SCHEDULED_TEST_EMAIL as string | undefined
  const to = raw?.split(',').map(e => e.trim()).filter(e => e) ?? []
  if (to.length === 0 || !currentQueueOwner()) {
    return null
  }
  const testHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Mudavym Test Email</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f3f4f6;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
    <div style="background: linear-gradient(135deg, #7c2d12 0%, #991b1b 100%); padding: 40px 30px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">🍷 Mudavym</h1>
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
      <p style="color: #9ca3af; font-size: 12px; margin: 0;">© ${new Date().getFullYear()} Mudavym</p>
    </div>
  </div>
</body>
</html>
  `
  
  return scheduleEmail(
    to,
    'Mudavym - Scheduled Test Email',
    testHtml,
    'This is a test email scheduled to be sent 20 minutes after creation.',
    20 // 20 minutes
  )
}
