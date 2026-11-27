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
import { SANS, failedReadWords } from './cm-format';
import { senderLine, type MailStatus, type SenderLineInput } from './mail-format';
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
}: {
  view: MailSetupView;
  sender: SenderLineInput | null;
  senderFailed: boolean;
}) {
  const navigate = useNavigate();
  const choose = useChooseSender();
  const { failed, choices, chosenConnectionId } = view.senders;
  const sendingNow = choices.find((c) => c.sending)?.connectionId ?? null;
  const [picked, setPicked] = useState<string | null>(null);
  const current = picked ?? chosenConnectionId ?? sendingNow;

  return (
    <Part title="Which address letters leave from">
      <p data-testid="setup-sender-line" style={TEXT}>
        {senderLine(sender, { failed: senderFailed })}
      </p>
      {failed ? (
        <p role="alert" data-testid="setup-senders-unread" style={ALERT}>
          {failed} That does not mean none is connected.
        </p>
      ) : choices.length === 0 ? (
        <>
          <p data-testid="setup-senders-none" style={TEXT}>
            No mailbox of this house is connected for sending yet. Connect one in Connections, and it can be chosen here.
          </p>
          <button type="button" style={LINK} onClick={() => navigate('/connections')}>
            Open Connections
          </button>
        </>
      ) : (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (current) choose.mutate(current, { onSuccess: () => setPicked(null) });
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
                  disabled={!view.canChange || choose.isPending}
                  onChange={() => setPicked(c.connectionId)}
                />
                <span>
                  {choiceName(c)}
                  {c.sending && <span style={{ ...QUIET, marginLeft: 6 }}>· letters leave from here now</span>}
                </span>
              </label>
            ))}
          </fieldset>
          {view.canChange ? (
            <span className="flex flex-wrap items-center gap-3">
              <button type="submit" style={ACT} disabled={!picked || picked === chosenConnectionId || choose.isPending}>
                {choose.isPending ? 'Saving…' : 'Save'}
              </button>
              {chosenConnectionId && (
                <button
                  type="button"
                  style={LINK}
                  disabled={choose.isPending}
                  onClick={() => choose.mutate(null, { onSuccess: () => setPicked(null) })}
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
          {choose.isError && (
            <p role="alert" data-testid="setup-save-failed" style={ALERT}>
              {failedReadWords(choose.error)}.
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
  onBack,
}: {
  /** The tab's own status line, so the two never disagree. */
  status: MailStatus;
  sender: SenderLineInput | null;
  senderFailed: boolean;
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
          The mail setup could not be read ({failedReadWords(q.error)}). That does not mean nothing is set up.
        </p>
      ) : !q.data ? (
        <p style={QUIET}>Reading the mail setup…</p>
      ) : (
        <>
          <Senders view={q.data} sender={sender} senderFailed={senderFailed} />
          <MailArrival view={q.data} now={now} />
        </>
      )}
    </section>
  );
}
