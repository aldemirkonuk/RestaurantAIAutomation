import { describe, expect, it } from 'vitest'
import { DOCUMENT_ACCEPT, IMAGE_ACCEPT, SCAN_ACCEPT } from './uploadAccept'

/**
 * PR #778: no picker names HEIC. Safari 17+ converts JPEG/PNG picks to HEIC
 * when the accept list names it, and the reader cannot open HEIC.
 */
describe('upload accept lists', () => {
  it.each([
    ['IMAGE_ACCEPT', IMAGE_ACCEPT],
    ['SCAN_ACCEPT', SCAN_ACCEPT],
    ['DOCUMENT_ACCEPT', DOCUMENT_ACCEPT],
  ])('%s does not name HEIC or HEIF', (_name, accept) => {
    expect(accept).not.toMatch(/heic|heif/i)
  })

  it('still takes any photo and a PDF', () => {
    expect(SCAN_ACCEPT.split(',')).toEqual(
      expect.arrayContaining(['image/*', '.jpg', '.png', 'application/pdf']),
    )
  })
})
