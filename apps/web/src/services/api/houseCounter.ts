/**
 * `GET /house/counter` — the counter's one read (sketch 119 D).
 *
 * No catch here, on purpose. A failed read rejects, and the hook that polls it
 * keeps the last answer DATED rather than replacing it with an empty counter:
 * a failed read is an error, never an empty success.
 */

import { apiClient } from './client';
import type { HouseCounterRead } from '../../lib/mudavym/counterRead';

export async function readHouseCounter(): Promise<HouseCounterRead> {
  const response = await apiClient.get<HouseCounterRead>('/house/counter');
  const body = response.data;
  // A 200 whose body is not the shape is not an answer either — a proxy's
  // HTML page or an empty object must not render as "0 of 0 registers".
  if (!body || !Array.isArray((body as HouseCounterRead).registers)) {
    throw new Error('The counter answered without its registers.');
  }
  return body;
}
