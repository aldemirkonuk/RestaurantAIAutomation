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
 * ONE BLOCK PER CURRENCY (scenario walk 2026-10-07, PROCURE-03). Every figure
 * here used to print through formatters pinned to US dollars, from the
 * gateway's combined figures — which add lira to euros when a house claims in
 * both (credits.controller.ts, `byCurrency`). The ledger now reads `byCurrency`
 * and the settled list per claim currency: each currency gets its own
 * recovered figure, trend and still-owed/promised/refused, in its own money.
 * Nothing is added across currencies and nothing is converted; a claim that
 * names no currency says "currency not recorded". The /receipts credits lane
 * (ReceiptsCredits.tsx) already reads the figures this way.
 */

import { RcTally } from './RcTally';
import {
  CURRENCY_UNRECORDED,
  GE,
  MONO,
  SANS,
  SERIF,
  capStyle,
  fmtMoney,
  fmtMoneyWhole,
  fmtMoneyWholeFloor,
} from './rc-format';
import {
  SERVER_WINDOWS,
  recoveryGroups,
  type RecoveryData,
  type RecoveryGroup,
} from './useReceivingNextData';

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

/** What a currency block is called when there is more than one, or when its money is unnamed. */
function groupCaption(code: string | null): string {
  if (code === null)
    return 'The gateway did not say which currency these figures are in — they may add several currencies together';
  if (code === CURRENCY_UNRECORDED) return 'Claims that name no currency — kept apart';
  return `Claims in ${code} — kept apart, nothing is converted`;
}

function CurrencyBlock({
  group,
  many,
  statsAtFloor,
  trendAtFloor,
  statsFloorNote,
}: {
  group: RecoveryGroup;
  many: boolean;
  statsAtFloor: boolean;
  trendAtFloor: boolean;
  statsFloorNote: string;
}) {
  // `code` is the money's own: an ISO code, or one the formatters cannot read
  // (`CURRENCY_UNRECORDED`, null), which they print as "currency not recorded".
  const { code, figures, trend } = group;
  const trendDelta =
    trend && trend.thisMonth !== null && trend.lastMonth !== null
      ? trend.thisMonth - trend.lastMonth
      : null;
  const money = (n: number) => (statsAtFloor ? `${GE}${fmtMoney(n, code)}` : fmtMoney(n, code));

  return (
    <div data-currency={code ?? 'combined'} style={{ marginTop: many ? 14 : 0 }}>
      {/* A caption only when it says something: more than one currency, or
          an older gateway's combined figures (code null WITH figures — the
          not-yet-answered placeholder has neither). */}
      {(many || (code === null && figures !== null)) && (
        <p style={{ ...capStyle, margin: '0 0 2px' }}>{groupCaption(code)}</p>
      )}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
        <RcTally
          value={figures ? figures.recovered : null}
          format={(n) => fmtMoneyWholeFloor(n, statsAtFloor, code)}
          style={{
            fontFamily: MONO,
            fontSize: many ? 28 : 38,
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
          this month {fmtMoneyWholeFloor(trend ? trend.thisMonth : null, trendAtFloor, code)} · last
          month {fmtMoneyWholeFloor(trend ? trend.lastMonth : null, trendAtFloor, code)}
          {trendDelta !== null && trendDelta !== 0 && (
            <span style={{ color: 'var(--seal-deep, #14515C)' }}>
              {' '}
              ({trendDelta > 0 ? '+' : '−'}
              {fmtMoneyWhole(Math.abs(trendDelta), code)})
            </span>
          )}
        </span>
      </div>

      {figures && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 16,
            marginTop: 12,
            paddingTop: 12,
            borderTop: '1px solid var(--paper-2, #EAE4D8)',
          }}
        >
          <Figure
            label="Still owed"
            title={statsFloorNote}
            value={money(figures.outstanding)}
            hint={`${GE}${figures.openClaims} open claim${figures.openClaims === 1 ? '' : 's'}${
              figures.oldestOpenDays != null ? `, oldest ${figures.oldestOpenDays}d` : ''
            }`}
          />
          <Figure
            label="Promised"
            title={statsFloorNote}
            value={money(figures.promised)}
            hint="Their word, not yet their memo"
          />
          <Figure
            label="They refused"
            title={statsFloorNote}
            value={money(figures.rejected)}
            // `settlementRate` used to sit here, and it is settled ÷ ALL
            // RESOLVED claims — not a property of the refused ones. Correct
            // number, wrong population implied. It now stands on its own
            // line below, over the population it actually describes.
            hint="Asked for and turned down"
          />
        </div>
      )}
    </div>
  );
}

export function RcOwnerLedger({ data }: { data: RecoveryData }) {
  const {
    stats,
    trendByCurrency,
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

  const groups = recoveryGroups(stats, trendByCurrency);
  // Answered, and no claim in any currency: nothing to print a zero in.
  const noClaims = stats?.byCurrency != null && groups.length === 0;

  const statsFloorNote = `At least this much. /credits/stats reads at most ${SERVER_WINDOWS.RECOVERY_STATS} credit rows with no ordering, so a restaurant past that cap has claims outside the figure entirely.`;

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
        {noClaims ? (
          <p
            style={{
              fontFamily: SERIF,
              fontSize: 22,
              color: 'var(--ink-2, #4F473C)',
              margin: '4px 0 0',
            }}
          >
            Nothing yet
          </p>
        ) : (
          // Before either read answers there is no currency to name: one block,
          // every figure a dash.
          (groups.length > 0 ? groups : [{ code: null, figures: null, trend: null }]).map((g) => (
            <CurrencyBlock
              key={g.code ?? 'combined'}
              group={g}
              many={groups.length > 1}
              statsAtFloor={statsAtFloor}
              trendAtFloor={trendAtFloor}
              statsFloorNote={statsFloorNote}
            />
          ))
        )}
        <p style={{ fontSize: 11.5, color: 'var(--ink-4, #665D50)', margin: '4px 0 0' }}>
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

        {stats && (
          <>
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
