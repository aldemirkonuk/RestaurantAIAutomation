import { describe, expect, it } from 'vitest'
import { invitationEmailSentence, readInviteMailSecret, withInviteMailSecret } from './inviteMailSecret'

// ADR 0229 fork 9 (item 77): the invite mail's secret rides the fragment from
// /invite/<code> to /register and into the join body.
describe('invite mail secret', () => {
  const secret = 'Zx8_-abcdefghijklmnopqrstuvwxyz0123456789AB'

  it('reads the secret from a #k= fragment', () => {
    expect(readInviteMailSecret(`#k=${secret}`)).toBe(secret)
    expect(readInviteMailSecret(`k=${secret}`)).toBe(secret)
  })

  it('reads nothing from no fragment, an empty one, or a malformed one', () => {
    for (const h of [undefined, null, '', '#', '#k=', '#k=short', '#x=' + secret, '#k=has space in it here ok', '#k=<script>alert(1)</script>']) {
      expect(readInviteMailSecret(h)).toBeUndefined()
    }
  })

  it('carries the secret on as a fragment, and leaves the path alone without one', () => {
    expect(withInviteMailSecret('/register?invite=ABCDEFGH', secret)).toBe(
      `/register?invite=ABCDEFGH#k=${secret}`,
    )
    expect(withInviteMailSecret('/register?invite=ABCDEFGH', undefined)).toBe(
      '/register?invite=ABCDEFGH',
    )
  })
})

describe('invitationEmailSentence', () => {
  it('says where the invite was emailed, or why it was not, and nothing for no address', () => {
    expect(invitationEmailSentence({ invitationEmail: 'sent', sentTo: 'a@b.co' })).toBe(
      'We emailed this invite to a@b.co. Joining from that email confirms their address.',
    )
    expect(invitationEmailSentence({ invitationEmail: 'rate_limited' })).toMatch(/^Not emailed/)
    // ADR 0229 fork 11 (item 83): the minter is told which allowance ran out.
    expect(invitationEmailSentence({ invitationEmail: 'rate_limited_sender' })).toMatch(
      /^Not emailed: you have sent as many invite emails as you may today, across your houses\./,
    )
    expect(invitationEmailSentence({ invitationEmail: 'rate_limited_address' })).toMatch(
      /^Not emailed: this address has received as many invite emails as it may today\./,
    )
    expect(invitationEmailSentence({ invitationEmail: 'not_sent' })).toMatch(/^We could not email/)
    expect(invitationEmailSentence({ invitationEmail: 'no_address' })).toBeNull()
    expect(invitationEmailSentence({})).toBeNull()
  })
})
