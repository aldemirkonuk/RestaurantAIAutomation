/**
 * r41 inventory audit gap 2: /inventory's "N invoices wait for a match" asks
 * the gateway for the number alone. A failed or malformed answer rejects, so
 * the page says the count could not be read instead of "none wait".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.hoisted(() => vi.fn());
vi.mock('./client', () => ({
  apiClient: { get: (...a: unknown[]) => get(...a) },
  getActiveRestaurantId: () => 'r-1',
}));

import { documentsApi } from './documents';

beforeEach(() => {
  get.mockReset();
});

describe('documentsApi.count', () => {
  it('asks the count route with the status, and answers the number', async () => {
    get.mockResolvedValue({ data: { count: 250 } });
    await expect(documentsApi.count({ status: 'needs_review' })).resolves.toBe(250);
    expect(get).toHaveBeenCalledWith('/procurement/documents/count', { params: { status: 'needs_review' } });
  });

  it('answers a real zero as zero', async () => {
    get.mockResolvedValue({ data: { count: 0 } });
    await expect(documentsApi.count({ status: 'needs_review' })).resolves.toBe(0);
  });

  it('rejects an answer with no number rather than reading it as none', async () => {
    get.mockResolvedValue({ data: { items: [] } });
    await expect(documentsApi.count({ status: 'needs_review' })).rejects.toThrow(
      'the document count came back in a shape this page cannot read',
    );
  });

  it('passes a failed request on', async () => {
    get.mockRejectedValue(new Error('the gateway did not answer'));
    await expect(documentsApi.count({ status: 'needs_review' })).rejects.toThrow('the gateway did not answer');
  });


});
