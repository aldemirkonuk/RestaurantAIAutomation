/**
 * RcOwnerLedger — the owner rendering: one number, and it is only ever money
 * that actually came back.
 *
 * The legacy accounting rule is kept verbatim: `recovered` is money a
 * distributor actually credited, evidenced by a credit memo. Money asked for
 * is shown separately and never added in — a recovered figure a bookkeeper
 * cannot tie to a vendor statement destroys trust the first time they check.
 *
 * What the REWORK adds:
 * - a trend the figure can be argued with — this month against last, summed
 *   from the credited claims' own settle dates, not estimated;
 * - the honest denominator stated as a sentence: what share of everything
 *   asked for ever settles, and what they refused.
 */

import { RcTally } from './RcTally';
import { EM, MONO, SANS, SERIF, capStyle, fmtMoney, fmtMoneyWhole } from './rc-format';
import type { RecoveryData } from './useReceivingNextData';

function Figure({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div>
      <span style={capStyle}>{label}</span>
      <p
        style={{
          fontFamily: MONO,
          fontSize: 19,
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--ink-1, #211C16)',
          margin: '3px 0 0',
        }}
      >
        {value}
      </p>
      <p style={{ fontSize: 11, color: 'var(--ink-3, #7C7365)', margin: '2px 0 0' }}>{hint}</p>
    </div>
  );
}

export function RcOwnerLedger({ data }: { data: RecoveryData }) {
  const { stats, creditedThisMonth, creditedLastMonth, hasData, isError, refetch } = data;
  const settlement =
    stats?.settlementRate == null ? null : Math.round(stats.settlementRate * 100);

  const trendKnown = creditedThisMonth !== null && creditedLastMonth !== null;
  const trendDelta = trendKnown ? creditedThisMonth! - creditedLastMonth! : null;

  return (
    <section aria-label="Money recovered from distributors" style={{ fontFamily: SANS }}>
      <div
        style={{
          border: '1px solid var(--paper-2, #EAE4D8)',
          borderRadius: 16,
          background: 'var(--paper-1, #F3EFE6)',
          padding: '20px 22px',
        }}
      >
        <span style={capStyle}>Recovered from distributors</span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
          <RcTally
            value={stats ? stats.recovered : null}
            format={fmtMoneyWhole}
            style={{
              fontFamily: MONO,
              fontSize: 38,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: 'var(--seal-deep, #14515C)',
            }}
          />
          {/* the trend — real settle dates, never estimated */}
          <span
            style={{
              fontFamily: MONO,
              fontSize: 12.5,
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--ink-2, #4F473C)',
            }}
          >
            this month {creditedThisMonth === null ? EM : fmtMoneyWhole(creditedThisMonth)} · last
            month {creditedLastMonth === null ? EM : fmtMoneyWhole(creditedLastMonth)}
            {trendKnown && trendDelta !== 0 && (
              <span style={{ color: 'var(--seal-deep, #14515C)' }}>
                {' '}
                ({trendDelta! > 0 ? '+' : '−'}
                {fmtMoneyWhole(Math.abs(trendDelta!))})
              </span>
            )}
          </span>
        </div>
        <p style={{ fontSize: 11.5, color: 'var(--ink-3, #7C7365)', margin: '4px 0 0' }}>
          Credit memos actually issued. Money asked for is not counted here.
        </p>

        {isError && (
          <p role="alert" style={{ fontSize: 12.5, color: 'var(--ink-2, #4F473C)', marginTop: 12 }}>
            The figure could not be loaded — it is unknown, not zero.{' '}
            <button
              type="button"
              onClick={refetch}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                color: 'var(--seal-deep, #14515C)',
                textDecoration: 'underline',
                cursor: 'pointer',
                fontSize: 12.5,
                fontFamily: SANS,
              }}
            >
              Try again
            </button>
          </p>
        )}

        {!hasData && !isError && (
          <p style={{ fontSize: 12.5, color: 'var(--ink-3, #7C7365)', marginTop: 12 }}>
            Reaching the gateway…
          </p>
        )}

        {stats && (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: 16,
                marginTop: 18,
                paddingTop: 16,
                borderTop: '1px solid var(--paper-2, #EAE4D8)',
              }}
            >
              <Figure
                label="Still owed"
                value={fmtMoney(stats.outstanding)}
                hint={`${stats.openClaims} open claim${stats.openClaims === 1 ? '' : 's'}${
                  stats.oldestOpenDays != null ? `, oldest ${stats.oldestOpenDays}d` : ''
                }`}
              />
              <Figure
                label="Promised"
                value={fmtMoney(stats.promised)}
                hint="Their word, not yet their memo"
              />
              <Figure
                label="They refused"
                value={fmtMoney(stats.rejected)}
                // The denominator. A recovery figure with nothing to divide
                // it by flatters — this sentence is the whole point.
                hint={
                  settlement == null ? 'Nothing settled yet' : `${settlement}% of claims settle`
                }
              />
            </div>

            {stats.selfEvidencedOpen > 0 && (
              <p
                style={{
                  marginTop: 14,
                  fontSize: 12.5,
                  color: 'var(--ink-1, #211C16)',
                  border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                  background: 'var(--seal-tint, rgba(26,94,107,.10))',
                  borderRadius: 10,
                  padding: '10px 12px',
                }}
              >
                <strong>{stats.selfEvidencedOpen}</strong> open claim
                {stats.selfEvidencedOpen === 1 ? ' is' : 's are'} provable from the distributor's
                own packing slip. Those are the ones worth a phone call.
              </p>
            )}

            {stats.recovered === 0 && stats.openClaims === 0 && (
              <p style={{ marginTop: 14, fontSize: 12.5, color: 'var(--ink-3, #7C7365)' }}>
                No discrepancies found yet. This fills in as deliveries are matched against their
                invoices.
              </p>
            )}
          </>
        )}
      </div>

      <p style={{ ...capStyle, marginTop: 10 }}>
        <span style={{ fontFamily: SERIF, textTransform: 'none', letterSpacing: 0, fontSize: 11.5 }}>
          The claims themselves are worked on the manager's queue; this page only ever reports what
          settled.
        </span>
      </p>
    </section>
  );
}

export default RcOwnerLedger;
