/**
 * The verified CSV is asked for as text, so a refusal's JSON body arrives as a
 * string. The client reads it back so the gateway's own sentence reaches the
 * page (r108, DD-r108-22). Fails with the JSON read-back removed.
 */
import { describe, expect, it, vi } from 'vitest';

const get = vi.hoisted(() => vi.fn());
vi.mock('./client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./client')>();
  return { ...mod, apiClient: { ...mod.apiClient, get } };
});

import { documentsApi } from './documents';
import { serverMessage } from '../../pages/receipts/next/rc2-format';

describe('documentsApi.verifiedCsv', () => {
  it('a 403 sent as text is read back into its sentence', async () => {
    const sentence = "The papers' money is for the people who keep the books here; ask a manager for the export.";
    get.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 403'), {
        isAxiosError: true,
        response: { status: 403, data: JSON.stringify({ statusCode: 403, message: sentence }) },
      }),
    );
    const err = await documentsApi.verifiedCsv().catch((e: unknown) => e);
    expect(serverMessage(err, 'fallback')).toBe(sentence);
  });

  it('the file comes back as the text the gateway sent', async () => {
    get.mockResolvedValueOnce({ data: 'doc_number\nV-1\n' });
    await expect(documentsApi.verifiedCsv()).resolves.toBe('doc_number\nV-1\n');
  });

  it('only a plain yes from the gateway allows the link', async () => {
    get.mockResolvedValueOnce({ data: { allowed: true } });
    await expect(documentsApi.verifiedCsvAllowed()).resolves.toBe(true);
    get.mockResolvedValueOnce({ data: { allowed: 'true' } });
    await expect(documentsApi.verifiedCsvAllowed()).resolves.toBe(false);
    get.mockResolvedValueOnce({ data: {} });
    await expect(documentsApi.verifiedCsvAllowed()).resolves.toBe(false);
  });
});
