/**
 * The reading stand — the cellar book held open at one bottle.
 *
 * Everything the library actually knows lives here, including the enrichment
 * the legacy page received on the wire and threw away (`description`,
 * `tastingNotes`, `pairingNotes` — services/api/types.ts:325-327, unmapped in
 * lib/wine-library.ts). Each set of notes carries the gateway's own provenance
 * mark, so a *recalled* fact and a *reasoned* one are never printed as the same
 * kind of sentence: 76% of this library is `inferred` (wines.service.ts:37-44)
 * and the book says so.
 *
 * Two actions, both real, and the page is honest about which is available:
 *
 *  - **Bring into the cellar** — POST /inventory/:rid/items. Offered only for a
 *    bottle with no cellar row, which also sidesteps tech-debt 44.1b (the
 *    legacy duplicate-add silently lost stock and reported success).
 *  - **Order more** — POST /procurement/orders. The gateway's CreateOrderDto is
 *    keyed on `inventoryId`, not `wineId` (procurement.dto.ts:37), so a
 *    catalogue-only bottle cannot be ordered at all: the control is disabled
 *    with the reason, never rendered as a button that would fail. It commits
 *    through hold-to-approve, because sending an order to a vendor is a real
 *    commitment and that is the house ceremony for one.
 *
 * "Save as recurring" is NOT here. It was a `useState` map that reported
 * persistence and survived nothing (wines.md §10).
 */

import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../services/api/client';
import { useCreateInventoryItem } from '../../../hooks/queries/useInventoryQueries';
import { useRecommendedProviders } from '../../../hooks/queries/useProviderQueries';
import { queryKeys } from '../../../lib/query-keys';
import type { Provider } from '../../../services/api/providers';
import {
  EM,
  acidityTicks,
  bodyTicks,
  composedTastingSentence,
  handlingSentence,
  knowledgeLabel,
  knowledgeNote,
  money,
  tanninTicks,
  volume,
  year,
} from './cellar-format';
import OrderCeremony from './OrderCeremony';
import { useCellarSettings, type BottleVM, type WineStructureVM } from './useCellarNextData';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Notes({ bottle }: { bottle: BottleVM }) {
  const blocks = [
    { id: 'description', label: 'The producer', body: bottle.description },
    { id: 'tasting', label: 'Tasting', body: bottle.tastingNotes },
    { id: 'pairing', label: 'Pairing', body: bottle.pairingNotes },
  ].filter((b) => b.body);

  // ADR 0160 sec110 Owed #11 — "the wine sentence": composed from the
  // structured profile when the library holds no free-text note at all.
  // Only reached when `blocks` is empty, so a real written note is never
  // displaced by a composed one.
  const composed =
    blocks.length === 0 && bottle.structure
      ? composedTastingSentence(bottle.structure.body, bottle.structure.acidity, bottle.structure.sweetness)
      : null;

  const aromas = bottle.structure?.primaryAromas ?? [];

  if (blocks.length === 0 && !composed) {
    return (
      <>
        <p className="cl-said cl-dim">
          The library holds no notes for this bottle — nothing has been written down, and nothing has
          been invented to fill the space.
        </p>
        {aromas.length > 0 ? (
          <p className="cl-said" style={{ marginTop: 8 }} data-testid="bottle-leaf-aromas">
            <span className="cl-dim">Typical aromas: </span>
            {aromas.join(' · ')}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <>
      <p style={{ margin: '0 0 8px' }}>
        <span className="cl-chip" data-seal={bottle.knowledge === 'known' ? 'true' : 'false'}>
          {knowledgeLabel(bottle.knowledge)}
        </span>{' '}
        <span className="cl-dim" style={{ fontSize: 11.5 }}>
          {composed
            ? 'Composed from this wine’s recorded structure (body, acidity, sweetness) — not a tasting.'
            : knowledgeNote(bottle.knowledge)}
        </span>
      </p>
      {composed ? (
        <p className="cl-serif" style={{ margin: '0 0 10px', fontSize: 14, lineHeight: 1.55, color: 'var(--ink-2)' }}>
          {composed}
        </p>
      ) : (
        blocks.map((b) => (
          <div key={b.id} style={{ marginBottom: 10 }}>
            <p className="cl-sec" style={{ margin: '0 0 2px' }}>
              {b.label}
            </p>
            <p className="cl-serif" style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: 'var(--ink-2)' }}>
              {b.body}
            </p>
          </div>
        ))
      )}
      {aromas.length > 0 ? (
        <p className="cl-said" data-testid="bottle-leaf-aromas">
          <span className="cl-dim">Typical aromas: </span>
          {aromas.join(' · ')}
        </p>
      ) : null}
    </>
  );
}

/** One row of "the wine's own detail" — a word, and a 5-tick bar when the
 * word is on this page's known scale (`structureTicks`, `cellar-format.ts`).
 * `null` ticks draws the word alone: a real word this house's library uses
 * but that this page cannot rank is stated, never guessed into a position. */
function StructureFact({ label, word, ticks }: { label: string; word: string | null; ticks: number | null }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {word ?? EM}
        {word && ticks !== null ? (
          <span className="cl-ticks" aria-label={`${ticks} of 5`}>
            {[1, 2, 3, 4, 5].map((i) => (
              <i key={i} data-on={i <= ticks ? 'true' : 'false'} />
            ))}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

function WineStructureSection({ structure }: { structure: WineStructureVM | null }) {
  if (!structure) {
    return (
      <p className="cl-said cl-dim" data-testid="wine-structure-none">
        Not recorded for this bottle — the library holds no body, acidity, tannin or sweetness
        reading here.
      </p>
    );
  }
  return (
    <>
      <dl className="cl-facts" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
        <StructureFact label="Body" word={structure.body} ticks={bodyTicks(structure.body)} />
        <StructureFact label="Acidity" word={structure.acidity} ticks={acidityTicks(structure.acidity)} />
        <StructureFact label="Tannin" word={structure.tannins} ticks={tanninTicks(structure.tannins)} />
        <Fact label="Sweetness">{structure.sweetness ?? EM}</Fact>
      </dl>
      <p className="cl-said" style={{ marginTop: 10 }} data-testid="wine-structure-handling">
        {handlingSentence(structure.handling) ?? 'How to serve it is not recorded.'}
      </p>
    </>
  );
}

export interface BottleLeafProps {
  bottle: BottleVM;
  providers: Provider[] | null;
  vendorsError: string | null;
  restaurantId: string | null;
  onClose: () => void;
}

export default function BottleLeaf({
  bottle,
  providers,
  vendorsError,
  restaurantId,
  onClose,
}: BottleLeafProps) {
  const [qty, setQty] = useState(6);
  const [vendorId, setVendorId] = useState<string>(bottle.cellar?.providerId ?? '');
  const [said, setSaid] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const bringIn = useCreateInventoryItem();
  const recs = useRecommendedProviders(restaurantId ?? '', bottle.id);
  const settings = useCellarSettings();

  const recommendedIds = useMemo(() => {
    const s = new Set<string>();
    if (recs.data?.primary?.id) s.add(recs.data.primary.id);
    for (const p of recs.data?.alternatives ?? []) s.add(p.id);
    return s;
  }, [recs.data]);

  const order = useMutation({
    mutationFn: async (body: { inventoryId: string; providerId: string; quantity: number }) => {
      const r = await apiClient.post('/procurement/orders', { ...body, unitType: 'bottle' });
      return r.data as { id?: string };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
      setSaid('Order sent to the vendor. It is on Orders now.');
    },
    onError: (e: unknown) =>
      setSaid(
        `Nothing was sent — the gateway refused it (${e instanceof Error ? e.message : 'no reason given'}).`,
      ),
  });

  const cellar = bottle.cellar;
  const orderBlocked = !cellar
    ? 'This bottle is not in the cellar yet. An order line is keyed to a cellar row, so bring it in first.'
    : !vendorId
      ? 'Choose the vendor this order goes to.'
      : null;

  return (
    <div className="cl-panel" data-testid="bottle-leaf">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
          <h2 className="cl-h2">{bottle.name}</h2>
          <p className="cl-dim" style={{ margin: '3px 0 0', fontSize: 12.5 }}>
            {[bottle.producer, bottle.grape, bottle.appellation].filter(Boolean).join(' · ') ||
              'No producer, grape or appellation recorded'}
          </p>
        </div>
        <button type="button" onClick={onClose} className="cl-btn cl-focus">
          Close
        </button>
      </div>

      <dl className="cl-facts" style={{ marginTop: 14 }}>
        <Fact label="Style">{bottle.style ?? EM}</Fact>
        <Fact label="Vintage">
          <span className="cl-num">{year(bottle.vintage)}</span>
        </Fact>
        <Fact label="Origin">{[bottle.region, bottle.country].filter(Boolean).join(', ') || EM}</Fact>
        <Fact label="Format">
          <span className="cl-num">{volume(bottle.bottleSizeMl)}</span>
        </Fact>
        <Fact label="Market average">
          <span className="cl-num">{money(bottle.listPrice)}</span>
        </Fact>
        <Fact label="Market price">
          <span className="cl-num">{money(bottle.marketPrice)}</span>
        </Fact>
      </dl>

      {/* RELABELLED 2026-09-19 (founder, 19-lane blocking round, batch 4):
          "our library price will be just the average price that will be
          updating daily." This is a wording fix, not a data change — the
          figure above is `price_reference`, unchanged. It was labelled "List
          price", which reads as a fixed, definitive figure; "Market average"
          is the founder's own name for it. This is a DIFFERENT column from
          the "Market price" fact beside it (`retail_price_avg`), which the
          note right below still explains on its own — two figures, two
          provenances, kept distinct rather than merged into one because they
          happen to share the word "market".

          [CORRECTED 2026-09-21 — round 5 must_fix. This comment and the note
          below it originally claimed `price_reference` "was always the
          library's own reference across houses and vendors" — nothing in
          the tree computes that. Today the column is an imported reference
          hint, passed straight through with no cross-house/vendor
          computation: the JSONL import writes it unchanged
          (`import_master_wine_library.py:149,168`, `price_reference =
          EXCLUDED.price_reference`) and so does a submission payload
          (`wines.service.ts:420`, `payload?.price_reference ??
          payload?.price ?? null`). The sibling column on `beverages` is
          commented "Market hint only, never a restaurant's actual price"
          (`20260817070000_beverages_table.sql:230-232`) — the same fact,
          named plainly, on the neighbouring table. The founder's
          daily-refreshed, cross-house/vendor average is real intent, not
          built yet (see wines.md's Seventh pass, same dated bracket). The
          "Market average" label he asked for is unchanged; only the claim
          about what computes the number under it is corrected.] */}
      <p className="cl-note">
        Market average, above, is a reference price imported with this wine — not something
        Mudavym computes across houses or vendors today, and not this house's own price. A
        daily, cross-house average is planned, not built yet. Market price is{' '}
        <span className="cl-num">{EM}</span> because nothing writes it: the scoring job that
        fills <span className="cl-num">retail_price_avg</span> is scheduled but has no deployed
        worker, so the column is null on every row in the library.
      </p>

      <hr className="cl-rule-thin" style={{ margin: '16px 0' }} />

      <div style={{ display: 'grid', gap: 18 }}>
        <section>
          <h3 className="cl-sec">What the library knows</h3>
          <Notes bottle={bottle} />
        </section>

        {/* ADR 0160 sec110 Owed #4/#11 — the founder's own words: "it came
            from this area, this vintage, formats, the taste notes ... the
            machine learning side, the details, the features of those wines
            ... it's only going to be for wines." Drawn now: he asked for a
            new drawing before this was built, and got one (sketch 121,
            `.band`/`.struct`), then answered its questions 2026-09-18 —
            "show, labelled honestly". Region/vintage/format are already on
            this leaf above (Style/Vintage/Origin/Format); this section is
            body, acidity, tannin and sweetness (`wine_structure`, a word and
            a 5-tick bar where the word is on a known scale) and the serving
            handling sentence (temperature/glass/decanting/ageing), which
            sketch 121 draws whole or not at all — see `handlingSentence`,
            `cellar-format.ts`. `ml_derived_features` is not drawn: it is
            null on every stocked wine this build could read (0 of 95,
            `cellar-121/integration-sota-first.sql`), so a section for it
            would be empty on every bottle in the building today — the
            founder's own rule for exactly this ("if the value is not shown
            there ... don't even include them"). A features pipeline, and the
            foundations document mapping the library to every endpoint and
            insight type, are a separate, already-scoped piece of work
            (`docs/wine-ml-foundations`) — see this build's report. */}
        <section data-testid="wine-structure">
          <h3 className="cl-sec">The wine's own detail</h3>
          <WineStructureSection structure={bottle.structure} />
        </section>

        <section>
          <h3 className="cl-sec">In this house</h3>
          {!cellar ? (
            <>
              <p className="cl-said" style={{ marginBottom: 10 }}>
                Not in the building. The cellar holds no row for this bottle — which is not the same
                as holding none of it.
              </p>
              <div className="cl-row-controls">
                <label className="cl-dim" style={{ fontSize: 12 }} htmlFor="cl-bring-qty">
                  Bottles
                </label>
                <input
                  id="cl-bring-qty"
                  className="cl-field cl-focus cl-num"
                  type="number"
                  min={1}
                  value={qty}
                  onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
                  style={{ width: 74 }}
                />
                <button
                  type="button"
                  className="cl-btn cl-focus"
                  disabled={bringIn.isPending || !restaurantId}
                  onClick={() =>
                    bringIn.mutate(
                      { wineId: bottle.id, stockLive: qty },
                      {
                        onSuccess: () => setSaid(`Booked into the cellar — ${qty} on hand.`),
                        onError: (e: unknown) =>
                          setSaid(
                            `Nothing was booked (${e instanceof Error ? e.message : 'no reason given'}).`,
                          ),
                      },
                    )
                  }
                >
                  {bringIn.isPending ? 'Booking…' : 'Bring into the cellar'}
                </button>
              </div>
            </>
          ) : (
            <>
              {/* ADR 0160 sec110 item 3 — corrected 2026-09-18. The founder was
                  reading sketch 110 B's peek aloud (direction-b.html:274):
                  "9 on hand · par 12 / $62 a bottle · $15 a glass / 38 sold ·
                  9 d of till". The first pass misheard "par 12" as "pack
                  size" and duplicated on-hand as "Bottles" (its own note
                  admitted as much). On hand and Par are both real, already
                  on this row (`cellar.stockLive`/`thresholdMin` — Par was
                  previously only shown further down as "Its own par", now
                  moved up rather than duplicated). Glass price is this
                  house's own `menu_price_glass` — a real column a manager
                  sets — never the wine library's reference price.

                  CLOSED 2026-09-19, RE-POINTED 2026-09-21 (ADR 0193; founder:
                  "we're going to add a per house bottle price"). "Bottle
                  price" below is this house's own price, read from
                  `menu_price_current` -- the column every margin and
                  valuation already reads; the lane's short-lived second
                  column was removed so there is one number. "Dynamic" is
                  decided (ADR 0193): the price follows the menu (a menu
                  import or correction writes it) and a manager changes it on
                  Inventory at any time, every change on the record; advice
                  toward the house's target margin is offered there, never
                  applied on its own and never from the market. "Market average" (above)
                  is the library's own reused reference figure, relabelled in
                  this same pass; it is a different column from this one and
                  is kept as the fallback nowhere below, so a reader can never
                  mistake one house's price for the library's average. */}
              <dl
                className="cl-facts"
                style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))' }}
                data-testid="bottle-leaf-fact-set"
              >
                <Fact label="On hand">
                  <span className="cl-num">{cellar.stockLive}</span> bottles
                </Fact>
                <Fact label="Par">
                  <span className="cl-num">{cellar.thresholdMin ?? EM}</span>
                </Fact>
                <Fact label="Bottle price (this house)">
                  {cellar.menuPriceBottle !== null ? (
                    <span className="cl-num">{money(cellar.menuPriceBottle)}</span>
                  ) : (
                    EM
                  )}
                </Fact>
                <Fact label="Glass price">
                  {cellar.menuPriceGlass !== null ? (
                    <span className="cl-num">{money(cellar.menuPriceGlass)}</span>
                  ) : (
                    EM
                  )}
                </Fact>
                <Fact label="Market average (bottle)">
                  <span className="cl-num">{money(bottle.listPrice)}</span>
                </Fact>
              </dl>
              {cellar.thresholdMin === null || cellar.menuPriceBottle === null || cellar.menuPriceGlass === null ? (
                <p className="cl-note" style={{ marginTop: 4 }}>
                  {cellar.thresholdMin === null ? 'No par recorded on this row. ' : ''}
                  {cellar.menuPriceBottle === null
                    ? 'No by-the-bottle price recorded on this row — set one in Inventory to show it here. '
                    : ''}
                  {cellar.menuPriceGlass === null
                    ? 'No by-the-glass price recorded on this row — set one in Inventory to show it here.'
                    : ''}
                </p>
              ) : null}

              <hr className="cl-rule-thin" style={{ margin: '12px 0' }} />

              <p className="cl-said" data-testid="bottle-leaf-sold-line" role={cellar.analyticsReadable ? undefined : 'alert'}>
                {!cellar.analyticsReadable
                  ? 'Selling pace could not be read — the analytics join failed for this batch. This is a read error, not a row with nothing sold.'
                  : cellar.velocityPerDay === null
                    ? 'Selling pace: unmeasured — the analytics join has nothing for this row yet.'
                    : cellar.daysSinceSale === null
                      ? `Selling ~${cellar.velocityPerDay.toFixed(1)}/day.`
                      : `Selling ~${cellar.velocityPerDay.toFixed(1)}/day · last sold ${cellar.daysSinceSale} ${cellar.daysSinceSale === 1 ? 'day' : 'days'} ago.`}
              </p>

              <hr className="cl-rule-thin" style={{ margin: '12px 0' }} />

              <dl className="cl-facts" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))' }}>
                <Fact label="Vendor on the row">{cellar.providerName ?? EM}</Fact>
                <Fact label="Last counted">
                  {cellar.lastCountedAt
                    ? new Date(cellar.lastCountedAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })
                    : 'never counted'}
                </Fact>
              </dl>
            </>
          )}
        </section>

        <section>
          <h3 className="cl-sec">Order more</h3>

          {vendorsError ? (
            <p role="status" className="cl-said" style={{ marginBottom: 8 }}>
              The vendor book could not be read ({vendorsError}) — no vendor can be chosen, so
              nothing can be ordered from here.
            </p>
          ) : null}

          <div className="cl-row-controls">
            <label className="cl-dim" style={{ fontSize: 12 }} htmlFor="cl-vendor">
              Vendor
            </label>
            <select
              id="cl-vendor"
              className="cl-field cl-focus"
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
              disabled={!providers || providers.length === 0}
            >
              <option value="">
                {providers && providers.length > 0 ? 'Choose a vendor…' : 'No vendors on file'}
              </option>
              {(providers ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {recommendedIds.has(p.id) ? ' — recommended for this bottle' : ''}
                </option>
              ))}
            </select>
            <label className="cl-dim" style={{ fontSize: 12 }} htmlFor="cl-order-qty">
              Bottles
            </label>
            <input
              id="cl-order-qty"
              className="cl-field cl-focus cl-num"
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
              style={{ width: 74 }}
            />
          </div>

          {recs.isError ? (
            <p className="cl-note">
              The vendor recommendation could not be fetched — the list above is the plain roster,
              unranked.
            </p>
          ) : null}

          <div style={{ marginTop: 10 }}>
            {orderBlocked ? (
              <>
                <button type="button" className="cl-btn" disabled>
                  Order {qty}
                </button>
                <p className="cl-note" style={{ marginTop: 6 }}>
                  {orderBlocked}
                </p>
              </>
            ) : (
              <OrderCeremony
                ceremony={settings.data.holdCeremony}
                // Both ceremonies open with the physical hold now (ADR 0160
                // sec110 item 6, corrected 2026-09-19) — `auto` only skips
                // the follow-up question, it never skips the hold — so the
                // label says "Hold to order" unconditionally.
                label={`Hold to order ${qty} from ${
                  providers?.find((p) => p.id === vendorId)?.name ?? 'this vendor'
                }`}
                approvedLabel="Order sent"
                pending={order.isPending}
                sent={order.isSuccess}
                errorMessage={order.isError ? (order.error instanceof Error ? order.error.message : 'the gateway refused it') : null}
                // `mutateAsync`, not `mutate`: both of `OrderCeremony`'s
                // ceremonies eventually hand this to `HoldToApprove` (`auto`
                // straight away, `hold` only once "Yes, order" is pressed),
                // which only seals on a promise that actually resolves (see
                // OrderCeremony.tsx's fix note). `mutate`'s fire-and-forget
                // return of `undefined` was the whole bug — nothing to await.
                onApprove={() =>
                  order.mutateAsync({
                    inventoryId: cellar!.inventoryId,
                    providerId: vendorId,
                    quantity: qty,
                  })
                }
              />
            )}
          </div>
          {!settings.loading && settings.data.holdCeremonyConfigured ? (
            <p className="cl-note" style={{ marginTop: 6 }} data-testid="order-ceremony-note">
              {
                // FIXED 2026-09-19 (cellar re-verification, blocking): the
                // `auto` line used to say "sends an order on one click, no
                // hold" — the exact design ADR 0160 sec110 item 6's
                // correction rules out. Both ceremonies hold; `auto` only
                // skips the "are you sure?" that follows it.
                settings.data.holdCeremony === 'hold'
                  ? 'This house holds every order, then asks "are you sure?", before it sends — changed in Settings › Cellar.'
                  : 'This house holds every order, then sends the moment the hold completes — no "are you sure?" — changed in Settings › Cellar.'
              }
            </p>
          ) : null}
        </section>
      </div>

      {said ? (
        <p
          role="status"
          className="cl-said"
          style={{ marginTop: 14, borderTop: '1px solid var(--paper-2)', paddingTop: 10, color: 'var(--ink-1)' }}
        >
          {said}
        </p>
      ) : null}
    </div>
  );
}
