/**
 * Mail setup, inside the Mail tab at `?tab=mail&setup=1` (founder /goal
 * 2026-11-07: "which email do we select, how do we prepare that, the portal
 * that leads to there"). A people page, so it stays simple: the status line,
 * then two questions in the house's words —
 *
 * 1. Which address letters leave from: the house's connected mailboxes, and
 *    the one an owner or a manager picks. Staff see the same list, read-only.
 * 2. How mail arrives: the house's Mudavym address, how to forward to it, and
 *    a test letter that shows whether one arrived and when.
 *
 * Honesty rules: a failed read says it failed (ADR 0020); no address is ever
 * invented; nothing on this page sends mail — the test letter is a `mailto:`
 * the owner sends from their own mailbox, the way a vendor would.
 *
 * Connecting (r28 gap 10): an owner or a manager with no sending mailbox, or
 * whose house reads no mailbox, starts Google's permission from here and comes
 * back HERE (`returnPath`), not to Connections. The way back says only what
 * the provider's return said; whether a mailbox is now connected is what this
 * page's own lists read, never the return link. A connection the deployment
 * does not offer is not offered here: the page falls back to Connections,
 * which says why.
 */


import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { REASONS } from '../../authorize-integration/IntegrationReturnNotice';
import { integrationsApi } from '../../../services/api/integrations';
import { SANS } from './cm-format';
import { senderLine, setupFailWords, type MailStatus, type SenderLineInput } from './mail-format';
import { MailArrival } from './MailArrival';
import { ACT, ALERT, LINK, NOT_YOURS, Part, QUIET, TEXT, TONE } from './MailSetupParts';
import { useChooseSender, useMailSetup, type MailSenderChoice, type MailSetupView } from './useMailSetup';

/** Where Google's permission returns to: this page, in the Mail tab. */
export const MAIL_SETUP_RETURN = '/communications?tab=mail&setup=1';

export function consentPath(id: 'gmail_send' | 'gmail_read'): string {
  return `/authorize/${id}?returnPath=${encodeURIComponent(MAIL_SETUP_RETURN)}`;
}

/**
 * Whether this deployment offers each Gmail permission. Read only for an
 * owner or a manager; an unread or unknown catalogue offers nothing, and the
 * page keeps its way to Connections.
 */
function useGmailOffered(enabled: boolean): { send: boolean; read: boolean } {
  const q = useQuery({
    queryKey: ['integration-catalog'],
    queryFn: () => integrationsApi.getCatalog(),
    enabled,
    staleTime: 300_000,
  });
  const rows = Array.isArray(q.data) ? q.data : [];
  const offered = (id: string) => rows.some((r) => r.id === id && r.available === true);
  return { send: enabled && offered('gmail_send'), read: enabled && offered('gmail_read') };
}

const PERMISSION_NAMES: Record<string, string> = {
  gmail_send: 'Sending from your Gmail',
  gmail_read: 'Reading vendor replies in your Gmail',
};

/**
 * What Google's return said, back on this page. A "connected" return is not
 * proof: the sentence points at the lists below, which read what the house
 * holds now.
 */
function ConsentReturn() {
  const [params, setParams] = useSearchParams();
  const status = params.get('integration_status');
  if (!status) return null;
  const integration = params.get('integration') ?? '';
  const name = PERMISSION_NAMES[integration] ?? 'The permission';
  const words =
    status === 'connected'
      ? `${name}: Google sent you back here. Whether it is connected is what this page reads below, not the return itself.`
      : `${name} did not finish, so nothing was connected. ${REASONS[params.get('integration_reason') ?? ''] ?? 'The provider flow returned without a confirmed connection.'}`;
  return (
    <div role="status" data-testid="setup-consent-return" data-state={status === 'connected' ? 'returned' : 'unfinished'} className="grid gap-1">
      <p style={TEXT}>{words}</p>
      <button
        type="button"
        style={LINK}
        onClick={() => {
          const next = new URLSearchParams(params);
          for (const key of ['integration_status', 'integration', 'integration_reason']) next.delete(key);
          setParams(next, { replace: true });
        }}
      >
        Dismiss
      </button>
    </div>
  );
}

function choiceName(c: MailSenderChoice): string {
  const who = c.personName ? ` · connected by ${c.mine ? 'you' : c.personName}` : c.mine ? ' · connected by you' : '';
  return `${c.address ?? 'A mailbox whose address was not recorded'}${who}`;
}

function Senders({
  view,
  sender,
  senderFailed,
  conversationWords,
  sendOffered,
}: {
  view: MailSetupView;
  sender: SenderLineInput | null;
  senderFailed: boolean;
  conversationWords: string | null;
  sendOffered: boolean;
}) {
  const navigate = useNavigate();
  const choose = useChooseSender();
  const { failed, choices, chosenConnectionId } = view.senders;
  const sendingNow = choices.find((c) => c.sending)?.connectionId ?? null;
  const [picked, setPicked] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const current = picked ?? chosenConnectionId ?? sendingNow;
  // With nothing stored, the mailbox sending now can be pinned as it stands,
  // but only if it is the signed-in person's own (QA round 26, #980).
  const mayPin = Boolean(current && choices.find((c) => c.connectionId === current)?.mine);
  const done = () => {
    setPicked(null);
    setSaved(true);
  };

  return (
    <Part title="Which address letters leave from">
      <p data-testid="setup-sender-line" style={TEXT}>
        {senderLine(sender, { failed: senderFailed })}
      </p>
      {conversationWords && (
        <p data-testid="setup-conversation-words" style={TEXT}>
          {conversationWords}
        </p>
      )}
      {failed ? (
        <p role="alert" data-testid="setup-senders-unread" style={ALERT}>
          {failed} That does not mean none is connected.
        </p>
      ) : choices.length === 0 ? (
        <>
          {view.canChange && sendOffered ? (
            <>
              <p data-testid="setup-senders-none" style={TEXT}>
                No mailbox of this house is connected for sending yet. Connect your Gmail here; you sign in to Google
                and come straight back to this page.
              </p>
              <button
                type="button"
                data-testid="setup-connect-send"
                style={ACT}
                onClick={() => navigate(consentPath('gmail_send'))}
              >
                Connect your Gmail to send from it
              </button>
              <p style={QUIET}>The mailbox is yours, not the house&rsquo;s: you can take it back in Connections.</p>
            </>
          ) : (
            <>
              <p data-testid="setup-senders-none" style={TEXT}>
                No mailbox of this house is connected for sending yet. Connect one in Connections, and it can be chosen
                here.
              </p>
              {/* `#grants` is the register the Gmail rows are drawn in; the bare
                  page opened at its top, a long scroll above them (r12 walk). */}
              <button type="button" style={LINK} onClick={() => navigate('/connections#grants')}>
                Open Connections
              </button>
            </>
          )}
        </>
      ) : (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (current && mayPin) {
              setSaved(false);
              choose.mutate(current, { onSuccess: done });
            }
          }}
        >
          <fieldset style={{ border: 0, margin: 0, padding: 0 }} className="grid gap-1.5">
            <legend style={{ ...QUIET, marginBottom: 4 }}>The house&rsquo;s connected mailboxes</legend>
            {choices.map((c) => (
              <label
                key={c.connectionId}
                data-testid="setup-sender-choice"
                className="flex items-baseline gap-2"
                style={{ fontSize: 12.5, color: 'var(--ink-1, #211C16)', overflowWrap: 'anywhere' }}
              >
                <input
                  type="radio"
                  name="house-sender"
                  value={c.connectionId}
                  checked={current === c.connectionId}
                  // Only the person who connected a mailbox may make it the
                  // house's (QA round 26, #973); the server refuses it too.
                  disabled={!view.canChange || choose.isPending || !c.mine}
                  onChange={() => {
                    setSaved(false);
                    setPicked(c.connectionId);
                  }}
                />
                <span>
                  {choiceName(c)}
                  {c.sending && <span style={{ ...QUIET, marginLeft: 6 }}>· letters leave from here now</span>}
                </span>
              </label>
            ))}
          </fieldset>
          {view.canChange && choices.some((c) => !c.mine) && (
            <p data-testid="setup-sender-own-only" style={QUIET}>
              You can choose only a mailbox you connected yourself. A colleague&rsquo;s mailbox is chosen by that
              colleague, here.
            </p>
          )}
          {view.canChange ? (
            <span className="flex flex-wrap items-center gap-3">
              <button type="submit" style={ACT} disabled={!mayPin || current === chosenConnectionId || choose.isPending}>
                {choose.isPending ? 'Saving…' : 'Save'}
              </button>
              {chosenConnectionId && (
                <button
                  type="button"
                  style={LINK}
                  disabled={choose.isPending}
                  onClick={() => {
                    setSaved(false);
                    choose.mutate(null, { onSuccess: done });
                  }}
                >
                  Let Mudavym choose again
                </button>
              )}
            </span>
          ) : (
            <p data-testid="setup-read-only" style={QUIET}>
              {NOT_YOURS}
            </p>
          )}
          {!chosenConnectionId && (
            <p style={QUIET}>
              No mailbox is chosen, so a letter leaves from the mailbox of the person who sends it, or else the first one
              connected.
            </p>
          )}
          <p role="status" aria-live="polite" data-testid="setup-saved" style={QUIET}>
            {saved && !choose.isPending && !choose.isError ? 'Saved.' : ''}
          </p>
          {choose.isError && (
            <p role="alert" data-testid="setup-save-failed" style={ALERT}>
              {setupFailWords(choose.error, 'choose')}
            </p>
          )}
        </form>
      )}
    </Part>
  );
}

export function MailSetup({
  status,
  sender,
  senderFailed,
  conversationWords,
  mailboxSwitchedOff = false,
  readerGranted = 'unknown',
  onBack,
}: {
  /** The tab's own status line, so the two never disagree. */
  status: MailStatus;
  /**
   * The house reader's OWN state is "switched off". The tab's status line says
   * `switched_off` only when nothing else proves the mail (no Mudavym address,
   * no test letter); a house with an address reads "Connected · … · reading
   * your mailbox is switched off", so the line alone cannot carry the switch.
   */
  mailboxSwitchedOff?: boolean;
  /**
   * Whether anyone in the house has let Mudavym read their Gmail (the sender
   * read's `reader.granted`). Only a plain `false` offers to connect reading:
   * an unread or unknown reader offers nothing rather than a guess.
   */
  readerGranted?: boolean | 'unknown';
  sender: SenderLineInput | null;
  senderFailed: boolean;
  /** `conversation.words` from the sender read, the intake sheet's sentence; null when not read. */
  conversationWords: string | null;
  onBack: () => void;
}) {
  const q = useMailSetup();
  const navigate = useNavigate();
  const now = Date.now();
  const offered = useGmailOffered(q.data?.canChange === true);
  return (
    <section aria-label="Mail setup" className="grid gap-3" style={{ fontFamily: SANS }} data-testid="mail-setup">
      <button type="button" onClick={onBack} style={LINK}>
        ← Back to the mail
      </button>
      <ConsentReturn />
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--ink-1, #211C16)' }}>Mail setup</h2>
      <p data-testid="setup-status" data-state={status.state} style={{ ...TEXT, fontWeight: 600, color: TONE[status.tone] }}>
        {status.words}
      </p>
      {q.isError && !q.data ? (
        <p role="alert" data-testid="setup-unread" style={ALERT}>
          {setupFailWords(q.error, 'read')}
        </p>
      ) : !q.data ? (
        <p style={QUIET}>Reading the mail setup…</p>
      ) : (
        <>
          {/* r21: "switched off" had no way forward from Mail. The switch is
              the house's, in Settings (FeaturesSection, "Read this house's
              mailbox"); `?tab=features` scrolls to that register. */}
          {(status.state === 'switched_off' || mailboxSwitchedOff) && (
            <p data-testid="setup-switched-off" style={TEXT}>
              A mailbox is connected for reading, but the house&rsquo;s &ldquo;Read this house&rsquo;s mailbox&rdquo;
              switch in Settings is off, so nothing is read from it.{' '}
              {q.data.canChange ? (
                <button type="button" style={LINK} onClick={() => navigate('/settings?tab=features')}>
                  Open the switch in Settings
                </button>
              ) : (
                'An owner or a manager can turn it on.'
              )}
            </p>
          )}
          {readerGranted === false && q.data.canChange && offered.read && (
            <div className="grid gap-1" data-testid="setup-reader-none">
              <p style={TEXT}>
                No mailbox of this house is read, so a vendor who writes to your own Gmail is not seen here. Let
                Mudavym read vendor replies in your Gmail; you sign in to Google and come straight back to this page.
              </p>
              <button type="button" data-testid="setup-connect-read" style={ACT} onClick={() => navigate(consentPath('gmail_read'))}>
                Let vendor replies in your Gmail land here
              </button>
              <p style={QUIET}>
                Reading also needs the house&rsquo;s &ldquo;Read this house&rsquo;s mailbox&rdquo; switch in Settings to be on.
              </p>
            </div>
          )}
          <Senders
            view={q.data}
            sender={sender}
            senderFailed={senderFailed}
            conversationWords={conversationWords}
            sendOffered={offered.send}
          />
          <MailArrival view={q.data} now={now} />
        </>
      )}
    </section>
  );
}
