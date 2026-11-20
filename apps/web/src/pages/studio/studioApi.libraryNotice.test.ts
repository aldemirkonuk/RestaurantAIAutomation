/**
 * libraryNotice: what a contributor or reviewer is told about the WINE after an override.
 *
 * QA round 5 (B-1, 2026-11-07): the orchestrator's library insert failed on every
 * promotion while FieldCell said "Override saved" and nothing more. The orchestrator
 * now reports `library`; this is the one place that turns it into words, and a
 * failure -- or an outcome it does not recognise -- must never read as success.
 */
import { describe, expect, it } from 'vitest'
import { libraryNotice } from './studioApi'

describe('libraryNotice', () => {
  it('says a failure as an error, with the server sentence', () => {
    const notice = libraryNotice({ library: 'failed', library_detail: 'Nothing was added.' })
    expect(notice).toEqual({
      tone: 'error',
      title: 'The wine did not reach the library',
      description: 'Nothing was added.',
    })
  })

  it('still words a failure when the server sentence is missing', () => {
    expect(libraryNotice({ library: 'failed' })?.description).toMatch(/Nothing was added/)
  })

  it('says a promotion as a success', () => {
    expect(libraryNotice({ library: 'promoted' })).toMatchObject({
      tone: 'success',
      title: 'Added to the wine library',
    })
  })

  it('says an existing wine plainly, not as an error', () => {
    expect(libraryNotice({ library: 'already_in_library' })?.tone).toBe('info')
  })

  it('says nothing while the wine still has fields to review, or when the server is silent', () => {
    expect(libraryNotice({ library: 'not_ready' })).toBeNull()
    expect(libraryNotice({})).toBeNull()
    expect(libraryNotice(undefined)).toBeNull()
  })

  it('never reads an outcome it does not know as success', () => {
    const notice = libraryNotice({ library: 'something_new' })
    expect(notice?.tone).toBe('error')
    expect(notice?.title).toMatch(/Could not tell/)
  })
})
