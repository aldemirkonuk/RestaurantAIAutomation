/**
 * THE DESK'S OWN DOOR FOR PAPER (proposal-receipt rows 3.1, 1.2 and 3.3).
 *
 * /receipts read papers but could not take one: a manager holding a PDF, a
 * photo or an e-invoice file had to go through the receiving screen of one
 * delivery. This strip takes a file here, files it, and says what became of
 * EACH one in the gateway's own words: filed, already on file (and which
 * paper), stored unread with the reason, or a link it refused to make.
 *
 * Beside it, the files that arrived by email, each with its outcome, so a
 * paper the sweep did not file is named with its reason instead of simply
 * being absent from the queue (ADR 0051: absence is not health).
 *
 * The session's call (2026-11-07 /goal): one file per request, in order,
 * rather than all at once. A burst of ten 10 MB uploads is the one way this
 * strip could hurt the gateway, and order keeps each outcome next to its file.
 *
 * Files dropped or chosen WHILE a batch is filing join the end of the same
 * queue and are listed at once as waiting (batch review on PR 1044: they
 * were discarded with no word). Rejected: refusing the drop with a "try
 * again" line — the person would have to find the same files a second time.
 */

import { useCallback, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  documentsApi,
  type DeskUploadReply,
  type EmailArrival,
} from '../../../services/api/documents';
import {
  MAX_UPLOAD_BYTES,
  SCAN_ACCEPT,
  isScannable,
  resetFileInput,
  resolveMimeType,
  validateSelection,
} from '../../../lib/uploadAccept';
import { MONO, SANS, failureReason, fmtDate } from './rc2-format';

/** The desk takes the e-invoice file too: its XML, or the zip it came in. */
export const DESK_ACCEPT = `${SCAN_ACCEPT},.xml,application/xml,text/xml,.zip,application/zip`;

const EINVOICE_EXT_RE = /\.(xml|zip)$/i;

export function isDeskFile(file: File): boolean {
  return isScannable(file) || EINVOICE_EXT_RE.test(file.name) || /xml|zip/.test(file.type);
}

function mimeFor(file: File): string {
  if (file.type) return file.type;
  if (/\.xml$/i.test(file.name)) return 'application/xml';
  if (/\.zip$/i.test(file.name)) return 'application/zip';
  return resolveMimeType(file);
}

async function toBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000)
    bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

export type FileOutcome =
  | { name: string; kind: 'waiting' }
  | { name: string; kind: 'sending' }
  | { name: string; kind: 'filed'; documentId: string; note: string | null; linkRefused: string[] }
  | { name: string; kind: 'on_file'; documentId: string | null; reason: string; linkRefused: string[] }
  | { name: string; kind: 'refused'; reason: string };

/** The gateway's reply, in the desk's words. Exported for the test. */
export function outcomeOf(name: string, r: DeskUploadReply): FileOutcome {
  const linkRefused = r.linkRefused ?? [];
  if (r.duplicate)
    return {
      name,
      kind: 'on_file',
      documentId: r.duplicateOf?.documentId ?? r.documentId,
      reason: r.duplicateOf?.reason ?? 'The same file is already on file, so it was not filed again.',
      linkRefused,
    };
  if (!r.documentId)
    return { name, kind: 'refused', reason: 'The gateway answered without a paper and without a reason.' };
  const e = r.document?.einvoice;
  const note = e
    ? `Read from the ${e.kind} file as written${e.signed ? '; its signature is present but was not checked' : '; it carries no signature'}.`
    : null;
  return { name, kind: 'filed', documentId: r.documentId, note, linkRefused };
}

const ARRIVAL_WORDS: Record<EmailArrival['state'], string> = {
  pending: 'waiting to be read',
  ingested: 'filed',
  duplicate: 'already on file',
  failed: 'not filed',
  not_a_document: 'not a paper',
  backlog: 'older than the sweep reads',
};

const line = { fontFamily: SANS, fontSize: 12, color: 'var(--ink-2, #4F473C)' } as const;
const quiet = { fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-4, #665D50)' } as const;

export function ReceiptsIntake(props: {
  rid: string | null;
  onOpen: (documentId: string) => void;
}) {
  const { rid, onOpen } = props;
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  // Each listed file carries a key, so an outcome lands on ITS row however
  // many files joined the queue after it.
  const [outcomes, setOutcomes] = useState<Array<FileOutcome & { key: number }>>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const queue = useRef<Array<{ key: number; file: File }>>([]);
  const draining = useRef(false);
  const nextKey = useRef(0);
  const [over, setOver] = useState(false);
  const [showArrivals, setShowArrivals] = useState(false);

  const arrivalsQ = useQuery({
    queryKey: ['receipts-next', 'arrivals', rid],
    queryFn: () => documentsApi.arrivals(30),
    enabled: rid !== null && showArrivals,
  });

  const drain = useCallback(async () => {
    if (draining.current) return;
    const settle = (key: number, out: FileOutcome) =>
      setOutcomes((prev) => prev.map((o) => (o.key === key ? { ...out, key } : o)));
    draining.current = true;
    setBusy(true);
    try {
      for (let next = queue.current.shift(); next; next = queue.current.shift()) {
        const { key, file: f } = next;
        settle(key, { name: f.name, kind: 'sending' });
        let out: FileOutcome;
        try {
          const reply = await documentsApi.upload({
            contentBase64: await toBase64(f),
            filename: f.name,
            mimeType: mimeFor(f),
          });
          out = outcomeOf(f.name, reply);
        } catch (e) {
          out = { name: f.name, kind: 'refused', reason: failureReason(e) };
        }
        settle(key, out);
      }
    } finally {
      draining.current = false;
      setBusy(false);
      void qc.invalidateQueries({ queryKey: ['receipts-next'] });
    }
  }, [qc]);

  const take = (files: FileList | File[] | null) => {
    if (!rid) return;
    const { accepted, errors } = validateSelection(files, {
      accept: isDeskFile,
      maxBytes: MAX_UPLOAD_BYTES,
      kindLabel: 'a photo, a PDF or an e-invoice file (.xml or .zip)',
    });
    // Read the selection before clearing the input, so the same file can be
    // chosen again and still fire a change.
    resetFileInput(input.current);
    setSkipped(errors);
    if (!accepted.length) return;
    const joined = accepted.map((file) => ({ key: nextKey.current++, file }));
    const rows = joined.map(({ key, file }) => ({ key, name: file.name, kind: 'waiting' as const }));
    // A new batch on an idle strip replaces the last batch's list; a batch
    // dropped while filing joins the list being filed.
    const joinsRunningBatch = draining.current;
    setOutcomes((prev) => (joinsRunningBatch ? [...prev, ...rows] : rows));
    queue.current.push(...joined);
    void drain();
  };

  if (!rid) return null;

  return (
    <section aria-label="Add papers" className="mb-5">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files);
        }}
        className="flex flex-wrap items-center gap-3 rounded-xl px-4 py-3"
        style={{
          border: `1px dashed ${over ? 'var(--seal, #1A5E6B)' : 'var(--paper-3, #D9D1C2)'}`,
          background: over ? 'var(--seal-tint, rgba(26,94,107,.10))' : 'var(--paper-1, #F3EFE6)',
        }}
      >
        <button
          type="button"
          className="rc-ink"
          onClick={() => input.current?.click()}
          style={{
            fontFamily: SANS,
            fontSize: 12.5,
            fontWeight: 600,
            padding: '6px 12px',
            borderRadius: 8,
            border: '1px solid var(--seal, #1A5E6B)',
            background: 'transparent',
            color: 'var(--seal-deep, #14515C)',
            cursor: 'pointer',
          }}
        >
          Add papers
        </button>
        {busy && <span style={quiet}>Filing… papers added now wait their turn.</span>}
        <span style={quiet}>
          Drop or choose a photo, a PDF, or the e-invoice file (.xml, or the .zip it came in).
        </span>
        <input
          ref={input}
          type="file"
          multiple
          accept={DESK_ACCEPT}
          aria-label="Choose papers to file"
          onChange={(e) => take(e.target.files)}
          style={{ display: 'none' }}
        />
        <button
          type="button"
          className="rc-ink ml-auto"
          aria-expanded={showArrivals}
          onClick={() => setShowArrivals((v) => !v)}
          style={{
            fontFamily: MONO,
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            border: 'none',
            background: 'transparent',
            color: 'var(--ink-4, #665D50)',
            cursor: 'pointer',
          }}
        >
          {showArrivals ? 'Hide arrived by email' : 'Arrived by email'}
        </button>
      </div>

      {(outcomes.length > 0 || skipped.length > 0) && (
        <ul aria-live="polite" className="mt-2" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {skipped.map((s) => (
            <li key={s} style={line}>
              {s}
            </li>
          ))}
          {outcomes.map((o) => (
            <li key={o.key} style={{ ...line, padding: '3px 0' }}>
              <strong style={{ fontWeight: 600 }}>{o.name}</strong>
              {' — '}
              {o.kind === 'waiting' && 'waiting to be filed'}
              {o.kind === 'sending' && 'filing…'}
              {o.kind === 'refused' && <>not filed: {o.reason}</>}
              {o.kind === 'filed' && (
                <>
                  filed.{' '}
                  <button type="button" className="rc-ink" onClick={() => onOpen(o.documentId)} style={linkStyle}>
                    Open it
                  </button>
                  {o.note && <span style={quiet}> {o.note}</span>}
                </>
              )}
              {o.kind === 'on_file' && (
                <>
                  {o.reason}{' '}
                  {o.documentId && (
                    <button type="button" className="rc-ink" onClick={() => onOpen(o.documentId as string)} style={linkStyle}>
                      Open the paper on file
                    </button>
                  )}
                </>
              )}
              {(o.kind === 'filed' || o.kind === 'on_file') &&
                o.linkRefused.map((r) => (
                  <span key={r} style={{ ...quiet, display: 'block' }}>
                    {r}
                  </span>
                ))}
            </li>
          ))}
        </ul>
      )}

      {showArrivals && (
        <div className="mt-2" aria-label="Files that arrived by email">
          {arrivalsQ.isError ? (
            <p role="alert" style={line}>
              The emailed files could not be read: {failureReason(arrivalsQ.error)}. This is not an empty list.
            </p>
          ) : !arrivalsQ.data ? (
            <p style={quiet}>Reading the emailed files…</p>
          ) : arrivalsQ.data.items.length === 0 ? (
            <p style={quiet}>No file has arrived by email.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {arrivalsQ.data.items.map((a) => (
                <li key={a.id} style={{ ...line, padding: '3px 0' }}>
                  <strong style={{ fontWeight: 600 }}>{a.filename ?? 'a file with no name'}</strong>
                  {' · '}
                  {fmtDate(a.arrivedAt)}
                  {' · '}
                  {ARRIVAL_WORDS[a.state]}
                  {a.documentId && (
                    <>
                      {' '}
                      <button type="button" className="rc-ink" onClick={() => onOpen(a.documentId as string)} style={linkStyle}>
                        Open
                      </button>
                    </>
                  )}
                  {a.reason && <span style={{ ...quiet, display: 'block' }}>{a.reason}</span>}
                </li>
              ))}
              {arrivalsQ.data.more && (
                <li style={quiet}>Only the newest 30 are shown; older ones are not counted here.</li>
              )}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

const linkStyle = {
  fontFamily: SANS,
  fontSize: 12,
  fontWeight: 600,
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: 'var(--seal-deep, #14515C)',
  textDecoration: 'underline',
  cursor: 'pointer',
} as const;
