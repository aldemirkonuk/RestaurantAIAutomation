import { describe, expect, it } from 'vitest'
import { suggestAskMode } from './ask-mode'

describe('suggestAskMode — a suggestion from the words, never a decision', () => {
  it.each([
    'reorder 6 bottles of the Barolo',
    'Re-order the house red',
    'please draft a follow-up to Acme about the late delivery',
    'can you reorder the Barolo?',
    'send Acme a note about the late crate',
    'chase the Kermit order',
  ])('reads %j as a request to propose', (t) => {
    expect(suggestAskMode(t)).toBe('propose')
  })

  it.each([
    'how much of the house red do we have',
    'What arrives today',
    'which orders are late?',
    'the Barolo, is it low?',
  ])('reads %j as a question for the books', (t) => {
    expect(suggestAskMode(t)).toBe('ask')
  })

  it.each(['', 'hi', 'Barolo 2019', 'house red'])('suggests nothing for %j', (t) => {
    expect(suggestAskMode(t)).toBeNull()
  })
})
