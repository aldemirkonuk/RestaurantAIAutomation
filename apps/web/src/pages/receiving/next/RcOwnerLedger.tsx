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
 *
 * MONEY IS IN THE CLAIM'S OWN CURRENCY (browser walk 2026-11-12: a TRY house
 * read "≥$0"). Every figure here was formatted as US dollars, and the stats'
 * combined figures add every claim whatever its currency. The gateway also
 * sends `byCurrency`; this ledger prints that, one group per code, the same
 * rule as the /receipts credit lane (ReceiptsCredits.tsx). Nothing converts.
 * A house with no claim at all is told so in words, never shown "$0", and the
 * floor marker is only drawn when the server says its window filled.
 */

import { fmtMoney } from '@/lib/mudavym/format';
import type { RecoveryFigures } from '@/services/api/credits';
import { RcTally } from './RcTally';
import { GE, MONO, SANS, SERIF, capStyle } from './rc-format';
import { SERVER_WINDOWS, type RecoveryData, type RecoveryTrend } from './useReceivingNextData';

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
      <p style={{ fontSize: 11, color: 'var(--ink-4, #665D50)', margin: '2px 0 0' }}>{hint}</p>
    </div>
  );
}

/** One group's money: its own code, the floor marker only when the window filled. */
function moneyIn(code: string | null, floor: string) {
  return (n: number) => `${floor}${fmtMoney(n, code)}`;
}

function trendLine(t: RecoveryTrend, floor: string) {
  const money = moneyIn(t.currency, floor);
  const delta = t.thisMonth - t.lastMonth;
  return (
    <>
      this month {money(t.thisMonth)} · last month {money(t.lastMonth)}
      {delta !== 0 && (
        <span style={{ color: 'var(--seal-deep, #14515C)' }}>
          {' '}
          ({delta > 0 ? '+' : '−'}
          {fmtMoney(Math.abs(delta), t.currency)})
        </span>
      )}
    </>
  );
}

export function RcOwnerLedger({ data }: { data: RecoveryData }) {
  const {
    stats,
    trend,
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
  const floor = statsAtFloor ? GE : '';
  const trendFloor = trendAtFloor ? GE : '';

  // One group per currency the claims carry. A gateway older than
  // `byCurrency` sends the combined figures only, and their currency is not
  // stated, so they print as "not recorded" rather than borrowing a symbol.
  const groups: Array<{ code: string | null; figures: RecoveryFigures }> | null = stats
    ? stats.byCurrency
      ? Object.entries(stats.byCurrency).map(([code, figures]) => ({ code, figures }))
      : [{ code: null, figures: stats }]
    : null;
  const noClaim = groups !== null && groups.length === 0;

  const statsFloorNote = stats?.capped
    ? `At least this much. These figures come from the first ${SERVER_WINDOWS.RECOVERY_STATS.toLocaleString()} credit claims only, so a house past that has claims outside them.`
    : `At least this much. Mudavym did not say whether it read every credit claim (it reads at most ${SERVER_WINDOWS.RECOVERY_STATS.toLocaleString()}), so each figure is shown as a floor.`;

  const tallyStyle = {
    fontFamily: MONO,
    fontSize: 38,
    fontWeight: 700,
    letterSpacing: '-0.02em',
    color: 'var(--seal-deep, #14515C)',
  } as const;

  return (
    <section aria-label="Money recovered from vendors" style={{ fontFamily: SANS }}>
      <div
        style={{
          border: '1px solid var(--paper-2, #EAE4D8)',
          borderRadius: 16,
          background: 'var(--paper-1, #F3EFE6)',
          padding: '20px 22px',
        }}
      >
        <span style={capStyle}>Recovered from vendors</span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
          {noClaim ? (
            <p style={{ fontFamily: SERIF, fontSize: 17, color: 'var(--ink-1, #211C16)', margin: '6px 0 0' }}>
              Nothing yet: no credit claim has been opened at this house.
            </p>
          ) : groups === null || groups.length === 1 ? (
            <RcTally
              value={groups ? groups[0].figures.recovered : null}
              format={moneyIn(groups ? groups[0].code : null, floor)}
              style={tallyStyle}
            />
          ) : (
            groups.map((g) => (
              <RcTally
                key={g.code}
                value={g.figures.recovered}
                format={moneyIn(g.code, floor)}
                style={{ ...tallyStyle, fontSize: 30 }}
              />
            ))
          )}
          {/* the trend — real settle dates, never estimated, one line per currency */}
          {trend !== null && trend.length > 0 && (
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
                display: 'grid',
                gap: 2,
              }}
            >
              {trend.map((t) => (
                <span key={t.currency ?? ''}>{trendLine(t, trendFloor)}</span>
              ))}
            </span>
          )}
        </div>
        <p style={{ fontSize: 11.5, color: 'var(--ink-4, #665D50)', margin: '4px 0 0' }}>
          Credit memos actually issued. Money asked for is not counted here.
          {groups !== null && groups.length > 1 && ' Each currency is kept apart; nothing is converted.'}
          {trend !== null && trend.length === 0 && !noClaim && ' No claim has settled yet.'}
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
            <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--ink-4, #665D50)' }}>
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
                color: 'var(--ink-4, #665D50)',
                marginTop: 4,
              }}
            >
              {failure?.status === null ? 'no status' : `HTTP ${failure?.status}`} ·{' '}
              {failure?.message}
            </span>
          </p>
        )}

        {!hasData && !isError && (
          <p style={{ fontSize: 12.5, color: 'var(--ink-4, #665D50)', marginTop: 12 }}>
            Reaching the gateway…
          </p>
        )}

        {stats && !noClaim && groups && (
          <>
            {groups.map((g) => {
              const money = moneyIn(g.code, floor);
              const f = g.figures;
              return (
                <div
                  key={g.code ?? ''}
                  style={{
                    marginTop: 18,
                    paddingTop: 16,
                    borderTop: '1px solid var(--paper-2, #EAE4D8)',
                  }}
                >
                  {groups.length > 1 && (
                    <span style={capStyle}>Claims in {g.code ?? 'a currency not recorded'}</span>
                  )}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                      gap: 16,
                    }}
                  >
                    <Figure
                      label="Still owed"
                      title={statsAtFloor ? statsFloorNote : undefined}
                      value={money(f.outstanding)}
                      hint={`${floor}${f.openClaims} open claim${f.openClaims === 1 ? '' : 's'}${
                        f.oldestOpenDays != null
                          ? `, oldest ${f.oldestOpenDays} day${f.oldestOpenDays === 1 ? '' : 's'}`
                          : ''
                      }`}
                    />
                    <Figure
                      label="Promised"
                      title={statsAtFloor ? statsFloorNote : undefined}
                      value={money(f.promised)}
                      hint="Their word, not yet their memo"
                    />
                    <Figure
                      label="They refused"
                      title={statsAtFloor ? statsFloorNote : undefined}
                      value={money(f.rejected)}
                      // `settlementRate` used to sit here, and it is settled ÷ ALL
                      // RESOLVED claims — not a property of the refused ones. Correct
                      // number, wrong population implied. It now stands on its own
                      // line below, over the population it actually describes.
                      hint="Asked for and turned down"
                    />
                  </div>
                </div>
              );
            })}

            {/* The denominator. A recovery figure with nothing to divide it by
                flatters — this sentence is the whole point, and it is about
                every resolved claim, not the refused ones. */}
            <p style={{ fontSize: 11.5, color: 'var(--ink-4, #665D50)', margin: '10px 0 0' }}>
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
                {stats.selfEvidencedOpen === 1 ? ' is' : 's are'} provable from the vendor's
                own packing slip. Those are the ones worth a phone call.
              </p>
            )}

            {stats.recovered === 0 && stats.openClaims === 0 && (
              <p style={{ marginTop: 14, fontSize: 12.5, color: 'var(--ink-4, #665D50)' }}>
                No discrepancies found yet. This fills in as deliveries are matched against their
                invoices.
              </p>
            )}
          </>
        )}

        {noClaim && (
          <p style={{ marginTop: 14, fontSize: 12.5, color: 'var(--ink-4, #665D50)' }}>
            When an invoice bills more than was agreed or arrived, a claim opens on the manager's
            queue, and what the vendor credits back is counted here in that claim's own currency.
          </p>
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
