/**
 * PromotionsNext — `/promotions`, sketch 113 direction B with C's density
 * and bundles (ADR 0160 §113). See this directory's other files for the
 * grading arithmetic (`../../../../api-gateway/.../offer-grade.ts`, mirrored
 * client-side by `promotions-format.ts`), the data hook, the card and the
 * sheet. This file is the page's spine: the head, the docket's three folds
 * (open · put away · cannot be graded) and a one-line hand-off to
 * `/communications`.
 *
 * OFFERS ONLY (ADR 0160 §113, Open item 3, founder 2026-09-18: "they move to
 * /communications, and the hold-to-trust and add-vendor acts go with them;
 * /promotions holds offers only"). Trusted senders and Strangers, with their
 * two acts, used to be tabs here (`SendersProspectsPanel.tsx`, an interim the
 * lane disclosed while `/communications` had nowhere to put them). They now
 * live in `pages/communications/next/WhoIsWriting.tsx`; the hand-off line
 * below is direction B's own ("Senders and strangers are mail, not money…
 * Open in Communications →", sketch 113 `direction-b.html:316`) — a link, with
 * no read of sender data, so this page still holds no sender code.
 *
 * DARK, BEHIND `PageGate` (2026-09-25): routed as
 * `<PageGate page="promotions" …>` and held back from LIVE_PAGES, so it
 * renders only where `mudavym_design_promotions` is on (OFF by default,
 * 20260926160000). The gate claims the shell and carries the header, as for
 * every other rebuilt page — this component no longer does either itself.
 * The ground follows the person's choice (ADR 0169); nothing here forces
 * charcoal any more.
 *
 * TWO PARTS NOT BUILT (ADR 0160 §113, "drawings owed before their builds"):
 * B's sized boxes at C's 10+ density, and the bundle's own shape. Both are
 * drawn in `.planning/sketches/124-promotions-bundles-and-density/` for the
 * founder to pick. Until then offers render one size in rank order
 * (`OfferCard`'s header), and bundles are listed in their own plain fold
 * below the docket, each opening the sheet bottle by bottle.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RestaurantBranchSwitcher } from '../../../components/layout/RestaurantBranchSwitcher';
import OfferCard from './OfferCard';
import OfferSheet from './OfferSheet';
import { useDismissOffer, usePromotionsRead, useRestoreOffer } from './usePromotionsNextData';
import {
  bundlesOnTable,
  failureOf,
  failureSentence,
  isBundleOffer,
  putAwayOffers,
  rankOffers,
  standingLine,
  ungradableOffers,
  type OfferDto,
} from './promotions-format';
import './promotions-next.css';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface PromotionsNextProps {
  /** Force the Warm Charcoal ground for this surface (ADR 0042); omitted, the person's choice applies (ADR 0169). */
  ground?: 'charcoal';
}

export function PromotionsNext({ ground }: PromotionsNextProps = {}) {
  const [showPutAway, setShowPutAway] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const today = useMemo(todayIso, []);

  const { data, isLoading, isError, error } = usePromotionsRead(true);
  const dismiss = useDismissOffer();
  const restore = useRestoreOffer();

  const offers: OfferDto[] = useMemo(() => data?.offers ?? [], [data]);
  // Bundles leave the docket for their own fold: their shape is not drawn yet.
  const singles = useMemo(() => offers.filter((o) => !isBundleOffer(o)), [offers]);
  const ranked = useMemo(() => rankOffers(singles), [singles]);
  const ungradable = useMemo(() => ungradableOffers(singles), [singles]);
  const bundles = useMemo(() => bundlesOnTable(offers), [offers]);
  const putAway = useMemo(() => putAwayOffers(offers), [offers]);
  const selected = offers.find((o) => o.id === selectedId) ?? null;
  const busy = dismiss.isPending || restore.isPending;

  return (
    <div className="mudavym pn-page" data-ground={ground}>
      <div className="pn-wrap">
        <header>
          <p className="pn-eyebrow">The house's vendors</p>
          <h1 className="pn-title">Promotions.</h1>
          <RestaurantBranchSwitcher />
          {data && (
            <>
              <p className="pn-standing">
                <b>{standingLine(data)}</b>
              </p>
              <p className="pn-readat">
                Read {new Date(data.read_at).toLocaleString()} · {data.ledger.paid_lines} paid lines,{' '}
                {data.ledger.house_sightings} house sightings, {data.ledger.market_sightings} market sightings over{' '}
                {data.ledger.window_days} days
                {data.ledger.skipped_sightings > 0 ? ` (${data.ledger.skipped_sightings} register rows skipped — no pack size or volume, or an outlier)` : ''}.
              </p>
            </>
          )}
        </header>

        <section aria-label="Offers" className="pn-offers">
          {isLoading && (
            <div className="pn-docket">
              {[0, 1, 2].map((i) => (
                <div className="pn-card" key={i} aria-hidden="true">
                  <div className="pn-skel" style={{ margin: 0, height: 14, width: '50%' }} />
                  <div className="pn-skel" style={{ margin: 0, height: 52 }} />
                  <div className="pn-skel" style={{ margin: 0, height: 14, width: '80%' }} />
                </div>
              ))}
            </div>
          )}

          {isError &&
            (() => {
              const f = failureOf(error);
              return (
                <div className="pn-state pn-state--failed" role="alert">
                  <div className="pn-state__k">read failed · the offers</div>
                  <p className="pn-state__t">The offers could not be read.</p>
                  <p>{failureSentence(f)}</p>
                </div>
              );
            })()}

          {!isLoading && !isError && data && (
            <>
              {ranked.length === 0 && ungradable.length === 0 && bundles.length === 0 ? (
                <div className="pn-state">
                  <p>No offers are on the table right now. This lane is active and listening.</p>
                </div>
              ) : (
                <div className="pn-docket">
                  {ranked.map((r) => (
                    <OfferCard
                      key={r.offer.id}
                      offer={r.offer}
                      tier={r.tier}
                      today={today}
                      onOpenDetail={setSelectedId}
                      onDismiss={(id) => dismiss.mutate(id)}
                      onRestore={(id) => restore.mutate(id)}
                      busy={busy}
                    />
                  ))}
                </div>
              )}

              {bundles.length > 0 && (
                <div className="pn-ungr" data-testid="pn-bundles">
                  <h3>Bundles</h3>
                  <p className="pn-lede">
                    {bundles.length} offer{bundles.length === 1 ? '' : 's'} price several bottles together. Open one
                    to see each bottle against what the house last paid.
                  </p>
                  <div className="pn-docket pn-docket--dense">
                    {bundles.map((o) => (
                      <article className="pn-card pn-card--compact" key={o.id}>
                        <div className="pn-card__top">
                          <span className="pn-card__vendor">{o.provider_name ?? 'Unnamed vendor'}</span>
                        </div>
                        <span className="pn-mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                          {o.name} · {o.grade.wines.length} bottle{o.grade.wines.length === 1 ? '' : 's'}
                        </span>
                        <button type="button" className="pn-btn pn-btn--quiet" onClick={() => setSelectedId(o.id)}>
                          Details
                        </button>
                      </article>
                    ))}
                  </div>
                </div>
              )}

              {ungradable.length > 0 && (
                <div className="pn-ungr">
                  <h3>Cannot be graded</h3>
                  <p className="pn-lede">
                    {ungradable.length} offer{ungradable.length === 1 ? '' : 's'} on the table name no wine the
                    ledger can price, or carry no percentage or amount off — in the vendor's own words below,
                    never a fabricated figure.
                  </p>
                  <div className="pn-docket pn-docket--dense">
                    {ungradable.map((o) => (
                      <article className="pn-card pn-card--compact" key={o.id}>
                        <div className="pn-card__top">
                          <span className="pn-card__vendor">{o.provider_name ?? 'Unnamed vendor'}</span>
                        </div>
                        <div className="pn-num pn-num--none">
                          {o.grade.status === 'no_wines'
                            ? 'names no wine'
                            : o.grade.status === 'not_a_price'
                              ? 'not a price'
                              : 'the ledger has no lines'}
                        </div>
                        <button type="button" className="pn-btn pn-btn--quiet" onClick={() => setSelectedId(o.id)}>
                          Details
                        </button>
                      </article>
                    ))}
                  </div>
                </div>
              )}

              {putAway.length > 0 && (
                <div className="pn-fold">
                  <b>
                    {putAway.length} put away for the house
                  </b>
                  <button type="button" onClick={() => setShowPutAway((v) => !v)}>
                    {showPutAway ? 'hide' : 'show'}
                  </button>
                </div>
              )}
              {showPutAway && putAway.length > 0 && (
                <div className="pn-docket pn-docket--dense" style={{ marginTop: 10 }}>
                  {putAway.map((o) => (
                    <article className="pn-card pn-card--compact" key={o.id}>
                      <div className="pn-card__top">
                        <span className="pn-card__vendor">{o.provider_name ?? 'Unnamed vendor'}</span>
                      </div>
                      <span className="pn-mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                        put away {o.dismissed_at ? new Date(o.dismissed_at).toLocaleDateString() : ''}
                      </span>
                      <button type="button" className="pn-btn pn-btn--quiet" disabled={busy} onClick={() => restore.mutate(o.id)}>
                        Restore
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        <p className="pn-handoff">
          Senders and strangers are mail, not money — they live with the rest of the house&rsquo;s mail.{' '}
          <Link to="/communications">Open in Communications →</Link>
        </p>
      </div>

      <OfferSheet
        offer={selected}
        today={today}
        onClose={() => setSelectedId(null)}
        onDismiss={(id) => dismiss.mutate(id)}
        onRestore={(id) => restore.mutate(id)}
        busy={busy}
      />
    </div>
  );
}

export default PromotionsNext;
