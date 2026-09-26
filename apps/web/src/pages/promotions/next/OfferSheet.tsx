/**
 * OfferSheet — the offer as one object (ADR 0112: a Sheet, `tuck`, 440px).
 *
 * Every line the docket card compresses or hides — every named wine, its
 * baseline, its verdict, every skipped comparison and why — is here in full,
 * because the card's whole point (direction C's density) is that the sheet
 * carries what the card cannot show ten of at once.
 *
 * A bundle opens here too, bottle by bottle, with its rolled-up total (or
 * the sentence saying why the total is withheld) above the bottles — the
 * same figure its tray card draws (sketch 124 direction A, founder
 * 2026-09-25, round 5; offer-grade.ts `bundleWorth`).
 */

import { useState } from 'react';
import { Sheet } from '../../../components/mudavym';
import {
  bundleWorthReason,
  claimSentence,
  conditionsOf,
  discountOf,
  fmtEstimate,
  fmtPrice,
  fmtSignedPercent,
  offerStateWord,
  verdictTone,
  verdictWord,
  worthReasonFor,
  type OfferDto,
} from './promotions-format';

export interface OfferSheetProps {
  offer: OfferDto | null;
  today: string;
  onClose: () => void;
  onDismiss: (id: string) => void;
  onRestore: (id: string) => void;
  busy: boolean;
}

export function OfferSheet({ offer, today, onClose, onDismiss, onRestore, busy }: OfferSheetProps) {
  const [copied, setCopied] = useState(false);
  if (!offer) return null;
  const discount = discountOf(offer.discount_value);
  const conditions = conditionsOf(offer.conditions);
  const state = offerStateWord(offer, today);
  const dismissed = offer.state === 'dismissed';
  const isBundle = offer.promo_type === 'bundle';

  return (
    <Sheet
      open
      onClose={onClose}
      label={`${offer.provider_name ?? 'Vendor'} — ${offer.name}`}
      eyebrow={isBundle ? 'Bundle offer' : 'Offer'}
      title={offer.provider_name ?? 'Unnamed vendor'}
    >
      <p className="pn-sheet__sub">
        {offer.name} · {state.word}
        {conditions.validText ? ` · ${conditions.validText}` : ''}
      </p>

      <div className="pn-kv">
        <dt>Their claim</dt>
        <dd>
          {claimSentence(discount)}
          {conditions.code && (
            <span className="pn-chip pn-chip--code">
              code <b>{conditions.code}</b>
              <button
                type="button"
                className="pn-chip__copy"
                onClick={async () => {
                  await navigator.clipboard.writeText(conditions.code as string);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? 'copied' : 'copy'}
              </button>
            </span>
          )}
        </dd>
        {(conditions.minQty != null || conditions.minAmount != null) && (
          <>
            <dt>Threshold</dt>
            <dd>
              {conditions.minQty != null ? `${conditions.minQty} units minimum` : ''}
              {conditions.minAmount != null ? `${conditions.minQty != null ? ' · ' : ''}minimum order ${conditions.minAmount}` : ''}
            </dd>
          </>
        )}
        <dt>Confidence</dt>
        <dd>{offer.confidence != null ? `${Math.round(offer.confidence * 100)}% — how clearly the mail’s text matched this offer’s shape, not a claim about the price` : '—'}</dd>
        <dt>Vendor history</dt>
        <dd>
          {offer.grade.vendor.paidLines > 0
            ? `${offer.grade.vendor.paidLines} accepted invoice${offer.grade.vendor.paidLines === 1 ? '' : 's'} from this vendor, last ${offer.grade.vendor.lastPurchaseDate ?? 'unknown'}`
            : 'no accepted invoice from this vendor in the ledger window'}
        </dd>
      </div>

      {isBundle && (
        <div className="pn-lineblk" data-testid="pn-sheet-bundle">
          <div className="pn-lineblk__w">The bundle&rsquo;s worth</div>
          {offer.bundle ? (
            <>
              <div className={`pn-lineblk__d pn-lineblk__d--${offer.bundle.amount < 0 ? 'above' : 'beats'}`}>
                {fmtEstimate(offer.bundle.amount, offer.bundle.currency)}
              </div>
              <p>
                The sum of its {offer.bundle.linesCounted} bottles&rsquo; own worths, each against your lowest other
                vendor. Estimate at your rate, not a saving already banked.
              </p>
            </>
          ) : (
            <>
              <div className="pn-lineblk__d pn-lineblk__d--none">worth withheld</div>
              <p>{bundleWorthReason(offer.grade.wines)}</p>
            </>
          )}
        </div>
      )}

      <h3 className="pn-sheet__h3">Every named bottle</h3>
      {offer.grade.wines.map((w, i) => {
        const tone = verdictTone(w.verdict);
        return (
          <div className="pn-lineblk" key={`${w.wine}-${i}`}>
            <div className="pn-lineblk__w">{w.matchedAs ?? w.wine}</div>
            <div className={`pn-lineblk__d${tone ? ` pn-lineblk__d--${tone}` : ' pn-lineblk__d--none'}`}>
              {w.deltaPct != null ? fmtSignedPercent(w.deltaPct) : verdictWord(w.verdict)}
            </div>
            {w.baseline && (
              <p>
                Last charged by this vendor: {fmtPrice(w.baseline.price, w.baseline.currency)} per {w.baseline.unit}
                {w.baseline.source !== 'receipt_verified' ? ' (agreed — never checked against an invoice)' : ' (landed — an accepted invoice)'}
                {w.baseline.date ? `, ${w.baseline.date}` : ''}.
              </p>
            )}
            {w.offered && <p>Their claim applied to that price: {fmtPrice(w.offered.price, w.offered.currency)}. {w.offered.derivation}.</p>}
            {w.bestElsewhere && (
              <p>
                Your lowest other vendor: {w.bestElsewhere.providerName ?? 'unnamed'} at{' '}
                {fmtPrice(w.bestElsewhere.price, w.bestElsewhere.currency)}
                {w.bestElsewhere.date ? `, ${w.bestElsewhere.date}` : ''}.
              </p>
            )}
            {w.reference && !w.baseline && (
              <p>
                You buy this from {w.reference.providerName ?? 'another vendor'} at {fmtPrice(w.reference.price, w.reference.currency)}
                {w.reference.date ? `, ${w.reference.date}` : ''} — never from this vendor.
              </p>
            )}
            {w.worth ? (
              <p>
                Worth: {fmtEstimate(w.worth.amount, w.worth.currency)}, projected over {w.worth.quantity} bottle
                {w.worth.quantity === 1 ? '' : 's'} bought in the last {w.worth.windowDays} days across {w.worth.invoiceLines} invoice
                {w.worth.invoiceLines === 1 ? '' : 's'}, measured against a price dated {w.worth.comparisonDate} (
                {w.worth.comparisonAgeDays} days old; a price older than {w.worth.maxAgeDays} days would withhold this figure). An
                estimate at your own rate, not a saving already banked.
              </p>
            ) : (
              <p>Worth — {worthReasonFor(w)}.</p>
            )}
            {w.skipped.length > 0 && (
              <>
                <h5>Excluded from the comparison</h5>
                {w.skipped.map((s, si) => (
                  <p key={si}>{s.reason}</p>
                ))}
              </>
            )}
          </div>
        );
      })}

      <div className="pn-sheet__actions">
        {dismissed ? (
          <button type="button" className="pn-btn pn-btn--primary" disabled={busy} onClick={() => onRestore(offer.id)}>
            Bring back to the table
          </button>
        ) : (
          <button type="button" className="pn-btn" disabled={busy} onClick={() => onDismiss(offer.id)}>
            Put away for the house
          </button>
        )}
        <a className="pn-btn pn-btn--quiet" href={`/orders?new=1&promo=${encodeURIComponent(offer.id)}`}>
          Draft an order
        </a>
      </div>
      <p className="pn-sheet__note">
        Putting an offer away removes it from every manager’s table, not just this browser (ADR 0144 §4). The
        card leaves once the server confirms it — never before.
      </p>
    </Sheet>
  );
}

export default OfferSheet;
