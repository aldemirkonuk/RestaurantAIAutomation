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
import {
  GE,
  MONO,
  SANS,
  SERIF,
  capStyle,
  fmtMoney,
  fmtMoneyWhole,
  fmtMoneyWholeFloor,
} from './rc-format';
import { SERVER_WINDOWS, type RecoveryData } from './useReceivingNextData';

function Figure({
  label,
  value,
  hint,
  title,
}: {
  label: string;
  value: string;
  hint: string;
  title?: string;
}) {
  return (
    <div title={title}>
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
  const {
    stats,
    creditedThisMonth,
    creditedLastMonth,
    trendIsError,
    trendFailure,
    statsAtFloor,
    trendAtFloor,
    hasData,
    isError,
    failure,
    refetch,
  } = data;
  const settlement =
    stats?.settlementRate == null ? null : Math.round(stats.settlementRate * 100);

  const trendKnown = creditedThisMonth !== null && creditedLastMonth !== null;
  const trendDelta = trendKnown ? creditedThisMonth! - creditedLastMonth! : null;

  const statsFloorNote = `At least this much. /credits/stats reads at most ${SERVER_WINDOWS.RECOVERY_STATS} credit rows with no ordering, so a restaurant past that cap has claims outside the figure entirely.`;

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
            format={(n) => fmtMoneyWholeFloor(n, statsAtFloor)}
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
            title={
              trendAtFloor
                ? `At least this much. The settled-claims list is served oldest-first and capped at ${SERVER_WINDOWS.CREDITS_LIST} rows, so the most recent settlements can fall outside it.`
                : undefined
            }
            style={{
              fontFamily: MONO,
              fontSize: 12.5,
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--ink-2, #4F473C)',
            }}
          >
            this month {fmtMoneyWholeFloor(creditedThisMonth, trendAtFloor)} · last month{' '}
            {fmtMoneyWholeFloor(creditedLastMonth, trendAtFloor)}
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

        {/* The trend's own failure, said out loud. It used to render the same
            two dashes as "nothing has settled yet" — honest by accident and
            indistinguishable from a measurement (F9). The headline figure above
            is allowed to stand: it comes from a different query. */}
        {trendIsError && (
          <p role="alert" style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)', marginTop: 8 }}>
            {trendFailure?.forbidden
              ? 'This account is not permitted to read the settled-claims list, so the month-on-month trend is unavailable — not zero.'
              : 'The settled-claims list did not load, so the two months above are unknown — not zero, and not "nothing settled".'}{' '}
            <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--ink-3, #7C7365)' }}>
              {trendFailure?.status === null ? 'no status' : `HTTP ${trendFailure?.status}`} ·{' '}
              {trendFailure?.message}
            </span>
          </p>
        )}

        {isError && (
          <p role="alert" style={{ fontSize: 12.5, color: 'var(--ink-2, #4F473C)', marginTop: 12 }}>
            {failure?.forbidden ? (
              <>
                This account is not permitted to see recovered money. The gateway understood the
                request and refused it — a permission, not an outage, so retrying will not change
                it. The figure is unknown, not zero.
              </>
            ) : (
              <>The figure could not be loaded — it is unknown, not zero. </>
            )}
            {!failure?.forbidden && (
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
            )}
            <span
              style={{
                display: 'block',
                fontFamily: MONO,
                fontSize: 10.5,
                color: 'var(--ink-3, #7C7365)',
                marginTop: 4,
              }}
            >
              {failure?.status === null ? 'no status' : `HTTP ${failure?.status}`} ·{' '}
              {failure?.message}
            </span>
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
                title={statsFloorNote}
                value={statsAtFloor ? `${GE}${fmtMoney(stats.outstanding)}` : fmtMoney(stats.outstanding)}
                hint={`${GE}${stats.openClaims} open claim${stats.openClaims === 1 ? '' : 's'}${
                  stats.oldestOpenDays != null ? `, oldest ${stats.oldestOpenDays}d` : ''
                }`}
              />
              <Figure
                label="Promised"
                title={statsFloorNote}
                value={statsAtFloor ? `${GE}${fmtMoney(stats.promised)}` : fmtMoney(stats.promised)}
                hint="Their word, not yet their memo"
              />
              <Figure
                label="They refused"
                title={statsFloorNote}
                value={statsAtFloor ? `${GE}${fmtMoney(stats.rejected)}` : fmtMoney(stats.rejected)}
                // `settlementRate` used to sit here, and it is settled ÷ ALL
                // RESOLVED claims — not a property of the refused ones. Correct
                // number, wrong population implied. It now stands on its own
                // line below, over the population it actually describes.
                hint="Asked for and turned down"
              />
            </div>

            {/* The denominator. A recovery figure with nothing to divide it by
                flatters — this sentence is the whole point, and it is about
                every resolved claim, not the refused ones. */}
            <p style={{ fontSize: 11.5, color: 'var(--ink-3, #7C7365)', margin: '10px 0 0' }}>
              {settlement == null
                ? 'Nothing has resolved yet, so there is no settlement rate to report.'
                : `${settlement}% of resolved claims settled — that is credited claims over everything credited or refused, not a property of the refusals above.`}
            </p>

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
