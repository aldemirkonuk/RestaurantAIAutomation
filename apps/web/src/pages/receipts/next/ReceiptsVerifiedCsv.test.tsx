/**
 * THE VERIFIED BOOK EXPORTS FROM ITS OWN HEADER (r108, DD-r108-22).
 *
 * The link sits in the Verified header and is shown only on the gateway's own
 * money-role answer: the web keeps no role list, so a staff session the gateway
 * says no to gets no link even when the web's role reads "manager", and a
 * refusal or a failed export says so in words. These cases fail with the gate
 * dropped or with the refusal's sentence lost.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { createContext, type ReactNode } from 'react';
import type { ProcurementDocument } from '../../../services/api/documents';

const api = vi.hoisted(() => ({ list: vi.fn(), allowed: vi.fn(), csv: vi.fn() }));

// The web's own role says manager in every case on purpose: only the
// gateway's answer may decide the link.
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'rest-A', activeRole: 'manager', user: null }),
  AuthContext: createContext<{ activeRestaurantId: string | null } | null>(null),
}));
vi.mock('../../../services/api/documents', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../services/api/documents')>();
  return {
    ...mod,
    documentsApi: {
      ...mod.documentsApi,
      list: api.list,
      verifiedCsvAllowed: api.allowed,
      verifiedCsv: api.csv,
      houseCurrency: () => Promise.resolve(null),
    },
  };
});
vi.mock('../../../services/api/receiving', () => ({
  receivingApi: { listUnverified: () => Promise.resolve({ items: [] }) },
}));
vi.mock('../../../services/api/canonical', () => ({
  canonicalApi: { document: () => new Promise(() => {}) },
}));
vi.mock('../../documents/next/CanonicalDocumentPage', () => ({
  CanonicalDocumentPage: () => <div />,
}));
vi.mock('../../../services/api/orders', () => ({ getOrder: () => Promise.resolve(null) }));

import ReceiptsNext from './ReceiptsNext';

const paper = {
  id: 'v1',
  doc_type: 'invoice',
  status: 'verified',
  doc_number: 'V-1',
  doc_date: '2026-01-01',
  currency: 'USD',
  total: 10,
  created_at: '2026-11-20T00:00:00.000Z',
} as unknown as ProcurementDocument;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}

const createObjectURL = vi.fn(() => 'blob:verified');
const revokeObjectURL = vi.fn();

beforeEach(() => {
  api.list.mockReset();
  api.allowed.mockReset();
  api.csv.mockReset();
  api.list.mockImplementation((o: { status?: string }) =>
    Promise.resolve(o.status === 'verified' ? [paper] : []),
  );
  Object.assign(URL, { createObjectURL, revokeObjectURL });
  createObjectURL.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe('the verified CSV link', () => {
  it('an owner or manager the gateway says yes to gets the link in the header, and it downloads', async () => {
    api.allowed.mockResolvedValue(true);
    api.csv.mockResolvedValue('doc_number,total\nV-1,10.00\n');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<ReceiptsNext />, { wrapper });
    const link = await screen.findByRole('button', { name: 'Export verified papers (CSV)' });
    // In the Verified header row, beside the lane's own toggle.
    const lane = screen.getByTestId('verified-lane');
    expect(lane.contains(link)).toBe(true);
    expect(link.textContent).toBe('Export CSV');
    fireEvent.click(link);
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(api.csv).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('verified-csv-error')).toBeNull();
  });

  it('staff the gateway says no to get no link, though the web role reads manager', async () => {
    api.allowed.mockResolvedValue(false);
    render(<ReceiptsNext />, { wrapper });
    await screen.findByRole('button', { name: /Verified · / });
    await waitFor(() => expect(api.allowed).toHaveBeenCalled());
    // Let the answer land before looking.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('verified-csv')).toBeNull();
  });

  it('a failed check shows no link rather than one that refuses', async () => {
    api.allowed.mockRejectedValue(new Error('Network Error'));
    render(<ReceiptsNext />, { wrapper });
    await screen.findByRole('button', { name: /Verified · / });
    await waitFor(() => expect(api.allowed).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('verified-csv')).toBeNull();
  });

  it('a 403 from the export says the gateway sentence, and nothing is downloaded', async () => {
    api.allowed.mockResolvedValue(true);
    const refusal = Object.assign(new Error('Request failed with status code 403'), {
      response: {
        status: 403,
        data: { message: "The papers' money is for the people who keep the books here; ask a manager for the export." },
      },
    });
    api.csv.mockRejectedValue(refusal);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<ReceiptsNext />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Export verified papers (CSV)' }));
    const alert = await screen.findByTestId('verified-csv-error');
    expect(alert.textContent).toBe(
      "The papers' money is for the people who keep the books here; ask a manager for the export.",
    );
    expect(alert.getAttribute('role')).toBe('alert');
    expect(click).not.toHaveBeenCalled();
  });

  it('a failed export with no answer says nothing was downloaded', async () => {
    api.allowed.mockResolvedValue(true);
    api.csv.mockRejectedValue(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));
    render(<ReceiptsNext />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Export verified papers (CSV)' }));
    const alert = await screen.findByTestId('verified-csv-error');
    expect(alert.textContent).toMatch(/^The file could not be made, so nothing was downloaded: no answer came back/);
  });
});
