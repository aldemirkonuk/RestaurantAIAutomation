/**
 * How vendor mail is read — whether Jev reads this house's vendor mail (ADR
 * 0207, rounds 3 and 4).
 *
 * THE FOUNDER, 2026-09-21: "talk with JEV, put that onto point scale ... this
 * feature can also be disabled. other than that use warm/plain/terse", and on
 * what may leave: "Only with names removed".
 *
 * THE FOUNDER, 2026-09-22, round 6y, on who may turn it on: "owner only, but
 * also we're going to use this as complete data and privacy usage, they have
 * to accept that, and when they do they'd accept the jev too with their names
 * and sensitive topics redacted." So, since round 4:
 *   - OFF by default: nothing leaves until an OWNER turns it on (was owner or
 *     manager — turning it on is an owner accepting the house's complete data
 *     terms, `GET /settings/data-terms`, which is not built as a sheet in
 *     this round: the gateway refuses `enabled: true` with 409 and a sentence
 *     written for the owner, shown here via the ordinary save-failure path
 *     rather than a dedicated acceptance flow — a named gap, not a silent
 *     one; the note says so in the owner's words. [Last call, 2026-09-22:
 *     the note pointed to "Settings → Data terms", a section that does not
 *     exist.])
 *   - ON: each inbound vendor message goes to Jev (TypeSafe) with its email
 *     addresses, phone numbers, person names, account numbers, ids,
 *     credentials and sensitive topics removed first; Jev's point scale is
 *     kept as internal data and the vendor sheet shows one word.
 *   - OFF again: any owner may turn it off, no acceptance needed — nothing
 *     more is sent, and the sheet reads the inbound model's existing label.
 *
 * The role check is the gateway's (`PUT /settings/vendor-tone-scoring`).
 */

import { Action, Note, Register, Row, SaveFailure } from './SectionKit';
import { MONO, SANS } from './st-format';
import type { HouseToneScoringRegister, SettingsNextData } from './useSettingsNextData';

const NO_DATE = 'never changed — it is off, as every house starts';

export function MailReadingSection({ data }: { data: SettingsNextData }) {
  const { houseToneScoring, isOwner, saveToneScoring, writer } = data;
  return (
    <Register remote={houseToneScoring} name="the mail-reading switch">
      {(reg) => <Body reg={reg} isOwner={isOwner} save={saveToneScoring} writer={writer} />}
    </Register>
  );
}

function Body({
  reg, isOwner, save, writer,
}: {
  reg: HouseToneScoringRegister;
  isOwner: boolean;
  save: (enabled: boolean) => Promise<boolean>;
  writer: SettingsNextData['writer'];
}) {
  const busy = writer.busy === 'mail-reading';
  if (!reg.readable || reg.enabled === null) {
    return (
      <div role="alert">
        <Note>
          Whether Jev reads this house’s mail could not be read — {reg.reason ?? 'no reason was given'}. That is not the
          same as off.
        </Note>
      </div>
    );
  }
  const on = reg.enabled;
  return (
    <>
      <Note>
        On, each message a vendor sends this house is read by Jev (TypeSafe), with email addresses, phone numbers,
        people’s names, account and government-id numbers, credentials and sensitive private topics taken out before it
        leaves: the names this house knows, the sender’s, and the names a message opens or signs with. A name or topic
        written in a way this pass does not recognise may not be caught. Jev’s reading is kept as internal data; the
        vendor sheet shows one word per message — warm, plain or terse — to owners and managers. Off, nothing is sent,
        and the sheet shows the reading the inbound mail already carries. Turning this on is an owner accepting this
        house’s complete data-and-privacy terms, and accepting them is not on this page yet — so for now Jev stays off.
      </Note>
      <Row
        label="Jev reads vendor mail"
        consequence={
          on ? (
            <>
              <strong>On</strong> — vendor mail is sent to Jev with names and sensitive topics removed.
            </>
          ) : (
            <>
              <strong>Off</strong> — nothing is sent.
            </>
          )
        }
        provenance={{ kept: 'restaurant', when: reg.statedAt, whenUnknown: NO_DATE, verb: 'set' }}
        control={
          <Action disabled={!isOwner || busy} onClick={() => void save(!on)}>
            {busy ? 'Recording…' : on ? 'Turn off' : 'Turn on'}
          </Action>
        }
      >
        {reg.statedBy?.name && (
          <p style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '3px 0 0' }}>
            set by · {reg.statedBy.name}
          </p>
        )}
        {!isOwner && (
          <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3)', margin: '5px 0 0' }}>
            Only an owner can decide whether this restaurant’s vendor mail leaves for Jev — turning it on is accepting
            the house’s data terms.
          </p>
        )}
        {reg.audited === false && (
          <p role="alert" style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-1)', margin: '5px 0 0' }}>
            The switch was recorded, but the change was not written to the trail — {reg.auditReason ?? 'no reason was given'}.
          </p>
        )}
      </Row>
      <SaveFailure
        failed={writer.failed?.key === 'mail-reading' ? writer.failed : null}
        what="Nothing was changed; the switch is as it was."
      />
    </>
  );
}

export default MailReadingSection;
