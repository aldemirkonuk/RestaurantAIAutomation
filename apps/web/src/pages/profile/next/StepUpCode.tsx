/**
 * "Confirm it is you" for the acts a device left signed in must not do alone
 * (F-1347): deleting the account, setting a first password and unlinking a
 * sign-in. The same rule, and the same flow, as adding a passkey in
 * `PasskeyRows` (founder 2026-09-25, item 29): signed in within the last ten
 * minutes, it goes straight through; otherwise the gateway answers 403
 * `STEP_UP_REQUIRED`, a six-digit code is emailed to the account's own
 * address, and the field for it names itself `one-time-code` so a phone can
 * fill it from the mail.
 */

import { useState } from 'react';
import { sendStepUpCode } from '../../../services/api/passkeys';
import { getErrorMessage } from '../../../services/api/client';
import { Btn, Field, Note, StatusLine } from './pf-ui';

/** The gateway's "confirm it is you first" refusal, by its code, not its prose. */
export function isStepUpRequired(e: unknown): boolean {
  const res = (e as { response?: { status?: number; data?: { code?: string } } } | null)?.response;
  return res?.status === 403 && res.data?.code === 'STEP_UP_REQUIRED';
}

export interface StepUp {
  /** Where the code went; null until the gateway asked for one. */
  sentTo: string | null;
  code: string;
  setCode: (v: string) => void;
  sending: boolean;
  /** The typed code to send with the retry, or undefined when none was asked for. */
  emailCode: string | undefined;
  /** False while a code was asked for and six digits are not typed yet. */
  ready: boolean;
  send: () => Promise<void>;
  /** True when `e` asked for a code: one is emailed and the field shows. */
  asked: (e: unknown) => boolean;
  reset: () => void;
  error: string | null;
}

export function useStepUpCode(): StepUp {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typed = code.replace(/\s+/g, '');

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const r = await sendStepUpCode();
      setSentTo(r.sentTo);
      setCode('');
    } catch (e) {
      setError(`No code was sent — ${getErrorMessage(e)}`);
    } finally {
      setSending(false);
    }
  };

  return {
    sentTo,
    code,
    setCode,
    sending,
    emailCode: sentTo !== null ? typed : undefined,
    ready: sentTo === null || /^\d{6}$/.test(typed),
    send,
    asked: (e) => {
      if (!isStepUpRequired(e)) return false;
      void send();
      return true;
    },
    reset: () => {
      setSentTo(null);
      setCode('');
      setError(null);
    },
    error,
  };
}

/** The code field, once one was asked for; nothing before that. */
export function StepUpField({ id, stepUp }: { id: string; stepUp: StepUp }) {
  if (stepUp.sentTo === null) {
    if (stepUp.sending) return <Note>Emailing you a code to confirm it is you…</Note>;
    return stepUp.error ? <StatusLine tone="error">{stepUp.error}</StatusLine> : null;
  }
  return (
    <>
      <Field
        id={id}
        label="The code we emailed you"
        autoComplete="one-time-code"
        inputMode="numeric"
        value={stepUp.code}
        onChange={stepUp.setCode}
        placeholder="123456"
        hint={
          <Note>
            You signed in more than ten minutes ago, so we emailed a six-digit code to {stepUp.sentTo} to make sure it
            is you. It works once, for ten minutes.
          </Note>
        }
      />
      <div style={{ marginBottom: 10 }}>
        <Btn disabled={stepUp.sending} onClick={() => void stepUp.send()}>
          {stepUp.sending ? 'Emailing a code…' : 'Send a new code'}
        </Btn>
      </div>
      {stepUp.error && <StatusLine tone="error">{stepUp.error}</StatusLine>}
    </>
  );
}
