/**
 * The second secret an invite mail carries (ADR 0229 fork 9; the founder,
 * 2026-09-27, item 77, "Email invite + (c) interim (Recommended)").
 *
 * The gateway mails an invite to the address it names, with a link of the
 * shape `/invite/<code>#k=<secret>`. The secret rides in the fragment, which
 * the browser never sends to any server (and `scrubUrl` cuts at `#` before
 * anything reaches Sentry). The invite page hands it on to `/register` the
 * same way, and the join sends it in its body: only a join that carries it,
 * with the invite's own address, creates a verified account. A copied link has
 * no fragment and joins unverified.
 */

const SECRET_SHAPE = /^[A-Za-z0-9_-]{16,128}$/

/** The secret in a location hash (`#k=...`), or undefined when there is none. */
export function readInviteMailSecret(hash: string | null | undefined): string | undefined {
  if (!hash) return undefined
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const secret = params.get('k')
  return secret && SECRET_SHAPE.test(secret) ? secret : undefined
}

/** `path` with the secret carried on as its fragment, when there is one. */
export function withInviteMailSecret(path: string, secret: string | undefined): string {
  return secret ? `${path}#k=${secret}` : path
}

/** What became of a freshly minted invite's mail, as the gateway reports it. */
export type InvitationEmailOutcome =
  | 'sent'
  | 'not_sent'
  | 'rate_limited'
  | 'rate_limited_sender'
  | 'rate_limited_address'
  | 'no_address'

/** One sentence on what became of the invite's mail (ADR 0229 fork 9, item 77). */
export function invitationEmailSentence(invite: {
  invitationEmail?: InvitationEmailOutcome
  sentTo?: string
}): string | null {
  switch (invite.invitationEmail) {
    case 'sent':
      return `We emailed this invite to ${invite.sentTo || 'the address you gave'}. Joining from that email confirms their address.`
    case 'rate_limited':
      return 'Not emailed: this house has sent as many invite emails as it may today. Share the link below; whoever joins from it confirms their address once.'
    // ADR 0229 fork 11 (the founder, 2026-09-28, item 83, "Per address + per
    // sender"): the invite is made, not mailed, and the minter is told which
    // allowance ran out.
    case 'rate_limited_sender':
      return 'Not emailed: you have sent as many invite emails as you may today, across your houses. Share the link below; whoever joins from it confirms their address once.'
    case 'rate_limited_address':
      return 'Not emailed: this address has received as many invite emails as it may today. Share the link below; whoever joins from it confirms their address once.'
    case 'not_sent':
      return 'We could not email this invite. Share the link below; whoever joins from it confirms their address once.'
    default:
      return null
  }
}
