/**
 * A member's sales performance, in house tokens — the legacy `PerformancePanel`
 * read only, as a card inside the roster expander and under a selected shift.
 *
 * TWO THINGS ARE DELIBERATELY NOT HERE.
 *
 * 1. **Ingest.** The legacy panel carries a "log a service" form and a CSV
 *    upload. Both still exist on the legacy desk; putting a data-entry form
 *    inside a schedule expander would make the manager's fastest path to a
 *    performance number "type one in", which is how a page starts measuring
 *    itself. §13 of the page note carries the request to move ingest to a
 *    surface of its own.
 * 2. **A comparison the numbers do not support.** The dashed line and grey band
 *    are the restaurant's own benchmark and it is a WINDOW:
 *    `performance.service.ts:139` computes the median and quartiles over the
 *    most recent `TEAM_SERVER_WINDOWS.BENCHMARK_SERVICES` logged services across
 *    the whole restaurant, not over all of them. Rendered without that sentence
 *    it reads as "the team", which it is not — so the caption states the
 *    ceiling with `LE` (ADR 0051 clause 2: a windowed figure carries its mark,
 *    and a cap on a SAMPLE is a ceiling, never a floor).
 *
 * A benchmark that is unknown draws nothing at all. It used to arrive as 0,
 * which pinned the peer line to the floor and put every server above average.
 */

import { useQuery } from '@tanstack/react-query';
import { getMemberPerformance } from '../../../services/api/team';
import { useActiveRestaurantId, TEAM_SERVER_WINDOWS } from './useTeamNextData';
import { EM, LE } from './tm-format';
import { Card, KV } from './tm-bits';

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
  return (
    <Card title="Performance">
      <KV k="Sales / shift" v={m ? `$${m.salesPerShift.toLocaleString()}` : EM} />
      <KV k="Average check" v={m ? `$${m.avgCheck.toLocaleString()}` : EM} />
      <KV k="Wine attach" v={m ? `${m.wineAttachPct}%` : EM} />
      <p className="tm-hint">
        {a && a.median !== null
          ? `Against a house median of ${a.median.toLocaleString()}, taken over the restaurant's most recent services — ${LE}${TEAM_SERVER_WINDOWS.BENCHMARK_SERVICES} of them, not its whole history.`
          : `The house benchmark is ${EM}: no other server here has enough attributed services to compute one, so this figure stands alone rather than above or below anything.`}
      </p>
    </Card>
  );
}
