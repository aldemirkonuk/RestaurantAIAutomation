/**
 * The agreement, written down with the unit its price is in — ADR 0119 phase 1.
 *
 * WHAT THIS IS FOR, IN ONE LINE
 * -----------------------------
 * `/orders` could show an agreement and could not state one. The rebuilt page
 * shipped as a ledger — read, approve, chase — and the only way to place an
 * order was the legacy desk, which offers `case | bottle`, sends no pack size,
 * and is therefore REFUSED by `resolveOrderUnits` for every case order it tries
 * to place. This sheet is the rebuilt page's own composer, and the reason it
 * exists now rather than later is the founder's call of 2026-09-04: *ship the
 * columns and the /orders field together*, so the schema never holds a unit
 * nobody can state.
 *
 * THE ONE STRUCTURAL IDEA
 * -----------------------
 * **Two units, side by side, and the page says which is which.** The order
 * states how much was bought (5 cases of 12) and the price states what it is
 * quoted in ($420 per case, or $35 per bottle — both are ordinary on the same
 * order). Until this pass the second was an assumption made by arithmetic, and
 * the row a person read said `case` beside a column called `final_unit_price`
 * that meant per bottle. Here the two sit in adjacent fields with the total
 * underneath and its working spelled out, so the ambiguity is impossible to
 * carry off the screen.
 *
 * HONESTY (ADR 0020 / ADR 0083)
 * -----------------------------
 *  * The register's refusal is printed BEFORE the save, not logged after it: an
 *    agreement with no stated price unit says, in the register's own words,
 *    that it will not enter the price register. It still saves — a NULL pair is
 *    a legal, ordinary row — but nobody saves one by accident.
 *  * A price unit the order cannot be counted in blocks the save with the
 *    sentence the gateway would answer, rather than showing a total the server
 *    will refuse.
 *  * The shelf and the vendor lists say when they could not be read. An empty
 *    list that means "we could not fetch" is the fault this whole wave exists
 *    to end.
 *  * Every figure is the desk's own; nothing is prefilled with a plausible
 *    number, and no unit is preselected — a preselected `bottle` would be the
 *    assumption the schema change removes, put back by the UI.
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Panel } from '@/components/mudavym';
import { useAuth } from '@/contexts/AuthContext';
import { apiClient, getErrorMessage } from '@/services/api/client';
import { useInventory } from '@/hooks/queries/useInventoryQueries';
import { useProviders } from '@/hooks/queries/useProviderQueries';
import { queryKeys } from '@/lib/query-keys';
import { CURRENCY_CODES, currencyLabel, currencyToRecord as resolveCurrency } from '@/lib/currency';
import { EM, MONO, SANS, SERIF, fmtMoney } from './format';
import {
  PRICE_UOMS,
  PRICE_UOM_LABEL,
  UNSTATED_PRICE_UNIT_REFUSAL,
  agreementTotal,
  halfStatedRefusal,
  isMultiplying,
  type AgreementFees,
  type PriceUom,
} from './price-unit';

/** The order's own unit vocabulary — the same seven the price may use. */
const ORDER_UOMS = PRICE_UOMS;

const ORDER_UOM_LABEL: Record<PriceUom, string> = {
  bottle: 'bottles',
  case: 'cases',
  keg: 'kegs',
  pack: 'packs',
  split_case: 'split cases',
  each: 'each',
  liter: 'litres',
};

const fieldStyle: React.CSSProperties = {
  width: '100%',
  fontFamily: SANS,
  fontSize: 13,
  padding: '7px 9px',
  borderRadius: 8,
  border: '1px solid var(--paper-2, #EAE4D8)',
  background: 'var(--paper-0, #FAF7F1)',
  color: 'var(--ink-1, #211C16)',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: MONO,
  fontSize: 9,
  fontWeight: 600,
  letterSpacing: '0.13em',
  textTransform: 'uppercase',
  color: 'var(--ink-3, #7C7365)',
  marginBottom: 4,
};

function Note({
  children,
  tone = 'quiet',
  testId,
}: {
  children: React.ReactNode;
  tone?: 'quiet' | 'said';
  testId?: string;
}) {
  return (
    <p
      data-testid={testId}
      style={{
        fontFamily: SANS,
        fontSize: 11.5,
        lineHeight: 1.45,
        margin: '6px 0 0',
        color: tone === 'said' ? 'var(--ink-2, #4F473C)' : 'var(--ink-3, #7C7365)',
        ...(tone === 'said'
          ? {
              borderLeft: '2px solid var(--seal-ring, rgba(26,94,107,.32))',
              paddingLeft: 8,
            }
          : null),
      }}
    >
      {children}
    </p>
  );
}

export interface AgreementSheetProps {
  open: boolean;
  onClose: () => void;
  /** Called with the new order's id once the gateway has written it. */
  onSaved?: (orderId: string) => void;
}

export function AgreementSheet({ open, onClose, onSaved }: AgreementSheetProps) {
  const { activeRestaurantId, user } = useAuth();
  const restaurantId = activeRestaurantId || user?.restaurantId || '';
  const queryClient = useQueryClient();

  const inventory = useInventory();
  const providers = useProviders(restaurantId);

  const [inventoryId, setInventoryId] = useState('');
  const [providerId, setProviderId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitType, setUnitType] = useState<PriceUom>('bottle');
  const [bottlesPerUnit, setBottlesPerUnit] = useState('');
  const [price, setPrice] = useState('');
  // No default. A preselected unit is the assumption this whole change removes.
  const [priceUom, setPriceUom] = useState<PriceUom | ''>('');
  const [pricePackSize, setPricePackSize] = useState('');
  // The money outside the price of the wine (ADR 0119 Q3). Empty is UNSTATED,
  // not zero: a $0.00 deposit is a claim about this vendor and an empty field
  // is not, and the two are kept apart all the way to the column.
  const [allowance, setAllowance] = useState('');
  const [deposit, setDeposit] = useState('');
  const [freight, setFreight] = useState('');
  /**
   * The money every amount on this line is in — ADR 0117 Q31, founder
   * 2026-09-05: *"defaulted from the vendor's terms or the house, stated on the
   * sheet"*.
   *
   * `null` means untouched, so the STATED DEFAULT below stands and is what gets
   * sent; `''` means the person explicitly chose "not now" and nothing is
   * recorded. Those are different answers and the column can hold both, which
   * is the whole reason `procurement_order_items.currency` is nullable with no
   * default: a defaulted currency is a claim about a vendor nobody made.
   */
  const [currencyChoice, setCurrencyChoice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // A restaurant switch must never leave the previous house's shelf item in the
  // form. The queries are already tenant-keyed; the local state is not.
  useEffect(() => {
    setInventoryId('');
    setProviderId('');
  }, [restaurantId]);

  const num = (v: string): number | null => {
    const t = v.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };

  const qty = num(quantity);
  const priceNum = num(price);
  const packNum = num(bottlesPerUnit);
  const pricePackNum = num(pricePackSize);

  // The pair, as it will be sent. A non-multiplying unit's pack is exactly 1 by
  // the database's own CHECK, so the field is not shown and the 1 is implied
  // rather than typed — implying a 1 for "one bottle is one bottle" is not the
  // kind of assumption this ADR forbids; implying a unit is.
  const stated = useMemo(() => {
    if (priceUom === '') return null;
    if (isMultiplying(priceUom)) {
      return pricePackNum != null && pricePackNum >= 1
        ? { priceUom, pricePackSize: pricePackNum }
        : null;
    }
    return { priceUom, pricePackSize: 1 };
  }, [priceUom, pricePackNum]);

  const packMissing = priceUom !== '' && isMultiplying(priceUom) && stated === null;

  /**
   * The currency this sheet OFFERS, from the gateway's own chain.
   *
   * Deliberately not computed here. `agreement-currency.ts` resolves it and the
   * WRITER uses the same function, so the default a person confirms is the
   * default the row would have taken. A second copy of the chain in the browser
   * would drift, and the first symptom would be a line recorded in a currency
   * nobody was shown.
   *
   * SINCE 2026-09-06 (founder, batch 65) THE ONLY THING PRE-FILLED IS THE
   * VENDOR'S OWN STATED USUAL CURRENCY. What this house reports in and what the
   * vendor last billed in are still shown, under `alsoKnown`, as evidence — but
   * neither is put in the field. The order records `vendor_usual` or `typed` and
   * nothing else, so a house-derived value submitted untouched would be filed as
   * a person's choice when nobody made one.
   *
   * A failed fetch offers NOTHING rather than a guess: `code: null` renders as
   * "we could not work one out", which is true, where a fallback would render as
   * a claim.
   */
  const currencyDefaultQuery = useQuery({
    queryKey: ['agreement-currency', restaurantId, providerId],
    enabled: open && Boolean(restaurantId),
    queryFn: async () => {
      const { data } = await apiClient.get<{
        code: string | null;
        basis: 'vendor_usual' | null;
        sentence: string;
        alsoKnown?: { vendorPaper: string | null; house: string | null };
      }>('/procurement/agreement-currency', {
        params: providerId ? { providerId } : undefined,
      });
      return data;
    },
  });
  const offeredCurrency = currencyDefaultQuery.data?.code ?? null;
  const currencyToRecord = resolveCurrency(currencyChoice, offeredCurrency);

  // A negative fee is refused by the database CHECKs — the direction is carried
  // by the field's name, never by a sign — so a typed minus reads as UNSTATED
  // here rather than as a number the save would 400 on.
  const fee = (v: string): number | null => {
    const n = num(v);
    return n !== null && n >= 0 ? n : null;
  };
  const fees: AgreementFees = useMemo(
    () => ({
      allowance: fee(allowance),
      deposit: fee(deposit),
      freight: fee(freight),
    }),
    [allowance, deposit, freight],
  );

  const total = useMemo(
    () =>
      agreementTotal({
        price: priceNum,
        stated,
        quantity: qty,
        unitType,
        bottlesPerUnit: packNum,
        fees,
      }),
    [priceNum, stated, qty, unitType, packNum, fees],
  );

  const orderPackMissing = isMultiplying(unitType) && (packNum == null || packNum < 1);

  const blocked =
    !inventoryId ||
    !providerId ||
    qty == null ||
    qty < 1 ||
    priceNum == null ||
    priceNum <= 0 ||
    orderPackMissing ||
    packMissing ||
    (total !== null && total.ok === false);

  const reset = () => {
    setQuantity('');
    setBottlesPerUnit('');
    setPrice('');
    setPriceUom('');
    setPricePackSize('');
    setAllowance('');
    setDeposit('');
    setFreight('');
    setCurrencyChoice(null);
    setFailure(null);
  };

  const save = async () => {
    if (blocked || saving) return;
    setSaving(true);
    setFailure(null);
    try {
      // The authenticated client, never raw fetch. The body is the gateway's
      // own DTO (`CreateOrderDto`) — `services/api/orders.ts::createOrder` takes
      // the older `{ wineId, unitPrice }` shape, which the gateway does not
      // accept, so this posts the DTO directly rather than widening a type two
      // other pages depend on.
      const { data } = await apiClient.post<{ id?: string }>('/procurement/orders', {
        inventoryId,
        providerId,
        quantity: qty,
        unitType,
        bottlesPerUnit: isMultiplying(unitType) ? packNum : undefined,
        finalPrice: priceNum,
        priceUom: stated?.priceUom,
        pricePackSize: stated?.pricePackSize,
        // `undefined` where the desk stated nothing, so the key never reaches
        // the wire and the column keeps NULL. Sending 0 would record that this
        // vendor charges no deposit, which nobody said.
        allowance: fees.allowance ?? undefined,
        deposit: fees.deposit ?? undefined,
        freight: fees.freight ?? undefined,
        // The confirmed default, or the person's change, or nothing at all.
        // Never `|| 'USD'` — that fallback is what put dollars on a restaurant
        // in Fethiye for seven months (ADR 0117 Q25/Q31).
        currency: currencyToRecord ?? undefined,
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
      reset();
      onSaved?.(data?.id ?? '');
      onClose();
    } catch (e) {
      // Verbatim. The gateway's refusals are written to be read — "an order in
      // cases needs a pack size", "half a statement cannot be converted" — and
      // replacing one with "Failed to create order" is the shrug this page
      // exists not to give.
      setFailure(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const shelfError = inventory.isError
    ? `The shelf could not be read (${getErrorMessage(inventory.error)}).`
    : null;
  const vendorError = providers.isError
    ? `The vendor list could not be read (${getErrorMessage(providers.error)}).`
    : null;

  return (
    <Panel
      open={open}
      onClose={onClose}
      label="Write down an agreement"
      eyebrow="New agreement"
      title="What was agreed"
      closeLabel="Put it down"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-3, #7C7365)' }}>
            {stated
              ? `The register will read this as ${PRICE_UOM_LABEL[stated.priceUom]}.`
              : 'No price unit stated.'}
          </span>
          <button
            type="button"
            onClick={save}
            disabled={blocked || saving}
            data-testid="agreement-save"
            style={{
              fontFamily: SANS,
              fontSize: 12.5,
              fontWeight: 600,
              padding: '7px 14px',
              borderRadius: 9,
              border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
              background: blocked || saving ? 'transparent' : 'var(--seal-tint, rgba(26,94,107,.10))',
              color: 'var(--seal-deep, #14515C)',
              opacity: blocked || saving ? 0.55 : 1,
              cursor: blocked || saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Writing it down…' : 'Write it down'}
          </button>
        </div>
      }
    >
      {/* `.mdv-ovl__body` sets flex/overflow and NO padding — the primitive
          leaves the inset to the content, and every other consumer pads its
          own (`sheet.css:226`). Measured before this line existed: the fields
          sat flush to the panel edge at x=411 while the header title was inset
          16px, and the pack field's focus ring was clipped by the panel's own
          border. 16px matches `.mdv-ovl__head` and `.mdv-ovl__foot`. */}
      <div style={{ display: 'grid', gap: 14, padding: '10px 16px 14px' }}>
        {failure && (
          <p
            role="alert"
            data-testid="agreement-failure"
            style={{
              fontFamily: SANS,
              fontSize: 12,
              lineHeight: 1.5,
              margin: 0,
              padding: '8px 10px',
              borderRadius: 9,
              border: '1px solid var(--paper-2, #EAE4D8)',
              background: 'var(--paper-1, #F3EFE6)',
              color: 'var(--ink-2, #4F473C)',
            }}
          >
            Nothing was written down. {failure}
          </p>
        )}

        {/* ── what, and from whom ─────────────────────────────────────── */}
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
          <div>
            <label style={labelStyle} htmlFor="ag-wine">
              Wine
            </label>
            <select
              id="ag-wine"
              style={fieldStyle}
              value={inventoryId}
              onChange={(e) => setInventoryId(e.target.value)}
            >
              <option value="">
                {inventory.isLoading ? 'Reading the shelf…' : 'Choose a wine'}
              </option>
              {(inventory.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.wineName ?? EM}
                  {item.wineVintage ? ` ${item.wineVintage}` : ''}
                </option>
              ))}
            </select>
            {shelfError && <Note tone="said">{shelfError} Nothing can be ordered until it can be.</Note>}
          </div>
          <div>
            <label style={labelStyle} htmlFor="ag-vendor">
              Vendor
            </label>
            <select
              id="ag-vendor"
              style={fieldStyle}
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
            >
              <option value="">
                {providers.isLoading ? 'Reading the vendors…' : 'Choose a vendor'}
              </option>
              {(providers.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {vendorError && <Note tone="said">{vendorError}</Note>}
          </div>
        </div>

        {/* ── how much: the QUANTITY's unit ───────────────────────────── */}
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={labelStyle}>How much was bought</legend>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '90px 1fr 110px' }}>
            <input
              aria-label="Quantity"
              inputMode="numeric"
              placeholder="0"
              style={{ ...fieldStyle, fontFamily: MONO }}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
            <select
              aria-label="Order unit"
              style={fieldStyle}
              value={unitType}
              onChange={(e) => setUnitType(e.target.value as PriceUom)}
            >
              {ORDER_UOMS.map((u) => (
                <option key={u} value={u}>
                  {ORDER_UOM_LABEL[u]}
                </option>
              ))}
            </select>
            {isMultiplying(unitType) && (
              <input
                aria-label="Bottles in one order unit"
                inputMode="numeric"
                placeholder="bottles"
                style={{ ...fieldStyle, fontFamily: MONO }}
                value={bottlesPerUnit}
                onChange={(e) => setBottlesPerUnit(e.target.value)}
              />
            )}
          </div>
          {orderPackMissing && (
            <Note tone="said">
              An order in {ORDER_UOM_LABEL[unitType]} needs the pack size. Guessing twelve books
              twelve times the delivery and guessing one books a twelfth of it, so the order is
              refused until it is stated.
            </Note>
          )}
        </fieldset>

        {/* ── the price, and the unit it is IN ────────────────────────── */}
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={labelStyle}>What was agreed, and what it is per</legend>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '110px 1fr 110px' }}>
            <input
              aria-label="Agreed price"
              inputMode="decimal"
              placeholder="0.00"
              style={{ ...fieldStyle, fontFamily: MONO }}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
            <select
              aria-label="Price unit"
              data-testid="price-uom"
              style={fieldStyle}
              value={priceUom}
              onChange={(e) => setPriceUom(e.target.value as PriceUom | '')}
            >
              <option value="">unit not stated</option>
              {PRICE_UOMS.map((u) => (
                <option key={u} value={u}>
                  {PRICE_UOM_LABEL[u]}
                </option>
              ))}
            </select>
            {isMultiplying(priceUom === '' ? null : priceUom) && (
              <input
                aria-label="Bottles in one priced unit"
                data-testid="price-pack"
                inputMode="numeric"
                placeholder="bottles"
                style={{ ...fieldStyle, fontFamily: MONO }}
                value={pricePackSize}
                onChange={(e) => setPricePackSize(e.target.value)}
              />
            )}
          </div>
          {/* `packMissing` already carries `priceUom !== ''` — TypeScript's
              aliased-condition narrowing sees it, so repeating the guard here
              is dead code rather than defence. */}
          {packMissing && (
            <Note tone="said" testId="half-stated">
              {halfStatedRefusal(priceUom)}
            </Note>
          )}
          {priceUom === '' && (
            <Note tone="said">
              <strong style={{ fontWeight: 600 }}>{UNSTATED_PRICE_UNIT_REFUSAL}</strong> The
              agreement is still saved and still an order — stating the unit is what admits it.
            </Note>
          )}
          {/* "That is ordinary" is only true when the two units can actually be
              counted against each other. On a keg order priced per bottle it is
              the opposite of true, and the refusal below says so — printing
              both would have the page contradict itself in adjacent lines. */}
          {priceUom !== '' &&
            !packMissing &&
            unitType !== priceUom &&
            !(total && total.ok === false) && (
              <Note>
                The order is counted in {ORDER_UOM_LABEL[unitType]} and the price is quoted{' '}
                {PRICE_UOM_LABEL[priceUom]}. That is ordinary — a bottle price and a case price
                are posted separately for the same wine.
              </Note>
            )}
        </fieldset>

        {/* ── the money all of it is in ───────────────────────────────── */}
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={labelStyle}>What money this is in</legend>
          <select
            id="ag-currency"
            data-testid="agreement-currency"
            aria-label="Currency"
            style={{ ...fieldStyle, width: '100%' }}
            value={currencyChoice ?? offeredCurrency ?? ''}
            onChange={(e) => setCurrencyChoice(e.target.value)}
          >
            <option value="">Not stated — record no currency on this line</option>
            {CURRENCY_CODES.map((code) => (
              <option key={code} value={code}>
                {currencyLabel(code)}
              </option>
            ))}
          </select>
          <Note>
            {currencyDefaultQuery.isLoading
              ? 'Reading what this vendor usually bills in…'
              : currencyToRecord
                ? currencyChoice === null && currencyDefaultQuery.data?.sentence
                  ? currencyDefaultQuery.data.sentence
                  : `This order will be recorded in ${currencyToRecord}${
                      currencyChoice !== null &&
                      currencyDefaultQuery.data?.code !== currencyToRecord
                        ? ', which you chose rather than the one this vendor usually uses'
                        : ''
                    }.`
                : (currencyDefaultQuery.data?.sentence ??
                  'Nothing will be recorded, and every amount on this line will read as “currency not recorded”.')}{' '}
            Every amount above is in it — the price, the total, and each of the
            three charges below. Nothing is converted anywhere: a comparison
            across two currencies refuses rather than guessing a rate.
            {/*
              THE PROMPT, founder 2026-09-06 batch 66: *"Add the prompt panel"* —
              "One panel on the providers page (and the orders sheet's empty
              field) saying how many vendors have stated a usual currency and
              linking to the ones that have not. No provenance lie."

              Shown only when a vendor IS picked and the gateway ANSWERED that
              they have stated none. A failed lookup is excluded on purpose: it
              would send somebody to a profile to fix a field that may already be
              filled in, and it would state as fact something the read did not
              return. The house's currency stays a CHOICE in the list above and
              is named in the gateway's own sentence — this link changes nothing
              on this order; it is how the next one starts with something.

              A plain anchor rather than a router link: this sheet renders in
              suites that mount it without a router, and the target page reads
              `?vendor=` at mount, so a full navigation is the honest cost.
            */}
            {providerId &&
            !currencyDefaultQuery.isLoading &&
            !currencyDefaultQuery.isError &&
            currencyDefaultQuery.data &&
            currencyDefaultQuery.data.code === null ? (
              <>
                {' '}
                This vendor has stated no usual currency —{' '}
                <a
                  data-testid="state-usual-currency-link"
                  href={`/providers?vendor=${encodeURIComponent(providerId)}`}
                  style={{ color: 'var(--seal-deep, #14515C)' }}
                >
                  state it on the vendor&rsquo;s profile
                </a>{' '}
                and every future order to them starts with it. Nothing is
                pre-filled here in the meantime.
              </>
            ) : null}
          </Note>
        </fieldset>

        {/* ── the money outside the price of the wine ─────────────────── */}
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={labelStyle}>What else the agreement charges</legend>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr 1fr' }}>
            <div>
              <label style={{ ...labelStyle, letterSpacing: '0.08em' }} htmlFor="ag-allowance">
                Allowance (off)
              </label>
              <input
                id="ag-allowance"
                data-testid="fee-allowance"
                inputMode="decimal"
                placeholder="none"
                style={{ ...fieldStyle, fontFamily: MONO }}
                value={allowance}
                onChange={(e) => setAllowance(e.target.value)}
              />
            </div>
            <div>
              <label style={{ ...labelStyle, letterSpacing: '0.08em' }} htmlFor="ag-deposit">
                Deposit (on)
              </label>
              <input
                id="ag-deposit"
                data-testid="fee-deposit"
                inputMode="decimal"
                placeholder="none"
                style={{ ...fieldStyle, fontFamily: MONO }}
                value={deposit}
                onChange={(e) => setDeposit(e.target.value)}
              />
            </div>
            <div>
              <label style={{ ...labelStyle, letterSpacing: '0.08em' }} htmlFor="ag-freight">
                Freight (on)
              </label>
              <input
                id="ag-freight"
                data-testid="fee-freight"
                inputMode="decimal"
                placeholder="none"
                style={{ ...fieldStyle, fontFamily: MONO }}
                value={freight}
                onChange={(e) => setFreight(e.target.value)}
              />
            </div>
          </div>
          <Note>
            Each is for the whole line, entered as a positive amount — the field says which way
            it goes. Left empty they are not recorded at all, which is not the same as recording
            a zero. They stay OUT of the price above on purpose: a deposit folded into the price
            of the wine becomes a permanent price rise on a bottle that will be refunded.
          </Note>
          {/* A split case is its own line, so there is no split-case fee field
              here and there is not going to be one. The vocabulary carries it:
              price the broken case per split case, on its own agreement. */}
        </fieldset>

        {/* ── the total, drawn from the pair, with its working ────────── */}
        <div
          style={{
            borderTop: '1px solid var(--paper-2, #EAE4D8)',
            borderBottom: '3px double var(--paper-2, #EAE4D8)',
            padding: '10px 0',
          }}
        >
          <div className="flex items-baseline justify-between gap-3">
            <span style={labelStyle}>The agreement comes to</span>
            <span
              data-testid="agreement-total"
              style={{
                fontFamily: MONO,
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: '-0.02em',
                color: 'var(--ink-1, #211C16)',
              }}
            >
              {total && total.ok ? fmtMoney(total.total) : EM}
            </span>
          </div>
          {total && total.ok ? (
            <Note testId="agreement-working">{total.working}</Note>
          ) : total && !total.ok ? (
            <Note tone="said" testId="agreement-uncountable">
              {total.message}
            </Note>
          ) : (
            <Note>
              A total needs a quantity and a price. Until both are stated this stays {EM}, never a
              zero.
            </Note>
          )}
          <p
            style={{
              fontFamily: SERIF,
              fontSize: 12,
              fontStyle: 'italic',
              color: 'var(--ink-3, #7C7365)',
              margin: '8px 0 0',
            }}
          >
            The order says how much; the price says what it is per. They need not be the same word.
          </p>
        </div>
      </div>
    </Panel>
  );
}

export default AgreementSheet;
