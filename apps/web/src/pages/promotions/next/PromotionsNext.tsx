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
 * THE BAND, AND BUNDLES AS TRAYS (founder, 2026-09-25, round 5 — sketch 124
 * direction A; ADR 0160 §113). The docket is a row per size tier, in strict
 * rank order top to bottom: the hero band across the page, the large cards
 * three across, then every compact tile five across (`bandsOf`). A bundle is
 * ranked with the single offers by its rolled-up total and drawn as a tray at
 * the tier that total earns; a bundle whose total is withheld is compact.
 * Undated offers stay on the table, labelled "no end date" (sketch 113 Q6).
 *
 * THE SCOPE-BAR SEAM (not built — founder 2026-09-25 asked for house-first
 * filters, and a research pass on them is running). Two places, nothing else:
 *   1. `scoped` below is the ONE list every fold derives from; a scope bar
 *      narrows it there and every band, fold and count follows.
 *   2. The JSX comment "scope bar — the seam …" between the header and the
 *      Offers section is where the bar is drawn.
 * The standing line reads the unscoped `data` on purpose: it states what is
 * on the table, not what a filter shows.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RestaurantBranchSwitcher } from '../../../components/layout/RestaurantBranchSwitcher';
import OfferCard from './OfferCard';
import OfferSheet from './OfferSheet';
import { useDismissOffer, usePromotionsRead, useRestoreOffer } from './usePromotionsNextData';
import {
  bandsOf,
  failureOf,
  failureSentence,
  putAwayOffers,
  rankOffers,
  standingLine,
  ungradableOffers,
  type OfferDto,
  type RankedOffer,
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
  // SCOPE-BAR SEAM (see the header): the one list every fold derives from.
  // Today it is every offer; a house-first scope bar narrows it here.
  const scoped: OfferDto[] = offers;
  const ranked = useMemo(() => rankOffers(scoped), [scoped]);
  const bands = useMemo(() => bandsOf(ranked), [ranked]);
  const ungradable = useMemo(() => ungradableOffers(scoped), [scoped]);
  const putAway = useMemo(() => putAwayOffers(scoped), [scoped]);
  const selected = offers.find((o) => o.id === selectedId) ?? null;
  const busy = dismiss.isPending || restore.isPending;
  const card = (r: RankedOffer) => (
    <OfferCard
      offer={r.offer}
      tier={r.tier}
      today={today}
      onOpenDetail={setSelectedId}
      onDismiss={(id) => dismiss.mutate(id)}
      onRestore={(id) => restore.mutate(id)}
      busy={busy}
    />
  );

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

        {/* scope bar — the seam for the house-first filters (not built; see the header) */}

        <section aria-label="Offers" className="pn-offers">
          {isLoading && (
            <div className="pn-row-large" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div className="pn-card pn-card--large" key={i} aria-hidden="true">
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
              {ranked.length === 0 && ungradable.length === 0 ? (
                <div className="pn-state">
                  <p>No offers are on the table right now. This lane is active and listening.</p>
                </div>
              ) : (
                <div className="pn-band" data-testid="pn-band">
                  {bands.hero && (
                    <div className="pn-row-hero" role="list" aria-label="The offer worth the most">
                      <div role="listitem">{card(bands.hero)}</div>
                    </div>
                  )}
                  {bands.large.length > 0 && (
                    <div className="pn-row-large" role="list" aria-label="The next offers by worth">
                      {bands.large.map((r) => (
                        <div role="listitem" key={r.offer.id}>
                          {card(r)}
                        </div>
                      ))}
                    </div>
                  )}
                  {bands.compact.length > 0 && (
                    <div className="pn-row-compact" role="list" aria-label="Every other offer, in rank order">
                      {bands.compact.map((r) => (
                        <div role="listitem" key={r.offer.id}>
                          {card(r)}
                        </div>
                      ))}
                    </div>
                  )}
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
