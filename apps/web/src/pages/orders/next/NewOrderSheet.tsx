/**
 * "A new order" — the owed act on `/orders`, and the manual entry the founder
 * chose at fork F5 (2026-09-05).
 *
 * WHAT WAS OWED, EXACTLY. The rebuilt page has two composers already and
 * neither is this one. `AgreementSheet` writes ONE line — one wine, one vendor,
 * one price statement — and `DraftRail` shows what the engine drafted. The
 * legacy desk could do the thing neither can: build a CART. Search the register,
 * add several wines, name a vendor per wine, and place the lot in one act
 * (`pages/orders/CreateOrderModal.tsx:123`, placed by `Orders.tsx:902-1046`,
 * which loops items × selected vendors and posts one order per pair). So the
 * gap is not "a composer" — it is *several lines placed together, and an honest
 * account of which of them landed*.
 *
 * ONE POST PER LINE, BECAUSE THAT IS WHAT THE SCHEMA IS
 * -----------------------------------------------------
 * `CreateOrderDto` carries exactly one `inventoryId` and the writer stamps
 * `line_no: 1` (`procurement.service.ts:1263`). A four-line cart is therefore
 * four orders, exactly as the legacy desk placed them. That makes PARTIAL
 * SUCCESS the ordinary case, and this sheet's central obligation: after the
 * button, every line says what happened to IT — placed with its order number,
 * or refused with the gateway's own sentence — and a refused line stays in the
 * composer with its words. A cart that reported "3 of 4 placed" as a green
 * toast and cleared itself is the thing this house calls a lie by omission.
 *
 * THE AGREEMENT, OFFERED AND NEVER APPLIED (sketch 103, 2c)
 * ---------------------------------------------------------
 * The census draws this sheet with "price and unit come from the agreement on
 * the vendor's row; a line without one asks first". Nothing could answer that,
 * so `GET /procurement/last-agreement` is NEW
 * (`procurement.controller.ts` — `lastAgreement`, service `lastAgreementFor`,
 * pure part `last-agreement.ts`). What it answers arrives GREY: the figure sits
 * beside the field as a proposal with a "Take it" control, and it is ink only
 * once a person has taken it. Nothing is prefilled. Its three states are three
 * states here too — a price on file, none on file, and a read that FAILED —
 * because "we could not look" drawn as "there is no agreed price" would send a
 * vendor a request to quote a wine they have already quoted.
 *
 * THE GUARD TRAVELS WITH IT. An order needs somebody to send it to. The empty
 * vendor list is caught before the sheet opens, and the gateway's 403
 * `no_vendors` is caught after — see `VendorFirstPanel`.
 *
 * NOTHING HERE SENDS. Placing an order writes a PENDING row; the letter to the
 * vendor is a separate, sealed act (ADR 0118), and the footer says so.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Sheet } from '@/components/mudavym';
import { useAuth } from '@/contexts/AuthContext';
import { apiClient, getErrorMessage } from '@/services/api/client';
import { useInventory } from '@/hooks/queries/useInventoryQueries';
import { useProviders } from '@/hooks/queries/useProviderQueries';
import { CURRENCY_CODES, currencyLabel } from '@/lib/currency';
import { queryKeys } from '@/lib/query-keys';
import { EM, MONO, SANS, SERIF } from './format';
import { PRICE_UOMS, PRICE_UOM_LABEL, isMultiplying, type PriceUom } from './price-unit';

/** What the new route answers. Four states, never collapsed into fewer. */
export interface LastAgreementVM {
  state: 'found' | 'none' | 'unreadable' | 'ambiguous';
  price?: number | null;
  priceUom?: string | null;
  pricePackSize?: number | null;
  currency?: string | null;
  sentence: string;
}

export interface OrderLine {
  /** Local only. The gateway never sees it. */
  key: string;
  inventoryId: string;
  wineName: string;
  providerId: string;
  quantity: string;
  unitType: PriceUom;
  bottlesPerUnit: string;
  price: string;
  priceUom: PriceUom | '';
  pricePackSize: string;
  currency: string;
  notes: string;
  /** The agreement offered for this pair, once it has been asked for. */
  offer: LastAgreementVM | null;
  /** In flight. Distinct from "answered with nothing". */
  asking: boolean;
  /** What happened to THIS line at the last save. */
  outcome: { ok: true; orderNumber: string } | { ok: false; message: string; uncertain?: boolean } | null;
}

let seq = 0;
function newLine(inventoryId: string, wineName: string): OrderLine {
  seq += 1;
  return {
    key: `line-${seq}`,
    inventoryId,
    wineName,
    providerId: '',
    quantity: '',
    // The order's own unit. `bottle` is the schema's own omitted-means default
    // (`CreateOrderDto.unitType`), and it multiplies nothing, so stating it here
    // assumes no pack size. A `case` default WOULD be an assumption.
    unitType: 'bottle',
    bottlesPerUnit: '',
    price: '', priceUom: '', pricePackSize: '', currency: '',
    notes: '',
    offer: null,
    asking: false,
    outcome: null,
  };
}

function num(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** What stops ONE line being placed, in words, or null when nothing does. */
export function lineRefusal(line: OrderLine): string | null {
  if (line.outcome && !line.outcome.ok && line.outcome.uncertain) return 'Check the order book before replacing this line; its earlier placement was not confirmed.';
  if (!line.providerId) return 'Name the vendor this line goes to.';
  const q = num(line.quantity);
  if (q == null || q < 1 || !Number.isInteger(q)) {
    return 'State how many, as a whole number of ' + PRICE_UOM_LABEL[line.unitType] + '.';
  }
  if (isMultiplying(line.unitType)) {
    const pack = num(line.bottlesPerUnit);
    if (pack == null || pack < 1 || !Number.isInteger(pack)) {
      // The gateway's own refusal, said before the round trip rather than after
      // it (`CreateOrderDto.bottlesPerUnit`): guessing 12 books twelve times the
      // delivery and guessing 1 books a twelfth of it.
      return `An order in ${PRICE_UOM_LABEL[line.unitType]} needs a pack size — how many bottles are in one.`;
    }
  }
  const p = num(line.price);
  if (line.price.trim() !== '' && (p == null || p <= 0)) {
    return 'A price has to be a number above zero, or be left for the vendor to answer.';
  }
  if (p !== null && p > 0) {
    if (!line.priceUom) return 'State the unit this price is for.';
    const pack = num(line.pricePackSize);
    if (pack == null || pack < 1 || !Number.isInteger(pack) || (!isMultiplying(line.priceUom) && pack !== 1)) return 'State a whole bottle count for the price unit.';
    if (!(CURRENCY_CODES as readonly string[]).includes(line.currency)) return 'State the currency this price is in.';
  }
  return null;
}

const fieldStyle: React.CSSProperties = {
  width: '100%',
  fontFamily: SANS,
  fontSize: 12.5,
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--paper-2, #EAE4D8)',
  background: 'var(--paper-0, #FAF7F1)',
  color: 'var(--ink-1, #211C16)',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: MONO,
  fontSize: 9,
  fontWeight: 600,
  letterSpacing: '0.11em',
  textTransform: 'uppercase',
  color: 'var(--ink-3, #7C7365)',
  marginBottom: 3,
};

export interface NewOrderSheetProps {
  open: boolean;
  onClose: () => void;
  /** Called when the gateway refuses with 403 no_vendors. */
  onNoVendors: () => void;
  /** Called after at least one line was placed, so the ledger refetches. */
  onPlaced?: () => void;
}

export function NewOrderSheet({ open, onClose, onNoVendors, onPlaced }: NewOrderSheetProps) {
  const { activeRestaurantId, user } = useAuth();
  const restaurantId = activeRestaurantId || user?.restaurantId || '';
  const actorId = user?.userId ?? '';
  const scope = `${actorId}:${restaurantId}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const placementGeneration = useRef(0);
  const agreementRequests = useRef(new Map<string, number>());
  const queryClient = useQueryClient();

  const inventory = useInventory();
  const providers = useProviders(restaurantId);

  const [search, setSearch] = useState('');
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [placing, setPlacing] = useState(false);
  /** The last thing that did not happen for the WHOLE act, in words. */
  const [failure, setFailure] = useState<string | null>(null);
  /** What the last save did, counted from the outcomes and never asserted. */
  const [tally, setTally] = useState<string | null>(null);

  // A house switch must never leave the previous house's shelf in the cart.
  useEffect(() => {
    setLines([]);
    setSearch('');
    setFailure(null);
    setTally(null);
    setPlacing(false);
    placementGeneration.current += 1;
    agreementRequests.current.clear();
  }, [scope]);

  const shelf = useMemo(() => (inventory.data ?? []) as Array<Record<string, any>>, [inventory.data]);
  const vendors = useMemo(() => (providers.data ?? []) as Array<Record<string, any>>, [providers.data]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q === '') return [];
    const taken = new Set(lines.map((l) => l.inventoryId));
    return shelf
      .filter((item) => {
        if (taken.has(item.id)) return false;
        const name = String(item.wineName ?? '').toLowerCase();
        const producer = String(item.producer ?? '').toLowerCase();
        return name.includes(q) || producer.includes(q);
      })
      .slice(0, 6);
  }, [search, shelf, lines]);

  const patch = useCallback((key: string, next: Partial<OrderLine>) => {
    setLines((prev) => prev.map((l) => (l.key === key && !l.outcome?.ok ? { ...l, ...next } : l)));
  }, []);

  /**
   * Ask the new route what was last agreed with this vendor for this item.
   *
   * Asked when the PAIR is complete and re-asked when either half changes,
   * because an agreement is a fact about the pair. A failed request answers
   * `unreadable` from the gateway; a request that throws (no route, no network)
   * is turned into the same state HERE rather than into silence, so the line
   * never renders as "no agreed price" for a reason that is not that.
   */
  const askAgreement = useCallback(
    async (key: string, providerId: string, inventoryId: string) => {
      const request = (agreementRequests.current.get(key) ?? 0) + 1;
      agreementRequests.current.set(key, request);
      const apply = (next: Partial<OrderLine>) => {
        if (!mounted.current || currentScope.current !== scope || agreementRequests.current.get(key) !== request) return;
        setLines((prev) => prev.map((line) => line.key === key && line.providerId === providerId && line.inventoryId === inventoryId && !line.outcome?.ok ? { ...line, ...next } : line));
      };
      patch(key, { asking: true, offer: null });
      try {
        const { data } = await apiClient.get<LastAgreementVM>('/procurement/last-agreement', {
          params: { providerId, inventoryId },
        });
        apply({ asking: false, offer: data ?? null });
      } catch (e) {
        apply({
          asking: false,
          offer: {
            state: 'unreadable',
            sentence: `The last agreement could not be read (${getErrorMessage(e)}). That is a failed read, not an empty book — state the price yourself.`,
          },
        });
      }
    },
    [patch, scope],
  );

  const addLine = (item: Record<string, any>) => {
    setLines((prev) => [...prev, newLine(String(item.id), String(item.wineName ?? EM))]);
    setSearch('');
  };

  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));

  const shelfError = inventory.isError
    ? `The shelf could not be read (${getErrorMessage(inventory.error)}). Nothing is listed because nothing could be read — this is not an empty shelf.`
    : null;
  const vendorError = providers.isError
    ? `The vendor list could not be read (${getErrorMessage(providers.error)}). Nothing is listed because nothing could be read — this is not a house with no vendors.`
    : null;

  const refusals = useMemo(
    () => new Map(lines.map((l) => [l.key, lineRefusal(l)])),
    [lines],
  );
  const canPlace =
    !placing && lines.some((l) => !l.outcome?.ok) && lines.every((l) => l.outcome?.ok || refusals.get(l.key) === null);

  /**
   * Place them. One POST per line, and the account is built from what came
   * back — never from what was asked for.
   */
  const place = async () => {
    if (!canPlace) return;
    const generation = ++placementGeneration.current;
    // Staleness is the PERSON and the HOUSE (the scope, whose change bumps the
    // generation) — never the access token. The API client refreshes an
    // expired token on a 401 and retries the same request, so a token that
    // changed mid-flight is the ordinary first placement after expiry: the
    // order WAS written, and bailing out here left the sheet on "Placing…"
    // with no receipt, inviting a duplicate order (lane E audit D2).
    const stillCurrent = () => mounted.current && currentScope.current === scope && placementGeneration.current === generation && (!localStorage.getItem('activeRestaurantId') || localStorage.getItem('activeRestaurantId') === restaurantId);
    setPlacing(true);
    setFailure(null);
    setTally(null);

    const attempted = lines.filter((l) => !l.outcome?.ok).length;
    let placed = 0;
    const survivors: OrderLine[] = [];

    for (const line of lines) {
      if (!stillCurrent()) return;
      if (line.outcome?.ok) { survivors.push(line); continue; }
      try {
        const { data } = await apiClient.post<{ id?: string; orderNumber?: string }>(
          '/procurement/orders',
          {
            inventoryId: line.inventoryId,
            providerId: line.providerId,
            quantity: num(line.quantity),
            unitType: line.unitType,
            bottlesPerUnit: isMultiplying(line.unitType)
              ? (num(line.bottlesPerUnit) ?? undefined)
              : undefined,
            // Left off entirely when the desk stated none. Sending 0 would
            // record that this vendor charges nothing, which nobody said.
            quotedPrice: num(line.price) ?? undefined,
            priceUom: num(line.price) !== null ? line.priceUom : undefined,
            pricePackSize: num(line.price) !== null ? num(line.pricePackSize) : undefined,
            currency: num(line.price) !== null ? line.currency : undefined,
            managerNotes: line.notes.trim() || undefined,
          },
        );
        if (!stillCurrent()) return;
        if (!data?.id && !data?.orderNumber) throw new Error('The gateway returned no order receipt. Check the order book before trying again.');
        placed += 1;
        // The placed line leaves the composer, but it leaves a RECEIPT: the
        // account below is what the gateway answered, order number and all.
        survivors.push({
          ...line,
          outcome: { ok: true, orderNumber: data?.orderNumber ?? data?.id ?? EM },
        });
      } catch (e) {
        if (!stillCurrent()) return;
        const status = (e as { response?: { status?: number; data?: { reason?: string } } })
          ?.response;
        if (status?.status === 403 && status?.data?.reason === 'no_vendors') {
          // The case a pre-flight read can never cover. Stop the loop — every
          // remaining line would be refused for the same reason — say what was
          // placed before it, and hand the page the guard.
          setLines(survivors.concat(lines.slice(survivors.length)));
          setTally(
            placed === 0
              ? 'Nothing was placed.'
              : `${placed} of ${lines.length} were placed before the refusal; the rest are untouched.`,
          );
          setPlacing(false);
          onNoVendors();
          return;
        }
        const uncertain = !status?.status || status.status >= 500;
        survivors.push({ ...line, outcome: { ok: false, uncertain, message: uncertain
          ? `Placement was not confirmed (${getErrorMessage(e)}). Check the order book before replacing this line.` : getErrorMessage(e) } });
      }
    }

    if (!stillCurrent()) return;
    setLines(survivors);
    setTally(
      placed === attempted
        ? `All ${placed} ${placed === 1 ? 'line was' : 'lines were'} placed. Each is a pending order waiting for approval; nothing has been sent to a vendor.`
        : `${placed} of ${attempted} were placed. Each remaining line states its refusal or an unconfirmed outcome; check the order book before retrying an unconfirmed placement.`,
    );
    if (placed > 0) {
      await queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
      onPlaced?.();
    }
    setPlacing(false);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      /* The contract, as the accessible name (sketch 103, 1e). */
      label="Write a new order. Placing it writes one pending order per line, for a person to approve later. Nothing is sent to a vendor and leaving writes nothing."
      eyebrow="The order book"
      title="A new order"
      closeLabel="Put it down"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-3, #7C7365)' }}>
            Nothing is sent by placing an order — the letter is its own sealed act.
          </span>
          <button
            type="button"
            onClick={() => void place()}
            disabled={!canPlace}
            data-testid="new-order-place"
            style={{
              fontFamily: SANS,
              fontSize: 12.5,
              fontWeight: 600,
              padding: '7px 14px',
              borderRadius: 3,
              border: '1px solid var(--seal, #1A5E6B)',
              background: canPlace ? 'var(--seal, #1A5E6B)' : 'transparent',
              color: canPlace ? 'var(--paper-0, #FBF8F1)' : 'var(--ink-3, #7C7365)',
              cursor: canPlace ? 'pointer' : 'not-allowed',
            }}
          >
            {placing
              ? 'Placing…'
              : lines.length > 1
                ? `Place ${lines.length} orders`
                : 'Place the order'}
          </button>
        </div>
      }
    >
      <div style={{ fontFamily: SANS, fontSize: 12.5 }}>
        {/* ── the register, searched ─────────────────────────────────── */}
        <label style={labelStyle} htmlFor="no-search">
          Search the register
        </label>
        <input
          id="no-search"
          style={fieldStyle}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={inventory.isLoading ? 'Reading the shelf…' : 'Öküzgözü, Banfi, gin…'}
          data-testid="new-order-search"
        />
        {shelfError && (
          <p data-testid="new-order-shelf-error" className="mt-1.5" style={{ fontSize: 11.5, color: 'var(--ink-2, #4F473C)' }}>
            {shelfError}
          </p>
        )}
        {search.trim() !== '' && (
          <ul className="mt-1.5" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {matches.length === 0 && !inventory.isLoading && !shelfError && (
              <li style={{ fontSize: 11.5, color: 'var(--ink-3, #7C7365)' }}>
                Nothing on the shelf matches “{search.trim()}”.
              </li>
            )}
            {matches.map((item) => (
              <li key={String(item.id)}>
                <button
                  type="button"
                  onClick={() => addLine(item)}
                  data-testid="new-order-add"
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    fontFamily: SANS,
                    fontSize: 12.5,
                    padding: '5px 7px',
                    borderRadius: 5,
                    border: '1px solid var(--paper-2, #EAE4D8)',
                    background: 'transparent',
                    color: 'var(--ink-1, #211C16)',
                    cursor: 'pointer',
                    marginTop: 4,
                  }}
                >
                  {String(item.wineName ?? EM)}
                  {item.wineVintage ? ` ${item.wineVintage}` : ''}
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* ── the lines ──────────────────────────────────────────────── */}
        <h3
          className="mt-4"
          style={{
            fontFamily: MONO,
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--ink-3, #7C7365)',
          }}
        >
          Lines
        </h3>

        {lines.length === 0 && (
          <p className="mt-1.5" style={{ fontSize: 11.5, color: 'var(--ink-3, #7C7365)' }}>
            No lines yet. Search the register above and add what this order is for.
          </p>
        )}

        <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0 }}>
          {lines.map((line) => {
            const refusal = refusals.get(line.key) ?? null;
            return (
              <li
                key={line.key}
                data-testid="new-order-line"
                className="mt-2"
                style={{
                  border: '1px solid var(--paper-2, #EAE4D8)',
                  borderRadius: 8,
                  padding: '9px 10px',
                }}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span style={{ fontFamily: SERIF, fontSize: 14, color: 'var(--ink-1, #211C16)' }}>
                    {line.wineName}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeLine(line.key)}
                    data-testid="new-order-remove"
                    style={{
                      fontFamily: SANS,
                      fontSize: 11,
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--ink-3, #7C7365)',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    Take it off
                  </button>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div className="col-span-2">
                    <label style={labelStyle} htmlFor={`${line.key}-vendor`}>
                      Vendor
                    </label>
                    <select
                      id={`${line.key}-vendor`}
                      style={fieldStyle}
                      value={line.providerId}
                      data-testid="new-order-vendor"
                      onChange={(e) => {
                        const providerId = e.target.value;
                        patch(line.key, { providerId, offer: null });
                        if (providerId) void askAgreement(line.key, providerId, line.inventoryId);
                      }}
                    >
                      <option value="">
                        {providers.isLoading ? 'Reading the vendors…' : 'Choose a vendor'}
                      </option>
                      {vendors.map((p) => (
                        <option key={String(p.id)} value={String(p.id)}>
                          {String(p.name ?? EM)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={labelStyle} htmlFor={`${line.key}-qty`}>
                      How many
                    </label>
                    <input
                      id={`${line.key}-qty`}
                      style={fieldStyle}
                      inputMode="numeric"
                      value={line.quantity}
                      data-testid="new-order-qty"
                      onChange={(e) => patch(line.key, { quantity: e.target.value })}
                    />
                  </div>

                  <div>
                    <label style={labelStyle} htmlFor={`${line.key}-unit`}>
                      Order unit
                    </label>
                    <select
                      id={`${line.key}-unit`}
                      style={fieldStyle}
                      value={line.unitType}
                      data-testid="new-order-unit"
                      onChange={(e) =>
                        patch(line.key, { unitType: e.target.value as PriceUom })
                      }
                    >
                      {PRICE_UOMS.map((u) => (
                        <option key={u} value={u}>
                          {PRICE_UOM_LABEL[u]}
                        </option>
                      ))}
                    </select>
                  </div>

                  {isMultiplying(line.unitType) && (
                    <div className="col-span-2">
                      <label style={labelStyle} htmlFor={`${line.key}-pack`}>
                        Bottles in one {line.unitType.replace('_', ' ')}
                      </label>
                      <input
                        id={`${line.key}-pack`}
                        style={fieldStyle}
                        inputMode="numeric"
                        value={line.bottlesPerUnit}
                        data-testid="new-order-pack"
                        onChange={(e) => patch(line.key, { bottlesPerUnit: e.target.value })}
                      />
                    </div>
                  )}

                  <div className="col-span-2">
                    <label style={labelStyle} htmlFor={`${line.key}-price`}>
                      Price (optional)
                    </label>
                    <input
                      id={`${line.key}-price`}
                      style={fieldStyle}
                      inputMode="decimal"
                      value={line.price}
                      placeholder="leave empty to ask the vendor"
                      data-testid="new-order-price"
                      onChange={(e) => patch(line.key, { price: e.target.value })}
                    />
                  </div>
                </div>

                {line.price.trim() && <div className="grid grid-cols-2 gap-2 mt-2">
                  <label style={labelStyle}>Price unit
                    <select style={fieldStyle} data-testid="new-order-price-unit" value={line.priceUom} disabled={placing || line.outcome?.ok}
                      onChange={(e) => patch(line.key, { priceUom: e.target.value as PriceUom, pricePackSize: isMultiplying(e.target.value as PriceUom) ? '' : '1' })}>
                      <option value="">State the price unit</option>
                      {PRICE_UOMS.map((u) => <option key={u} value={u}>{PRICE_UOM_LABEL[u]}</option>)}
                    </select>
                  </label>
                  <label style={labelStyle}>Currency
                    <select style={fieldStyle} data-testid="new-order-currency" value={line.currency} disabled={placing || line.outcome?.ok} onChange={(e) => patch(line.key, { currency: e.target.value })}>
                      <option value="">State the currency</option>
                      {CURRENCY_CODES.map((code) => <option key={code} value={code}>{currencyLabel(code)}</option>)}
                    </select>
                  </label>
                  {line.priceUom && isMultiplying(line.priceUom) && <label style={labelStyle}>Bottles in the price unit
                    <input style={fieldStyle} inputMode="numeric" data-testid="new-order-price-pack" value={line.pricePackSize} disabled={placing || line.outcome?.ok} onChange={(e) => patch(line.key, { pricePackSize: e.target.value })} />
                  </label>}
                </div>}

                {/* ── the agreement, GREY until it is taken ─────────────── */}
                {line.asking && (
                  <p className="mt-1.5" style={{ fontSize: 11, color: 'var(--ink-3, #7C7365)' }}>
                    Reading what was last agreed with this vendor…
                  </p>
                )}
                {line.offer && (
                  <div
                    className="mt-1.5"
                    data-testid="new-order-offer"
                    data-state={line.offer.state}
                    style={{
                      borderLeft: '2px solid var(--paper-2, #EAE4D8)',
                      paddingLeft: 8,
                      fontSize: 11,
                      // The engine's hand is grey and stays grey. A figure the
                      // person has not taken must never look like a value the
                      // line already holds.
                      color: 'var(--ink-3, #7C7365)',
                    }}
                  >
                    <p style={{ margin: 0 }}>{line.offer.sentence}</p>
                    {line.offer.state === 'found' && line.offer.price != null && (
                      <button
                        type="button"
                        data-testid="new-order-take-offer"
                        onClick={() =>
                          patch(line.key, { price: String(line.offer?.price ?? ''), priceUom: (line.offer?.priceUom as PriceUom) || '', pricePackSize: line.offer?.pricePackSize != null ? String(line.offer.pricePackSize) : '', currency: line.offer?.currency ?? '' })
                        }
                        style={{
                          marginTop: 4,
                          fontFamily: SANS,
                          fontSize: 11,
                          padding: '3px 7px',
                          borderRadius: 3,
                          border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                          background: 'transparent',
                          color: 'var(--seal-deep, #14515C)',
                          cursor: 'pointer',
                        }}
                      >
                        Take it
                      </button>
                    )}
                  </div>
                )}

                {refusal && (
                  <p
                    className="mt-1.5"
                    data-testid="new-order-line-refusal"
                    style={{ fontSize: 11, color: 'var(--ink-2, #4F473C)' }}
                  >
                    {refusal}
                  </p>
                )}

                {line.outcome && (
                  <p
                    role="status"
                    className="mt-1.5"
                    data-testid="new-order-line-outcome"
                    data-ok={line.outcome.ok ? 'true' : 'false'}
                    style={{ fontSize: 11, color: 'var(--ink-2, #4F473C)' }}
                  >
                    {line.outcome.ok
                      ? `Placed as ${line.outcome.orderNumber}. It is pending until somebody approves it.`
                      : line.outcome.uncertain
                        // An unanswered POST may have written the order, so
                        // this line never claims that nothing was written.
                        ? line.outcome.message
                        : `Not placed: ${line.outcome.message}. Nothing was written for this line.`}
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        {vendorError && (
          <p
            data-testid="new-order-vendor-error"
            className="mt-3"
            style={{ fontSize: 11.5, color: 'var(--ink-2, #4F473C)' }}
          >
            {vendorError}
          </p>
        )}

        {tally && (
          <p
            role="status"
            data-testid="new-order-tally"
            className="mt-3"
            style={{ fontSize: 11.5, color: 'var(--ink-2, #4F473C)' }}
          >
            {tally}
          </p>
        )}
        {failure && (
          <p role="status" className="mt-2" style={{ fontSize: 11.5, color: 'var(--ink-2, #4F473C)' }}>
            {failure}
          </p>
        )}
      </div>
    </Sheet>
  );
}

export default NewOrderSheet;
