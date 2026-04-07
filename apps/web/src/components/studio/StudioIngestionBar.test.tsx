// @vitest-environment node
/**
 * Vitest unit tests for CommandBar ingestion type detection logic (DEVUI-02).
 *
 * Tests the pure detectIngestionType function without rendering.
 * The actual CommandBar.tsx uses: detectIngestionType(value: string, hasPdfFile: boolean)
 * Logic is copied inline for test isolation per plan instructions.
 */
import { describe, it, expect } from 'vitest'

type IngestionType = 'pdf' | 'url' | 'manual' | null

function detectIngestionType(value: string, hasPdfFile: boolean): IngestionType {
  if (hasPdfFile) return 'pdf'
  if (/^https?:\/\//i.test(value.trim())) return 'url'
  if (value.trim().length > 0) return 'manual'
  return null
}

describe('detectIngestionType', () => {
  it('returns null for empty input with no file', () => {
    expect(detectIngestionType('', false)).toBeNull()
  })

  it('returns "url" for http:// prefixed input', () => {
    expect(detectIngestionType('http://restaurant.com/menu', false)).toBe('url')
  })

  it('returns "url" for https:// prefixed input', () => {
    expect(detectIngestionType('https://restaurant.com/wine-list', false)).toBe('url')
  })

  it('returns "manual" for plain text that is not a URL', () => {
    expect(detectIngestionType('Château Margaux', false)).toBe('manual')
  })

  it('returns null for whitespace-only input with no file', () => {
    expect(detectIngestionType('   ', false)).toBeNull()
  })

  it('is case-insensitive for URL detection (HTTP uppercase)', () => {
    expect(detectIngestionType('HTTP://example.com', false)).toBe('url')
  })
})
