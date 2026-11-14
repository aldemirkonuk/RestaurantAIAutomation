/**
 * QA round 2, U-1: `getWinesByIds` put every wine id in one GET /wines?ids=
 * URL. At about 420 ids (37 characters each) the request passed Node's 16 KB
 * header limit, the library join failed, and /inventory lost the names,
 * vintages and grapes of a house holding 500 wines. It now asks in chunks of
 * `WINE_IDS_PER_REQUEST` (at or under the gateway's `WINE_IDS_MAX`), and one failed chunk
 * fails the read rather than leaving a third of the wines nameless.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.hoisted(() => vi.fn());

vi.mock('./client', () => ({
  apiClient: { get: (...a: unknown[]) => get(...a) },
  getActiveRestaurantId: () => 'r-1',
}));

import { WINE_CHUNKS_AT_ONCE, WINE_IDS_PER_REQUEST, getWinesByIds } from './wines';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);

beforeEach(() => {
  get.mockReset();
  get.mockImplementation((_path: string, cfg: { params: { ids: string } }) =>
    Promise.resolve({ data: cfg.params.ids.split(',').map((id) => ({ id })) }),
  );
});

describe('getWinesByIds', () => {
  it('asks in chunks no longer than the gateway serves, and returns every wine', async () => {
    const asked = ids(500);
    const wines = await getWinesByIds(asked);

    expect(get).toHaveBeenCalledTimes(Math.ceil(500 / WINE_IDS_PER_REQUEST));
    for (const [, cfg] of get.mock.calls as [string, { params: { ids: string } }][]) {
      expect(cfg.params.ids.split(',').length).toBeLessThanOrEqual(WINE_IDS_PER_REQUEST);
      // 100 uuids and their commas: about 3.7 KB, far under a 16 KB header.
      expect(cfg.params.ids.length).toBeLessThan(4000);
    }
    expect(wines.map((w) => w.id)).toEqual(asked);
  });

  it('asks once for an id named twice', async () => {
    const one = ids(1);
    await getWinesByIds([...one, ...one]);
    expect(get).toHaveBeenCalledTimes(1);
    expect((get.mock.calls[0][1] as { params: { ids: string } }).params.ids).toBe(one[0]);
  });

  it('fails the whole read when one chunk fails', async () => {
    get.mockImplementationOnce((_p: string, cfg: { params: { ids: string } }) =>
      Promise.resolve({ data: cfg.params.ids.split(',').map((id) => ({ id })) }),
    );
    get.mockImplementationOnce(() => Promise.reject(new Error('library read failed')));
    await expect(getWinesByIds(ids(250))).rejects.toThrow('library read failed');
  });

  // inventory r36 audit, gap 12: the chunks were read one after another.
  it('reads the chunks together, at most WINE_CHUNKS_AT_ONCE at a time, and keeps the asked order', async () => {
    let inFlight = 0;
    let most = 0;
    const waiting: Array<() => void> = [];
    get.mockImplementation((_p: string, cfg: { params: { ids: string } }) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      return new Promise((resolve) => {
        waiting.push(() => {
          inFlight -= 1;
          resolve({ data: cfg.params.ids.split(',').map((id) => ({ id })) });
        });
      });
    });
    const asked = ids(1000);
    const read = getWinesByIds(asked);
    // answer newest first, so a chunk that answers early cannot reorder the wines
    while (get.mock.calls.length < 10 || waiting.length > 0) {
      await Promise.resolve();
      const done = waiting.pop();
      if (done) done();
      await new Promise((r) => setTimeout(r, 0));
    }
    const wines = await read;
    expect(get).toHaveBeenCalledTimes(10);
    expect(most).toBe(WINE_CHUNKS_AT_ONCE);
    expect(wines.map((w) => w.id)).toEqual(asked);
  });

  it('starts no chunk after one has failed, even while the others still answer', async () => {
    // the first chunk fails at once; the rest answer a moment later
    get.mockImplementation((_p: string, cfg: { params: { ids: string } }) =>
      get.mock.calls.length === 1
        ? Promise.reject(new Error('library read failed'))
        : new Promise((resolve) =>
            setTimeout(() => resolve({ data: cfg.params.ids.split(',').map((id) => ({ id })) }), 0),
          ),
    );
    await expect(getWinesByIds(ids(1000))).rejects.toThrow('library read failed');
    // let the chunks already in flight answer, then count what was asked
    for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 0));
    expect(get).toHaveBeenCalledTimes(WINE_CHUNKS_AT_ONCE);
  });

  it('asks nothing for no ids', async () => {
    expect(await getWinesByIds([])).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });
});
