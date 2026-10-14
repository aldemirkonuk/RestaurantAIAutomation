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
  /** Starts after today and will apply unless withdrawn (F-1586). */
  upcoming?: boolean;
  createdAt: string | null;
}

export interface TaxBasisAnswerRow {
  basis: TaxBasisAnswer;
  answeredAt: string;
  fromDay: string | null;
}

/** Mirrors `HouseTaxBasisReadout` (apps/api-gateway/src/settings/house-tax-basis.service.ts). */
export interface TaxBasisReadout {
  restaurantId: string;
  readable: boolean;
  reason: string | null;
  basis: HouseTaxBasis | null;
  answered: boolean;
  confirmedAt: string | null;
  /** The house day of `confirmedAt`, the day ingest switches (F-1585). */
  switchDay?: string | null;
  confirmedBy: { userId: string; name: string | null } | null;
  /**
   * F-1624: every answer, oldest first, with the house day each took effect
   * (null without a time zone); null when they could not be read.
   */
  answers?: TaxBasisAnswerRow[] | null;
  answersReason?: string | null;
  /** The house's items a rate can be keyed to (S222); null when not listed. */
  items?: { id: string; name: string }[] | null;
  /** F-1665: the house has more items than the list carries. */
  itemsCapped?: boolean;
  country: string | null;
  taxWord: string;
  proposal: { basis: TaxBasisAnswer; rates: { label: string; ratePct: number }[]; why: string } | null;
  rates: TaxRateRow[] | null;
  ratesReason: string | null;
  /** F-1615: the till category whose rate prices cocktails; null when nobody has chosen. */
  cocktailCategory?: string | null;
  /** Why `cocktailCategory` could not be read; null when it was. */
  cocktailCategoryReason?: string | null;
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

export type RateCovers = 'house' | 'pos_category' | 'house_item';

export async function addTaxRate(body: {
  keyKind: RateCovers;
  key?: string;
  ratePct: number;
  effectiveFrom: string;
}): Promise<TaxBasisReadout> {
  const { data } = await apiClient.post<TaxBasisReadout>('/settings/tax-rates', body);
  return data;
}

/**
 * Withdraw one rate (F-1586). The table is append-only, so the gateway
 * appends rows restating what applied before it; nothing is edited.
 */
export async function withdrawTaxRate(version: number): Promise<TaxBasisReadout> {
  const { data } = await apiClient.post<TaxBasisReadout>('/settings/tax-rates/withdraw', { version });
  return data;
}

/**
 * Say which till category's rate prices cocktails, or null to take it back
 * (F-1615). Only one of the house's own till categories is accepted.
 */
export async function setCocktailTaxCategory(category: string | null): Promise<TaxBasisReadout> {
  const { data } = await apiClient.put<TaxBasisReadout>('/settings/tax-basis/cocktail-category', { category });
  return data;
}

/** The till categories the house has a rate for, the only ones cocktails may be priced at (F-1615). */
export function cocktailCategories(rates: TaxRateRow[] | null): string[] {
  return [...new Set((rates ?? []).filter((r) => r.keyKind === 'pos_category' && r.ratePct !== null).map((r) => r.key))].sort(
    (a, b) => a.localeCompare(b),
  );
}

/** What Save will write for cocktails, before it does (F-1615). */
export function readCocktailChoice(
  picked: string | null,
  current: string | null,
): { canSave: boolean; sentence: string } {
  if (picked === null)
    return { canSave: false, sentence: 'Choose the till category your cocktails are rung up under.' };
  if (picked === current) return { canSave: false, sentence: 'That is the category already chosen.' };
  return {
    canSave: true,
    sentence: `Save will price cocktails at the rate of the till category “${picked}”, so their margins are worked out without it.`,
  };
}

/** The day after a house date, calendar-safe. */
function nextDay(day: string): string {
  const t = new Date(`${day}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

/**
 * The day a withdrawal starts, the gateway's `withdrawalStart`: a rate not
 * yet in force from its own first day (it never applies); one in force from
 * tomorrow, so a day already trading keeps one rate.
 */
export function withdrawFrom(r: Pick<TaxRateRow, 'effectiveFrom'>, today: string): string {
  return r.effectiveFrom > today ? r.effectiveFrom : nextDay(today);
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
export function basisConsequence(
  reg: Pick<TaxBasisReadout, 'basis' | 'taxWord' | 'confirmedAt' | 'switchDay' | 'answers'>,
): string {
  // F-1585: the HOUSE day the answer was given, the day ingest switches on —
  // never the UTC date of the instant, which is a day off near midnight.
  const since = reg.switchDay ?? null;
  // F-1624: after an earlier answer, the checks before this one keep it.
  const before =
    (reg.answers?.length ?? 0) > 1
      ? 'Checks recorded before then keep the answer they were recorded under.'
      : 'Checks recorded before then stay as your till sent them.';
  switch (reg.basis) {
    case 'prices_include_tax':
      return `Net sales are taken before ${reg.taxWord} for every check from ${since ?? 'the day this was answered'}: by the tax your till states, or by your rates below. ${before}`;
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

/**
 * F-1624: the house's answers as stretches, in the owner's words. Null when
 * there is only one answer (the row above already says it).
 */
export function answersSaid(reg: Pick<TaxBasisReadout, 'answers' | 'taxWord'>): string | null {
  const answers = reg.answers ?? [];
  if (answers.length < 2) return null;
  return `Your answers: ${answers
    .map((a) => `from ${a.fromDay ?? a.answeredAt.slice(0, 10)}, ${answerLabel(a.basis, reg.taxWord).toLowerCase()}`)
    .join('; ')}. Each covers the days until the next.`;
}

/** What Add will write, before it does. One pass, so the button and the sentence agree. */
export function readRateInputs(
  covers: RateCovers,
  category: string,
  rateRaw: string,
  from: string,
  taxWord: string,
  item: { id: string; name: string } | null = null,
): { canAdd: boolean; sentence: string; body: Parameters<typeof addTaxRate>[0] | null } {
  // '20%', '%20' (how Turkish writes it) and '20,5' all read as a percent (F-1589).
  const t = rateRaw.trim().replace(/^%\s*/, '').replace(/\s*%$/, '');
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
  if (covers === 'house_item' && item === null)
    return { canAdd: false, sentence: 'Choose the item the rate covers.', body: null };
  if (!ISO_DATE.test(from)) return { canAdd: false, sentence: 'Say the first day the rate applies.', body: null };
  const what =
    covers === 'house'
      ? 'everything the house sells'
      : covers === 'house_item' && item
        ? `“${item.name}”`
        : `the till category “${cat}”`;
  return {
    canAdd: true,
    sentence: `Add will record ${pct} percent ${taxWord} on ${what}, from ${from}. A rate is never edited: a change is a new rate from its own date.`,
    body:
      covers === 'house'
        ? { keyKind: 'house', ratePct: pct, effectiveFrom: from }
        : covers === 'house_item' && item
          ? { keyKind: 'house_item', key: item.id, ratePct: pct, effectiveFrom: from }
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

  const [covers, setCovers] = useState<RateCovers>('house');
  const [category, setCategory] = useState('');
  const [itemId, setItemId] = useState('');
  const item = (reg.items ?? []).find((i) => i.id === itemId) ?? null;
  const [rate, setRate] = useState('');
  const [from, setFrom] = useState(reg.today);
  const [rateBusy, setRateBusy] = useState(false);
  const [rateFailed, setRateFailed] = useState<string | null>(null);
  const rateRead = readRateInputs(covers, category, rate, from, reg.taxWord, item);
  const answersLine = answersSaid(reg);
  const showRates = reg.basis === 'prices_include_tax' || chosen === 'prices_include_tax';
  const inForce = (reg.rates ?? []).filter((r) => r.inForceToday);
  // F-1627: a withdrawn rate restates as a row with no percent; it is not a rate in force.
  const ratedInForce = inForce.filter((r) => r.ratePct !== null);
  // F-1586: a rate dated ahead stays on the page with its first day.
  const upcoming = (reg.rates ?? [])
    .filter((r) => r.upcoming === true)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0));
  const [withdrawing, setWithdrawing] = useState<TaxRateRow | null>(null);
  // F-1615: which till category's rate prices cocktails; nothing is guessed from a name.
  const cocktailChoices = cocktailCategories(reg.rates);
  const cocktailNow = reg.cocktailCategory ?? null;
  const [cocktailPick, setCocktailPick] = useState<string | null>(cocktailNow);
  const [cocktailBusy, setCocktailBusy] = useState(false);
  const [cocktailFailed, setCocktailFailed] = useState<string | null>(null);
  const cocktailRead = readCocktailChoice(cocktailPick, cocktailNow);
  const saveCocktail = async (category: string | null) => {
    setCocktailBusy(true);
    setCocktailFailed(null);
    try {
      const next = await setCocktailTaxCategory(category);
      setCocktailPick(next.cocktailCategory ?? null);
      onRecorded(next);
    } catch (err) {
      setCocktailFailed(messageOf(err));
    } finally {
      setCocktailBusy(false);
    }
  };
  const [withdrawFailed, setWithdrawFailed] = useState<string | null>(null);

  /**
   * A quick-fill covers one kind of sale, so it is a till category, never everything (F-1593).
   * A category another quick-fill wrote is replaced, so 10% food then 20% alcohol is two
   * rates, not food at 20% (F-1611); a name the owner typed is kept.
   */
  const quickFill = (p: { label: string; ratePct: number }) => {
    setRate(String(p.ratePct));
    setCovers('pos_category');
    const filled = new Set((reg.proposal?.rates ?? []).map((q) => q.label));
    setCategory((c) => (c.trim() && !filled.has(c.trim()) ? c : p.label));
  };

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
      // F-1611: the next rate starts from an empty category, never this one's.
      setCategory('');
      setItemId('');
    } catch (err) {
      setRateFailed(messageOf(err));
    } finally {
      setRateBusy(false);
    }
  };

  const withdraw = async () => {
    if (!withdrawing) return;
    setRateBusy(true);
    setWithdrawFailed(null);
    try {
      onRecorded(await withdrawTaxRate(withdrawing.version));
      setWithdrawing(null);
    } catch (err) {
      setWithdrawFailed(messageOf(err));
    } finally {
      setRateBusy(false);
    }
  };
  const rateSaid = (r: TaxRateRow) =>
    r.ratePct === null ? `none on ${rateCovers(r)} (withdrawn)` : `${r.ratePct}% on ${rateCovers(r)}`;
  const withdrawButton = (r: TaxRateRow) =>
    canManage && r.ratePct !== null ? (
      <>
        {' '}
        <button
          type="button"
          className="st-ink st-focus"
          disabled={rateBusy}
          onClick={() => {
            setWithdrawFailed(null);
            setWithdrawing(r);
          }}
          style={{ fontFamily: SANS, fontSize: 11.5, border: 'none', background: 'none', padding: 0, textDecoration: 'underline', cursor: 'pointer', color: 'var(--ink-1)' }}
        >
          Withdraw
        </button>
      </>
    ) : null;

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
          <p data-testid="tax-basis-proposal" style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-4)', margin: '5px 0 0' }}>
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
        {answersLine && (
          <p data-testid="tax-basis-answers" style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-4)', margin: '5px 0 0' }}>
            {answersLine}
          </p>
        )}
        {reg.answered && reg.answers === null && (
          <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-4)', margin: '5px 0 0' }}>
            Earlier answers could not be read — {reg.answersReason ?? 'no reason was given'}.
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
            ) : (
              <>
                {ratedInForce.length === 0 ? (
                  <>
                    <strong>No rate is in force today.</strong> Until one is, a check whose till states no tax has no net
                    figure, and it is counted as “not recorded” rather than guessed.
                  </>
                ) : (
                  <>
                    In force on {reg.today}
                    {reg.todayOnHouseClock ? '' : ' (UTC; this house has no time zone set)'}:{' '}
                    {inForce.map((r, i) => (
                      <span key={r.version}>
                        {i > 0 && '; '}
                        {rateSaid(r)}
                        {withdrawButton(r)}
                      </span>
                    ))}
                    .
                  </>
                )}
                {upcoming.length > 0 && (
                  <span data-testid="tax-rates-upcoming">
                    {' '}Coming:{' '}
                    {upcoming.map((r, i) => (
                      <span key={r.version}>
                        {i > 0 && '; '}
                        from {r.effectiveFrom}, {rateSaid(r)}
                        {withdrawButton(r)}
                      </span>
                    ))}
                    .
                  </span>
                )}
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
                  { value: 'house_item', label: 'One item' },
                ]}
                onChange={setCovers}
              />
              {covers === 'house_item' &&
                (reg.items && reg.items.length > 0 ? (
                  <>
                    <select
                      aria-label="Item"
                      value={itemId}
                      disabled={!canManage || rateBusy}
                      onChange={(e) => setItemId(e.target.value)}
                      className="st-ink st-focus"
                      style={{ ...fieldStyle, width: 220 }}
                    >
                      <option value="">Choose an item</option>
                      {reg.items.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                        </option>
                      ))}
                    </select>
                    {reg.itemsCapped ? (
                      <span data-testid="tax-items-cut" style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-4)' }}>
                        Only the first {reg.items.length} of the house’s items, by name, are listed here; an item past them is not in this list.
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-4)' }}>
                    {reg.items === null || reg.items === undefined
                      ? 'The house’s items could not be listed.'
                      : 'This house has no items yet.'}
                  </span>
                ))}
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
          {withdrawing && (
            <p role="status" data-testid="tax-rate-withdraw" style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-1)', margin: '5px 0 0' }}>
              Withdraw will stop {withdrawing.ratePct}% on {rateCovers(withdrawing)} from{' '}
              {withdrawFrom(withdrawing, reg.today)}; whatever applied before it applies again from that day. Checks
              already recorded are not changed.{' '}
              <Action disabled={!canManage || rateBusy} onClick={() => void withdraw()}>
                {rateBusy ? 'Withdrawing…' : 'Withdraw it'}
              </Action>{' '}
              <button
                type="button"
                className="st-ink st-focus"
                disabled={rateBusy}
                onClick={() => setWithdrawing(null)}
                style={{ fontFamily: SANS, fontSize: 11.5, border: 'none', background: 'none', padding: 0, textDecoration: 'underline', cursor: 'pointer', color: 'var(--ink-4)' }}
              >
                Keep it
              </button>
              {withdrawFailed && (
                <span role="alert"> The rate was not withdrawn — {withdrawFailed}. Nothing was changed.</span>
              )}
            </p>
          )}
          {proposal && proposal.rates.length > 0 && canManage && (
            <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-4)', margin: '5px 0 0' }}>
              Common rates here:{' '}
              {proposal.rates.map((p, i) => (
                <span key={p.label}>
                  {i > 0 && ' · '}
                  <button
                    type="button"
                    className="st-ink st-focus"
                    onClick={() => quickFill(p)}
                    style={{ fontFamily: SANS, fontSize: 11.5, border: 'none', background: 'none', padding: 0, textDecoration: 'underline', cursor: 'pointer', color: 'var(--ink-1)' }}
                  >
                    {p.ratePct}% {p.label.toLowerCase()}
                  </button>
                </span>
              ))}
              . Each covers one kind of sale, so it fills in a till category: change it to the name your till uses.
            </p>
          )}
        </Row>
      )}

      {reg.basis === 'prices_include_tax' && reg.rates !== null && (cocktailChoices.length > 0 || cocktailNow !== null) && (
        <Row
          label="Cocktails"
          consequence={
            reg.cocktailCategoryReason ? (
              <>Which till category prices cocktails could not be read — {reg.cocktailCategoryReason}.</>
            ) : cocktailNow !== null ? (
              <>
                Cocktail margins are worked out without the rate of the till category “{cocktailNow}”.
                {!cocktailChoices.includes(cocktailNow) && ' That category has no rate now, so cocktails show no margin until it has one or another is chosen.'}
              </>
            ) : (
              <>
                <strong>Not chosen.</strong> A cocktail is not one of your stock items, so while your rates are set by till
                category its margin is not shown until you say which category it is rung up under.
              </>
            )
          }
          control={
            <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
              <Choice
                label="Till category for cocktails"
                value={cocktailPick}
                disabled={!canManage || cocktailBusy}
                options={cocktailChoices.map((c) => ({ value: c, label: c }))}
                onChange={setCocktailPick}
              />
              <Action disabled={!canManage || cocktailBusy || !cocktailRead.canSave} onClick={() => void saveCocktail(cocktailPick)}>
                {cocktailBusy ? 'Saving…' : 'Save'}
              </Action>
            </span>
          }
        >
          <p data-testid="cocktail-tax-sentence" style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-4)', margin: '5px 0 0' }}>
            {cocktailRead.sentence}{' '}
            {canManage && cocktailNow !== null && (
              <button
                type="button"
                className="st-ink st-focus"
                disabled={cocktailBusy}
                onClick={() => void saveCocktail(null)}
                style={{ fontFamily: SANS, fontSize: 11.5, border: 'none', background: 'none', padding: 0, textDecoration: 'underline', cursor: 'pointer', color: 'var(--ink-1)' }}
              >
                Take the choice back
              </button>
            )}
          </p>
          {cocktailFailed && (
            <p role="alert" style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-1)', margin: '5px 0 0' }}>
              That did not go through — {cocktailFailed}. Nothing was recorded.
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
 * Shown before the till's first check too (F-1590): on the dashboard of a
 * house with no till yet and beside the till on Connections, because a check
 * that arrives before the answer is never made pre-tax later (F2).
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
      sent. Net is taken before {reg.taxWord} only from the day you answer; checks recorded before then stay as the
      till sent them.{' '}
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
