import { describe, expect, it } from 'vitest'
import { PHOTO_COUNT_DOWN, PHOTO_COUNT_OFF, namesTheOperator, photoRefusalWords } from './modelRefusalWords'

describe("a photo reader's refusal, in the house's words", () => {
  it('the gateway\'s missing-key sentence never reaches the toast', () => {
    for (const raw of [
      'Anthropic API key not configured — set ANTHROPIC_API_KEY',
      'ANTHROPIC_API_KEY is not configured',
    ]) {
      expect(namesTheOperator(raw)).toBe(true)
      expect(photoRefusalWords(raw)).toBe(PHOTO_COUNT_OFF)
    }
  })

  it('a vendor outage or exhausted credit says try again later, never "not switched on"', () => {
    for (const raw of [
      'Anthropic 529: Overloaded',
      'Anthropic 400: Your credit balance is too low to access the Anthropic API',
      'Anthropic 500: Internal server error',
    ]) {
      expect(namesTheOperator(raw)).toBe(true)
      expect(photoRefusalWords(raw)).toBe(PHOTO_COUNT_DOWN)
      expect(photoRefusalWords(raw)).not.toMatch(/anthropic|credit/i)
    }
  })

  it("#1095's own house wording passes through unchanged", () => {
    expect(photoRefusalWords('counting from a photo is not switched on here yet')).toBe(PHOTO_COUNT_OFF)
  })

  it('a refusal a house can act on is kept as it came', () => {
    expect(photoRefusalWords('the photo is too dark to count')).toBe('the photo is too dark to count')
    expect(photoRefusalWords('The photo is too dark to count.')).toBe('The photo is too dark to count')
  })

  it('no message at all still says something', () => {
    expect(photoRefusalWords(undefined)).toBe('the photo could not be read')
    expect(photoRefusalWords('  ')).toBe('the photo could not be read')
  })
})
