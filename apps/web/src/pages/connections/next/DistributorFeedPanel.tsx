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

import { useEffect, useRef, useState } from 'react';
import { Building2, FileUp, Gavel } from 'lucide-react';
import { AttachmentRow } from './AttachmentRow';
import { readError } from './cx-format';
import type {
  CatalogueAdmissionVM,
  DistributorCatalogueVM,
  FeedLetterVM,
  PriceCodeStatementsVM,
  PriceCodeWithdrawVM,
  PriceCodeWriteVM,
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
  /** What this house has said each sender's codes mean, keyed by sender. */
  priceCodes?: Register<Record<string, PriceCodeStatementsVM>>;
  declareCode?: {
    mutateAsync: (v: {
      distributorKey: string;
      priceCode: string;
      priceBasis: string;
      evidence: string;
    }) => Promise<PriceCodeWriteVM>;
    isPending?: boolean;
  };
  withdrawCode?: {
    mutateAsync: (v: {
      distributorKey: string;
      mappingId: string;
      reason: string;
    }) => Promise<PriceCodeWithdrawVM>;
    isPending?: boolean;
  };
  /**
   * Manager or owner.
   *
   * DEFAULTS TO FALSE, and that is deliberate. `/connections` refuses a staff
   * account in words before this panel is ever mounted, so on the page as it
   * stands the prop is always `true`; the default is the answer to the OTHER
   * case — a panel mounted somewhere that forgot to pass it. A missing prop
   * must not read as permission (ADR 0051), and a manager shown the refusal by
   * mistake loses a control, while a staff member shown an enabled form loses
   * the truth about who may state a price.
   */
  canManage?: boolean;
  /** The name this session carries, shown before a statement is made. */
  sessionName?: string | null;
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
  priceCodes,
  declareCode,
  withdrawCode,
  canManage = false,
  sessionName = null,
}: DistributorFeedPanelProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [sender, setSender] = useState('');
  const [currency, setCurrency] = useState('');
  const [report, setReport] = useState<CatalogueAdmissionVM | null>(null);
  const [nonCatalogue, setNonCatalogue] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  /**
   * A code the report said nobody had stated a meaning for, carried to that
   * sender's form. A NEW object per click, so clicking the same code twice
   * after editing the field re-fills it rather than doing nothing.
   */
  const [prefill, setPrefill] = useState<{
    distributorKey: string;
    code: string;
    at: number;
  } | null>(null);

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
    /* The declared currency is refused HERE when it is present and malformed,
       before a byte is sent. Blank is not malformed — it is the ordinary case
       of a file that states its own CUR — so blank is omitted rather than
       padded, and a catalogue with neither is refused whole by the gateway in
       its own words, which this panel prints. What is never done is the one
       thing that would be easy: filling three characters in on the house's
       behalf. */
    const declared = currency.trim().toUpperCase();
    if (declared && !/^[A-Z]{3}$/.test(declared)) {
      setUploadError(
        `'${currency.trim()}' is not an ISO 4217 currency code. Three letters, or leave it empty and let the file state its own — nothing was sent, and the file was not stored.`,
      );
      return;
    }
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
        declaredCurrency: declared || null,
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
            <div key={d.key}>
            <AttachmentRow
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
            <PriceCodeRegister
              distributorKey={d.key}
              distributorName={d.distributor}
              statements={priceCodes?.data?.[d.key]}
              loading={priceCodes?.loading ?? false}
              registerError={priceCodes?.error ?? null}
              canManage={canManage}
              sessionName={sessionName}
              declareCode={declareCode}
              withdrawCode={withdrawCode}
              prefill={prefill?.distributorKey === d.key ? prefill : null}
            />
            </div>
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
        {/* The declared currency, beside the sender and never above it: it
            means nothing without a catalogue, and it is read only when the
            file itself states no CUR. No default, and no placeholder that
            could be mistaken for one. */}
        <label htmlFor="cx-df-currency" className="cx-add-second">
          Currency, if the file states none
        </label>{' '}
        <input
          id="cx-df-currency"
          data-testid="cx-df-currency"
          type="text"
          inputMode="text"
          maxLength={3}
          size={3}
          autoComplete="off"
          value={currency}
          onChange={(e) => setCurrency(e.target.value.toUpperCase())}
        />
        <p className="cx-ctl-note">
          An EDI 832 carries its currency in a <b>CUR</b> segment, and the
          published MSSS sample carries none at all &mdash; so a catalogue that
          states no currency is the common case, not the broken one. Three
          letters here answer it. There is deliberately <b>no default</b>: a
          file with no CUR and nothing declared is refused whole rather than
          read as dollars, because a house buying in lira would then have its
          prices filed as a currency nobody stated. If the file <i>does</i>{' '}
          state a currency and it disagrees with what you type here, the file is
          refused whole and the answer names both: one of the two is wrong and
          nothing here can tell which, so neither is allowed to win quietly.
        </p>
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
      {report ? (
        <AdmissionReport
          report={report}
          onStateCode={
            report.distributorKey
              ? (code) =>
                  setPrefill({
                    distributorKey: report.distributorKey as string,
                    code,
                    at: Date.now(),
                  })
              : null
          }
        />
      ) : null}

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
 * What this house has said one sender's price codes mean, and the form that
 * says it (ADR 0126 §7; the founder, batch 59: *"Build it on /connections in
 * the distributor row"*).
 *
 * WHY IT IS HERE AND NOT ON A SETTINGS PAGE. The statement is about ONE
 * sender's paper, and the only place this product names senders is this row.
 * A manager arrives at it the way the founder described: an 832 comes back
 * refused, the report names the code, and the code is a button that fills this
 * form in.
 *
 * WHAT THE FORM WILL NOT DO. It will not send a blank code, a blank meaning or
 * blank evidence — the gateway refuses all three in words, and refusing them
 * here first means the manager reads the sentence without a round trip. It
 * refuses NOTHING the gateway would admit: every other judgement (the code's
 * shape, a code already live, a name the session cannot resolve) is the
 * server's, and its sentence is printed verbatim rather than paraphrased.
 *
 * WITHDRAWAL IS A CEREMONY, NOT A BUTTON. It asks for the reason first, because
 * the reason is required by a CHECK and because a statement that stopped
 * working and cannot say why leaves the prices it admitted unexplainable. What
 * comes back is the gateway's own sentence about how many prices that statement
 * admitted — a number, or `null` rendered as unknown, never a reassuring zero.
 */
function PriceCodeRegister({
  distributorKey,
  distributorName,
  statements,
  loading,
  registerError,
  canManage,
  sessionName,
  declareCode,
  withdrawCode,
  prefill,
}: {
  distributorKey: string;
  distributorName: string;
  statements?: PriceCodeStatementsVM;
  loading: boolean;
  registerError: string | null;
  canManage: boolean;
  sessionName: string | null;
  declareCode?: DistributorFeedPanelProps['declareCode'];
  withdrawCode?: DistributorFeedPanelProps['withdrawCode'];
  prefill: { code: string; at: number } | null;
}) {
  const codeRef = useRef<HTMLInputElement | null>(null);
  const [code, setCode] = useState('');
  const [basis, setBasis] = useState('');
  const [evidence, setEvidence] = useState('');
  const [formNote, setFormNote] = useState<Note | null>(null);
  const [sending, setSending] = useState(false);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [withdrawNote, setWithdrawNote] = useState<Note | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);

  useEffect(() => {
    if (!prefill) return;
    setCode(prefill.code);
    setFormNote(null);
    codeRef.current?.focus();
  }, [prefill]);

  const rows = statements?.rows ?? [];
  const live = rows.filter((r) => !r.withdrawnAt);
  const gone = rows.filter((r) => r.withdrawnAt);
  const id = (part: string) => `cx-pc-${part}-${distributorKey}`;

  const submit = async () => {
    setFormNote(null);
    /* The three refusals, in the gateway's own order. Each says NOTHING WAS
       SENT, because "refused" and "sent and refused" are different facts and
       only one of them leaves a row anywhere. */
    if (!code.trim()) {
      setFormNote({
        tone: 'refused',
        text: "Name the code the sender prints on the line — the CTP02 price identifier, such as CON, CAT or C01. Nothing was sent.",
      });
      return;
    }
    if (!basis.trim()) {
      setFormNote({
        tone: 'refused',
        text: 'Say what the code means for this house. There is no default trade level here and there will not be one: a default would be this product naming a price it was never told. Nothing was sent.',
      });
      return;
    }
    if (!evidence.trim()) {
      setFormNote({
        tone: 'refused',
        text: "Say how you know — the distributor's implementation guide, your rep's email, a printed price sheet. A year from now, 'somebody typed it' and 'page 7 of the guide' are different qualities of evidence and the row must be able to tell them apart. Nothing was sent.",
      });
      return;
    }
    if (!declareCode) {
      setFormNote({
        tone: 'refused',
        text: 'This screen holds no route to state a price code, so nothing was sent.',
      });
      return;
    }
    setSending(true);
    try {
      const out = await declareCode.mutateAsync({
        distributorKey,
        priceCode: code.trim(),
        priceBasis: basis.trim(),
        evidence: evidence.trim(),
      });
      if (out?.ok) {
        setCode('');
        setBasis('');
        setEvidence('');
        setFormNote({
          tone: 'done',
          text: `Stated. From now on every line ${distributorName} prices under that code names this statement, and this statement names you — hand the same file over again and the lines it refused will price.`,
        });
      } else {
        setFormNote({
          tone: 'refused',
          text:
            out?.refusedBecause ??
            'The gateway refused the statement and sent no sentence with it. Nothing was written.',
        });
      }
    } catch (e) {
      setFormNote({ tone: 'refused', text: `Not stated — ${readError(e)}` });
    } finally {
      setSending(false);
    }
  };

  const confirmWithdrawal = async (mappingId: string) => {
    setWithdrawNote(null);
    if (!reason.trim()) {
      setWithdrawNote({
        tone: 'refused',
        text: 'Say why it is being withdrawn. A statement that stopped working and cannot say why leaves the prices it admitted unexplainable. Nothing was sent.',
      });
      return;
    }
    if (!withdrawCode) {
      setWithdrawNote({
        tone: 'refused',
        text: 'This screen holds no route to withdraw a statement, so nothing was sent.',
      });
      return;
    }
    setWithdrawing(true);
    try {
      const out = await withdrawCode.mutateAsync({
        distributorKey,
        mappingId,
        reason: reason.trim(),
      });
      if (out?.ok) {
        setWithdrawingId(null);
        setReason('');
        setWithdrawNote({
          tone: 'done',
          text:
            out.note ||
            'Withdrawn. Nothing was deleted: the prices it admitted still name it.',
        });
      } else {
        setWithdrawNote({
          tone: 'refused',
          text:
            out?.refusedBecause ??
            'The gateway refused the withdrawal and sent no sentence with it. Nothing was changed.',
        });
      }
    } catch (e) {
      setWithdrawNote({ tone: 'refused', text: `Not withdrawn — ${readError(e)}` });
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <div className="cx-codes" data-testid={`cx-df-codes-${distributorKey}`}>
      <span className="cx-col-h">
        What {distributorName}&rsquo;s price codes mean here
      </span>

      {loading ? (
        <p className="cx-loading">
          Reading this house&rsquo;s price-code statements&hellip;
        </p>
      ) : registerError ? (
        <p className="cx-unread">
          <b>This house&rsquo;s price-code statements could not be read.</b>{' '}
          {registerError} That is unknown, not none: no code is shown here as
          unmapped on the strength of a read that failed.
        </p>
      ) : statements?.unreadable ? (
        <p className="cx-unread">
          <b>
            {distributorName}&rsquo;s price-code statements could not be read.
          </b>{' '}
          {statements.unreadable} That is unknown, not none — nothing below is a
          list of what this house has stated.
        </p>
      ) : statements?.readFailed ? (
        <p className="cx-unread">
          <b>
            {distributorName}&rsquo;s price-code statements could not be read.
          </b>{' '}
          {statements.note}
        </p>
      ) : !statements ? (
        <p className="cx-ledger-note">
          This house&rsquo;s statements for {distributorName} have not been read
          on this screen. That is silence, not an empty register.
        </p>
      ) : (
        <>
          <p
            className={
              statements.conflicted.length ? 'cx-unread' : 'cx-ledger-note'
            }
          >
            {statements.note}
          </p>

          {live.length ? (
            <ul className="cx-scope">
              {live.map((m) => (
                <li key={m.id}>
                  <b>{m.priceCode}</b> &mdash; {m.priceBasis}
                  <span className="cx-pc-meta">
                    Evidence: {m.evidence}
                  </span>
                  <span className="cx-pc-meta">
                    Stated by {m.declaredByName} on {m.declaredAt.slice(0, 10)}{' '}
                    &middot; {m.codeField}
                  </span>
                  {withdrawingId === m.id ? (
                    <span className="cx-pc-ceremony">
                      <label htmlFor={id(`reason-${m.id}`)}>
                        Why is it being withdrawn?
                      </label>{' '}
                      <input
                        id={id(`reason-${m.id}`)}
                        type="text"
                        value={reason}
                        disabled={!canManage || withdrawing}
                        onChange={(e) => setReason(e.target.value)}
                      />{' '}
                      <button
                        type="button"
                        className="cx-btn"
                        disabled={!canManage || withdrawing}
                        onClick={() => void confirmWithdrawal(m.id)}
                      >
                        {withdrawing
                          ? `Withdrawing ${m.priceCode}…`
                          : `Withdraw ${m.priceCode}`}
                      </button>{' '}
                      <button
                        type="button"
                        className="cx-linkbtn"
                        disabled={withdrawing}
                        onClick={() => {
                          setWithdrawingId(null);
                          setReason('');
                          setWithdrawNote(null);
                        }}
                      >
                        Keep it
                      </button>
                      <span className="cx-ctl-note">
                        Withdrawing marks; it never deletes. The prices this
                        statement already admitted stay exactly where they are
                        and go on naming it &mdash; what stops is its power to
                        admit new ones.
                      </span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="cx-linkbtn"
                      disabled={!canManage}
                      onClick={() => {
                        setWithdrawingId(m.id);
                        setReason('');
                        setWithdrawNote(null);
                      }}
                    >
                      Withdraw {m.priceCode}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : null}

          {gone.length ? (
            <ul className="cx-scope">
              {gone.map((m) => (
                <li key={m.id} className="is-not">
                  <b>{m.priceCode}</b> &mdash; {m.priceBasis}
                  <span className="cx-pc-meta">Evidence: {m.evidence}</span>
                  <span className="cx-pc-meta">
                    Stated by {m.declaredByName} on {m.declaredAt.slice(0, 10)}.
                  </span>
                  {/* A withdrawal is signed, like the statement it ends. The
                      name comes from the row, and a row written before
                      2026-09-06 carries none — which is said as a gap in the
                      record rather than filled in with an account id or a
                      guess. */}
                  <span className="cx-pc-meta">
                    {m.withdrawnByName
                      ? `Withdrawn by ${m.withdrawnByName} on ${(m.withdrawnAt ?? '').slice(0, 10)}: ${m.withdrawnReason ?? 'no reason was recorded'}`
                      : `Withdrawn on ${(m.withdrawnAt ?? '').slice(0, 10)}: ${m.withdrawnReason ?? 'no reason was recorded'} — this withdrawal was recorded before the register began naming the person who made one, so it holds an account and no name`}
                    .
                  </span>
                  <span className="cx-pc-meta">
                    Kept, not deleted. The prices it admitted still name it.
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {withdrawNote ? (
            <p
              className={
                withdrawNote.tone === 'refused' ? 'cx-unread' : 'cx-ledger-line'
              }
              role="status"
            >
              {withdrawNote.text}
            </p>
          ) : null}
        </>
      )}

      {/* ── the form ─────────────────────────────────────────────────── */}
      {/* A statement made while the register is unread WILL be refused: the
          gateway will not add a meaning it cannot check against the ones
          already there, and says so. The form stays on the page anyway — a
          control that disappears teaches nothing about why it is gone. */}
      {registerError || statements?.unreadable || statements?.readFailed ? (
        <p className="cx-ctl-note">
          While these statements cannot be read, a new one will be refused: the
          gateway will not add a meaning it cannot check against the ones this
          house already holds, and it says so rather than writing a second live
          meaning for the same code.
        </p>
      ) : null}
      {!canManage ? (
        <p className="cx-ctl-note">
          Stating what a price code means, and withdrawing a statement, are the
          house&rsquo;s acts: the gateway refuses both for anyone who is not a
          manager or an owner. They are shown to you disabled rather than hidden,
          so this register says what exists and who may do it.
        </p>
      ) : null}

      <div className="cx-pc-form">
        <div>
          <label htmlFor={id('field')}>Code field</label>{' '}
          <select id={id('field')} defaultValue="edi_832_ctp02" disabled>
            <option value="edi_832_ctp02">
              EDI 832 &middot; CTP02 price identifier
            </option>
          </select>
          <p className="cx-ctl-note">
            The only format this product parses. A second one is a decision and a
            migration, not a field.
          </p>
        </div>
        <div>
          <label htmlFor={id('code')}>Code</label>{' '}
          <input
            id={id('code')}
            ref={codeRef}
            type="text"
            maxLength={16}
            autoComplete="off"
            value={code}
            disabled={!canManage || sending}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </div>
        <div>
          <label htmlFor={id('basis')}>What it means here</label>{' '}
          <input
            id={id('basis')}
            type="text"
            autoComplete="off"
            value={basis}
            disabled={!canManage || sending}
            onChange={(e) => setBasis(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor={id('evidence')}>How you know</label>{' '}
          <textarea
            id={id('evidence')}
            rows={2}
            value={evidence}
            disabled={!canManage || sending}
            onChange={(e) => setEvidence(e.target.value)}
          />
        </div>
        <p className="cx-ctl-note">
          This statement is recorded against the name your session carries
          {sessionName ? (
            <>
              , which this browser holds as <b>{sessionName}</b>
            </>
          ) : null}
          . The name is taken from your token by the gateway and never sent from
          this page, so nobody can sign a colleague&rsquo;s name to it; if your
          session resolves no name at all the statement is refused rather than
          written unsigned.
        </p>
        <button
          type="button"
          className="cx-btn"
          disabled={!canManage || sending}
          onClick={() => void submit()}
        >
          {sending ? 'Stating…' : 'State what this code means'}
        </button>
        {formNote ? (
          <p
            className={
              formNote.tone === 'refused' ? 'cx-unread' : 'cx-ledger-line'
            }
            role="status"
          >
            {formNote.text}
          </p>
        ) : null}
        <span className="cx-ctl-note">
          Stating a meaning writes no price. It lets the next catalogue you hand
          over price the lines under that code, and every row it admits carries
          this statement&rsquo;s id, your name and today&rsquo;s date.
        </span>
      </div>
    </div>
  );
}

interface Note {
  tone: 'refused' | 'done';
  text: string;
}

/**
 * What one catalogue upload did, line by line.
 *
 * The gateway's own sentence first, then every refused line with its reason.
 * A count with no reasons is the thing this component exists to make
 * impossible: "0 admitted" and "0 admitted because nobody has said what CON
 * means" send a manager to two completely different places.
 */
function AdmissionReport({
  report,
  onStateCode,
}: {
  report: CatalogueAdmissionVM;
  /** Carry an unmapped code to that sender's form. Null when the upload named
   *  no sender: there is then no register to state it against. */
  onStateCode: ((code: string) => void) | null;
}) {
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
          {onStateCode ? (
            <>
              {' '}
              {report.unmappedCodes.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="cx-linkbtn"
                  onClick={() => onStateCode(c)}
                >
                  State what {c} means
                </button>
              ))}
            </>
          ) : (
            <>
              {' '}
              This upload named no sender, so there is no register to state them
              against: choose the distributor above and hand the file over
              again.
            </>
          )}
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
