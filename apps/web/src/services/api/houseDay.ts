/**
 * `GET /house/day` — the day line's one read (sketch 119 §E).
 *
 * No catch here, on purpose — same rule as `houseCounter.ts`: a failed read
 * rejects, and the hook that polls it keeps the last answer DATED rather
 * than replacing it with an empty line. A failed read is an error, never an
 * empty success.
 */

import { apiClient } from './client';
import type { HouseDayRead } from '../../lib/mudavym/dayRead';

export async function readHouseDay(): Promise<HouseDayRead> {
  const response = await apiClient.get<HouseDayRead>('/house/day');
  const body = response.data;
  if (!body || !Array.isArray((body as HouseDayRead).registers)) {
    throw new Error('The day line answered without its registers.');
  }
  return body;
}
