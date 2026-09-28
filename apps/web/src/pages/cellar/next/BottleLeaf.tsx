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
import { HoldToApprove } from '@/components/mudavym';
import { apiClient } from '../../../services/api/client';
import { useCreateInventoryItem } from '../../../hooks/queries/useInventoryQueries';
import { useRecommendedProviders } from '../../../hooks/queries/useProviderQueries';
import { queryKeys } from '../../../lib/query-keys';
import type { Provider } from '../../../services/api/providers';
import { EM, knowledgeLabel, knowledgeNote, money, volume, year } from './cellar-format';
import type { BottleVM } from './useCellarNextData';

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

  if (blocks.length === 0) {
    return (
      <p className="cl-said cl-dim">
        The library holds no notes for this bottle — nothing has been written down, and nothing has
        been invented to fill the space.
      </p>
    );
  }

  return (
    <>
      <p style={{ margin: '0 0 8px' }}>
        <span className="cl-chip" data-seal={bottle.knowledge === 'known' ? 'true' : 'false'}>
          {knowledgeLabel(bottle.knowledge)}
        </span>{' '}
        <span className="cl-dim" style={{ fontSize: 11.5 }}>
          {knowledgeNote(bottle.knowledge)}
        </span>
      </p>
      {blocks.map((b) => (
        <div key={b.id} style={{ marginBottom: 10 }}>
          <p className="cl-sec" style={{ margin: '0 0 2px' }}>
            {b.label}
          </p>
          <p className="cl-serif" style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: 'var(--ink-2)' }}>
            {b.body}
          </p>
        </div>
      ))}
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
        <Fact label="List price">
          <span className="cl-num">{money(bottle.listPrice)}</span>
        </Fact>
        <Fact label="Market price">
          <span className="cl-num">{money(bottle.marketPrice)}</span>
        </Fact>
      </dl>

      <p className="cl-note">
        Market price is <span className="cl-num">{EM}</span> because nothing writes it: the scoring
        job that fills <span className="cl-num">retail_price_avg</span> is scheduled but has no
        deployed worker, so the column is null on every row in the library.
      </p>

      <hr className="cl-rule-thin" style={{ margin: '16px 0' }} />

      <div style={{ display: 'grid', gap: 18 }}>
        <section>
          <h3 className="cl-sec">What the library knows</h3>
          <Notes bottle={bottle} />
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
            <dl className="cl-facts" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))' }}>
              <Fact label="On hand">
                <span className="cl-num">{cellar.stockLive}</span>
              </Fact>
              <Fact label="Its own par">
                <span className="cl-num">{cellar.thresholdMin ?? EM}</span>
              </Fact>
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
              <HoldToApprove
                label={`Hold to order ${qty} from ${
                  providers?.find((p) => p.id === vendorId)?.name ?? 'this vendor'
                }`}
                approvedLabel="Order sent"
                onApprove={() =>
                  order.mutate({
                    inventoryId: cellar!.inventoryId,
                    providerId: vendorId,
                    quantity: qty,
                  })
                }
              />
            )}
          </div>
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
