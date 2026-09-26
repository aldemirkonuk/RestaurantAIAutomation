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
 * HOUSE-FIRST, THEN WIDER (founder item 36, 2026-09-25/26 — ADR 0160 §113,
 * round-6 bracket; research-filters.md's adversarial pass). The page opens on
 * "On my menu" (the house's CURRENT menu(s)); "Everything I stock" and "All
 * offers" are one tap wider, each with its live count. A house with no menu
 * read yet opens on "Everything I stock" under a banner that says so. Facets:
 * vendor, ends soon, search, coarse category, running low (counted stock
 * only). Everything lives in the URL (`?scope=`, `?vendor=`, `?cat=`,
 * `?soon=1`, `?low=1`, `?q=`), so a reload or a shared link shows the same.
 *
 * RANK ONCE, THEN HIDE. `rankOffers` runs over EVERY offer on the table and a
 * rung or facet only hides cards (`visible`): a box keeps the size its worth
 * earned against the whole book, so the hero of "All" is still drawn as the
 * hero in "On my menu" if it is there, and a small offer never becomes a hero
 * because the bigger ones were filtered away. The "cannot be graded" fold is
 * scoped the same way (F11); the put-away fold is the house's own list and is
 * not. The standing line reads the unscoped `data` on purpose: it states what
 * is on the table, not what a filter shows.
 */

import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { RestaurantBranchSwitcher } from '../../../components/layout/RestaurantBranchSwitcher';
import OfferCard from './OfferCard';
import OfferSheet from './OfferSheet';
import ScopeBar, { useNarrow } from './ScopeBar';
import { useDismissOffer, usePromotionsRead, useRestoreOffer } from './usePromotionsNextData';
import {
  bandsOf,
  failureOf,
  failureSentence,
  onTheTable,
  putAwayOffers,
  rankOffers,
  standingLine,
  ungradableOffers,
  type OfferDto,
  type RankedOffer,
} from './promotions-format';
import {
  NO_FACETS,
  RUNGS,
  activeFacetCount,
  defaultRung,
  facetOptions,
  facetsFromParams,
  parseRung,
  rungCounts,
  scopeReady,
  visible,
  writeParams,
  type Facets,
  type Rung,
} from './promotions-scope';
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
  const narrow = useNarrow();

  // The ladder and the facets are the URL (see the header).
  const [params, setParams] = useSearchParams();
  const ready = scopeReady(data);
  const chosenRung = parseRung(params.get('scope'));
  const rung: Rung = !ready || !data ? 'all' : (chosenRung ?? defaultRung(data));
  const facets: Facets = useMemo(() => (ready ? facetsFromParams(params) : NO_FACETS), [params, ready]);
  const setScope = useCallback(
    (r: Rung | null, f: Facets) => setParams(writeParams(params, r, f), { replace: true }),
    [params, setParams],
  );
  const menus = data?.house?.menus ?? [];
  const noMenu = ready && menus.length === 0;

  // RANK ONCE over everything on the table; the rung and facets only hide.
  const ranked = useMemo(() => rankOffers(offers), [offers]);
  const shown = useMemo(() => ranked.filter((r) => visible(r.offer, rung, facets, today)), [ranked, rung, facets, today]);
  const bands = useMemo(() => bandsOf(shown), [shown]);
  const ungradable = useMemo(
    () => ungradableOffers(offers).filter((o) => visible(o, rung, facets, today)),
    [offers, rung, facets, today],
  );
  const putAway = useMemo(() => putAwayOffers(offers), [offers]);
  const onTable = useMemo(() => offers.filter(onTheTable), [offers]);
  const counts = useMemo(() => rungCounts(onTable, facets, today), [onTable, facets, today]);
  const options = useMemo(() => facetOptions(onTable, rung, facets, today), [onTable, rung, facets, today]);
  const preview = useCallback(
    (f: Facets) => onTable.filter((o) => visible(o, rung, f, today)).length,
    [onTable, rung, today],
  );
  const rungLabel = RUNGS.find((r) => r.id === rung)?.label ?? 'All offers';
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
                {data.ledger.caps?.paid_lines.reached
                  ? ` Only the newest ${data.ledger.caps.paid_lines.cap} paid lines were read; older ones in the window were not graded.`
                  : ''}
                {data.ledger.caps?.sightings.reached
                  ? ` Only the newest ${data.ledger.caps.sightings.cap} sightings were read.`
                  : ''}
              </p>
            </>
          )}
        </header>

        {data && ready && (
          <>
            <ScopeBar
              rung={rung}
              counts={counts}
              onRung={(r) => setScope(r, facets)}
              facets={facets}
              options={options}
              onFacets={(f) => setScope(chosenRung, f)}
              preview={preview}
              counted={data.house ? { counted: data.house.shelf.counted, active: data.house.shelf.active } : null}
              narrow={narrow}
            />
            {noMenu && rung !== 'all' ? (
              <p className="pn-banner" role="status" data-testid="pn-no-menu">
                No menu read yet — showing everything you stock.{' '}
                <Link to="/house/menu">Read your menu →</Link>
              </p>
            ) : (
              menus.length > 0 &&
              data.house && (
                <p className="pn-coverage" data-testid="pn-coverage">
                  &ldquo;On my menu&rdquo; reads {menus.length === 1 ? 'your current menu' : `your ${menus.length} current menus`}
                  {menus[0].read_at ? `, current since ${menus[0].read_at.slice(0, 10)}` : ''} ·{' '}
                  {data.house.coverage.linked} of {data.house.coverage.drinkLines} drink line
                  {data.house.coverage.drinkLines === 1 ? '' : 's'} linked to a wine
                  {data.house.coverage.notLinked > 0
                    ? ` · ${data.house.coverage.notLinked} not linked, so no offer can match ${data.house.coverage.notLinked === 1 ? 'it' : 'them'}`
                    : ''}
                  .
                </p>
              )
            )}
          </>
        )}

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
              {onTable.length === 0 ? (
                <div className="pn-state">
                  <p>No offers are on the table right now. This lane is active and listening.</p>
                </div>
              ) : shown.length === 0 && ungradable.length === 0 ? (
                <div className="pn-state" data-testid="pn-scope-empty">
                  {activeFacetCount(facets) > 0 ? (
                    <>
                      <p>No offer in &ldquo;{rungLabel}&rdquo; matches these filters.</p>
                      <button type="button" className="pn-btn" onClick={() => setScope(chosenRung, NO_FACETS)}>
                        Clear filters
                      </button>
                    </>
                  ) : rung === 'menu' && noMenu ? (
                    <>
                      <p>No menu read yet, so no offer can be matched to it.</p>
                      <button type="button" className="pn-btn" onClick={() => setScope('stock', facets)}>
                        See everything you stock →
                      </button>
                    </>
                  ) : rung === 'menu' ? (
                    <>
                      <p>Nothing on your menu is on offer right now.</p>
                      <button type="button" className="pn-btn" onClick={() => setScope('stock', facets)}>
                        See everything you stock →
                      </button>
                    </>
                  ) : (
                    <>
                      <p>Nothing you stock is on offer right now.</p>
                      <button type="button" className="pn-btn" onClick={() => setScope('all', facets)}>
                        See all offers →
                      </button>
                    </>
                  )}
                </div>
              ) : shown.length === 0 ? null : (
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
                    {ungradable.length} offer{ungradable.length === 1 ? '' : 's'}
                    {rung === 'all' ? ' on the table' : ` in “${rungLabel}”`} name no wine the ledger can price, or
                    carry no percentage or amount off — in the vendor's own words below, never a fabricated figure.
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
