/**
 * The desk's door for paper: every file gets its own outcome, in the
 * gateway's words, and the emailed files are listed with theirs.
 * All names and ids are SYNTHETIC.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({
  upload: vi.fn(),
  arrivals: vi.fn(),
}));

vi.mock('../../../services/api/documents', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../services/api/documents')>();
  return {
    ...mod,
    documentsApi: { ...mod.documentsApi, upload: api.upload, arrivals: api.arrivals },
  };
});

import { ReceiptsIntake, isDeskFile, outcomeOf } from './ReceiptsIntake';

function mount(onOpen = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ReceiptsIntake rid="house-1" onOpen={onOpen} />
    </QueryClientProvider>,
  );
  return { onOpen };
}

const file = (name: string, type: string, body = 'SYNTHETIC') => new File([body], name, { type });

beforeEach(() => {
  api.upload.mockReset();
  api.arrivals.mockReset();
});

describe('outcomeOf — the reply in the desk words', () => {
  it('a duplicate names the paper on file', () => {
    const o = outcomeOf('a.xml', {
      documentId: 'doc-0',
      duplicate: true,
      document: null,
      duplicateOf: { documentId: 'doc-0', docNumber: 'SYN1', reason: 'SYNTHETIC already on file as SYN1' },
    });
    expect(o).toEqual(expect.objectContaining({ kind: 'on_file', documentId: 'doc-0', reason: 'SYNTHETIC already on file as SYN1' }));
  });

  it('an e-invoice says it was read as written and its signature was not checked', () => {
    const o = outcomeOf('a.xml', {
      documentId: 'doc-1',
      duplicate: false,
      document: { einvoice: { kind: 'e-fatura', signed: true, signatureChecked: false } },
    });
    expect(o.kind).toBe('filed');
    expect(o.kind === 'filed' && o.note).toMatch(/e-fatura file as written; its signature is present but was not checked/);
  });

  it('no paper and no duplicate is never shown as filed', () => {
    expect(outcomeOf('a.pdf', { documentId: null, duplicate: false, document: null }).kind).toBe('refused');
  });
});

describe('isDeskFile', () => {
  it('takes photos, PDFs and the e-invoice file, not a spreadsheet', () => {
    expect(isDeskFile(file('a.pdf', 'application/pdf'))).toBe(true);
    expect(isDeskFile(file('SYN1.xml', ''))).toBe(true);
    expect(isDeskFile(file('efatura.zip', 'application/zip'))).toBe(true);
    expect(isDeskFile(file('prices.csv', 'text/csv'))).toBe(false);
  });
});

describe('ReceiptsIntake', () => {
  it('files each dropped file in turn and says what became of each', async () => {
    api.upload
      .mockResolvedValueOnce({ documentId: 'doc-1', duplicate: false, document: null })
      .mockResolvedValueOnce({
        documentId: 'doc-0',
        duplicate: true,
        document: null,
        duplicateOf: { documentId: 'doc-0', docNumber: 'SYN1', reason: 'SYNTHETIC already on file as SYN1.' },
        linkRefused: ['SYNTHETIC the order named is not this house’s, so the paper was filed without it.'],
      })
      .mockRejectedValueOnce({ response: { status: 422, data: { message: 'SYNTHETIC unreadable' } } });
    const { onOpen } = mount();
    const zone = screen.getByRole('button', { name: 'Add papers' }).parentElement as HTMLElement;
    fireEvent.drop(zone, {
      dataTransfer: {
        files: [file('a.pdf', 'application/pdf'), file('b.xml', 'application/xml'), file('c.jpg', 'image/jpeg')],
      },
    });
    await screen.findByText(/SYNTHETIC already on file as SYN1/);
    await screen.findByText(/not filed: SYNTHETIC unreadable/);
    expect(screen.getByText(/filed\./)).toBeTruthy();
    expect(screen.getByText(/filed without it/)).toBeTruthy();
    expect(api.upload).toHaveBeenCalledTimes(3);
    expect(api.upload.mock.calls[1][0]).toEqual(
      expect.objectContaining({ filename: 'b.xml', mimeType: 'application/xml' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open the paper on file' }));
    expect(onOpen).toHaveBeenCalledWith('doc-0');
  });

  it('files dropped while a batch is filing wait their turn, and are filed, never dropped', async () => {
    let release!: () => void;
    api.upload
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ documentId: 'doc-1', duplicate: false, document: null });
          }),
      )
      .mockResolvedValue({ documentId: 'doc-2', duplicate: false, document: null });
    mount();
    const zone = screen.getByRole('button', { name: 'Add papers' }).parentElement as HTMLElement;
    fireEvent.drop(zone, { dataTransfer: { files: [file('first.pdf', 'application/pdf')] } });
    await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(1));
    // While the first is still filing, two more arrive.
    fireEvent.drop(zone, {
      dataTransfer: { files: [file('second.pdf', 'application/pdf'), file('third.jpg', 'image/jpeg')] },
    });
    expect(await screen.findAllByText(/waiting to be filed/)).toHaveLength(2);
    expect(screen.getByText(/papers added now wait their turn/)).toBeTruthy();
    release();
    await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(3));
    expect(api.upload.mock.calls.map((c) => c[0].filename)).toEqual(['first.pdf', 'second.pdf', 'third.jpg']);
    await waitFor(() => expect(screen.getAllByText(/filed\./)).toHaveLength(3));
    expect(screen.queryByText(/waiting to be filed/)).toBeNull();
  });

  it('a new batch on an idle strip replaces the last list', async () => {
    api.upload.mockResolvedValue({ documentId: 'doc-1', duplicate: false, document: null });
    mount();
    const zone = screen.getByRole('button', { name: 'Add papers' }).parentElement as HTMLElement;
    fireEvent.drop(zone, { dataTransfer: { files: [file('one.pdf', 'application/pdf')] } });
    await screen.findByText(/filed\./);
    await waitFor(() => expect(screen.queryByText(/wait their turn/)).toBeNull());
    fireEvent.drop(zone, { dataTransfer: { files: [file('two.pdf', 'application/pdf')] } });
    await screen.findByText('two.pdf');
    await waitFor(() => expect(screen.queryByText('one.pdf')).toBeNull());
  });

  it('a file it cannot take is named, and nothing is sent for it', async () => {
    mount();
    const zone = screen.getByRole('button', { name: 'Add papers' }).parentElement as HTMLElement;
    fireEvent.drop(zone, { dataTransfer: { files: [file('prices.csv', 'text/csv')] } });
    await screen.findByText(/"prices.csv" is not a photo, a PDF or an e-invoice file/);
    expect(api.upload).not.toHaveBeenCalled();
  });

  it('lists the emailed files with each outcome, and a failed read is said', async () => {
    api.arrivals.mockResolvedValueOnce({
      items: [
        {
          id: 'a1',
          filename: 'SYN-invoice.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 10,
          arrivedAt: '2027-07-05T10:00:00Z',
          state: 'failed',
          documentId: null,
          reason: 'SYNTHETIC could not be downloaded after 3 tries; not tried again.',
          attempts: 3,
        },
      ],
      more: false,
    });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Arrived by email' }));
    await screen.findByText('SYN-invoice.pdf');
    expect(screen.getByText(/not filed/)).toBeTruthy();
    expect(screen.getByText(/not tried again/)).toBeTruthy();
  });

  it('an emailed-files read that fails is not an empty list', async () => {
    api.arrivals.mockRejectedValueOnce({ response: { status: 503, data: { message: 'SYNTHETIC down' } } });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Arrived by email' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/SYNTHETIC down.*not an empty list/));
  });
});
