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
import { MONO } from './cm-format';
import { setupFailWords, shortSpan } from './mail-format';
import { ACT, ALERT, NOT_YOURS, Part, QUIET, TEXT } from './MailSetupParts';
import { useMakeAddress, useStartTestLetter, waitingForTestLetter, type MailSetupView } from './useMailSetup';

/**
 * Who a test letter says it is from. The From line of a letter is written by
 * whoever sends it and nothing here checks it, so the page repeats it as a
 * claim, never as a fact (QA round 26, #974 defect 3).
 */
function claimedFrom(from: string | null): string {
  return from ? ` It claims to be from ${from}; nothing checks that.` : '';
}

function TestLetter({ view, now }: { view: MailSetupView; now: number }) {
  const start = useStartTestLetter();
  const { failed, latest } = view.testLetter;
  const lastArrival = view.testLetter.lastArrival ?? null;
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
        Arrived {shortSpan(now - Date.parse(latest.arrivedAt))} ago.{claimedFrom(latest.arrivedFrom)} Mail reaches this house.
      </p>
    );
  } else {
    // An older check can be answered while the newest is still open: the owner
    // started two and sent the first. That letter proves the address as well,
    // so it is shown — but only if it landed after the newest was started, so
    // an old arrival is not presented as news (QA round 26, #974 defect 2).
    const earlier =
      lastArrival && lastArrival.code !== latest.code && Date.parse(lastArrival.arrivedAt) >= started ? lastArrival : null;
    state = (
      <div className="grid gap-1">
        {earlier && (
          <p data-testid="setup-test-earlier" style={{ ...TEXT, color: 'var(--seal-deep, #14515C)', fontWeight: 600 }}>
            An earlier test letter, {earlier.code}, arrived {shortSpan(now - Date.parse(earlier.arrivedAt))} ago.
            {claimedFrom(earlier.arrivedFrom)} Mail reaches this house.
          </p>
        )}
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
          {setupFailWords(start.error, 'test')}
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
              {setupFailWords(make.error, 'address')}
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
            {/* r28 gap 11. Order letters already carry this address as their
                Reply-To (procurement.service.ts sendProviderEmail), so asking
                the owner to "put it on your orders" was advice to do what is
                done. And a letter forwarded by hand is FROM the person who
                forwarded it: the bridge files a letter by its From address
                (rabbitmq-bridge.service.ts, provider lookup by contact_email)
                and has no forwarded-letter handling, so it never "keeps the
                vendor's name". An unknown sender's letter is kept only when it
                carries an attachment or reads as an offer. */}
            <li data-testid="setup-forwarding-give">
              Give this address to your vendors. The order letters Mudavym sends already ask vendors to reply to it.
            </li>
            <li data-testid="setup-forwarding-by-hand">
              A letter you forward by hand arrives from you, not from the vendor, so it is not filed as the
              vendor&rsquo;s. Mudavym reads it as a letter from someone it does not know, and keeps it only when it
              carries an attachment or reads as an offer. Ask the vendor to write to this address instead.
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
