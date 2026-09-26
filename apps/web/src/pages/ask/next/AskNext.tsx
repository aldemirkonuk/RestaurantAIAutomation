/**
 * AskNext — the `/ask` page (ADR 0145), live in code for every house.
 *
 * WHAT IT IS. Sketch 114 direction A, the Reading Room — the founder, on
 * 2026-09-21: *"the reading room is the best by far"* — with direction B's
 * trail (what happened, why), as the layout decided that day and recorded in
 * ADR 0145's 2026-09-25 amendment puts it: "wide answers and old folios open
 * on /ask (A's Reading Room look + B's trail)".
 *
 *   - the SHELF: the house readings the asking role may be given, from
 *     `GET /ask/catalogue` (the gateway filters it by role), grouped by
 *     register. Picking a reading reads it — with a subject or a period when
 *     the reading needs one. Typing asks in plain words instead.
 *   - the FOLIO: one ask, read in the order it was computed — the question,
 *     which reading answered, the figures (each a cell of the Finding, with
 *     its provenance), the rows behind them, and what was read. An old folio
 *     opens at `/ask/f/:id`.
 *   - the BOOK: this person's asks in this house, newest first, by day.
 *
 * WHAT IT NEVER DOES. Write. Ask reads and, at most, answers; anything that
 * would change the house goes through the seal elsewhere ("Never without the
 * seal", ADR 0160 round 6k). And it never decides who may see what: a
 * refusal prints the gateway's own line ("Rules in code, label rows").
 *
 * WHAT IT SAYS WHEN IT CANNOT (ADR 0051): the launch gate, the rate limits,
 * the 60 s budget running out, a pending folio, a shelf or book that could
 * not be read — each in words, none as an empty page.
 */

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { askApi, type AskFolio, type AskReading, type AskSubmit } from '@/services/api/ask';
import {
  BOOK_WINDOW,
  EM,
  MONO,
  SANS,
  SERIF,
  askFailure,
  composerProblem,
  ensureFraunces,
  fmtClock,
  fmtValue,
  folioChip,
  folioView,
  groupBook,
  groupShelf,
  newRequestId,
  provenanceMark,
  readFailure,
  readingNeeds,
  traceLine,
  type AskFailure,
} from './ask-format';
import { useAskNextData } from './useAskNextData';

export interface AskNextProps {
  /** Force a ground regardless of the person's choice (ADR 0042). */
  ground?: 'charcoal';
}

/** The one line the founder approved for staff (ADR 0145 round 6, "Yes, own-work only"), verbatim. */
export const STAFF_LINE =
  'Staff can ask about stock, receiving and today’s deliveries. Money, supplier prices and people data are refused with a one-line reason.';

const PAGE_CSS = `
.mudavym .ak-root { max-width: 1180px; margin: 0 auto; padding: 28px 16px 64px; display: grid; gap: 32px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 1024px) { .mudavym .ak-root { grid-template-columns: minmax(0, 1fr) 300px; padding: 36px 32px 72px; } }
.mudavym .ak-eyebrow { font: 500 11px/1.4 ${MONO}; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-4); margin: 0; }
.mudavym .ak-h1 { font: 400 40px/1.1 ${SERIF}; color: var(--ink-1); margin: 6px 0 8px; letter-spacing: -.01em; }
.mudavym .ak-lede { font: 400 14px/1.6 ${SANS}; color: var(--ink-2); margin: 0; max-width: 60ch; }
.mudavym .ak-note { font: 400 12.5px/1.55 ${SANS}; color: var(--ink-3); margin: 8px 0 0; }
.mudavym .ak-form { display: flex; gap: 8px; margin-top: 18px; }
.mudavym .ak-input { flex: 1; min-width: 0; font: 400 15px/1.4 ${SANS}; color: var(--ink-1); background: var(--paper-1); border: 1px solid var(--paper-2); border-radius: 8px; padding: 11px 13px; }
.mudavym .ak-input:focus-visible, .mudavym .ak-btn:focus-visible, .mudavym .ak-card:focus-visible, .mudavym .ak-link:focus-visible { outline: 2px solid var(--seal); outline-offset: 2px; }
.mudavym .ak-btn { font: 500 13px/1 ${SANS}; color: var(--ink-1); background: transparent; border: 1px solid var(--ink-3); border-radius: 8px; padding: 10px 14px; cursor: pointer; white-space: nowrap; }
.mudavym .ak-btn:hover { background: var(--paper-1); border-color: var(--ink-2); }
.mudavym .ak-btn:disabled { color: var(--ink-3); border-color: var(--paper-2); cursor: default; background: transparent; }
.mudavym .ak-band { border: 1px solid var(--paper-2); border-radius: 10px; padding: 14px 16px; margin-top: 16px; }
.mudavym .ak-band p { margin: 0; font: 400 13.5px/1.55 ${SANS}; color: var(--ink-2); }
.mudavym .ak-group { margin-top: 28px; }
.mudavym .ak-group h2 { font: 500 11px/1.4 ${MONO}; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-4); margin: 0 0 10px; }
.mudavym .ak-grid { display: grid; gap: 10px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 640px) { .mudavym .ak-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.mudavym .ak-card { text-align: left; background: transparent; border: 1px solid var(--paper-2); border-radius: 10px; padding: 14px 16px; cursor: pointer; color: inherit; font: inherit; }
.mudavym .ak-card:hover, .mudavym .ak-card[aria-expanded="true"] { border-color: var(--ink-3); background: var(--paper-1); }
.mudavym .ak-card-title { font: 400 18px/1.3 ${SERIF}; color: var(--ink-1); margin: 0; }
.mudavym .ak-card-q { font: 400 13px/1.5 ${SANS}; color: var(--ink-2); margin: 4px 0 0; }
.mudavym .ak-card.is-other { border-style: dashed; cursor: default; }
.mudavym .ak-composer { border: 1px solid var(--ink-3); border-radius: 10px; padding: 14px 16px; margin-top: 10px; display: grid; gap: 10px; }
.mudavym .ak-composer label { font: 400 12.5px/1.4 ${SANS}; color: var(--ink-3); display: grid; gap: 4px; }
.mudavym .ak-folio { border: 1px solid var(--ink-3); border-radius: 12px; padding: 18px 20px; margin-top: 20px; }
.mudavym .ak-folio.is-knowledge { background: var(--paper-1); border-style: dashed; }
.mudavym .ak-q { font: 400 22px/1.3 ${SERIF}; color: var(--ink-1); margin: 4px 0 0; }
.mudavym .ak-title { font: 500 13px/1.4 ${SANS}; color: var(--ink-1); margin: 14px 0 0; }
.mudavym .ak-line { font: 400 14px/1.6 ${SANS}; color: var(--ink-2); margin: 6px 0 0; }
.mudavym .ak-figs { display: flex; flex-wrap: wrap; gap: 18px 28px; margin-top: 14px; }
.mudavym .ak-fig b { display: block; font: 400 30px/1.1 ${SERIF}; color: var(--ink-1); }
.mudavym .ak-fig span { display: block; font: 400 12px/1.4 ${SANS}; color: var(--ink-3); margin-top: 2px; }
.mudavym .ak-fig i { display: block; font: 400 11.5px/1.4 ${MONO}; font-style: normal; color: var(--ink-4); margin-top: 2px; }
.mudavym .ak-rows { width: 100%; border-collapse: collapse; margin-top: 12px; font: 400 12.5px/1.5 ${SANS}; }
.mudavym .ak-rows td { border-top: 1px solid var(--paper-2); padding: 6px 8px 6px 0; color: var(--ink-2); vertical-align: top; }
.mudavym .ak-rows td:first-child { color: var(--ink-3); }
.mudavym .ak-mono { font: 400 12px/1.6 ${MONO}; color: var(--ink-3); margin: 0; }
.mudavym .ak-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.mudavym .ak-book h2 { font: 500 11px/1.4 ${MONO}; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-4); margin: 0; }
.mudavym .ak-day { font: 500 12px/1.4 ${SANS}; color: var(--ink-3); margin: 18px 0 6px; }
.mudavym .ak-entry { display: block; text-decoration: none; color: inherit; padding: 8px 0; border-top: 1px solid var(--paper-2); }
.mudavym .ak-entry[aria-current="page"] { border-left: 2px solid var(--seal); padding-left: 8px; }
.mudavym .ak-entry p { margin: 0; font: 400 13px/1.45 ${SANS}; color: var(--ink-1); }
.mudavym .ak-entry small { font: 400 11.5px/1.4 ${MONO}; color: var(--ink-3); }
.mudavym .ak-link { color: var(--ink-1); font: 500 13px/1.4 ${SANS}; }
@media (prefers-reduced-motion: no-preference) { .mudavym .ak-card, .mudavym .ak-btn { transition: border-color 160ms ease, background-color 160ms ease; } }
`;

function Band({ role, children }: { role?: 'status' | 'alert'; children: ReactNode }) {
  return (
    <div className="ak-band" role={role}>
      {children}
    </div>
  );
}

/* ───────────────────────────────────────────── the folio ──── */

function FolioDocument({
  folio,
  readingTitle,
  onChoose,
  onCheckAgain,
  busy,
}: {
  folio: AskFolio;
  readingTitle: string | null;
  onChoose: (choiceId: string) => void;
  onCheckAgain: () => void;
  busy: boolean;
}) {
  const v = folioView(folio);
  const finding = v.finding;
  const rows = finding?.rows ?? [];
  return (
    <article className={`ak-folio${v.tone === 'knowledge' ? ' is-knowledge' : ''}`} aria-label="The open folio" data-tone={v.tone}>
      <p className="ak-eyebrow">
        {fmtClock(folio.created_at)}
        {folio.reading_id ? ` · ${readingTitle ?? folio.reading_id}${folio.reading_version ? ` · v${folio.reading_version}` : ''}` : ''}
      </p>
      <p className="ak-q">{folio.utterance}</p>
      <p className="ak-title">{v.title}</p>
      {v.line && <p className="ak-line" data-testid="ak-line">{v.line}</p>}
      {v.knowledge !== null && (
        <p className="ak-line" style={{ whiteSpace: 'pre-wrap' }}>
          {v.knowledge}
        </p>
      )}
      {v.figures.length > 0 && (
        <div className="ak-figs">
          {v.figures.map((c) => {
            const mark = provenanceMark(c.provenance);
            return (
              <div className="ak-fig" key={c.id} data-provenance={c.provenance}>
                <b>{fmtValue(c)}</b>
                <span>{c.label}</span>
                {mark && <i>{mark}</i>}
              </div>
            );
          })}
        </div>
      )}
      {v.choices.length > 0 && (
        <div className="ak-chips" role="group" aria-label="The matching records">
          {v.choices.map((ch) => (
            <button key={ch.id} type="button" className="ak-btn" disabled={busy} onClick={() => onChoose(ch.id)}>
              {ch.label || `record ${ch.id.slice(0, 8)}`}
            </button>
          ))}
        </div>
      )}
      {v.tone === 'answer' && rows.length > 0 && (
        <details style={{ marginTop: 14 }}>
          <summary className="ak-link" style={{ cursor: 'pointer' }}>
            The rows behind the figures ({rows.length})
          </summary>
          <table className="ak-rows">
            <tbody>
              {rows.flatMap((r) =>
                r.cells.map((c) => (
                  <tr key={`${r.key}:${c.id}`}>
                    <td>{c.label}</td>
                    <td>{fmtValue(c)}</td>
                    <td>{provenanceMark(c.provenance) ?? 'stated'}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </details>
      )}
      {finding && finding.trace?.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <p className="ak-eyebrow">What was read</p>
          {finding.trace.map((t, i) => (
            <p className="ak-mono" key={`${t.relation}:${i}`}>
              {traceLine(t)}
            </p>
          ))}
          <p className="ak-mono">as of {fmtClock(finding.asOf)}</p>
        </div>
      )}
      <p className="ak-mono" style={{ marginTop: 10 }}>
        {folio.reading_chosen_by === 'page'
          ? 'reading chosen on the page'
          : folio.reading_chosen_by === 'model'
            ? `reading picked by ${folio.pick_model ?? 'the model'}`
            : ''}
        {folio.compose_model ? ` · figures chosen by ${folio.compose_model}` : ''}
      </p>
      {v.tone === 'pending' && (
        <div className="ak-chips">
          <button type="button" className="ak-btn" disabled={busy} onClick={onCheckAgain}>
            Check again
          </button>
        </div>
      )}
    </article>
  );
}

/* ───────────────────────────────────────────── the page ──── */

export default function AskNext({ ground }: AskNextProps) {
  useEffect(() => ensureFraunces(), []);
  const { folioId } = useParams<{ folioId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeRole } = useAuth();
  const { keys, shelf, book, folio: folioQ } = useAskNextData(folioId ?? null);

  const [text, setText] = useState('');
  const [open, setOpen] = useState<AskReading | null>(null);
  const [subjectText, setSubjectText] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [composerNote, setComposerNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<AskFailure | null>(null);
  /** The last request, kept so "Check again" re-sends the SAME id (the gateway returns the saved folio). */
  const [lastRequest, setLastRequest] = useState<AskSubmit | null>(null);
  const [answered, setAnswered] = useState<AskFolio | null>(null);

  const fromSommelier = (location.state as { from?: string } | null)?.from === 'sommelier';
  const readings = shelf.data ?? [];
  const titleOf = useMemo(() => new Map(readings.map((r) => [r.id, r.title])), [readings]);
  const groups = useMemo(() => groupShelf(readings), [readings]);
  const shown: AskFolio | null = folioId ? (answered?.id === folioId ? answered : folioQ.data ?? null) : answered;

  async function send(req: AskSubmit) {
    setBusy(true);
    setFailure(null);
    setLastRequest(req);
    try {
      const saved = await askApi.submit(req);
      setAnswered(saved);
      queryClient.setQueryData(keys.folio(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: keys.book });
      setLastRequest(null);
      if (saved.id !== folioId) navigate(`/ask/f/${saved.id}`);
    } catch (e) {
      setFailure(askFailure(e));
    } finally {
      setBusy(false);
    }
  }

  function onAsk(e: FormEvent) {
    e.preventDefault();
    const utterance = text.trim();
    if (!utterance || busy) return;
    void send({ requestId: newRequestId(), utterance });
  }

  function onRead(r: AskReading) {
    const problem = composerProblem(r, { subjectText, from, to });
    setComposerNote(problem);
    if (problem || busy) return;
    const needs = readingNeeds(r);
    const args = {
      ...(needs.subject ? { subjectText: subjectText.trim() } : {}),
      ...(needs.window ? { from, to } : {}),
    };
    const utterance = needs.subject ? `${r.question} — ${subjectText.trim()}` : r.question;
    void send({ requestId: newRequestId(), utterance, readingId: r.id, readingVersion: r.version, args });
  }

  function onChoose(choiceId: string) {
    if (!shown || !shown.reading_id) return;
    // The pick replaces the typed name: the id is the subject now.
    const args = { ...(shown.reading_args ?? {}), subjectId: choiceId };
    delete args.subjectText;
    void send({
      requestId: newRequestId(),
      utterance: shown.utterance,
      readingId: shown.reading_id,
      readingVersion: shown.reading_version ?? 1,
      args,
      previousFolioId: shown.id,
    });
  }

  async function onCheckFolio() {
    if (!shown) return;
    setBusy(true);
    try {
      const fresh = await askApi.folio(shown.id);
      setAnswered(fresh);
      queryClient.setQueryData(keys.folio(fresh.id), fresh);
      void queryClient.invalidateQueries({ queryKey: keys.book });
    } catch (e) {
      setFailure(askFailure(e));
    } finally {
      setBusy(false);
    }
  }

  function toggle(r: AskReading) {
    setComposerNote(null);
    setSubjectText('');
    setFrom('');
    setTo('');
    setOpen((cur) => (cur?.id === r.id ? null : r));
  }

  const bookFolios = book.data ?? [];
  const days = useMemo(() => groupBook(bookFolios), [bookFolios]);

  return (
    <div className="mudavym" data-ground={ground} style={{ minHeight: '100%', background: 'var(--paper-0)', color: 'var(--ink-1)', fontFamily: SANS }}>
      <style>{PAGE_CSS}</style>
      <div className="ak-root">
        <main aria-labelledby="ak-h1">
          <p className="ak-eyebrow">Mudavym · ask</p>
          <h1 className="ak-h1" id="ak-h1">
            Ask the house.
          </h1>
          <p className="ak-lede">
            Every figure comes out of a reading of the house’s own books, and opens to its rows. What Mudavym cannot read, it says in words.
          </p>
          {fromSommelier && <p className="ak-note">The Sommelier now opens here. Old links and bookmarks still work.</p>}
          {activeRole === 'staff' && <p className="ak-note" data-testid="ak-staff-line">{STAFF_LINE}</p>}

          <form className="ak-form" onSubmit={onAsk} role="search" aria-label="Ask a question">
            <input
              className="ak-input"
              aria-label="Your question"
              placeholder="How much of the house red do we have?"
              value={text}
              maxLength={2000}
              onChange={(e) => setText(e.target.value)}
            />
            <button type="submit" className="ak-btn" disabled={busy || !text.trim()}>
              {busy ? 'Asking…' : 'Ask'}
            </button>
          </form>
          <p className="ak-note">
            Your questions are kept with their answers so they can be checked later. Your house’s owner decides whether they may help improve
            Mudavym, in Settings; no training has started. <Link className="ak-link" to="/privacy">Privacy</Link>
          </p>

          {failure && (
            <Band role="alert">
              <p data-testid="ak-failure" data-kind={failure.kind}>
                {failure.message}
              </p>
              {failure.checkAgain && lastRequest && (
                <div className="ak-chips">
                  <button type="button" className="ak-btn" disabled={busy} onClick={() => void send(lastRequest)}>
                    Check again
                  </button>
                </div>
              )}
            </Band>
          )}

          {folioId && !shown && folioQ.isLoading && (
            <Band role="status">
              <p>Opening the folio…</p>
            </Band>
          )}
          {folioId && !shown && folioQ.isError && (
            <Band role="alert">
              <p>This folio could not be opened: {readFailure(folioQ.error)}</p>
            </Band>
          )}
          {shown && (
            <>
              <FolioDocument
                folio={shown}
                readingTitle={shown.reading_id ? titleOf.get(shown.reading_id) ?? null : null}
                onChoose={onChoose}
                onCheckAgain={() => void onCheckFolio()}
                busy={busy}
              />
              <p className="ak-note">
                <Link className="ak-link" to="/ask">
                  Back to the shelf
                </Link>
              </p>
            </>
          )}

          <section aria-label="The shelf of house readings">
            {shelf.isLoading && (
              <Band role="status">
                <p>Reading the shelf…</p>
              </Band>
            )}
            {shelf.isError && (
              <Band role="alert">
                <p data-testid="ak-shelf-failure">The shelf could not be read: {readFailure(shelf.error)} Typing a question still works.</p>
              </Band>
            )}
            {shelf.isSuccess && readings.length === 0 && (
              <Band>
                <p>No house reading is open to your role. You can still ask a general question; its answer is marked as not from the books.</p>
              </Band>
            )}
            {groups.map((g) => (
              <div className="ak-group" key={g.key}>
                <h2>{g.title}</h2>
                <div className="ak-grid">
                  {g.readings.map((r) => {
                    const isOpen = open?.id === r.id;
                    const needs = readingNeeds(r);
                    return (
                      <div key={r.id}>
                        <button type="button" className="ak-card" aria-expanded={isOpen} onClick={() => toggle(r)} style={{ width: '100%' }}>
                          <p className="ak-card-title">{r.title}</p>
                          <p className="ak-card-q">{r.question}</p>
                        </button>
                        {isOpen && (
                          <div className="ak-composer" role="group" aria-label={`Read: ${r.title}`}>
                            <p className="ak-card-q" style={{ margin: 0 }}>
                              {r.meaning}
                            </p>
                            {needs.subject && (
                              <label>
                                {r.subject === 'order' ? 'Which order' : 'Which item'}
                                <input className="ak-input" value={subjectText} onChange={(e) => setSubjectText(e.target.value)} maxLength={200} />
                              </label>
                            )}
                            {needs.window && (
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <label>
                                  From
                                  <input className="ak-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                                </label>
                                <label>
                                  To
                                  <input className="ak-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                                </label>
                              </div>
                            )}
                            {composerNote && (
                              <p className="ak-line" role="alert" style={{ margin: 0 }}>
                                {composerNote}
                              </p>
                            )}
                            <div>
                              <button type="button" className="ak-btn" disabled={busy} onClick={() => onRead(r)}>
                                Read it
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="ak-group">
              <h2>Not from the house’s books</h2>
              <div className="ak-card is-other">
                <p className="ak-card-title">Pairing, service, the wine itself</p>
                <p className="ak-card-q">
                  Type the question. The answer comes from the model’s own knowledge, is marked as not from the books, and never carries a figure.
                </p>
              </div>
            </div>
          </section>
        </main>

        <aside className="ak-book" aria-labelledby="ak-book-h">
          <h2 id="ak-book-h">The book · your asks in this house</h2>
          {book.isLoading && <p className="ak-note">Reading the book…</p>}
          {book.isError && (
            <p className="ak-note" role="alert" data-testid="ak-book-failure">
              The book could not be read: {readFailure(book.error)} Nothing here says you have asked nothing.
            </p>
          )}
          {book.isSuccess && bookFolios.length === 0 && <p className="ak-note">No asks yet in this house.</p>}
          {book.isSuccess && bookFolios.length >= BOOK_WINDOW && (
            <p className="ak-note" data-testid="ak-book-floor">
              Your newest {BOOK_WINDOW} asks. Older ones are kept, not listed here.
            </p>
          )}
          {days.map((d) => (
            <div key={d.key}>
              <p className="ak-day">{d.heading}</p>
              {d.folios.map((f) => (
                <Link key={f.id} className="ak-entry" to={`/ask/f/${f.id}`} aria-current={f.id === folioId ? 'page' : undefined}>
                  <small>{fmtClock(f.created_at)}</small>
                  <p>{f.utterance || EM}</p>
                  <small>{folioChip(f)}</small>
                </Link>
              ))}
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
