/**
 * How vendor mail is read — whether Jev reads this house's vendor mail (ADR
 * 0207, round 3).
 *
 * THE FOUNDER, 2026-09-21: "talk with JEV, put that onto point scale ... this
 * feature can also be disabled. other than that use warm/plain/terse", and on
 * what may leave: "Only with names removed". So:
 *   - OFF by default: nothing leaves until an owner or manager turns it on
 *     here. (Whether it should default on is the founder's open question.)
 *   - ON: each inbound vendor message goes to Jev (TypeSafe) with its email
 *     addresses, phone numbers and person names removed first; Jev's point
 *     scale is kept as internal data and the vendor sheet shows one word.
 *   - OFF again: nothing more is sent, and the sheet reads the inbound model's
 *     existing label.
 *
 * The role check is the gateway's (`PUT /settings/vendor-tone-scoring`).
 */

import { Action, Note, Register, Row, SaveFailure } from './SectionKit';
import { MONO, SANS } from './st-format';
import type { HouseToneScoringRegister, SettingsNextData } from './useSettingsNextData';

const NO_DATE = 'never changed — it is off, as every house starts';

export function MailReadingSection({ data }: { data: SettingsNextData }) {
  const { houseToneScoring, canManage, saveToneScoring, writer } = data;
  return (
    <Register remote={houseToneScoring} name="the mail-reading switch">
      {(reg) => <Body reg={reg} canManage={canManage} save={saveToneScoring} writer={writer} />}
    </Register>
  );
}

function Body({
  reg, canManage, save, writer,
}: {
  reg: HouseToneScoringRegister;
  canManage: boolean;
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
        On, each message a vendor sends this house is read by Jev (TypeSafe), with email addresses, phone numbers and
        people’s names taken out before it leaves: the names this house knows, the sender’s, and the names a message
        opens or signs with. A name written anywhere else in a message may not be caught. Jev’s reading is kept as
        internal data; the vendor sheet shows one word per message — warm, plain or terse — to owners and managers.
        Off, nothing is sent, and the sheet shows the reading the inbound mail already carries.
      </Note>
      <Row
        label="Jev reads vendor mail"
        consequence={
          on ? (
            <>
              <strong>On</strong> — vendor mail is sent to Jev with names removed.
            </>
          ) : (
            <>
              <strong>Off</strong> — nothing is sent.
            </>
          )
        }
        provenance={{ kept: 'restaurant', when: reg.statedAt, whenUnknown: NO_DATE, verb: 'set' }}
        control={
          <Action disabled={!canManage || busy} onClick={() => void save(!on)}>
            {busy ? 'Recording…' : on ? 'Turn off' : 'Turn on'}
          </Action>
        }
      >
        {reg.statedBy?.name && (
          <p style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '3px 0 0' }}>
            set by · {reg.statedBy.name}
          </p>
        )}
        {!canManage && (
          <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3)', margin: '5px 0 0' }}>
            Only managers and owners can decide whether this restaurant’s vendor mail leaves for Jev.
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
