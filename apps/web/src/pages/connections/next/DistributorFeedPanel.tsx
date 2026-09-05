/**
 * Licensed distributors — what is true today, and the two ways in.
 *
 * ADR 0126, the founder's batch-56 answers: *"Invoices + the built 810 ingest,
 * and a letter for a feed"*, *"The house signs; SGWS first, asking for 810"*,
 * *"Build the ingest route and the panel."*
 *
 * WHAT THIS PANEL IS FOR, AND WHY IT IS NOT A CONNECT BUTTON
 * ---------------------------------------------------------
 * Every distributor the register has measured carries `connectable: false` and
 * the measured reason, because no distributor found publishes a price feed a
 * house could connect and two forbid the attempt in their own terms. A page
 * that drew a "Connect" control here would be offering something that cannot
 * work; a page that drew nothing would be telling a house it has no route when
 * it has two. So this panel prints the measurement — the robots rule and the
 * terms clause VERBATIM, with the day they were read — and then the two things
 * a house can actually do: hand over a file it already has, and ask its Sales
 * Consultant for a feed with a letter it signs itself.
 *
 * A FAILED READ IS A FAILURE (ADR 0020 / 0051). `silence` carries the
 * gateway's own sentence when the register could not be read or the house has
 * no jurisdiction, and this panel prints it rather than rendering an empty
 * list that reads as "no distributor operates here".
 *
 * THE REPORT NEVER SAYS "0 ROWS" ALONE. When a catalogue admits nothing the
 * panel prints the gateway's sentence, the per-line refusals, and — when the
 * reason is a price code nobody has stated a meaning for — the codes by name,
 * because that is the one refusal a person can fix in five minutes.
 */

import { useRef, useState } from 'react';
import { Building2, FileUp, Gavel } from 'lucide-react';
import { AttachmentRow } from './AttachmentRow';
import type {
  CatalogueAdmissionVM,
  DistributorCatalogueVM,
  FeedLetterVM,
} from './useConnectionsNextData';

const ICON = { width: 15, height: 15, strokeWidth: 1.8 } as const;

interface Register<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refused: boolean;
}

export interface DistributorFeedPanelProps {
  distributors?: Register<DistributorCatalogueVM>;
  letter?: Register<FeedLetterVM>;
  /** The mutation from `useConnectionsNextData`, kept at arm's length. */
  upload?: {
    mutateAsync: (v: {
      contentBase64: string;
      filename: string;
      distributorKey?: string | null;
      declaredCurrency?: string | null;
    }) => Promise<{
      documentId: string | null;
      duplicate: boolean;
      document: { docType?: string; warnings?: string[] } | null;
      catalog?: CatalogueAdmissionVM;
    }>;
    isPending?: boolean;
  };
}

/** What a distributor's verdict means, in the words a manager reads. */
const VERDICT_WORDS: Record<string, string> = {
  forbidden: 'Forbids automated reading',
  permitted_with_bounds: 'Permits a reader, within bounds',
  unstated: 'Says nothing about automated reading',
};

export function DistributorFeedPanel({
  distributors,
  letter,
  upload,
}: DistributorFeedPanelProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [sender, setSender] = useState('');
  const [report, setReport] = useState<CatalogueAdmissionVM | null>(null);
  const [nonCatalogue, setNonCatalogue] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const cat = distributors?.data ?? null;

  /**
   * Read the file in the browser and hand its bytes to the document door.
   *
   * `FileReader` rather than `arrayBuffer()` because jsdom implements the
   * former and this panel is tested. The failure branch is a real one: a file
   * the browser cannot read must say so, not silently upload nothing.
   */
  const onFile = async (file: File) => {
    setReport(null);
    setNonCatalogue(null);
    setUploadError(null);
    let base64: string;
    try {
      base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('the browser could not read it'));
        reader.onload = () => {
          const result = String(reader.result ?? '');
          resolve(result.slice(result.indexOf(',') + 1));
        };
        reader.readAsDataURL(file);
      });
    } catch (err) {
      setUploadError(
        `${file.name} could not be read in this browser (${(err as Error).message}), so nothing was sent.`,
      );
      return;
    }
    try {
      const out = await upload?.mutateAsync({
        contentBase64: base64,
        filename: file.name,
        distributorKey: sender || null,
      });
      if (out?.catalog) setReport(out.catalog);
      else if (out)
        setNonCatalogue(
          out.document?.docType === 'invoice'
            ? `Read as an invoice and stored${out.duplicate ? ' — this house already held this exact file' : ''}. Its prices reach the register the way every invoice does, as your own paper.`
            : `Stored as ${out.document?.docType ?? 'a document this parser could not classify'}${out.duplicate ? ' — this house already held this exact file' : ''}. It is not an EDI 832 price catalogue, so no catalogue line was priced.`,
        );
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      setUploadError(
        e.response?.data?.message ??
          e.message ??
          'The upload failed and the gateway sent no sentence with it. Nothing was stored.',
      );
    }
  };

  /**
   * Hand the letter to the person as a file.
   *
   * Built from the text the GATEWAY serves, so what a house prints is the text
   * `07-reference/DISTRIBUTOR-INVOICE-FEED-LETTER.md` records and a jest test
   * pins. Guarded because jsdom implements neither `createObjectURL` nor a
   * real click, and a download that throws must not take the panel with it.
   */
  const download = (l: FeedLetterVM) => {
    try {
      const blob = new Blob([l.body], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = l.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      /* The text is on the page above the control; a browser that cannot save
         a Blob has not lost it. */
    }
  };

  return (
    <section className="cx-sec" id="distributors">
      <div className="cx-sec-h">
        <span className="cx-sec-n">Licensed distributors</span>
        <h2>What your distributors will and will not send you</h2>
      </div>
      <p className="cx-sec-d">
        The price your licence pays is not published anywhere. Every distributor
        below was read on the day named beside it — its robots rule and its terms
        of use in their own words — and none of them offers a price feed a house
        can connect. There are two ways in, and neither of them holds your
        distributor login.
      </p>
      <p className="cx-sec-k">
        measured, not assumed · nothing here reaches a distributor · no
        credential is stored
      </p>

      {!distributors || distributors.loading ? (
        <p className="cx-loading">Reading the distributor register…</p>
      ) : distributors.error ? (
        <p className="cx-unread">
          <b>The distributor register could not be read.</b>{' '}
          {distributors.error} That is unknown, not empty: silence here is this
          page failing to ask, never a statement that no distributor operates in
          your state.
        </p>
      ) : (
        <>
          {cat?.silence ? <p className="cx-unread">{cat.silence}</p> : null}

          {(cat?.distributors ?? []).map((d) => (
            <AttachmentRow
              key={d.key}
              icon={<Building2 {...ICON} />}
              title={d.distributor}
              owner="the house's"
              chips={[
                { label: 'Not connectable', tone: 'off' },
                {
                  label: VERDICT_WORDS[d.automatedAccess.verdict] ?? 'Unread',
                  tone:
                    d.automatedAccess.verdict === 'forbidden' ? 'warn' : 'plain',
                },
              ]}
              subtitle={d.portal ? `${d.portal.name} · ${d.portal.url}` : null}
              why={<>{d.availability}</>}
              permissionsLabel="Read on their own pages"
              permissions={[
                { text: d.automatedAccess.robots, can: false },
                {
                  text:
                    d.automatedAccess.terms ??
                    'No terms of use were located to read for this portal. Nothing here is treated as permitted: an unread term is not a permissive one.',
                  can: false,
                },
              ]}
              lastLabel="Measured"
              last={d.automatedAccess.measuredOn}
              lastDetail={
                d.unbuilt ? (
                  <>{d.unbuilt.reason}</>
                ) : (
                  'Nothing was found to connect and nothing was tried.'
                )
              }
              stopNote="There is nothing to stop: no connection to this distributor exists, no credential is held, and no request has ever been sent."
            />
          ))}

          {cat?.connection && !cat.connection.offerable ? (
            <p className="cx-callout">
              <b>No distributor connection is offered, and that is the answer.</b>{' '}
              {cat.connection.notOfferableBecause}
            </p>
          ) : null}
        </>
      )}

      {/* ── way in 1: hand over a file you already have ─────────────────── */}
      <AttachmentRow
        icon={<FileUp {...ICON} />}
        title="Hand over a file you already have"
        owner="the house's"
        chips={[{ label: 'Live', tone: 'on' }]}
        subtitle="EDI 810 invoice or EDI 832 price catalogue · POST /procurement/documents"
        why={
          <>
            The same door your invoices go through, not a second one. An{' '}
            <b>810</b> is read as an invoice. An <b>832</b> is stored as a price
            list, and its lines are priced{' '}
            <em>
              only under the codes a manager of this house has already said the
              meaning of
            </em>{' '}
            — every other line comes back refused, with the code that refused it.
          </>
        }
        permissionsLabel="Needs"
        permissions={[
          { text: 'The file itself, which a person obtained', can: true },
          {
            text: 'For an 832: the sender named, and at least one price code stated',
            can: true,
          },
          { text: 'No distributor login, ever', can: false },
        ]}
        lastLabel="Last upload"
        last={report ? report.uploadedAt.slice(0, 10) : nonCatalogue ? 'just now' : null}
        lastDetail={
          report || nonCatalogue
            ? null
            : 'Nothing has been handed over on this screen yet.'
        }
        controls={[
          {
            label: upload?.isPending ? 'Sending…' : 'Choose a file',
            onClick: () => fileRef.current?.click(),
            disabled: !upload || upload.isPending,
            busy: upload?.isPending,
          },
        ]}
        alert={uploadError}
        stopNote="Uploading stores a document and, for a catalogue, prices only the lines your own statements admit. It writes no stock, no cost and no order."
      />

      <div className="cx-add">
        <label htmlFor="cx-df-sender">Sender, for a price catalogue</label>{' '}
        <select
          id="cx-df-sender"
          value={sender}
          onChange={(e) => setSender(e.target.value)}
        >
          <option value="">Not named — a catalogue will be stored, not priced</option>
          {(cat?.distributors ?? []).map((d) => (
            <option key={d.key} value={d.key}>
              {d.distributor}
            </option>
          ))}
        </select>
        <input
          ref={fileRef}
          type="file"
          data-testid="cx-df-file"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
          }}
        />
      </div>

      {nonCatalogue ? <p className="cx-ledger-note">{nonCatalogue}</p> : null}
      {report ? <AdmissionReport report={report} /> : null}

      {/* ── way in 2: the letter ────────────────────────────────────────── */}
      <AttachmentRow
        icon={<Gavel {...ICON} />}
        title="Ask your Sales Consultant for an invoice feed"
        owner="the house's"
        chips={[{ label: 'A letter you sign', tone: 'plain' }]}
        subtitle={letter?.data?.subject ?? 'The invoice-feed request letter'}
        why={
          <>
            {letter?.data?.signedBy ??
              'The house signs this on its own letterhead, with Mudavym named in it as the software that would receive the file.'}{' '}
            <em>This product never sends it.</em>{' '}
            {letter?.data?.neverSent ??
              'There is no route on this gateway that could: no address field and no schedule.'}
          </>
        }
        permissionsLabel="You complete"
        permissions={(letter?.data?.brackets ?? []).map((b) => ({
          text: b,
          can: true,
        }))}
        lastLabel="First ask"
        last={letter?.data ? "Southern Glazer's" : null}
        lastDetail={
          letter?.error ? (
            <b>The letter could not be read: {letter.error}</b>
          ) : (
            letter?.data?.firstAsk ?? 'Not read yet.'
          )
        }
        controls={[
          {
            label: 'Download the letter',
            onClick: () => letter?.data && download(letter.data),
            disabled: !letter?.data,
          },
        ]}
        alert={letter?.error ?? null}
        stopNote="Nothing is sent by downloading it. It is a text file to print on your letterhead, complete and sign."
      />
    </section>
  );
}

/**
 * What one catalogue upload did, line by line.
 *
 * The gateway's own sentence first, then every refused line with its reason.
 * A count with no reasons is the thing this component exists to make
 * impossible: "0 admitted" and "0 admitted because nobody has said what CON
 * means" send a manager to two completely different places.
 */
function AdmissionReport({ report }: { report: CatalogueAdmissionVM }) {
  const refused = (report.lines ?? []).filter((l) => !l.admitted);
  const admitted = (report.lines ?? []).filter((l) => l.admitted);
  return (
    <div className="cx-ledger" data-testid="cx-df-report">
      <p className="cx-ledger-line">{report.sentence}</p>
      {report.refusedWhole ? (
        <p className="cx-unread">{report.refusedWhole}</p>
      ) : null}
      {report.knownDistributorKeys?.length ? (
        <p className="cx-ledger-note">
          Senders this register holds: {report.knownDistributorKeys.join(', ')}.
        </p>
      ) : null}
      {report.unmappedCodes?.length ? (
        <p className="cx-ledger-note">
          <b>
            Codes nobody here has stated a meaning for:{' '}
            {report.unmappedCodes.join(', ')}.
          </b>{' '}
          State what each one means on this distributor's paper and upload the
          same file again — the lines under them will price, and every row will
          name the statement that admitted it.
        </p>
      ) : null}
      {report.writeFailures?.length ? (
        <ul className="cx-scope">
          {report.writeFailures.map((f) => (
            <li key={f} className="is-not">
              Not recorded: {f}
            </li>
          ))}
        </ul>
      ) : null}
      {admitted.length ? (
        <ul className="cx-scope">
          {admitted.map((l) => (
            <li key={`ok-${l.item}`}>
              {l.item} — {l.rawPrice} {l.currency} as {l.priceBasis} (
              {l.priceCode})
              {l.reason === 'already_recorded' ? ', already on the record' : ''}
            </li>
          ))}
        </ul>
      ) : null}
      {refused.length ? (
        <ul className="cx-scope">
          {refused.map((l, i) => (
            <li key={`no-${l.item}-${i}`} className="is-not">
              {l.item}: {l.detail}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="cx-ledger-note">
        The file itself is stored either way, with its sha256, the person who
        handed it over and the time it arrived. A refused line is a line nobody
        has vouched for yet, never a line that was thrown away.
      </p>
    </div>
  );
}

export default DistributorFeedPanel;
