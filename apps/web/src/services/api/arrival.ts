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
