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
 * NOT WIRED THROUGH `PageGate` (deliberately, see `useMudavymDesign.ts`'s
 * `MUDAVYM_PAGES` entry for `promotions`): the brief was to ship this to
 * every house with no new per-house flag, so this component does its own
 * minimal version of what `PageGate` does for a `next` tree — claim the
 * shell so the app-shell overlays (command palette, Ask AI, etc.) wear the
 * house shape while this page is open, and mount `HouseHeader` above its own
 * `.mudavym` root. Both calls are the exact ones `PageGate` itself makes.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { HouseHeader } from '../../../components/mudavym';
import { claimMudavymShell, releaseMudavymShell } from '../../../lib/mudavym/shellGround';
import { RestaurantBranchSwitcher } from '../../../components/layout/RestaurantBranchSwitcher';
import OfferCard from './OfferCard';
import OfferSheet from './OfferSheet';
import { useDismissOffer, usePromotionsRead, useRestoreOffer } from './usePromotionsNextData';
import {
  failureOf,
  failureSentence,
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

export function PromotionsNext() {
  const token = useRef<symbol>(Symbol('promotions-next-shell'));
  useEffect(() => {
    const id = token.current;
    claimMudavymShell(id, 'charcoal');
    return () => releaseMudavymShell(id);
  }, []);

  const [showPutAway, setShowPutAway] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const today = useMemo(todayIso, []);

  const { data, isLoading, isError, error } = usePromotionsRead(true);
  const dismiss = useDismissOffer();
  const restore = useRestoreOffer();

  const offers: OfferDto[] = useMemo(() => data?.offers ?? [], [data]);
  const ranked = useMemo(() => rankOffers(offers), [offers]);
  const ungradable = useMemo(() => ungradableOffers(offers), [offers]);
  const putAway = useMemo(() => putAwayOffers(offers), [offers]);
  const selected = offers.find((o) => o.id === selectedId) ?? null;
  const busy = dismiss.isPending || restore.isPending;

  return (
    <div className="mudavym pn-page">
      <HouseHeader page="promotions" ground="charcoal" />
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
              {ranked.length === 0 && ungradable.length === 0 ? (
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
