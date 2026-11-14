/**
 * `attachPaper` against the three answers the document door can give a paper
 * attached to a price (QA on PR #775): a new paper, the same bytes already on
 * file, and a paper whose vendor + number is already on file — where the door
 * stores nothing and answers with the EARLIER paper's id.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PaperAlreadyOnFileError, attachPaper } from './vendorIntel'
import { apiClient } from './client'

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client')
  return { ...actual, apiClient: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }
})

const http = vi.mocked(apiClient) as unknown as { post: ReturnType<typeof vi.fn> }
const PARAMS = { contentBase64: 'eA==', filename: 'inv.pdf', mimeType: 'application/pdf', providerId: 'prov-1' }
const EARLIER = '11111111-1111-4111-8111-111111111111'
const THIS = '22222222-2222-4222-8222-222222222222'

beforeEach(() => vi.clearAllMocks())

describe('attachPaper', () => {
  it('returns the id of a newly stored paper', async () => {
    http.post.mockResolvedValue({ data: { documentId: THIS, duplicate: false } })
    await expect(attachPaper(PARAMS)).resolves.toEqual({ documentId: THIS, duplicate: false })
  })

  it('accepts the earlier id for the same bytes — the attached file IS that paper', async () => {
    http.post.mockResolvedValue({ data: { documentId: EARLIER, duplicate: true } })
    await expect(attachPaper(PARAMS)).resolves.toEqual({ documentId: EARLIER, duplicate: true })
  })

  it('refuses the earlier id when the NUMBER collided: the attached file was never stored', async () => {
    http.post.mockResolvedValue({
      data: {
        documentId: EARLIER,
        duplicate: true,
        duplicateOf: { documentId: EARLIER, docNumber: 'A-17', reason: 'already on file' },
      },
    })
    const err = await attachPaper(PARAMS).catch((e) => e)
    expect(err).toBeInstanceOf(PaperAlreadyOnFileError)
    expect(err.earlier).toEqual({ documentId: EARLIER, docNumber: 'A-17' })
    expect(err.message).toMatch(/no\. A-17 is already on file, so your copy was not stored/)
  })

  it('keeps a paper that WAS stored even though its number names an earlier one', async () => {
    http.post.mockResolvedValue({
      data: {
        documentId: THIS,
        duplicate: true,
        duplicateOf: { documentId: EARLIER, docNumber: 'A-17', reason: 'already on file' },
      },
    })
    await expect(attachPaper(PARAMS)).resolves.toEqual({ documentId: THIS, duplicate: true })
  })
})
