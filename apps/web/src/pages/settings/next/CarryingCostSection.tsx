/**
 * Carrying cost — what a month of holding stock costs this house.
 *
 * WHY THIS REGISTER EXISTS
 * ------------------------
 * THE FOUNDER, 2026-09-05, batch 59, answering the commodity plan's §12 Q5:
 * **"Twice a year, and the house types its carrying cost."**
 *
 * The quant pass behind that answer measured the commodity alert on 440
 * recorded FAO months, walk-forward: a fire is followed by a higher index three
 * months later 66.7 % of the time against a 54.4 % benchmark — and the entire
 * gain is spent by a carrying cost of about **one percent a month**. Between
 * 0.5 % and 1 % the recommendation flips from "worth having on six series" to
 * "worth having on one". Nothing in this product had ever asked a house for
 * that number, so every saving it could have printed would have rested on a
 * figure somebody invented.
 *
 * THE THREE RULES IT HOLDS
 *   1. **Stated before it is recorded** (ADR 0083). The sentence under the
 *      field says exactly what Record will write, in the units it will write
 *      it in. Nothing is written by opening this page and no value is offered
 *      as a starting point — unlike the currency, where a country genuinely
 *      implies one, nothing implies a carrying cost.
 *   2. **The units are said out loud, twice.** A percent a month, and the
 *      example spells it. The two mis-spellings — 0.0075 for the fraction and
 *      75 for a percent a year — are refused by the gateway with the same
 *      bounds the database's own CHECK holds, and the consequence line says
 *      which direction each one would push a saving.
 *   3. **Three states, never two.** A failed read says which register could
 *      not be read; `percentPerMonth: null` says the question is unanswered
 *      and what that costs — the alert says its saving is UNMEASURED — and a
 *      number says who typed it and when (ADR 0020).
 *
 * The role check is the gateway's — `assertCanManageRestaurant` on
 * `PUT /settings/carrying-cost`. The field below is disabled for anyone else
 * and says so, but the page is a courtesy and the route is the rule.
 */

import { useEffect, useState } from 'react';
import { Action, Note, Register, Row, SaveFailure, fieldStyle } from './SectionKit';
import { EM, MONO, SANS } from './st-format';
import type { HouseCarryingCostRegister, SettingsNextData } from './useSettingsNextData';

/** Exactly the bounds `restaurants_carrying_cost_is_a_plausible_percent` holds. */
export const MIN_PERCENT = 0.01;
export const MAX_PERCENT = 25;

const NO_DATE = 'nobody has typed one yet, so there is no date to show';

export function CarryingCostSection({ data }: { data: SettingsNextData }) {
  const { houseCarryingCost, canManage, saveCarryingCost, writer } = data;
  return (
    <Register remote={houseCarryingCost} name="the carrying-cost register">
      {(reg) => (
        <CarryingCostBody reg={reg} canManage={canManage} save={saveCarryingCost} writer={writer} />
      )}
    </Register>
  );
}

/**
 * What the typed text means, before anything is recorded.
 *
 * Returns the sentence the field prints AND whether Record may fire, from one
 * pass over the same value, so the two can never disagree — a button enabled on
 * one reading of a number and a sentence written from another is how a page
 * records something it told you it would not.
 */
export function readTyped(
  raw: string,
  recorded: number | null,
): { value: number | null; sentence: string; canRecord: boolean } {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return {
      value: null,
      sentence:
        recorded === null
          ? 'Nothing is recorded yet. Type what a month of holding stock costs this house, as a percent of its value.'
          : `${recorded} percent a month is already recorded. Type another to change it.`,
      canRecord: false,
    };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { value: null, sentence: `“${trimmed}” is not a number, so nothing can be recorded.`, canRecord: false };
  }
  if (value < MIN_PERCENT) {
    return {
      value,
      // The direction matters and is said: this mistake makes holding stock
      // look nearly free, which makes every commodity alert look profitable.
      sentence: `${value} is below ${MIN_PERCENT} percent a month — a tenth of a percent a year, which no house holds stock for. This field is a PERCENT: three quarters of one percent is 0.75, not 0.0075. Recording it would make holding stock look almost free.`,
      canRecord: false,
    };
  }
  if (value > MAX_PERCENT) {
    return {
      value,
      sentence: `${value} percent a MONTH is ${(value * 12).toFixed(0)} percent a year. If you meant three quarters of one percent, type 0.75.`,
      canRecord: false,
    };
  }
  if (recorded !== null && value === recorded) {
    return { value, sentence: `${value} percent a month is already recorded.`, canRecord: false };
  }
  return {
    value,
    sentence: `Record will write ${value} percent a month${recorded === null ? '' : `, replacing ${recorded}`} — about ${(value * 12).toFixed(1)} percent a year on anything this house is holding.`,
    canRecord: true,
  };
}

function CarryingCostBody({
  reg, canManage, save, writer,
}: {
  reg: HouseCarryingCostRegister;
  canManage: boolean;
  save: (percentPerMonth: number, basis: string | null) => Promise<boolean>;
  writer: SettingsNextData['writer'];
}) {
  const [typed, setTyped] = useState<string>(reg.percentPerMonth === null ? '' : String(reg.percentPerMonth));
  const [basis, setBasis] = useState<string>(reg.basis ?? '');
  useEffect(() => {
    setTyped(reg.percentPerMonth === null ? '' : String(reg.percentPerMonth));
    setBasis(reg.basis ?? '');
  }, [reg.percentPerMonth, reg.basis]);

  const busy = writer.busy === 'carrying-cost';
  const read = readTyped(typed, reg.percentPerMonth);

  if (!reg.readable) {
    return (
      <div role="alert">
        <Note>
          The carrying cost could not be read — {reg.reason ?? 'no reason was given'}. Nothing below is claimed for it,
          and this is not the same as a house that has not been asked.
        </Note>
      </div>
    );
  }

  return (
    <>
      <Note>
        One number: what a month of holding stock costs this house, as a percent of the goods’ own value. It is the cash
        tied up, the space, and the shrink that is not outright spoilage — three different costs, and only you know
        which of them you counted.
      </Note>

      <Row
        label="Carrying cost"
        consequence={
          reg.percentPerMonth !== null ? (
            <>
              A commodity alert here may state a saving in this house’s own money, worked out against{' '}
              <strong>{reg.percentPerMonth} percent a month</strong>.
            </>
          ) : (
            <>
              {EM} <strong>No saving is shown anywhere.</strong> Until somebody types this, a commodity alert says its
              saving is UNMEASURED and which number is missing, rather than pricing a stock-up off a figure nobody
              chose.
            </>
          )
        }
        provenance={{
          kept: 'restaurant',
          when: reg.statedAt,
          whenUnknown: NO_DATE,
          verb: 'typed',
        }}
        control={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <label htmlFor="st-carrying-cost" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
              Carrying cost, percent a month
            </label>
            <input
              id="st-carrying-cost"
              type="number"
              inputMode="decimal"
              step="0.01"
              min={MIN_PERCENT}
              max={MAX_PERCENT}
              placeholder="0.75"
              value={typed}
              disabled={!canManage || busy}
              onChange={(e) => setTyped(e.target.value)}
              className="st-ink st-focus"
              style={{ ...fieldStyle, opacity: canManage ? 1 : 0.45, width: 110, textAlign: 'right' }}
            />
            <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
              % a month
            </span>
            <Action disabled={!canManage || busy || !read.canRecord} onClick={() => void save(read.value as number, basis.trim() === '' ? null : basis.trim())}>
              {busy ? 'Recording…' : 'Record'}
            </Action>
          </span>
        }
      >
        <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3)', margin: '5px 0 0' }}>
          {read.sentence}
        </p>
        <span style={{ display: 'block', marginTop: 8 }}>
          <label htmlFor="st-carrying-basis" style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
            what you counted — optional
          </label>
          <input
            id="st-carrying-basis"
            type="text"
            maxLength={500}
            placeholder="cash at 9 percent plus the walk-in"
            value={basis}
            disabled={!canManage || busy}
            onChange={(e) => setBasis(e.target.value)}
            className="st-ink st-focus"
            style={{ ...fieldStyle, opacity: canManage ? 1 : 0.45, display: 'block', width: '100%', marginTop: 4 }}
          />
        </span>
        {reg.statedBy?.name && (
          <p style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '6px 0 0' }}>
            typed by · {reg.statedBy.name}
          </p>
        )}
        {reg.basis && (
          <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3)', margin: '3px 0 0' }}>
            Counted as: {reg.basis}
          </p>
        )}
        {!canManage && (
          <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3)', margin: '5px 0 0' }}>
            Only managers and owners can state what holding stock costs this restaurant. The field is left legible so
            you can read the rule you may not change, and the gateway refuses it independently of this page.
          </p>
        )}
        {reg.audited === false && (
          <p role="alert" style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-1)', margin: '5px 0 0' }}>
            The carrying cost was recorded, but the change was not written to the trail —{' '}
            {reg.auditReason ?? 'no reason was given'}. &ldquo;What changed here&rdquo; will not show it.
          </p>
        )}
      </Row>

      <SaveFailure
        failed={writer.failed?.key === 'carrying-cost' ? writer.failed : null}
        what="Nothing was recorded; the number on the row is unchanged."
      />

      <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3)', margin: '14px 0 0' }}>
        Why this is asked at all: buying ahead of a price rise only pays if holding the goods costs less than the rise
        saves. Measured over 440 months of the FAO food price index, a commodity alert’s whole gain is spent by a
        carrying cost of about one percent a month — so the same alert is worth having at 0.5 and worth ignoring at 1.0,
        and no figure this product could invent would tell you which side you are on.
      </p>
    </>
  );
}

export default CarryingCostSection;
