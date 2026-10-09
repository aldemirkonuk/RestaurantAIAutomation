import {
  houseMembersInRoles,
  OWNER_AND_MANAGER,
} from "../../common/tenant/live-membership";
import type { ProducerAudience } from "./producer-ledger.service";

/**
 * The house's owners and managers, intersected with the audience a sweep was
 * handed: who may hear a goal whose metric reads the till (ADR 0298 decision
 * 9; ADR 0145 `ROLE_POLICY` gives `sales` to these two roles only).
 *
 * The read is `houseMembersInRoles` (common/tenant/live-membership.ts), the
 * shared role reader the websocket role gate's claim asks new code to use: the
 * table GrantSuspendedProducer reads, `role IN ('owner', 'manager')`, a live
 * row. Intersecting rather than reading the role rows alone keeps the
 * quiet-hours and Away split, and a role row alone does not make someone a
 * member of the house.
 *
 * A failed read THROWS (ADR 0067): it cannot tell who holds the sales class,
 * and neither the whole house (a leak) nor nobody (an empty set reported as an
 * answer) is the truth. The caller withholds the goal and counts it failed.
 */

/**
 * The user ids holding owner or manager on a live access row of this house
 * (`houseMembersInRoles`: active, inside its window, role checked twice). It
 * throws on a failed read (ADR 0067). The recommendation digest uses it too, to
 * compose the till-reading letter for these people only.
 */
export async function readSalesHolderIds(
  client: any,
  restaurantId: string,
): Promise<Set<string>> {
  return new Set(
    await houseMembersInRoles(client, restaurantId, OWNER_AND_MANAGER),
  );
}

export async function salesHolderAudience(
  client: any,
  restaurantId: string,
  audience: ProducerAudience,
): Promise<ProducerAudience> {
  const holders = await readSalesHolderIds(client, restaurantId);
  return {
    ready: audience.ready.filter((u) => holders.has(u)),
    deferred: audience.deferred.filter((u) => holders.has(u)),
    ...(audience.away
      ? { away: audience.away.filter((u) => holders.has(u)) }
      : {}),
  };
}

/** Nobody in the narrowed audience: not ready, not deferred, not away. */
export function isEmptyAudience(a: ProducerAudience): boolean {
  return a.ready.length + a.deferred.length + (a.away?.length ?? 0) === 0;
}

/**
 * Who hears one goal on one sweep. A goal whose metric is not in
 * `SALES_GATED_GOAL_METRICS` keeps the whole audience and the ungated read,
 * as before. One that is gets the owners and managers among the audience and
 * the gate open; the role read runs at most once per sweep.
 */
export class GoalAudience {
  /** Gated goals withheld because no owner or manager is in the audience. */
  noHolder = 0;
  /** Gated goals withheld because the role read failed (counted failed too). */
  roleUnread = 0;
  private holders: Promise<ProducerAudience> | null = null;

  constructor(
    private readonly client: any,
    private readonly restaurantId: string,
    private readonly audience: ProducerAudience,
    private readonly gated: ReadonlySet<string>,
  ) {}

  async for(
    metricKey: string,
  ): Promise<
    | { audience: ProducerAudience; gate: { withSales: true } | null }
    | { withheld: "no-holder" }
    | { withheld: "role-unread"; reason: string }
  > {
    if (!this.gated.has(metricKey))
      return { audience: this.audience, gate: null };
    if (this.holders == null) {
      this.holders = salesHolderAudience(
        this.client,
        this.restaurantId,
        this.audience,
      );
    }
    let narrowed: ProducerAudience;
    try {
      narrowed = await this.holders;
    } catch (e: any) {
      this.roleUnread += 1;
      return { withheld: "role-unread", reason: String(e?.message ?? e) };
    }
    if (isEmptyAudience(narrowed)) {
      this.noHolder += 1;
      return { withheld: "no-holder" };
    }
    return { audience: narrowed, gate: { withSales: true } };
  }

  /** The sentence a no-op sweep adds for the gated goals it withheld. */
  sentence(): string {
    const parts: string[] = [];
    if (this.noHolder > 0)
      parts.push(
        `${this.noHolder} goal(s) read from the till's sales were not reported: no owner or manager of this house is in the audience, and the till's figures are theirs to see (ADR 0298 decision 9).`,
      );
    if (this.roleUnread > 0)
      parts.push(
        `${this.roleUnread} goal(s) read from the till's sales were not read: who may see them could not be read from user_restaurant_access.`,
      );
    return parts.join(" ");
  }
}
