/**
 * OfferCard — one offer, drawn at the size its rank earns (sketch 124
 * direction A "The Band", founder 2026-09-25, round 5; ADR 0160 §113).
 *
 * THREE SIZES. ADR 0165 rule 4 decides WHICH offer earns which tier
 * (`rankOffers`: at most one hero, up to three large, the rest compact) and
 * this card draws it: `pn-card--hero` is a two-column band across the page
 * (the lead on the left, the worth, lines and acts on the right), `--large`
 * is the full card three across, `--compact` a tile five across carrying the
 * figure, one line of why, and its acts. The page lays the bands out
 * (`PromotionsNext`); this component only draws one card.
 *
 * A BUNDLE IS A TRAY (founder, 2026-09-25, round 5, sketch 124 question 2):
 * one card, its bottles set into it as a small table, at the tier its
 * rolled-up total earns. Its figure is that total (an estimate, labelled so);
 * when the total is withheld (a bottle with no worth, or a minimum whose unit
 * is unknown — ADR 0165) the tray says "worth withheld", names why, and is
 * compact, never sized by its best bottle. The tray shows its FIRST FIVE
 * bottles and "n more" (founder, 2026-09-26, round 6); the sheet shows them
 * all.
 *
 * WHERE IT SITS FOR THE HOUSE (founder item 36). A card whose wine is on a
 * current menu line says so — "names a wine on your menu: <that line>", the
 * menu line's own words, so the owner can check the match (the extractor
 * matches a name inside the mail; research-filters F3). A tray says how many
 * of its bottles are: "n of m on your menu". A wine whose COUNTED stock is
 * below par says "running low", with the count's date — never for stock
 * nobody counted.
 *
 * The number drawn on a single offer is ALWAYS the verdict against the lowest
 * OTHER vendor (`grade.wines[].deltaPct`/`verdict`), never the vendor's own
 * percentage off its own price — that percentage is printed once, small, in
 * the claim line, labelled "their claim" (sketch 113 README "the fact that
 * settles most of fork 1" — see `offer-grade.ts`'s own header).
 */

import { useRef, useState, type ReactNode } from 'react';
import { Popover } from '../../../components/mudavym';
import {
  bundleWorthReason,
  claimSentence,
  conditionsOf,
  discountOf,
  fmtEstimate,
  fmtEstimateFigure,
  fmtPrice,
  fmtSignedPercent,
  headlineWineOf,
  isBundleOffer,
  offerStateWord,
  verdictTone,
  verdictWord,
  worthReasonFor,
  type OfferDto,
  type OfferTier,
  type WineGrade,
} from './promotions-format';
import { menuTagOf } from './promotions-scope';

/** Founder, 2026-09-26, round 6: a tray shows its first five bottles, then "n more"; the sheet shows all. */
export const TRAY_BOTTLES_SHOWN = 5;

/** The house-first tags: on the menu (named), n of m on the menu (a tray), running low (counted). */
function HouseTags({ offer, bundle }: { offer: OfferDto; bundle: boolean }) {
  const scope = offer.scope;
  if (!scope) return null;
  const menuTag = menuTagOf(offer);
  const low = scope.runningLow[0] ?? null;
  if (!menuTag && !low) return null;
  return (
    <div className="pn-tags">
      {bundle && scope.winesOnMenu > 0 ? (
        <span className="pn-tag pn-tag--menu" title={scope.menuMatches.map((m) => m.menuLine).join(' · ')}>
          {scope.winesOnMenu} of {scope.wines} on your menu
        </span>
      ) : menuTag ? (
        <span className="pn-tag pn-tag--menu">names a wine on your menu: {menuTag}</span>
      ) : null}
      {low && (
        <span className="pn-tag pn-tag--low">
          running low · {low.stockLive} of {low.thresholdMin} par, counted {low.countedAt.slice(0, 10)}
          {scope.runningLow.length > 1 ? ` · +${scope.runningLow.length - 1} more` : ''}
        </span>
      )}
    </div>
  );
}

function CodeChip({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="pn-chip pn-chip--code">
      code <b>{code}</b>
      <button
        type="button"
        className="pn-chip__copy"
        aria-label={`Copy code ${code}`}
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

function WineLine({ wine }: { wine: WineGrade }) {
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
    </div>
  );
}

/** One bottle's figure inside a tray: its verdict, then its own worth when it has one. */
function bottleFigure(w: WineGrade): string {
  const parts: string[] = [];
  if (w.deltaPct != null) parts.push(fmtSignedPercent(w.deltaPct));
  if (w.worth) parts.push(`about ${fmtEstimateFigure(w.worth.amount, w.worth.currency)}`);
  return parts.length > 0 ? parts.join(' · ') : verdictWord(w.verdict);
}

/** The tray's small table — the first five bottles, in the order the mail named them. */
function BottleTable({ wines }: { wines: WineGrade[] }) {
  const more = wines.length - TRAY_BOTTLES_SHOWN;
  return (
    <table className="pn-bottles">
      <caption className="pn-sr">Bottles in this bundle, each against the lowest other vendor</caption>
      <tbody>
        {wines.slice(0, TRAY_BOTTLES_SHOWN).map((w, i) => {
          const tone = verdictTone(w.verdict);
          return (
            <tr key={`${w.wine}-${i}`}>
              <th scope="row">{w.matchedAs ?? w.wine}</th>
              <td className={tone ? `pn-${tone}` : 'pn-withheld'}>{bottleFigure(w)}</td>
            </tr>
          );
        })}
        {more > 0 && (
          <tr className="pn-bottles__more">
            <td colSpan={2}>
              {more} more — see details
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

interface FootProps {
  offer: OfferDto;
  showDraft: boolean;
  onOpenDetail: (id: string) => void;
  onDismiss: (id: string) => void;
  onRestore: (id: string) => void;
  busy: boolean;
}

function CardFoot({ offer, showDraft, onOpenDetail, onDismiss, onRestore, busy }: FootProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const conditions = conditionsOf(offer.conditions);
  const dismissed = offer.state === 'dismissed';
  const who = offer.provider_name ?? 'vendor';
  return (
    <div className="pn-foot">
      <button
        type="button"
        className="pn-btn pn-btn--quiet"
        aria-label={`Details — ${who}, ${offer.name}`}
        onClick={() => onOpenDetail(offer.id)}
      >
        Details
      </button>
      {showDraft && !dismissed && (
        <a className="pn-btn pn-btn--primary" href={`/orders?new=1&promo=${encodeURIComponent(offer.id)}`}>
          Draft an order
        </a>
      )}
      <button
        ref={menuBtnRef}
        type="button"
        className="pn-btn pn-btn--icon"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
      >
        ⋯
      </button>
      {menuOpen && (
        <Popover
          open
          onClose={() => setMenuOpen(false)}
          anchorRef={menuBtnRef}
          label={`Actions for the ${who} offer`}
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
  );
}

export interface OfferCardProps {
  offer: OfferDto;
  /** ADR 0165 rule 4's tier — drawn as the card's size (direction A, sketch 124). */
  tier: OfferTier;
  today: string;
  onOpenDetail: (id: string) => void;
  onDismiss: (id: string) => void;
  onRestore: (id: string) => void;
  busy: boolean;
}

export function OfferCard({ offer, tier, today, onOpenDetail, onDismiss, onRestore, busy }: OfferCardProps) {
  const wines = offer.grade.wines;
  const state = offerStateWord(offer, today);
  const discount = discountOf(offer.discount_value);
  const conditions = conditionsOf(offer.conditions);
  const bundle = isBundleOffer(offer);
  const compact = tier === 'compact';

  const top = (
    <div className="pn-card__top">
      <span className="pn-card__vendor">
        {offer.provider_name ?? 'Unnamed vendor'}
        {offer.name && <span> · {offer.name}</span>}
      </span>
      <span className={`pn-card__ends${state.soon ? ' pn-warn' : ''}`}>{state.word}</span>
    </div>
  );
  const foot = (
    <CardFoot
      offer={offer}
      showDraft={bundle || !compact}
      onOpenDetail={onOpenDetail}
      onDismiss={onDismiss}
      onRestore={onRestore}
      busy={busy}
    />
  );

  let lead: ReactNode;
  let rest: ReactNode;

  if (bundle) {
    const total = offer.bundle;
    const tone = total ? (total.amount > 0 ? 'beats' : total.amount < 0 ? 'above' : 'none') : 'none';
    const n = wines.length;
    lead = (
      <>
        {top}
        <HouseTags offer={offer} bundle />
        <span className="pn-chip pn-chip--bundle">
          bundle · {n} bottle{n === 1 ? '' : 's'}
        </span>
        {total ? (
          <>
            <div className={`pn-num pn-num--${tone}`}>
              <span className="pn-num__about">about </span>
              {fmtEstimateFigure(total.amount, total.currency)}
            </div>
            <div className="pn-against">
              the bundle&rsquo;s worth — the sum of its {total.linesCounted} bottle{total.linesCounted === 1 ? '' : 's'}, each
              against your lowest other vendor
            </div>
          </>
        ) : (
          <div className="pn-num pn-num--none">worth withheld</div>
        )}
      </>
    );
    rest = (
      <>
        {n > 0 && <BottleTable wines={wines} />}
        <div className="pn-claimline">
          <b>Their claim:</b> {claimSentence(discount)}
          {conditions.code && <CodeChip code={conditions.code} />}
        </div>
        {total ? (
          <span className="pn-est">Estimate at your rate, not a saving already banked.</span>
        ) : (
          <div className="pn-why">{bundleWorthReason(wines)}</div>
        )}
        {foot}
      </>
    );
  } else {
    const headline = headlineWineOf(wines);
    const figure = headline ? (
      headline.deltaPct != null && headline.bestElsewhere ? (
        <div className={`pn-num pn-num--${verdictTone(headline.verdict) ?? 'none'}`}>
          {fmtSignedPercent(headline.deltaPct)}
        </div>
      ) : (
        <div className="pn-num pn-num--none">{verdictWord(headline.verdict)}</div>
      )
    ) : (
      <div className="pn-num pn-num--none">not a price</div>
    );

    if (compact) {
      // A tile: the figure and ONE line of why. Everything else is in the sheet.
      const why = headline?.worth
        ? `${fmtEstimate(headline.worth.amount, headline.worth.currency)} est. against ${headline.bestElsewhere?.providerName ?? 'the lowest other vendor'}`
        : headline
          ? worthReasonFor(headline) || verdictWord(headline.verdict)
          : 'the mail states neither a percentage nor an amount off';
      lead = (
        <>
          {top}
          {figure}
          <div className="pn-why">{why}</div>
          <HouseTags offer={offer} bundle={false} />
        </>
      );
      rest = foot;
    } else {
      lead = (
        <>
          {top}
          <HouseTags offer={offer} bundle={false} />
          {figure}
          {headline && headline.deltaPct != null && headline.bestElsewhere && (
            <div className="pn-against">
              {headline.verdict === 'above' ? 'above' : headline.verdict === 'matches' ? 'matches' : 'under'}{' '}
              <b>
                {headline.bestElsewhere.providerName ?? 'another vendor'},{' '}
                {fmtPrice(headline.bestElsewhere.price, headline.bestElsewhere.currency)}
              </b>{' '}
              · {headline.bestElsewhere.source === 'receipt_verified' ? 'landed' : 'agreed'}{' '}
              {headline.bestElsewhere.date ?? 'no date'} · on {headline.matchedAs ?? headline.wine}
            </div>
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
        </>
      );
      rest = (
        <>
          {headline && !headline.worth && (
            <div className="pn-worth pn-worth--none">
              <span className="pn-worth__amount">worth —</span> {worthReasonFor(headline)}
            </div>
          )}
          {headline?.worth && (
            <div className="pn-worth">
              <span className="pn-worth__amount">{fmtEstimate(headline.worth.amount, headline.worth.currency)}</span>{' '}
              against {headline.bestElsewhere?.providerName ?? 'the other vendor'}&rsquo;s price of{' '}
              {headline.worth.comparisonDate} — {headline.worth.quantity} bottle
              {headline.worth.quantity === 1 ? '' : 's'} bought in the last {headline.worth.windowDays} days across{' '}
              {headline.worth.invoiceLines} invoice{headline.worth.invoiceLines === 1 ? '' : 's'}.
              <span className="pn-est">Estimate at your rate, not a saving already banked.</span>
            </div>
          )}
          {wines.length > 0 && (
            <div className="pn-lines">
              {wines.slice(0, 3).map((w, i) => (
                <WineLine key={`${w.wine}-${i}`} wine={w} />
              ))}
              {wines.length > 3 && <span className="pn-lines__more">+{wines.length - 3} more — see details</span>}
            </div>
          )}
          {foot}
        </>
      );
    }
  }

  return (
    <article
      className={`pn-card pn-card--${tier}${bundle ? ' pn-tray' : ''}`}
      data-tier={tier}
      data-bundle={bundle ? 'true' : undefined}
      data-testid={`offer-card-${offer.id}`}
      aria-label={`${offer.provider_name ?? 'Unnamed vendor'} — ${offer.name}${bundle ? ', bundle' : ''}`}
    >
      {tier === 'hero' ? (
        <>
          <div className="pn-hero__lead">{lead}</div>
          <div className="pn-hero__rest">{rest}</div>
        </>
      ) : (
        <>
          {lead}
          {rest}
        </>
      )}
    </article>
  );
}

export default OfferCard;
