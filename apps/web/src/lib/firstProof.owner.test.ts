/**
 * r28 onboarding gap 7: the first proof lived in the tab with no owner. On a
 * shared tablet the next owner, or the same owner in another house, opened
 * /house and /house/menu on the first owner's lines. The proof now carries
 * the account and house of the session that read it, and only that session
 * reads it back.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  FIRST_PROOF_KEY,
  FIRST_PROOF_SOURCE_KEY,
  readProof,
  saveProofItems,
  writeProof,
} from './firstProof'

const b64url = (value: object) =>
  btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const signIn = (claims: Record<string, unknown>) =>
  localStorage.setItem('accessToken', `${b64url({ alg: 'HS256' })}.${b64url(claims)}.sig`)

const result = { menuId: 'm-A', itemsExtracted: 1, submissionsCreated: 0, items: [] }
const ownerA = { sub: 'user-A', restaurantId: 'house-A', email: 'a@example.test' }

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
})

describe('the first proof is the account’s and the house’s (gap 7)', () => {
  it('the session that read the menu reads it back, page image and all', () => {
    signIn(ownerA)
    expect(writeProof(result, 'data:image/png;base64,aaaa')).toBe(true)
    expect(readProof()?.menuId).toBe('m-A')
    expect(readProof()?.sourceImage).toBe('data:image/png;base64,aaaa')
  })

  it('another account in the same tab never sees it, and it is removed for good', () => {
    signIn(ownerA)
    writeProof(result, 'data:image/png;base64,aaaa')
    signIn({ ...ownerA, sub: 'user-B' })
    expect(readProof()).toBeNull()
    expect(sessionStorage.getItem(FIRST_PROOF_KEY)).toBeNull()
    expect(sessionStorage.getItem(FIRST_PROOF_SOURCE_KEY)).toBeNull()
    signIn(ownerA)
    expect(readProof()).toBeNull()
  })

  it('the same owner in another house does not see the first house’s proof', () => {
    signIn(ownerA)
    writeProof(result)
    signIn({ ...ownerA, restaurantId: 'house-B' })
    expect(readProof()).toBeNull()
  })

  it('a token refreshed for the same account and house still reads it', () => {
    signIn({ ...ownerA, iat: 1 })
    writeProof(result)
    signIn({ ...ownerA, iat: 2, exp: 3 })
    expect(readProof()?.menuId).toBe('m-A')
  })

  it('a proof kept before proofs had an owner is not shown to a signed-in session', () => {
    sessionStorage.setItem(FIRST_PROOF_KEY, JSON.stringify(result))
    signIn(ownerA)
    expect(readProof()).toBeNull()
  })

  it('placing a line rewrites only this session’s own proof', () => {
    signIn(ownerA)
    writeProof(result)
    signIn({ ...ownerA, sub: 'user-B' })
    saveProofItems([{ menuItemId: 'x', name: 'Rioja', category: 'red' } as never])
    expect(sessionStorage.getItem(FIRST_PROOF_KEY)).toBeNull()
    signIn(ownerA)
    writeProof(result)
    saveProofItems([{ menuItemId: 'x', name: 'Rioja', category: 'red' } as never])
    expect(readProof()?.items).toHaveLength(1)
  })

  it('a token that cannot be read gives no owner: never a match for a signed-in one', () => {
    localStorage.setItem('accessToken', 'not-a-token')
    writeProof(result)
    signIn(ownerA)
    expect(readProof()).toBeNull()
  })

  it('a token whose claims name no account or no house is no owner either', () => {
    signIn({ restaurantId: 'house-A' })
    writeProof(result)
    signIn(ownerA)
    expect(readProof()).toBeNull()
    signIn({ sub: 'user-A' })
    writeProof(result)
    signIn(ownerA)
    expect(readProof()).toBeNull()
  })

  it('two tokens that both lack the account still differ by house', () => {
    signIn({ restaurantId: 'house-A' })
    writeProof(result)
    signIn({ restaurantId: 'house-B' })
    expect(readProof()).toBeNull()
  })

  it('two tokens of the same house that both lack the account match by the house', () => {
    signIn({ restaurantId: 'house-A', iat: 1 })
    writeProof(result)
    signIn({ restaurantId: 'house-A', iat: 2 })
    expect(readProof()?.menuId).toBe('m-A')
  })

  it('reads a token whose claims use the URL-safe letters (- and _)', () => {
    // '?>>' and '~~~' encode to '/' and '+' in plain base64, '_' and '-' here.
    const claims = { ...ownerA, name: '?>>?>>~~~' }
    expect(b64url(claims)).toMatch(/[-_]/)
    signIn(claims)
    writeProof(result)
    signIn({ ...claims, sub: 'user-B' })
    expect(readProof()).toBeNull()
  })
})
