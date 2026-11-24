import { describe, expect, it } from 'vitest'
import { inboxLinkFor } from './mailProvider'

describe('inboxLinkFor', () => {
  it.each([
    ['a@gmail.com', 'https://mail.google.com/mail/u/0/#search/from%3Amudavym+newer_than%3A1d'],
    ['a@googlemail.com', 'https://mail.google.com/mail/u/0/#search/from%3Amudavym+newer_than%3A1d'],
    ['a@outlook.com', 'https://outlook.live.com/mail/'],
    ['a@hotmail.com', 'https://outlook.live.com/mail/'],
    ['a@live.com', 'https://outlook.live.com/mail/'],
    ['a@yahoo.com', 'https://mail.yahoo.com/'],
    ['a@icloud.com', 'https://www.icloud.com/mail'],
    ['a@me.com', 'https://www.icloud.com/mail'],
  ])('%s opens %s', (email, href) => {
    expect(inboxLinkFor(email)?.href).toBe(href)
  })

  it('matches the domain whatever its case or the padding', () => {
    expect(inboxLinkFor('Deniz@GMAIL.Com')?.provider).toBe('gmail')
    expect(inboxLinkFor('deniz@Hotmail.com ')?.provider).toBe('outlook')
  })

  it('gives no link for a subdomain, a lookalike or an unknown domain', () => {
    for (const e of [
      'a@mail.google.com',
      'a@gmail.com.example.org',
      'a@notgmail.com',
      'a@house.test',
      'a@toString',
      'a@__proto__',
    ])
      expect(inboxLinkFor(e)).toBeNull()
  })

  it('gives no link for a missing or malformed address', () => {
    for (const e of [null, undefined, '', 'no-at-sign']) expect(inboxLinkFor(e)).toBeNull()
  })

  it('carries no address and no token in any link', () => {
    for (const e of ['a@gmail.com', 'a@outlook.com', 'a@yahoo.com', 'a@icloud.com'])
      expect(inboxLinkFor(e)?.href).not.toMatch(/a%40|a@|token/)
  })
})
