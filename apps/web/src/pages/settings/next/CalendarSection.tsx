/**
 * Calendar subscription — an address that is also a credential.
 *
 * Two honesty rules do the work here. The first: no external calendar client
 * has ever been observed subscribing to this feed (`v3.0-TECH-DEBT.md:346-348`),
 * and the gateway serves it as `Content-Disposition: attachment`
 * (`calendar/calendar.controller.ts:601-604`), which most clients read as
 * "download this once". The steps are therefore filed under *Untested* rather
 * than promised. The second: regeneration silently breaks every existing
 * subscription (`calendar.controller.ts:624`), so it is an armed confirm that
 * states the consequence — the die pressed dry, never the seal.
 *
 * The em dash on the token is one of the four that survived being checked. The
 * token is a column on the restaurant row (`restaurants.calendar_ical_token`,
 * baseline_from_production.sql:3596), and that row's `updated_at` moves for any
 * edit to the branch — so quoting it here would be a date about something else.
 */

import { useState } from 'react';
import { Action, ConfirmAction, Disclosure, Micro, Note, Register, Row, SaveFailure } from './SectionKit';
import { MONO, PROVENANCE_UNKNOWN, SANS } from './st-format';
import type { SettingsNextData } from './useSettingsNextData';

export function CalendarSection({ data }: { data: SettingsNextData }) {
  const { ical, regenerateIcal, writer } = data;
  const [copied, setCopied] = useState<string | null>(null);
  const [howOpen, setHowOpen] = useState(false);

  return (
    <Register remote={ical} name="your subscription token">
      {(reg) => {
        const url = `${window.location.origin}/api/v1/calendar/feed/${reg.token}.ics`;
        return (
          <>
            <Note>
              This address serves your calendar as an <code style={{ fontFamily: MONO, fontSize: 11 }}>.ics</code> feed and
              needs no login — the token in it <em>is</em> the credential. Treat it as one.
            </Note>

            <Row
              label="Feed address"
              provenance={{ kept: 'restaurant', when: null, whenUnknown: PROVENANCE_UNKNOWN.icalToken }}
              consequence="Anyone holding this address can read this restaurant's calendar."
              control={
                <Action
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(url);
                      setCopied('Copied to your clipboard.');
                    } catch {
                      setCopied('This browser refused the clipboard — select the address and copy it by hand.');
                    }
                  }}
                >
                  Copy
                </Action>
              }
            >
              <p style={{ fontFamily: MONO, fontSize: 11, wordBreak: 'break-all', color: 'var(--ink-2)',
                background: 'var(--paper-1)', border: '1px solid var(--paper-2)', borderRadius: 8, padding: '7px 9px', margin: '9px 0 0' }}>
                {url}
              </p>
              {copied && <p role="status" style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-3)', margin: '5px 0 0' }}>{copied}</p>}
            </Row>

            <Row
              label="Start again with a new token"
              provenance={{ kept: 'restaurant', when: null, whenUnknown: PROVENANCE_UNKNOWN.icalRegen }}
              consequence="Every calendar already subscribed to the old address stops receiving anything, silently and without warning them. There is no undo, and the old address cannot be brought back."
              control={
                <ConfirmAction
                  label="Regenerate"
                  confirmLabel="Yes, break the old address"
                  busy={writer.busy === 'ical'}
                  consequence="Every existing subscription stops. There is no undo."
                  onConfirm={() => void regenerateIcal()}
                />
              }
            />

            <SaveFailure failed={writer.failed} what="The address above still works." />

            <div style={{ margin: '18px 0 0' }}><Micro>Untested</Micro></div>
            <Note>
              No external calendar client has ever been observed subscribing to this feed. The gateway serves it as
              <code style={{ fontFamily: MONO, fontSize: 11 }}> Content-Disposition: attachment</code>, which most clients
              read as “download this file once” rather than “subscribe to this address”. So the steps below are what
              <em> should</em> work, not what has been seen to.
            </Note>
            <Disclosure summary="The steps, as far as they are known" open={howOpen} onToggle={() => setHowOpen((o) => !o)}>
              <ul style={{ fontFamily: SANS, fontSize: 12, lineHeight: 1.7, color: 'var(--ink-2)', margin: 0, paddingLeft: 18 }}>
                <li><strong>Outlook</strong> — Add calendar → Subscribe from web → paste the address.</li>
                <li><strong>Apple Calendar</strong> — File → New Calendar Subscription → paste the address.</li>
                <li><strong>Google Calendar</strong> — Other calendars (+) → From URL → paste the address.</li>
              </ul>
            </Disclosure>
          </>
        );
      }}
    </Register>
  );
}

export default CalendarSection;
