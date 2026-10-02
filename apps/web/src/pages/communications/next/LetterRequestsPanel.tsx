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
import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AtSign } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { HoldToApprove, Popover } from '@/components/mudavym';
import { apiClient } from '../../../services/api/client';
import { errText, letterRequestKeys } from './Compose/useComposeData';
import { failedReadWords, fmtWhen, readAgainFailed } from './cm-format';

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
  // COMMS-W33 (founder: "A: keep, say when"): a read that fails after it has
  // answered keeps the letters it read, under a line saying when that was — they
  // used to vanish while the page's "Waiting on you" figure still counted them.
  const stale = requests.isError && requests.data !== undefined;
  if (requests.isError && !stale) {
    return (
      <p role="status" data-testid="letter-requests-unread" style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)' }}>
        The letters waiting for a manager could not be read ({failedReadWords(requests.error)}). That does not mean
        none are waiting.
      </p>
    );
  }
  const waiting = requests.data?.requests ?? [];
  const viewer = requests.data?.viewer ?? { userId: null, mayDecline: false };
  if (waiting.length === 0 && !says) {
    return stale ? (
      <p role="status" data-testid="letter-requests-stale" style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)' }}>
        {readAgainFailed(failedReadWords(requests.error), requests.dataUpdatedAt, true, 'the letters waiting for a manager')}
      </p>
    ) : null;
  }
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
      {/* COMMS-W36: under "Waiting on you", so one level below it; the line and
          spacing it had as an h2 are kept, so only its level changed. */}
      <h3 style={{ fontSize: 12, fontWeight: 600, lineHeight: '2rem', letterSpacing: '-0.02em', margin: '0 0 8px', color: 'var(--ink-2, #4F473C)' }}>
        Letters waiting for a manager · {waiting.length}
      </h3>
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
      {stale && (
        <p role="status" data-testid="letter-requests-stale" style={{ margin: '8px 0 0', fontSize: 11.5, color: 'var(--ink-2, #4F473C)' }}>
          {readAgainFailed(failedReadWords(requests.error), requests.dataUpdatedAt, false)}
        </p>
      )}
      {says && (
        <p role="status" data-testid="letter-requests-says" style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--ink-1, #211C16)' }}>
          {says}
        </p>
      )}
      {pullable && (
        <button type="button" disabled={busy} onClick={() => void pullBack()} style={{ ...quietButton, marginTop: 6 }}>
          Pull it back
        </button>
      )}
      {problem && (
        <p role="alert" data-testid="letter-requests-problem" style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--ink-1, #211C16)' }}>
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

export const PILL: Record<PillTone, { words: string; bg: string; fg: string }> = {
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
          <span style={{ color: 'var(--ink-1, #211C16)', fontWeight: 600, overflowWrap: 'anywhere' }}>{r.payload.subject ?? '(no subject)'}</span>
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
            // COMMS-W30: an unbroken run (a pasted link) wraps; the card hides overflow, so it was cut off.
            // COMMS-W36: the letter's own ink, which the dark theme's `p` rule would otherwise replace.
            <p key={i} style={{ margin: i === 0 ? 0 : '0.8em 0 0', whiteSpace: 'pre-line', overflowWrap: 'anywhere', color: 'var(--ink-1, #211C16)' }}>
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

/* COMMS-W16 (founder, 2026-10-01): "replace with a popover that shows couple
   gmail options in simple bar like Gmail, apple, outlook, and at last a 'show
   more'", then "more small, 4 small bars", then "smaller, use real app icons
   not placeholders". Only Gmail sending exists today
   (integrations-oauth.constants.ts `gmail_send`); Outlook and iCloud are shown
   but cannot be pressed, and say so. COMMS-W16c (founder): "as built now,
   where we need google's permission and microsoft license only if its to get
   otherwise sign in marks". Google asks partners to request permission before
   showing the Gmail icon, and Microsoft licenses the Outlook app icon, so each
   app icon waits behind its own grant in ICON_GRANT; until then the bar shows
   the mark that company publishes for signing in with it. Apple licenses none
   of its icons, so iCloud keeps our own envelope.
   COMMS-W20 (founder, 2026-10-01): "either the own houses mail will send with
   the extension of our 'Sent via Mudavym' or we will give ...@mudavym.com
   account"; W20b: both paths, the Mudavym address "Not yet" until the
   created-mailbox build (COMMS-W13b) lands. */
type MailboxId = 'gmail_send' | 'outlook' | 'icloud' | 'mudavym';
/* The chooser's options: what Mudavym can connect today, not anything about a
   house (ADR 0051's descriptor vocabulary). `disabled` is a mailbox Mudavym
   cannot send from yet, `hint` the words beside its name, `description` why. */
const MAILBOXES: { id: MailboxId; name: string; disabled: boolean; hint: string; description?: string }[] = [
  { id: 'gmail_send', name: 'Gmail', disabled: false, hint: 'Sending only' },
  { id: 'outlook', name: 'Outlook', disabled: true, hint: 'Not yet' },
  { id: 'icloud', name: 'iCloud Mail', disabled: true, hint: 'Not yet' },
  {
    id: 'mudavym',
    name: '@mudavym.com',
    disabled: true,
    hint: 'Not yet',
    description: 'A name@mudavym.com address for this house cannot be given yet; Gmail is the only way to send today.',
  },
];

/** Where each app icon's permission is recorded once granted (who, when, reference); null shows the sign-in mark. */
const ICON_GRANT: Record<'gmail_send' | 'outlook', string | null> = {
  gmail_send: null, // Google Partner Marketing Hub approval form
  outlook: null, // Microsoft trademark licence, trademarks@microsoft.com
};

/** The mailbox's own app icon once its company has said yes; until then the mark it publishes for sign-in. */
function MailIcon({ id }: { id: MailboxId }) {
  if (id === 'mudavym') return <AtSign size={14} strokeWidth={1.8} aria-hidden="true" style={{ flex: 'none' }} />;
  if (id === 'gmail_send' && ICON_GRANT.gmail_send) {
    return (
      <svg width="16" height="12" viewBox="52 42 88 66" aria-hidden="true" style={{ flex: 'none' }}>
        <path fill="#4285F4" d="M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6" />
        <path fill="#34A853" d="M120 108h14c3.32 0 6-2.69 6-6V59l-20 15" />
        <path fill="#FBBC04" d="M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2" />
        <path fill="#EA4335" d="M72 74V48l24 18 24-18v26L96 92" />
        <path fill="#C5221F" d="M52 51v8l20 15V48l-5.6-4.2c-5.94-4.45-14.4-.22-14.4 7.2" />
      </svg>
    );
  }
  if (id === 'outlook' && ICON_GRANT.outlook) {
    return (
      <svg width="16" height="16" viewBox="0 0 32 32" aria-hidden="true" style={{ flex: 'none' }}>
        <rect x="10" y="4" width="20" height="24" rx="2.5" fill="#0078D4" />
        <path d="M10 14.5 20 21l10-6.5V25.5a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 10 25.5Z" fill="#28A8EA" />
        <rect x="2" y="8" width="16" height="16" rx="2.5" fill="#0F6CBD" />
        <ellipse cx="10" cy="16" rx="3.9" ry="4.7" fill="none" stroke="#fff" strokeWidth="2.2" />
      </svg>
    );
  }
  if (id === 'gmail_send') {
    return (
      <svg width="14" height="14" viewBox="0 0 48 48" aria-hidden="true" style={{ flex: 'none' }}>
        <path
          fill="#EA4335"
          d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
        />
        <path
          fill="#4285F4"
          d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
        />
        <path
          fill="#FBBC05"
          d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
        />
        <path
          fill="#34A853"
          d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
        />
      </svg>
    );
  }
  if (id === 'outlook') {
    return (
      <svg width="14" height="14" viewBox="0 0 22 22" aria-hidden="true" style={{ flex: 'none' }}>
        <rect x="0" y="0" width="10" height="10" fill="#F25022" />
        <rect x="12" y="0" width="10" height="10" fill="#7FBA00" />
        <rect x="0" y="12" width="10" height="10" fill="#00A4EF" />
        <rect x="12" y="12" width="10" height="10" fill="#FFB900" />
      </svg>
    );
  }
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: 'none' }}
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 6.5 8.5 6 8.5-6" />
    </svg>
  );
}

const barStyle: CSSProperties = { padding: '5px 12px', gap: 8, fontSize: 12.5, textDecoration: 'none' };

export function ConnectLink() {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const { pathname, search } = useLocation();
  const back = encodeURIComponent(`${pathname}${search}`);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        data-testid="letter-request-connect"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'inline-block',
          padding: '6px 12px',
          borderRadius: 8,
          border: 0,
          background: 'var(--seal, #1A5E6B)',
          color: 'var(--paper-0, #FFFDF8)',
          fontSize: 12,
          fontWeight: 600,
          whiteSpace: 'nowrap',
          cursor: 'pointer',
        }}
      >
        Connect a mailbox
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchor}
        width={196}
        showClose={false}
        label="Choose the mailbox this house sends from"
      >
        <div data-testid="mailbox-choices" style={{ padding: '3px 0' }}>
          {MAILBOXES.map((m) => (
            <Fragment key={m.id}>
              {m.id === 'mudavym' && (
                // the house's own mailbox above, an address Mudavym gives below
                <div role="separator" style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)', margin: '3px 0' }} />
              )}
              {!m.disabled ? (
                <Link
                  to={`/authorize/${m.id}?returnPath=${back}`}
                  className="mdv-item"
                  data-testid={`mailbox-${m.id}`}
                  style={barStyle}
                >
                  <MailIcon id={m.id} />
                  <span className="mdv-item__text">{m.name}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--ink-4, #665D50)' }}>{m.hint}</span>
                </Link>
              ) : (
                <button
                  type="button"
                  className="mdv-item"
                  disabled
                  data-testid={`mailbox-${m.id}`}
                  title={m.description ?? `${m.name} cannot be connected yet; Gmail is the only mailbox Mudavym can send from today.`}
                  style={{ ...barStyle, cursor: 'not-allowed', color: 'var(--ink-4, #665D50)' }}
                >
                  <span style={{ opacity: 0.55, display: 'flex' }}>
                    <MailIcon id={m.id} />
                  </span>
                  <span className="mdv-item__text">{m.name}</span>
                  <span style={{ fontSize: 10.5 }}>{m.hint}</span>
                </button>
              )}
            </Fragment>
          ))}
          <Link
            to="/connections#sender"
            className="mdv-item"
            data-testid="mailbox-more"
            style={{ ...barStyle, color: 'var(--seal-deep, #14515C)', fontWeight: 600 }}
          >
            <span className="mdv-item__text">Show more</span>
            <span aria-hidden="true">›</span>
          </Link>
        </div>
      </Popover>
    </>
  );
}

export function Recheck({ mailbox }: { mailbox: MailboxRead }) {
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

export function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
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
