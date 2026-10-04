/**
 * A member's sales performance, in house tokens — the legacy `PerformancePanel`
 * read only, as a card inside the roster expander and under a selected shift.
 *
 * TWO THINGS ARE DELIBERATELY NOT HERE.
 *
 * 1. **Ingest.** Sales are logged in their own sheet (`SalesSheet.tsx`, the
 *    header's "Log sales"; page note §13.8). Putting a data-entry form inside a
 *    schedule expander would make the manager's fastest path to a performance
 *    number "type one in", which is how a page starts measuring itself.
 * 2. **A comparison the numbers do not support.** The house benchmark is a
 *    WINDOW: `performance.service.ts` takes the median over the restaurant's
 *    most recent `TEAM_SERVER_WINDOWS.BENCHMARK_SERVICES` logged services
 *    (its `.limit(200)`), not over all of them. Rendered
 *    without that sentence it reads as "the team", which it is not — so the
 *    sentence states the ceiling with `LE` (ADR 0051 clause 2: a windowed
 *    figure carries its mark, and a cap on a SAMPLE is a ceiling, never a
 *    floor).
 *
 * EVERY FIGURE HAS ITS UNIT (A-048, ADR 0294). The median is sales PER COVER.
 * It used to print as a bare "72" under "Average check $186" — a 2.6x gap made
 * by the unit, not by the person — and beside nothing it could be compared
 * with. It now prints in the house's currency, "per cover", beside this
 * member's own sales per cover, with how many services and servers it covers
 * and whether this member is one of them. When the only per-cover figures are
 * this member's own, the comparison is refused (the founder, 2026-10-04:
 * "House median (Recommended)"). Money goes through the house-currency
 * formatters (`tm-format.ts`), never a literal dollar sign.
 *
 * "Wine share of sales" is wine sales over net sales. It used to be labelled
 * "Wine attach", which /reports keeps for checks-with-wine over checks (the
 * founder, 2026-10-04: "Rename on the card (Recommended)").
 *
 * A benchmark that is unknown draws nothing at all. It used to arrive as 0,
 * which pinned the peer line to the floor and put every server above average.
 */

import { useQuery } from '@tanstack/react-query';
import { getMemberPerformance, type MemberPerformance } from '../../../services/api/team';
import { useActiveRestaurantId, TEAM_SERVER_WINDOWS } from './useTeamNextData';
import { EM, LE, fmtMoneyExact, fmtMoneyWhole, houseLocale, type HouseMoneyLike } from './tm-format';
import { Card, KV } from './tm-bits';

/** A gateway built before ADR 0294 sends no currency: say so, never guess one. */
const MONEY_UNREAD: HouseMoneyLike = { currency: null, country: null, readable: false };

function count(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

function fmtShare(v: number | null | undefined, money: HouseMoneyLike): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return EM;
  return new Intl.NumberFormat(houseLocale(money.country), {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(v / 100);
}

/** Which of this member's services the per-cover figure is taken over, when not all. */
function coverLine(
  m: NonNullable<MemberPerformance['metrics']>,
  services: number | null,
  name: string,
): string | null {
  const covered = m.coverServices;
  if (typeof covered !== 'number' || services === null || covered >= services) return null;
  if (covered === 0) {
    return `None of these ${count(services, 'service')} records covers with its sales, so ${name} has no sales per cover to compare.`;
  }
  return `Sales per cover counts the ${covered.toLocaleString()} of these ${count(services, 'service')} that record covers.`;
}

function benchmarkLine(
  a: MemberPerformance['analytic'],
  money: HouseMoneyLike,
  name: string,
): string {
  const ceiling = `${LE}${TEAM_SERVER_WINDOWS.BENCHMARK_SERVICES}`;
  const alone = `The house benchmark is ${EM}, so these figures stand alone rather than above or below anything.`;
  const b = a?.benchmark;
  if (!a || !b) {
    // A gateway built before ADR 0294 sends no reason and no counts.
    return a && a.median !== null
      ? `Against a house median of ${fmtMoneyExact(a.median, money)} per cover, taken over the restaurant's most recent services — ${ceiling} of them, not its whole history.`
      : alone;
  }
  switch (b.state) {
    case 'computed':
      if (a.median === null) return alone;
      return `Against a house median of ${fmtMoneyExact(a.median, money)} per cover: ${count(b.services, 'service')} by ${count(b.servers, 'server')}, ${
        b.includesMember ? `${name}'s own included` : `none of them ${name}'s`
      }, among the restaurant's ${ceiling} most recent — not its whole history.`;
    case 'self-only':
      return `The house benchmark is ${EM}: the only per-cover figures in the house's recent services (the restaurant's ${ceiling} most recent) are ${name}'s own, so there is nothing to set them against.`;
    case 'no-covers':
      return `The house benchmark is ${EM}: none of the restaurant's ${ceiling} most recent services records covers with its sales, so there is no per-cover figure to compare against.`;
    case 'unreadable':
      return `The house benchmark is ${EM}: the restaurant's recent services could not be read, so these figures stand alone rather than above or below anything.`;
    default:
      return alone;
  }
}

export function PerformanceCard({
  memberId,
  memberName,
}: {
  memberId: string;
  memberName: string;
}) {
  const rid = useActiveRestaurantId();
  const q = useQuery({
    queryKey: ['team-next-performance', rid, memberId],
    queryFn: () => getMemberPerformance(memberId),
    enabled: rid !== null,
    staleTime: 60_000,
  });

  if (q.isError) {
    return (
      <Card title="Performance">
        <p className="tm-quiet" role="alert">
          The sales register could not be read for {memberName}, so this is unknown — not
          zero and not &quot;no sales&quot;.
        </p>
      </Card>
    );
  }
  if (q.data === undefined) {
    return (
      <Card title="Performance">
        <p className="tm-quiet">Reading the sales register…</p>
      </Card>
    );
  }
  if (!q.data.hasData) {
    return (
      <Card title="Performance">
        <p className="tm-quiet">
          No service has been attributed to {memberName} yet, so there is nothing to
          measure. Numbers here are never estimated.
        </p>
      </Card>
    );
  }

  const m = q.data.metrics;
  const a = q.data.analytic;
  const money = q.data.money ?? MONEY_UNREAD;
  const services = Array.isArray(q.data.services) ? q.data.services.length : null;
  const covered = m ? coverLine(m, services, memberName) : null;
  return (
    <Card title="Performance">
      {services !== null && (
        <p className="tm-hint">
          Over {memberName}&apos;s last {count(services, 'logged service')}.
        </p>
      )}
      <KV k="Sales / shift" v={m ? fmtMoneyWhole(m.salesPerShift, money) : EM} />
      <KV k="Average check" v={m ? fmtMoneyExact(m.avgCheck, money) : EM} />
      <KV k="Sales per cover" v={m ? fmtMoneyExact(m.salesPerCover, money) : EM} />
      <KV k="Wine share of sales" v={m ? fmtShare(m.wineAttachPct, money) : EM} />
      {covered && <p className="tm-hint">{covered}</p>}
      <p className="tm-hint">{benchmarkLine(a, money, memberName)}</p>
    </Card>
  );
}
