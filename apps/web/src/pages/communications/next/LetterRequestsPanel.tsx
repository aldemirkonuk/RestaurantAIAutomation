/**
 * Letters a staff member asked a manager to send — the founder's answer (3) of
 * 2026-09-21: *"staff may ASK a manager to confirm a deal or to send a
 * composer letter, with the same request flow as drafted replies (request
 * state, exact text/terms saved, manager releases with one hold)"*.
 *
 * - An owner or a manager sees every waiting letter and releases one with ONE
 *   HOLD: the hold mints the composer's seal over the exact letter that was
 *   asked for, and the release queues it with the request's id, so it keeps
 *   the composer's undo window (answer 7) and can be released only once.
 * - Anyone else sees only their own waiting letters, and nothing to release.
 * - A failed read is "could not be read", never "nothing waiting".
 * - Decline, withdraw, and an undone release (founder, 2026-09-21, verbatim:
 *   "Decline/withdraw; undo re-waits"): an owner or a manager declines a
 *   waiting letter with a reason the person who asked reads; that person may
 *   withdraw their own. A manager who just released one can pull it back from
 *   here while its undo window is open; a letter pulled back comes back here as
 *   waiting, and says so.
 * - A released letter the dispatcher could not send (founder, 2026-09-22,
 *   verbatim pick: "Back to waiting (Recommended)") comes back here as
 *   waiting, with the reason it was not sent, for the manager and for the
 *   person who asked.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { HoldToApprove } from '@/components/mudavym';
import { apiClient } from '../../../services/api/client';
import { errText, letterRequestKeys } from './Compose/useComposeData';
import { fmtWhen } from './cm-format';

export interface LetterRequest {
  id: string;
  kind: 'house_letter';
  providerId: string | null;
  requestedBy: { userId: string | null; name: string | null };
  requestedAt: string;
  payload: {
    providerId?: string;
    to?: string;
    subject?: string;
    body?: string;
    orderId?: string | null;
    templateId?: string | null;
  };
  state: 'waiting' | 'released' | 'closed';
  /** Times a manager released it and pulled it back inside the undo window. */
  undoneCount?: number;
  /** The latest released letter that could not be sent, which put it back to waiting. */
  lastSendFailure?: {
    reason: string;
    at: string;
    releasedBy: { userId: string | null; name: string | null };
    count: number;
  } | null;
}

/** Who is reading the list (from the gateway): an owner or a manager may decline. */
export interface LetterRequestsViewer {
  userId: string | null;
  mayDecline: boolean;
}

/** The letter a release sends: exactly what was asked for, named by its request. */
export function releaseBody(r: LetterRequest) {
  return {
    providerId: r.payload.providerId ?? r.providerId ?? '',
    to: r.payload.to ?? '',
    subject: r.payload.subject ?? '',
    body: r.payload.body ?? '',
    ...(r.payload.orderId ? { orderId: r.payload.orderId } : {}),
    ...(r.payload.templateId ? { templateId: r.payload.templateId } : {}),
    requestId: r.id,
  };
}

/**
 * The house's letter requests. One read, shared by this panel and the page's
 * "Waiting on you" count, so the count and the list cannot disagree.
 */
export function useLetterRequests(restaurantId: string) {
  return useQuery({
    queryKey: letterRequestKeys.forHouse(restaurantId),
    queryFn: async () => {
      const { data } = await apiClient.get<{ requests: LetterRequest[]; viewer?: LetterRequestsViewer }>(
        '/communications/letters/requests',
      );
      return {
        requests: data.requests,
        viewer: data.viewer ?? { userId: null, mayDecline: false },
      };
    },
    enabled: Boolean(restaurantId),
    staleTime: 15_000,
  });
}

export function LetterRequestsPanel({
  restaurantId,
  canRelease,
  noMailbox = false,
  mailbox,
}: {
  restaurantId: string;
  /** From the composer's own standing: this person's hold sends. */
  canRelease: boolean;
  /** This person may send, but the house has no mailbox yet (COMMS-W11). */
  noMailbox?: boolean;
  /** The live mailbox read behind `canRelease` / `noMailbox` (COMMS-W11c). */
  mailbox?: MailboxRead;
}) {
  const qc = useQueryClient();
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const requests = useLetterRequests(restaurantId);
  const [says, setSays] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [declining, setDeclining] = useState<string | null>(null);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  // The letter a release just queued, while it can still be pulled back
  // (founder, 2026-09-21: "undo re-waits"): pulling it back puts the request
  // back to waiting, on the server, and the person who asked is told.
  const [pullable, setPullable] = useState<{ letterId: string; until: number } | null>(null);
  useEffect(() => {
    if (!pullable) return;
    const left = pullable.until - Date.now();
    if (left <= 0) {
      setPullable(null);
      return;
    }
    const t = setTimeout(() => setPullable(null), left);
    return () => clearTimeout(t);
  }, [pullable]);

  const mint = (r: LetterRequest) => async (): Promise<string | null> => {
    setProblem(null);
    try {
      const { data } = await apiClient.post<{ challenge?: string }>(
        '/communications/letters/seal-challenge',
        releaseBody(r),
      );
      return data?.challenge ?? null;
    } catch (e) {
      setProblem(`Nothing was sent: the seal could not be issued (${errText(e)}).`);
      setAttempt((a) => a + 1);
      return null;
    }
  };

  const release = (r: LetterRequest) => async (challenge?: string | null) => {
    setProblem(null);
    setSays(null);
    try {
      const { data } = await apiClient.post<{ says: string; id?: string; dispatchAt?: string; undoMs?: number | null }>(
        '/communications/letters',
        releaseBody(r),
        { headers: { 'X-Seal-Challenge': challenge ?? '' } },
      );
      setSays(data?.says ?? 'Queued.');
      const until = data?.dispatchAt ? Date.parse(data.dispatchAt) : NaN;
      setPullable(data?.id && data?.undoMs && Number.isFinite(until) ? { letterId: data.id, until } : null);
      await qc.invalidateQueries({ queryKey: letterRequestKeys.forHouse(restaurantId) });
      await qc.invalidateQueries({ queryKey: ['house-letter-queued', restaurantId] });
    } catch (e) {
      setProblem(`Nothing was sent: ${errText(e)}`);
      setAttempt((a) => a + 1);
      throw e;
    }
  };

  const close = async (r: LetterRequest, act: 'decline' | 'withdraw') => {
    setProblem(null);
    setSays(null);
    if (act === 'decline' && !why.trim()) {
      setProblem('Say why, so the person who asked can act on it. Nothing was declined.');
      return;
    }
    setBusy(true);
    try {
      const { data } = await apiClient.post<{ says: string }>(
        `/communications/letters/requests/${r.id}/${act}`,
        act === 'decline' ? { reason: why.trim() } : {},
      );
      setSays(data?.says ?? (act === 'decline' ? 'Declined.' : 'Withdrawn.'));
      setDeclining(null);
      setWhy('');
      await qc.invalidateQueries({ queryKey: letterRequestKeys.forHouse(restaurantId) });
    } catch (e) {
      setProblem(`Nothing was changed: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const pullBack = async () => {
    if (!pullable) return;
    setProblem(null);
    setBusy(true);
    try {
      const { data } = await apiClient.post<{ says: string }>(`/communications/letters/${pullable.letterId}/cancel`);
      setSays(data?.says ?? 'Pulled back.');
      setPullable(null);
      await qc.invalidateQueries({ queryKey: letterRequestKeys.forHouse(restaurantId) });
      await qc.invalidateQueries({ queryKey: ['house-letter-queued', restaurantId] });
    } catch (e) {
      // A failed pull-back never reads as a pulled-back letter: it may still leave.
      setProblem(`It was NOT pulled back: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  if (requests.isPending) return null;
  if (requests.isError) {
    return (
      <p role="status" data-testid="letter-requests-unread" style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)' }}>
        The letters waiting for a manager could not be read ({errText(requests.error)}). That is a failed read, not
        an empty list.
      </p>
    );
  }
  const waiting = requests.data?.requests ?? [];
  const viewer = requests.data?.viewer ?? { userId: null, mayDecline: false };
  if (waiting.length === 0 && !says) return null;
  const tone: PillTone = canRelease
    ? 'ready'
    : noMailbox
      ? 'blocked'
      : mailbox?.checking && !mailbox.checkedAt
        ? 'checking'
        : 'waiting';
  const toggle = (id: string) =>
    setOpened((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <section
      aria-label="Letters waiting for a manager"
      data-testid="letter-requests"
      className="mb-6 rounded-xl p-4"
      style={{ border: '1px solid var(--paper-2, #EAE4D8)', background: 'var(--paper-1, #F3EFE6)' }}
    >
      <h2 style={{ fontSize: 12, fontWeight: 600, margin: '0 0 8px', color: 'var(--ink-2, #4F473C)' }}>
        Letters waiting for a manager · {waiting.length}
      </h2>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {waiting.map((r) => (
          <li key={r.id} style={cardStyle}>
            <RequestHead r={r} tone={tone} open={opened.has(r.id)} onToggle={() => toggle(r.id)} />
            {(r.undoneCount ?? 0) > 0 && (
              <p data-testid="letter-request-undone" style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--ink-4, #665D50)' }}>
                It was released and then pulled back before it left, so it is waiting again. Nothing was sent.
              </p>
            )}
            {r.lastSendFailure && (
              <p data-testid="letter-request-send-failed" style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--alarm-deep, #8C3322)' }}>
                {r.lastSendFailure.releasedBy.name ?? 'A manager'} released it, but it could not be sent:{' '}
                {r.lastSendFailure.reason} It is waiting again. Nothing was sent.
              </p>
            )}
            {canRelease && <Readiness basis={mailbox?.basis ?? null} mailbox={mailbox} ready />}
            {canRelease ? (
              <div style={{ maxWidth: 260, marginTop: 6 }}>
                <HoldToApprove
                  key={`${r.id}-${attempt}`}
                  label="Hold to send it as written"
                  approvedLabel="Queued"
                  onChallenge={mint(r)}
                  onApprove={release(r)}
                />
              </div>
            ) : noMailbox ? (
              // COMMS-W11/W11c: an owner or a manager was told to wait for an
              // owner or a manager. They may send; the house has no mailbox to
              // send from, so the checklist says which step is missing.
              <>
                <Readiness basis={mailbox?.basis ?? null} mailbox={mailbox} />
                <div style={{ maxWidth: 260, marginTop: 8 }} title="Connect a mailbox first">
                  <HoldToApprove disabled label="Hold to send it as written" onApprove={() => undefined} />
                </div>
              </>
            ) : (
              <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--ink-4, #665D50)' }}>
                Waiting for an owner or a manager. Nothing has been sent.
              </p>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
              {viewer.mayDecline && declining !== r.id && (
                <button
                  type="button"
                  onClick={() => {
                    setDeclining(r.id);
                    setWhy('');
                  }}
                  style={quietButton}
                >
                  Decline
                </button>
              )}
              {viewer.userId !== null && r.requestedBy.userId === viewer.userId && (
                <button type="button" disabled={busy} onClick={() => void close(r, 'withdraw')} style={quietButton}>
                  Withdraw my request
                </button>
              )}
            </div>
            {declining === r.id && (
              <form
                style={{ marginTop: 6 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void close(r, 'decline');
                }}
              >
                <label htmlFor={`decline-why-${r.id}`} style={{ display: 'block', fontSize: 11, color: 'var(--ink-2, #4F473C)' }}>
                  Why? {r.requestedBy.name ?? 'The person who asked'} reads this.
                </label>
                <textarea
                  id={`decline-why-${r.id}`}
                  value={why}
                  onChange={(e) => setWhy(e.target.value)}
                  maxLength={500}
                  rows={2}
                  style={{
                    width: '100%',
                    marginTop: 4,
                    fontSize: 12,
                    padding: 6,
                    borderRadius: 6,
                    border: '1px solid var(--paper-2, #EAE4D8)',
                    background: 'var(--paper-0, #FBF9F4)',
                    color: 'var(--ink-1, #211C16)',
                  }}
                />
                <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                  <button type="submit" disabled={busy} style={quietButton}>
                    Decline it
                  </button>
                  <button type="button" onClick={() => setDeclining(null)} style={quietButton}>
                    Keep it waiting
                  </button>
                </div>
              </form>
            )}
          </li>
        ))}
      </ul>
      {says && (
        <p role="status" data-testid="letter-requests-says" style={{ margin: '8px 0 0', fontSize: 12 }}>
          {says}
        </p>
      )}
      {pullable && (
        <button type="button" disabled={busy} onClick={() => void pullBack()} style={{ ...quietButton, marginTop: 6 }}>
          Pull it back
        </button>
      )}
      {problem && (
        <p role="alert" data-testid="letter-requests-problem" style={{ margin: '8px 0 0', fontSize: 12 }}>
          {problem}
        </p>
      )}
    </section>
  );
}

const quietButton: CSSProperties = {
  border: 'none',
  background: 'transparent',
  padding: 0,
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--seal-deep, #14515C)',
  cursor: 'pointer',
};

/* The waiting-letter card (COMMS-W11c, walk-through 2026-10-01). Founder, on
   W11: "make it more dynamic and in a way that resembles industry products but
   in our wrapper"; on W11b he picked the card with its own readiness checklist
   (a merge box) over a house-wide banner. It reads the mailbox live: connecting
   one elsewhere flips the state chip to "Ready to send" and unlocks the hold,
   on focus, on remount or on "Check again". */

export type MailboxRead = {
  basis: 'owner' | 'manager' | 'grant' | null;
  checking: boolean;
  checkedAt: number;
  recheck: () => void;
};

type PillTone = 'ready' | 'blocked' | 'checking' | 'waiting';

const PILL: Record<PillTone, { words: string; bg: string; fg: string }> = {
  ready: { words: 'Ready to send', bg: 'var(--seal-tint, rgba(26,94,107,0.1))', fg: 'var(--seal-deep, #14515C)' },
  blocked: { words: 'Can’t send yet', bg: 'var(--warn-tint, rgba(150,96,26,0.14))', fg: 'var(--warn, #96601A)' },
  checking: { words: 'Checking the mailbox…', bg: 'var(--paper-2, #EAE4D8)', fg: 'var(--ink-2, #4F473C)' },
  waiting: { words: 'Waiting for a manager', bg: 'var(--paper-2, #EAE4D8)', fg: 'var(--ink-2, #4F473C)' },
};

const cardStyle: CSSProperties = {
  position: 'relative',
  padding: '12px 12px 12px 50px',
  borderRadius: 10,
  border: '1px solid var(--paper-2, #EAE4D8)',
  background: 'var(--paper-0, #FFFDF8)',
};

function ago(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const min = Math.round((Date.now() - t) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : fmtWhen(iso);
}

function RequestHead({
  r,
  tone,
  open,
  onToggle,
}: {
  r: LetterRequest;
  tone: PillTone;
  open: boolean;
  onToggle: () => void;
}) {
  const name = r.requestedBy.name ?? 'A member whose name could not be read';
  const pill = PILL[tone];
  const body = r.payload.body ?? '';
  const long = body.length > 360 || body.split('\n').length > 6;
  return (
    <>
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 12,
          top: 12,
          width: 28,
          height: 28,
          borderRadius: 999,
          display: 'grid',
          placeItems: 'center',
          fontSize: 12,
          fontWeight: 700,
          background: 'var(--seal-tint, rgba(26,94,107,0.1))',
          color: 'var(--seal-deep, #14515C)',
        }}
      >
        {(r.requestedBy.name ?? '?').trim().charAt(0).toUpperCase() || '?'}
      </span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, color: 'var(--ink-1, #211C16)' }}>
          <strong>{name}</strong> asked to send a letter
        </span>
        <time dateTime={r.requestedAt} title={fmtWhen(r.requestedAt)} style={{ fontSize: 11, color: 'var(--ink-4, #665D50)' }}>
          {ago(r.requestedAt)}
        </time>
        <span
          data-testid="letter-request-state"
          style={{
            marginLeft: 'auto',
            fontSize: 11,
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: 999,
            whiteSpace: 'nowrap',
            background: pill.bg,
            color: pill.fg,
          }}
        >
          {pill.words}
        </span>
      </div>
      <LetterPaper r={r} open={open} long={long} />
      {long && (
        <button type="button" aria-expanded={open} onClick={onToggle} style={{ ...quietButton, marginTop: 4, fontSize: 11.5 }}>
          {open ? 'Show less' : 'Show the whole letter'}
        </button>
      )}
    </>
  );
}

/**
 * COMMS-W11c: the letter as the vendor will read it — an envelope (To,
 * Subject) over the body laid out in its own paragraphs. Nothing is added to
 * the text: paragraphs are where the writer left a blank line, line breaks are
 * where they pressed return. A letter sent as plain text must not be previewed
 * as something richer than it is.
 */
function LetterPaper({ r, open, long }: { r: LetterRequest; open: boolean; long: boolean }) {
  const paras = (r.payload.body ?? '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.replace(/^\n+|\n+$/g, ''))
    .filter((p) => p.trim() !== '');
  const row: CSSProperties = { display: 'grid', gridTemplateColumns: '58px 1fr', gap: 8, fontSize: 12, padding: '2px 0' };
  return (
    <article
      aria-label={`The letter: ${r.payload.subject ?? 'no subject'}`}
      data-testid="letter-request-paper"
      style={{
        marginTop: 10,
        borderRadius: 8,
        border: '1px solid var(--paper-2, #EAE4D8)',
        background: 'var(--paper-0, #FFFDF8)',
        boxShadow: '0 1px 2px rgba(33, 28, 22, 0.06)',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--paper-2, #EAE4D8)', background: 'var(--paper-1, #F3EFE6)' }}>
        <div style={row}>
          <span style={{ color: 'var(--ink-4, #665D50)' }}>To</span>
          <span style={{ color: 'var(--ink-1, #211C16)', overflowWrap: 'anywhere' }}>{r.payload.to ?? 'a vendor'}</span>
        </div>
        <div style={row}>
          <span style={{ color: 'var(--ink-4, #665D50)' }}>Subject</span>
          <span style={{ color: 'var(--ink-1, #211C16)', fontWeight: 600 }}>{r.payload.subject ?? '(no subject)'}</span>
        </div>
      </div>
      <div
        style={{
          position: 'relative',
          padding: '12px 14px 14px',
          maxWidth: '64ch',
          fontSize: 13.5,
          lineHeight: 1.6,
          color: 'var(--ink-1, #211C16)',
          ...(long && !open ? { maxHeight: '8.6em', overflow: 'hidden' } : {}),
        }}
      >
        {paras.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--ink-4, #665D50)' }}>The letter has no text.</p>
        ) : (
          paras.map((p, i) => (
            <p key={i} style={{ margin: i === 0 ? 0 : '0.8em 0 0', whiteSpace: 'pre-line' }}>
              {p}
            </p>
          ))
        )}
        {long && !open && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: '2.4em',
              background: 'linear-gradient(to bottom, rgba(255,253,248,0), var(--paper-0, #FFFDF8))',
            }}
          />
        )}
      </div>
    </article>
  );
}

function ConnectLink() {
  return (
    <Link
      to="/connections"
      data-testid="letter-request-connect"
      style={{
        display: 'inline-block',
        padding: '6px 12px',
        borderRadius: 8,
        background: 'var(--seal, #1A5E6B)',
        color: 'var(--paper-0, #FFFDF8)',
        fontSize: 12,
        fontWeight: 600,
        textDecoration: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      Connect “Gmail — sending only”
    </Link>
  );
}

function Recheck({ mailbox }: { mailbox: MailboxRead }) {
  return (
    <p role="status" style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--ink-4, #665D50)' }}>
      {mailbox.checking
        ? 'Checking the mailbox…'
        : mailbox.checkedAt
          ? `Mailbox checked ${fmtWhen(new Date(mailbox.checkedAt).toISOString())}`
          : 'The mailbox has not been checked yet'}
      {' · '}
      <button type="button" disabled={mailbox.checking} onClick={mailbox.recheck} style={{ ...quietButton, fontSize: 11 }}>
        Check again
      </button>
    </p>
  );
}

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li style={{ display: 'flex', gap: 8, fontSize: 12, color: ok ? 'var(--ink-2, #4F473C)' : 'var(--ink-1, #211C16)' }}>
      <span aria-hidden="true" style={{ width: 12, fontWeight: 700, color: ok ? 'var(--seal, #1A5E6B)' : 'var(--warn, #96601A)' }}>
        {ok ? '✓' : '!'}
      </span>
      <span className="sr-only">{ok ? 'Done: ' : 'Not yet: '}</span>
      <span style={{ flex: 1 }}>{children}</span>
    </li>
  );
}

function Readiness({
  basis,
  mailbox,
  ready = false,
}: {
  basis: MailboxRead['basis'];
  mailbox?: MailboxRead;
  ready?: boolean;
}) {
  const as = basis === 'owner' ? ' as the owner' : basis === 'manager' ? ' as a manager' : basis === 'grant' ? ' under a send grant' : '';
  return (
    <div
      data-testid="letter-request-readiness"
      style={{
        marginTop: 10,
        padding: '8px 10px',
        borderRadius: 8,
        border: '1px solid var(--paper-2, #EAE4D8)',
        background: 'var(--paper-1, #F3EFE6)',
      }}
    >
      <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: 'var(--ink-2, #4F473C)' }}>
        {ready ? 'Ready to leave' : 'Before it can leave'}
      </p>
      <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'grid', gap: 4 }}>
        <Check ok>You may send for this house{as}.</Check>
        <Check ok={ready}>
          {ready ? (
            'The house has a mailbox to send from.'
          ) : (
            <>
              This house has no mailbox to send from.
              <span style={{ display: 'block', marginTop: 6 }}>
                <ConnectLink />
              </span>
            </>
          )}
        </Check>
        <Check ok>It goes exactly as it was asked for.</Check>
      </ul>
      {mailbox && !ready && <Recheck mailbox={mailbox} />}
    </div>
  );
}

export default LetterRequestsPanel;
