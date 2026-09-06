/**
 * Reporting currency — the money this house states its own totals in.
 *
 * WHY THIS REGISTER EXISTS
 * ------------------------
 * `restaurants.currency` carried `DEFAULT 'USD'` and the sign-up insert named
 * no currency key, so the COLUMN was the writer: `USD` on all fourteen
 * production houses, two of them in Türkiye and one in London, none ever asked
 * (measured 2026-09-05, ADR 0117 Q25). The migration
 * `20260905120000_a_house_names_its_money.sql` dropped the default and the
 * founder's Q30 call cleared every unattributable value, so production now
 * holds GBP 1, TRY 3, NULL 11.
 *
 * `CurrencyStep` asks a house being CREATED. An EXISTING house had no field at
 * all — eleven of them print "currency not recorded" against every money figure
 * (`fmtMoney`, `formatCurrency`) with nothing anywhere that could change it. A
 * state the product can be in and cannot be got out of is a missing field.
 *
 * THE THREE RULES IT HOLDS
 *   1. **Stated before it is recorded** (ADR 0083). The sentence under the
 *      field says exactly what Record will write, and names the country the
 *      default came from, so the manager can see the reasoning and disagree
 *      with it. Nothing is written by opening this page.
 *   2. **The default is offered, never applied.** `currencyForCountry` fills
 *      the select's initial value; the write happens only on Record. A default
 *      that saves itself is the defect this register exists to remove.
 *   3. **Three states, never two.** A failed read says which register could not
 *      be read; `code: null` says the question is unanswered and what that
 *      costs; a code says who last stated it and when. None of them ever renders
 *      as a dollar sign (ADR 0020).
 *
 * The role check is the gateway's — `assertCanManageRestaurant` on
 * `PUT /settings/currency`. The select below is disabled for anyone else and
 * says so, but the page is a courtesy and the route is the rule.
 */

import { useEffect, useState } from 'react';
import {
  CURRENCY_CODES,
  CURRENCY_NOT_RECORDED,
  currencyForCountry,
  currencyLabel,
} from '@/lib/currency';
import { Action, Note, Register, Row, SaveFailure, fieldStyle } from './SectionKit';
import { EM, MONO, SANS } from './st-format';
import type { HouseCurrencyRegister, SettingsNextData } from './useSettingsNextData';

/**
 * Why no date exists. Both halves are true of a real house today: one whose
 * code was corrected by `scripts/correct_restaurant_currency.py`, and one whose
 * code has never been stated at all. The gateway cannot tell them apart from
 * an absent trail row, so this sentence does not pretend it can.
 */
const NO_DATE =
  'no change to it has been recorded here — it was set before this register existed, or never set';

export function CurrencySection({ data }: { data: SettingsNextData }) {
  const { houseCurrency, canManage, saveCurrency, writer } = data;
  return (
    <Register remote={houseCurrency} name="the currency register">
      {(reg) => <CurrencyBody reg={reg} canManage={canManage} save={saveCurrency} writer={writer} />}
    </Register>
  );
}

function CurrencyBody({
  reg, canManage, save, writer,
}: {
  reg: HouseCurrencyRegister;
  canManage: boolean;
  save: (code: string) => Promise<boolean>;
  writer: SettingsNextData['writer'];
}) {
  const fromCountry = currencyForCountry(reg.country);
  // The select opens on the recorded code, or on the country's default when
  // there is none. Opening on the default is an OFFER; only Record writes.
  const [choice, setChoice] = useState<string>(reg.code ?? fromCountry ?? '');
  useEffect(() => {
    setChoice(reg.code ?? fromCountry ?? '');
  }, [reg.code, fromCountry]);

  const busy = writer.busy === 'currency';
  const dirty = choice !== '' && choice !== reg.code;

  if (!reg.readable) {
    // Reachable when the gateway answered 200 with `readable: false` — the row
    // itself could not be read. Distinct from a failed request, which the
    // `Register` shell above already renders.
    return (
      <div role="alert">
        <Note>
          The currency could not be read — {reg.reason ?? 'no reason was given'}. Nothing below is claimed for it, and
          this is not the same as a house that has not been asked.
        </Note>
      </div>
    );
  }

  const statement = !dirty
    ? reg.code
      ? `${reg.code} is already recorded. Choose another to change it.`
      : 'Nothing is recorded yet. Choose a currency, then Record it.'
    : choice === fromCountry && reg.code === null
      ? `Defaulted from ${reg.country ?? 'this house’s country'}. Record will write ${choice}. Change it if that is wrong.`
      : `Record will write ${choice}${reg.code ? `, replacing ${reg.code}` : ''}.`;

  return (
    <>
      <Note>
        This is what this house REPORTS in. It is not the currency of any recorded price: each invoice keeps the
        currency its vendor billed in, and nothing anywhere in this system converts — there is no exchange rate here,
        and inventing one would be inventing the answer.
      </Note>

      <Row
        label="Currency"
        consequence={
          reg.code ? (
            <>
              Every total on this house’s screens is stated in <strong>{currencyLabel(reg.code)}</strong>.
            </>
          ) : (
            <>
              {EM} <strong>{CURRENCY_NOT_RECORDED}</strong>. Until somebody states one, every money figure on this
              house’s screens prints the number and says the currency is not recorded, rather than guessing a symbol.
            </>
          )
        }
        provenance={{
          kept: 'restaurant',
          when: reg.statedAt,
          whenUnknown: NO_DATE,
          verb: 'stated',
        }}
        control={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <label htmlFor="st-currency" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
              Currency
            </label>
            <select
              id="st-currency"
              value={choice}
              disabled={!canManage || busy}
              onChange={(e) => setChoice(e.target.value)}
              className="st-ink st-focus"
              style={{ ...fieldStyle, opacity: canManage ? 1 : 0.45, minWidth: 190 }}
            >
              {/*
                A placeholder, not a choice. Selecting it leaves Record inert:
                clearing a stated currency is not something this page does — the
                one time production rows were nulled it was the founder's own
                call, run by `scripts/correct_restaurant_currency.py`.
              */}
              <option value="">Not recorded — choose one</option>
              {CURRENCY_CODES.map((code) => (
                <option key={code} value={code}>
                  {currencyLabel(code)}
                </option>
              ))}
            </select>
            <Action disabled={!canManage || busy || !dirty} onClick={() => void save(choice)}>
              {busy ? 'Recording…' : 'Record'}
            </Action>
          </span>
        }
      >
        <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3)', margin: '5px 0 0' }}>
          {statement}
        </p>
        {reg.statedBy?.name && (
          <p style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '3px 0 0' }}>
            stated by · {reg.statedBy.name}
          </p>
        )}
        {!canManage && (
          <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3)', margin: '5px 0 0' }}>
            Only managers and owners can state the currency this restaurant reports in. The choice is left legible so
            you can read the rule you may not change, and the gateway refuses it independently of this page.
          </p>
        )}
        {reg.audited === false && (
          <p role="alert" style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-1)', margin: '5px 0 0' }}>
            The currency was recorded, but the change was not written to the trail — {reg.auditReason ?? 'no reason was given'}.
            &ldquo;What changed here&rdquo; will not show it.
          </p>
        )}
      </Row>

      <SaveFailure
        failed={writer.failed?.key === 'currency' ? writer.failed : null}
        what="Nothing was recorded; the code on the row is unchanged."
      />

      <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3)', margin: '14px 0 0' }}>
        A house being created is asked this on the sign-up form, where the answer is defaulted from its address and
        confirmed by a person. This register is the same question for a house that already exists — the eleven that
        hold no currency today were never asked, because nothing ever asked: the column answered for them.
      </p>
    </>
  );
}

export default CurrencySection;
