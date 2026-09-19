/**
 * OfferCard — one offer, sized by what it is worth (sketch 113 direction B,
 * "the bigger the sale, the bigger the box"), dense enough that ten-plus read
 * at once (direction C). Three tiers, one component:
 *
 *  - `hero`   — the single top-ranked offer: full breakdown inline, the
 *               figure at its largest.
 *  - `large`  — up to the next three offers with a positive worth: figure +
 *               claim + worth line, the per-wine breakdown collapsed to a
 *               summary (open the sheet for the rest).
 *  - `compact`— everything else on the table (no worth to rank by, or a
 *               worth the gateway refused because the offer is not shown to
 *               qualify or its comparison price is stale, ADR 0165): vendor,
 *               state, one verdict word. Identifies the card; the sheet holds
 *               the rest. This tier is what keeps ten-plus offers on one
 *               screen (direction C's density) without repeating the hero
 *               treatment on every card.
 *
 * The number drawn is ALWAYS the verdict against the lowest OTHER vendor
 * (`grade.wines[].deltaPct`/`verdict`), never the vendor's own percentage off
 * its own price — that percentage is printed once, small, in the claim line,
 * labelled "their claim" (sketch README "the fact that settles most of fork
 * 1" — see `offer-grade.ts`'s own header for the arithmetic this repeats).
 */

import { useRef, useState } from 'react';
import { Popover } from '../../../components/mudavym';
import {
  claimSentence,
  conditionsOf,
  discountOf,
  fmtEstimate,
  fmtPrice,
  fmtSignedPercent,
  headlineWineOf,
  offerStateWord,
  verdictTone,
  verdictWord,
  worthReasonFor,
  bundleWorthReason,
  type OfferDto,
  type OfferTier,
  type WineGrade,
} from './promotions-format';

function CodeChip({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="pn-chip pn-chip--code">
      code <b>{code}</b>
      <button
        type="button"
        className="pn-chip__copy"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // Clipboard denied — the code is already printed in the chip, so
            // nothing is lost, only the one-click convenience.
          }
        }}
      >
        {copied ? 'copied' : 'copy'}
      </button>
    </span>
  );
}

function WineLine({ wine, showWhy }: { wine: WineGrade; showWhy: boolean }) {
  const tone = verdictTone(wine.verdict);
  return (
    <div className="pn-line">
      <span className="pn-line__wine">{wine.matchedAs ?? wine.wine}</span>
      <span className={`pn-line__figure${tone ? ` pn-${tone}` : ''}`}>
        {wine.baseline && wine.offered ? (
          <>
            <s>{fmtPrice(wine.baseline.price, wine.baseline.currency)}</s>{' '}
            {fmtPrice(wine.offered.price, wine.offered.currency)}
            {wine.deltaPct != null ? ` · ${fmtSignedPercent(wine.deltaPct)}` : ''}
          </>
        ) : (
          verdictWord(wine.verdict)
        )}
      </span>
      {showWhy && wine.skipped.length > 0 && (
        <span className="pn-line__why">{wine.skipped.map((s) => s.reason).join('; ')}</span>
      )}
      {showWhy && wine.skipped.length === 0 && wine.verdict !== 'beats' && wine.verdict !== 'above' && wine.verdict !== 'matches' && (
        <span className="pn-line__why">{worthReasonFor(wine)}</span>
      )}
    </div>
  );
}

export interface OfferCardProps {
  offer: OfferDto;
  tier: OfferTier;
  today: string;
  onOpenDetail: (id: string) => void;
  onDismiss: (id: string) => void;
  onRestore: (id: string) => void;
  busy: boolean;
}

export function OfferCard({ offer, tier, today, onOpenDetail, onDismiss, onRestore, busy }: OfferCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const isBundle = offer.promo_type === 'bundle';
  const wines = offer.grade.wines;
  const headline = headlineWineOf(wines);
  const state = offerStateWord(offer, today);
  const discount = discountOf(offer.discount_value);
  const conditions = conditionsOf(offer.conditions);
  const dismissed = offer.state === 'dismissed';

  const className = ['pn-card', `pn-card--${tier}`, isBundle ? 'pn-card--bundle' : ''].filter(Boolean).join(' ');

  return (
    <article className={className} data-testid={`offer-card-${offer.id}`}>
      <div className="pn-card__top">
        <span className="pn-card__vendor">
          {offer.provider_name ?? 'Unnamed vendor'}
          {offer.name && <span> · {offer.name}</span>}
        </span>
        <span className={`pn-card__ends${state.soon ? ' pn-warn' : ''}`}>{state.word}</span>
      </div>

      {isBundle && (
        <span className="pn-chip pn-chip--bundle">
          bundle · {wines.filter((w) => w.verdict !== 'unknown_wine').length} bottles
        </span>
      )}

      {isBundle ? (
        offer.bundle ? (
          <div className="pn-num pn-num--worth">{fmtEstimate(offer.bundle.amount, offer.bundle.currency)}</div>
        ) : (
          <div className="pn-num pn-num--none">worth withheld</div>
        )
      ) : headline ? (
        headline.deltaPct != null && headline.bestElsewhere ? (
          <>
            <div className={`pn-num pn-num--${verdictTone(headline.verdict) ?? 'none'}`}>
              {fmtSignedPercent(headline.deltaPct)}
            </div>
            <div className="pn-against">
              {headline.verdict === 'above' ? 'above' : headline.verdict === 'matches' ? 'matches' : 'under'}{' '}
              <b>
                {headline.bestElsewhere.providerName ?? 'another vendor'}, {fmtPrice(headline.bestElsewhere.price, headline.bestElsewhere.currency)}
              </b>{' '}
              · {headline.bestElsewhere.source === 'receipt_verified' ? 'landed' : 'agreed'}{' '}
              {headline.bestElsewhere.date ?? 'no date'} · on {headline.matchedAs ?? headline.wine}
            </div>
          </>
        ) : (
          <div className="pn-num pn-num--none">{verdictWord(headline.verdict)}</div>
        )
      ) : (
        <div className="pn-num pn-num--none">not a price</div>
      )}

      <div className="pn-claimline">
        <b>Their claim:</b> {claimSentence(discount)}
        {headline?.baseline && headline.offered
          ? ` ${fmtPrice(headline.baseline.price, headline.baseline.currency)} → ${fmtPrice(headline.offered.price, headline.offered.currency)}`
          : headline?.verdict === 'no_baseline'
            ? ' — no price from this vendor to take it from'
            : ''}
        {conditions.code && <CodeChip code={conditions.code} />}
        {headline?.baseline && headline.baseline.source !== 'receipt_verified' && (
          <span className="pn-chip pn-chip--agreed">agreed · not yet received</span>
        )}
      </div>

      {!isBundle && headline && !headline.worth && (
        <div className="pn-worth pn-worth--none">
          <span className="pn-worth__amount">worth —</span> {worthReasonFor(headline)}
        </div>
      )}
      {!isBundle && headline?.worth && (
        <div className="pn-worth">
          <span className="pn-worth__amount">{fmtEstimate(headline.worth.amount, headline.worth.currency)}</span>{' '}
          against {headline.bestElsewhere?.providerName ?? 'the other vendor'}'s price of {headline.worth.comparisonDate} — {headline.worth.quantity} bottle
          {headline.worth.quantity === 1 ? '' : 's'} bought in the last {headline.worth.windowDays} days across{' '}
          {headline.worth.invoiceLines} invoice{headline.worth.invoiceLines === 1 ? '' : 's'}.
          <span className="pn-est">Estimate at your rate, not a saving already banked.</span>
        </div>
      )}
      {isBundle && !offer.bundle && (
        <div className="pn-worth pn-worth--none">
          <span className="pn-worth__amount">worth —</span> {bundleWorthReason(wines)}
        </div>
      )}

      {tier !== 'compact' && wines.length > 0 && (
        <div className="pn-lines">
          {(tier === 'hero' ? wines : wines.slice(0, 3)).map((w, i) => (
            <WineLine key={`${w.wine}-${i}`} wine={w} showWhy={tier === 'hero'} />
          ))}
          {tier !== 'hero' && wines.length > 3 && (
            <span className="pn-lines__more">+{wines.length - 3} more — see details</span>
          )}
        </div>
      )}

      <div className="pn-foot">
        <button type="button" className="pn-btn pn-btn--quiet" onClick={() => onOpenDetail(offer.id)}>
          Details
        </button>
        {!dismissed && (
          <a
            className="pn-btn pn-btn--primary"
            href={`/orders?new=1&promo=${encodeURIComponent(offer.id)}`}
          >
            Draft an order
          </a>
        )}
        <button
          ref={menuBtnRef}
          type="button"
          className="pn-btn pn-btn--icon"
          aria-label="More actions"
          aria-haspopup="menu"
          onClick={() => setMenuOpen((v) => !v)}
        >
          ⋯
        </button>
        {menuOpen && (
          <Popover
            open
            onClose={() => setMenuOpen(false)}
            anchorRef={menuBtnRef}
            label={`Actions for the ${offer.provider_name ?? 'vendor'} offer`}
            showClose={false}
            width={240}
          >
            {conditions.code && (
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(conditions.code as string);
                  setMenuOpen(false);
                }}
              >
                Copy code
                <small>{conditions.code}</small>
              </button>
            )}
            {dismissed ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  onRestore(offer.id);
                  setMenuOpen(false);
                }}
              >
                Bring back to the table
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  onDismiss(offer.id);
                  setMenuOpen(false);
                }}
              >
                Put away
                <small>For the whole house — undoable just after</small>
              </button>
            )}
          </Popover>
        )}
      </div>
    </article>
  );
}

export default OfferCard;
