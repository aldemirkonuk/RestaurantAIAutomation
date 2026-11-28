import { apiClient } from './client'

/**
 * The house's opening book (ADR 0144). A folio the house passes over is
 * recorded as a fact, never as silence: `POST /arrival/skip` writes
 * `configuration_step_skipped` for the session's house (arrival.service.ts
 * `skip`). Folio 0, the last invoice through the door, is `evidence`.
 */
export type ArrivalFolio = 'evidence' | 'currency' | 'pour' | 'vendors' | 'notifications' | 'assistant'

export async function skipFolio(folio: ArrivalFolio): Promise<void> {
  await apiClient.post('/arrival/skip', { folio })
}

/**
 * Has the house's last invoice been dealt with on its opening book: posted or
 * skipped on the `evidence` folio? Throws when the book cannot be read, so a
 * failed read is never taken for "not yet" (ADR 0020). GET /arrival answers
 * each source as `{ readable, data }`.
 */
export async function readEvidenceRecorded(): Promise<boolean> {
  const { data } = await apiClient.get('/arrival')
  const folios = data?.folios
  if (!folios || folios.readable !== true || !Array.isArray(folios.data)) {
    throw new Error('The opening book could not be read')
  }
  return folios.data.some(
    (row: { folio?: string; state?: string }) =>
      row?.folio === 'evidence' && (row.state === 'skipped' || row.state === 'posted'),
  )
}
