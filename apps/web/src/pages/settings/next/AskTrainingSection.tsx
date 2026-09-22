/**
 * Questions and training — whether this house's /ask questions may help
 * improve Mudavym.
 *
 * THE FOUNDER, 2026-09-21, round 6r, his pick verbatim: **"Same as the wine
 * pool (Recommended)"** — the option's words: "A notice in our Terms and on
 * /ask, and an owner opt-out per house. Names are removed before any export.
 * We ask a lawyer about KVKK and GDPR before the first real training run."
 * (ADR 0145, round-6r amendment.)
 *
 * [2026-09-22, round 6y, KL5 verify — corrected: this page's own copy still
 * said "with names removed" / "Names are removed first", describing the
 * option's original wording rather than what was built. As built (round 6r)
 * and reconfirmed by the founder (round 6y, "Text-free until lawyer
 * (Recommended)"), the export carries NO question text at all yet — there is
 * no free text for a name remover to act on, and none is built. Copy fixed
 * to match; see apps/web/src/pages/Privacy.tsx's "Questions you ask Mudavym"
 * section, which states the same thing.]
 *
 * [2026-09-22, round 6y, KL5 last call: the On and Off lines now say what
 * the founder's "Never (Recommended)" means for this switch -- a question
 * asked while it is off stays out of training even after it is turned back
 * on (asked_while_opted_out, migration 20260922200600). "The questions may
 * be used" alone was broader than the code.]
 *
 * What this register holds, and what it does not:
 *   1. **One switch, the owner's.** On (the default, his) lets the house's
 *      questions be used, except those asked while it was off; off keeps them
 *      out of the training export, and a question asked while off stays out
 *      after it is turned back on (round 6y). The
 *      gateway refuses anyone but the house's owner (`PUT /settings/ask-training`
 *      checks the role in the house); the switch is disabled for everyone else
 *      and says so, but the route is the rule.
 *   2. **Three states, never two.** A failed read says it could not read, and
 *      is never shown as the default; no answer says the default is in force;
 *      an answer says who gave it and when.
 *   3. **Answering is not affected.** Off does not stop /ask or its record of
 *      each answer — it only keeps the questions out of any training use.
 */

import { Note, Register, Row, SaveFailure, Toggle } from './SectionKit';
import { MONO, SANS } from './st-format';
import type { HouseAskTrainingRegister, SettingsNextData } from './useSettingsNextData';

const NO_DATE = 'nobody has changed it, so the default is in force';

export function AskTrainingSection({ data }: { data: SettingsNextData }) {
  const { houseAskTraining, isOwner, saveAskTraining, writer } = data;
  return (
    <Register remote={houseAskTraining} name="the training choice">
      {(reg) => <AskTrainingBody reg={reg} isOwner={isOwner} save={saveAskTraining} writer={writer} />}
    </Register>
  );
}

function AskTrainingBody({
  reg, isOwner, save, writer,
}: {
  reg: HouseAskTrainingRegister;
  isOwner: boolean;
  save: (optedOut: boolean) => Promise<boolean>;
  writer: SettingsNextData['writer'];
}) {
  const busy = writer.busy === 'ask-training';

  if (!reg.readable) {
    return (
      <div role="alert">
        <Note>
          The training choice could not be read — {reg.reason ?? 'no reason was given'}. Nothing below is claimed for it,
          and this is not the same as a house that has not answered.
        </Note>
      </div>
    );
  }

  const allowed = !reg.optedOut;
  return (
    <>
      <Note>
        When someone asks Mudavym a question, the question and the answer are kept so the answer can be checked later.
        Unless the owner turns this off, the questions may also be used to make Mudavym better. If we ever export
        them, that export carries no question text at all.
      </Note>

      <Row
        label="Use this house’s questions to improve Mudavym"
        consequence={
          allowed ? (
            <>On. The questions may be used to improve Mudavym, except any asked while this was off. No training has started yet.</>
          ) : (
            <>
              <strong>Off.</strong> This house’s questions are kept out of any training, and the ones asked while it is off stay out even if you turn it back on. Asking and answering work as before.
            </>
          )
        }
        provenance={{ kept: 'restaurant', when: reg.statedAt, whenUnknown: NO_DATE }}
        control={
          <Toggle
            checked={allowed}
            label="Use this house’s questions to improve Mudavym"
            disabled={!isOwner}
            busy={busy}
            onChange={(next) => void save(!next)}
          />
        }
      >
        {reg.statedBy?.name && (
          <p style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '6px 0 0' }}>
            set by · {reg.statedBy.name}
          </p>
        )}
        {!isOwner && (
          <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3)', margin: '5px 0 0' }}>
            Only the house’s owner can change this.
          </p>
        )}
        {reg.audited === false && (
          <p role="alert" style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-1)', margin: '5px 0 0' }}>
            The choice was saved, but the change was not written to the trail — {reg.auditReason ?? 'no reason was given'}.
            &ldquo;What changed here&rdquo; will not show it.
          </p>
        )}
      </Row>

      <SaveFailure
        failed={writer.failed?.key === 'ask-training' ? writer.failed : null}
        what="Nothing was changed; the switch shows what is saved."
      />
    </>
  );
}

export default AskTrainingSection;
