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
 */


import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SANS } from './cm-format';
import { senderLine, setupFailWords, type MailStatus, type SenderLineInput } from './mail-format';
import { MailArrival } from './MailArrival';
import { ACT, ALERT, LINK, NOT_YOURS, Part, QUIET, TEXT, TONE } from './MailSetupParts';
import { useChooseSender, useMailSetup, type MailSenderChoice, type MailSetupView } from './useMailSetup';

function choiceName(c: MailSenderChoice): string {
  const who = c.personName ? ` · connected by ${c.mine ? 'you' : c.personName}` : c.mine ? ' · connected by you' : '';
  return `${c.address ?? 'A mailbox whose address was not recorded'}${who}`;
}

function Senders({
  view,
  sender,
  senderFailed,
  conversationWords,
}: {
  view: MailSetupView;
  sender: SenderLineInput | null;
  senderFailed: boolean;
  conversationWords: string | null;
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
          <p data-testid="setup-senders-none" style={TEXT}>
            No mailbox of this house is connected for sending yet. Connect one in Connections, and it can be chosen here.
          </p>
          {/* `#grants` is the register the Gmail rows are drawn in; the bare
              page opened at its top, a long scroll above them (r12 walk). */}
          <button type="button" style={LINK} onClick={() => navigate('/connections#grants')}>
            Open Connections
          </button>
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
  onBack,
}: {
  /** The tab's own status line, so the two never disagree. */
  status: MailStatus;
  sender: SenderLineInput | null;
  senderFailed: boolean;
  /** `conversation.words` from the sender read, the intake sheet's sentence; null when not read. */
  conversationWords: string | null;
  onBack: () => void;
}) {
  const q = useMailSetup();
  const now = Date.now();
  return (
    <section aria-label="Mail setup" className="grid gap-3" style={{ fontFamily: SANS }} data-testid="mail-setup">
      <button type="button" onClick={onBack} style={LINK}>
        ← Back to the mail
      </button>
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
          <Senders view={q.data} sender={sender} senderFailed={senderFailed} conversationWords={conversationWords} />
          <MailArrival view={q.data} now={now} />
        </>
      )}
    </section>
  );
}
