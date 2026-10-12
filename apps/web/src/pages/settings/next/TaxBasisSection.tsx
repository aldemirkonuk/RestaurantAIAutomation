/**
 * Whether this house's till prices include tax, and its rates — lane 2 of the
 * tax-inclusive decision (F-620 / F-1537).
 *
 * THE FOUNDER'S PICKS, 2026-10-12 (sim ledger S218): F1 build it; F2 only from
 * now — checks already recorded stay as the till sent them, and the date this
 * is answered is the date reports mark; F3 costs carry their own tax basis
 * (margin advice, lane 4).
 *
 * THE RULES IT HOLDS (the target margin's, TargetMarginSection.tsx):
 *   1. Never defaulted, never inferred. Nothing is chosen when the page opens.
 *      The house's recorded country may SUGGEST an answer ("Prices on your till
 *      include KDV" for a house in Türkiye); the suggestion only selects a
 *      choice on this page, and Confirm writes it.
 *   2. Stated before it is recorded: the sentence under the control says what
 *      Confirm or Add will write.
 *   3. Three states, never two: a failed read says so; not answered says what
 *      that means; an answer says who gave it and when.
 *
 * `TaxBasisSetupLine` is the one setup line the decision allows (§2): shown
 * wherever net sales are, only while the house has not answered, in every
 * country — never because of the country.
 *
 * Owners and managers only — the gateway's `assertCanManageRestaurant` is the
 * rule; the disabled controls are a courtesy.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Action, Choice, Note, Row, fieldStyle } from './SectionKit';
import { MONO, SANS } from './st-format';
import { parseDecimal } from '@/lib/parseDecimal';
import { apiClient } from '@/services/api/client';

export type HouseTaxBasis = 'unset' | 'prices_include_tax' | 'prices_exclude_tax' | 'not_vat_charging';
export type TaxBasisAnswer = Exclude<HouseTaxBasis, 'unset'>;
export type TaxRateKeyKind = 'house' | 'pos_category' | 'house_item';

export interface TaxRateRow {
  version: number;
  keyKind: TaxRateKeyKind;
  key: string;
  itemName: string | null;
  ratePct: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  inForceToday: boolean;
  createdAt: string | null;
}

/** Mirrors `HouseTaxBasisReadout` (apps/api-gateway/src/settings/house-tax-basis.service.ts). */
export interface TaxBasisReadout {
  restaurantId: string;
  readable: boolean;
  reason: string | null;
  basis: HouseTaxBasis | null;
  answered: boolean;
  confirmedAt: string | null;
  confirmedBy: { userId: string; name: string | null } | null;
  country: string | null;
  taxWord: string;
  proposal: { basis: TaxBasisAnswer; rates: { label: string; ratePct: number }[]; why: string } | null;
  rates: TaxRateRow[] | null;
  ratesReason: string | null;
  today: string;
  todayOnHouseClock: boolean;
  changed?: boolean;
  audited?: boolean;
  auditReason?: string | null;
}

export async function getTaxBasis(): Promise<TaxBasisReadout> {
  const { data } = await apiClient.get<TaxBasisReadout>('/settings/tax-basis');
  return data;
}

export async function confirmTaxBasis(basis: TaxBasisAnswer): Promise<TaxBasisReadout> {
  const { data } = await apiClient.put<TaxBasisReadout>('/settings/tax-basis', { basis });
  return data;
}

export async function addTaxRate(body: {
  keyKind: 'house' | 'pos_category';
  key?: string;
  ratePct: number;
  effectiveFrom: string;
}): Promise<TaxBasisReadout> {
  const { data } = await apiClient.post<TaxBasisReadout>('/settings/tax-rates', body);
  return data;
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The three answers, in the house's own word for the tax. */
export function answerLabel(basis: TaxBasisAnswer, taxWord: string): string {
  if (basis === 'prices_include_tax') return `Prices on your till include ${taxWord}`;
  if (basis === 'prices_exclude_tax') return `${capital(taxWord)} is added on top of your till’s prices`;
  return `This house charges no ${taxWord}`;
}

export const ANSWERS: readonly TaxBasisAnswer[] = ['prices_include_tax', 'prices_exclude_tax', 'not_vat_charging'];

/** What the recorded answer means for the figures, in one sentence. */
export function basisConsequence(reg: Pick<TaxBasisReadout, 'basis' | 'taxWord' | 'confirmedAt'>): string {
  const since = reg.confirmedAt ? reg.confirmedAt.slice(0, 10) : null;
  switch (reg.basis) {
    case 'prices_include_tax':
      return `Net sales are taken before ${reg.taxWord} for every check from ${since ?? 'the day this was answered'}: by the tax your till states, or by your rates below. Checks recorded before then stay as your till sent them.`;
    case 'prices_exclude_tax':
      return `Your till’s subtotal is already before ${reg.taxWord}, so net sales read as the till sends them.`;
    case 'not_vat_charging':
      return `There is no ${reg.taxWord} to take out, so net sales read as the till sends them.`;
    default:
      return `Not stated yet. Net sales read exactly as your till sends them, so if its prices include ${reg.taxWord}, those figures include it too.`;
  }
}

/** What Confirm will write, before it does. */
export function readAnswer(
  chosen: TaxBasisAnswer | null,
  reg: Pick<TaxBasisReadout, 'basis' | 'taxWord'>,
): { canConfirm: boolean; sentence: string } {
  if (chosen === null) return { canConfirm: false, sentence: 'Choose which is true of this house’s till.' };
  if (chosen === reg.basis) return { canConfirm: false, sentence: 'That is the answer already recorded.' };
  return {
    canConfirm: true,
    sentence: `Confirm will record “${answerLabel(chosen, reg.taxWord)}”, with your name and today’s date. Checks already recorded are not changed.`,
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** What Add will write, before it does. One pass, so the button and the sentence agree. */
export function readRateInputs(
  covers: 'house' | 'pos_category',
  category: string,
  rateRaw: string,
  from: string,
  taxWord: string,
): { canAdd: boolean; sentence: string; body: Parameters<typeof addTaxRate>[0] | null } {
  const t = rateRaw.trim().replace(/%$/, '');
  if (t === '') return { canAdd: false, sentence: `Type the ${taxWord} rate as a percent (20 means 20 percent).`, body: null };
  const pct = parseDecimal(t);
  if (pct === null) return { canAdd: false, sentence: `“${rateRaw.trim()}” is not a number.`, body: null };
  if (pct < 0 || pct >= 100) return { canAdd: false, sentence: 'A rate is a percent from 0 up to 100.', body: null };
  if (pct > 0 && pct < 1)
    return { canAdd: false, sentence: `${pct} reads as under one percent. A rate is a PERCENT: 20 percent is 20, not 0.20.`, body: null };
  if (Math.abs(pct * 100 - Math.round(pct * 100)) > 1e-6)
    return { canAdd: false, sentence: 'A rate has at most two decimals (8.25).', body: null };
  const cat = category.trim();
  if (covers === 'pos_category' && cat === '')
    return { canAdd: false, sentence: 'Type the till category the rate covers, exactly as your till names it.', body: null };
  if (!ISO_DATE.test(from)) return { canAdd: false, sentence: 'Say the first day the rate applies.', body: null };
  const what = covers === 'house' ? 'everything the house sells' : `the till category “${cat}”`;
  return {
    canAdd: true,
    sentence: `Add will record ${pct} percent ${taxWord} on ${what}, from ${from}. A rate is never edited: a change is a new rate from its own date.`,
    body: covers === 'house'
      ? { keyKind: 'house', ratePct: pct, effectiveFrom: from }
      : { keyKind: 'pos_category', key: cat, ratePct: pct, effectiveFrom: from },
  };
}

function rateCovers(r: TaxRateRow): string {
  if (r.keyKind === 'house') return 'everything';
  if (r.keyKind === 'pos_category') return `till category “${r.key}”`;
  return r.itemName ? `“${r.itemName}”` : 'one of the house’s items';
}

function messageOf(err: unknown): string {
  const e = err as { response?: { status?: number; data?: { message?: unknown } }; message?: string };
  if (e?.response?.status === 403) return 'only an owner or a manager can change this';
  const m = e?.response?.data?.message;
  if (typeof m === 'string' && m) return m;
  if (Array.isArray(m) && m.length) return String(m[0]);
  return e?.message || 'no reason was given';
}

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; reg: TaxBasisReadout };

export function TaxBasisSection({ canManage }: { canManage: boolean }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const refresh = useCallback(() => {
    getTaxBasis()
      .then((reg) => setLoad({ status: 'ready', reg }))
      .catch((err) => setLoad({ status: 'error', message: messageOf(err) }));
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  if (load.status === 'loading') return <Note>Reading whether this house’s prices include tax…</Note>;
  if (load.status === 'error' || !load.reg?.readable) {
    const reason = load.status === 'error' ? load.message : load.reg?.reason ?? 'no reason was given';
    return (
      <div role="alert">
        <Note>
          Whether this house’s prices include tax could not be read — {reason}. Nothing below is claimed for it, and this
          is not the same as a house that has not answered.
        </Note>
      </div>
    );
  }
  return <TaxBasisBody reg={load.reg} canManage={canManage} onRecorded={(reg) => setLoad({ status: 'ready', reg })} />;
}

function TaxBasisBody({
  reg, canManage, onRecorded,
}: { reg: TaxBasisReadout; canManage: boolean; onRecorded: (reg: TaxBasisReadout) => void }) {
  const [chosen, setChosen] = useState<TaxBasisAnswer | null>(reg.answered ? (reg.basis as TaxBasisAnswer) : null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const answer = readAnswer(chosen, reg);

  const [covers, setCovers] = useState<'house' | 'pos_category'>('house');
  const [category, setCategory] = useState('');
  const [rate, setRate] = useState('');
  const [from, setFrom] = useState(reg.today);
  const [rateBusy, setRateBusy] = useState(false);
  const [rateFailed, setRateFailed] = useState<string | null>(null);
  const rateRead = readRateInputs(covers, category, rate, from, reg.taxWord);
  const showRates = reg.basis === 'prices_include_tax' || chosen === 'prices_include_tax';
  const inForce = (reg.rates ?? []).filter((r) => r.inForceToday);

  const confirm = async () => {
    if (!answer.canConfirm || chosen === null) return;
    setBusy(true);
    setFailed(null);
    try {
      onRecorded(await confirmTaxBasis(chosen));
    } catch (err) {
      setFailed(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!rateRead.body) return;
    setRateBusy(true);
    setRateFailed(null);
    try {
      onRecorded(await addTaxRate(rateRead.body));
      setRate('');
    } catch (err) {
      setRateFailed(messageOf(err));
    } finally {
      setRateBusy(false);
    }
  };

  const proposal = reg.proposal;
  return (
    <>
      <Note>
        Whether the prices your till sends already include {reg.taxWord}. Net sales are meant to be before tax, so a
        house whose prices include it needs this answer once. Nothing is assumed from the country you are in.
      </Note>

      <Row
        label="Till prices and tax"
        consequence={basisConsequence(reg)}
        provenance={{
          kept: 'restaurant',
          when: reg.confirmedAt,
          whenUnknown: 'nobody has answered yet, so there is no date to show',
          verb: 'answered',
        }}
        control={
          <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
            <Choice
              label="Till prices and tax"
              value={chosen}
              disabled={!canManage || busy}
              options={ANSWERS.map((a) => ({ value: a, label: answerLabel(a, reg.taxWord) }))}
              onChange={setChosen}
            />
            <Action disabled={!canManage || busy || !answer.canConfirm} onClick={() => void confirm()}>
              {busy ? 'Confirming…' : 'Confirm'}
            </Action>
          </span>
        }
      >
        <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-4)', margin: '5px 0 0' }}>
          {answer.sentence}
        </p>
        {!reg.answered && proposal && (
          <p data-testid="tax-basis-proposal" style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3)', margin: '5px 0 0' }}>
            Suggested from the country on file: “{answerLabel(proposal.basis, reg.taxWord)}”. {proposal.why} Nothing is
            set until you confirm.{' '}
            {canManage && chosen !== proposal.basis && (
              <button
                type="button"
                className="st-ink st-focus"
                onClick={() => setChosen(proposal.basis)}
                style={{ fontFamily: SANS, fontSize: 11.5, border: 'none', background: 'none', padding: 0, textDecoration: 'underline', cursor: 'pointer', color: 'var(--ink-1)' }}
              >
                Choose it
              </button>
            )}
          </p>
        )}
        {reg.confirmedBy?.name && (
          <p style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-4)', margin: '6px 0 0' }}>
            answered by · {reg.confirmedBy.name}
          </p>
        )}
        {reg.audited === false && reg.changed === true && (
          <p role="alert" style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-1)', margin: '5px 0 0' }}>
            The answer was recorded, but the change was not written to the trail — {reg.auditReason ?? 'no reason was given'}.
          </p>
        )}
      </Row>

      {failed && (
        <p role="alert" style={{ fontFamily: SANS, fontSize: 12, lineHeight: 1.5, color: 'var(--ink-1)', background: 'var(--paper-2)', borderRadius: 8, padding: '8px 11px', margin: '10px 0 0' }}>
          That did not go through — {failed}. Nothing was recorded.
        </p>
      )}

      {showRates && (
        <Row
          label={`${capital(reg.taxWord)} rates`}
          consequence={
            reg.rates === null ? (
              <>The rates could not be read — {reg.ratesReason ?? 'no reason was given'}.</>
            ) : inForce.length === 0 ? (
              <>
                <strong>No rate is recorded.</strong> Until one is, a check whose till states no tax has no net figure,
                and it is counted as “not recorded” rather than guessed.
              </>
            ) : (
              <>
                In force on {reg.today}
                {reg.todayOnHouseClock ? '' : ' (UTC; this house has no time zone set)'}:{' '}
                {inForce
                  .map((r) => (r.ratePct === null ? `none on ${rateCovers(r)} (withdrawn)` : `${r.ratePct}% on ${rateCovers(r)}`))
                  .join('; ')}
                .
              </>
            )
          }
          provenance={{
            kept: 'restaurant',
            when: inForce[0]?.createdAt ?? null,
            whenUnknown: 'no rate has been added yet',
            verb: 'added',
          }}
          control={
            <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
              <Choice
                label="What the rate covers"
                value={covers}
                disabled={!canManage || rateBusy}
                options={[
                  { value: 'house', label: 'Everything' },
                  { value: 'pos_category', label: 'One till category' },
                ]}
                onChange={setCovers}
              />
              {covers === 'pos_category' && (
                <input
                  aria-label="Till category"
                  type="text"
                  placeholder="as your till names it"
                  value={category}
                  disabled={!canManage || rateBusy}
                  onChange={(e) => setCategory(e.target.value)}
                  className="st-ink st-focus"
                  style={{ ...fieldStyle, width: 180 }}
                />
              )}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <input
                  aria-label="Rate"
                  type="text"
                  inputMode="decimal"
                  value={rate}
                  disabled={!canManage || rateBusy}
                  onChange={(e) => setRate(e.target.value)}
                  className="st-ink st-focus"
                  style={{ ...fieldStyle, width: 64, textAlign: 'right' }}
                />
                <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--ink-4)' }}>%</span>
                <input
                  aria-label="From"
                  type="date"
                  value={from}
                  disabled={!canManage || rateBusy}
                  onChange={(e) => setFrom(e.target.value)}
                  className="st-ink st-focus"
                  style={{ ...fieldStyle, width: 140 }}
                />
              </span>
              <Action disabled={!canManage || rateBusy || !rateRead.canAdd} onClick={() => void add()}>
                {rateBusy ? 'Adding…' : 'Add rate'}
              </Action>
            </span>
          }
        >
          <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-4)', margin: '5px 0 0' }}>
            {rateRead.sentence}
          </p>
          {proposal && proposal.rates.length > 0 && canManage && (
            <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3)', margin: '5px 0 0' }}>
              Common rates here:{' '}
              {proposal.rates.map((p, i) => (
                <span key={p.label}>
                  {i > 0 && ' · '}
                  <button
                    type="button"
                    className="st-ink st-focus"
                    onClick={() => setRate(String(p.ratePct))}
                    style={{ fontFamily: SANS, fontSize: 11.5, border: 'none', background: 'none', padding: 0, textDecoration: 'underline', cursor: 'pointer', color: 'var(--ink-1)' }}
                  >
                    {p.ratePct}% {p.label.toLowerCase()}
                  </button>
                </span>
              ))}
              . A rate covering one kind of sale needs the till category your till puts it under.
            </p>
          )}
        </Row>
      )}

      {rateFailed && (
        <p role="alert" style={{ fontFamily: SANS, fontSize: 12, lineHeight: 1.5, color: 'var(--ink-1)', background: 'var(--paper-2)', borderRadius: 8, padding: '8px 11px', margin: '10px 0 0' }}>
          The rate was not added — {rateFailed}. Nothing was recorded.
        </p>
      )}

      {!canManage && (
        <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-4)', margin: '10px 0 0' }}>
          Only managers and owners can answer this. The gateway refuses anyone else independently of this page.
        </p>
      )}
    </>
  );
}

/**
 * The setup line (decision §2): one sentence and a link, shown only while the
 * house has not answered — in every country, never because of the country.
 * Renders nothing while loading, on a failed read, or once answered, so an
 * answered or unreadable house sees the page exactly as before.
 */
export function TaxBasisSetupLine({ className }: { className?: string }) {
  const [reg, setReg] = useState<TaxBasisReadout | null>(null);
  useEffect(() => {
    let live = true;
    getTaxBasis()
      .then((r) => {
        if (live) setReg(r ?? null);
      })
      .catch(() => {
        if (live) setReg(null);
      });
    return () => {
      live = false;
    };
  }, []);
  if (!reg || reg.readable !== true || reg.basis !== 'unset') return null;
  return (
    <p className={className} data-testid="tax-basis-setup-line">
      — This house hasn’t said whether its till prices include {reg.taxWord}, so net sales are the till’s figures as
      sent.{' '}
      <Link
        to="/settings?tab=tax-basis"
        className="not-italic text-inkm-1 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-seal"
      >
        Say which in Settings
      </Link>
    </p>
  );
}

export default TaxBasisSection;
