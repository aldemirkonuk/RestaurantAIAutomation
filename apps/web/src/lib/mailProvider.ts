/**
 * Where a person's inbox is, from the address's domain (r105 onboarding g4).
 *
 * "Check your email" offers a button that opens the mail, as the sign-ups
 * people know do. Only the big webmail hosts are named; any other domain gets
 * no button rather than a guess. The domain must match whole: a subdomain or
 * a lookalike ("gmail.com.example", "notgmail.com") is not the host and gets
 * none. The link carries no address and no token.
 */

export interface InboxLink {
  provider: 'gmail' | 'outlook' | 'yahoo' | 'icloud'
  label: string
  href: string
}

const GMAIL: InboxLink = {
  provider: 'gmail',
  label: 'Open Gmail',
  href: 'https://mail.google.com/mail/u/0/#search/from%3Amudavym+newer_than%3A1d',
}
const OUTLOOK: InboxLink = {
  provider: 'outlook',
  label: 'Open Outlook',
  href: 'https://outlook.live.com/mail/',
}
const YAHOO: InboxLink = {
  provider: 'yahoo',
  label: 'Open Yahoo Mail',
  href: 'https://mail.yahoo.com/',
}
const ICLOUD: InboxLink = {
  provider: 'icloud',
  label: 'Open iCloud Mail',
  href: 'https://www.icloud.com/mail',
}

const BY_DOMAIN: Record<string, InboxLink> = {
  'gmail.com': GMAIL,
  'googlemail.com': GMAIL,
  'outlook.com': OUTLOOK,
  'hotmail.com': OUTLOOK,
  'live.com': OUTLOOK,
  'yahoo.com': YAHOO,
  'icloud.com': ICLOUD,
  'me.com': ICLOUD,
}

export function inboxLinkFor(email: string | null | undefined): InboxLink | null {
  if (!email) return null
  const at = email.lastIndexOf('@')
  if (at < 0) return null
  const domain = email.slice(at + 1).trim().toLowerCase()
  return Object.prototype.hasOwnProperty.call(BY_DOMAIN, domain) ? BY_DOMAIN[domain] : null
}
