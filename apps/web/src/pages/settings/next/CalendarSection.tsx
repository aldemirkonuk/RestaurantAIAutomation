/**
 * My calendar link — one person's own subscription (ADR 0111, review trail
 * 2026-09-21).
 *
 * The founder, 2026-09-21: "every manager, staff and their labeled
 * taskforces/areas, owners have different calendar subscriptions, they can
 * connect their own. Soit should be personalized" — and on a stopped link,
 * "an empty calendar with a little text appeared, and saying calendar link
 * expired, connect again".
 *
 * Three honesty rules do the work here. The first: opening this tab READS;
 * it never makes a link (the GET used to mint the house's token on a bare
 * page open). The second: the address is a credential and is shown ONCE, on
 * the answer to the act that made it — the gateway keeps only a hash — so a
 * returning reader is told that, not shown a dash that looks like "no link".
 * The third: a new link and stopping the link each end the current address at
 * once, so both are an armed confirm that says what the calendar app will
 * show. The category pick and the register of who has connected live on the
 * calendar page, where the rest of the calendar lives.
 *
 * No external calendar app has yet been observed subscribing
 * (`v3.0-TECH-DEBT.md`'s calendar entry). The feed is served inline since
 * ADR 0111 §5's fixes, which is what a subscription needs; the steps below
 * are what should work, filed under Untested until one is seen to.
 */

import { useState } from 'react';
import { Action, ConfirmAction, Disclosure, Micro, Note, Register, Row, SaveFailure } from './SectionKit';
import { MONO, SANS } from './st-format';
import type { SettingsNextData } from './useSettingsNextData';
import { ON_LEAVING, SHOWN_ONCE } from '@/components/calendar-link/calendar-link-copy';

export function CalendarSection({ data }: { data: SettingsNextData }) {
  const { ical, icalIssued, createIcal, regenerateIcal, revokeIcal, writer } = data;
  const [copied, setCopied] = useState<string | null>(null);
  const [howOpen, setHowOpen] = useState(false);

  return (
    <Register remote={ical} name="your calendar link">
      {(link) => {
        if (!link.connected) {
          return (
            <>
              {link.houseLinkRetired && (
                <Note role="status">
                  The shared calendar link for this house was switched off. Everyone now connects
                  their own, showing what they may see. Anyone still on the old link sees
                  “Calendar link expired - connect again”.
                </Note>
              )}
              <Note>{link.scope}</Note>
              <Row
                label="My calendar link"
                provenance={{ kept: 'account', when: null, whenUnknown: 'you have not connected a calendar' }}
                consequence={`Makes an address only you use. It needs no login, so anyone holding it sees what you see. ${SHOWN_ONCE}`}
                control={
                  <Action
                    disabled={writer.busy === 'ical-create'}
                    onClick={() => void createIcal()}
                  >
                    {writer.busy === 'ical-create' ? 'Connecting…' : 'Connect my calendar'}
                  </Action>
                }
              />
              <SaveFailure failed={writer.failed} what="No link was made." />
            </>
          );
        }
        return (
          <>
            <Note>{link.scope} {ON_LEAVING}</Note>

            <Row
              label="My calendar link"
              provenance={{ kept: 'account', when: link.issuedAt, verb: 'made' }}
              consequence={
                icalIssued ? `Copy it now. ${SHOWN_ONCE}` : SHOWN_ONCE
              }
              control={
                icalIssued ? (
                  <Action
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(icalIssued);
                        setCopied('Copied. Paste it into your calendar app.');
                      } catch {
                        setCopied('This browser refused the clipboard — select the address and copy it by hand.');
                      }
                    }}
                  >
                    Copy
                  </Action>
                ) : undefined
              }
            >
              {icalIssued && (
                <p data-secret="credential" style={{ fontFamily: MONO, fontSize: 11, wordBreak: 'break-all', color: 'var(--ink-2)',
                  background: 'var(--paper-1)', border: '1px solid var(--paper-2)', borderRadius: 8, padding: '7px 9px', margin: '9px 0 0' }}>
                  {icalIssued}
                </p>
              )}
              {copied && <p role="status" style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-3)', margin: '5px 0 0' }}>{copied}</p>}
            </Row>

            <Row
              label="Get a new link"
              provenance={{ kept: 'account', when: link.lastFetchedAt, verb: 'last read by a calendar app', whenUnknown: 'no calendar app has read it yet' }}
              consequence="Your current address stops at once. Any calendar using it shows “Calendar link expired - connect again” until you add the new one."
              control={
                <ConfirmAction
                  label="Get a new link"
                  confirmLabel="Yes, make a new link"
                  busy={writer.busy === 'ical'}
                  consequence="Your current address stops at once."
                  onConfirm={() => void regenerateIcal()}
                />
              }
            />

            <Row
              label="Stop my link"
              consequence="Your calendar app shows “Calendar link expired - connect again”. You can connect again any time."
              control={
                <ConfirmAction
                  label="Stop my link"
                  confirmLabel="Yes, stop my link"
                  busy={writer.busy === 'ical-revoke'}
                  consequence="Your current address stops at once."
                  onConfirm={() => void revokeIcal()}
                />
              }
            />

            <SaveFailure failed={writer.failed} what="Your link is as it was." />

            <div style={{ margin: '18px 0 0' }}><Micro>Untested</Micro></div>
            <Note>
              No external calendar app has been observed subscribing yet. The feed is served as a live
              subscription, so the steps below are what <em>should</em> work, not what has been seen to.
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
