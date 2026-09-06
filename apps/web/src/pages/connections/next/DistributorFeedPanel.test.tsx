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
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { DistributorFeedPanel } from './DistributorFeedPanel';
import type {
  CatalogueAdmissionVM,
  DistributorCatalogueVM,
  FeedLetterVM,
  PriceCodeStatementVM,
  PriceCodeStatementsVM,
  PriceCodeWithdrawVM,
  PriceCodeWriteVM,
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

/* ── the currency beside the sender (ADR 0126; the founder, batch 59) ────── */

describe('the declared currency', () => {
  const file = (name = 'q3.832') =>
    new File(['ISA*00*~ST*832*0001~'], name, { type: 'text/plain' });

  it('has no default, and offers none', () => {
    render(<DistributorFeedPanel distributors={reg(catalogue)} />);
    const input = screen.getByLabelText(
      /Currency, if the file states none/i,
    ) as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.getAttribute('placeholder')).toBeNull();
    expect(input.maxLength).toBe(3);
  });

  it('says an 832 with no CUR is the common case, and that there is no default', () => {
    render(<DistributorFeedPanel distributors={reg(catalogue)} />);
    expect(
      screen.getByText(/states no currency is the common case, not the broken one/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/refused whole rather than read as dollars/i)).toBeInTheDocument();
  });

  it('sends three characters as declaredCurrency', async () => {
    const up = uploader({
      documentId: 'doc-1',
      duplicate: false,
      document: { docType: 'price_list' },
      catalog: admission(),
    });
    render(<DistributorFeedPanel distributors={reg(catalogue)} upload={up} />);
    fireEvent.change(screen.getByLabelText(/Currency, if the file states none/i), {
      target: { value: 'try' },
    });
    fireEvent.change(screen.getByTestId('cx-df-file'), {
      target: { files: [file()] },
    });
    await waitFor(() => expect(up.mutateAsync).toHaveBeenCalledTimes(1));
    expect(up.mutateAsync.mock.calls[0][0]).toMatchObject({
      declaredCurrency: 'TRY',
    });
  });

  it('sends NOTHING for it when it is left blank, rather than a blank string', async () => {
    const up = uploader({
      documentId: 'doc-1',
      duplicate: false,
      document: { docType: 'price_list' },
      catalog: admission(),
    });
    render(<DistributorFeedPanel distributors={reg(catalogue)} upload={up} />);
    fireEvent.change(screen.getByTestId('cx-df-file'), {
      target: { files: [file()] },
    });
    await waitFor(() => expect(up.mutateAsync).toHaveBeenCalledTimes(1));
    expect(up.mutateAsync.mock.calls[0][0].declaredCurrency).toBeNull();
  });

  it('refuses a half-typed code and sends nothing at all', async () => {
    const up = uploader({ documentId: 'doc-1', duplicate: false, document: {} });
    render(<DistributorFeedPanel distributors={reg(catalogue)} upload={up} />);
    fireEvent.change(screen.getByLabelText(/Currency, if the file states none/i), {
      target: { value: 'TR' },
    });
    fireEvent.change(screen.getByTestId('cx-df-file'), {
      target: { files: [file()] },
    });
    await waitFor(() =>
      expect(
        screen.getByText(/is not an ISO 4217 currency code/i),
      ).toBeInTheDocument(),
    );
    expect(up.mutateAsync).not.toHaveBeenCalled();
  });
});

/* ── the price-code register in the distributor row (ADR 0126 §7) ────────── */

const KEY = 'southern-glazers-il';

const statement = (
  over: Partial<PriceCodeStatementVM> = {},
): PriceCodeStatementVM => ({
  id: 'm-1',
  restaurantId: 'r-1',
  distributorKey: KEY,
  codeField: 'edi_832_ctp02',
  priceCode: 'CON',
  priceBasis: 'the contract price our licence pays',
  evidence: "page 7 of the SPS MSSS guide our rep emailed on 2026-08-30",
  declaredBy: 'u-1',
  declaredByName: 'Ada Manager',
  declaredAt: '2026-09-01T09:00:00.000Z',
  withdrawnBy: null,
  withdrawnAt: null,
  withdrawnReason: null,
  ...over,
});

const codes = (
  over: Partial<PriceCodeStatementsVM> = {},
): Record<string, PriceCodeStatementsVM> => ({
  [KEY]: {
    distributorKey: KEY,
    rows: [statement()],
    conflicted: [],
    live: 1,
    withdrawn: 0,
    readFailed: false,
    note: '1 live meaning. Any code outside them is still refused.',
    unreadable: null,
    ...over,
  },
});

function declarer(result: Partial<PriceCodeWriteVM> = {}, throws?: unknown) {
  const mutateAsync = vi.fn(
    async (_v: {
      distributorKey: string;
      priceCode: string;
      priceBasis: string;
      evidence: string;
    }): Promise<PriceCodeWriteVM> => {
      if (throws) throw throws;
      return { ok: true, mappingId: 'm-new', refusedBecause: null, ...result };
    },
  );
  return { mutateAsync, isPending: false };
}

function withdrawer(result: Partial<PriceCodeWithdrawVM> = {}, throws?: unknown) {
  const mutateAsync = vi.fn(
    async (_v: {
      distributorKey: string;
      mappingId: string;
      reason: string;
    }): Promise<PriceCodeWithdrawVM> => {
      if (throws) throw throws;
      return {
        ok: true,
        mappingId: 'm-1',
        refusedBecause: null,
        rowsAdmitted: 2,
        rowsAdmittedUnreadable: null,
        note: '2 price rows name this mapping. None was deleted; each is now marked by the withdrawal.',
        ...result,
      };
    },
  );
  return { mutateAsync, isPending: false };
}

/** The register for SGWS, so a two-distributor panel never matches the wrong form. */
const sgws = () => within(screen.getByTestId(`cx-df-codes-${KEY}`));

describe('the price-code register — what it shows', () => {
  it('names each live statement, its evidence, and who stated it when', () => {
    render(
      <DistributorFeedPanel
        distributors={reg(catalogue)}
        priceCodes={reg(codes())}
        canManage
      />,
    );
    const r = sgws();
    expect(r.getByText('CON')).toBeInTheDocument();
    expect(r.getByText(/the contract price our licence pays/)).toBeInTheDocument();
    expect(r.getByText(/page 7 of the SPS MSSS guide/)).toBeInTheDocument();
    expect(r.getByText(/Stated by Ada Manager on 2026-09-01/)).toBeInTheDocument();
  });

  it('keeps a withdrawn statement, with its reason, rather than dropping it', () => {
    render(
      <DistributorFeedPanel
        distributors={reg(catalogue)}
        priceCodes={reg(
          codes({
            rows: [
              statement({
                id: 'm-old',
                withdrawnBy: 'u-1',
                withdrawnAt: '2026-09-04T10:00:00.000Z',
                withdrawnReason: 'the rep corrected it to the delivered price',
              }),
            ],
            live: 0,
            withdrawn: 1,
            note: 'No code has a live meaning for this sender; 1 withdrawn statement is kept.',
          }),
        )}
        canManage
      />,
    );
    const r = sgws();
    expect(
      r.getByText(/withdrawn on 2026-09-04 because the rep corrected it/),
    ).toBeInTheDocument();
    expect(r.getByText(/Kept, not deleted/)).toBeInTheDocument();
  });

  it('a failed read of the list is a FAILURE with its reason, never an empty register', () => {
    render(
      <DistributorFeedPanel
        distributors={reg(catalogue)}
        priceCodes={reg(
          codes({
            rows: [],
            live: 0,
            readFailed: true,
            note: '',
            unreadable: 'the codes route answered 503',
          }),
        )}
        canManage
      />,
    );
    const r = sgws();
    expect(
      r.getByText(/price-code statements could not be read/i),
    ).toBeInTheDocument();
    expect(r.getByText(/the codes route answered 503/)).toBeInTheDocument();
    expect(r.getByText(/unknown, not none/i)).toBeInTheDocument();
    expect(r.queryByRole('button', { name: /^Withdraw/ })).not.toBeInTheDocument();
  });

  it("carries the GATEWAY's own sentence when the gateway itself could not read the table", () => {
    render(
      <DistributorFeedPanel
        distributors={reg(catalogue)}
        priceCodes={reg(
          codes({
            rows: [],
            live: 0,
            readFailed: true,
            note: "This house's price-code mappings could not be read. This is unknown, not none.",
          }),
        )}
        canManage
      />,
    );
    expect(
      sgws().getByText(/This house's price-code mappings could not be read/),
    ).toBeInTheDocument();
  });

  it('says it is reading rather than drawing an empty register', () => {
    render(
      <DistributorFeedPanel
        distributors={reg(catalogue)}
        priceCodes={reg(null, { loading: true })}
        canManage
      />,
    );
    expect(
      sgws().getByText(/Reading this house\u2019s price-code statements/i),
    ).toBeInTheDocument();
  });
});

describe('the price-code form — its three refusals', () => {
  const fill = (label: RegExp, value: string) =>
    fireEvent.change(sgws().getByLabelText(label), { target: { value } });

  const mount = (dec = declarer()) => {
    render(
      <DistributorFeedPanel
        distributors={reg(catalogue)}
        priceCodes={reg(codes())}
        declareCode={dec}
        canManage
        sessionName="Ada Manager"
      />,
    );
    return dec;
  };

  it('refuses a blank code, and sends nothing', async () => {
    const dec = mount();
    fill(/What it means here/i, 'contract price');
    fill(/How you know/i, 'page 7');
    fireEvent.click(sgws().getByRole('button', { name: /State what this code means/i }));
    await waitFor(() =>
      expect(sgws().getByText(/Name the code the sender prints on the line/i)).toBeInTheDocument(),
    );
    expect(sgws().getByText(/Nothing was sent\./)).toBeInTheDocument();
    expect(dec.mutateAsync).not.toHaveBeenCalled();
  });

  it('refuses a blank meaning, saying there is no default trade level', async () => {
    const dec = mount();
    fill(/^Code$/i, 'CON');
    fill(/How you know/i, 'page 7');
    fireEvent.click(sgws().getByRole('button', { name: /State what this code means/i }));
    await waitFor(() =>
      expect(
        sgws().getByText(/There is no default trade level here and there will not be one/i),
      ).toBeInTheDocument(),
    );
    expect(dec.mutateAsync).not.toHaveBeenCalled();
  });

  it('refuses blank evidence, naming what evidence looks like', async () => {
    const dec = mount();
    fill(/^Code$/i, 'CON');
    fill(/What it means here/i, 'contract price');
    fireEvent.click(sgws().getByRole('button', { name: /State what this code means/i }));
    await waitFor(() =>
      expect(sgws().getByText(/Say how you know/i)).toBeInTheDocument(),
    );
    expect(dec.mutateAsync).not.toHaveBeenCalled();
  });

  it('sends the three fields against the right sender when all three are there', async () => {
    const dec = mount();
    fill(/^Code$/i, 'msr');
    fill(/What it means here/i, 'the manufacturer suggested retail');
    fill(/How you know/i, "our rep's email of 2026-08-30");
    fireEvent.click(sgws().getByRole('button', { name: /State what this code means/i }));
    await waitFor(() => expect(dec.mutateAsync).toHaveBeenCalledTimes(1));
    expect(dec.mutateAsync.mock.calls[0][0]).toEqual({
      distributorKey: KEY,
      priceCode: 'MSR',
      priceBasis: 'the manufacturer suggested retail',
      evidence: "our rep's email of 2026-08-30",
    });
  });

  it("prints the gateway's refusal verbatim rather than paraphrasing it", async () => {
    const dec = mount(
      declarer({
        ok: false,
        mappingId: null,
        refusedBecause:
          'CON already has a live meaning for this sender. Withdraw it first, with a reason.',
      }),
    );
    fill(/^Code$/i, 'CON');
    fill(/What it means here/i, 'contract price');
    fill(/How you know/i, 'page 7');
    fireEvent.click(sgws().getByRole('button', { name: /State what this code means/i }));
    await waitFor(() =>
      expect(
        sgws().getByText(/CON already has a live meaning for this sender/),
      ).toBeInTheDocument(),
    );
    expect(dec.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it('shows whose name the statement will carry, and says the gateway takes it from the token', () => {
    mount();
    const note = sgws().getByText(/never sent from this page/i);
    expect(note).toHaveTextContent('Ada Manager');
    expect(note).toHaveTextContent(
      /refused rather than written unsigned/i,
    );
  });
});

describe('the withdrawal ceremony', () => {
  const mount = (w = withdrawer()) => {
    render(
      <DistributorFeedPanel
        distributors={reg(catalogue)}
        priceCodes={reg(codes())}
        withdrawCode={w}
        canManage
      />,
    );
    return w;
  };

  it('asks for the reason before it will send anything', async () => {
    const w = mount();
    fireEvent.click(sgws().getByRole('button', { name: 'Withdraw CON' }));
    fireEvent.click(sgws().getByRole('button', { name: 'Withdraw CON' }));
    await waitFor(() =>
      expect(sgws().getByText(/Say why it is being withdrawn/i)).toBeInTheDocument(),
    );
    expect(w.mutateAsync).not.toHaveBeenCalled();
  });

  it('says it marks and never deletes, before it is confirmed', () => {
    mount();
    fireEvent.click(sgws().getByRole('button', { name: 'Withdraw CON' }));
    expect(
      sgws().getByText(/Withdrawing marks; it never deletes/i),
    ).toBeInTheDocument();
  });

  it('sends the reason with the mapping id, and reports how many prices it admitted', async () => {
    const w = mount();
    fireEvent.click(sgws().getByRole('button', { name: 'Withdraw CON' }));
    fireEvent.change(sgws().getByLabelText(/Why is it being withdrawn/i), {
      target: { value: 'the rep corrected it to the delivered price' },
    });
    fireEvent.click(sgws().getByRole('button', { name: 'Withdraw CON' }));
    await waitFor(() => expect(w.mutateAsync).toHaveBeenCalledTimes(1));
    expect(w.mutateAsync.mock.calls[0][0]).toEqual({
      distributorKey: KEY,
      mappingId: 'm-1',
      reason: 'the rep corrected it to the delivered price',
    });
    expect(
      await screen.findByText(/None was deleted; each is now marked by the withdrawal/),
    ).toBeInTheDocument();
  });

  it('reports an uncountable set of admitted prices as UNKNOWN, never as none', async () => {
    const w = mount(
      withdrawer({
        rowsAdmitted: null,
        rowsAdmittedUnreadable: 'permission denied',
        note: 'The prices this mapping admitted could not be counted. That is unknown, not none.',
      }),
    );
    fireEvent.click(sgws().getByRole('button', { name: 'Withdraw CON' }));
    fireEvent.change(sgws().getByLabelText(/Why is it being withdrawn/i), {
      target: { value: 'wrong trade level' },
    });
    fireEvent.click(sgws().getByRole('button', { name: 'Withdraw CON' }));
    await waitFor(() => expect(w.mutateAsync).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(/could not be counted\. That is unknown, not none/),
    ).toBeInTheDocument();
  });

  it("prints the gateway's refusal rather than claiming a withdrawal", async () => {
    mount(
      withdrawer({
        ok: false,
        refusedBecause:
          'no live mapping of this house has that id. It may already have been withdrawn.',
      }),
    );
    fireEvent.click(sgws().getByRole('button', { name: 'Withdraw CON' }));
    fireEvent.change(sgws().getByLabelText(/Why is it being withdrawn/i), {
      target: { value: 'wrong trade level' },
    });
    fireEvent.click(sgws().getByRole('button', { name: 'Withdraw CON' }));
    await waitFor(() =>
      expect(
        screen.getByText(/no live mapping of this house has that id/),
      ).toBeInTheDocument(),
    );
  });
});

describe('who may state a price code', () => {
  it('DISABLES the form and the withdrawal for staff, and never hides them', () => {
    render(
      <DistributorFeedPanel
        distributors={reg(catalogue)}
        priceCodes={reg(codes())}
        declareCode={declarer()}
        withdrawCode={withdrawer()}
        canManage={false}
      />,
    );
    const r = sgws();
    expect(r.getByLabelText(/^Code$/i)).toBeDisabled();
    expect(r.getByLabelText(/What it means here/i)).toBeDisabled();
    expect(r.getByLabelText(/How you know/i)).toBeDisabled();
    expect(
      r.getByRole('button', { name: /State what this code means/i }),
    ).toBeDisabled();
    expect(r.getByRole('button', { name: 'Withdraw CON' })).toBeDisabled();
    expect(
      r.getByText(
        /the gateway refuses both for anyone who is not a manager or an owner/i,
      ),
    ).toBeInTheDocument();
    expect(r.getByText(/shown to you disabled rather than hidden/i)).toBeInTheDocument();
  });

  it('a manager gets the same controls live', () => {
    render(
      <DistributorFeedPanel
        distributors={reg(catalogue)}
        priceCodes={reg(codes())}
        declareCode={declarer()}
        withdrawCode={withdrawer()}
        canManage
      />,
    );
    expect(sgws().getByLabelText(/^Code$/i)).not.toBeDisabled();
    expect(sgws().getByRole('button', { name: 'Withdraw CON' })).not.toBeDisabled();
  });
});

describe('the report walks a manager to the form', () => {
  const file = () => new File(['ISA*00*~'], 'q3.832', { type: 'text/plain' });

  it('an unmapped code from the report pre-fills that sender’s form', async () => {
    const up = uploader({
      documentId: 'doc-1',
      duplicate: false,
      document: { docType: 'price_list' },
      catalog: admission({ admitted: 0, unmappedCodes: ['MSR'], lines: [] }),
    });
    render(
      <DistributorFeedPanel
        distributors={reg(catalogue)}
        priceCodes={reg(codes())}
        upload={up}
        declareCode={declarer()}
        canManage
      />,
    );
    fireEvent.change(screen.getByTestId('cx-df-file'), {
      target: { files: [file()] },
    });
    const link = await screen.findByRole('button', { name: 'State what MSR means' });
    expect((sgws().getByLabelText(/^Code$/i) as HTMLInputElement).value).toBe('');
    fireEvent.click(link);
    await waitFor(() =>
      expect((sgws().getByLabelText(/^Code$/i) as HTMLInputElement).value).toBe('MSR'),
    );
  });

  it('says why there is no link when the upload named no sender', async () => {
    const up = uploader({
      documentId: 'doc-1',
      duplicate: false,
      document: { docType: 'price_list' },
      catalog: admission({
        distributorKey: null,
        admitted: 0,
        unmappedCodes: ['MSR'],
        lines: [],
      }),
    });
    render(<DistributorFeedPanel distributors={reg(catalogue)} upload={up} />);
    fireEvent.change(screen.getByTestId('cx-df-file'), {
      target: { files: [file()] },
    });
    await waitFor(() =>
      expect(
        screen.getByText(/This upload named no sender, so there is no register to state them against/i),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('button', { name: 'State what MSR means' }),
    ).not.toBeInTheDocument();
  });
});
