/**
 * "How mail arrives", on the mail setup page (founder /goal 2026-11-07: "check
 * if the email comes and how"): the house's Mudavym address, how to forward to
 * it in plain words, and a test letter that shows whether one arrived and when.
 *
 * The test letter is a `mailto:` the owner sends from any mailbox, the way a
 * vendor would; nothing here sends mail. A failed read says it failed (ADR
 * 0020), and no address is ever invented.
 */

import { useState, type ReactNode } from 'react';
import { MONO, failedReadWords } from './cm-format';
import { shortSpan } from './mail-format';
import { ACT, ALERT, NOT_YOURS, Part, QUIET, TEXT } from './MailSetupParts';
import { useMakeAddress, useStartTestLetter, waitingForTestLetter, type MailSetupView } from './useMailSetup';

function TestLetter({ view, now }: { view: MailSetupView; now: number }) {
  const start = useStartTestLetter();
  const { failed, latest } = view.testLetter;
  const waiting = waitingForTestLetter(view, now);
  const started = latest ? Date.parse(latest.startedAt) : NaN;

  let state: ReactNode;
  if (failed) {
    state = (
      <p role="alert" data-testid="setup-test-unread" style={ALERT}>
        {failed}
      </p>
    );
  } else if (!latest) {
    state = (
      <p data-testid="setup-test-state" data-state="none" style={TEXT}>
        No test letter has been sent yet.
      </p>
    );
  } else if (latest.arrivedAt) {
    state = (
      <p data-testid="setup-test-state" data-state="arrived" style={{ ...TEXT, color: 'var(--seal-deep, #14515C)', fontWeight: 600 }}>
        Arrived {shortSpan(now - Date.parse(latest.arrivedAt))} ago{latest.arrivedFrom ? `, from ${latest.arrivedFrom}` : ''}. Mail
        reaches this house.
      </p>
    );
  } else {
    state = (
      <div className="grid gap-1">
        <p data-testid="setup-test-state" data-state={waiting ? 'waiting' : 'late'} style={TEXT}>
          {waiting
            ? `Not arrived yet. Started ${shortSpan(now - started)} ago; this page checks again every few seconds.`
            : `Not arrived ${shortSpan(now - started)} after it was started. Check that it went to the address above, or send another.`}
        </p>
        <p style={TEXT}>
          <a data-testid="setup-test-mailto" href={latest.mailto} style={{ color: 'var(--seal-deep, #14515C)', fontWeight: 600 }}>
            Open the test letter in your mail app
          </a>{' '}
          and send it from any mailbox. Its subject carries the code{' '}
          <code style={{ fontFamily: MONO }}>{latest.code}</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-2" data-testid="setup-test-letter">
      <h4 style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1, #211C16)' }}>Send a test letter</h4>
      {state}
      {view.canChange ? (
        <button type="button" style={ACT} disabled={start.isPending} onClick={() => start.mutate()}>
          {start.isPending ? 'Starting…' : latest ? 'Send another test letter' : 'Send a test letter'}
        </button>
      ) : (
        <p style={QUIET}>Only an owner or a manager of this house can send a test letter.</p>
      )}
      {start.isError && (
        <p role="alert" data-testid="setup-test-failed" style={ALERT}>
          {failedReadWords(start.error)}.
        </p>
      )}
      <p style={QUIET}>
        The test letter checks the Mudavym address only. Whether your own mailbox is read shows on the status line above.
      </p>
    </div>
  );
}

export function MailArrival({ view, now }: { view: MailSetupView; now: number }) {
  const make = useMakeAddress();
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const { domainReady, address, failed } = view.arrival;

  const copyAddress = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopy('copied');
    } catch {
      setCopy('failed');
    }
  };

  return (
    <Part title="How mail arrives">
      {failed ? (
        <p role="alert" data-testid="setup-address-unread" style={ALERT}>
          {failed} That does not mean the house has none.
        </p>
      ) : !domainReady ? (
        <p data-testid="setup-address" data-state="cannot_receive" style={TEXT}>
          Mudavym cannot receive mail for houses yet, so there is no address to give vendors. Letters vendors send to
          your connected mailbox still arrive while it is read.
        </p>
      ) : !address ? (
        <div className="grid gap-2">
          <p data-testid="setup-address" data-state="none" style={TEXT}>
            This house has no Mudavym address yet. It is an address only this house receives at; vendors who write to
            it reach this house.
          </p>
          {view.canChange ? (
            <button type="button" style={ACT} disabled={make.isPending} onClick={() => make.mutate()}>
              {make.isPending ? 'Making it…' : 'Make the address'}
            </button>
          ) : (
            <p style={QUIET}>{NOT_YOURS}</p>
          )}
          {make.isError && (
            <p role="alert" data-testid="setup-make-failed" style={ALERT}>
              {failedReadWords(make.error)}.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2" data-testid="setup-address" data-state="ready">
            <code style={{ fontFamily: MONO, fontSize: 12.5, color: 'var(--ink-1, #211C16)', overflowWrap: 'anywhere' }}>
              {address}
            </code>
            <button type="button" style={{ ...ACT, padding: '3px 10px', fontSize: 11.5 }} onClick={() => void copyAddress(address)}>
              Copy
            </button>
            {copy !== 'idle' && (
              <span role="status" data-testid="setup-copy" style={{ fontSize: 11, color: 'var(--ink-4, #665D50)' }}>
                {copy === 'copied' ? 'Copied.' : 'It could not be copied; select it and copy it by hand.'}
              </span>
            )}
          </div>
          <ol data-testid="setup-forwarding" style={{ ...TEXT, margin: 0, paddingLeft: 18 }} className="grid gap-1">
            <li>Give this address to your vendors, or put it on your orders as the address to reply to.</li>
            <li>
              To bring vendor mail from your own mailbox here too, forward those letters to this address. A letter
              forwarded as it is keeps the vendor&rsquo;s name.
            </li>
            <li>
              Automatic forwarding from your mailbox&rsquo;s settings asks to confirm with a letter sent to this address.
              Mudavym does not show that letter yet, so automatic forwarding cannot be confirmed from here today.
            </li>
          </ol>
          <TestLetter view={view} now={now} />
        </>
      )}
    </Part>
  );
}
