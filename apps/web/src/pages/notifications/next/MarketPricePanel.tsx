/**
 * The market-price box — "X is now selling lower than its 30-day average".
 *
 * It is a REGISTER, drawn like every other register on this page: a rule, the
 * rows it produced, and a statement of what it looked at. The one thing it
 * never does is offer to buy: the house records prices, a person places
 * orders, and the box's strongest control is a link to where the buying
 * happens.
 *
 * The empty state is the whole design problem here, and it has three
 * genuinely different answers that must not be allowed to look alike:
 *
 *   • the sweep could not be read            → say so, name the failure
 *   • the register holds no sightings at all → say so, name who would write one
 *   • sightings exist, none is below its mean → say so, with the counts
 *
 * On 2026-09-03 the second is the true one: `vendor_price_observations` is
 * empty on the project this gateway reads.
 */

import { Link } from 'react-router-dom';
import { Globe, RotateCw, Tag, TrendingDown, TriangleAlert } from 'lucide-react';
import { EM, MONO, SANS, SERIF, stampOf } from './nt-format';
import { MarketPriceItem, useMarketPrice } from './useMarketPrice';

function money(value: number | null, currency: string): string {
  if (value === null) return EM;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function pct(fraction: number | null): string {
  if (fraction === null) return EM;
  return `${(fraction * 100).toFixed(1)}%`;
}

function Row({ item }: { item: MarketPriceItem }) {
  return (
    <li className="py-2" style={{ borderTop: '1px solid var(--paper-2)' }}>
      <div className="flex items-baseline justify-between gap-2">
        <span
          className="min-w-0 flex-1 truncate text-[12.5px] font-semibold"
          style={{ fontFamily: SANS, color: 'var(--ink-1)' }}
        >
          {item.productName ?? 'Unnamed product'}
        </span>
        <span
          className="shrink-0 text-[12px] font-semibold"
          style={{ fontFamily: MONO, color: 'var(--seal-deep)' }}
        >
          −{pct(item.fractionBelow)}
        </span>
      </div>
      <p className="mt-0.5 text-[11.5px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
        <span style={{ fontFamily: MONO }}>{money(item.latestPrice, item.currency)}</span> now,
        against{' '}
        <span style={{ fontFamily: MONO }}>{money(item.averagePrice, item.currency)}</span> across
        the {item.averageOf ?? EM} earlier{' '}
        {item.averageOf === 1 ? 'sighting' : 'sightings'} in the window.
      </p>
      <p className="mt-0.5 text-[11px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
        {item.latestVendor ?? 'Vendor not named on the sighting'} ·{' '}
        {item.latestSource ?? EM} · {stampOf(item.latestAt)}
      </p>
    </li>
  );
}

export function MarketPricePanel() {
  const m = useMarketPrice();

  return (
    <section
      aria-labelledby="nt-market"
      className="rounded-xl p-3.5"
      style={{ border: '1px solid var(--paper-2)', background: 'var(--paper-1)' }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2
          id="nt-market"
          className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em]"
          style={{ fontFamily: MONO, color: 'var(--ink-4)' }}
        >
          <Tag size={12} strokeWidth={1.75} aria-hidden />
          Cheaper than lately
        </h2>
        <button
          type="button"
          onClick={m.refresh}
          aria-label="Re-read the price register"
          className="nt-ink rounded px-1.5 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
          style={{
            border: '1px solid var(--paper-2)',
            background: 'transparent',
            color: 'var(--ink-2)',
            cursor: 'pointer',
          }}
        >
          <RotateCw size={11} strokeWidth={1.75} aria-hidden />
        </button>
      </div>

      {m.state === 'loading' && <div className="nt-skel mt-2 h-14" aria-hidden />}

      {m.state === 'unreadable' && (
        <p
          role="status"
          className="mt-2 inline-flex items-start gap-1.5 text-[11.5px]"
          style={{ fontFamily: SANS, color: 'var(--ink-2)' }}
        >
          <TriangleAlert size={12} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0" />
          {m.failure?.forbidden
            ? `The price register refused this account (${m.failure.status ?? 'refused'}). Vendor pricing is owner and manager only, so nothing is claimed here either way.`
            : `The price register could not be swept (${m.failure?.message ?? 'no reason given'}). This box is unknown, not empty.`}
        </p>
      )}

      {m.state === 'ready' && m.items.length > 0 && (
        <>
          <p
            className="mt-1.5 text-[13px]"
            style={{ fontFamily: SERIF, fontStyle: 'italic', color: 'var(--ink-2)' }}
          >
            {m.items.length === 1
              ? 'One product is being quoted below what it had lately been going for.'
              : `${m.items.length} products are being quoted below what they had lately been going for.`}
          </p>
          <ul className="mt-1.5">
            {m.items.map((i) => (
              <Row key={i.productKey} item={i} />
            ))}
          </ul>
          <Link
            to="/vendor-prices"
            className="nt-ink mt-2 inline-block rounded px-2 py-1 text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
            style={{
              fontFamily: SANS,
              border: '1px solid var(--seal-ring)',
              color: 'var(--seal-deep)',
            }}
          >
            Open the price ladder →
          </Link>
        </>
      )}

      {m.state === 'ready' && m.publicSiteItems.length > 0 && (
        <div className="mt-3 pt-2" style={{ borderTop: '1px solid var(--paper-2)' }}>
          <h3
            className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em]"
            style={{ fontFamily: MONO, color: 'var(--ink-4)' }}
          >
            <Globe size={12} strokeWidth={1.75} aria-hidden />
            Public vendor sites, tier 4
          </h3>
          <p className="mt-1 text-[11px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
            List prices read off vendors&rsquo; own web pages. They are compared only with each
            other, never against a price a vendor quoted this house, and they are never the basis
            of the list above.
          </p>
          <ul className="mt-1.5">
            {m.publicSiteItems.map((i) => (
              <Row key={`site:${i.productKey}`} item={i} />
            ))}
          </ul>
        </div>
      )}

      {m.state === 'ready' &&
        m.items.length === 0 &&
        m.publicSiteItems.length === 0 &&
        m.scannedObservations === 0 && (
        <>
          <p className="mt-1.5 text-[11.5px]" style={{ fontFamily: SANS, color: 'var(--ink-2)' }}>
            The price register holds no sightings at all — not for this house and not for the
            market. Nothing is being claimed about what anything costs.
          </p>
          <p className="mt-1 text-[11px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
            A sighting is written when a vendor page is read, or when someone records a price they
            were quoted. Until one of those has happened, this box has nothing to compare.
          </p>
        </>
      )}

      {m.state === 'ready' &&
        m.items.length === 0 &&
        m.publicSiteItems.length === 0 &&
        (m.scannedObservations ?? 0) > 0 && (
        <>
          <p className="mt-1.5 text-[11.5px]" style={{ fontFamily: SANS, color: 'var(--ink-2)' }}>
            Nothing is below its recent average. {m.scannedObservations} sightings across{' '}
            {m.scannedProducts ?? EM} products were compared.
          </p>
          <p className="mt-1 text-[11px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
            {m.skippedThin ?? EM} products had fewer than {m.minObservations ?? EM} earlier
            sightings to average, {m.skippedNotBelow ?? EM} were level or dearer, and{' '}
            {m.skippedMixedCurrency ?? EM} mixed currencies and were left alone rather than
            converted.
          </p>
        </>
      )}

      {m.state === 'ready' && (m.skippedUnrecognisedClass ?? 0) > 0 && (
        <p className="mt-1 text-[11px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
          {m.skippedUnrecognisedClass} sightings arrived with a source this box has no class for.
          They were ranked nowhere rather than folded in silently.
        </p>
      )}

      <p
        className="mt-2.5 pt-2 text-[10.5px]"
        style={{ fontFamily: SANS, color: 'var(--ink-4)', borderTop: '1px solid var(--paper-2)' }}
      >
        The rule, in full: the newest sighting of a product against the mean of its{' '}
        {m.minObservations ?? EM} or more earlier sightings in the last {m.windowDays ?? EM} days,
        per 750ml equivalent, from prices this house was quoted. Public vendor-site list prices are
        ranked separately below, never in this list. The latest is
        not folded into its own average, and a sighting is only ever compared with another of its
        own class. This box reads prices; it never places an order.
      </p>

      <p className="mt-1 text-[10.5px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
        <TrendingDown size={10} strokeWidth={1.75} aria-hidden className="mr-1 inline align-[-1px]" />
        A price drop does not yet write a line in the book — nothing notifies you when this changes
        while you are elsewhere.
      </p>
    </section>
  );
}

export default MarketPricePanel;
