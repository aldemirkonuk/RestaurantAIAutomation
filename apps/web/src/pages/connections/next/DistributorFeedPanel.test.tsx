/**
 * The distributor panel's render contract (ADR 0126, batch 56).
 *
 * Every test pins something the founder decided or something ADR 0020 forbids:
 *
 *   - a register that could not be read is NAMED and carries the gateway's own
 *     sentence, never an empty list that reads as "no distributor here";
 *   - the robots rule and the terms clause are printed VERBATIM, with the day
 *     they were measured, and a portal whose terms are UNREAD says so rather
 *     than borrowing another host's;
 *   - both ways in are on the page, and neither of them is a connect button;
 *   - a catalogue that admitted nothing never renders as a bare zero: the
 *     unmapped codes are named, because that is the refusal a person can fix;
 *   - a write that FAILED is not counted as one that landed;
 *   - the letter is a download, and the panel says this product never sends it.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DistributorFeedPanel } from './DistributorFeedPanel';
import type {
  CatalogueAdmissionVM,
  DistributorCatalogueVM,
  FeedLetterVM,
} from './useConnectionsNextData';

const reg = <T,>(data: T | null, over: Partial<Record<string, unknown>> = {}) =>
  ({
    data,
    loading: false,
    error: null,
    refused: false,
    ...over,
  }) as never;

const SGWS_TERMS =
  "The SG Proof portal's OWN terms of use have not been read: shop.sgproof.com publishes 'Visit-time: 0400-0845' and the window was shut on both passes.";

const catalogue: DistributorCatalogueVM = {
  connection: {
    label: 'Licensed distributor feed',
    description: 'The price list your own licence sees at a distributor.',
    offerable: false,
    notOfferableBecause:
      'No distributor measured on 2026-09-05 publishes a price feed a house could connect.',
    waysIn: [],
  },
  requested: 'me',
  jurisdiction: 'US-IL',
  distributors: [
    {
      key: 'southern-glazers-il',
      distributor: "Southern Glazer's Wine & Spirits of Illinois",
      jurisdictions: ['US-IL'],
      portal: { name: 'SG Proof', url: 'https://shop.sgproof.com/' },
      mechanism: 'edi_810_invoice',
      automatedAccess: {
        verdict: 'forbidden',
        robots: "shop.sgproof.com/robots.txt publishes 'Visit-time: 0400-0845'.",
        terms: SGWS_TERMS,
        measuredOn: '2026-09-05',
        evidence: ['https://shop.sgproof.com/robots.txt'],
      },
      availability:
        "Southern Glazer's does run an EDI programme, and what it sends a customer is orders, shipments and invoices.",
      unbuilt: {
        reason: 'No 832 price/sales catalogue is documented for Southern Glazer’s.',
        measuredOn: '2026-09-05',
      },
      connectable: false,
    },
    {
      key: 'rndc-il',
      distributor: 'Republic National Distributing Company, Illinois',
      jurisdictions: ['US-IL'],
      portal: { name: 'eRNDC', url: 'https://app.erndc.com/login' },
      mechanism: 'edi_810_invoice',
      automatedAccess: {
        verdict: 'unstated',
        robots: 'app.erndc.com/robots.txt answers HTTP 404.',
        terms: null,
        measuredOn: '2026-09-05',
        evidence: [],
      },
      availability: 'eRNDC prices per account behind a login.',
      unbuilt: { reason: 'No documented feed of any kind.', measuredOn: '2026-09-05' },
      connectable: false,
    },
  ],
  silence: null,
};

const letter: FeedLetterVM = {
  id: 'distributor-invoice-feed-request',
  filename: 'distributor-invoice-feed-request.txt',
  subject: 'Request to enable an electronic invoice feed for our account',
  signedBy: 'The house signs this, on the house’s own letterhead.',
  firstAsk: "Southern Glazer's Wine & Spirits of Illinois — a documented EDI programme.",
  neverSent: 'This product has no route that sends this letter.',
  brackets: ['[Sales Consultant name]', '[account number]'],
  body: 'Re: Request to enable an electronic invoice feed for our account',
};

const admission = (over: Partial<CatalogueAdmissionVM> = {}): CatalogueAdmissionVM => ({
  distributorKey: 'southern-glazers-il',
  sha256: 'f'.repeat(64),
  documentId: 'doc-1',
  uploadedAt: '2026-09-05T18:00:00.000Z',
  admitted: 2,
  refused: 6,
  alreadyRecorded: 0,
  writeFailed: 0,
  writeFailures: [],
  linesRead: 8,
  unmappedCodes: ['MSR'],
  refusedWhole: null,
  sentence: '8 lines read. 2 priced. 6 refused.',
  lines: [
    {
      admitted: true,
      item: 'A RED WINE',
      reason: null,
      detail: null,
      priceBasis: 'our licence’s contract price',
      priceCode: 'LIC',
      rawPrice: 14.75,
      currency: 'USD',
    },
    {
      admitted: false,
      item: 'ITEM-0004',
      reason: 'unmapped_price_basis',
      detail: "item ITEM-0004 is priced under 'MSR', and this connection has no mapping for it.",
    },
  ],
  ...over,
});

type UploadArgs = {
  contentBase64: string;
  filename: string;
  distributorKey?: string | null;
  declaredCurrency?: string | null;
};

function uploader(result: unknown, throws?: unknown) {
  // Typed on its argument so `mock.calls[0][0]` is a value and not an index
  // into an empty tuple — `vi.fn(async () => …)` infers no parameters at all.
  const mutateAsync = vi.fn(async (_v: UploadArgs) => {
    if (throws) throw throws;
    return result as never;
  });
  return { mutateAsync, isPending: false };
}

beforeEach(() => vi.clearAllMocks());

describe('the register itself', () => {
  it('says it is reading rather than showing an empty list', () => {
    render(<DistributorFeedPanel />);
    expect(screen.getByText(/Reading the distributor register/i)).toBeInTheDocument();
    expect(screen.queryByText(/Southern Glazer/)).not.toBeInTheDocument();
  });

  it('NAMES a failed read and carries the gateway’s own sentence', () => {
    render(
      <DistributorFeedPanel
        distributors={reg(null, { error: 'connection reset by peer' })}
      />,
    );
    expect(
      screen.getByText(/The distributor register could not be read\./i),
    ).toBeInTheDocument();
    expect(screen.getByText(/connection reset by peer/)).toBeInTheDocument();
    expect(screen.getByText(/unknown, not empty/i)).toBeInTheDocument();
  });

  it('prints the gateway’s silence when the house has no jurisdiction', () => {
    render(
      <DistributorFeedPanel
        distributors={reg({
          ...catalogue,
          distributors: [],
          jurisdiction: null,
          silence: 'This house records neither a state nor a country.',
        })}
      />,
    );
    expect(
      screen.getByText(/records neither a state nor a country/i),
    ).toBeInTheDocument();
  });

  it('prints each distributor’s robots rule and terms clause verbatim, with the day', () => {
    render(<DistributorFeedPanel distributors={reg(catalogue)} />);
    expect(
      screen.getByText(/shop\.sgproof\.com\/robots\.txt publishes 'Visit-time: 0400-0845'\./),
    ).toBeInTheDocument();
    expect(screen.getAllByText('2026-09-05').length).toBeGreaterThan(0);
  });

  it('says the SG Proof portal’s OWN terms are unread — it does not borrow the corporate site’s', () => {
    render(<DistributorFeedPanel distributors={reg(catalogue)} />);
    expect(screen.getByText(new RegExp('OWN terms of use have not been read'))).toBeInTheDocument();
  });

  it('a distributor with no terms read says so rather than showing nothing', () => {
    render(<DistributorFeedPanel distributors={reg(catalogue)} />);
    expect(
      screen.getByText(/an unread term is not a permissive one/i),
    ).toBeInTheDocument();
  });

  it('offers no connect control anywhere, and says why not', () => {
    render(<DistributorFeedPanel distributors={reg(catalogue)} />);
    expect(screen.queryByRole('button', { name: /connect/i })).not.toBeInTheDocument();
    expect(
      screen.getByText(/No distributor connection is offered, and that is the answer/i),
    ).toBeInTheDocument();
  });
});

describe('the two ways in', () => {
  it('draws both, and neither of them holds a login', () => {
    render(<DistributorFeedPanel distributors={reg(catalogue)} letter={reg(letter)} />);
    expect(screen.getByText('Hand over a file you already have')).toBeInTheDocument();
    expect(
      screen.getByText('Ask your Sales Consultant for an invoice feed'),
    ).toBeInTheDocument();
    expect(screen.getByText(/No distributor login, ever/i)).toBeInTheDocument();
  });

  it('says this product never sends the letter', () => {
    render(<DistributorFeedPanel distributors={reg(catalogue)} letter={reg(letter)} />);
    expect(screen.getByText(/This product never sends it/i)).toBeInTheDocument();
    expect(
      screen.getByText(/no route that sends this letter/i),
    ).toBeInTheDocument();
  });

  it('cannot offer the download when the letter could not be read, and names the failure', () => {
    render(
      <DistributorFeedPanel
        distributors={reg(catalogue)}
        letter={reg(null, { error: 'the letter route answered 503' })}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Download the letter' });
    expect(btn).toBeDisabled();
    expect(screen.getAllByText(/answered 503/).length).toBeGreaterThan(0);
  });

  it('downloads the text the gateway served', () => {
    const createObjectURL = vi.fn(() => 'blob:x');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    render(<DistributorFeedPanel distributors={reg(catalogue)} letter={reg(letter)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download the letter' }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });
});

describe('handing over a file', () => {
  const file = (name = 'q3.832') =>
    new File(['ISA*00*~ST*832*0001~'], name, { type: 'text/plain' });

  it('reports what was priced AND names every refused line', async () => {
    const up = uploader({
      documentId: 'doc-1',
      duplicate: false,
      document: { docType: 'price_list' },
      catalog: admission(),
    });
    render(
      <DistributorFeedPanel distributors={reg(catalogue)} letter={reg(letter)} upload={up} />,
    );
    fireEvent.change(screen.getByTestId('cx-df-file'), {
      target: { files: [file()] },
    });
    await waitFor(() => expect(screen.getByTestId('cx-df-report')).toBeInTheDocument());
    expect(screen.getByText('8 lines read. 2 priced. 6 refused.')).toBeInTheDocument();
    expect(
      screen.getByText(/is priced under 'MSR', and this connection has no mapping/),
    ).toBeInTheDocument();
  });

  it('names the unmapped codes, so a zero is never a dead end', async () => {
    const up = uploader({
      documentId: 'doc-1',
      duplicate: false,
      document: { docType: 'price_list' },
      catalog: admission({
        admitted: 0,
        sentence: '8 lines read. 8 refused.',
        lines: [],
      }),
    });
    render(<DistributorFeedPanel distributors={reg(catalogue)} upload={up} />);
    fireEvent.change(screen.getByTestId('cx-df-file'), {
      target: { files: [file()] },
    });
    await waitFor(() =>
      expect(
        screen.getByText(/Codes nobody here has stated a meaning for: MSR/),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/upload the same file again/i)).toBeInTheDocument();
  });

  it('shows a whole-document refusal in the gateway’s own words', async () => {
    const up = uploader({
      documentId: 'doc-1',
      duplicate: false,
      document: { docType: 'price_list' },
      catalog: admission({
        admitted: 0,
        refusedWhole:
          'This house’s price-code statements could not be read, so no line of this catalogue was judged.',
        unmappedCodes: [],
        lines: [],
        sentence: 'Nothing was priced.',
      }),
    });
    render(<DistributorFeedPanel distributors={reg(catalogue)} upload={up} />);
    fireEvent.change(screen.getByTestId('cx-df-file'), {
      target: { files: [file()] },
    });
    await waitFor(() =>
      expect(
        screen.getByText(/price-code statements could not be read/),
      ).toBeInTheDocument(),
    );
  });

  it('reports a row that could NOT be written as not recorded', async () => {
    const up = uploader({
      documentId: 'doc-1',
      duplicate: false,
      document: { docType: 'price_list' },
      catalog: admission({
        admitted: 0,
        writeFailed: 1,
        writeFailures: ['A RED WINE: permission denied for table'],
        lines: [],
        sentence: '8 lines read. 1 could not be written.',
      }),
    });
    render(<DistributorFeedPanel distributors={reg(catalogue)} upload={up} />);
    fireEvent.change(screen.getByTestId('cx-df-file'), {
      target: { files: [file()] },
    });
    await waitFor(() =>
      expect(
        screen.getByText(/Not recorded: A RED WINE: permission denied for table/),
      ).toBeInTheDocument(),
    );
  });

  it('says an 810 was read as an invoice rather than pretending it was a catalogue', async () => {
    const up = uploader({
      documentId: 'doc-2',
      duplicate: false,
      document: { docType: 'invoice' },
    });
    render(<DistributorFeedPanel distributors={reg(catalogue)} upload={up} />);
    fireEvent.change(screen.getByTestId('cx-df-file'), {
      target: { files: [file('invoice.edi')] },
    });
    await waitFor(() =>
      expect(screen.getByText(/Read as an invoice and stored/)).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('cx-df-report')).not.toBeInTheDocument();
  });

  it('carries a refused upload back in the gateway’s own sentence', async () => {
    const up = uploader(null, {
      response: { data: { message: 'Document is empty' } },
    });
    render(<DistributorFeedPanel distributors={reg(catalogue)} upload={up} />);
    fireEvent.change(screen.getByTestId('cx-df-file'), {
      target: { files: [file()] },
    });
    await waitFor(() =>
      expect(screen.getByText('Document is empty')).toBeInTheDocument(),
    );
  });

  it('lets a person name the sender, and defaults to naming none', () => {
    render(<DistributorFeedPanel distributors={reg(catalogue)} />);
    const select = screen.getByLabelText(
      /Sender, for a price catalogue/i,
    ) as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(
      screen.getByText(/Not named — a catalogue will be stored, not priced/),
    ).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'southern-glazers-il' } });
    expect(select.value).toBe('southern-glazers-il');
  });

  it('sends the named sender with the file', async () => {
    const up = uploader({
      documentId: 'doc-1',
      duplicate: false,
      document: { docType: 'price_list' },
      catalog: admission(),
    });
    render(<DistributorFeedPanel distributors={reg(catalogue)} upload={up} />);
    fireEvent.change(screen.getByLabelText(/Sender, for a price catalogue/i), {
      target: { value: 'rndc-il' },
    });
    fireEvent.change(screen.getByTestId('cx-df-file'), {
      target: { files: [file()] },
    });
    await waitFor(() => expect(up.mutateAsync).toHaveBeenCalledTimes(1));
    expect(up.mutateAsync.mock.calls[0][0]).toMatchObject({
      filename: 'q3.832',
      distributorKey: 'rndc-il',
    });
  });
});
