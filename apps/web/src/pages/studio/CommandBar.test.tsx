import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const studioJsonRequest = vi.fn()
vi.mock('./studioApi', () => ({
  studioJsonRequest: (...args: unknown[]) => studioJsonRequest(...args),
  studioErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { restaurantId: 'r-1' } }) }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import { CommandBar } from './CommandBar'
import { useStudioSessionStore } from '../../stores/useStudioSessionStore'

describe('CommandBar — a hand-entered record (F-756)', () => {
  beforeEach(() => {
    studioJsonRequest.mockReset()
    toast.success.mockReset()
    toast.error.mockReset()
    useStudioSessionStore.setState({ sessionId: null, records: [] })
  })

  it('uses the submission row the server created, not a made-up id', async () => {
    studioJsonRequest.mockImplementation((path: string) =>
      Promise.resolve(path.endsWith('/sessions') ? { session: { id: 'sess-1' } } : { submission: { id: 'sub-real' } }),
    )
    render(<CommandBar />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Chianti Classico' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ingest' }))

    await waitFor(() => expect(useStudioSessionStore.getState().records).toHaveLength(1))
    expect(studioJsonRequest).toHaveBeenCalledWith('/api/v1/studio/submissions', 'POST', {
      session_id: 'sess-1', wine_name: 'Chianti Classico',
    })
    const record = useStudioSessionStore.getState().records[0]
    expect(record.submission_id).toBe('sub-real')
    expect(useStudioSessionStore.getState().sessionId).toBe('sess-1')
  })

  it('shows an error and no record when the session cannot be opened', async () => {
    studioJsonRequest.mockRejectedValue(new Error('Studio service unavailable'))
    render(<CommandBar />)
    fireEvent.click(screen.getByRole('button', { name: /empty record/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(useStudioSessionStore.getState().records).toHaveLength(0)
    expect(String(useStudioSessionStore.getState().sessionId ?? '')).not.toMatch(/^local-/)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('shows an error when the server returns no submission id', async () => {
    studioJsonRequest.mockImplementation((path: string) =>
      Promise.resolve(path.endsWith('/sessions') ? { session: { id: 'sess-1' } } : { submission: null }),
    )
    render(<CommandBar />)
    fireEvent.click(screen.getByRole('button', { name: /empty record/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(useStudioSessionStore.getState().records).toHaveLength(0)
  })
})

describe('CommandBar — a read list keeps only saved wines (F-787)', () => {
  beforeEach(() => {
    studioJsonRequest.mockReset()
    toast.success.mockReset()
    toast.error.mockReset()
    toast.warning.mockReset()
    useStudioSessionStore.setState({ sessionId: null, records: [] })
  })

  const readList = (wines: Record<string, unknown>[]) => {
    studioJsonRequest.mockImplementation((path: string) =>
      Promise.resolve(path.endsWith('/sessions') ? { session: { id: 'sess-1' } } : { wines, total_wines: wines.length }),
    )
    const { container } = render(<CommandBar />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'list.png', { type: 'image/png' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Ingest' }))
  }

  it('leaves out a wine with no saved row instead of inventing an id', async () => {
    readList([
      { submission_id: '11111111-1111-1111-1111-111111111111', wine_name: 'Barolo' },
      { wine_name: 'Unsaved Rioja' },
    ])
    await waitFor(() => expect(useStudioSessionStore.getState().records).toHaveLength(1))
    expect(useStudioSessionStore.getState().records[0].submission_id).toBe('11111111-1111-1111-1111-111111111111')
    expect(toast.warning).toHaveBeenCalledWith('1 wine could not be saved', expect.anything())
  })

  it('shows an error and no records when no wine was saved', async () => {
    readList([{ wine_name: 'Unsaved Rioja' }])
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(useStudioSessionStore.getState().records).toHaveLength(0)
    expect(toast.success).not.toHaveBeenCalled()
  })
})
